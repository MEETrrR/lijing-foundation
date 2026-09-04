const crypto = require("node:crypto");

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const W3C_TRACE_ID_PATTERN = /^[0-9a-f]{32}$/i;

function hasNonZeroHex(value: string): boolean {
  return /[1-9a-f]/i.test(value);
}

function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && UUID_V4_PATTERN.test(value) && hasNonZeroHex(value);
}

function isValidTraceId(value: unknown): value is string {
  return typeof value === "string" &&
    ((UUID_V4_PATTERN.test(value) && hasNonZeroHex(value)) ||
      (W3C_TRACE_ID_PATTERN.test(value) && hasNonZeroHex(value)));
}

function normalizeRequestId(value: unknown): string {
  return isValidRequestId(value) ? value : crypto.randomUUID();
}

function normalizeTraceId(value: unknown): string {
  return isValidTraceId(value) ? value : crypto.randomUUID();
}

module.exports = {
  isValidRequestId,
  isValidTraceId,
  normalizeRequestId,
  normalizeTraceId,
};
