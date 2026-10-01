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

test("OpenAI-compatible provider reports unauthorized without exposing credentials", async () => {
  const provider = new OpenAiCompatibleProvider({
    baseUrl: "http://provider.example",
    apiKey: "server-only-test-key",
    model: "test-model",
    fetchImpl: async () => ({ ok: false, status: 401 }),
  });

  await assert.rejects(
    () => provider.complete({ feature: "concept_explanation", input: "请解释极限", maxOutputTokens: 100 }),
    (error) => {
      assert.equal(error.code, "DEPENDENCY_UNAVAILABLE");
      assert.equal(error.metadata.providerReasonCode, "provider_unauthorized");
      assert.equal(error.metadata.providerStatus, 401);
      assert.doesNotMatch(JSON.stringify(error), /server-only-test-key/);
      return true;
    },
  );
});

test("OpenAI-compatible provider health probe reports unauthorized without generating a completion", async () => {
  const calls = [];
  const provider = new OpenAiCompatibleProvider({
    baseUrl: "http://provider.example/v1",
    apiKey: "server-only-test-key",
    model: "test-model",
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method, body: options.body });
      return { ok: false, status: 403 };
    },
  });

  assert.deepEqual(await provider.healthCheck(), { status: "unavailable", reason_code: "provider_unauthorized" });
  assert.deepEqual(calls, [{ url: "http://provider.example/v1/models", method: "GET", body: undefined }]);
});
