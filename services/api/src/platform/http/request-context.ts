const crypto = require("node:crypto");
const { normalizeRequestId, normalizeTraceId } = require("./correlation-id.ts");

const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const CLIENT_VERSION_PATTERN = /^[A-Za-z0-9]+(?:[._+-][A-Za-z0-9]+)*$/;
const DEVICE_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

function normalizeClientVersion(value) {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim();
  if (!normalized || normalized.length > 64 || /[\r\n]/.test(normalized)) return "unknown";
  if (/bearer\s|authorization|password|secret|token|cookie|conversation|prompt|response|sk-[a-z0-9]/i.test(normalized)) return "unknown";
  if (!CLIENT_VERSION_PATTERN.test(normalized)) return "unknown";
  return normalized;
}

function normalizeDeviceIdHash(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return DEVICE_HASH_PATTERN.test(normalized) ? normalized : undefined;
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
    this.clientVersion = normalizeClientVersion(clientVersion);
    this.deviceIdHash = normalizeDeviceIdHash(deviceIdHash);
    this.actorId = actorId;
  }

  toSafeLogFields() {
    const fields = {
      trace_id: this.traceId,
      request_id: this.requestId,
      client_version: normalizeClientVersion(this.clientVersion),
    };
    const deviceIdHash = normalizeDeviceIdHash(this.deviceIdHash);
    if (deviceIdHash) fields.device_id_hash = deviceIdHash;
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
