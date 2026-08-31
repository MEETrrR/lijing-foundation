type DependencyStatus = "up" | "degraded" | "down";

interface DependencyHealth {
  dependency: string;
  status: DependencyStatus;
  latency_ms: number;
  reason_code: string;
}

interface HealthCheckable {
  healthCheck(): Promise<DependencyHealth>;
}

const DEPENDENCIES = Object.freeze(["database", "cache", "queue", "object_storage"]);
const STATUS_RANK = Object.freeze({ up: 0, degraded: 1, down: 2 });

function sanitizeStatus(value): DependencyStatus {
  return value === "up" || value === "degraded" || value === "down" ? value : "down";
}

function sanitizeReasonCode(value): string {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9_]{1,64}$/.test(normalized) ? normalized : "unknown";
}

function normalizeHealth(dependency: string, result: Partial<DependencyHealth>): DependencyHealth {
  return {
    dependency,
    status: sanitizeStatus(result?.status),
    latency_ms: Number.isFinite(result?.latency_ms) && result.latency_ms >= 0 ? Math.round(result.latency_ms) : 0,
    reason_code: sanitizeReasonCode(result?.reason_code),
  };
}

async function checkDependency(dependency: string, probe: HealthCheckable): Promise<DependencyHealth> {
  try {
    return normalizeHealth(dependency, await probe.healthCheck());
  } catch {
    return normalizeHealth(dependency, { status: "down", latency_ms: 0, reason_code: "dependency_unavailable" });
  }
}

class PlatformHealthChecker {
  private readonly probes: Record<string, HealthCheckable>;

  constructor({ database, cache, queue, objectStorage }: {
    database: HealthCheckable;
    cache: HealthCheckable;
    queue: HealthCheckable;
    objectStorage: HealthCheckable;
  }) {
    this.probes = { database, cache, queue, object_storage: objectStorage };
  }

  async check() {
    const dependencyEntries = await Promise.all(
      DEPENDENCIES.map(async (dependency) => [dependency, await checkDependency(dependency, this.probes[dependency])] as const),
    );
    const dependencies = Object.fromEntries([
      ["application", normalizeHealth("application", { status: "up", latency_ms: 0, reason_code: "ok" })],
      ...dependencyEntries,
    ]);
    const status = Object.values(dependencies).reduce<DependencyStatus>(
      (current, dependency) => STATUS_RANK[dependency.status] > STATUS_RANK[current] ? dependency.status : current,
      "up",
    );
    return { status, dependencies };
  }
}

module.exports = {
  PlatformHealthChecker,
};
