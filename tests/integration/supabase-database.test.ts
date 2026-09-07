const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  SupabasePostgresDatabase,
  createSslOptions,
  createSupabaseDatabaseFromEnv,
  safeIdentifier,
  validateKey,
} = require("../../services/api/src/platform/persistence/supabase-database.ts");
const { createDefaultServices } = require("../../services/api/src/bootstrap/http-api.ts");
const { InMemoryDatabase } = require("../../services/api/src/platform/persistence/database.ts");

class FakeClient {
  constructor(state, queries) {
    this.state = state;
    this.queries = queries;
    this.snapshot = null;
    this.released = false;
  }

  async query(text, values = []) {
    this.queries.push({ text, values });
    if (text === "BEGIN") { this.snapshot = new Map(this.state); return { rows: [], rowCount: 0 }; }
    if (text === "COMMIT") { this.snapshot = null; return { rows: [], rowCount: 0 }; }
    if (text === "ROLLBACK") { this.state.clear(); for (const [key, value] of this.snapshot ?? []) this.state.set(key, value); this.snapshot = null; return { rows: [], rowCount: 0 }; }
    if (text.startsWith("SELECT 1")) return { rows: [{ '?column?': 1 }], rowCount: 1 };
    if (text.startsWith("SELECT \"value\"")) return { rows: this.state.has(values[0]) ? [{ value: this.state.get(values[0]) }] : [], rowCount: this.state.has(values[0]) ? 1 : 0 };
    if (text.startsWith("INSERT INTO")) {
      if (text.includes("DO NOTHING") && this.state.has(values[0])) return { rows: [], rowCount: 0 };
      this.state.set(values[0], JSON.parse(values[1]));
      return { rows: text.includes("RETURNING") ? [{ key: values[0] }] : [], rowCount: 1 };
    }
    if (text.startsWith("DELETE FROM")) { const existed = this.state.delete(values[0]); return { rows: existed ? [{ key: values[0] }] : [], rowCount: existed ? 1 : 0 }; }
    throw new Error(`unexpected SQL: ${text}`);
  }

  release() { this.released = true; }
}

class FakePool extends FakeClient {
  async connect() { return new FakeClient(this.state, this.queries); }
  async end() { this.ended = true; }
}

test("Supabase database adapter uses parameterized SQL and real transaction boundaries", async () => {
  const pool = new FakePool(new Map(), []);
  const database = new SupabasePostgresDatabase({ pool });

  await database.set("progress:account-001", { energy: 99 });
  assert.deepEqual(await database.get("progress:account-001"), { energy: 99 });
  assert.equal(await database.setIfAbsent("unique:key", { first: true }), true);
  assert.equal(await database.setIfAbsent("unique:key", { first: false }), false);
  assert.deepEqual(await database.get("unique:key"), { first: true });
  assert.equal(await database.delete("progress:account-001"), true);

  await assert.rejects(
    database.transaction(async (transaction) => {
      await transaction.set("progress:account-001", { energy: 88 });
      throw new Error("rollback-check");
    }),
    /rollback-check/,
  );
  assert.equal(await database.get("progress:account-001"), undefined);
  assert.ok(pool.queries.some((query) => query.text === "BEGIN"));
  assert.ok(pool.queries.some((query) => query.text === "ROLLBACK"));
  assert.ok(pool.queries.filter((query) => query.text.includes("$1")).every((query) => !query.text.includes("progress:account-001")));
});

test("Supabase database adapter validates identifiers, keys, and production TLS", () => {
  assert.equal(safeIdentifier("lijing_runtime_kv", "table"), "lijing_runtime_kv");
  assert.throws(() => safeIdentifier("public;drop table", "table"), /lowercase SQL identifier/);
  assert.equal(validateKey("idempotency:account-001:ai.requests:key"), "idempotency:account-001:ai.requests:key");
  assert.throws(() => validateKey(""), /database key/);
  assert.throws(() => createSupabaseDatabaseFromEnv({ APP_ENV: "production", SUPABASE_DATABASE_URL: "postgres://example", SUPABASE_DB_SSL: "false" }), /not allowed in production/);
});

test("Supabase database adapter loads a configured PostgreSQL CA", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lijing-ca-"));
  const caPath = path.join(directory, "ca.crt");
  fs.writeFileSync(caPath, "TEST CA CERTIFICATE\n", "utf8");
  try {
    const ssl = createSslOptions({ SUPABASE_DB_SSL_CA: caPath }, "postgresql://user:password@47.122.109.183:33989/lijing");
    assert.equal(ssl.rejectUnauthorized, true);
    assert.equal(ssl.ca, "TEST CA CERTIFICATE\n");
    assert.equal(typeof ssl.checkServerIdentity, "function");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Supabase database adapter separates a local connection address from certificate identity", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lijing-ca-server-name-"));
  const caPath = path.join(directory, "ca.crt");
  fs.writeFileSync(caPath, "TEST CA CERTIFICATE\n", "utf8");
  try {
    const ssl = createSslOptions(
      { SUPABASE_DB_SSL_CA: caPath, SUPABASE_DB_SSL_SERVER_NAME: "47.122.109.183" },
      "postgresql://user:password@127.0.0.1:33989/lijing",
    );
    assert.equal(ssl.rejectUnauthorized, true);
    assert.equal(ssl.servername, undefined);
    assert.equal(typeof ssl.checkServerIdentity, "function");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Supabase database adapter can be selected without exposing credentials in application code", async () => {
  const pool = new FakePool(new Map(), []);
  const database = createSupabaseDatabaseFromEnv({ APP_ENV: "staging", SUPABASE_DATABASE_URL: "postgres://secret@example/db" }, { pool });
  assert.ok(database instanceof SupabasePostgresDatabase);
  const health = await database.healthCheck();
  assert.equal(health.status, "up");
  assert.doesNotMatch(JSON.stringify(health), /secret@example/);
  assert.ok(pool.queries.some((query) => query.text === 'SELECT 1 FROM "public"."lijing_runtime_kv" LIMIT 1'));
});

test("backend selects Supabase persistence only when an explicit connection string is present", async () => {
  const pool = new FakePool(new Map(), []);
  const services = createDefaultServices({
    env: { APP_ENV: "staging", SUPABASE_DATABASE_URL: "postgres://secret@example/db" },
    supabaseDatabase: { pool },
    aiEnabled: false,
  });
  assert.ok(services.database instanceof SupabasePostgresDatabase);
  await services.database.set("progress:account-001", { energy: 100 });
  assert.deepEqual(await services.database.get("progress:account-001"), { energy: 100 });
});

test("production backend fails closed without durable database or enabled AI provider configuration", () => {
  assert.throws(
    () => createDefaultServices({ env: { APP_ENV: "production", AI_ENABLED: "false" } }),
    /SUPABASE_DATABASE_URL is required in production/,
  );
  assert.throws(
    () => createDefaultServices({ env: { APP_ENV: "production", AI_ENABLED: "true" }, database: new InMemoryDatabase() }),
    /AI provider configuration is required/,
  );
  assert.throws(
    () => createDefaultServices({ env: { APP_ENV: "production", AI_ENABLED: "false" }, database: new InMemoryDatabase() }),
    /PILOT_INVITE_CODE is required in production/,
  );
});
