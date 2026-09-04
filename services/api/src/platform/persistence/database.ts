export type DependencyStatus = "up" | "degraded" | "down";

export interface DependencyHealth {
  dependency: string;
  status: DependencyStatus;
  latency_ms: number;
  reason_code: string;
}

export type DatabaseTransactionWork<T> = (database: Database) => Promise<T> | T;

export interface Database {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  transaction<T>(work: DatabaseTransactionWork<T>): Promise<T>;
  healthCheck(): Promise<DependencyHealth>;
}

function cloneValue<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function snapshotValues(values: Map<string, unknown>) {
  const snapshot = new Map<string, unknown>();
  for (const [key, value] of values.entries()) snapshot.set(key, cloneValue(value));
  return snapshot;
}

function restoreValues(values: Map<string, unknown>, snapshot: Map<string, unknown>): void {
  values.clear();
  for (const [key, value] of snapshot.entries()) values.set(key, cloneValue(value));
}

function healthResult(
  dependency: string,
  status: DependencyStatus = "up",
  latency_ms = 0,
  reason_code = "ok",
): DependencyHealth {
  return { dependency, status, latency_ms: Math.max(0, Math.round(latency_ms)), reason_code };
}

class InMemoryDatabase implements Database {
  private readonly values = new Map<string, unknown>();
  private readonly configuredHealth: DependencyHealth;
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(options: Partial<DependencyHealth> = {}) {
    this.configuredHealth = healthResult(
      "database",
      options.status ?? "up",
      options.latency_ms ?? 0,
      options.reason_code ?? "ok",
    );
  }

  async get<T>(key: string): Promise<T | undefined> {
    return cloneValue(this.values.get(key) as T | undefined);
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, cloneValue(value));
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async transaction<T>(work: DatabaseTransactionWork<T>): Promise<T> {
    if (typeof work !== "function") throw new TypeError("transaction callback is required");
    const run = this.transactionTail.then(async () => {
      const snapshot = snapshotValues(this.values);
      try {
        return await work(this);
      } catch (error) {
        restoreValues(this.values, snapshot);
        throw error;
      }
    });
    this.transactionTail = run.then(() => undefined, () => undefined);
    return run;
  }

  async healthCheck(): Promise<DependencyHealth> {
    return { ...this.configuredHealth };
  }
}

module.exports = {
  InMemoryDatabase,
};
