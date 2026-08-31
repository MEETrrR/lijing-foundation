const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "../..");

function readRequired(relativePath) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  assert.ok(fs.existsSync(absolutePath), `required contract is missing: ${relativePath}`);
  return fs.readFileSync(absolutePath, "utf8");
}

function parseScalar(value) {
  const trimmed = value.trim();

  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) return JSON.parse(trimmed);
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

// This intentionally supports the small YAML subset used by the policy file.
// It keeps the baseline runnable without pulling a package manager into a new repo.
function parsePolicyYaml(source) {
  const lines = source.split(/\r?\n/);
  const root = {};
  const stack = [{ indent: -1, value: root }];

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    if (!rawLine.trim() || rawLine.trim().startsWith("#") || rawLine.trim() === "---") continue;

    const indent = rawLine.length - rawLine.trimStart().length;
    const content = rawLine.trim();
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();

    if (content.startsWith("- ")) {
      const list = stack[stack.length - 1].value;
      assert.ok(Array.isArray(list), `invalid policy list indentation near line ${index + 1}`);
      list.push(parseScalar(content.slice(2)));
      continue;
    }

    const match = content.match(/^([^:]+):(?:\s*(.*))?$/);
    assert.ok(match, `unsupported policy YAML near line ${index + 1}`);
    const key = match[1].trim();
    const rawValue = match[2] ?? "";
    const parent = stack[stack.length - 1].value;

    if (rawValue) {
      parent[key] = parseScalar(rawValue);
      continue;
    }

    let nextMeaningfulLine;
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      if (!lines[nextIndex].trim() || lines[nextIndex].trim().startsWith("#")) continue;
      nextMeaningfulLine = lines[nextIndex];
      break;
    }
    const nextIndent = nextMeaningfulLine
      ? nextMeaningfulLine.length - nextMeaningfulLine.trimStart().length
      : -1;
    const child = nextMeaningfulLine && nextIndent > indent && nextMeaningfulLine.trim().startsWith("- ")
      ? []
      : {};
    parent[key] = child;
    stack.push({ indent, value: child });
  }

  return root;
}

function getAtPath(value, dottedPath) {
  return dottedPath.split(".").reduce((current, segment) => current?.[segment], value);
}

test("OpenAPI defines a versioned server contract with write protection metadata", () => {
  const source = readRequired("packages/contracts/openapi.yaml");

  assert.match(source, /^openapi:\s*3\.1\.0\s*$/m);
  assert.match(source, /^  \/api\/v1\/health:\s*$/m);
  assert.match(source, /^  \/api\/v1\/learning\/attempts:\s*$/m);
  const pathBlocks = source
    .split(/^  (?=\/api\/v1\/)/m)
    .filter((block) => block.startsWith("/api/v1/"));
  const writeBlocks = pathBlocks.filter((block) => /\n    (?:post|put|patch|delete):\s*\n/.test(block));
  assert.ok(writeBlocks.length > 0, "the API must expose at least one write use case");
  for (const block of writeBlocks) {
    assert.match(block, /request_id:/);
    assert.match(block, /components\/parameters\/IdempotencyKey/);
  }
  assert.match(source, /required:\s*true/);
  assert.match(source, /name:\s*Idempotency-Key/);
  assert.match(source, /description:.*server-authoritative/i);
  assert.doesNotMatch(source, /\b(?:postgres|sql|database_table|table_name)\b/i);
});

test("event envelope requires the stable routing and audit fields", () => {
  const source = readRequired("packages/contracts/events/event-envelope.schema.json");
  const schema = JSON.parse(source);
  const requiredFields = [
    "event_id",
    "event_type",
    "event_version",
    "aggregate_type",
    "aggregate_id",
    "actor_id",
    "request_id",
    "occurred_at",
    "schema_version",
    "payload",
  ];

  assert.deepEqual(schema.required, requiredFields);
  for (const field of requiredFields) assert.ok(schema.properties?.[field], `missing event property: ${field}`);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.payload.type, "object");
});

test("AI policy is versioned, auditable, configurable, and contains abuse limits", () => {
  const policy = parsePolicyYaml(readRequired("packages/ai-policy/default-policy.yaml"));

  assert.equal(typeof policy.policy_version, "string");
  assert.equal(typeof policy.effective_from, "string");
  assert.equal(typeof policy.server_configurable, "boolean");
  assert.equal(policy.server_configurable, true);
  assert.equal(typeof policy.audit?.updated_by, "string");
  assert.equal(typeof policy.audit?.change_reason, "string");

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
    assert.equal(getAtPath(policy, fieldPath), expectedValue, `unexpected or missing policy value: ${fieldPath}`);
  }

  assert.equal(getAtPath(policy, "limits.account.new_account_first_24h.window"), "24h");
  assert.equal(getAtPath(policy, "limits.account.normal.window"), "24h");
  assert.equal(getAtPath(policy, "limits.burst.window"), "10m");
  assert.deepEqual(getAtPath(policy, "limits.burst.dimensions"), ["account", "device", "ip"]);
  assert.equal(getAtPath(policy, "limits.complex_requests.preferred_execution"), "async");
  assert.deepEqual(getAtPath(policy, "limits.complex_requests.modes"), ["vision", "long_context"]);
});
