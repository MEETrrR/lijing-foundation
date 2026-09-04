# Image Generation Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local, secret-safe configuration and command-line workflow for GPT Image 2 and Grok image providers, with candidate image output and explicit manifest registration.

**Architecture:** Keep provider credentials in an ignored `infra/environments/image-generation.env` file and expose only normalized image-generation arguments to a small ESM tool under `tools/image-generation/`. The tool uses Node 22 native `fetch`, supports the OpenAI Images response shape (`b64_json` or same-origin `url`), writes validated image files under the repository, and registers assets only through an explicit command. No client or business module imports the tool.

**Tech Stack:** Node.js >=22.18.0, native `fetch`, `node:test`, ESM `.mjs`, JSON manifest, PowerShell-friendly `pnpm` scripts. No new runtime dependency.

---

## File Map

- Create: `infra/environments/image-generation.env.example` - tracked configuration template with two provider slots and comments.
- Modify: `.gitignore` - ignore the real local image-generation env file.
- Create: `tools/image-generation/config.mjs` - parse, validate, and redact image-generation configuration.
- Create: `tools/image-generation/image-format.mjs` - validate PNG/JPEG output and read dimensions/hash.
- Create: `tools/image-generation/provider.mjs` - build requests, call a selected provider, decode `b64_json`, and download same-origin URLs.
- Create: `tools/image-generation/manifest.mjs` - explicitly register validated files in `assets/generated/asset-manifest.json`.
- Create: `tools/image-generation/cli.mjs` - `config:check`, `generate`, and `register` command parsing and safe output.
- Create: `tests/tools/image-generation.test.mjs` - unit and local HTTP-server tests for the tool boundary.
- Create: `docs/runbooks/image-generation.md` - copy/fill/run instructions and secret-handling rules.
- Modify: `package.json` - expose the three commands and the focused test command.

## Task 1: Add the Safe Configuration Surface

**Files:**
- Create: `infra/environments/image-generation.env.example`
- Modify: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: Add the tracked template**

Create `infra/environments/image-generation.env.example` with blank secret values and these exact keys:

```dotenv
# Copy this file to infra/environments/image-generation.env.
# The copied file is ignored by Git. Never commit real credentials.
IMAGE_GENERATION_PROVIDER=gpt
IMAGE_GENERATION_OUTPUT_DIR=assets/generated/source
IMAGE_GENERATION_DEFAULT_SIZE=1024x1024
IMAGE_GENERATION_DEFAULT_QUALITY=auto
IMAGE_GENERATION_TIMEOUT_MS=120000
IMAGE_GENERATION_MAX_FILE_SIZE_MB=5
IMAGE_GENERATION_MAX_PIXELS=16777216

GPT_IMAGE_API_ENDPOINT=
GPT_IMAGE_API_KEY=
GPT_IMAGE_MODEL=gpt-image-2
GPT_IMAGE_AUTH_HEADER=Authorization
GPT_IMAGE_AUTH_PREFIX=Bearer

GROK_IMAGE_API_ENDPOINT=
GROK_IMAGE_API_KEY=
GROK_IMAGE_MODEL=
GROK_IMAGE_AUTH_HEADER=Authorization
GROK_IMAGE_AUTH_PREFIX=Bearer
```

- [ ] **Step 2: Ignore only the real local file**

Append this rule to `.gitignore`:

```gitignore
infra/environments/image-generation.env
```

Keep the `.example` template trackable. Verify with:

```text
git check-ignore infra/environments/image-generation.env
git check-ignore infra/environments/image-generation.env.example
```

Expected: the first path is ignored and the second path is not ignored.

- [ ] **Step 3: Add script names without implementation assumptions**

Add these entries to the existing `scripts` object in `package.json`:

```json
"image:config:check": "node --no-warnings tools/image-generation/cli.mjs config:check",
"image:generate": "node --no-warnings tools/image-generation/cli.mjs generate",
"image:register": "node --no-warnings tools/image-generation/cli.mjs register",
"image:test": "node --no-warnings --test tests/tools/image-generation.test.mjs"
```

- [ ] **Step 4: Verify the configuration surface**

Run:

```text
git diff --check
node -e "const p=require('./package.json'); for (const k of ['image:config:check','image:generate','image:register','image:test']) if (!p.scripts[k]) process.exit(1)"
```

Expected: both commands exit with code 0.

- [ ] **Step 5: Commit the configuration surface**

