const crypto = require("node:crypto");

const SENSITIVE_LABEL_KEYS = /authorization|cookie|password|token|secret|credential|api[_-]?key|phone|mobile|prompt|response|conversation|body|content|url|query/i;
const EMAIL_VALUE_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SECRET_VALUE_PATTERN = /bearer(?:\s|$)|authorization|password|secret|token|credential|api[_-]?key|-----BEGIN|sk-[a-z0-9]/i;
const IDENTIFIER_VALUE_PATTERN = /(?:^|[-_.:])(account|actor|device|member|user|phone|email)(?:[-_.:]|$)/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const W3C_TRACE_ID_PATTERN = /^[0-9a-f]{32}$/i;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_SLUG_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/i;
const ROUTE_PATTERN = /^\/(?:api\/v[1-9][0-9]*|internal)(?:\/(?:[a-z][a-z0-9_-]*|\{[a-z][a-z0-9_]*\}|:[a-z][a-z0-9_]*))*$/i;
const VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){1,3}(?:[-+][a-z0-9.-]+)?$/i;
const ALLOWED_LABEL_KEYS = new Set([
  "environment",
  "service",
  "route",
  "method",
  "outcome",
  "status_code",
  "dependency",
  "feature",
  "model",
  "policy_version",
  "reason_code",
  "client_version",
  "app_version",
  "transport",
  "queue",
  "operation",
  "event_type",
  "cache_hit",
  "degraded",
  "source",
  "result_code",
  "budget_id",
  "direction",
  "platform",
]);

const DIMENSION_VALIDATORS = Object.freeze({
  environment: (value) => /^(local|staging|production)$/.test(value),
  service: (value) => SAFE_SLUG_PATTERN.test(value),
  route: (value) => ROUTE_PATTERN.test(value),
  method: (value) => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(value.toUpperCase()),
  outcome: (value) => SAFE_SLUG_PATTERN.test(value),
  status_code: (value) => /^[1-5][0-9]{2}$/.test(value),
  dependency: (value) => SAFE_SLUG_PATTERN.test(value),
  feature: (value) => SAFE_SLUG_PATTERN.test(value),
  model: (value) => SAFE_SLUG_PATTERN.test(value),
  policy_version: (value) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]{1,8}$/.test(value),
  reason_code: (value) => SAFE_SLUG_PATTERN.test(value),
  client_version: (value) => VERSION_PATTERN.test(value) || value === "unknown",
  app_version: (value) => VERSION_PATTERN.test(value) || value === "unknown",
  transport: (value) => SAFE_SLUG_PATTERN.test(value),
  queue: (value) => SAFE_SLUG_PATTERN.test(value),
  operation: (value) => SAFE_SLUG_PATTERN.test(value),
  event_type: (value) => /^[A-Z][A-Za-z0-9_.-]{0,63}$/.test(value),
  cache_hit: (value) => /^(true|false)$/.test(value),
  degraded: (value) => /^(true|false)$/.test(value),
  source: (value) => SAFE_SLUG_PATTERN.test(value),
  result_code: (value) => SAFE_SLUG_PATTERN.test(value),
  budget_id: (value) => /^budget\.lijing\.(local|staging|production)$/.test(value),
  direction: (value) => /^(input|output)$/.test(value),
  platform: (value) => /^(ios|android|web|windows|macos|linux)$/.test(value),
});

function safeMetricName(name) {
  if (typeof name !== "string" || !/^[a-zA-Z_:][a-zA-Z0-9_:]{0,127}$/.test(name)) {
    throw new TypeError("metric name must contain only metric-safe characters");
  }
  return name;
}

function hasNonZeroHex(value) {
  return /[1-9a-f]/i.test(value);
}

function isValidRequestId(value) {
  return typeof value === "string" && UUID_V4_PATTERN.test(value) && hasNonZeroHex(value);
}

function isValidTraceId(value) {
  return typeof value === "string" &&
    ((UUID_V4_PATTERN.test(value) && hasNonZeroHex(value)) ||
      (W3C_TRACE_ID_PATTERN.test(value) && hasNonZeroHex(value)));
}

function isValidDeviceHash(value) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function safeLabelValue(key, value) {
  if (SENSITIVE_LABEL_KEYS.test(key) || !ALLOWED_LABEL_KEYS.has(key)) return undefined;
  if (value === null || value === undefined) return undefined;
  const normalized = typeof value === "string" ? value.trim() : String(value);
  if (!normalized || normalized.length > 128 || /[\r\n]/.test(normalized)) return undefined;
  if (EMAIL_VALUE_PATTERN.test(normalized) || SECRET_VALUE_PATTERN.test(normalized)) return undefined;
  if (UUID_PATTERN.test(normalized) || /^\+?\d{7,15}$/.test(normalized) || /\d{7,15}/.test(normalized)) return undefined;
  if (IDENTIFIER_VALUE_PATTERN.test(normalized)) return undefined;
  if (key !== "route" && (/[\\/]/.test(normalized) || normalized.includes("://") || normalized.includes(".."))) return undefined;
  const validator = DIMENSION_VALIDATORS[key];
  return validator && validator(normalized) ? normalized : undefined;
}

