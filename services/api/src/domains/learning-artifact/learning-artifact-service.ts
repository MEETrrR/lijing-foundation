const crypto = require("node:crypto");
const { isValidRequestId } = require("../../platform/http/correlation-id.ts");
const { PlatformError } = require("../../platform/errors/error-catalog.ts");

const ARTIFACT_KINDS = new Set(["question", "note", "attempt_draft", "answer_reference", "plan_outline"]);
const ATTEMPT_KINDS = new Set(["work_log", "answer", "retry", "reflection"]);
const SAFE_ID = /^[A-Za-z0-9._:-]{1,120}$/;
const MAX_ARTIFACT_TEXT = 12000;
const MAX_ATTEMPT_TEXT = 6000;

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

function normalizeIdempotencyKey(value) {
  if (typeof value !== "string" || value.length < 16 || value.length > 128 || !/^[A-Za-z0-9._~:-]+$/.test(value)) {
    throw new PlatformError("VALIDATION_ERROR", "Idempotency-Key is required and must be a safe 16-128 character value");
  }
  return value;
}

function requireString(value, field, maximum, minimum = 1) {
  if (typeof value !== "string") throw new PlatformError("VALIDATION_ERROR", `${field} must be a string`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) throw new PlatformError("VALIDATION_ERROR", `${field} must contain ${minimum}-${maximum} characters`);
  return normalized;
}

function requireId(value, field) {
  const normalized = requireString(value, field, 120);
  if (!SAFE_ID.test(normalized)) throw new PlatformError("VALIDATION_ERROR", `${field} is invalid`);
  return normalized;
}

function artifactKey(actorId, artifactId) { return `learning:artifact:${actorId}:${artifactId}`; }
function artifactIndexKey(actorId) { return `learning:artifact:index:${actorId}`; }
function attemptKey(actorId, attemptId) { return `learning:attempt:material:${actorId}:${attemptId}`; }
function idempotencyKey(actorId, route, key) { return `idempotency:${actorId}:${route}:${key}`; }

function tokenSet(value) {
  const normalized = String(value ?? "").toLowerCase();
  const tokens = new Set(normalized.match(/[a-z0-9]{2,}|[\u4e00-\u9fff]/g) ?? []);
  for (const segment of normalized.match(/[\u4e00-\u9fff]+/g) ?? []) {
    for (let index = 0; index < segment.length - 1; index += 1) tokens.add(segment.slice(index, index + 2));
  }
  return tokens;
}

function chunkText(text, size = 640) {
  const chunks = [];
  for (let start = 0; start < text.length; start += size) {
    const end = Math.min(text.length, start + size);
    chunks.push({ id: `chunk-${chunks.length + 1}`, start, end, text: text.slice(start, end) });
  }
  return chunks;
}

