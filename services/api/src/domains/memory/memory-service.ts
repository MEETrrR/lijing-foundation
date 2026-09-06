const { createHash } = require("node:crypto");
const { isValidRequestId } = require("../../platform/http/correlation-id.ts");
const { PlatformError } = require("../../platform/errors/error-catalog.ts");

const MEMORY_SCOPES = new Set(["global", "goal-exam", "goal-skill", "goal-life"]);
const MEMORY_ACTIONS = new Set(["confirm", "reject", "edit"]);
const MEMORY_KINDS = new Set(["friction", "strategy"]);
const SAFE_ID = /^[A-Za-z0-9._:-]{1,120}$/;

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function fingerprint(value) {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

function requireString(value, field, maximum) {
  if (typeof value !== "string") throw new PlatformError("VALIDATION_ERROR", `${field} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new PlatformError("VALIDATION_ERROR", `${field} is invalid`);
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
  return `memory:profile:${actorId}`;
}

function idempotencyKey(actorId, route, key) {
  return `idempotency:${actorId}:${route}:${key}`;
}

function initialProfile() {
  return { version: 1, iterations: [], memories: [] };
}

function validateReview(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PlatformError("VALIDATION_ERROR", "review must be an object");
  }
  const allowed = new Set(["problem", "reason", "next_action"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new PlatformError("VALIDATION_ERROR", `unknown review field: ${key}`);
  }
  return {
    problem: requireString(value.problem, "review.problem", 500),
    reason: requireString(value.reason, "review.reason", 500),
    next_action: requireString(value.next_action, "review.next_action", 500),
  };
}

function validateIteration(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PlatformError("VALIDATION_ERROR", "iteration body must be an object");
  }
  const allowed = new Set(["request_id", "iteration_id", "goal_scope", "goal_title", "task_id", "evidence_level", "evidence", "review"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new PlatformError("VALIDATION_ERROR", `unknown field: ${key}`);
  }
  if (!isValidRequestId(input.request_id)) throw new PlatformError("VALIDATION_ERROR", "request_id must be a UUID");
  if (!MEMORY_SCOPES.has(input.goal_scope)) throw new PlatformError("VALIDATION_ERROR", "goal_scope is invalid");
  if (!Number.isInteger(input.evidence_level) || input.evidence_level < 1 || input.evidence_level > 4) {
    throw new PlatformError("VALIDATION_ERROR", "evidence_level must be an integer from 1 to 4");
  }
  return {
    request_id: input.request_id,
    iteration_id: requireId(input.iteration_id, "iteration_id"),
    goal_scope: input.goal_scope,
    goal_title: requireString(input.goal_title, "goal_title", 120),
    task_id: requireId(input.task_id, "task_id"),
    evidence_level: input.evidence_level,
    evidence: requireString(input.evidence, "evidence", 1200),
    review: validateReview(input.review),
  };
}

function validateFeedback(memoryId, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PlatformError("VALIDATION_ERROR", "memory feedback body must be an object");
  }
  const allowed = new Set(["request_id", "action", "content"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new PlatformError("VALIDATION_ERROR", `unknown field: ${key}`);
  }
  if (!isValidRequestId(input.request_id)) throw new PlatformError("VALIDATION_ERROR", "request_id must be a UUID");
  if (!MEMORY_ACTIONS.has(input.action)) throw new PlatformError("VALIDATION_ERROR", "action is invalid");
  const feedback = { request_id: input.request_id, memory_id: requireId(memoryId, "memory_id"), action: input.action };
  if (input.action === "edit") feedback.content = requireString(input.content, "content", 500);
  else if (input.content !== undefined) throw new PlatformError("VALIDATION_ERROR", "content is only allowed when action is edit");
  return feedback;
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "current";
}

function makeMemoryId(kind, request) {
  return `memory-${kind}-${request.goal_scope}-${slug(request.task_id)}`;
}

function confidenceFor(evidenceLevel, observationCount) {
  return Math.min(0.95, 0.35 + evidenceLevel * 0.08 + Math.max(0, observationCount - 1) * 0.1);
}

function createCandidate(kind, request, now, existing) {
  const content = kind === "friction"
    ? request.review.problem
    : request.review.next_action;
  const observationCount = (existing?.observation_count ?? 0) + 1;
  return {
    id: existing?.id ?? makeMemoryId(kind, request),
    kind,
    title: kind === "friction" ? "当前需要回望" : "已发现的下一步",
    content,
    scope: request.goal_scope,
    goal_title: request.goal_title,
    task_id: request.task_id,
    source: "learning_iteration",
    status: existing?.status === "active" ? "active" : "candidate",
    confidence: confidenceFor(request.evidence_level, observationCount),
    observation_count: observationCount,
    evidence_level: request.evidence_level,
    evidence_hash: fingerprint(request.evidence),
    first_observed_at: existing?.first_observed_at ?? now,
    last_observed_at: now,
    last_iteration_id: request.iteration_id,
    updated_at: now,
  };
}

function publicMemory(memory) {
  return {
    id: memory.id,
    kind: memory.kind,
    title: memory.title,
    content: memory.content,
    scope: memory.scope,
    goal_title: memory.goal_title,
    source: memory.source,
    status: memory.status,
    confidence: memory.confidence,
    observation_count: memory.observation_count,
    evidence_level: memory.evidence_level,
    first_observed_at: memory.first_observed_at,
    last_observed_at: memory.last_observed_at,
    last_iteration_id: memory.last_iteration_id,
    updated_at: memory.updated_at,
  };
}

function publicProfile(profile, requestId, scope) {
  const memories = profile.memories
    .filter((memory) => memory.status !== "rejected" && (!scope || memory.scope === scope || memory.scope === "global"))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
    .map(publicMemory);
  return { request_id: requestId, memories, iteration_count: profile.iterations.length };
}

class MemoryService {
  constructor({ database, clock = () => Date.now() }) {
    this.database = database;
    this.clock = clock;
  }

  async getMemories(actorId, requestId, scope) {
    if (scope !== undefined && !MEMORY_SCOPES.has(scope)) throw new PlatformError("VALIDATION_ERROR", "scope is invalid");
    const profile = await this.database.get(profileKey(actorId)) ?? initialProfile();
    return publicProfile(profile, requestId, scope);
  }

  async recordIteration(actorId, input, rawIdempotencyKey) {
    const request = validateIteration(input);
    const normalizedIdempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    const requestFingerprint = fingerprint(request);
    return this.database.transaction(async (database) => {
      const storageKey = idempotencyKey(actorId, "memory.iterations", normalizedIdempotencyKey);
      const existingIdempotency = await database.get(storageKey);
      if (existingIdempotency) {
        if (existingIdempotency.fingerprint !== requestFingerprint) throw new PlatformError("CONFLICT", "idempotency key was reused with a different request");
        return { response: existingIdempotency.response, replayed: true };
      }

      const profile = await database.get(profileKey(actorId)) ?? initialProfile();
      if (profile.iterations.some((iteration) => iteration.id === request.iteration_id)) {
        throw new PlatformError("CONFLICT", "iteration_id was already recorded");
      }
      const now = new Date(this.clock()).toISOString();
      const existingFriction = profile.memories.find((memory) => memory.id === makeMemoryId("friction", request));
      const existingStrategy = profile.memories.find((memory) => memory.id === makeMemoryId("strategy", request));
      const candidates = [
        createCandidate("friction", request, now, existingFriction?.status === "rejected" ? undefined : existingFriction),
        createCandidate("strategy", request, now, existingStrategy?.status === "rejected" ? undefined : existingStrategy),
      ];
      const rejectedIds = new Set(profile.memories.filter((memory) => memory.status === "rejected").map((memory) => memory.id));
      const memories = profile.memories.filter((memory) => !candidates.some((candidate) => candidate.id === memory.id));
      for (const candidate of candidates) if (!rejectedIds.has(candidate.id)) memories.push(candidate);
      const iteration = {
        id: request.iteration_id,
        goal_scope: request.goal_scope,
        goal_title: request.goal_title,
        task_id: request.task_id,
        evidence_level: request.evidence_level,
        evidence_hash: fingerprint(request.evidence),
        review: request.review,
        candidate_ids: candidates.filter((candidate) => !rejectedIds.has(candidate.id)).map((candidate) => candidate.id),
        created_at: now,
      };
      const nextProfile = {
        version: 1,
        iterations: [...profile.iterations, iteration].slice(-100),
        memories,
      };
      const response = {
        request_id: request.request_id,
        iteration_id: request.iteration_id,
        replayed: false,
        new_memory_count: candidates.filter((candidate) => !existingFriction && candidate.kind === "friction" || !existingStrategy && candidate.kind === "strategy").length,
        candidates: candidates.filter((candidate) => !rejectedIds.has(candidate.id)).map(publicMemory),
        memories: publicProfile(nextProfile, request.request_id, request.goal_scope).memories,
      };
      await database.set(profileKey(actorId), nextProfile);
      await database.set(storageKey, { fingerprint: requestFingerprint, response, created_at: now });
      return { response, replayed: false };
    });
  }

  async updateMemory(actorId, memoryId, input, rawIdempotencyKey) {
    const request = validateFeedback(memoryId, input);
    const normalizedIdempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    const requestFingerprint = fingerprint(request);
    return this.database.transaction(async (database) => {
      const storageKey = idempotencyKey(actorId, `memory.feedback.${request.memory_id}`, normalizedIdempotencyKey);
      const existingIdempotency = await database.get(storageKey);
      if (existingIdempotency) {
        if (existingIdempotency.fingerprint !== requestFingerprint) throw new PlatformError("CONFLICT", "idempotency key was reused with a different request");
        return { response: existingIdempotency.response, replayed: true };
      }
      const profile = await database.get(profileKey(actorId)) ?? initialProfile();
      const index = profile.memories.findIndex((memory) => memory.id === request.memory_id);
      if (index < 0) throw new PlatformError("NOT_FOUND", "memory was not found");
      const current = profile.memories[index];
      const now = new Date(this.clock()).toISOString();
      const next = { ...current, updated_at: now };
      if (request.action === "confirm") {
        next.status = "active";
        next.confidence = Math.max(current.confidence, 0.8);
        next.confirmed_at = now;
      } else if (request.action === "reject") {
        next.status = "rejected";
        next.rejected_at = now;
      } else {
        next.content = request.content;
        next.status = "active";
        next.confidence = Math.max(current.confidence, 0.8);
        next.edited_at = now;
      }
      const nextProfile = { ...profile, memories: profile.memories.with(index, next) };
      const response = { request_id: request.request_id, memory: publicMemory(next), memories: publicProfile(nextProfile, request.request_id).memories };
      await database.set(profileKey(actorId), nextProfile);
      await database.set(storageKey, { fingerprint: requestFingerprint, response, created_at: now });
      return { response, replayed: false };
    });
  }
}

module.exports = {
  MEMORY_SCOPES,
  MemoryService,
  validateFeedback,
  validateIteration,
};
