const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const YAML = require("yaml");
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");
const { createConfig, lintFromString } = require("@redocly/openapi-core");

const repositoryRoot = path.resolve(__dirname, "../..");
const openApiPath = path.join(repositoryRoot, "packages/contracts/openapi.yaml");
const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
const WRITE_METHODS = new Set(["put", "post", "delete", "patch"]);
const openApiConfigPromise = createConfig(
  { extends: ["recommended"] },
  { configPath: openApiPath },
);

function readRequired(relativePath) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  assert.ok(fs.existsSync(absolutePath), `required contract is missing: ${relativePath}`);
  return fs.readFileSync(absolutePath, "utf8");
}

function parseStrictYaml(source, label) {
  const document = YAML.parseDocument(source, {
    prettyErrors: true,
    strict: true,
    stringKeys: true,
    uniqueKeys: true,
    version: "1.2",
    schema: "core",
  });
  const diagnostics = [...document.errors, ...document.warnings];
  if (diagnostics.length > 0) {
    const details = diagnostics.map((diagnostic) => diagnostic.message).join("; ");
    assert.fail(`${label} YAML parse failed: ${details}`);
  }

  const value = document.toJS({ maxAliasCount: 0 });
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be a YAML mapping`);
  return value;
}

function formatOpenApiProblems(problems) {
  return problems
    .filter((problem) => !problem.ignored)
    .map((problem) => `${problem.severity}:${problem.ruleId}:${problem.message}`)
    .join("\n");
}

async function parseAndValidateOpenApi(source) {
  const parsed = parseStrictYaml(source, "OpenAPI");
  const config = await openApiConfigPromise;
  const problems = await lintFromString({
    source,
    absoluteRef: openApiPath,
    config,
  });
  assert.equal(problems.filter((problem) => !problem.ignored).length, 0, formatOpenApiProblems(problems));
  return parsed;
}

function listOperations(api) {
  return Object.entries(api.paths ?? {}).flatMap(([pathTemplate, pathItem]) =>
    Object.entries(pathItem)
      .filter(([method]) => HTTP_METHODS.has(method))
      .map(([method, operation]) => ({ method, operation, pathTemplate })),
  );
}

function collectLocalRefs(value, refs = []) {
  if (!value || typeof value !== "object") return refs;
  if (typeof value.$ref === "string" && value.$ref.startsWith("#/")) refs.push(value.$ref);
  for (const child of Object.values(value)) collectLocalRefs(child, refs);
  return refs;
}

function resolveLocalRef(root, ref) {
  if (!ref.startsWith("#/")) return undefined;
  return ref
    .slice(2)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((current, segment) => current?.[segment], root);
}

function createJsonSchemaValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  // OpenAPI's discriminator is an annotation; oneOf and const perform validation.
  ajv.addKeyword({ keyword: "discriminator", schemaType: "object" });
  return ajv;
}

function rewriteOpenApiRefs(value) {
  if (Array.isArray(value)) return value.map(rewriteOpenApiRefs);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (key === "$ref" && typeof child === "string" && child.startsWith("#/components/schemas/")) {
      return [key, child.replace("#/components/schemas/", "#/$defs/")];
    }
    return [key, rewriteOpenApiRefs(child)];
  }));
}

function compileOpenApiSchema(api, schemaName) {
  const ajv = createJsonSchemaValidator();
  const definitions = rewriteOpenApiRefs(api.components.schemas);
  return ajv.compile({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://contracts.example.invalid/lijing/openapi/${schemaName}.schema.json`,
    $ref: `#/$defs/${schemaName}`,
    $defs: definitions,
  });
}

function schemaErrorText(validate) {
  return JSON.stringify(validate.errors ?? [], null, 2);
}

function compileEventEnvelopeSchema() {
  const ajv = createJsonSchemaValidator();
  return ajv.compile(JSON.parse(readRequired("packages/contracts/events/event-envelope.schema.json")));
}

