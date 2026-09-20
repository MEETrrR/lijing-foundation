const crypto = require("node:crypto");
const { PlatformError } = require("../../platform/errors/error-catalog.ts");

const ACTION_ORIGINS = new Set(["route", "artifact_diagnosis", "recovery_template", "weekly_review"]);
const ACTION_STATUSES = new Set(["planned", "active", "stuck", "completed", "superseded", "skipped"]);
const SAFE_ID = /^[A-Za-z0-9._:-]{1,120}$/;

function currentActionKey(actorId, date) { return `companion:action:${actorId}:${date}`; }
function actionKey(actorId, actionId) { return `companion:action:${actorId}:record:${actionId}`; }
function idempotencyKey(actorId, route, key) { return `idempotency:${actorId}:${route}:${key}`; }

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value, Object.keys(value).sort()), "utf8").digest("hex");
}

function requireId(value, field) {
  if (typeof value !== "string" || !value.trim() || !SAFE_ID.test(value.trim())) throw new PlatformError("VALIDATION_ERROR", `${field} is invalid`);
  return value.trim();
}

function normalizeIdempotencyKey(value) {
  if (typeof value !== "string" || value.length < 16 || value.length > 128 || !/^[A-Za-z0-9._~:-]+$/.test(value)) {
    throw new PlatformError("VALIDATION_ERROR", "Idempotency-Key is required and must be a safe 16-128 character value");
  }
  return value;
}

function localDate(clock, timezone = "Asia/Shanghai") {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(clock())).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
    if (parts.year && parts.month && parts.day) return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    // Invalid account timezones use the stable UTC fallback.
  }
  return new Date(clock()).toISOString().slice(0, 10);
}

function publicAction(action) {
  if (!action) return null;
  return {
    id: action.id,
    version: action.version,
    cycle_id: action.cycle_id,
    route_id: action.route_id,
    origin: action.origin,
    status: action.status,
    title: action.title,
    reason: action.reason,
    diagnosis_ref: action.diagnosis_ref,
    artifact_refs: [...action.artifact_refs],
    estimated_minutes: action.estimated_minutes,
    expected_evidence: action.expected_evidence,
    created_at: action.created_at,
    updated_at: action.updated_at,
  };
}

function validateActionPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new PlatformError("VALIDATION_ERROR", "companion action must be an object");
  if (!ACTION_ORIGINS.has(payload.origin)) throw new PlatformError("VALIDATION_ERROR", "action origin is invalid");
  const title = String(payload.title ?? "").trim();
  const reason = String(payload.reason ?? "").trim();
  const expectedEvidence = String(payload.expected_evidence ?? "").trim();
  if (!title || title.length > 160 || !reason || reason.length > 300 || !expectedEvidence || expectedEvidence.length > 300) throw new PlatformError("VALIDATION_ERROR", "action text is invalid");
  if (!Number.isInteger(payload.estimated_minutes) || payload.estimated_minutes < 5 || payload.estimated_minutes > 30) throw new PlatformError("VALIDATION_ERROR", "estimated_minutes must be an integer from 5 to 30");
  if (!Array.isArray(payload.artifact_refs) || payload.artifact_refs.length > 8 || payload.artifact_refs.some((value) => typeof value !== "string" || !SAFE_ID.test(value))) throw new PlatformError("VALIDATION_ERROR", "artifact_refs is invalid");
  return {
    route_id: payload.route_id ?? null,
    origin: payload.origin,
    title,
    reason,
    diagnosis_ref: payload.diagnosis_ref ?? null,
    artifact_refs: [...new Set(payload.artifact_refs)],
    estimated_minutes: payload.estimated_minutes,
    expected_evidence: expectedEvidence,
  };
}

class CompanionActionService {
  constructor({ database, artifacts = null, clock = () => Date.now() }) {
    this.database = database;
    this.artifacts = artifacts;
    this.clock = clock;
  }

  dateForState(profile = {}) { return localDate(this.clock, profile.timezone || "Asia/Shanghai"); }

  async getCurrent(actorId, date) {
    const action = await this.database.get(currentActionKey(actorId, date));
    return action ? publicAction(action) : null;
  }

  async getCurrentStored(actorId, date, database = this.database) {
    return database.get(currentActionKey(actorId, date));
  }

