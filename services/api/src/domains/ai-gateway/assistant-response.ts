function compact(value, maximum) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function candidateJson(text) {
  const normalized = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

function normalizeAssistantResponse(text) {
  const normalized = String(text ?? "").trim();
  if (!normalized) throw new Error("assistant output was empty");
  const parsed = candidateJson(normalized);
  if (!parsed) return JSON.stringify({ type: "answer", message: compact(normalized, 2400), suggestions: [] });
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("assistant output was not an object or plain text");
  if (Array.isArray(parsed.milestones) || parsed.plan || parsed.goal) {
    return JSON.stringify({
      type: "answer",
      message: "这次返回的内容更像一份路线草案，不能直接当作助手回答。请回到路线页面确认目标和时间后再生成。",
      suggestions: ["回到路线页面补充目标范围", "确认每周可用时间和完成标准"],
    });
  }
  const message = parsed.message
    ?? parsed.answer
    ?? parsed.summary
    ?? parsed.text
    ?? [parsed.problem, parsed.reason, parsed.next_action].filter((item) => typeof item === "string" && item.trim()).join("\n");
  if (typeof message !== "string" || !message.trim()) throw new Error("assistant output missed a readable message");
  const suggestions = Array.isArray(parsed.suggestions)
    ? parsed.suggestions.filter((item) => typeof item === "string" && item.trim()).slice(0, 3).map((item) => compact(item, 120))
    : [];
  return JSON.stringify({ type: "answer", message: compact(message, 2400), suggestions });
}

function parseAssistantResponse(text) {
  try {
    const value = JSON.parse(text);
    if (value?.type === "answer" && typeof value.message === "string") return value;
  } catch {
    // The gateway only emits normalized JSON, so callers can safely fall back to a degraded response.
  }
  return null;
}

module.exports = { normalizeAssistantResponse, parseAssistantResponse };
