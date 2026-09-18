import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createBackendHandler, createDefaultServices } = require("../../services/api/src/bootstrap/http-api.ts");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLIENT_ROOT = path.join(ROOT, "apps", "user_client");
const CLIENT_INDEX = path.join(CLIENT_ROOT, "index.html");
const CLIENT_SOURCE_ROOT = path.join(CLIENT_ROOT, "src");
const ASSET_SOURCE_ROOT = path.join(ROOT, "assets", "generated", "source");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4187);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".mp4": "video/mp4" };
const KNOWN_CLIENT_ROUTES = new Set(["/", "/404", "/features", "/auth", "/privacy", "/terms", "/contact", "/onboarding", "/goals", "/route", "/plan", "/study", "/review", "/knowledge", "/assistant", "/growth", "/map", "/profile", "/settings", "/state/loading", "/state/empty", "/state/error", "/state/review", "/state/permission"]);

function configureDatabaseTunnel(env) {
  const rawPort = typeof env.SUPABASE_DATABASE_TUNNEL_PORT === "string" ? env.SUPABASE_DATABASE_TUNNEL_PORT.trim() : "";
  if (!rawPort) return;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SUPABASE_DATABASE_TUNNEL_PORT must be a valid local port");
  if (typeof env.SUPABASE_DATABASE_URL !== "string" || !env.SUPABASE_DATABASE_URL.trim()) {
    throw new Error("SUPABASE_DATABASE_URL is required when using a database tunnel");
  }

  const databaseUrl = new URL(env.SUPABASE_DATABASE_URL);
  const certificateHost = databaseUrl.hostname.replace(/^\[|\]$/g, "");
  databaseUrl.hostname = "127.0.0.1";
  databaseUrl.port = String(port);
  env.SUPABASE_DATABASE_URL = databaseUrl.toString();
  if (typeof env.SUPABASE_DB_SSL_SERVER_NAME !== "string" || !env.SUPABASE_DB_SSL_SERVER_NAME.trim()) {
    env.SUPABASE_DB_SSL_SERVER_NAME = certificateHost;
  }
}

configureDatabaseTunnel(process.env);
const FORMAL_BACKEND_SERVICES = createDefaultServices({ env: process.env });
const formalBackendHandler = createBackendHandler(FORMAL_BACKEND_SERVICES);

if (process.env.SUPABASE_DATABASE_TUNNEL_PORT) {
  const databaseTunnelKeepalive = setInterval(() => {
    void FORMAL_BACKEND_SERVICES.database.healthCheck();
  }, 10 * 60 * 1000);
  databaseTunnelKeepalive.unref();
}

function safePath(requestUrl) {
  let rawPath;
  try {
    rawPath = decodeURIComponent(new URL(requestUrl, "http://127.0.0.1").pathname);
  } catch {
    return null;
  }
  const relative = rawPath === "/" ? "apps/user_client/index.html" : rawPath.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, relative);
  const isPublicFile = filePath === CLIENT_INDEX
    || filePath.startsWith(`${CLIENT_SOURCE_ROOT}${path.sep}`)
    || filePath.startsWith(`${ASSET_SOURCE_ROOT}${path.sep}`);
  if (isPublicFile) return filePath;
  if (!rawPath.startsWith("/assets/") && !path.extname(rawPath)) return CLIENT_INDEX;
  return null;
}

async function handler(request, response) {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  if (pathname.startsWith("/api/v1/")) {
    await formalBackendHandler(request, response);
    return;
  }
  let filePath = safePath(request.url);
  if (!filePath) { response.writeHead(404); response.end("Not found"); return; }
  if ((!existsSync(filePath) || !statSync(filePath).isFile()) && !pathname.startsWith("/assets/")) filePath = path.join(ROOT, "apps/user_client/index.html");
  if (!existsSync(filePath) || !statSync(filePath).isFile()) { response.writeHead(404); response.end("Not found"); return; }
  const body = await readFile(filePath);
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  const isExtensionlessRoute = !pathname.startsWith("/assets/") && !path.extname(pathname);
  const status = isExtensionlessRoute && !KNOWN_CLIENT_ROUTES.has(normalizedPath) ? 404 : 200;
  response.writeHead(status, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
  response.end(body);
}

const server = http.createServer((request, response) => { handler(request, response).catch(() => { response.writeHead(500); response.end("Server error"); }); });
server.listen(PORT, HOST, () => console.log(`砺境 user client listening on http://${HOST}:${PORT}`));

export { HOST, ROOT, safePath };
