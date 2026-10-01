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

test("local client server keeps AI disabled honest and protects the formal AI route", async () => {
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
    assert.equal(health.ai_available, false);
    assert.equal(health.ai_status, "disabled");
    assert.match(healthResponse.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);

    const unauthenticatedAiResponse = await fetch(`${baseUrl}/api/v1/ai/assist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test" }),
    });
    assert.equal(unauthenticatedAiResponse.status, 401);

    const aiResponse = await fetch(`${baseUrl}/api/v1/ai/requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer dev-user-001-token", "Idempotency-Key": "local-ai-key-000001" },
      body: JSON.stringify({ request_id: "11111111-1111-4111-8111-111111111111", feature: "concept_explanation", input: "test" }),
    });
    assert.equal(aiResponse.status, 202);
    assert.equal((await aiResponse.json()).status, "degraded");

    const pageResponse = await fetch(`${baseUrl}/knowledge`);
    assert.equal(pageResponse.status, 200);
    assert.match(await pageResponse.text(), /<div id="app"><div class="boot-state" role="status"/);

    const cetPageResponse = await fetch(`${baseUrl}/cet`);
    assert.equal(cetPageResponse.status, 200);
    assert.match(await cetPageResponse.text(), /<div id="app">/);

    const missingPageResponse = await fetch(`${baseUrl}/missing-page`);
    assert.equal(missingPageResponse.status, 404);
    assert.match(await missingPageResponse.text(), /<div id="app">/);

    for (const publicRoute of ["/privacy", "/terms", "/contact"]) {
      const publicResponse = await fetch(`${baseUrl}${publicRoute}`);
      assert.equal(publicResponse.status, 200, publicRoute);
    }

    for (const privatePath of ["/README.md", "/package.json", "/apps/user_client/server.mjs"]) {
      const privateResponse = await fetch(`${baseUrl}${privatePath}`);
      assert.equal(privateResponse.status, 404, `private file should not be served: ${privatePath}`);
    }
    const sourceResponse = await fetch(`${baseUrl}/apps/user_client/src/main.js`);
    assert.equal(sourceResponse.status, 200);
    const faviconResponse = await fetch(`${baseUrl}/assets/generated/source/lijing-favicon.svg`);
    assert.equal(faviconResponse.status, 200);
    assert.equal(faviconResponse.headers.get("content-type"), "image/svg+xml");
    const assetResponse = await fetch(`${baseUrl}/assets/generated/source/lijing-horizon-ink-v1.png`);
    assert.equal(assetResponse.status, 200);
    assert.equal(assetResponse.headers.get("content-type"), "image/png");
    assert.equal(assetResponse.headers.get("cache-control"), "no-cache");
    assert.match(assetResponse.headers.get("etag") ?? "", /^W\//);
    const cachedAssetResponse = await fetch(`${baseUrl}/assets/generated/source/lijing-horizon-ink-v1.png`, {
      headers: { "If-None-Match": assetResponse.headers.get("etag") ?? "" },
    });
    assert.equal(cachedAssetResponse.status, 304);
    const stronglyCachedAssetResponse = await fetch(`${baseUrl}/assets/generated/source/lijing-horizon-ink-v1.png`, {
      headers: { "If-None-Match": (assetResponse.headers.get("etag") ?? "").replace(/^W\//, "") },
    });
    assert.equal(stronglyCachedAssetResponse.status, 304);
    const compressedSourceResponse = await fetch(`${baseUrl}/apps/user_client/src/styles.css`, {
      headers: { "Accept-Encoding": "gzip" },
    });
    assert.equal(compressedSourceResponse.headers.get("content-encoding"), "gzip");
    assert.equal(compressedSourceResponse.headers.get("vary"), "Accept-Encoding");
    const brotliSourceResponse = await fetch(`${baseUrl}/apps/user_client/src/styles.css`, {
      headers: { "Accept-Encoding": "br, gzip" },
    });
    assert.equal(brotliSourceResponse.headers.get("content-encoding"), "br");
    assert.equal(brotliSourceResponse.headers.get("vary"), "Accept-Encoding");
    const cachedSourceResponse = await fetch(`${baseUrl}/apps/user_client/src/styles.css`, {
      headers: { "If-Modified-Since": brotliSourceResponse.headers.get("last-modified") ?? "" },
    });
    assert.equal(cachedSourceResponse.status, 304);
    const cachedSourceByTagResponse = await fetch(`${baseUrl}/apps/user_client/src/styles.css`, {
      headers: { "If-None-Match": brotliSourceResponse.headers.get("etag") ?? "" },
    });
    assert.equal(cachedSourceByTagResponse.status, 304);
    const cachedSourceByBothValidatorsResponse = await fetch(`${baseUrl}/apps/user_client/src/styles.css`, {
      headers: {
        "If-None-Match": brotliSourceResponse.headers.get("etag") ?? "",
        "If-Modified-Since": brotliSourceResponse.headers.get("last-modified") ?? "",
      },
    });
    assert.equal(cachedSourceByBothValidatorsResponse.status, 304);
    const openingVideoResponse = await fetch(`${baseUrl}/assets/generated/source/opening/ink_longfeng_clean_1920x1080_24fps.mp4`);
    assert.equal(openingVideoResponse.status, 200);
    assert.equal(openingVideoResponse.headers.get("content-type"), "video/mp4");
    assert.equal(openingVideoResponse.headers.get("accept-ranges"), "bytes");
    assert.equal(openingVideoResponse.headers.get("cache-control"), "public, max-age=86400");
    const openingVideoRangeResponse = await fetch(`${baseUrl}/assets/generated/source/opening/ink_longfeng_clean_1920x1080_24fps.mp4`, {
      headers: { Range: "bytes=0-1023" },
    });
    assert.equal(openingVideoRangeResponse.status, 206);
    assert.equal(openingVideoRangeResponse.headers.get("content-range"), "bytes 0-1023/3676198");
    assert.equal((await openingVideoRangeResponse.arrayBuffer()).byteLength, 1024);
  } finally {
    child.kill();
    await wait(25);
  }
});