```text
git add .gitignore package.json infra/environments/image-generation.env.example
git commit -m "chore: add image generation configuration surface"
```

## Task 2: Implement Configuration Parsing and Redaction Test-First

**Files:**
- Create: `tests/tools/image-generation.test.mjs`
- Create: `tools/image-generation/config.mjs`

- [ ] **Step 1: Write the failing configuration tests**

Start `tests/tools/image-generation.test.mjs` with this test shape:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { loadImageGenerationConfig, summarizeConfig } from "../../tools/image-generation/config.mjs";

const baseEnv = {
  IMAGE_GENERATION_PROVIDER: "gpt",
  IMAGE_GENERATION_OUTPUT_DIR: "assets/generated/source",
  IMAGE_GENERATION_DEFAULT_SIZE: "1024x1024",
  IMAGE_GENERATION_DEFAULT_QUALITY: "auto",
  IMAGE_GENERATION_TIMEOUT_MS: "120000",
  IMAGE_GENERATION_MAX_FILE_SIZE_MB: "5",
  IMAGE_GENERATION_MAX_PIXELS: "16777216",
  GPT_IMAGE_API_ENDPOINT: "https://gpt.example.test/v1/images/generations",
  GPT_IMAGE_API_KEY: "secret-gpt-value",
  GPT_IMAGE_MODEL: "gpt-image-2",
  GPT_IMAGE_AUTH_HEADER: "Authorization",
  GPT_IMAGE_AUTH_PREFIX: "Bearer",
  GROK_IMAGE_API_ENDPOINT: "https://grok.example.test/v1/images/generations",
  GROK_IMAGE_API_KEY: "secret-grok-value",
  GROK_IMAGE_MODEL: "grok-imagine-image",
  GROK_IMAGE_AUTH_HEADER: "Authorization",
  GROK_IMAGE_AUTH_PREFIX: "Bearer",
};

test("loads both provider slots and exposes no secret in the summary", () => {
  const config = loadImageGenerationConfig({ env: baseEnv, envFilePath: null });
  assert.equal(config.provider, "gpt");
  assert.equal(config.providers.gpt.model, "gpt-image-2");
  assert.equal(config.providers.grok.model, "grok-imagine-image");
  assert.equal(summarizeConfig(config).providers.gpt.apiKey, undefined);
  assert.doesNotMatch(JSON.stringify(summarizeConfig(config)), /secret-(?:gpt|grok)-value/);
});

test("rejects an invalid provider endpoint", () => {
  assert.throws(
    () => loadImageGenerationConfig({ env: { ...baseEnv, GPT_IMAGE_API_ENDPOINT: "not-a-url" }, envFilePath: null }),
    /GPT_IMAGE_API_ENDPOINT must be an http or https URL/,
  );
});