function validateArtifact(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlatformError("VALIDATION_ERROR", "learning artifact body must be an object");
  const allowed = new Set(["request_id", "artifact_id", "kind", "subject", "source_title", "content_text"]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new PlatformError("VALIDATION_ERROR", `unknown learning artifact field: ${key}`);
  if (!isValidRequestId(input.request_id)) throw new PlatformError("VALIDATION_ERROR", "request_id must be a UUID");
  const artifactId = input.artifact_id === undefined ? `artifact-${crypto.randomUUID()}` : requireId(input.artifact_id, "artifact_id");
  if (!ARTIFACT_KINDS.has(input.kind)) throw new PlatformError("VALIDATION_ERROR", "kind is invalid");
  return {
    request_id: input.request_id,
    artifact_id: artifactId,
    kind: input.kind,
    subject: requireString(input.subject, "subject", 80),
    source_title: requireString(input.source_title, "source_title", 160),
    content_text: requireString(input.content_text, "content_text", MAX_ARTIFACT_TEXT, 12),
  };
}

function validateAttempt(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlatformError("VALIDATION_ERROR", "learning attempt body must be an object");
  const allowed = new Set(["request_id", "attempt_id", "artifact_ids", "action_id", "action_version", "kind", "content", "self_report", "elapsed_minutes"]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new PlatformError("VALIDATION_ERROR", `unknown learning attempt field: ${key}`);
  if (!isValidRequestId(input.request_id)) throw new PlatformError("VALIDATION_ERROR", "request_id must be a UUID");
  const artifactIds = input.artifact_ids;
  if (!Array.isArray(artifactIds) || artifactIds.length < 1 || artifactIds.length > 8) throw new PlatformError("VALIDATION_ERROR", "artifact_ids must contain 1-8 entries");
  const normalizedArtifactIds = [...new Set(artifactIds.map((value) => requireId(value, "artifact_id")))];
  const attemptId = input.attempt_id === undefined ? `attempt-${crypto.randomUUID()}` : requireId(input.attempt_id, "attempt_id");
  if (!ATTEMPT_KINDS.has(input.kind)) throw new PlatformError("VALIDATION_ERROR", "attempt kind is invalid");
  const actionId = input.action_id === undefined || input.action_id === null || input.action_id === "" ? null : requireId(input.action_id, "action_id");
  const actionVersion = input.action_version === undefined || input.action_version === null ? null : input.action_version;
  if (actionVersion !== null && (!Number.isInteger(actionVersion) || actionVersion < 1)) throw new PlatformError("VALIDATION_ERROR", "action_version is invalid");
  const elapsedMinutes = input.elapsed_minutes === undefined || input.elapsed_minutes === null ? null : input.elapsed_minutes;
  if (elapsedMinutes !== null && (!Number.isInteger(elapsedMinutes) || elapsedMinutes < 0 || elapsedMinutes > 1440)) throw new PlatformError("VALIDATION_ERROR", "elapsed_minutes is invalid");
  const selfReport = input.self_report === undefined || input.self_report === null || input.self_report === "" ? "needs_check" : input.self_report;
  if (!["completed", "stuck", "needs_check"].includes(selfReport)) throw new PlatformError("VALIDATION_ERROR", "self_report is invalid");
  return {
    request_id: input.request_id,
    attempt_id: attemptId,
    artifact_ids: normalizedArtifactIds,
    action_id: actionId,
    action_version: actionVersion,
    kind: input.kind,
    content: requireString(input.content, "content", MAX_ATTEMPT_TEXT, 1),
    self_report: selfReport,
    elapsed_minutes: elapsedMinutes,
  };
}

function publicArtifact(artifact) {
  return {
    id: artifact.id,
    kind: artifact.kind,
    subject: artifact.subject,
    source_title: artifact.source_title,
    content_text: artifact.content_text,
    processing_status: artifact.processing_status,
    summary: artifact.summary,
    created_at: artifact.created_at,
    updated_at: artifact.updated_at,
  };
}

function publicAttempt(attempt) {
  return {
    id: attempt.id,
    artifact_ids: [...attempt.artifact_ids],
    action_id: attempt.action_id,
    action_version: attempt.action_version,
    kind: attempt.kind,
    content: attempt.content,
    self_report: attempt.self_report,
    elapsed_minutes: attempt.elapsed_minutes,
    created_at: attempt.created_at,
  };
}

class LearningArtifactService {
  constructor({ database, clock = () => Date.now() }) {
    this.database = database;
    this.clock = clock;
  }

  async createArtifact(actorId, input, rawIdempotencyKey) {
    const request = validateArtifact(input);
    const idem = normalizeIdempotencyKey(rawIdempotencyKey);
    const requestFingerprint = fingerprint(request);
    return this.database.transaction(async (database) => {
      const replayKey = idempotencyKey(actorId, "learning-artifacts", idem);
      const replay = await database.get(replayKey);
      if (replay) {
        if (replay.fingerprint !== requestFingerprint) throw new PlatformError("CONFLICT", "idempotency key was reused with a different artifact request");
        return { response: replay.response, replayed: true };
      }
      const existing = await database.get(artifactKey(actorId, request.artifact_id));
      if (existing) {
        if (existing.fingerprint !== requestFingerprint) throw new PlatformError("CONFLICT", "artifact_id was reused with a different request");
        const response = { request_id: request.request_id, artifact: publicArtifact(existing.artifact), replayed: true };
        await database.set(replayKey, { fingerprint: requestFingerprint, response });
        return { response, replayed: true };
      }
      const now = new Date(this.clock()).toISOString();
      const artifact = {
        id: request.artifact_id,
        actor_id: actorId,
        kind: request.kind,
        subject: request.subject,
        source_title: request.source_title,
        content_text: request.content_text,
        processing_status: "ready",
        summary: {
          topic_labels: [request.subject],
          extracted_text_version: "text-v1",
          confidence: 1,
        },
        chunks: chunkText(request.content_text),
        created_at: now,
        updated_at: now,
        fingerprint: requestFingerprint,
      };
      const index = await database.get(artifactIndexKey(actorId)) ?? [];
      const response = { request_id: request.request_id, artifact: publicArtifact(artifact), replayed: false };
      await database.set(artifactKey(actorId, artifact.id), artifact);
      await database.set(artifactIndexKey(actorId), [...new Set([...index, artifact.id])].slice(-200));
      await database.set(replayKey, { fingerprint: requestFingerprint, response });
      return { response, replayed: false };
    });
  }

  async getArtifact(actorId, artifactId) {
    const id = requireId(artifactId, "artifact_id");
    const artifact = await this.database.get(artifactKey(actorId, id));
    if (!artifact) throw new PlatformError("NOT_FOUND", "learning artifact was not found");
    return publicArtifact(artifact);
  }

  async getStoredArtifact(actorId, artifactId, database = this.database) {
    const id = requireId(artifactId, "artifact_id");
    const artifact = await database.get(artifactKey(actorId, id));
    if (!artifact) throw new PlatformError("NOT_FOUND", "learning artifact was not found");
    return artifact;
  }

  async listArtifacts(actorId, limit = 20) {
    const ids = await this.database.get(artifactIndexKey(actorId)) ?? [];
    const artifacts = [];
    for (const id of ids.slice(-Math.min(50, Math.max(1, Number(limit) || 20))).reverse()) {
      const artifact = await this.database.get(artifactKey(actorId, id));
      if (artifact) artifacts.push(publicArtifact(artifact));
    }
    return artifacts;
  }

  async search(actorId, { query = "", artifactIds = [], limit = 8 } = {}, database = this.database) {
    const ids = artifactIds.length ? [...new Set(artifactIds.map((id) => requireId(id, "artifact_id")))] : await database.get(artifactIndexKey(actorId)) ?? [];
    const queryTokens = tokenSet(query);
    const results = [];
    for (const id of ids.slice(-50)) {
      const artifact = await this.getStoredArtifact(actorId, id, database);
      for (const chunk of artifact.chunks ?? []) {
        const corpusTokens = tokenSet(`${artifact.source_title} ${artifact.subject} ${chunk.text}`);
        const overlap = [...queryTokens].filter((token) => corpusTokens.has(token)).length;
        const score = queryTokens.size === 0 ? 1 : Number((overlap / queryTokens.size + (chunk.text.includes(String(query).trim()) && String(query).trim().length >= 4 ? 0.35 : 0)).toFixed(6));
        if (score > 0 || queryTokens.size === 0) {
          results.push({
            evidence_type: "private_material",
            artifact_id: artifact.id,
            chunk_id: chunk.id,
            title: artifact.source_title,
            subject: artifact.subject,
            excerpt: chunk.text,
            locator: { start: chunk.start, end: chunk.end },
            score,
          });
        }
      }
    }
    return results.sort((left, right) => right.score - left.score || left.artifact_id.localeCompare(right.artifact_id)).slice(0, Math.min(12, Math.max(1, Number(limit) || 8)));
  }

  async recordAttempt(actorId, input, rawIdempotencyKey) {
    const request = validateAttempt(input);
    const idem = normalizeIdempotencyKey(rawIdempotencyKey);
    const requestFingerprint = fingerprint(request);
    return this.database.transaction(async (database) => {
      const replayKey = idempotencyKey(actorId, "learning-attempts", idem);
      const replay = await database.get(replayKey);
      if (replay) {
        if (replay.fingerprint !== requestFingerprint) throw new PlatformError("CONFLICT", "idempotency key was reused with a different attempt request");
        return { response: replay.response, replayed: true };
      }
      for (const artifactId of request.artifact_ids) await this.getStoredArtifact(actorId, artifactId, database);
      const existing = await database.get(attemptKey(actorId, request.attempt_id));
      if (existing) {
        if (existing.fingerprint !== requestFingerprint) throw new PlatformError("CONFLICT", "attempt_id was reused with a different request");
        const response = { request_id: request.request_id, attempt: publicAttempt(existing.attempt), replayed: true };
        await database.set(replayKey, { fingerprint: requestFingerprint, response });
        return { response, replayed: true };
      }
      const attempt = { ...request, id: request.attempt_id, actor_id: actorId, created_at: new Date(this.clock()).toISOString(), fingerprint: requestFingerprint };
      const response = { request_id: request.request_id, attempt: publicAttempt(attempt), replayed: false };
      await database.set(attemptKey(actorId, attempt.id), attempt);
      await database.set(replayKey, { fingerprint: requestFingerprint, response });
      return { response, replayed: false };
    });
  }

  async getAttempt(actorId, attemptId, database = this.database) {
    const attempt = await database.get(attemptKey(actorId, requireId(attemptId, "attempt_id")));
    if (!attempt) throw new PlatformError("NOT_FOUND", "learning attempt was not found");
    return publicAttempt(attempt);
  }
}

module.exports = {
  ARTIFACT_KINDS,
  LearningArtifactService,
  MAX_ARTIFACT_TEXT,
  MAX_ATTEMPT_TEXT,
  tokenSet,
  validateArtifact,
  validateAttempt,
};
