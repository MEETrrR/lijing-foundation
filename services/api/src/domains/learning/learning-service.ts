const crypto = require("node:crypto");
const { isValidRequestId } = require("../../platform/http/correlation-id.ts");
const { PlatformError } = require("../../platform/errors/error-catalog.ts");

const ATTEMPT_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;
const DEFAULT_PROGRESS = Object.freeze({
  account_level: 1,
  mastery_summary: { mastered: 0, review_due: 0 },
  energy: { current: 100, maximum: 100 },
});
const DEFAULT_QUESTIONS = Object.freeze({
  "limits-continuity-001": Object.freeze({
    content_version: "2026.09.1",
    accepted_answers: Object.freeze([
      "B",
      "不一定，可导性还需要更强的局部条件",
      "不一定，可导性还需要更强的局部条件。",
    ]),
  }),
});

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

function requireString(value, field, maximum) {
  if (typeof value !== "string") throw new PlatformError("VALIDATION_ERROR", `${field} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new PlatformError("VALIDATION_ERROR", `${field} is invalid`);
  return normalized;
}

function validateAttempt(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PlatformError("VALIDATION_ERROR", "attempt body must be an object");
  }
  const allowed = new Set(["request_id", "attempt_id", "question_id", "answer", "action"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new PlatformError("VALIDATION_ERROR", `unknown field: ${key}`);
  }
  if (!isValidRequestId(input.request_id)) throw new PlatformError("VALIDATION_ERROR", "request_id must be a UUID");
  const attemptId = requireString(input.attempt_id, "attempt_id", 100);
  const questionId = requireString(input.question_id, "question_id", 100);
  const answer = requireString(input.answer, "answer", 1000);
  if (!ATTEMPT_PATTERN.test(attemptId) || !ATTEMPT_PATTERN.test(questionId)) {
    throw new PlatformError("VALIDATION_ERROR", "attempt_id or question_id is invalid");
  }
  if (input.action !== "submit") throw new PlatformError("VALIDATION_ERROR", "action must be submit");
  return { request_id: input.request_id, attempt_id: attemptId, question_id: questionId, answer, action: "submit" };
}

function normalizeAnswer(value) {
  return value.normalize("NFKC").trim().replace(/[\s。.!！?？,，;；:：]/g, "").toLowerCase();
}

function initialProgress() {
  return structuredClone(DEFAULT_PROGRESS);
}

function progressKey(actorId) { return `learning:progress:${actorId}`; }
function attemptKey(actorId, attemptId) { return `learning:attempt:${actorId}:${attemptId}`; }
function idempotencyKey(actorId, route, key) { return `idempotency:${actorId}:${route}:${key}`; }

function normalizeIdempotencyKey(value) {
  if (typeof value !== "string" || value.length < 16 || value.length > 128 || !/^[A-Za-z0-9._~:-]+$/.test(value)) {
    throw new PlatformError("VALIDATION_ERROR", "Idempotency-Key is required and must be a safe 16-128 character value");
  }
  return value;
}

class LearningService {
  constructor({ database, questions = DEFAULT_QUESTIONS, clock = () => Date.now() }) {
    this.database = database;
    this.questions = questions;
    this.clock = clock;
  }

  async getProgress(actorId, requestId) {
    const progress = await this.database.get(progressKey(actorId)) ?? initialProgress();
    return { request_id: requestId, ...progress, mastery_summary: { ...progress.mastery_summary }, energy: { ...progress.energy } };
  }

  async recordAttempt(actorId, input, rawIdempotencyKey) {
    const request = validateAttempt(input);
    const normalizedIdempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    const requestFingerprint = fingerprint(request);
    return this.database.transaction(async (database) => {
      const idempotencyStorageKey = idempotencyKey(actorId, "learning.attempts", normalizedIdempotencyKey);
      const existingIdempotency = await database.get(idempotencyStorageKey);
      if (existingIdempotency) {
        if (existingIdempotency.fingerprint !== requestFingerprint) {
          throw new PlatformError("CONFLICT", "idempotency key was reused with a different request");
        }
        return { response: existingIdempotency.response, replayed: true };
      }

      const question = this.questions[request.question_id];
      if (!question) throw new PlatformError("VALIDATION_ERROR", "question_id is not available");
      const existingAttempt = await database.get(attemptKey(actorId, request.attempt_id));
      if (existingAttempt) {
        if (existingAttempt.fingerprint !== requestFingerprint) {
          throw new PlatformError("CONFLICT", "attempt_id was reused with a different request");
        }
        await database.set(idempotencyStorageKey, { fingerprint: requestFingerprint, response: existingAttempt.response, created_at: this.clock() });
        return { response: existingAttempt.response, replayed: true };
      }

      const progress = await database.get(progressKey(actorId)) ?? initialProgress();
      const correct = question.accepted_answers.some((candidate) => normalizeAnswer(candidate) === normalizeAnswer(request.answer));
      const nextProgress = {
        account_level: progress.account_level,
        mastery_summary: {
          mastered: progress.mastery_summary.mastered + (correct ? 1 : 0),
          review_due: Math.max(0, progress.mastery_summary.review_due + (correct ? 0 : 1)),
        },
        energy: {
          current: Math.max(0, progress.energy.current - 1),
          maximum: progress.energy.maximum,
        },
      };
      const response = {
        request_id: request.request_id,
        attempt_id: request.attempt_id,
        evaluation: { correct, content_version: question.content_version },
        settlement: {
          mastery_state: correct ? "MASTERED" : "REVIEW",
          reward_summary: {
            experience: correct ? 20 : 5,
            coins: correct ? 5 : 1,
            item_ids: [],
          },
          energy: {
            current: nextProgress.energy.current,
            maximum: nextProgress.energy.maximum,
            delta: -1,
          },
        },
      };
      const record = { fingerprint: requestFingerprint, response, created_at: this.clock(), actor_id: actorId };
      await database.set(progressKey(actorId), nextProgress);
      await database.set(attemptKey(actorId, request.attempt_id), record);
      await database.set(idempotencyStorageKey, { fingerprint: requestFingerprint, response, created_at: this.clock() });
      return { response, replayed: false };
    });
  }
}

module.exports = {
  DEFAULT_QUESTIONS,
  LearningService,
  stableStringify,
  validateAttempt,
};