test("reports missing credentials for the selected provider", () => {
  assert.throws(
    () => loadImageGenerationConfig({ env: { ...baseEnv, GROK_IMAGE_API_KEY: "" }, envFilePath: null, provider: "grok" }),
    /GROK_IMAGE_API_KEY is required/,
  );
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```text
pnpm run image:test
```

Expected: FAIL because `tools/image-generation/config.mjs` does not exist yet.

- [ ] **Step 3: Implement the minimum configuration module**

Implement these exported functions in `tools/image-generation/config.mjs`:

```js
export function parseEnvText(text) {}
export function loadImageGenerationConfig({ env = process.env, envFilePath = DEFAULT_ENV_FILE, provider } = {}) {}
export function summarizeConfig(config) {}
```

Required behavior:

- Parse `KEY=value`, single/double quoted values, blank lines, and `#` comments; reject malformed non-comment lines.
- Read the default local file when it exists, then let explicitly provided process environment values override file values.
- Normalize the selected provider to `gpt` or `grok`; validate the selected provider even when the other slot is blank.
- Validate HTTP(S) endpoint, non-empty model/key, auth header, auth prefix, relative output directory, integer timeout, file-size limit, and pixel limit.
- Return `{ provider, outputDir, defaults, providers }`, where provider secrets remain only in the in-memory `providers.*.apiKey` field.
- `summarizeConfig` returns provider names, endpoint origins, model names, output settings, and `hasApiKey` booleans only.
- Never include key values in thrown error messages.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run:

```text
pnpm run image:test
```

Expected: the three configuration tests PASS.

- [ ] **Step 5: Commit the configuration module**

```text
git add tools/image-generation/config.mjs tests/tools/image-generation.test.mjs
git commit -m "feat: add image generation config loader"
```

## Task 3: Add Image Validation and Provider Calls Test-First

**Files:**
- Create: `tools/image-generation/image-format.mjs`
- Create: `tools/image-generation/provider.mjs`
- Modify: `tests/tools/image-generation.test.mjs`

- [ ] **Step 1: Add tests for request shape, auth, decoding, and image limits**

Append tests using a local `node:http` server and a 1x1 PNG fixture. The request assertion must be equivalent to:

```js
assert.equal(request.headers.authorization, "Bearer secret-gpt-value");
assert.deepEqual(JSON.parse(requestBody), {
  model: "gpt-image-2",
  prompt: "a starforged learning frontier",
  n: 1,
  size: "1024x1024",
  quality: "auto",
});
```

The tests must also cover:

- a `{ data: [{ b64_json: PNG_BASE64 }] }` response becoming a PNG `Buffer` with width 1 and height 1;
- a `{ data: [{ url: serverUrl }] }` response being downloaded only when its origin matches the configured provider endpoint;
- a foreign-origin URL being rejected;
- invalid bytes and an image over the configured byte/pixel limit being rejected;
- a non-2xx response producing an error containing the status code but not the API key.

- [ ] **Step 2: Run the focused test and confirm the new tests fail**

Run:

```text
pnpm run image:test
```

Expected: the existing config tests pass and the provider/image tests fail because the new modules do not exist.

- [ ] **Step 3: Implement `image-format.mjs`**

Export:

```js
export function inspectImage(buffer, { maxBytes, maxPixels } = {}) {}
```

Support PNG and JPEG signatures. For PNG, read width and height from the IHDR chunk. For JPEG, walk SOF markers until the dimensions are found. Return `{ mime, extension, width, height, bytes, sha256 }`. Reject unknown signatures, zero dimensions, oversized byte length, and `width * height > maxPixels`.

- [ ] **Step 4: Implement `provider.mjs`**

Export:

```js
export async function generateImages({ providerName, provider, prompt, size, quality, count, timeoutMs, maxBytes, maxPixels, fetchImpl = fetch }) {}
```

Build the normalized OpenAI Images body shown above, set `content-type: application/json`, and set the configured auth header to either the raw key or `${authPrefix} ${key}`. Use an abort timeout. Retry at most once for `408`, `429`, `5xx`, or a network `TypeError`; do not retry validation errors.

Parse JSON responses and extract `data[*].b64_json` or `data[*].url`. Decode base64 into bytes. For URL responses, require an `http:` or `https:` URL whose origin equals the provider endpoint origin before downloading. Pass every returned buffer through `inspectImage` before returning it.

Sanitize provider failures by truncating the response text and removing authorization/bearer/key-like values before throwing. The thrown error may include provider name and HTTP status, but never the configured key.

- [ ] **Step 5: Run the provider tests and verify they pass**

Run:

```text
pnpm run image:test
```

Expected: all configuration, provider, URL, and image-validation tests PASS.

- [ ] **Step 6: Commit the provider boundary**

```text
git add tools/image-generation/image-format.mjs tools/image-generation/provider.mjs tests/tools/image-generation.test.mjs
git commit -m "feat: add guarded image provider adapter"
```

## Task 4: Add Explicit Generation and Manifest Registration Commands

**Files:**
- Create: `tools/image-generation/manifest.mjs`
- Create: `tools/image-generation/cli.mjs`
- Modify: `tests/tools/image-generation.test.mjs`

- [ ] **Step 1: Write command/manifest tests first**

Cover these exported behaviors:

```js
const result = await runGenerate({
  config,
  providerName: "gpt",
  prompt: "a starforged learning frontier",
  outputPath: "assets/generated/source/test-image.png",
  fetchImpl: localFetch,
});
assert.equal(result.files.length, 1);
assert.equal(result.files[0].relativePath, "assets/generated/source/test-image.png");

const registered = registerAsset({
  manifestPath,
  filePath: "assets/generated/source/test-image.png",
  assetId: "test-image-v1",
  source: "GPT Image 2",
});
assert.equal(registered.asset_id, "test-image-v1");
```

Also assert that traversal output paths such as `../../outside.png` and invalid asset IDs are rejected, and that registering an asset preserves the root manifest fields while appending or replacing only the requested asset.

- [ ] **Step 2: Run the focused test and confirm the new tests fail**

Run:

```text
pnpm run image:test
```

Expected: the provider tests pass and command/manifest tests fail because the CLI and manifest modules do not exist.

- [ ] **Step 3: Implement `manifest.mjs`**

Export:

```js
export function registerAsset({ manifestPath, filePath, assetId, source, role = "runtime-candidate", usage = ["generated_asset"], notes = "" }) {}
```

Resolve the file and manifest paths from the repository root, reject paths outside the repository, inspect the image, compute the relative POSIX path, and write an asset object with `asset_id`, `path`, `role`, `usage`, `classification: "L2_until_reviewed"`, format, dimensions, SHA-256, source, `review: "pending_art_and_content_review"`, and notes. Preserve all unrelated manifest content and use a stable two-space JSON format.

- [ ] **Step 4: Implement `cli.mjs`**

Export testable functions:

```js
export async function runConfigCheck({ args, env, envFilePath } = {}) {}
export async function runGenerate({ config, providerName, prompt, outputPath, size, quality, count, fetchImpl } = {}) {}
export function runRegister({ manifestPath, filePath, assetId, source, role, usage, notes } = {}) {}
```

The CLI must parse `--key=value` and `--key value`, use `infra/environments/image-generation.env` by default, and map commands as follows:

- `config:check`: validate the selected/default provider and print only `summarizeConfig` data.
- `generate`: require a non-empty prompt, call `generateImages`, write one file per result, and print relative paths. If `--output` is omitted, create timestamped files under the configured output directory. Reject more than two images.
- `register`: require `--file` and `--asset-id`, then call `registerAsset`; never make a network request.

Failures must exit non-zero with a concise sanitized message. The command must not print `process.env` or the parsed config object directly.

- [ ] **Step 5: Run command tests and verify they pass**

Run:

```text
pnpm run image:test
pnpm run image:config:check
```

Expected: focused tests PASS. The config check should fail with a clear missing-file or missing-provider-field message until the user copies and fills the local file; it must not print a secret.

- [ ] **Step 6: Commit the commands**

```text
git add tools/image-generation/manifest.mjs tools/image-generation/cli.mjs tests/tools/image-generation.test.mjs
git commit -m "feat: add image generation and asset registration commands"
```

## Task 5: Document the User Workflow and Run Full Verification

**Files:**
- Create: `docs/runbooks/image-generation.md`
- Modify: `assets/generated/README.md` only if the command reference needs to be linked there.

- [ ] **Step 1: Write the local setup instructions**

Document these exact PowerShell commands:

```powershell
Copy-Item infra/environments/image-generation.env.example infra/environments/image-generation.env
notepad infra/environments/image-generation.env
pnpm run image:config:check
pnpm run image:generate -- --provider=gpt --prompt="..." --output=assets/generated/source/example.png
pnpm run image:register -- --file=assets/generated/source/example.png --asset-id=example-v1 --source="GPT Image 2"
```

Explain that the two endpoint/key/model groups are independent, the real file is ignored, the Grok request currently uses the same OpenAI Images-compatible body, and a native Grok schema needs a later adapter change rather than a secret-file change. State that generated assets remain candidates until art/content/copyright/accessibility/performance review.

- [ ] **Step 2: Run the complete verification set**

Run:

```text
pnpm run image:test
pnpm contract:lint
pnpm platform:test
git diff --check
git status --short
```

Expected: all tests pass, `git diff --check` is clean, and `git status --short` contains only intended files or is clean after the final commit. Run a repository-wide credential-pattern scan over tracked files and confirm no real key appears.

- [ ] **Step 3: Commit the documentation and final verification evidence**

```text
git add docs/runbooks/image-generation.md assets/generated/README.md
git commit -m "docs: document local image generation workflow"
```

## Plan Self-Review

- **Spec coverage:** configuration template and ignored local file are covered by Task 1; skill/tool boundary and normalized provider calls by Tasks 2-4; output validation and same-origin URL handling by Task 3; explicit candidate manifest registration by Task 4; commands and user instructions by Task 5; existing contract/platform regressions by Task 5.
- **Placeholder scan:** the plan contains no unresolved requirements or vague implementation steps; all provider fields, exports, commands, validation rules, and expected test outcomes are named.
- **Type/signature consistency:** `loadImageGenerationConfig` returns the `providers` shape consumed by `generateImages`; `inspectImage` returns metadata consumed by both file output and `registerAsset`; CLI argument names match the documented commands.
- **Scope check:** this remains one subsystem, local provider configuration and generation tooling. Production AI Gateway, quotas, audit, and native Grok request support remain explicitly outside this plan.
