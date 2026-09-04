import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT || 4187);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" };

function safePath(requestUrl) {
  const rawPath = decodeURIComponent(new URL(requestUrl, "http://127.0.0.1").pathname);
  const relative = rawPath === "/" ? "apps/user_client/index.html" : rawPath.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, relative);
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) return null;
  return filePath;
}

async function handler(request, response) {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  let filePath = safePath(request.url);
  if (!filePath) { response.writeHead(404); response.end("Not found"); return; }
  if ((!existsSync(filePath) || !statSync(filePath).isFile()) && !pathname.startsWith("/assets/")) filePath = path.join(ROOT, "apps/user_client/index.html");
  if (!existsSync(filePath) || !statSync(filePath).isFile()) { response.writeHead(404); response.end("Not found"); return; }
  const body = await readFile(filePath);
  response.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
  response.end(body);
}

const server = http.createServer((request, response) => { handler(request, response).catch(() => { response.writeHead(500); response.end("Server error"); }); });
server.listen(PORT, "127.0.0.1", () => console.log(`砺境 user client listening on http://127.0.0.1:${PORT}`));

export { ROOT, safePath };
