const crypto = require("node:crypto");

const SENSITIVE_LABEL_KEYS = /authorization|cookie|password|token|secret|credential|api[_-]?key|phone|mobile|prompt|response|conversation|body|content|url|query/i;
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
  "transport",
  "queue",
  "operation",
  "event_type",
  "cache_hit",
  "degraded",
  "source",
  "result_code",
  "trace_id",
  "request_id",
  "actor_id",
  "device_id_hash",
]);

function safeMetricName(name) {
  if (typeof name !== "string" || !/^[a-zA-Z_:][a-zA-Z0-9_:]{0,127}$/.test(name)) {
    throw new TypeError("metric name must contain only metric-safe characters");
  }
  return name;
}

function safeLabelValue(key, value) {
  if (SENSITIVE_LABEL_KEYS.test(key) || !ALLOWED_LABEL_KEYS.has(key)) return undefined;
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") {
    return Number.isFinite(value) && Math.abs(value) <= 1000000000 ? String(value) : undefined;
  }
  if (typeof value === "boolean") return String(value);
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > 128 || /[\r\n]/.test(normalized)) return undefined;
  if (/^\+?\d{7,15}$/.test(normalized)) return undefined;
  if (/bearer\s|password|secret|token|conversation|prompt|response|sk-[a-z0-9]/i.test(normalized)) return undefined;
  if (key === "route") return normalized.split(/[?#]/, 1)[0] || undefined;
  if (["reason_code", "outcome", "dependency", "event_type", "result_code"].includes(key)) {
    return /^[a-zA-Z0-9_.:-]+$/.test(normalized) ? normalized : undefined;
  }
  return normalized;
}

function sanitizeTelemetryLabels(labels = {}) {
  const sanitized = {};
  for (const [key, value] of Object.entries(labels ?? {})) {
    const safeValue = safeLabelValue(key, value);
    if (safeValue !== undefined) sanitized[key] = safeValue;
  }
  return sanitized;
}

class InMemoryTelemetry {
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

  startTrace(name: string, attributes: Record<string, unknown> = {}) {
    if (typeof name !== "string" || !name.trim() || name.length > 128) throw new TypeError("trace name is invalid");
    const traceId = safeLabelValue("trace_id", attributes.trace_id ?? attributes.traceId) ?? crypto.randomUUID();
    const labels = { ...this.baseLabels, ...sanitizeTelemetryLabels({ ...attributes, trace_id: traceId }) };
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
          status: safeLabelValue("outcome", status) ?? "unknown",
          duration_ms: Math.max(0, Date.now() - startedAt),
        });
      },
    };
  }

  snapshot() {
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
