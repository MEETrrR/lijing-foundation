import test from "node:test";
import assert from "node:assert/strict";

const { OpenAiCompatibleProvider } = await import("../../services/api/src/domains/ai-gateway/ai-gateway-service.ts");

test("OpenAI-compatible provider defaults a host-only base URL to its v1 API path", async () => {
  const calls = [];
  const provider = new OpenAiCompatibleProvider({
    baseUrl: "http://provider.example",
    apiKey: "server-only-test-key",
    model: "test-model",
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, async json() { return { choices: [{ message: { content: "可以" } }] }; } };
    },
  });

  await provider.complete({ feature: "concept_explanation", input: "请解释极限", maxOutputTokens: 100 });

  assert.equal(calls[0], "http://provider.example/v1/chat/completions");
});
