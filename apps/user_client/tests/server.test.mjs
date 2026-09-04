import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const serverPath = fileURLToPath(new URL("../server.mjs", import.meta.url));
const repoRoot = path.resolve(path.dirname(serverPath), "../..");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(url, child) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // The server may still be binding its local port.
    }
    await wait(25);
  }
  throw new Error("server did not become ready");
}

test("local client server keeps AI disabled honest by default", async () => {
  const port = 4300 + Math.floor(Math.random() * 500);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      AI_ENABLED: "false",
      AI_PROVIDER_BASE_URL: "",
      AI_PROVIDER_API_KEY: "",
      AI_MODEL: "",
    },
    stdio: "ignore",
  });

  try {
    const healthResponse = await waitForHealth(`${baseUrl}/api/v1/health`, child);
    const health = await healthResponse.json();
    assert.equal(health.status, "ok");
    assert.equal(health.ai_configured, false);
    assert.match(healthResponse.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);

    const aiResponse = await fetch(`${baseUrl}/api/v1/ai/assist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test" }),
    });
    assert.equal(aiResponse.status, 503);
    assert.deepEqual(await aiResponse.json(), { error: "ai_not_configured", message: "AI 服务尚未配置" });

    const pageResponse = await fetch(`${baseUrl}/knowledge`);
    assert.equal(pageResponse.status, 200);
    assert.match(await pageResponse.text(), /<div id="app"><\/div>/);

    for (const privatePath of ["/README.md", "/package.json", "/apps/user_client/server.mjs"]) {
      const privateResponse = await fetch(`${baseUrl}${privatePath}`);
      assert.equal(privateResponse.status, 404, `private file should not be served: ${privatePath}`);
    }
    const sourceResponse = await fetch(`${baseUrl}/apps/user_client/src/main.js`);
    assert.equal(sourceResponse.status, 200);
    const assetResponse = await fetch(`${baseUrl}/assets/generated/source/lijing-horizon-ink-v1.png`);
    assert.equal(assetResponse.status, 200);
  } finally {
    child.kill();
    await wait(25);
  }
});
