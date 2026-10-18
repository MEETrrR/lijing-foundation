import net from "node:net";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

function parsePort(value, name) {
  const port = Number(String(value ?? "").trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${name} must be a valid TCP port`);
  return port;
}

export function readTunnelConfig(env = process.env) {
  const rawPort = String(env.SUPABASE_DATABASE_TUNNEL_PORT ?? "").trim();
  if (!rawPort) return null;
  return {
    alias: String(env.SUPABASE_DATABASE_TUNNEL_ALIAS ?? "aliyun-wuhan").trim(),
    localPort: parsePort(rawPort, "SUPABASE_DATABASE_TUNNEL_PORT"),
    remoteHost: String(env.SUPABASE_DATABASE_TUNNEL_REMOTE_HOST ?? "127.0.0.1").trim(),
    remotePort: parsePort(env.SUPABASE_DATABASE_TUNNEL_REMOTE_PORT ?? "33989", "SUPABASE_DATABASE_TUNNEL_REMOTE_PORT"),
  };
}

function canConnect(port, host = "127.0.0.1", timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function tunnelScriptCandidates(env) {
  const candidates = [];
  if (env.SSH_TUNNEL_SCRIPT) candidates.push(env.SSH_TUNNEL_SCRIPT);
  const homes = [env.CODEX_HOME, path.join(os.homedir(), ".codex"), path.join(os.homedir(), ".claude")].filter(Boolean);
  for (const home of homes) candidates.push(path.join(home, "skills", "ssh-skill", "scripts", "ssh_tunnel.py"));
  return [...new Set(candidates)].filter((candidate) => existsSync(candidate));
}

function runTunnelCommand(script, args, env = process.env) {
  const interpreters = [];
  if (env.PYTHON) interpreters.push([env.PYTHON, []]);
  interpreters.push(["python", []], ["py", ["-3"]]);
  const failures = [];
  for (const [command, prefix] of interpreters) {
    const result = spawnSync(command, [...prefix, script, ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      env,
    });
    if (result.error) {
      failures.push(`${command}: ${result.error.message}`);
      continue;
    }
    const output = `${result.stdout ?? ""}`.trim();
    if (result.status === 0) return output ? JSON.parse(output) : {};
    failures.push(output || `${command} exited with code ${result.status}`);
  }
  throw new Error(`无法调用 SSH 隧道工具：${failures.join(" | ")}`);
}

function findTunnel(script, config, env) {
  const result = runTunnelCommand(script, ["list"], env);
  return (result.tunnels ?? []).find((tunnel) => (
    tunnel.alias === config.alias
    && Number(tunnel.local_port) === config.localPort
    && Number(tunnel.remote_port) === config.remotePort
    && String(tunnel.remote_host) === config.remoteHost
  ));
}

async function waitForPort(port, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

export async function ensureDatabaseTunnel({ env = process.env, autoStart = true } = {}) {
  const config = readTunnelConfig(env);
  if (!config) return { configured: false, verified: false, started: false };
  if (await canConnect(config.localPort)) return { configured: true, verified: true, started: false, config };
  if (!autoStart) {
    throw new Error(`数据库隧道不可用：127.0.0.1:${config.localPort} 没有监听。请先启动 ${config.alias} 到远程 ${config.remoteHost}:${config.remotePort} 的 SSH 隧道。`);
  }

  const script = tunnelScriptCandidates(env)[0];
  if (!script) {
    throw new Error("数据库隧道不可用，且未找到 ssh-skill 的 ssh_tunnel.py。请安装或配置 SSH_TUNNEL_SCRIPT 后重试。");
  }
  const existingTunnel = findTunnel(script, config, env);
  if (!existingTunnel) {
    runTunnelCommand(script, [
      "start",
      config.alias,
      "--local-port",
      String(config.localPort),
      "--remote-host",
      config.remoteHost,
      "--remote-port",
      String(config.remotePort),
    ], env);
  }
  if (!(await waitForPort(config.localPort))) {
    throw new Error(`数据库隧道启动失败：${config.alias} 未能在 127.0.0.1:${config.localPort} 提供服务，请检查 SSH 配置和远程 PostgreSQL 状态。`);
  }
  return { configured: true, verified: true, started: !existingTunnel, config };
}
