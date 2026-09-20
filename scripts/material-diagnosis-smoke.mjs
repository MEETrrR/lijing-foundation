import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const { createBackendServer } = require("../services/api/src/bootstrap/http-api.ts");
const { OpenAiCompatibleProvider } = require("../services/api/src/domains/ai-gateway/ai-gateway-service.ts");

const requestCount = Number(process.env.AI_SMOKE_REQUESTS ?? 20);
const intervalMs = Number(process.env.AI_SMOKE_INTERVAL_MS ?? 250);
const concurrency = Number(process.env.AI_SMOKE_CONCURRENCY ?? 2);
const baseUrl = process.env.AI_PROVIDER_BASE_URL;
const apiKey = process.env.AI_PROVIDER_API_KEY;
const model = process.env.AI_MODEL;

if (!baseUrl || !apiKey || !model) throw new Error("AI_PROVIDER_BASE_URL, AI_PROVIDER_API_KEY, and AI_MODEL are required for material diagnosis smoke");
if (!Number.isInteger(requestCount) || requestCount < 1 || requestCount > 100) throw new Error("AI_SMOKE_REQUESTS must be an integer from 1 to 100");
if (!Number.isInteger(intervalMs) || intervalMs < 0 || intervalMs > 60000) throw new Error("AI_SMOKE_INTERVAL_MS must be an integer from 0 to 60000");
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) throw new Error("AI_SMOKE_CONCURRENCY must be an integer from 1 to 10");

const provider = new OpenAiCompatibleProvider({
  baseUrl,
  apiKey,
  model,
  timeoutMs: Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 75000),
});
const smokeTokens = Object.fromEntries(Array.from({ length: requestCount }, (_, index) => [
  `material-smoke-token-${index + 1}`,
  `material-smoke-${index + 1}`,
]));
const { server } = createBackendServer({
  env: { ...process.env, APP_ENV: "test", NODE_ENV: "test" },
  provider,
  aiEnabled: true,
  persistence: "ephemeral",
  allowDevTokens: true,
  tokens: smokeTokens,
});

function request(base, token, path, options = {}) {
  return fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(90000),
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
}

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const outcomes = Array(requestCount);

async function runCase(index) {
  const token = `material-smoke-token-${index + 1}`;
  const artifactId = `artifact-smoke-${randomUUID()}`;
  const artifact = await request(base, token, "/api/v1/learning-artifacts", {
    method: "POST",
    headers: { "Idempotency-Key": `artifact-smoke-${randomUUID()}` },
    body: JSON.stringify({
      request_id: randomUUID(),
      artifact_id: artifactId,
      kind: "attempt_draft",
      subject: index % 2 === 0 ? "数学" : "408",
      source_title: index % 2 === 0 ? "极限与连续性草稿" : "链表删除草稿",
      content_text: index % 2 === 0
        ? "我认为函数在 x=0 处连续，但没有列出左右极限和函数值，不确定连续条件是否完整。"
        : "删除链表节点时我只写了修改 next 指针，忘记是否需要先找到前驱节点。",
    }),
  });
  if (artifact.status !== 201) return "artifact_write_failed";
  const diagnosis = await request(base, token, "/api/v1/companion/diagnoses", {
    method: "POST",
    headers: { "Idempotency-Key": `diagnosis-smoke-${randomUUID()}` },
    body: JSON.stringify({ request_id: randomUUID(), artifact_ids: [artifactId], focus: index % 2 === 0 ? "连续条件" : "链表删除步骤" }),
  });
  const observation = diagnosis.body?.diagnosis?.observations?.[0];
  return diagnosis.status === 200
    && diagnosis.body?.status === "ready"
    && diagnosis.body?.action?.origin === "artifact_diagnosis"
    && observation?.artifact_id === artifactId
    ? "ready"
    : diagnosis.body?.status === "degraded" ? "degraded" : "diagnosis_failed";
}

try {
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < requestCount) {
      const index = nextIndex;
      nextIndex += 1;
      outcomes[index] = await runCase(index);
      if (intervalMs > 0 && nextIndex < requestCount) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, requestCount) }, worker));
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const ready = outcomes.filter((outcome) => outcome === "ready").length;
const degraded = outcomes.filter((outcome) => outcome === "degraded").length;
const failureCodes = [...new Set(outcomes.filter((outcome) => outcome !== "ready"))];
const result = {
  requests: requestCount,
  concurrency: Math.min(concurrency, requestCount),
  ready,
  degraded,
  success_rate: Number((ready / requestCount).toFixed(4)),
  failure_codes: failureCodes,
};
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.success_rate < 0.95) process.exitCode = 1;