test("OpenAPI is parsed and validated as a versioned, secured use-case contract", async () => {
  const api = await parseAndValidateOpenApi(readRequired("packages/contracts/openapi.yaml"));

  assert.equal(api.openapi, "3.1.0");
  assert.equal(typeof api.info?.title, "string");
  assert.equal(typeof api.info?.version, "string");
  assert.ok(api.paths && typeof api.paths === "object");
  assert.ok(Object.keys(api.paths).length > 0);
  assert.ok(Object.keys(api.paths).every((pathTemplate) => pathTemplate.startsWith("/api/v1/")));
  assert.doesNotMatch(JSON.stringify(api.paths), /\b(?:postgres|sql|database_table|table_name)\b/i);

  const idempotencyParameter = api.components?.parameters?.IdempotencyKey;
  assert.deepEqual(
    {
      name: idempotencyParameter?.name,
      in: idempotencyParameter?.in,
      required: idempotencyParameter?.required,
    },
    { name: "Idempotency-Key", in: "header", required: true },
  );

  const operations = listOperations(api);
  assert.ok(operations.length > 0);
  for (const { method, operation, pathTemplate } of operations) {
    assert.ok(operation.responses && typeof operation.responses === "object");
    if (pathTemplate === "/api/v1/health") {
      assert.deepEqual(operation.security, []);
    } else {
      assert.ok(Array.isArray(operation.security) && operation.security.length > 0);
      assert.ok(operation.security.some((requirement) => Object.hasOwn(requirement, "bearerAuth")));
    }

    if (!WRITE_METHODS.has(method)) continue;
    const requestSchema = operation.requestBody?.content?.["application/json"]?.schema;
    assert.ok(requestSchema, `${method.toUpperCase()} ${pathTemplate} must define a JSON request schema`);
    assert.ok(requestSchema.required?.includes("request_id"), `${method.toUpperCase()} ${pathTemplate} must require request_id`);
    assert.ok(operation.parameters?.some((parameter) => parameter.$ref === "#/components/parameters/IdempotencyKey"));
    assert.ok(operation.responses?.["401"], `${method.toUpperCase()} ${pathTemplate} must define 401`);
    assert.ok(operation.responses?.["403"], `${method.toUpperCase()} ${pathTemplate} must define 403`);
  }

  const refs = collectLocalRefs(api);
  assert.ok(refs.length > 0);
  for (const ref of refs) assert.notEqual(resolveLocalRef(api, ref), undefined, `unresolved local ref: ${ref}`);
  assert.ok(api.components?.schemas?.ErrorResponse);
});

test("OpenAPI parser and validator reject malformed YAML and unresolved references", async () => {
  assert.throws(
    () => parseStrictYaml("openapi: 3.1.0\nopenapi: 3.1.1\n", "duplicate fixture"),
    /YAML parse failed/,
  );

  await assert.rejects(
    () => parseAndValidateOpenApi("openapi: ["),
    /YAML parse failed/,
  );

  const source = readRequired("packages/contracts/openapi.yaml");
  const brokenReference = source.replace(
    "#/components/schemas/ProgressResponse",
    "#/components/schemas/MissingProgressResponse",
  );
  await assert.rejects(
    () => parseAndValidateOpenApi(brokenReference),
    /error:no-unresolved-refs|unresolved/i,
  );
});

