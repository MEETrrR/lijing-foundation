import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadImageConfig, redactedSummary } from "../../tools/image-generation/config.mjs";
import { parseArgs, runGenerate } from "../../tools/image-generation/cli.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
function env(overrides = {}) { return { IMAGE_GENERATION_PROVIDER: "gpt", GPT_IMAGE_API_ENDPOINT: "https://gpt.example.test/images", GPT_IMAGE_API_KEY: "test-secret", GPT_IMAGE_MODEL: "gpt-image-test", GPT_IMAGE_AUTH_HEADER: "Authorization", GPT_IMAGE_AUTH_PREFIX: "Bearer", ...overrides }; }
async function tempOutput(callback) { const dir = await mkdtemp(path.join(repoRoot, ".image-generation-test-")); try { return await callback(dir); } finally { await rm(dir, { recursive: true, force: true }); } }

test("loads config and redacts secrets", () => {
  const summary = redactedSummary(loadImageConfig({ env: env(), envFilePath: null }));
  assert.equal(summary.provider, "gpt");
  assert.equal(summary.hasApiKey, true);
  assert.equal(summary.model, "gpt-image-test");
  assert.doesNotMatch(JSON.stringify(summary), /test-secret/);
});

test("rejects invalid endpoint and missing selected key", () => {
  assert.throws(() => loadImageConfig({ env: env({ GPT_IMAGE_API_ENDPOINT: "ftp://bad", GPT_IMAGE_API_KEY: "" }), envFilePath: null }), /GPT_IMAGE_API_ENDPOINT must be an http or https URL/);
  assert.throws(() => loadImageConfig({ env: env({ GPT_IMAGE_API_KEY: "", GPT_IMAGE_API_ENDPOINT: "https://ok.test" }), envFilePath: null }), /GPT_IMAGE_API_KEY is required/);
});

test("posts auth and body, then saves base64 response", async () => {
  await tempOutput(async (dir) => {
    let request;
    const fetchImpl = async (url, init) => { request = { url, init }; return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("image-bytes").toString("base64") }] }), { status: 200 }); };
    const output = path.relative(repoRoot, path.join(dir, "image.png")).replaceAll(path.sep, "/");
    const saved = await runGenerate({ env: env(), envFilePath: null, prompt: "a red kite", outputPath: output, size: "512x512", quality: "high", fetchImpl });
    assert.deepEqual(saved, [output]);
    assert.equal(request.url, "https://gpt.example.test/images");
    assert.deepEqual(JSON.parse(request.init.body), { model: "gpt-image-test", prompt: "a red kite", n: 1, size: "512x512", quality: "high" });
    assert.equal(new Headers(request.init.headers).get("authorization"), "Bearer test-secret");
    assert.equal((await readFile(path.join(dir, "image.png"))).toString(), "image-bytes");
  });
});

test("honors the output path parsed from the CLI", async () => {
  await tempOutput(async (dir) => {
    const parsed = parseArgs(["generate", "--prompt", "parsed path", "--output", path.relative(repoRoot, path.join(dir, "parsed.png"))]);
    const saved = await runGenerate({ ...parsed, env: env(), envFilePath: null, fetchImpl: async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("parsed").toString("base64") }] }), { status: 200 }) });
    assert.equal(saved[0], parsed.output.replaceAll(path.sep, "/"));
    assert.equal((await readFile(path.join(dir, "parsed.png"))).toString(), "parsed");
  });
});

test("reports provider status without leaking key or response", async () => {
  await tempOutput(async () => {
    const key = "private-key";
    await assert.rejects(runGenerate({ env: env({ GPT_IMAGE_API_KEY: key }), envFilePath: null, prompt: "failure", outputPath: "assets/generated/failure.png", fetchImpl: async () => new Response(`details ${key}`, { status: 429 }) }), (error) => /gpt.*429/.test(error.message) && !error.message.includes(key) && !error.message.includes("details"));
  });
});