  async createInDatabase(database, actorId, date, payload, now = new Date(this.clock()).toISOString()) {
    const normalized = validateActionPayload(payload);
    const current = await database.get(currentActionKey(actorId, date));
    if (current && !["completed", "superseded", "skipped"].includes(current.status)) {
      await database.set(actionKey(actorId, current.id), { ...current, status: "superseded", updated_at: now });
    }
    const action = {
      id: `action-${crypto.randomUUID()}`,
      version: (current?.version ?? 0) + 1,
      cycle_id: `cycle-${date}`,
      actor_id: actorId,
      date,
      ...normalized,
      status: "planned",
      created_at: now,
      updated_at: now,
    };
    await database.set(actionKey(actorId, action.id), action);
    await database.set(currentActionKey(actorId, date), action);
    return action;
  }

  async transitionInDatabase(database, actorId, date, actionId, expectedVersion, intent, blockerType = null, now = new Date(this.clock()).toISOString()) {
    const current = await database.get(currentActionKey(actorId, date));
    if (!current || current.id !== actionId) throw new PlatformError("ACTION_VERSION_CONFLICT", "the current learning action has changed", { metadata: { action: current ? publicAction(current) : null } });
    if (current.version !== expectedVersion) throw new PlatformError("ACTION_VERSION_CONFLICT", "the learning action version is stale", { metadata: { action: publicAction(current) } });
    if (["completed", "superseded", "skipped"].includes(current.status)) throw new PlatformError("CONFLICT", "the learning action is already terminal");
    if (intent === "complete") throw new PlatformError("VALIDATION_ERROR", "complete actions require evidence");
    if (!["start", "stuck", "skip"].includes(intent)) throw new PlatformError("VALIDATION_ERROR", "action intent is invalid");
    const status = intent === "start" ? "active" : intent === "stuck" ? "stuck" : "skipped";
    const next = { ...current, status, blocker_type: blockerType, updated_at: now, ...(intent === "start" ? { started_at: current.started_at ?? now } : {}), ...(intent === "skip" ? { skipped_at: now } : {}) };
    await database.set(actionKey(actorId, next.id), next);
    if (intent === "skip") {
      return this.createInDatabase(database, actorId, date, {
        origin: "recovery_template",
        route_id: current.route_id,
        diagnosis_ref: current.diagnosis_ref,
        artifact_refs: current.artifact_refs,
        title: "把刚才的卡点缩成一个 5 分钟起步动作",
        reason: blockerType ? `已记录卡住原因：${blockerType}。下一次只处理一个最小步骤。` : "先把原任务缩小，避免用一次跳过代表放弃整个主题。",
        estimated_minutes: 5,
        expected_evidence: "提交一句你已经明确的条件、定义或第一步。",
      }, now);
    }
    await database.set(currentActionKey(actorId, date), next);
    return next;
  }

  async transition(actorId, date, input, rawIdempotencyKey) {
    const idem = normalizeIdempotencyKey(rawIdempotencyKey);
    const request = { request_id: input.request_id, action_id: requireId(input.action_id, "action_id"), action_version: input.action_version, intent: input.intent, blocker_type: input.blocker_type ?? null };
    if (!Number.isInteger(request.action_version) || request.action_version < 1) throw new PlatformError("VALIDATION_ERROR", "action_version is invalid");
    const requestFingerprint = fingerprint(request);
    return this.database.transaction(async (database) => {
      const replayKey = idempotencyKey(actorId, "companion.actions", idem);
      const replay = await database.get(replayKey);
      if (replay) {
        if (replay.fingerprint !== requestFingerprint) throw new PlatformError("CONFLICT", "idempotency key was reused with a different action request");
        return { response: replay.response, replayed: true };
      }
      const next = await this.transitionInDatabase(database, actorId, date, request.action_id, request.action_version, request.intent, request.blocker_type);
      const response = { request_id: request.request_id, action: publicAction(next), screen_state: next.status === "planned" ? "next_action_ready" : "action_active", replayed: false };
      await database.set(replayKey, { fingerprint: requestFingerprint, response });
      return { response, replayed: false };
    });
  }

