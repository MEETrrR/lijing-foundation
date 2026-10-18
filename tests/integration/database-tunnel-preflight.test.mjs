import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { ensureDatabaseTunnel, readTunnelConfig } from "../../scripts/ensure-database-tunnel.mjs";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

test("database tunnel preflight is disabled when no tunnel port is configured", async () => {
  assert.equal(readTunnelConfig({}), null);
  assert.deepEqual(await ensureDatabaseTunnel({ env: {}, autoStart: false }), { configured: false, verified: false, started: false });
});

test("database tunnel preflight accepts a listening local tunnel", async () => {
  const server = net.createServer();
  const port = await listen(server);
  try {
    const result = await ensureDatabaseTunnel({ env: { SUPABASE_DATABASE_TUNNEL_PORT: String(port) }, autoStart: false });
    assert.equal(result.configured, true);
    assert.equal(result.verified, true);
    assert.equal(result.started, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("database tunnel preflight fails clearly when the configured port is down", async () => {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  await assert.rejects(
    ensureDatabaseTunnel({ env: { SUPABASE_DATABASE_TUNNEL_PORT: String(port) }, autoStart: false }),
    /数据库隧道不可用.*127\.0\.0\.1/,
  );
});
