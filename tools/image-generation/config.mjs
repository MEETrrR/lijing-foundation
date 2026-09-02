import { readFileSync } from "node:fs";
import path from "node:path";

export function parseEnvText(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const index = trimmed.indexOf("=");
    if (index < 1) return [];
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [[trimmed.slice(0, index).trim(), value]];
  }));
}

export function loadImageConfig(options = {}) {
  const envFilePath = options.envFilePath === undefined ? path.resolve("infra/environments/image-generation.env") : options.envFilePath;
  let fileEnv = {};
  if (envFilePath) { try { fileEnv = parseEnvText(readFileSync(envFilePath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  const values = { ...fileEnv, ...(options.env || process.env) };
  const provider = String(options.provider || values.IMAGE_GENERATION_PROVIDER || "gpt").toLowerCase();
  if (!["gpt", "grok"].includes(provider)) throw new Error("provider must be gpt or grok");
  const prefix = provider.toUpperCase();
  const endpoint = values[`${prefix}_IMAGE_API_ENDPOINT`] || "";
  const apiKey = values[`${prefix}_IMAGE_API_KEY`] || "";
  const model = values[`${prefix}_IMAGE_MODEL`] || "";
  try { const url = new URL(endpoint); if (!["http:", "https:"].includes(url.protocol)) throw new Error(); } catch { throw new Error(`${prefix}_IMAGE_API_ENDPOINT must be an http or https URL`); }
  if (!apiKey.trim()) throw new Error(`${prefix}_IMAGE_API_KEY is required`);
  if (!model.trim()) throw new Error(`${prefix}_IMAGE_MODEL is required`);
  return { provider, endpoint, apiKey, model, authHeader: values[`${prefix}_IMAGE_AUTH_HEADER`] || "Authorization", authPrefix: values[`${prefix}_IMAGE_AUTH_PREFIX`] ?? "Bearer", outputDir: values.IMAGE_GENERATION_OUTPUT_DIR || "assets/generated/source", size: values.IMAGE_GENERATION_DEFAULT_SIZE || "1024x1024", quality: values.IMAGE_GENERATION_DEFAULT_QUALITY || "auto", timeoutMs: Number(values.IMAGE_GENERATION_TIMEOUT_MS || 120000), repoRoot: path.resolve(options.repoRoot || ".") };
}

export function redactedSummary(config) {
  return { provider: config.provider, endpointOrigin: new URL(config.endpoint).origin, model: config.model, outputDir: config.outputDir, size: config.size, quality: config.quality, timeoutMs: config.timeoutMs, hasApiKey: Boolean(config.apiKey) };
}
