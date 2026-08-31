const crypto = require("node:crypto");

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const W3C_TRACE_ID_PATTERN = /^[0-9a-f]{32}$/i;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;

function hasNonZeroHex(value) {
  return /[1-9a-f]/i.test(value);
}

function normalizeRequestId(value) {
  if (typeof value === "string" && UUID_V4_PATTERN.test(value.trim()) && hasNonZeroHex(value.trim())) return value.trim();
  return crypto.randomUUID();
}

function normalizeTraceId(value) {
  if (typeof value !== "string") return crypto.randomUUID();
  const normalized = value.trim();
  if (UUID_V4_PATTERN.test(normalized) && hasNonZeroHex(normalized)) return normalized;
  if (W3C_TRACE_ID_PATTERN.test(normalized) && hasNonZeroHex(normalized)) return normalized;
  return crypto.randomUUID();
}

function normalizeClientVersion(value) {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim();
  if (!normalized || normalized.length > 64 || /[\r\n]/.test(normalized)) return "unknown";
  if (/bearer\s|authorization|password|secret|token|cookie|conversation|prompt|response|sk-[a-z0-9]/i.test(normalized)) return "unknown";
  if (!/^[A-Za-z0-9][A-Za-z0-9._+/-]*$/.test(normalized)) return "unknown";
  return normalized;
}

function anonymizeDeviceFingerprint(value, hashKey = "lijing-device-fingerprint-v1") {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  return `sha256:${crypto.createHmac("sha256", String(hashKey)).update(value.trim(), "utf8").digest("hex")}`;
}

function safeIdentifier(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || /^\+?\d{7,15}$/.test(normalized)) return undefined;
  if (/\d{7,15}/.test(normalized)) return undefined;
  if (/bearer\s|authorization|password|secret|token|cookie|conversation|prompt|response|sk-[a-z0-9]/i.test(normalized)) {
    return undefined;
  }
  return SAFE_IDENTIFIER_PATTERN.test(normalized) ? normalized : undefined;
}

class RequestContext {
  constructor({ traceId, requestId, clientVersion, deviceIdHash, actorId }) {
    this.traceId = normalizeTraceId(traceId);
    this.requestId = normalizeRequestId(requestId);
    this.clientVersion = clientVersion;
    this.deviceIdHash = deviceIdHash;
    this.actorId = actorId;
  }

  toSafeLogFields() {
    const fields = {
      trace_id: this.traceId,
      request_id: this.requestId,
      client_version: this.clientVersion,
    };
    if (this.deviceIdHash) fields.device_id_hash = this.deviceIdHash;
    const actorId = safeIdentifier(this.actorId);
    if (actorId) fields.actor_id = actorId;
    return fields;
  }
}

function createRequestContext(input = {}, options = {}) {
  const source = input ?? {};
  return new RequestContext({
    traceId: source.traceId ?? source.trace_id,
    requestId: source.requestId ?? source.request_id,
    clientVersion: normalizeClientVersion(source.clientVersion ?? source.client_version),
    deviceIdHash: anonymizeDeviceFingerprint(
      source.deviceFingerprint ?? source.device_fingerprint,
      options.deviceHashKey,
    ),
    actorId: source.actorId ?? source.actor_id,
  });
}

module.exports = {
  RequestContext,
  anonymizeDeviceFingerprint,
  createRequestContext,
};
