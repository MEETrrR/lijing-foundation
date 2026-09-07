const crypto = require("node:crypto");
const { isValidRequestId } = require("../../platform/http/correlation-id.ts");
const { PlatformError } = require("../../platform/errors/error-catalog.ts");

const STATE_VERSION = 1;
const STATE_MAX_BYTES = 256 * 1024;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,120}$/;
const GOAL_IDS = new Set(["goal-exam", "goal-skill", "goal-life"]);
const GUIDE_ASSET_IDS = new Set([
  "lijing-guide-heavenly-book-v2",
  "lijing-guide-pagoda-v2",
  "lijing-guide-ding-v2",
  "lijing-guide-fan-v2",
]);
const TASK_STATUSES = new Set(["locked", "active", "done"]);
const KNOWLEDGE_STATES = new Set(["稳固", "回望", "初探", "连通"]);
const KNOWLEDGE_COLORS = new Set(["gold", "blue", "cinnabar", "rock"]);

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

function requireString(value, field, maximum, { optional = false } = {}) {
  if (value === undefined && optional) return "";
  if (typeof value !== "string") throw new PlatformError("VALIDATION_ERROR", `${field} must be a string`);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized && !optional) throw new PlatformError("VALIDATION_ERROR", `${field} is required`);
  if (normalized.length > maximum) throw new PlatformError("VALIDATION_ERROR", `${field} is invalid`);
  return normalized;
}

function optionalString(value, field, maximum) {
  return requireString(value, field, maximum, { optional: true });
}

function optionalIntegerString(value, field, minimum, maximum) {
  const normalized = optionalString(value, field, 8);
  if (!normalized) return "";
  if (!/^\d+$/.test(normalized)) throw new PlatformError("VALIDATION_ERROR", `${field} is invalid`);
  const number = Number(normalized);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new PlatformError("VALIDATION_ERROR", `${field} is invalid`);
  return String(number);
}

function validTimezone(value, field) {
  const normalized = requireString(value, field, 80);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format();
  } catch {
    throw new PlatformError("VALIDATION_ERROR", `${field} is invalid`);
  }
  return normalized;
}

function requireId(value, field) {
  const normalized = requireString(value, field, 120);
  if (!SAFE_ID.test(normalized)) throw new PlatformError("VALIDATION_ERROR", `${field} is invalid`);
  return normalized;
}

function normalizeIdempotencyKey(value) {
  if (typeof value !== "string" || value.length < 16 || value.length > 128 || !/^[A-Za-z0-9._~:-]+$/.test(value)) {
    throw new PlatformError("VALIDATION_ERROR", "Idempotency-Key is required and must be a safe 16-128 character value");
  }
  return value;
}

function profileKey(actorId) {
  return `user:state:${actorId}`;
}

function idempotencyKey(actorId, key) {
  return `idempotency:${actorId}:user.state:${key}`;
}

function initialState() {
  return {
    version: STATE_VERSION,
    profile: {
      name: "",
      stage: "",
      school: "",
      major: "",
      age: "",
      region: "",
      notes: "",
      daily_minutes: "25",
      weekly_hours: "",
      reminder_enabled: true,
      reminder_time: "20:00",
      timezone: "Asia/Shanghai",
    },
    goal_id: "goal-exam",
    guide_asset_id: "lijing-guide-heavenly-book-v2",
    onboarding_completed: false,
    today: null,
    pilot: null,
    knowledge: [],
  };
}

