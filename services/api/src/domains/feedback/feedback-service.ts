const { createHash } = require("node:crypto");
const { isValidRequestId } = require("../../platform/http/correlation-id.ts");
const { PlatformError } = require("../../platform/errors/error-catalog.ts");

const FEEDBACK_CATEGORIES = new Set(["bug", "idea", "account", "ai", "other"]);

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

function optionalEmail(value) {
  if (value === undefined || value === null || value === "") return "";
  const email = requireString(value, "contact_email", 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PlatformError("VALIDATION_ERROR", "contact_email is invalid");
  return email;
}

function normalizeIdempotencyKey(value) {
  if (typeof value !== "string" || value.length < 16 || value.length > 128 || !/^[A-Za-z0-9._~:-]+$/.test(value)) {
    throw new PlatformError("VALIDATION_ERROR", "Idempotency-Key is required and must be a safe 16-128 character value");
  }
  return value;
}

function validateFeedback(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlatformError("VALIDATION_ERROR", "feedback body must be an object");
  const allowed = new Set(["request_id", "category", "title", "detail", "contact_email"]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new PlatformError("VALIDATION_ERROR", `unknown field: ${key}`);
  if (!isValidRequestId(input.request_id)) throw new PlatformError("VALIDATION_ERROR", "request_id must be a UUID");
  if (!FEEDBACK_CATEGORIES.has(input.category)) throw new PlatformError("VALIDATION_ERROR", "category is invalid");
  return {
    request_id: input.request_id,
    category: input.category,
    title: requireString(input.title, "title", 120),
    detail: requireString(input.detail, "detail", 3000),
    contact_email: optionalEmail(input.contact_email),
  };
}

function idempotencyKey(actorId, key) {
  return `idempotency:${actorId}:feedback:${key}`;
}

function feedbackKey(actorId, id) {
  return `feedback:${actorId}:${id}`;
}

class FeedbackService {
  constructor({ database, clock = () => Date.now(), idGenerator = () => `feedback-${Date.now()}` }) {
    this.database = database;
    this.clock = clock;
    this.idGenerator = idGenerator;
  }

  async submit(actorId, input, rawIdempotencyKey) {
    const request = validateFeedback(input);
    const normalizedIdempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    const requestFingerprint = fingerprint(request);
    return this.database.transaction(async (database) => {
      const storageKey = idempotencyKey(actorId, normalizedIdempotencyKey);
      const existingIdempotency = await database.get(storageKey);
      if (existingIdempotency) {
        if (existingIdempotency.fingerprint !== requestFingerprint) throw new PlatformError("CONFLICT", "idempotency key was reused with a different request");
        return { response: existingIdempotency.response, replayed: true };
      }
      const createdAt = new Date(this.clock()).toISOString();
      const feedback = {
        id: this.idGenerator(),
        category: request.category,
        title: request.title,
        detail: request.detail,
        contact_email: request.contact_email,
        status: "received",
        created_at: createdAt,
      };
      const response = { request_id: request.request_id, feedback: { ...feedback } };
      await database.set(feedbackKey(actorId, feedback.id), feedback);
      await database.set(storageKey, { fingerprint: requestFingerprint, response, created_at: createdAt });
      return { response, replayed: false };
    });
  }
}

module.exports = {
  FEEDBACK_CATEGORIES,
  FeedbackService,
  validateFeedback,
};