function sanitizeTelemetryLabels(labels = {}) {
  const sanitized = {};
  for (const [key, value] of Object.entries(labels ?? {})) {
    const safeValue = safeLabelValue(key, value);
    if (safeValue !== undefined) sanitized[key] = safeValue;
  }
  return sanitized;
}

function sanitizeTraceAttributes(attributes = {}) {
  const sanitized = {};
  const traceId = attributes.trace_id ?? attributes.traceId;
  const requestId = attributes.request_id ?? attributes.requestId;
  const deviceIdHash = attributes.device_id_hash ?? attributes.deviceIdHash;
  if (isValidTraceId(traceId)) sanitized.trace_id = traceId;
  if (isValidRequestId(requestId)) sanitized.request_id = requestId;
  if (isValidDeviceHash(deviceIdHash)) sanitized.device_id_hash = deviceIdHash;
  return sanitized;
}

export interface TelemetrySpan {
  traceId: string;
  end(status?: string): void;
}

export interface TelemetrySnapshot {
  counters: Array<{ name: string; value: number; labels: Record<string, string> }>;
  histograms: Array<{ name: string; value: number; labels: Record<string, string> }>;
  traces: Array<{ name: string; trace_id: string; labels: Record<string, string>; status: string; duration_ms: number }>;
}

export interface Telemetry {
  incrementCounter(name: string, value?: number, labels?: Record<string, unknown>): void;
  observeHistogram(name: string, value: number, labels?: Record<string, unknown>): void;
  startTrace(name: string, attributes?: Record<string, unknown>): TelemetrySpan;
  snapshot(): TelemetrySnapshot;
}

class InMemoryTelemetry implements Telemetry {
  private readonly baseLabels: Record<string, string>;
  private readonly counters = new Map<string, { name: string; value: number; labels: Record<string, string> }>();
  private readonly histograms: Array<{ name: string; value: number; labels: Record<string, string> }> = [];
  private readonly traces: Array<{ name: string; trace_id: string; labels: Record<string, string>; status: string; duration_ms: number }> = [];

  constructor({ serviceName, environment }: { serviceName: string; environment: string }) {
    const labels = sanitizeTelemetryLabels({ service: serviceName, environment });
    if (!labels.service || !labels.environment) throw new TypeError("serviceName and environment are required");
    this.baseLabels = labels;
  }

  incrementCounter(name: string, value = 1, labels: Record<string, unknown> = {}): void {
    safeMetricName(name);
    if (!Number.isFinite(value) || value < 0) throw new RangeError("counter value must be a non-negative finite number");
    const mergedLabels = { ...this.baseLabels, ...sanitizeTelemetryLabels(labels) };
    const key = `${name}|${JSON.stringify(mergedLabels)}`;
    const current = this.counters.get(key);
    if (current) current.value += value;
    else this.counters.set(key, { name, value, labels: mergedLabels });
  }

  observeHistogram(name: string, value: number, labels: Record<string, unknown> = {}): void {
    safeMetricName(name);
    if (!Number.isFinite(value) || value < 0) throw new RangeError("histogram value must be a non-negative finite number");
    this.histograms.push({ name, value, labels: { ...this.baseLabels, ...sanitizeTelemetryLabels(labels) } });
  }

  startTrace(name: string, attributes: Record<string, unknown> = {}): TelemetrySpan {
    if (typeof name !== "string" || !name.trim() || name.length > 128) throw new TypeError("trace name is invalid");
    const requestedTraceId = attributes.trace_id ?? attributes.traceId;
    const traceId = isValidTraceId(requestedTraceId) ? requestedTraceId : crypto.randomUUID();
    const labels = { ...this.baseLabels, ...sanitizeTraceAttributes({ ...attributes, trace_id: traceId }) };
    const startedAt = Date.now();
    let ended = false;
    return {
      traceId,
      end: (status = "ok") => {
        if (ended) return;
        ended = true;
        this.traces.push({
          name: name.trim(),
          trace_id: traceId,
          labels,
          status: SAFE_SLUG_PATTERN.test(status) ? status : "unknown",
          duration_ms: Math.max(0, Date.now() - startedAt),
        });
      },
    };
  }

  snapshot(): TelemetrySnapshot {
    return {
      counters: [...this.counters.values()].map((entry) => ({ ...entry, labels: { ...entry.labels } })),
      histograms: this.histograms.map((entry) => ({ ...entry, labels: { ...entry.labels } })),
      traces: this.traces.map((entry) => ({ ...entry, labels: { ...entry.labels } })),
    };
  }
}

module.exports = {
  InMemoryTelemetry,
  sanitizeTelemetryLabels,
};
