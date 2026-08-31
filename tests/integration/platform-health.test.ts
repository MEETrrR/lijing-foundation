const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  ConfigurationError,
  loadConfiguration,
} = require("../../services/api/src/platform/config/configuration.ts");
const {
  RequestContext,
  createRequestContext,
} = require("../../services/api/src/platform/http/request-context.ts");
const {
  PlatformError,
  toPublicErrorResponse,
} = require("../../services/api/src/platform/errors/error-catalog.ts");
const {
  InMemorySecretProvider,
} = require("../../services/api/src/platform/security/secret-provider.ts");
const {
  InMemoryTelemetry,
} = require("../../services/api/src/platform/observability/telemetry.ts");
const {
  InMemoryDatabase,
} = require("../../services/api/src/platform/persistence/database.ts");
const {
  InMemoryCache,
} = require("../../services/api/src/platform/cache/cache.ts");
const {
  InMemoryMessageBus,
} = require("../../services/api/src/platform/messaging/message-bus.ts");
const {
  PlatformHealthChecker,
} = require("../../services/api/src/platform/health.ts");

const repositoryRoot = path.resolve(__dirname, "../..");
const environmentNames = ["local", "staging", "production"];

function readEnvironmentExample(environment) {
  const source = fs.readFileSync(
    path.join(repositoryRoot, "infra", "environments", `${environment}.env.example`),
    "utf8",
  );
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        assert.ok(separator > 0, `invalid environment line: ${line}`);
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function cloneEnvironment(environment) {
  return { ...readEnvironmentExample(environment) };
}

test("environment examples load with explicit isolated resource identities", () => {
  for (const environment of ["local", "staging"]) {
    const values = readEnvironmentExample(environment);
    const configuration = loadConfiguration(values);

    assert.equal(configuration.environment, environment);
    assert.match(configuration.resources.databaseResourceId, new RegExp(`^lijing-${environment}-`));
    assert.match(configuration.resources.redisResourceId, new RegExp(`^lijing-${environment}-`));
    assert.match(configuration.resources.objectStorageResourceId, new RegExp(`^lijing-${environment}-`));
    assert.match(configuration.resources.messageBusResourceId, new RegExp(`^lijing-${environment}-`));
    assert.equal(configuration.ai.providerProjectId, `lijing-${environment}-ai`);
    assert.equal(configuration.ai.budgetId, `budget.lijing.${environment}`);
    assert.equal(configuration.security.secretNamespace, `lijing/${environment}`);

    const serialized = JSON.stringify(values);
    assert.doesNotMatch(serialized, /sk-[A-Za-z0-9]{16,}/);
    assert.doesNotMatch(serialized, /-----BEGIN [A-Z ]+-----/);
  }

  const productionExample = readEnvironmentExample("production");
  assert.throws(
    () => loadConfiguration(productionExample),
    (error) => error instanceof ConfigurationError && /placeholder|example|production/i.test(error.message),
  );

  const localInStaging = readEnvironmentExample("local");
  localInStaging.APP_ENV = "staging";
  assert.throws(
    () => loadConfiguration(localInStaging),
    (error) => error instanceof ConfigurationError && /environment identity|DATABASE_RESOURCE_ID/i.test(error.message),
  );
});

test("configuration rejects missing, malformed, out-of-range, and cross-environment values", () => {
  const missing = cloneEnvironment("local");
  delete missing.DATABASE_RESOURCE_ID;
  assert.throws(
    () => loadConfiguration(missing),
    (error) => error instanceof ConfigurationError && /DATABASE_RESOURCE_ID/.test(error.message),
  );

  const invalidNumber = cloneEnvironment("local");
  invalidNumber.MESSAGE_MAX_ATTEMPTS = "0";
  assert.throws(
    () => loadConfiguration(invalidNumber),
    (error) => error instanceof ConfigurationError && /MESSAGE_MAX_ATTEMPTS/.test(error.message),
  );

  const invalidBoolean = cloneEnvironment("local");
  invalidBoolean.OBJECT_STORAGE_PRIVATE = "sometimes";
  assert.throws(
    () => loadConfiguration(invalidBoolean),
    (error) => error instanceof ConfigurationError && /OBJECT_STORAGE_PRIVATE/.test(error.message),
  );

  const crossEnvironment = cloneEnvironment("staging");
  crossEnvironment.DATABASE_CREDENTIAL_REF = "secret://lijing/production/database";
  assert.throws(
    () => loadConfiguration(crossEnvironment),
    (error) => error instanceof ConfigurationError && /production identity/i.test(error.message),
  );

  const invalidProduction = cloneEnvironment("production");
  invalidProduction.REDIS_RESOURCE_ID = "lijing-staging-cache";
  assert.throws(
    () => loadConfiguration(invalidProduction),
    (error) => error instanceof ConfigurationError && /REDIS_RESOURCE_ID/.test(error.message),
  );
});

test("configuration rejects a database name from another environment", () => {
  const staging = cloneEnvironment("staging");
  staging.DATABASE_NAME = "lijing_production";

  assert.throws(
    () => loadConfiguration(staging),
    (error) => error instanceof ConfigurationError && /DATABASE_NAME/.test(error.message),
  );
});

test("request context produces traceable but safe log fields", () => {
  const context = createRequestContext({
    traceId: "11111111-1111-4111-8111-111111111111",
    requestId: "22222222-2222-4222-8222-222222222222",
    clientVersion: "1.2.3",
    deviceFingerprint: "device-fingerprint-that-must-not-be-logged",
    actorId: "13800138000",
  }, { deviceHashKey: "test-only-device-hash-key" });

  const safeFields = context.toSafeLogFields();
  const serialized = JSON.stringify(safeFields);

  assert.equal(safeFields.trace_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(safeFields.request_id, "22222222-2222-4222-8222-222222222222");
  assert.equal(safeFields.client_version, "1.2.3");
  assert.match(safeFields.device_id_hash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(safeFields.actor_id, undefined);
  assert.doesNotMatch(serialized, /device-fingerprint-that-must-not-be-logged/);
  assert.doesNotMatch(serialized, /13800138000/);
  assert.doesNotMatch(serialized, /password|authorization|bearer|conversation/i);
});

test("request context replaces malformed, reserved, and path-like correlation IDs", () => {
  for (const value of ["Authorization", "req/../../prod", "not-a-uuid"]) {
    const context = createRequestContext({ traceId: value, requestId: value });
    const safeFields = context.toSafeLogFields();

    assert.match(safeFields.trace_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.match(safeFields.request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.notEqual(safeFields.trace_id, value);
    assert.notEqual(safeFields.request_id, value);
    assert.doesNotMatch(JSON.stringify(safeFields), /Authorization|req\/\.\.\/\.\.\/prod|not-a-uuid/);
  }
});

test("direct RequestContext construction sanitizes client version and device hash before logging", () => {
  const validTraceId = "44444444-4444-4444-8444-444444444444";
  const validRequestId = "55555555-5555-4555-8555-555555555555";
  const invalidValues = [
    "Bearer super-secret-token",
    "learner@example.com",
    "client/../../prod",
    "v".repeat(65),
    "1.2.3$malformed",
  ];

  for (const invalidValue of invalidValues) {
    const context = new RequestContext({
      traceId: validTraceId,
      requestId: validRequestId,
      clientVersion: invalidValue,
      deviceIdHash: invalidValue,
    });
    const safeFields = context.toSafeLogFields();
    const serialized = JSON.stringify(safeFields);

    assert.equal(safeFields.client_version, "unknown");
    assert.equal(safeFields.device_id_hash, undefined);
    assert.doesNotMatch(serialized, new RegExp(invalidValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const validContext = new RequestContext({
    traceId: validTraceId,
    requestId: validRequestId,
    clientVersion: "1.2.3",
    deviceIdHash: `sha256:${"a".repeat(64)}`,
  });
  const validSafeFields = validContext.toSafeLogFields();

  assert.equal(validSafeFields.client_version, "1.2.3");
  assert.equal(validSafeFields.device_id_hash, `sha256:${"a".repeat(64)}`);

  for (const unsafeActorId of ["learner@example.com", "req/../../prod", "Bearer secret-token", "13800138000"]) {
    const unsafeActorContext = new RequestContext({
      traceId: validTraceId,
      requestId: validRequestId,
      clientVersion: "1.2.3",
      actorId: unsafeActorId,
    });
    const unsafeActorFields = unsafeActorContext.toSafeLogFields();
    const serialized = JSON.stringify(unsafeActorFields);

    assert.equal(unsafeActorContext.actorId, undefined);
    assert.equal(unsafeActorFields.actor_id, undefined);
    assert.doesNotMatch(serialized, new RegExp(unsafeActorId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const safeActorContext = new RequestContext({
    traceId: validTraceId,
    requestId: validRequestId,
    clientVersion: "1.2.3",
    actorId: "actor.internal:1",
  });

  assert.equal(safeActorContext.actorId, "actor.internal:1");
  assert.equal(safeActorContext.toSafeLogFields().actor_id, "actor.internal:1");
});

test("request context safe log fields revalidate correlation IDs after mutation", () => {
  const context = new RequestContext({
    traceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    clientVersion: "1.2.3",
  });

  context.traceId = "Authorization";
  context.requestId = "req/../../prod";

  const safeFields = context.toSafeLogFields();
  const serialized = JSON.stringify(safeFields);

  assert.match(safeFields.trace_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.match(safeFields.request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.doesNotMatch(serialized, /Authorization|req\/\.\.\/\.\.\/prod/);
});

test("error catalog maps internal failures to stable safe responses", () => {
  const requestId = "33333333-3333-4333-8333-333333333333";
  const internalFailure = new PlatformError(
    "INTERNAL_ERROR",
    "provider key sk-live-not-for-logs caused a stack trace",
    { cause: new Error("private provider response body") },
  );
  const response = toPublicErrorResponse(internalFailure, requestId);

  assert.deepEqual(response, {
    request_id: requestId,
    code: "internal_error",
    message: "Something went wrong.",
    retryable: true,
  });
  assert.doesNotMatch(JSON.stringify(response), /provider|sk-live|stack|private/i);

  const rateLimited = toPublicErrorResponse(new PlatformError("RATE_LIMITED"), requestId);
  assert.equal(rateLimited.code, "rate_limited");
  assert.equal(rateLimited.retryable, true);
});

test("public error responses replace invalid request IDs with fresh UUIDs", () => {
  for (const invalidRequestId of ["Authorization", "req/../../prod", "not-a-uuid"]) {
    const response = toPublicErrorResponse(new PlatformError("INTERNAL_ERROR"), invalidRequestId);

    assert.match(response.request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.notEqual(response.request_id, invalidRequestId);
    assert.doesNotMatch(JSON.stringify(response), /Authorization|req\/\.\.\/\.\.\/prod|not-a-uuid/);
  }
});

test("health checks distinguish application, database, cache, queue, and object storage", async () => {
  const database = new InMemoryDatabase();
  const cache = new InMemoryCache();
  const messageBus = new InMemoryMessageBus();
  const objectStorage = {
    async healthCheck() {
      return { dependency: "object_storage", status: "up", latency_ms: 0, reason_code: "ok" };
    },
  };
  const health = await new PlatformHealthChecker({ database, cache, queue: messageBus, objectStorage }).check();

  assert.equal(health.status, "up");
  assert.deepEqual(Object.keys(health.dependencies).sort(), [
    "application",
    "cache",
    "database",
    "object_storage",
    "queue",
  ]);
  for (const dependency of Object.values(health.dependencies)) {
    assert.equal(dependency.status, "up");
    assert.equal(typeof dependency.latency_ms, "number");
    assert.match(dependency.reason_code, /^[a-z0-9_]+$/);
  }
});

test("health checks sanitize dependency failures and exceptions", async () => {
  const health = await new PlatformHealthChecker({
    database: {
      async healthCheck() {
        return { dependency: "spoofed", status: "degraded", latency_ms: 4.4, reason_code: "pool_exhausted" };
      },
    },
    cache: {
      async healthCheck() {
        throw new Error("provider password body must not leak");
      },
    },
    queue: {
      async healthCheck() {
        return { dependency: "queue", status: "invalid", latency_ms: -1, reason_code: "../secret" };
      },
    },
    objectStorage: {
      async healthCheck() {
        return { dependency: "object_storage", status: "up", latency_ms: 2, reason_code: "ok" };
      },
    },
  }).check();

  assert.equal(health.status, "down");
  assert.deepEqual(health.dependencies.database, {
    dependency: "database",
    status: "degraded",
    latency_ms: 4,
    reason_code: "pool_exhausted",
  });
  assert.deepEqual(health.dependencies.cache, {
    dependency: "cache",
    status: "down",
    latency_ms: 0,
    reason_code: "dependency_unavailable",
  });
  assert.deepEqual(health.dependencies.queue, {
    dependency: "queue",
    status: "down",
    latency_ms: 0,
    reason_code: "unknown",
  });
  assert.doesNotMatch(JSON.stringify(health), /provider|password|body|secret/i);
});

test("health checks time out a hanging dependency probe", async () => {
  const hangingProbe = {
    healthCheck() {
      return new Promise(() => {});
    },
  };
  const objectStorage = {
    async healthCheck() {
      return { dependency: "object_storage", status: "up", latency_ms: 0, reason_code: "ok" };
    },
  };
  const startedAt = Date.now();
  const health = await new PlatformHealthChecker({
    database: hangingProbe,
    cache: new InMemoryCache(),
    queue: new InMemoryMessageBus(),
    objectStorage,
  }, { timeoutMs: 15 }).check();

  assert.ok(Date.now() - startedAt < 500);
  assert.deepEqual(health.dependencies.database, {
    dependency: "database",
    status: "down",
    latency_ms: 15,
    reason_code: "dependency_timeout",
  });
  assert.doesNotMatch(JSON.stringify(health), /provider|password|secret|timed out/i);
});

test("secret, database, and cache ports use deterministic in-memory adapters", async () => {
  const secrets = new InMemorySecretProvider({ "test/reference": "synthetic-value" });
  assert.deepEqual(await secrets.getSecret("test/reference"), {
    status: "found",
    name: "test/reference",
    value: "synthetic-value",
  });
  assert.deepEqual(await secrets.getSecret("missing/reference"), {
    status: "not_found",
    name: "missing/reference",
    reason_code: "secret_not_found",
  });

  const database = new InMemoryDatabase();
  await database.set("account-1", { state: "active" });
  assert.deepEqual(await database.get("account-1"), { state: "active" });

  const cache = new InMemoryCache({ defaultTtlSeconds: 60 });
  await cache.set("progress:account-1", { level: 2 });
  assert.deepEqual(await cache.get("progress:account-1"), { level: 2 });
  assert.equal(await cache.delete("progress:account-1"), true);
  assert.equal(await cache.get("progress:account-1"), undefined);
});

test("database transactions commit on success and restore the previous state on failure", async () => {
  const database = new InMemoryDatabase();
  await database.set("progress:account-1", { level: 2, streak: 4 });

  await assert.rejects(
    database.transaction(async (transaction) => {
      await transaction.set("progress:account-1", { level: 99, streak: 0 });
      await transaction.set("temporary-write", { should: "rollback" });
      throw new Error("synthetic transaction failure");
    }),
    /synthetic transaction failure/,
  );

  assert.deepEqual(await database.get("progress:account-1"), { level: 2, streak: 4 });
  assert.equal(await database.get("temporary-write"), undefined);

  const result = await database.transaction(async (transaction) => {
    await transaction.set("progress:account-1", { level: 3, streak: 5 });
    return "committed";
  });

  assert.equal(result, "committed");
  assert.deepEqual(await database.get("progress:account-1"), { level: 3, streak: 5 });
});

test("message bus deduplicates successful delivery and dead-letters after bounded retries", async () => {
  const bus = new InMemoryMessageBus({ defaultMaxAttempts: 3, retryDelayMs: 0 });
  let successfulAttempts = 0;
  let failedAttempts = 0;

  bus.subscribe("LearningFactRecorded", async () => {
    successfulAttempts += 1;
    if (successfulAttempts < 3) throw new Error("provider body must not be retained");
  }, { consumerId: "mastery" });
  bus.subscribe("LearningFactRejected", async () => {
    failedAttempts += 1;
    throw new Error("private failure detail");
  }, { consumerId: "review" });

  const successfulEvent = {
    event_id: "44444444-4444-4444-8444-444444444444",
    event_type: "LearningFactRecorded",
    event_version: 1,
    aggregate_id: "fact-1",
    request_id: "55555555-5555-4555-8555-555555555555",
    occurred_at: "2026-08-31T00:00:00.000Z",
    payload: { result_code: "correct" },
  };
  const failedEvent = {
    ...successfulEvent,
    event_id: "66666666-6666-4666-8666-666666666666",
    event_type: "LearningFactRejected",
  };

  await bus.publish(successfulEvent);
  await bus.publish(successfulEvent);
  await bus.publish(failedEvent);

  assert.equal(successfulAttempts, 3);
  assert.equal(failedAttempts, 3);
  assert.equal(bus.getDeadLetters().length, 1);
  assert.deepEqual(bus.getDeadLetters()[0], {
    event_id: failedEvent.event_id,
    event_type: failedEvent.event_type,
    consumer_id: "review",
    attempts: 3,
    reason_code: "handler_failed",
  });
  assert.doesNotMatch(JSON.stringify(bus.getDeadLetters()), /private failure|provider body|correct/i);
});

test("message bus serializes concurrent duplicate delivery per consumer and event", async () => {
  const bus = new InMemoryMessageBus({ defaultMaxAttempts: 3, retryDelayMs: 0 });
  let executions = 0;
  bus.subscribe("ConcurrentFact", async () => {
    executions += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }, { consumerId: "mastery" });

  const event = {
    event_id: "88888888-8888-4888-8888-888888888888",
    event_type: "ConcurrentFact",
    event_version: 1,
    aggregate_id: "fact-concurrent",
    request_id: "99999999-9999-4999-8999-999999999999",
    occurred_at: "2026-08-31T00:00:00.000Z",
    payload: { result_code: "correct" },
  };

  const results = await Promise.all([bus.publish(event), bus.publish(event)]);
  assert.equal(executions, 1);
  assert.equal(results.filter((result) => result.delivered === 1).length, 1);
  assert.equal(results.filter((result) => result.duplicates === 1).length, 1);
});

test("message bus rejects duplicate consumer IDs for the same event type", () => {
  const bus = new InMemoryMessageBus();
  const handler = () => {};

  bus.subscribe("DuplicateConsumerFact", handler, { consumerId: "mastery" });
  assert.throws(
    () => bus.subscribe("DuplicateConsumerFact", handler, { consumerId: "mastery" }),
    /consumerId.*already registered/i,
  );
  assert.doesNotThrow(() => bus.subscribe("OtherConsumerFact", handler, { consumerId: "mastery" }));
});

test("message bus retries concurrent permanent failures with bounded delay", async () => {
  const retryDelayMs = 10;
  const bus = new InMemoryMessageBus({ defaultMaxAttempts: 3, retryDelayMs });
  const attempts = new Map();
  const attemptTimes = new Map();
  let activeHandlers = 0;
  let maxActiveHandlers = 0;

  bus.subscribe("PermanentFailureFact", async (message) => {
    const eventId = message.event_id;
    const eventAttempts = attempts.get(eventId) ?? 0;
    attempts.set(eventId, eventAttempts + 1);
    const timestamps = attemptTimes.get(eventId) ?? [];
    timestamps.push(Date.now());
    attemptTimes.set(eventId, timestamps);
    activeHandlers += 1;
    maxActiveHandlers = Math.max(maxActiveHandlers, activeHandlers);
    await new Promise((resolve) => setTimeout(resolve, 1));
    activeHandlers -= 1;
    throw new Error("synthetic permanent failure");
  }, { consumerId: "retry-worker" });

  const events = ["aaaa", "bbbb"].map((eventId) => ({
    event_id: eventId,
    event_type: "PermanentFailureFact",
    event_version: 1,
    aggregate_id: `aggregate-${eventId}`,
    request_id: `request-${eventId}`,
    occurred_at: "2026-08-31T00:00:00.000Z",
    payload: { result_code: "rejected" },
  }));
  const results = await Promise.all(events.map((event) => bus.publish(event)));

  assert.deepEqual([...attempts.values()], [3, 3]);
  assert.ok(maxActiveHandlers >= 2);
  for (const timestamps of attemptTimes.values()) {
    assert.equal(timestamps.length, 3);
    assert.ok(timestamps[1] - timestamps[0] >= retryDelayMs - 2);
    assert.ok(timestamps[2] - timestamps[1] >= retryDelayMs - 2);
  }
  assert.deepEqual(results.map((result) => result.dead_lettered), [1, 1]);
  assert.equal(bus.getDeadLetters().length, 2);
});

test("in-memory message bus bounds completed and dead-letter retention", async () => {
  const bus = new InMemoryMessageBus({ defaultMaxAttempts: 1, retentionMaxEntries: 2 });
  bus.subscribe("RetainedSuccessFact", () => {}, { consumerId: "success-worker" });
  bus.subscribe("RetainedFailureFact", () => {
    throw new Error("synthetic permanent failure");
  }, { consumerId: "failure-worker" });

  const createEvent = (eventType, eventId) => ({
    event_id: eventId,
    event_type: eventType,
    event_version: 1,
    aggregate_id: `aggregate-${eventId}`,
    request_id: `request-${eventId}`,
    occurred_at: "2026-08-31T00:00:00.000Z",
    payload: { result_code: "rejected" },
  });

  for (let index = 0; index < 6; index += 1) {
    await bus.publish(createEvent("RetainedSuccessFact", `success-${index}`));
    await bus.publish(createEvent("RetainedFailureFact", `failure-${index}`));
  }

  const retention = bus.getRetentionStats();
  assert.ok(retention.completed <= 2);
  assert.ok(retention.dead_lettered <= 2);
  assert.ok(retention.dead_letters <= 2);
  assert.deepEqual(bus.getDeadLetters().map((record) => record.event_id), ["failure-4", "failure-5"]);
});

test("telemetry records required dimensions and redacts sensitive labels", () => {
  const telemetry = new InMemoryTelemetry({ serviceName: "lijing-api", environment: "local" });
  telemetry.incrementCounter("api_requests_total", 1, {
    route: "/api/v1/health",
    outcome: "success",
    status_code: "200",
    prompt: "full conversation body must not be recorded",
    phone: "13800138000",
  });
  telemetry.observeHistogram("api_latency_ms", 12, {
    route: "/api/v1/health",
    outcome: "success",
    dependency: "application",
  });
  const trace = telemetry.startTrace("http_request", {
    trace_id: "77777777-7777-4777-8777-777777777777",
    authorization: "Bearer test",
  });
  trace.end("ok");

  const snapshot = telemetry.snapshot();
  const serialized = JSON.stringify(snapshot);
  assert.equal(snapshot.counters[0].labels.environment, "local");
  assert.equal(snapshot.counters[0].labels.service, "lijing-api");
  assert.equal(snapshot.counters[0].labels.route, "/api/v1/health");
  assert.equal(snapshot.counters[0].labels.outcome, "success");
  assert.equal(snapshot.histograms[0].labels.dependency, "application");
  assert.equal(snapshot.traces[0].labels.trace_id, "77777777-7777-4777-8777-777777777777");
  assert.doesNotMatch(serialized, /full conversation|13800138000|Bearer test|authorization/i);
});

test("telemetry rejects personal, path-like, and identifier-bearing dimension values", () => {
  const telemetry = new InMemoryTelemetry({ serviceName: "lijing-api", environment: "local" });
  telemetry.incrementCounter("safe_dimensions_total", 1, {
    feature: "assistant.explain",
    model: "gpt-5",
    source: "reviewed_content",
    route: "/api/v1/health",
  });
  telemetry.incrementCounter("unsafe_dimensions_total", 1, {
    feature: "user@example.com",
    model: "../../prod",
    source: "account-123456789",
    route: "/api/v1/accounts/123456789",
    operation: "Authorization",
  });

  const snapshot = telemetry.snapshot();
  const safeLabels = snapshot.counters.find((counter) => counter.name === "safe_dimensions_total").labels;
  const unsafeLabels = snapshot.counters.find((counter) => counter.name === "unsafe_dimensions_total").labels;
  assert.equal(safeLabels.feature, "assistant.explain");
  assert.equal(safeLabels.model, "gpt-5");
  assert.equal(safeLabels.source, "reviewed_content");
  assert.equal(safeLabels.route, "/api/v1/health");
  for (const key of ["feature", "model", "source", "route", "operation"]) assert.equal(unsafeLabels[key], undefined);
  assert.doesNotMatch(JSON.stringify(snapshot), /user@example\.com|\.\.\/prod|123456789|Authorization/);
});

test("telemetry rejects unsafe high-cardinality trace names", () => {
  const telemetry = new InMemoryTelemetry({ serviceName: "lijing-api", environment: "local" });
  const invalidTraceNames = [
    "http/request",
    "trace\nsecret",
    "Bearer provider-token",
    "learner@example.com",
    "request_123456789",
    "11111111-1111-4111-8111-111111111111",
    "v".repeat(65),
  ];

  for (const invalidTraceName of invalidTraceNames) {
    assert.throws(() => telemetry.startTrace(invalidTraceName), /trace name is invalid/);
  }

  const trace = telemetry.startTrace("http_request");
  trace.end();
  assert.equal(telemetry.snapshot().traces[0].name, "http_request");
});
