import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const serverPath = path.join(repositoryRoot, "apps/user_client/server.mjs");

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function getFreePort() {
  const server = http.createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

async function waitForHealth(port) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
      if (response.ok) return response.json();
    } catch {
      // The child process may need a moment to bind its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("AI pilot server did not become healthy");
}

test("AI pilot calls the provider from the server and returns structured results", async () => {
  const providerCalls = [];
  const provider = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    providerCalls.push({
      authorization: request.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        evidence_used: "用户提交的学习证据",
        problem: "还缺少一次输出验证",
        reason: "当前证据只证明完成了学习时段",
        next_action: "明天完成一次三句话复述",
      }) } }],
    }));
  });
  const providerPort = await listen(provider);
  const appPort = await getFreePort();
  const child = spawn(process.execPath, [serverPath], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PORT: String(appPort),
      AI_ENABLED: "true",
      AI_PROVIDER_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
      AI_PROVIDER_API_KEY: "test-server-only-key",
      AI_MODEL: "test-model",
      AI_MAX_REQUESTS_PER_IP_PER_DAY: "20",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const health = await waitForHealth(appPort);
    assert.equal(health.ai_configured, true);

    const register = await fetch(`http://127.0.0.1:${appPort}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ai-pilot@example.com", password: "correct horse battery", display_name: "AI 试点" }),
    });
    assert.equal(register.status, 201);
    const cookie = (register.headers.get("set-cookie") ?? "").split(";", 1)[0];
    assert.ok(cookie.startsWith("lijing_session="));

    const invalidResponse = await fetch(`http://127.0.0.1:${appPort}/api/v1/ai/requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: "null",
    });
    assert.equal(invalidResponse.status, 422);

    const response = await fetch(`http://127.0.0.1:${appPort}/api/v1/ai/requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "Idempotency-Key": "ai-pilot-review-key-01" },
      body: JSON.stringify({ request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", feature: "wrong_answer_hint", input: JSON.stringify({ task: "当前学习任务", evidence_level: 2, evidence: "我写下了概念边界和一个反例。" }) }),
    });
    const body = await response.json();
    assert.equal(response.status, 202);
    assert.deepEqual(JSON.parse(body.result.text), {
      evidence_used: "用户提交的学习证据",
      problem: "还缺少一次输出验证",
      reason: "当前证据只证明完成了学习时段",
      next_action: "明天完成一次三句话复述",
    });
    assert.equal(providerCalls.length, 1);
    assert.equal(providerCalls[0].authorization, "Bearer test-server-only-key");
    assert.equal(providerCalls[0].body.model, "test-model");
    assert.doesNotMatch(JSON.stringify(body), /test-server-only-key/);

    const assistResponse = await fetch(`http://127.0.0.1:${appPort}/api/v1/ai/requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "Idempotency-Key": "ai-pilot-assist-key-01" },
      body: JSON.stringify({ request_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", feature: "concept_explanation", input: JSON.stringify({ prompt: "我总是把连续和可导混在一起。", context: { goal: "上岸一场重要考试", task: "极限与连续" } }) }),
    });
    const assistBody = await assistResponse.json();
    assert.equal(assistResponse.status, 202);
    assert.equal(assistBody.status, "completed");
    assert.equal(providerCalls[1].body.model, "test-model");
  } finally {
    child.kill();
    await close(provider);
  }
});