  async completeInDatabase(database, actorId, date, actionId, expectedVersion, evidence, evidenceLevel, attemptId, now = new Date(this.clock()).toISOString()) {
    const current = await database.get(currentActionKey(actorId, date));
    if (!current || current.id !== actionId) throw new PlatformError("ACTION_VERSION_CONFLICT", "the current learning action has changed", { metadata: { action: current ? publicAction(current) : null } });
    if (current.version !== expectedVersion) throw new PlatformError("ACTION_VERSION_CONFLICT", "the learning action version is stale", { metadata: { action: publicAction(current) } });
    if (["completed", "superseded", "skipped"].includes(current.status)) throw new PlatformError("CONFLICT", "the learning action is already terminal");
    const completed = {
      ...current,
      status: "completed",
      evidence_hash: crypto.createHash("sha256").update(evidence, "utf8").digest("hex"),
      evidence_level: evidenceLevel,
      attempt_id: attemptId ?? null,
      completed_at: now,
      updated_at: now,
    };
    await database.set(actionKey(actorId, completed.id), completed);
    const next = await this.createInDatabase(database, actorId, date, {
      origin: "recovery_template",
      route_id: current.route_id,
      diagnosis_ref: current.diagnosis_ref,
      artifact_refs: current.artifact_refs,
      title: "用一个反例或三句话复述刚才的判断",
      reason: "这次证据已经记录，下一步用更小的输出验证你能否迁移这个判断。",
      estimated_minutes: 10,
      expected_evidence: "提交一个反例，或用三句话复述条件、结论和原因。",
    }, now);
    return { completed, next };
  }

  async completeEvidence(actorId, date, input, rawIdempotencyKey) {
    const idem = normalizeIdempotencyKey(rawIdempotencyKey);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlatformError("VALIDATION_ERROR", "action evidence body must be an object");
    const allowed = new Set(["request_id", "action_id", "action_version", "attempt_id", "evidence", "evidence_level"]);
    for (const key of Object.keys(input)) if (!allowed.has(key)) throw new PlatformError("VALIDATION_ERROR", `unknown action evidence field: ${key}`);
    if (typeof input.request_id !== "string" || !input.request_id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) throw new PlatformError("VALIDATION_ERROR", "request_id must be a UUID");
    const actionId = requireId(input.action_id, "action_id");
    if (!Number.isInteger(input.action_version) || input.action_version < 1) throw new PlatformError("VALIDATION_ERROR", "action_version is invalid");
    if (typeof input.evidence !== "string" || input.evidence.trim().length < 1 || input.evidence.length > 1200) throw new PlatformError("VALIDATION_ERROR", "evidence is invalid");
    if (!Number.isInteger(input.evidence_level) || input.evidence_level < 1 || input.evidence_level > 4) throw new PlatformError("VALIDATION_ERROR", "evidence_level is invalid");
    const request = { request_id: input.request_id, action_id: actionId, action_version: input.action_version, attempt_id: input.attempt_id ?? null, evidence: input.evidence.trim(), evidence_level: input.evidence_level };
    const requestFingerprint = fingerprint(request);
    return this.database.transaction(async (database) => {
      const replayKey = idempotencyKey(actorId, "companion.action-evidence", idem);
      const replay = await database.get(replayKey);
      if (replay) {
        if (replay.fingerprint !== requestFingerprint) throw new PlatformError("CONFLICT", "idempotency key was reused with a different evidence request");
        return { response: replay.response, replayed: true };
      }
      if (request.attempt_id && this.artifacts) {
        const current = await this.getCurrentStored(actorId, date, database);
        if (!current || current.id !== actionId) throw new PlatformError("ACTION_VERSION_CONFLICT", "the current learning action has changed", { metadata: { action: current ? publicAction(current) : null } });
        if (current.version !== request.action_version) throw new PlatformError("ACTION_VERSION_CONFLICT", "the learning action version is stale", { metadata: { action: publicAction(current) } });
        const attempt = await this.artifacts.getAttempt(actorId, request.attempt_id, database);
        if (attempt.action_id && attempt.action_id !== actionId) throw new PlatformError("VALIDATION_ERROR", "attempt does not belong to the current learning action");
        if (attempt.action_version !== null && attempt.action_version !== undefined && attempt.action_version !== request.action_version) throw new PlatformError("VALIDATION_ERROR", "attempt action version does not match the current learning action");
        const currentArtifactIds = new Set(current.artifact_refs);
        if (attempt.artifact_ids.some((artifactId) => !currentArtifactIds.has(artifactId))) throw new PlatformError("VALIDATION_ERROR", "attempt cites material outside the current learning action");
      }
      const result = await this.completeInDatabase(database, actorId, date, actionId, request.action_version, request.evidence, request.evidence_level, request.attempt_id);
      const response = { request_id: request.request_id, action: publicAction(result.completed), next_action: publicAction(result.next), screen_state: "next_action_ready", replayed: false };
      await database.set(replayKey, { fingerprint: requestFingerprint, response });
      return { response, replayed: false };
    });
  }
}

module.exports = {
  ACTION_ORIGINS,
  ACTION_STATUSES,
  CompanionActionService,
  localDate,
  publicAction,
};
