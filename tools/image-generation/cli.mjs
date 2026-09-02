import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadImageConfig, redactedSummary } from "./config.mjs";

export function parseArgs(argv) {
  const result = { command: argv[0] };
  for (let i = 1; i < argv.length; i += 1) { const item = argv[i]; if (!item.startsWith("--")) continue; const [key, inline] = item.slice(2).split("=", 2); const value = inline ?? argv[++i]; result[{ provider: "provider", prompt: "prompt", output: "output", size: "size", quality: "quality", envFile: "envFilePath" }[key] || key] = value; }
  return result;
}

export async function runConfigCheck(options = {}) { const summary = redactedSummary(loadImageConfig(options)); if (options.print !== false) console.log(JSON.stringify(summary, null, 2)); return summary; }

export async function runGenerate(options = {}) {
  if (!options.prompt?.trim()) throw new Error("--prompt is required");
  const config = loadImageConfig(options);
  const output = options.outputPath || options.output || path.join(config.outputDir, "image.png");
  const absolute = path.resolve(config.repoRoot, output);
  const root = path.resolve(config.repoRoot);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) throw new Error("output path must stay inside repository root");
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const auth = config.authPrefix.trim() ? `${config.authPrefix.trim()} ${config.apiKey}` : config.apiKey;
    const response = await (options.fetchImpl || fetch)(config.endpoint, { method: "POST", headers: { "content-type": "application/json", [config.authHeader]: auth }, body: JSON.stringify({ model: config.model, prompt: options.prompt, n: 1, size: options.size || config.size, quality: options.quality || config.quality }), signal: controller.signal });
    if (!response.ok) throw new Error(`${config.provider} provider returned HTTP ${response.status}`);
    const data = await response.json(); const item = data?.data?.[0]; let bytes;
    if (item?.b64_json) bytes = Buffer.from(item.b64_json, "base64");
    else if (item?.url) { const image = await (options.fetchImpl || fetch)(item.url, { signal: controller.signal }); if (!image.ok) throw new Error(`${config.provider} provider returned HTTP ${image.status}`); bytes = Buffer.from(await image.arrayBuffer()); }
    else throw new Error(`${config.provider} provider returned no usable image data`);
    await mkdir(path.dirname(absolute), { recursive: true }); await writeFile(absolute, bytes);
    const relative = path.relative(root, absolute).replaceAll(path.sep, "/"); console.log(`saved ${relative}`); return [relative];
  } catch (error) { if (/provider returned HTTP/.test(error.message)) throw error; throw new Error(`${config.provider} provider request failed`); } finally { clearTimeout(timer); }
}

if (import.meta.main) { const options = parseArgs(process.argv.slice(2)); (options.command === "config:check" ? runConfigCheck(options) : options.command === "generate" ? runGenerate(options) : Promise.reject(new Error("command must be config:check or generate"))).catch((error) => { console.error(error.message); process.exitCode = 1; }); }
