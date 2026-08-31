type DependencyStatus = "up" | "degraded" | "down";

interface DependencyHealth {
  dependency: string;
  status: DependencyStatus;
  latency_ms: number;
  reason_code: string;
}

interface CachePort {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  healthCheck(): Promise<DependencyHealth>;
}

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

function cloneValue<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function healthResult(
  dependency: string,
  status: DependencyStatus = "up",
  latency_ms = 0,
  reason_code = "ok",
): DependencyHealth {
  return { dependency, status, latency_ms: Math.max(0, Math.round(latency_ms)), reason_code };
}

class InMemoryCache implements CachePort {
  private readonly values = new Map<string, CacheEntry>();
  private readonly defaultTtlSeconds: number;
  private readonly configuredHealth: DependencyHealth;

  constructor(options: { defaultTtlSeconds?: number; status?: DependencyStatus; latency_ms?: number; reason_code?: string } = {}) {
    this.defaultTtlSeconds = options.defaultTtlSeconds ?? 300;
    if (!Number.isInteger(this.defaultTtlSeconds) || this.defaultTtlSeconds < 1 || this.defaultTtlSeconds > 86400) {
      throw new RangeError("defaultTtlSeconds must be an integer between 1 and 86400");
    }
    this.configuredHealth = healthResult(
      "cache",
      options.status ?? "up",
      options.latency_ms ?? 0,
      options.reason_code ?? "ok",
    );
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return undefined;
    }
    return cloneValue(entry.value as T);
  }

  async set<T>(key: string, value: T, ttlSeconds = this.defaultTtlSeconds): Promise<void> {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 86400) {
      throw new RangeError("ttlSeconds must be an integer between 1 and 86400");
    }
    this.values.set(key, { value: cloneValue(value), expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async healthCheck(): Promise<DependencyHealth> {
    return { ...this.configuredHealth };
  }
}

module.exports = {
  InMemoryCache,
};