test("AI response variants require completed data only for completed status", async () => {
  const api = await parseAndValidateOpenApi(readRequired("packages/contracts/openapi.yaml"));
  const response = api.components.schemas.AiRequestResponse;
  const schemas = api.components.schemas;
  const expectedVariants = [
    "#/components/schemas/AiRequestAcceptedResponse",
    "#/components/schemas/AiRequestQueuedResponse",
    "#/components/schemas/AiRequestCompletedResponse",
    "#/components/schemas/AiRequestDegradedResponse",
    "#/components/schemas/AiRequestRejectedResponse",
  ];

  assert.deepEqual(response.oneOf.map((variant) => variant.$ref), expectedVariants);
  assert.equal(response.discriminator.propertyName, "status");
  assert.ok(schemas.AiResult);

  const validate = compileOpenApiSchema(api, "AiRequestResponse");
  const validFixtures = [
    {
      request_id: "11111111-1111-4111-8111-111111111111",
      status: "accepted",
      policy_version: "2026-08-31.1",
    },
    {
      request_id: "22222222-2222-4222-8222-222222222222",
      status: "queued",
      policy_version: "2026-08-31.1",
      poll_after_seconds: 5,
    },
    {
      request_id: "33333333-3333-4333-8333-333333333333",
      status: "completed",
      policy_version: "2026-08-31.1",
      result: { text: "Review the worked example.", source_type: "reviewed_content" },
    },
    {
      request_id: "44444444-4444-4444-8444-444444444444",
      status: "degraded",
      policy_version: "2026-08-31.1",
      fallback_mode: "template",
    },
    {
      request_id: "55555555-5555-4555-8555-555555555555",
      status: "rejected",
      policy_version: "2026-08-31.1",
      reason_code: "quota_exhausted",
    },
  ];
  for (const fixture of validFixtures) {
    assert.equal(validate(fixture), true, `valid AI response fixture was rejected: ${schemaErrorText(validate)}`);
  }
  const completedWithoutResult = {
    request_id: "66666666-6666-4666-8666-666666666666",
    status: "completed",
    policy_version: "2026-08-31.1",
  };
  assert.equal(validate(completedWithoutResult), false);

  for (const status of ["accepted", "queued", "completed", "degraded", "rejected"]) {
    const schemaName = `AiRequest${status[0].toUpperCase()}${status.slice(1)}Response`;
    const schema = schemas[schemaName];
    assert.equal(schema.properties.status.const, status);
    if (status === "completed") {
      assert.ok(schema.required.includes("result"));
      assert.equal(schema.properties.result.$ref, "#/components/schemas/AiResult");
    } else {
      assert.ok(!schema.required?.includes("result"));
      assert.equal(schema.properties?.result, undefined);
    }
  }
});

test("learning settlement and write intent schemas are explicit", async () => {
  const api = await parseAndValidateOpenApi(readRequired("packages/contracts/openapi.yaml"));
  const attemptRequest = api.paths["/api/v1/learning/attempts"].post.requestBody.content["application/json"].schema;
  const settlement = api.components.schemas.LearningAttemptResponse.properties.settlement;
  const rewardSummary = api.components.schemas.RewardSummary;
  const energySettlement = api.components.schemas.EnergySettlement;

  assert.ok(attemptRequest.required.includes("action"));
  assert.equal(settlement.properties.reward_summary.$ref, "#/components/schemas/RewardSummary");
  assert.equal(settlement.properties.energy.$ref, "#/components/schemas/EnergySettlement");
  assert.deepEqual(rewardSummary.required, ["experience", "coins", "item_ids"]);
  assert.equal(rewardSummary.properties.experience.type, "integer");
  assert.equal(rewardSummary.properties.coins.type, "integer");
  assert.equal(rewardSummary.properties.item_ids.type, "array");
  assert.deepEqual(energySettlement.required, ["current", "maximum", "delta"]);
  assert.equal(energySettlement.properties.current.type, "integer");
  assert.equal(energySettlement.properties.maximum.type, "integer");
  assert.equal(energySettlement.properties.delta.type, "integer");
});