function validateProfile(value, fallback) {
  if (value === undefined) return { ...fallback };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlatformError("VALIDATION_ERROR", "profile must be an object");
  const allowed = new Set(["name", "stage", "school", "major", "age", "region", "notes", "daily_minutes", "weekly_hours", "reminder_enabled", "reminder_time", "timezone"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new PlatformError("VALIDATION_ERROR", `unknown profile field: ${key}`);
  const reminderEnabled = value.reminder_enabled === undefined ? Boolean(fallback.reminder_enabled) : value.reminder_enabled;
  if (typeof reminderEnabled !== "boolean") throw new PlatformError("VALIDATION_ERROR", "profile.reminder_enabled is invalid");
  const reminderTime = value.reminder_time === undefined ? fallback.reminder_time : requireString(value.reminder_time, "profile.reminder_time", 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(reminderTime)) throw new PlatformError("VALIDATION_ERROR", "profile.reminder_time is invalid");
  return {
    name: requireString(value.name, "profile.name", 80),
    stage: requireString(value.stage, "profile.stage", 80),
    school: optionalString(value.school, "profile.school", 160),
    major: optionalString(value.major, "profile.major", 160),
    age: optionalIntegerString(value.age, "profile.age", 13, 100),
    region: optionalString(value.region, "profile.region", 120),
    notes: optionalString(value.notes, "profile.notes", 2000),
    daily_minutes: optionalIntegerString(value.daily_minutes, "profile.daily_minutes", 5, 1440) || "25",
    weekly_hours: optionalIntegerString(value.weekly_hours, "profile.weekly_hours", 1, 168),
    reminder_enabled: reminderEnabled,
    reminder_time: reminderTime,
    timezone: value.timezone === undefined ? fallback.timezone : validTimezone(value.timezone, "profile.timezone"),
  };
}

function validateTask(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlatformError("VALIDATION_ERROR", "today.tasks must contain objects");
  const allowed = new Set(["id", "type", "title", "meta", "status", "gua"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new PlatformError("VALIDATION_ERROR", `unknown task field: ${key}`);
  const status = requireString(value.status, "today.tasks.status", 20);
  if (!TASK_STATUSES.has(status)) throw new PlatformError("VALIDATION_ERROR", "today.tasks.status is invalid");
  return {
    id: requireId(value.id, "today.tasks.id"),
    type: optionalString(value.type, "today.tasks.type", 40),
    title: requireString(value.title, "today.tasks.title", 160),
    meta: optionalString(value.meta, "today.tasks.meta", 160),
    status,
    gua: optionalString(value.gua, "today.tasks.gua", 8),
  };
}

function validateToday(value, fallback) {
  if (value === null) return null;
  if (value === undefined) return fallback ? structuredClone(fallback) : null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlatformError("VALIDATION_ERROR", "today must be an object");
  const allowed = new Set(["completed", "total", "streak", "minutes", "tasks"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new PlatformError("VALIDATION_ERROR", `unknown today field: ${key}`);
  if (!Array.isArray(value.tasks) || value.tasks.length > 100) throw new PlatformError("VALIDATION_ERROR", "today.tasks is invalid");
  const numbers = ["completed", "total", "streak", "minutes"];
  for (const field of numbers) if (!Number.isInteger(value[field]) || value[field] < 0 || value[field] > 100000) throw new PlatformError("VALIDATION_ERROR", `today.${field} is invalid`);
  if (value.completed > value.total) throw new PlatformError("VALIDATION_ERROR", "today.completed cannot exceed today.total");
  return {
    completed: value.completed,
    total: value.total,
    streak: value.streak,
    minutes: value.minutes,
    tasks: value.tasks.map(validateTask),
  };
}

function validateReview(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlatformError("VALIDATION_ERROR", "pilot.review must be an object");
  const allowed = new Set(["evidence_used", "problem", "reason", "next_action"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new PlatformError("VALIDATION_ERROR", `unknown review field: ${key}`);
  return {
    evidence_used: requireString(value.evidence_used, "pilot.review.evidence_used", 1200),
    problem: requireString(value.problem, "pilot.review.problem", 500),
    reason: requireString(value.reason, "pilot.review.reason", 500),
    next_action: requireString(value.next_action, "pilot.review.next_action", 500),
  };
}

function validatePilot(value, fallback) {
  if (value === null) return null;
  if (value === undefined) return fallback ? structuredClone(fallback) : null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlatformError("VALIDATION_ERROR", "pilot must be an object");
  const allowed = new Set(["selected_evidence_level", "submitted_evidence", "selected_answer", "review", "review_ready"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new PlatformError("VALIDATION_ERROR", `unknown pilot field: ${key}`);
  if (!Number.isInteger(value.selected_evidence_level) || value.selected_evidence_level < 1 || value.selected_evidence_level > 4) {
    throw new PlatformError("VALIDATION_ERROR", "pilot.selected_evidence_level is invalid");
  }
  if (typeof value.review_ready !== "boolean") throw new PlatformError("VALIDATION_ERROR", "pilot.review_ready is invalid");
  return {
    selected_evidence_level: value.selected_evidence_level,
    submitted_evidence: optionalString(value.submitted_evidence, "pilot.submitted_evidence", 1200),
    selected_answer: optionalString(value.selected_answer, "pilot.selected_answer", 1000),
    review: validateReview(value.review),
    review_ready: value.review_ready,
  };
}

function validateKnowledgeNode(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlatformError("VALIDATION_ERROR", "knowledge nodes must contain objects");
  const allowed = new Set(["id", "title", "domain", "strand", "mastery", "state", "gua", "color", "source", "updated", "summary", "note", "related_ids", "position", "evidence_level"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new PlatformError("VALIDATION_ERROR", `unknown knowledge field: ${key}`);
  const state = requireString(value.state, "knowledge.state", 20);
  const color = requireString(value.color, "knowledge.color", 20);
  if (!KNOWLEDGE_STATES.has(state) || !KNOWLEDGE_COLORS.has(color)) throw new PlatformError("VALIDATION_ERROR", "knowledge state or color is invalid");
  if (!Number.isInteger(value.mastery) || value.mastery < 0 || value.mastery > 100) throw new PlatformError("VALIDATION_ERROR", "knowledge.mastery is invalid");
  if (!Array.isArray(value.related_ids) || value.related_ids.length > 50 || value.related_ids.some((id) => !SAFE_ID.test(id))) throw new PlatformError("VALIDATION_ERROR", "knowledge.related_ids is invalid");
  if (value.evidence_level !== undefined && (!Number.isInteger(value.evidence_level) || value.evidence_level < 1 || value.evidence_level > 4)) {
    throw new PlatformError("VALIDATION_ERROR", "knowledge.evidence_level is invalid");
  }
  return {
    id: requireId(value.id, "knowledge.id"),
    title: requireString(value.title, "knowledge.title", 160),
    domain: optionalString(value.domain, "knowledge.domain", 160),
    strand: optionalString(value.strand, "knowledge.strand", 160),
    mastery: value.mastery,
    state,
    gua: optionalString(value.gua, "knowledge.gua", 8),
    color,
    source: optionalString(value.source, "knowledge.source", 160),
    updated: optionalString(value.updated, "knowledge.updated", 80),
    summary: requireString(value.summary, "knowledge.summary", 1000),
    note: requireString(value.note, "knowledge.note", 1000),
    related_ids: [...new Set(value.related_ids)],
    position: optionalString(value.position, "knowledge.position", 40),
    ...(value.evidence_level === undefined ? {} : { evidence_level: value.evidence_level }),
  };
}

function validateState(value, fallback = initialState()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlatformError("VALIDATION_ERROR", "state must be an object");
  const allowed = new Set(["version", "profile", "goal_id", "guide_asset_id", "onboarding_completed", "today", "pilot", "knowledge"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new PlatformError("VALIDATION_ERROR", `unknown state field: ${key}`);
  if (value.version !== undefined && value.version !== STATE_VERSION) throw new PlatformError("VALIDATION_ERROR", "state.version is unsupported");
  const goalId = value.goal_id ?? fallback.goal_id;
  const guideAssetId = value.guide_asset_id ?? fallback.guide_asset_id;
  if (!GOAL_IDS.has(goalId)) throw new PlatformError("VALIDATION_ERROR", "goal_id is invalid");
  if (!GUIDE_ASSET_IDS.has(guideAssetId)) throw new PlatformError("VALIDATION_ERROR", "guide_asset_id is invalid");
  const onboardingCompleted = value.onboarding_completed ?? fallback.onboarding_completed;
  if (typeof onboardingCompleted !== "boolean") throw new PlatformError("VALIDATION_ERROR", "onboarding_completed is invalid");
  const knowledge = value.knowledge === undefined ? structuredClone(fallback.knowledge) : value.knowledge;
  if (!Array.isArray(knowledge) || knowledge.length > 500) throw new PlatformError("VALIDATION_ERROR", "knowledge is invalid");
  const normalized = {
    version: STATE_VERSION,
    profile: validateProfile(value.profile, fallback.profile),
    goal_id: goalId,
    guide_asset_id: guideAssetId,
    onboarding_completed: onboardingCompleted,
    today: validateToday(value.today, fallback.today),
    pilot: validatePilot(value.pilot, fallback.pilot),
    knowledge: knowledge.map(validateKnowledgeNode),
  };
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > STATE_MAX_BYTES) throw new PlatformError("VALIDATION_ERROR", "state is too large");
  return normalized;
}

function validateRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlatformError("VALIDATION_ERROR", "state request body must be an object");
  for (const key of Object.keys(input)) if (!new Set(["request_id", "state"]).has(key)) throw new PlatformError("VALIDATION_ERROR", `unknown field: ${key}`);
  if (!isValidRequestId(input.request_id)) throw new PlatformError("VALIDATION_ERROR", "request_id must be a UUID");
  return { request_id: input.request_id, state: input.state };
}

class UserStateService {
  constructor({ database, clock = () => Date.now() }) {
    this.database = database;
    this.clock = clock;
  }

  async getState(actorId, requestId) {
    const state = await this.database.get(profileKey(actorId));
    return { request_id: requestId, state: state ? structuredClone(state) : null };
  }

  async saveState(actorId, input, rawIdempotencyKey) {
    const request = validateRequest(input);
    const normalizedIdempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    const requestFingerprint = fingerprint(request.state);
    return this.database.transaction(async (database) => {
      const storageKey = idempotencyKey(actorId, normalizedIdempotencyKey);
      const existingIdempotency = await database.get(storageKey);
      if (existingIdempotency) {
        if (existingIdempotency.fingerprint !== requestFingerprint) throw new PlatformError("CONFLICT", "idempotency key was reused with a different request");
        return { response: existingIdempotency.response, replayed: true };
      }
      const current = await database.get(profileKey(actorId));
      const state = validateState(request.state, current ?? initialState());
      const response = { request_id: request.request_id, state: { ...state, updated_at: new Date(this.clock()).toISOString() } };
      await database.set(profileKey(actorId), response.state);
      await database.set(storageKey, { fingerprint: requestFingerprint, response, created_at: this.clock() });
      return { response, replayed: false };
    });
  }
}

module.exports = {
  GUIDE_ASSET_IDS,
  GOAL_IDS,
  UserStateService,
  initialState,
  validateState,
};
