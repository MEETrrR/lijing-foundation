const crypto = require("node:crypto");
const { PlatformError } = require("../../platform/errors/error-catalog.ts");

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EVENT_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const DEFAULT_TIMEZONE = "Asia/Shanghai";

function validateTimezone(value) {
  const timezone = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format();
    return timezone;
  } catch {
    throw new TypeError("analytics timezone is invalid");
  }
}

function dateKey(timestamp, timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function shiftDate(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function validateDate(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) throw new PlatformError("VALIDATION_ERROR", "date must use YYYY-MM-DD");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new PlatformError("VALIDATION_ERROR", "date is invalid");
  return value;
}

function validateEvent(event) {
  if (typeof event !== "string" || !EVENT_PATTERN.test(event)) throw new TypeError("analytics event is invalid");
  return event;
}

function actorDigest(actorId, salt) {
  return crypto.createHash("sha256").update(`${salt}:${actorId}`, "utf8").digest("hex").slice(0, 40);
}

function dayKey(date) { return `analytics:active:${date}:`; }
function registrationKey(date) { return `analytics:registered:${date}:`; }
function eventKey(date, event) { return `analytics:event:${date}:${event}:`; }
function counterKey(date) { return `analytics:counter:${date}`; }
function aiRequestKey(requestId) { return `analytics:ai-request:${requestId}`; }

const EMPTY_COUNTER = Object.freeze({
  ai_requests: 0,
  ai_completed: 0,
  ai_degraded: 0,
  ai_rejected: 0,
});

class AdminAnalyticsService {
  constructor(options = {}) {
    this.database = options.database;
    this.clock = options.clock ?? (() => Date.now());
    this.timezone = validateTimezone(options.timezone ?? DEFAULT_TIMEZONE);
    this.hashSalt = typeof options.hashSalt === "string" && options.hashSalt.trim() ? options.hashSalt.trim() : "lijing-local-analytics";
  }

  currentDate() {
    return dateKey(this.clock(), this.timezone);
  }

  async markUnique(prefix, actorId, timestamp = this.clock()) {
    const date = dateKey(timestamp, this.timezone);
    const digest = actorDigest(actorId, this.hashSalt);
    return this.database.transaction(async (database) => {
      const created = await database.setIfAbsent(`${prefix}${digest}`, { created_at: new Date(timestamp).toISOString() });
      return created;
    });
  }

  async recordActivity(actorId, timestamp = this.clock()) {
    await this.database.transaction(async (database) => {
      const date = dateKey(timestamp, this.timezone);
      const digest = actorDigest(actorId, this.hashSalt);
      const value = { created_at: new Date(timestamp).toISOString() };
      await database.setIfAbsent(`${dayKey(date)}${digest}`, value);
    });
  }

  async recordRegistration(actorId, timestamp = this.clock()) {
    await this.markUnique(registrationKey(dateKey(timestamp, this.timezone)), actorId, timestamp);
  }

  async recordUniqueEvent(actorId, event, timestamp = this.clock()) {
    await this.markUnique(eventKey(dateKey(timestamp, this.timezone), validateEvent(event)), actorId, timestamp);
  }

  async recordAiRequest(status = "accepted", estimatedCostUsd = 0, timestamp = this.clock(), requestId) {
    const date = dateKey(timestamp, this.timezone);
    const normalizedStatus = ["accepted", "completed", "degraded", "rejected", "queued"].includes(status) ? status : "accepted";
    await this.database.transaction(async (database) => {
      if (requestId) {
        const key = aiRequestKey(requestId);
        if (await database.get(key)) return;
        await database.set(key, { status: normalizedStatus, date, created_at: new Date(timestamp).toISOString() });
      }
      const current = await database.get(counterKey(date)) ?? { ...EMPTY_COUNTER, estimated_cost_usd: 0 };
      const next = {
        ...EMPTY_COUNTER,
        ...current,
        ai_requests: Number(current.ai_requests) || 0,
        ai_completed: Number(current.ai_completed) || 0,
        ai_degraded: Number(current.ai_degraded) || 0,
        ai_rejected: Number(current.ai_rejected) || 0,
        estimated_cost_usd: Number(current.estimated_cost_usd) || 0,
      };
      next.ai_requests += 1;
      if (normalizedStatus === "completed") next.ai_completed += 1;
      if (normalizedStatus === "degraded") next.ai_degraded += 1;
      if (normalizedStatus === "rejected") next.ai_rejected += 1;
      if (Number.isFinite(estimatedCostUsd) && estimatedCostUsd > 0) next.estimated_cost_usd = Number((next.estimated_cost_usd + estimatedCostUsd).toFixed(8));
      await database.set(counterKey(date), next);
    });
  }

  async recordAiOutcome(requestId, status, estimatedCostUsd = 0, timestamp = this.clock()) {
    if (!requestId) return;
    const date = dateKey(timestamp, this.timezone);
    const normalizedStatus = ["completed", "degraded", "rejected"].includes(status) ? status : "degraded";
    await this.database.transaction(async (database) => {
      const key = aiRequestKey(requestId);
      const existing = await database.get(key);
      if (existing && ["completed", "degraded", "rejected"].includes(existing.status)) return;
      const counterDate = existing?.date ?? date;
      await database.set(key, { status: normalizedStatus, date: counterDate, created_at: existing?.created_at ?? new Date(timestamp).toISOString(), completed_at: new Date(timestamp).toISOString() });
      const current = await database.get(counterKey(counterDate)) ?? { ...EMPTY_COUNTER, estimated_cost_usd: 0 };
      const next = {
        ...EMPTY_COUNTER,
        ...current,
        ai_requests: Number(current.ai_requests) || 0,
        ai_completed: Number(current.ai_completed) || 0,
        ai_degraded: Number(current.ai_degraded) || 0,
        ai_rejected: Number(current.ai_rejected) || 0,
        estimated_cost_usd: Number(current.estimated_cost_usd) || 0,
      };
      if (!existing) next.ai_requests += 1;
      if (normalizedStatus === "completed") next.ai_completed += 1;
      if (normalizedStatus === "degraded") next.ai_degraded += 1;
      if (normalizedStatus === "rejected") next.ai_rejected += 1;
      if (Number.isFinite(estimatedCostUsd) && estimatedCostUsd > 0) next.estimated_cost_usd = Number((next.estimated_cost_usd + estimatedCostUsd).toFixed(8));
      await database.set(counterKey(counterDate), next);
    });
  }

  async readDay(date) {
    const [counter, dau, newUsers, firstActions, materials, evidence] = await Promise.all([
      this.database.get(counterKey(date)),
      this.database.countKeys(dayKey(date)),
      this.database.countKeys(registrationKey(date)),
      this.database.countKeys(eventKey(date, "first_action")),
      this.database.countKeys(eventKey(date, "material_submitted")),
      this.database.countKeys(eventKey(date, "evidence_submitted")),
    ]);
    return {
      date,
      dau,
      new_users: newUsers,
      first_action_users: firstActions,
      material_submitted_users: materials,
      evidence_submitted_users: evidence,
      ai_requests: Number(counter?.ai_requests) || 0,
      ai_completed: Number(counter?.ai_completed) || 0,
      ai_degraded: Number(counter?.ai_degraded) || 0,
      ai_rejected: Number(counter?.ai_rejected) || 0,
      estimated_cost_usd: Number(Number(counter?.estimated_cost_usd || 0).toFixed(8)),
    };
  }

  async getOverview(requestedDate) {
    if (!this.database || typeof this.database.countKeys !== "function" || typeof this.database.countDistinctKeySuffixes !== "function") throw new PlatformError("DEPENDENCY_UNAVAILABLE", "analytics persistence is unavailable");
    const date = validateDate(requestedDate, this.currentDate());
    const dates = Array.from({ length: 7 }, (_, index) => shiftDate(date, index - 6));
    const series = await Promise.all(dates.map((item) => this.readDay(item)));
    const today = series[series.length - 1];
    const rolling7Prefixes = Array.from({ length: 7 }, (_, index) => dayKey(shiftDate(date, index - 6)));
    const rolling30Prefixes = Array.from({ length: 30 }, (_, index) => dayKey(shiftDate(date, index - 29)));
    const [registeredTotal, active7d, active30d] = await Promise.all([
      this.database.countKeys("identity:user:user-"),
      this.database.countDistinctKeySuffixes(rolling7Prefixes),
      this.database.countDistinctKeySuffixes(rolling30Prefixes),
    ]);
    return {
      date,
      timezone: this.timezone,
      totals: {
        registered_users_total: registeredTotal,
        active_users_7d: active7d,
        active_users_30d: active30d,
        dau: today.dau,
        new_users_today: today.new_users,
        first_action_users_today: today.first_action_users,
        material_submitted_users_today: today.material_submitted_users,
        evidence_submitted_users_today: today.evidence_submitted_users,
        ai_requests_today: today.ai_requests,
        ai_completed_today: today.ai_completed,
        ai_degraded_today: today.ai_degraded,
        estimated_cost_usd_today: today.estimated_cost_usd,
      },
      series,
    };
  }
}

module.exports = {
  AdminAnalyticsService,
  dateKey,
  validateDate,
};