test("event envelope compiles as Draft 2020-12 and rejects missing or extra fields", () => {
  const validate = compileEventEnvelopeSchema();
  const validEnvelope = {
    event_id: "77777777-7777-4777-8777-777777777777",
    event_type: "MasteryUpdated",
    event_version: 1,
    aggregate_type: "knowledge_point",
    aggregate_id: "kp-001",
    actor_id: "account-001",
    request_id: "88888888-8888-4888-8888-888888888888",
    occurred_at: "2026-08-31T04:00:00.000Z",
    schema_version: "1.0.0",
    payload: { state: "LEARNING", rule_version: "mastery-1" },
  };

  assert.equal(validate(validEnvelope), true, schemaErrorText(validate));

  const missingRequestId = { ...validEnvelope };
  delete missingRequestId.request_id;
  assert.equal(validate(missingRequestId), false);
  assert.ok(validate.errors.some((error) =>
    error.keyword === "required" && error.params.missingProperty === "request_id",
  ));

  const extraProperty = { ...validEnvelope, unexpected: "must be rejected" };
  assert.equal(validate(extraProperty), false);
  assert.ok(validate.errors.some((error) =>
    error.keyword === "additionalProperties" && error.params.additionalProperty === "unexpected",
  ));
});

test("AI policy uses strict YAML and includes security, fallback, and governance controls", () => {
  const policy = parseStrictYaml(readRequired("packages/ai-policy/default-policy.yaml"), "AI policy");

  assert.equal(typeof policy.policy_id, "string");
  assert.equal(typeof policy.policy_version, "string");
  assert.match(policy.policy_version, /^\d{4}-\d{2}-\d{2}\.\d+$/);
  assert.equal(typeof policy.effective_from, "string");
  assert.ok(!Number.isNaN(Date.parse(policy.effective_from)));
  assert.ok(policy.effective_until === null || typeof policy.effective_until === "string");
  assert.equal(policy.status, "active");
  assert.equal(policy.server_configurable, true);

  assert.equal(policy.controls.require_authentication, true);
  assert.equal(policy.controls.require_idempotency_key, true);
  assert.equal(policy.controls.allow_direct_provider_access, false);
  assert.equal(policy.controls.allow_unbounded_retry, false);
  assert.equal(policy.controls.output_validation_required, true);
  assert.equal(policy.controls.source_provenance_required, true);
  assert.equal(policy.controls.global_kill_switch, true);
  assert.deepEqual(policy.controls.fallback_modes, ["template", "cached", "low_cost_model", "async_queue"]);

  assert.equal(typeof policy.audit.owner, "string");
  assert.equal(typeof policy.audit.updated_by, "string");
  assert.equal(typeof policy.audit.reviewed_by, "string");
  assert.equal(typeof policy.audit.change_reason, "string");
  assert.equal(typeof policy.audit.change_ticket, "string");
  assert.equal(typeof policy.governance.storage_owner, "string");
  assert.ok(Array.isArray(policy.governance.changes_require));
  for (const field of ["policy_version", "effective_from", "updated_by", "change_reason", "change_ticket", "rollback_policy_version", "audit_event"]) {
    assert.ok(policy.governance.changes_require.includes(field), `missing governance field: ${field}`);
  }

  const expectedLimits = {
    "limits.account.new_account_first_24h.max_requests": 5,
    "limits.account.normal.max_requests": 20,
    "limits.burst.max_requests": 3,
    "limits.concurrency.per_user": 1,
    "limits.tokens.max_input": 4000,
    "limits.tokens.max_output": 1000,
    "limits.images.max_images_per_request": 2,
    "limits.images.max_size_mb_each": 5,
    "limits.complex_requests.max_per_day": 3,
  };
  for (const [fieldPath, expectedValue] of Object.entries(expectedLimits)) {
    const actualValue = fieldPath.split(".").reduce((current, segment) => current?.[segment], policy);
    assert.equal(actualValue, expectedValue, `unexpected or missing policy value: ${fieldPath}`);
  }
  assert.deepEqual(policy.limits.burst.dimensions, ["account", "device", "ip"]);
  assert.deepEqual(policy.limits.complex_requests.modes, ["vision", "long_context"]);
  assert.equal(policy.limits.complex_requests.preferred_execution, "async");
});
