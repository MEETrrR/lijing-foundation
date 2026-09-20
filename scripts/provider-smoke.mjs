import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { OpenAiCompatibleProvider } = require("../services/api/src/domains/ai-gateway/ai-gateway-service.ts");

const requestCount = Number(process.env.AI_SMOKE_REQUESTS ?? 20);
const intervalMs = Number(process.env.AI_SMOKE_INTERVAL_MS ?? 250);
const baseUrl = process.env.AI_PROVIDER_BASE_URL;
const apiKey = process.env.AI_PROVIDER_API_KEY;
const model = process.env.AI_MODEL;

if (!baseUrl || !apiKey || !model) {
  throw new Error("AI_PROVIDER_BASE_URL, AI_PROVIDER_API_KEY, and AI_MODEL are required for provider smoke");
}
if (!Number.isInteger(requestCount) || requestCount < 1 || requestCount > 100) throw new Error("AI_SMOKE_REQUESTS must be an integer from 1 to 100");
if (!Number.isInteger(intervalMs) || intervalMs < 0 || intervalMs > 60000) throw new Error("AI_SMOKE_INTERVAL_MS must be an integer from 0 to 60000");

const provider = new OpenAiCompatibleProvider({
  baseUrl,
  apiKey,
  model,
  timeoutMs: Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 75000),
});

let completed = 0;
let failed = 0;
let totalLatencyMs = 0;
const failures = [];

for (let index = 0; index < requestCount; index += 1) {
  const startedAt = Date.now();
  try {
    const result = await provider.complete({
      feature: "material_diagnosis",
      input: JSON.stringify({
        prompt: "只返回一句简短的学习行动建议，不要声称用户已经掌握。",
        materials: [{ artifact_id: "smoke-artifact", chunk_id: "chunk-1", excerpt: "函数在 x=0 附近的左右极限需要分别核对。" }],
      }),
      systemPrompt: "你是一个 Provider 连通性烟测。只输出一句非空文本，不要输出敏感信息。",
      maxOutputTokens: 120,
    });
    if (typeof result?.text !== "string" || !result.text.trim()) throw new Error("empty provider output");
    completed += 1;
  } catch (error) {
    failed += 1;
    failures.push(error?.code ?? "provider_error");
  } finally {
    totalLatencyMs += Date.now() - startedAt;
  }
  if (index < requestCount - 1 && intervalMs > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

const successRate = completed / requestCount;
const result = {
  requests: requestCount,
  completed,
  failed,
  success_rate: Number(successRate.toFixed(4)),
  average_latency_ms: Math.round(totalLatencyMs / requestCount),
  failure_codes: [...new Set(failures)],
};
process.stdout.write(`${JSON.stringify(result)}\n`);
if (successRate < 0.95) process.exitCode = 1;
