const crypto = require("node:crypto");
const { PlatformError } = require("../../platform/errors/error-catalog.ts");

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Map([
  ["image/jpeg", "jpeg"],
  ["image/png", "png"],
  ["image/gif", "gif"],
]);
const ARTIFACT_KINDS = new Set(["question", "note", "attempt_draft", "answer_reference", "plan_outline"]);

function normalizeContentType(value) {
  return String(value ?? "").split(";", 1)[0].trim().toLowerCase();
}

function matchesImageSignature(bytes, format) {
  if (!Buffer.isBuffer(bytes)) return false;
  if (format === "jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (format === "png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return bytes.length >= 6 && (bytes.subarray(0, 6).equals(Buffer.from("GIF87a")) || bytes.subarray(0, 6).equals(Buffer.from("GIF89a")));
}

function parseJson(text) {
  if (typeof text !== "string" || text.length > 14000) throw new PlatformError("DEPENDENCY_UNAVAILABLE", "image extraction output was missing or too large");
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(normalized);
  } catch {
    const start = normalized.indexOf("{");
    const end = normalized.lastIndexOf("}");
    if (start < 0 || end <= start) throw new PlatformError("DEPENDENCY_UNAVAILABLE", "image extraction output was not valid JSON");
    return JSON.parse(normalized.slice(start, end + 1));
  }
}

function requiredText(value, field, maximum, minimum = 1) {
  if (typeof value !== "string" || value.trim().length < minimum || value.trim().length > maximum) throw new PlatformError("DEPENDENCY_UNAVAILABLE", `image extraction ${field} is invalid`);
  return value.trim();
}

function validateDraft(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlatformError("DEPENDENCY_UNAVAILABLE", "image extraction output must be an object");
  const allowed = new Set(["source_title", "kind", "content_text", "uncertain_parts"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new PlatformError("DEPENDENCY_UNAVAILABLE", "image extraction output contains unsupported fields");
  if (!ARTIFACT_KINDS.has(value.kind)) throw new PlatformError("DEPENDENCY_UNAVAILABLE", "image extraction kind is invalid");
  if (!Array.isArray(value.uncertain_parts) || value.uncertain_parts.length > 4 || value.uncertain_parts.some((item) => typeof item !== "string" || item.trim().length > 160)) {
    throw new PlatformError("DEPENDENCY_UNAVAILABLE", "image extraction uncertain_parts is invalid");
  }
  return {
    source_title: requiredText(value.source_title, "source_title", 160),
    kind: value.kind,
    content_text: requiredText(value.content_text, "content_text", 12000, 12),
    uncertain_parts: value.uncertain_parts.map((item) => item.trim()),
  };
}

class VisionMaterialService {
  constructor({ ai }) {
    this.ai = ai;
  }

  async extract(actorId, { requestId, contentType, bytes }, rawIdempotencyKey) {
    const normalizedType = normalizeContentType(contentType);
    const format = IMAGE_TYPES.get(normalizedType);
    if (!format) throw new PlatformError("VALIDATION_ERROR", "only JPEG, PNG, and GIF learning images are supported");
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new PlatformError("VALIDATION_ERROR", "learning image must be between 1 byte and 5 MB");
    if (!matchesImageSignature(bytes, format)) throw new PlatformError("VALIDATION_ERROR", "learning image content does not match its declared format");
    const imageHash = crypto.createHash("sha256").update(bytes).digest("hex");
    const aiResponse = await this.ai.submitWithImages(actorId, {
      request_id: requestId,
      feature: "material_image_extraction",
      input: JSON.stringify({
        prompt: "提取图片中的学习材料文字、公式或代码。不要解题、不要判断掌握程度、不要补全看不清的内容。",
        image_sha256: imageHash,
        output_contract: {
          response: "json_object_only",
          allowed_fields: ["source_title", "kind", "content_text", "uncertain_parts"],
          kind: ["question", "note", "attempt_draft", "answer_reference", "plan_outline"],
          source_title_max_characters: 160,
          content_text_max_characters: 12000,
          uncertain_parts_max_items: 4,
        },
      }),
    }, rawIdempotencyKey, [`data:${normalizedType};base64,${bytes.toString("base64")}`]);
    if (aiResponse.status !== "completed") return { request_id: requestId, status: "degraded", draft: null };
    try {
      return { request_id: requestId, status: "ready", draft: validateDraft(parseJson(aiResponse.result.text)) };
    } catch (error) {
      if (error instanceof PlatformError && error.code === "PERSISTENCE_UNAVAILABLE") throw error;
      if (typeof this.ai.markRunDegraded === "function") await this.ai.markRunDegraded(actorId, requestId, "image_extraction_output_invalid");
      return { request_id: requestId, status: "degraded", draft: null };
    }
  }
}

module.exports = {
  MAX_IMAGE_BYTES,
  VisionMaterialService,
  matchesImageSignature,
  validateDraft,
};
