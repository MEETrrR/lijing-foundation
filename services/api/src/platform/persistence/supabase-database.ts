const { Pool } = require("pg");

const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const KEY_MAX_LENGTH = 512;

function safeIdentifier(value, field) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new TypeError(`${field} must be a lowercase SQL identifier`);
  }
  return value;
}

function validateKey(key) {
  if (typeof key !== "string" || key.length < 1 || key.length > KEY_MAX_LENGTH || key.includes("\0")) {
    throw new TypeError(`database key must contain 1-${KEY_MAX_LENGTH} characters`);
  }
  return key;
}

function positiveInteger(value, field, fallback) {
  const normalized = value ?? fallback;
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 100) throw new RangeError(`${field} must be an integer between 1 and 100`);
  return normalized;
}

function serializeValue(value) {
  if (value === undefined) throw new TypeError("database value cannot be undefined");
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("database value must be JSON serializable");
  return serialized;
}

function dependencyHealth(status, latencyMs, reasonCode) {
  return {
    dependency: "database",
    status,
    latency_ms: Math.max(0, Math.round(latencyMs)),
    reason_code: reasonCode,
  };
}

class SupabasePostgresDatabase {
  constructor(options = {}) {
    this.schema = safeIdentifier(options.schema ?? "public", "schema");
    this.table = safeIdentifier(options.table ?? "lijing_runtime_kv", "table");
    this.qualifiedTable = `"${this.schema}"."${this.table}"`;
    this.ownsPool = !options.pool;
    if (this.ownsPool && (typeof options.connectionString !== "string" || options.connectionString.trim().length === 0)) {
      throw new TypeError("connectionString is required when pool is not provided");
    }
    this.pool = options.pool ?? new Pool({
      connectionString: options.connectionString,
      max: positiveInteger(options.maxConnections, "maxConnections", 10),
      connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5000,
      idleTimeoutMillis: options.idleTimeoutMillis ?? 30000,
      ssl: options.ssl ?? { rejectUnauthorized: true },
    });
    this.executor = options.executor ?? this.pool;
    this.inTransaction = options.inTransaction === true;
  }

  scoped(executor) {
    return new SupabasePostgresDatabase({
      pool: this.pool,
      executor,
      schema: this.schema,
      table: this.table,
      inTransaction: true,
    });
  }

  async get(key) {
    const result = await this.executor.query(
      `SELECT "value" FROM ${this.qualifiedTable} WHERE "key" = $1 LIMIT 1`,
      [validateKey(key)],
    );
    return result.rows[0]?.value;
  }

  async set(key, value) {
    await this.executor.query(
      `INSERT INTO ${this.qualifiedTable} ("key", "value", "updated_at") VALUES ($1, $2::jsonb, timezone('utc', now())) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = timezone('utc', now())`,
      [validateKey(key), serializeValue(value)],
    );
  }

  async setIfAbsent(key, value) {
    const result = await this.executor.query(
      `INSERT INTO ${this.qualifiedTable} ("key", "value", "updated_at") VALUES ($1, $2::jsonb, timezone('utc', now())) ON CONFLICT ("key") DO NOTHING RETURNING "key"`,
      [validateKey(key), serializeValue(value)],
    );
    return result.rowCount > 0;
  }

  async delete(key) {
    const result = await this.executor.query(
      `DELETE FROM ${this.qualifiedTable} WHERE "key" = $1 RETURNING "key"`,
      [validateKey(key)],
    );
    return result.rowCount > 0;
  }

  async transaction(work) {
    if (typeof work !== "function") throw new TypeError("transaction callback is required");
    if (this.inTransaction) throw new Error("nested database transactions are not supported");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(this.scoped(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original transaction error; the pool still releases the connection.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async healthCheck() {
    const startedAt = Date.now();
    try {
      await this.pool.query("SELECT 1");
      return dependencyHealth("up", Date.now() - startedAt, "ok");
    } catch {
      return dependencyHealth("down", Date.now() - startedAt, "dependency_unavailable");
    }
  }

  async close() {
    if (this.ownsPool) await this.pool.end();
  }
}

function createSupabaseDatabaseFromEnv(env = process.env, options = {}) {
  const connectionString = env.SUPABASE_DATABASE_URL;
  if (typeof connectionString !== "string" || connectionString.trim().length === 0) return undefined;
  const sslDisabled = env.SUPABASE_DB_SSL === "false";
  if (env.APP_ENV === "production" && sslDisabled) throw new Error("SUPABASE_DB_SSL=false is not allowed in production");
  return new SupabasePostgresDatabase({
    ...options,
    connectionString: connectionString.trim(),
    maxConnections: options.maxConnections ?? Number(env.DATABASE_POOL_MAX ?? 10),
    ssl: sslDisabled ? false : { rejectUnauthorized: true },
  });
}

module.exports = {
  KEY_MAX_LENGTH,
  SupabasePostgresDatabase,
  createSupabaseDatabaseFromEnv,
  safeIdentifier,
  validateKey,
};
