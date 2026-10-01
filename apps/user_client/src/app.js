import { DEMO_STATE } from "./data/demo-data.js";
import { getRouteMeta, normalizeRoute } from "./data/routes.js";
import { renderPage } from "./pages/index.js";
import { renderShell } from "./components/shell.js";
import { hydrateKnowledgeNodes, persistEvidenceKnowledge, serializeKnowledgeNodes } from "./data/knowledge-evidence.js";

const MAX_LEARNING_IMAGE_SIZE_MB = 20;
const MAX_LEARNING_IMAGE_BYTES = MAX_LEARNING_IMAGE_SIZE_MB * 1024 * 1024;
const ROUTE_GENERATION_TIMEOUT_MS = 90000;

function newRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function notifySessionExpired() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("lijing-session-expired"));
}

function apiError(response, body, fallback) {
  if (response.status === 401) {
    notifySessionExpired();
    const error = new Error("登录状态已过期，请重新登录");
    error.status = response.status;
    error.code = body.code ?? "unauthenticated";
    return error;
  }
  const error = new Error(body.message || fallback);
  error.status = response.status;
  error.code = body.code ?? null;
  error.retryable = body.retryable === true;
  return error;
}

function isPersistenceFailure(error) {
  return error?.code === "persistence_unavailable";
}

function isTransientAiFailure(response, body = {}) {
  const code = body.code ?? body.reason_code;
  return [502, 503, 504].includes(response?.status) || ["dependency_unavailable", "timeout"].includes(code);
}

function waitForRetry(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

const AI_POLL_ATTEMPTS = 30;
const PUBLIC_ROUTES = new Set(["/auth", "/404", "/privacy", "/terms", "/contact"]);
const LEGACY_ROUTE_REDIRECTS = new Map([
  ["/plan", "/"],
  ["/study", "/"],
  ["/assistant", "/"],
  ["/features", "/"],
  ["/goals", "/route"],
  ["/map", "/route"],
  ["/growth", "/"],
  ["/profile", "/settings"],
]);

function aiSafetyRejectionMessage(reasonCode) {
  if (reasonCode === "safety_sexual_minors") return "涉及未成年人的性内容不能处理。可以改问儿童保护、法律边界或安全教育。";
  if (reasonCode === "safety_sexual_explicit") return "这类露骨内容不能由学习助手生成。可以改问性健康、同意或安全教育。";
  if (reasonCode === "safety_actionable_violence") return "我不能提供武器、爆炸物、袭击或伤害他人的操作步骤。可以改问历史背景、风险预防或应急处置。";
  if (reasonCode === "safety_targeted_hate_or_political_violence") return "我不能生成针对群体的仇恨、暴力或政治煽动内容。可以改问中立事实、历史背景或来源核验。";
  if (reasonCode === "safety_self_harm") return "我不能提供自伤方法。如果你正处于危险中，请马上联系身边可信任的人和当地紧急或危机支持；也可以先写下接下来十分钟的安全行动。";
  return "";
}

export async function requestAi(path, payload) {
  const feature = path.endsWith("/review") ? "wrong_answer_hint" : "concept_explanation";
  const input = path.endsWith("/review")
    ? JSON.stringify({ task: payload.task, answer: payload.answer, evidence_level: payload.evidence_level, evidence: payload.evidence, response_format: "lijing_evidence_review_v1", ...(payload.context ? { context: payload.context } : {}) })
    : JSON.stringify({ companion_id: payload.companion_id, prompt: payload.prompt, context: payload.context });
  const requestId = newRequestId();
  let response;
  let body = {};
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch("/api/v1/ai/requests", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestId },
        body: JSON.stringify({ request_id: requestId, feature, input }),
      });
      body = await response.json().catch(() => ({}));
    } catch {
      if (attempt === 0) {
        await waitForRetry(700);
        continue;
      }
      throw new Error("网络暂时不稳定，AI 没有收到这次请求，请稍后重新提交");
    }
    if (response.ok || !isTransientAiFailure(response, body) || attempt === 1) break;
    await waitForRetry(700);
  }
  if (!response.ok) {
    if (response.status === 401) throw apiError(response, body, "请先登录后再使用 AI");
    const reasonCode = body.reason_code ?? body.code;
    const safetyMessage = aiSafetyRejectionMessage(reasonCode);
    if (safetyMessage) throw new Error(safetyMessage);
    if (reasonCode === "daily_quota_exhausted" || reasonCode === "feature_quota_exhausted") throw new Error("今天的 AI 使用次数已用完，请明天再试");
    if (reasonCode === "burst_limit_exhausted") throw new Error("AI 请求过于频繁，请稍等一分钟再试");
    if (reasonCode === "concurrency_limit_exhausted") throw new Error("上一条 AI 请求还在处理中，请稍等再试");
    if (isTransientAiFailure(response, body)) throw new Error("AI 暂时没有响应，系统已自动重试一次，请稍后重新提交");
    throw new Error(body.message || body.error || `AI 服务暂时不可用（${response.status}）`);
  }
  if (body.status === "rejected") {
    const safetyMessage = aiSafetyRejectionMessage(body.reason_code);
    if (safetyMessage) throw new Error(safetyMessage);
    throw new Error(body.reason_code === "input_too_long" ? "这段内容太长，请缩短后再试" : "这条 AI 请求未通过服务策略");
  }
  let resultBody = body;
  if (body.status === "accepted" || body.status === "processing") {
    for (let attempt = 0; attempt < AI_POLL_ATTEMPTS; attempt += 1) {
      const delay = attempt === 0 ? 250 : Math.min(2000, 500 + attempt * 100);
      await new Promise((resolve) => window.setTimeout(resolve, delay));
      const statusResponse = await fetch(`/api/v1/ai/requests/${encodeURIComponent(body.request_id)}`, { credentials: "same-origin", cache: "no-store" });
      const statusBody = await statusResponse.json().catch(() => ({}));
      if (statusResponse.ok) {
        resultBody = statusBody;
        if (["completed", "degraded", "rejected"].includes(statusBody.status)) break;
      }
    }
  }
  if (resultBody.status === "degraded") throw new Error("AI 还在恢复或服务商没有返回结果。先按页面给出的即时动作开始，稍后可重新提问。");
  if (resultBody.status !== "completed" || !resultBody.result?.text) throw new Error("AI 已受理，但生成时间比平时长；请稍后刷新助手页面查看，不要重复提交");
  if (path.endsWith("/review")) {
    let parsed;
    try {
      parsed = JSON.parse(resultBody.result.text.trim());
    } catch {
      parsed = null;
    }
    if (parsed && ["evidence_used", "problem", "reason", "next_action"].every((key) => typeof parsed[key] === "string" && parsed[key].trim())) {
      return { review: { evidenceUsed: parsed.evidence_used, problem: parsed.problem, reason: parsed.reason, nextAction: parsed.next_action } };
    }
    const error = new Error("AI 复盘没有按要求返回完整结构，已切换到规则复盘");
    error.code = "AI_REVIEW_FORMAT_INVALID";
    throw error;
  }
  try {
    const parsed = JSON.parse(resultBody.result.text);
    if (parsed?.type === "answer" && typeof parsed.message === "string") {
      return { answer: parsed.message, suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [] };
    }
    if (Array.isArray(parsed?.milestones) || parsed?.plan) {
      return { answer: "这次返回的内容更像路线草案，已经拦截；请回到路线页面确认目标和时间。" };
    }
  } catch {
    // Plain text remains a valid fallback for older providers.
  }
  return { answer: resultBody.result.text };
}

async function requestMemoryIteration(payload) {
  const response = await fetch("/api/v1/memory/iterations", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "Idempotency-Key": newRequestId() },
    body: JSON.stringify({ request_id: newRequestId(), ...payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(response, body, "记忆暂时没有写入");
  return body;
}

async function requestMemoryFeedback(memoryId, action, content) {
  const response = await fetch(`/api/v1/me/memories/${encodeURIComponent(memoryId)}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "Idempotency-Key": newRequestId() },
    body: JSON.stringify({ request_id: newRequestId(), action, ...(content ? { content } : {}) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(response, body, "记忆状态暂时没有更新");
  return body;
}

async function requestCompanionProfile() {
  const response = await fetch("/api/v1/me/companion", { credentials: "same-origin", cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(response, body, "陪伴档案暂时无法同步");
  return body;
}

async function requestCompanionToday() {
  const response = await fetch("/api/v1/companion/today", { credentials: "same-origin", cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(response, body, "今日行动暂时无法同步");
  return body;
}

async function requestCompanionCheckIn(payload) {
  const requestId = newRequestId();
  const response = await fetch("/api/v1/companion/check-ins", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "Idempotency-Key": requestId },
    body: JSON.stringify({ request_id: requestId, ...payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw apiError(response, body, "今日行动暂时没有保存");
    if (response.status === 409) {
      const error = new Error(body.message || "这段行动状态已经变化，请刷新后继续");
      error.status = response.status;
      error.code = body.code ?? "conflict";
      throw error;
    }
    throw new Error(body.message || "今日行动暂时没有保存");
  }
  return body;
}

async function requestRegistrationPolicy() {
  const response = await fetch("/api/v1/auth/registration-policy", { credentials: "same-origin", cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(response, body, "试点资格暂时无法获取");
  return body;
}

async function requestAdminOverview(date) {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  const response = await fetch(`/api/v1/admin/overview${query}`, { credentials: "same-origin", cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(response, body, response.status === 403 ? "只有管理员可以查看运营后台" : "运营数据暂时无法读取");
  return body;
}

async function requestLearningArtifact(payload) {
  const requestId = newRequestId();
  const response = await fetch("/api/v1/learning-artifacts", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "Idempotency-Key": requestId },
    body: JSON.stringify({ request_id: requestId, ...payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(response, body, "这份材料暂时没有保存成功");
  return body;
}

async function requestMaterialImageExtraction(file) {
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/gif"]);
  if (!file || !allowedTypes.has(file.type)) throw new Error("请拍摄或选择 JPEG、PNG、GIF 格式的图片");
  if (file.size > MAX_LEARNING_IMAGE_BYTES) throw new Error(`图片不能超过 ${MAX_LEARNING_IMAGE_SIZE_MB} MB`);
  const requestId = newRequestId();
  const response = await fetch("/api/v1/learning-image-extractions", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": file.type, "Idempotency-Key": requestId, "X-Request-Id": requestId },
    body: file,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(response, body, "图片暂时没有识别成功");
  return body;
}

async function requestLearningArtifacts() {
  const response = await fetch("/api/v1/learning-artifacts", { credentials: "same-origin", cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(response, body, "个人材料暂时无法同步");
  return body;
}

async function requestMaterialDiagnosis(payload) {
  const requestId = newRequestId();
  const response = await fetch("/api/v1/companion/diagnoses", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "Idempotency-Key": requestId },
    body: JSON.stringify({ request_id: requestId, ...payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(response, body, "引路暂时无法读取这份材料");
  return body;
}

async function requestMaterialAttempt(payload) {
  const requestId = newRequestId();
  const response = await fetch("/api/v1/learning-attempts", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "Idempotency-Key": requestId },
    body: JSON.stringify({ request_id: requestId, ...payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(response, body, "这次学习证据暂时没有保存成功");
  return body;
}

async function requestMaterialEvidence(actionId, payload) {
  const requestId = newRequestId();
  const response = await fetch(`/api/v1/companion/actions/${encodeURIComponent(actionId)}/evidence`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "Idempotency-Key": requestId },
    body: JSON.stringify({ request_id: requestId, ...payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 409) {
      const error = new Error(body.message || "这条行动已经更新，请刷新后继续");
      error.status = response.status;
      error.code = body.code ?? "action_version_conflict";
      throw error;
    }
    throw apiError(response, body, "这次学习证据暂时没有保存成功");
  }
  return body;
}

async function requestUserState(state) {
  const response = await fetch("/api/v1/me/state", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "Idempotency-Key": newRequestId() },
    body: JSON.stringify({ request_id: newRequestId(), state }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(response, body, "个人状态暂时没有写入");
  return body;
}

async function requestFeedback(payload) {
  const response = await fetch("/api/v1/feedback", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "Idempotency-Key": newRequestId() },
    body: JSON.stringify({ request_id: newRequestId(), ...payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(response, body, "反馈暂时没有提交成功");
  return body;
}

export async function requestLearningRoute(payload) {
  let response;
  let body = {};
  const requestId = newRequestId();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = globalThis.setTimeout(() => controller.abort(), ROUTE_GENERATION_TIMEOUT_MS);
      try {
        response = await fetch("/api/v1/learning-routes", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "Idempotency-Key": requestId },
          body: JSON.stringify({ request_id: requestId, ...payload }),
          signal: controller.signal,
        });
      } finally {
        globalThis.clearTimeout(timeout);
      }
      body = await response.json().catch(() => ({}));
    } catch (error) {
      if (error?.name === "AbortError") {
        const timeoutError = new Error("路线超过 90 秒仍未返回。系统会继续完成已收到的请求；稍后重新打开“路线”即可检查是否已保存。");
        timeoutError.code = "route_generation_pending";
        throw timeoutError;
      }
      if (attempt === 0) {
        await waitForRetry(900);
        continue;
      }
      throw new Error("网络暂时不稳定，路线没有生成成功，请检查网络后重新生成");
    }
    break;
  }
  if (!response.ok) {
    if (response.status === 401) throw apiError(response, body, "学习路线暂时没有生成成功");
    const reasonCode = body.reason_code ?? body.code;
    if (reasonCode === "daily_quota_exhausted" || reasonCode === "feature_quota_exhausted") throw new Error("今天的 AI 路线生成次数已用完，请明天再试");
    if (reasonCode === "burst_limit_exhausted") throw new Error("请求过于频繁，请稍等一分钟再试");
    if (reasonCode === "concurrency_limit_exhausted") throw new Error("上一条路线还在处理中，请稍等再试");
    if (reasonCode === "ai_output_invalid") throw apiError(response, body, "AI 已返回，但路线草案未通过校验，请调整条件后重新生成");
    const error = apiError(response, body, isTransientAiFailure(response, body)
      ? "AI 服务暂时不可用，请稍后重新生成"
      : "学习路线暂时没有生成成功");
    if (isTransientAiFailure(response, body)) error.retryable = true;
    throw error;
  }
  if (body.status === "degraded") {
    const error = new Error("AI 服务暂时无法生成可校验草案，请点击“重新生成”再试");
    error.code = body.reason_code ?? "ai_unavailable";
    error.retryable = true;
    throw error;
  }
  if (body.status === "clarification_required") return body;
  if (body.status !== "draft" || !body.route) throw new Error("学习路线返回格式不完整，请稍后再试");
  return { ...body.route, generation_quota: body.generation_quota ?? null };
}

function routePayloadFromDraft(route, overrides = {}) {
  const goal = route?.goal ?? {};
  const dailyMinutes = Number(overrides.daily_minutes ?? goal.requested_daily_minutes ?? goal.daily_minutes ?? DEMO_STATE.user.dailyMinutes ?? 25) || 25;
  const weeklyHours = Number(overrides.weekly_hours ?? goal.weekly_hours ?? DEMO_STATE.user.weeklyHours ?? 8) || 8;
  return {
    goal_type: goal.type ?? "postgraduate_entrance_exam",
    goal_name: goal.name ?? "考研备考",
    target_date: overrides.target_date ?? goal.target_date ?? "",
    daily_minutes: dailyMinutes,
    weekly_hours: weeklyHours,
    baseline: goal.baseline ?? "starting",
    ...(goal.baseline_assessment ? { baseline_assessment: goal.baseline_assessment } : {}),
    region: goal.region ?? DEMO_STATE.user.region ?? "",
    focus_areas: Array.isArray(goal.focus_areas) ? goal.focus_areas : [],
    constraints: Array.isArray(goal.constraints) ? goal.constraints : [],
  };
}

function selectedClientGoal() {
  return DEMO_STATE.goals.find((goal) => goal.selected) ?? DEMO_STATE.goals[0];
}

function routeTypeForGoal(goal) {
  return ["goal-cet4", "goal-cet6"].includes(goal?.id) ? "college_english_exam" : "postgraduate_entrance_exam";
}

function startRouteGenerationProgress(element, mode = "initial") {
  const startedAt = Date.now();
  const messages = mode === "initial"
    ? [
      "正在核对你的时间安排…",
      "正在匹配当前目标的起点与阶段…",
      "正在生成可执行的长期路线和今天这一条…",
      "路线仍在生成，通常需要 30 到 60 秒；请保持当前页面。",
      "仍在等待 AI 返回；完成后会自动进入今天。超过 90 秒会给出可恢复提示。",
    ]
    : mode === "profile"
      ? [
        "正在保存个人信息…",
        "正在把新的学习节律带入路线…",
        "正在重新生成阶段安排和今天这一条…",
        "路线仍在生成，通常需要 30 到 60 秒；当前路线会继续保留。",
        "仍在等待 AI 返回；完成后会同步更新路线。超过 90 秒会给出可恢复提示。",
      ]
      : [
        "正在核对新的时间条件…",
        "正在重新安排阶段与今天的行动…",
        "正在生成新的可执行路线…",
        "新路线仍在生成，通常需要 30 到 60 秒；当前路线会继续保留。",
        "仍在等待 AI 返回；确认完成后会更新路线。超过 90 秒会给出可恢复提示。",
      ];
  const update = () => {
    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    const phase = elapsedSeconds < 5 ? 0 : elapsedSeconds < 15 ? 1 : elapsedSeconds < 35 ? 2 : elapsedSeconds < 70 ? 3 : 4;
    element.textContent = messages[phase];
  };
  update();
  const timer = globalThis.setInterval(update, 1000);
  return () => globalThis.clearInterval(timer);
}

async function confirmLearningRoute(routeId, expectedVersion) {
  const response = await fetch(`/api/v1/learning-routes/${encodeURIComponent(routeId)}/confirm`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "Idempotency-Key": newRequestId() },
    body: JSON.stringify({ request_id: newRequestId(), expected_version: expectedVersion }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(response, body, "路线暂时不能确认，请重新生成后再试");
  return body.route;
}

async function refreshLearningPlan(routeId, expectedVersion, completedTaskIds = [], skippedTaskIds = [], availableMinutes, taskFeedbacks = [], advanceWeek = false) {
  const response = await fetch(`/api/v1/learning-routes/${encodeURIComponent(routeId)}/refresh`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "Idempotency-Key": newRequestId() },
    body: JSON.stringify({ request_id: newRequestId(), expected_version: expectedVersion, completed_task_ids: completedTaskIds, skipped_task_ids: skippedTaskIds, task_feedbacks: taskFeedbacks, advance_week: advanceWeek, ...(availableMinutes === undefined ? {} : { available_minutes: availableMinutes }) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(response, body, "今日记录已保存，但计划暂时没有更新");
  return body.route;
}

function localReview(evidence, evidenceLevel) {
  return {
    evidenceUsed: evidence,
    problem: evidenceLevel >= 3
      ? "这次留下了可复查的过程，但还需要一次间隔回忆来验证是否能独立复现。"
      : "当前证据还不足以支持掌握判断，需要补一条可复查的过程或结果。",
    reason: `这是规则复盘：本轮留下了 L${evidenceLevel} 证据，只据此安排下一步，不推断你已经掌握。`,
    nextAction: evidenceLevel >= 3
      ? "明天先不看资料，用 10 分钟复现关键步骤；卡住后再对照原记录补全。"
      : "下次先用 10 分钟留下一个步骤、答案或反例，再回看哪里还不能解释。",
  };
}

export async function requestMaterialReview({ task, evidence, evidenceLevel, context }, reviewRequest = requestAi) {
  try {
    const result = await reviewRequest("/api/v1/ai/review", {
      task,
      answer: evidence,
      evidence_level: evidenceLevel,
      evidence,
      context,
    });
    return { review: result.review, reviewReady: true, reviewError: "" };
  } catch (error) {
    return {
      review: localReview(evidence, evidenceLevel),
      reviewReady: false,
      reviewError: error.code === "AI_REVIEW_FORMAT_INVALID"
        ? "AI 结果未通过复盘格式校验，当前显示规则复盘。"
        : error.message,
    };
  }
}

function routeTasksForToday(route) {
  const tasks = route?.plan?.today?.tasks;
  if (!Array.isArray(tasks)) return null;
  return tasks.map((task) => ({
    id: task.id,
    type: task.type,
    title: task.title,
    meta: `${task.planned_minutes ?? 25} 分钟 · ${task.action || task.review_prompt || "按计划完成本段"}${task.expected_output ? ` · 产出：${task.expected_output}` : ""}`.slice(0, 160),
    status: task.completion_status === "active" ? "active" : task.completion_status === "done" ? "done" : "locked",
    gua: task.type === "复盘" ? "☵" : "☲",
  }));
}

function localMemoryCandidates(payload, iterationId) {
  const now = new Date().toISOString();
  return [
    { id: `demo-memory-friction-${iterationId}`, kind: "friction", title: "当前需要回望", content: payload.review.problem, scope: payload.goal_scope, goal_title: payload.goal_title, source: "learning_iteration", status: "candidate", confidence: 0.51, observation_count: 1, evidence_level: payload.evidence_level, first_observed_at: now, last_observed_at: now, last_iteration_id: iterationId, updated_at: now },
    { id: `demo-memory-strategy-${iterationId}`, kind: "strategy", title: "已发现的下一步", content: payload.review.next_action, scope: payload.goal_scope, goal_title: payload.goal_title, source: "learning_iteration", status: "candidate", confidence: 0.51, observation_count: 1, evidence_level: payload.evidence_level, first_observed_at: now, last_observed_at: now, last_iteration_id: iterationId, updated_at: now },
  ];
}

function activeMemoryContext() {
  return (DEMO_STATE.memory?.memories ?? [])
    .filter((memory) => memory.status === "active")
    .slice(0, 3)
    .map((memory) => ({ kind: memory.kind, scope: memory.scope, content: memory.content, confidence: memory.confidence }));
}

export function userStatePayload(state = DEMO_STATE) {
  const selectedGoal = state.goals.find((goal) => goal.selected) ?? state.goals[0];
  const profile = state.onboarding?.profile ?? {};
  const pilot = state.pilot ?? {};
  return {
    version: 1,
    profile: {
      name: state.user.name,
      stage: state.user.stage,
      school: state.user.school,
      major: state.user.major,
      age: String(state.user.age ?? profile.age ?? ""),
      region: state.user.region ?? profile.region ?? "",
      notes: state.user.notes ?? profile.notes ?? "",
      daily_minutes: String(state.user.dailyMinutes ?? profile.dailyMinutes ?? "25"),
      weekly_hours: String(state.user.weeklyHours ?? profile.weeklyHours ?? ""),
      reminder_enabled: state.user.reminderEnabled !== false,
      reminder_time: state.user.reminderTime ?? "20:00",
      timezone: state.user.timezone ?? "Asia/Shanghai",
    },
    goal_id: selectedGoal?.id ?? profile.target ?? "goal-exam",
    guide_asset_id: state.guide.selectedAssetId,
    onboarding_completed: Boolean(state.onboarding?.completed),
    today: {
      completed: state.today.completed,
      total: state.today.total,
      streak: state.today.streak,
      minutes: state.today.minutes,
      tasks: state.today.tasks.map((task) => ({ id: task.id, type: task.type, title: task.title, meta: String(task.meta ?? "").slice(0, 160), status: task.status, gua: task.gua })),
    },
    pilot: {
      selected_evidence_level: pilot.selectedEvidenceLevel,
      submitted_evidence: pilot.submittedEvidence,
      selected_answer: pilot.selectedAnswer ?? "",
      review: pilot.review ? {
        evidence_used: pilot.review.evidenceUsed,
        problem: pilot.review.problem,
        reason: pilot.review.reason,
        next_action: pilot.review.nextAction,
      } : null,
      review_ready: Boolean(pilot.reviewReady),
    },
    knowledge: serializeKnowledgeNodes(state.knowledge),
  };
}

function applyUserState(state) {
  if (!state || typeof state !== "object") return;
  const profile = state.profile;
  if (profile) {
    DEMO_STATE.user = {
      ...DEMO_STATE.user,
      name: profile.name || DEMO_STATE.user.name,
      title: profile.stage || DEMO_STATE.user.title,
      stage: profile.stage || DEMO_STATE.user.stage,
      school: profile.school ?? DEMO_STATE.user.school,
      major: profile.major ?? DEMO_STATE.user.major,
      age: profile.age ?? DEMO_STATE.user.age,
      region: profile.region ?? DEMO_STATE.user.region,
      notes: profile.notes ?? DEMO_STATE.user.notes,
      dailyMinutes: profile.daily_minutes || DEMO_STATE.user.dailyMinutes,
      weeklyHours: profile.weekly_hours || DEMO_STATE.user.weeklyHours,
      reminderEnabled: profile.reminder_enabled ?? DEMO_STATE.user.reminderEnabled,
      reminderTime: profile.reminder_time || DEMO_STATE.user.reminderTime,
      timezone: profile.timezone || DEMO_STATE.user.timezone,
    };
    DEMO_STATE.onboarding.profile = {
      ...DEMO_STATE.onboarding.profile,
      name: DEMO_STATE.user.name,
      stage: DEMO_STATE.user.stage,
      school: DEMO_STATE.user.school,
      major: DEMO_STATE.user.major,
      age: DEMO_STATE.user.age,
      region: DEMO_STATE.user.region,
      notes: DEMO_STATE.user.notes,
      dailyMinutes: DEMO_STATE.user.dailyMinutes,
      weeklyHours: DEMO_STATE.user.weeklyHours,
      reminderEnabled: DEMO_STATE.user.reminderEnabled,
      reminderTime: DEMO_STATE.user.reminderTime,
      timezone: DEMO_STATE.user.timezone,
    };
  }
  if (typeof state.goal_id === "string") {
    DEMO_STATE.goals.forEach((goal) => { goal.selected = goal.id === state.goal_id; });
    DEMO_STATE.user.target = DEMO_STATE.goals.find((goal) => goal.selected)?.title ?? DEMO_STATE.user.target;
  }
  if (typeof state.guide_asset_id === "string") DEMO_STATE.guide.selectedAssetId = state.guide_asset_id;
  if (typeof state.onboarding_completed === "boolean") DEMO_STATE.onboarding.completed = state.onboarding_completed;
  if (state.today && typeof state.today === "object") {
    DEMO_STATE.today = {
      ...DEMO_STATE.today,
      ...state.today,
      tasks: Array.isArray(state.today.tasks) ? state.today.tasks.map((task) => ({ ...task })) : DEMO_STATE.today.tasks,
    };
  }
  if (state.pilot && typeof state.pilot === "object") {
    DEMO_STATE.pilot = {
      ...DEMO_STATE.pilot,
      selectedEvidenceLevel: state.pilot.selected_evidence_level ?? DEMO_STATE.pilot.selectedEvidenceLevel,
      submittedEvidence: state.pilot.submitted_evidence ?? DEMO_STATE.pilot.submittedEvidence,
      selectedAnswer: state.pilot.selected_answer ?? DEMO_STATE.pilot.selectedAnswer ?? "",
      review: state.pilot.review ? {
        evidenceUsed: state.pilot.review.evidence_used,
        problem: state.pilot.review.problem,
        reason: state.pilot.review.reason,
        nextAction: state.pilot.review.next_action,
      } : null,
      reviewReady: state.pilot.review_ready ?? DEMO_STATE.pilot.reviewReady,
    };
  }
  if (Array.isArray(state.knowledge)) {
    DEMO_STATE.knowledge = hydrateKnowledgeNodes(state.knowledge);
    if (!DEMO_STATE.knowledge.some((item) => item.id === DEMO_STATE.activeKnowledgeId)) DEMO_STATE.activeKnowledgeId = DEMO_STATE.knowledge[0]?.id;
  }
}

export function createApp(root = document.querySelector("#app")) {
  if (!root) throw new Error("Missing #app mount point");
  const initialDemoState = structuredClone(DEMO_STATE);
  const createRealState = (user = null) => {
    const state = structuredClone(initialDemoState);
    state.isDemo = false;
    state.auth = { user, mode: "login" };
    state.user = {
      ...state.user,
      name: user?.display_name ?? "",
      title: "待填写",
      stage: "待填写",
      school: "",
      major: "",
      age: "",
      region: "",
      notes: "",
      target: "",
      dailyMinutes: "25",
      weeklyHours: "8",
      reminderEnabled: true,
      reminderTime: "20:00",
      timezone: "Asia/Shanghai",
    };
    state.onboarding = {
      step: 1,
      featureIndex: 0,
      completed: false,
      profile: { name: user?.display_name ?? "", stage: "待填写", school: "", major: "", age: "", region: "", target: "goal-exam", dailyMinutes: "25" },
    };
    state.tour = { active: false, step: 0 };
    state.memory = { iterationCount: 0, syncStatus: "idle", lastIterationId: "", memories: [] };
    state.companionCycle = null;
    state.learningArtifacts = [];
    state.preferences = { notifications: "important", motion: true };
    state.service = { api: "unknown", aiConfigured: null, aiAvailable: null, aiStatus: "unknown", aiReasonCode: "", persistence: "unknown", persistenceNotice: "" };
    state.adminAnalytics = { status: "idle", data: null, error: "" };
    state.pilot = {
      ...state.pilot,
      selectedEvidenceLevel: 1,
      submittedEvidence: "",
      selectedAnswer: "",
      assistantResponse: "",
      assistantError: "",
      assistantPending: false,
      materialPending: false,
      assistantPrompt: "",
      reviewError: "",
      review: null,
      reviewReady: false,
    };
    state.mountain = {
      ...state.mountain,
      currentHeight: 0,
      visiblePercent: 0,
      currentChapter: "山脚 · 初入",
      nextCamp: "完成入山信息",
      nextCampDistance: "待建立",
      weather: "尚未建立",
    };
    state.balance = { focus: 0, recovery: 0, energy: 0 };
    state.activeKnowledgeId = "";
    state.knowledge = [];
    state.knowledgeComposerOpen = false;
    state.knowledgeCaptureDraft = null;
    state.learningRoute = { draft: null, clarification: null, error: "", generationQuota: null, generationQuotaStatus: "loading" };
    state.today = { completed: 0, total: 0, streak: 0, minutes: 0, tasks: [] };
    state.achievements = [];
    state.map = [{ title: "山脚 · 初入", subtitle: "完成入山信息后开始", state: "current", height: "0 m" }];
    state.goals = state.goals.map((goal, index) => ({ ...goal, selected: index === 0 }));
    return state;
  };
  let motionEnabled = window.localStorage?.getItem("lijing-motion") !== "off" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches !== true;
  let selectedGoal = DEMO_STATE.goals.find((goal) => goal.selected)?.id ?? DEMO_STATE.goals[0]?.id ?? "";
  let scrollFrame = 0;
  let transitionTimer = 0;
  let ascensionTimer = 0;
  let sessionResolved = false;
  let renderedRoute = null;
  let revealObserver;
  if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
  DEMO_STATE.auth ??= { user: null, mode: "register" };
  DEMO_STATE.registrationPolicy ??= { invitationRequired: false, registrationOpen: true, loaded: false };
  DEMO_STATE.memory ??= { iterationCount: 0, syncStatus: "idle", lastIterationId: "", memories: [] };
  DEMO_STATE.companion ??= { interactionCount: 0, promptVersion: "", firstSeenAt: null, lastSeenAt: null, companionId: DEMO_STATE.guide.selectedAssetId };
  DEMO_STATE.companionCycle ??= null;
  DEMO_STATE.learningArtifacts ??= [];
  DEMO_STATE.preferences ??= { notifications: window.localStorage?.getItem("lijing-notifications") ?? "important", motion: motionEnabled };
  DEMO_STATE.service ??= { api: "unknown", aiConfigured: null, aiAvailable: null, aiStatus: "unknown", aiReasonCode: "", persistence: "unknown", syncStatus: "unknown" };
  DEMO_STATE.service.persistenceNotice ??= "";
  DEMO_STATE.learningRoute ??= { draft: null, clarification: null, error: "" };
  DEMO_STATE.learningRoute.form ??= null;
  DEMO_STATE.learningRoute.generationQuotaStatus ??= DEMO_STATE.isDemo ? "idle" : "loading";

  const applyMemoryResponse = (body) => {
    DEMO_STATE.memory.iterationCount = Number(body.iteration_count ?? DEMO_STATE.memory.iterationCount ?? 0);
    DEMO_STATE.memory.memories = Array.isArray(body.memories) ? body.memories : (Array.isArray(body.candidates) ? body.candidates : []);
    DEMO_STATE.memory.lastIterationId = body.iteration_id ?? DEMO_STATE.memory.lastIterationId;
    DEMO_STATE.memory.syncStatus = "synced";
  };

  const applyCompanionCycle = (body) => {
    const previous = DEMO_STATE.companionCycle ?? {};
    const hasCurrentAction = Object.hasOwn(body, "current_action");
    const currentAction = hasCurrentAction ? body.current_action : body.next_action ?? body.action ?? null;
    const currentTask = Object.hasOwn(body, "task")
      ? body.task
      : currentAction
        ? { id: currentAction.id, type: "材料诊断", title: currentAction.title, estimated_minutes: currentAction.estimated_minutes, action_version: currentAction.version }
        : null;
    const diagnosisSummary = body.diagnosis_summary
      ?? (body.diagnosis ? {
        ...body.diagnosis,
        reason: currentAction?.reason ?? "根据你提交的材料生成当前行动。",
      } : previous.diagnosisSummary ?? null);
    DEMO_STATE.companionCycle = {
      date: body.date ?? previous.date ?? null,
      routeAvailable: Boolean(body.route_available),
      task: currentTask,
      cycle: body.cycle ?? null,
      currentAction,
      screenState: body.screen_state ?? (currentAction ? (currentAction.status === "planned" ? "next_action_ready" : "action_active") : "need_material"),
      diagnosisSummary,
      evidenceRequirements: body.evidence_requirements ?? currentAction?.expected_evidence ?? null,
      retrievedEvidence: Object.hasOwn(body, "retrieved_evidence") ? (body.retrieved_evidence ?? []) : (previous.retrievedEvidence ?? []),
      guidanceEvidence: Object.hasOwn(body, "guidance_evidence") ? (body.guidance_evidence ?? []) : (previous.guidanceEvidence ?? []),
      nextAction: body.next_action ?? currentAction?.reason ?? "",
      replayed: Boolean(body.replayed),
    };
  };

  const hasGenerationQuota = (quota) => Number.isInteger(quota?.remaining) && Number.isInteger(quota?.limit);

  const applyLearningRoute = (route, generationQuota = null) => {
    const incomingQuota = generationQuota ?? route?.generation_quota ?? null;
    const quota = incomingQuota ?? DEMO_STATE.learningRoute?.generationQuota ?? null;
    const quotaStatus = hasGenerationQuota(incomingQuota)
      ? "synced"
      : DEMO_STATE.learningRoute?.generationQuotaStatus ?? "error";
    const draft = route ? { ...route } : null;
    if (draft) delete draft.generation_quota;
    DEMO_STATE.learningRoute = { draft, clarification: null, error: "", form: null, generationQuota: quota, generationQuotaStatus: quotaStatus };
    const tasks = routeTasksForToday(route);
    const firstTask = route?.plan?.today?.tasks?.[0] ?? null;
    const firstMilestone = route?.milestones?.[0] ?? null;
    if (route) {
      const confirmed = route.status === "confirmed";
      DEMO_STATE.mountain = {
        ...DEMO_STATE.mountain,
        currentChapter: firstMilestone?.title ? `${confirmed ? "当前阶段" : "路线草案"} · ${firstMilestone.title}` : DEMO_STATE.mountain.currentChapter,
        nextCamp: firstTask?.title ?? firstMilestone?.title ?? (confirmed ? "等待今日任务" : "等待确认"),
        nextCampDistance: firstTask?.planned_minutes ? `${firstTask.planned_minutes} 分钟` : confirmed ? "今日计划已建立" : "待确认",
        weather: confirmed ? "路线已建立" : "等待确认",
      };
    }
    if (route?.status === "confirmed" && tasks) {
      DEMO_STATE.today = {
        ...DEMO_STATE.today,
        completed: tasks.filter((task) => task.status === "done").length,
        total: tasks.length,
        tasks,
      };
    }
  };

  const recordEvidenceMemory = async (action, evidence, evidenceLevel, review) => {
    if (!action?.id) return false;
    DEMO_STATE.memory.syncStatus = "saving";
    const previousIterationCount = Number(DEMO_STATE.memory.iterationCount ?? 0);
    const payload = {
      iteration_id: `iteration-${action.id}`,
      goal_scope: "goal-exam",
      goal_title: DEMO_STATE.learningRoute?.draft?.goal?.name || DEMO_STATE.user.target || "当前学习",
      task_id: action.id,
      evidence_level: evidenceLevel,
      evidence,
      review: { problem: review.problem, reason: review.reason, next_action: review.nextAction },
    };
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await requestMemoryIteration(payload);
        applyMemoryResponse(result);
        return true;
      } catch (error) {
        lastError = error;
        if (attempt === 0) await waitForRetry(450);
      }
    }
    await syncMemories();
    if (Number(DEMO_STATE.memory.iterationCount ?? 0) > previousIterationCount) {
      return true;
    }
    DEMO_STATE.memory.syncStatus = "error";
    DEMO_STATE.memory.syncError = lastError?.message || "memory iteration failed";
    return false;
  };

  const syncAuthenticatedAccount = async ({ onPrimaryStateReady, onComplete, healthPromise = syncServiceHealth() } = {}) => {
    await syncUserState();
    DEMO_STATE.learningRoute = { ...DEMO_STATE.learningRoute, syncStatus: "loading", error: "" };
    onPrimaryStateReady?.();
    await Promise.all([
      healthPromise,
      syncMemories(),
      syncCompanion(),
      syncCompanionCycle(),
      syncLearningArtifacts(),
      syncLearningRoute(),
      syncReminders(),
    ]);
    onComplete?.();
  };

  const syncAdminOverview = async (date) => {
    if (DEMO_STATE.isDemo || !DEMO_STATE.auth?.user) return;
    DEMO_STATE.adminAnalytics = { ...DEMO_STATE.adminAnalytics, status: "loading", error: "" };
    if (renderedRoute === "/admin") render("/admin");
    try {
      const body = await requestAdminOverview(date);
      DEMO_STATE.adminAnalytics = { status: "ready", data: body, error: "" };
    } catch (error) {
      DEMO_STATE.adminAnalytics = {
        status: error.status === 403 ? "forbidden" : "error",
        data: null,
        error: error.message,
      };
    }
    if (renderedRoute === "/admin") render("/admin");
  };

  const syncRegistrationPolicy = async () => {
    try {
      const policy = await requestRegistrationPolicy();
      DEMO_STATE.registrationPolicy = {
        invitationRequired: policy.invitation_required === true,
        registrationOpen: policy.registration_open !== false,
        loaded: true,
      };
    } catch {
      DEMO_STATE.registrationPolicy = { ...DEMO_STATE.registrationPolicy, loaded: false };
    }
  };

  const replaceState = (nextState) => {
    for (const key of Object.keys(DEMO_STATE)) delete DEMO_STATE[key];
    Object.assign(DEMO_STATE, structuredClone(nextState));
    selectedGoal = DEMO_STATE.goals.find((goal) => goal.selected)?.id ?? DEMO_STATE.goals[0]?.id ?? "";
  };

  const resetToDemoState = (mode = "register") => replaceState({
    ...initialDemoState,
    isDemo: true,
    auth: { user: null, mode },
    registrationPolicy: { ...DEMO_STATE.registrationPolicy },
    memory: { iterationCount: 0, syncStatus: "idle", lastIterationId: "", memories: [] },
  });
  const resetToRealState = (user) => replaceState(createRealState(user));

  const persistUserState = async () => {
    if (DEMO_STATE.isDemo || !DEMO_STATE.auth?.user) return;
    const result = await requestUserState(userStatePayload());
    applyUserState(result.state);
    selectedGoal = result.state?.goal_id ?? selectedGoal;
  };

  const applyRouteConstraintsToProfile = (routePayload) => {
    const dailyMinutes = String(routePayload.daily_minutes);
    const weeklyHours = String(routePayload.weekly_hours);
    DEMO_STATE.user.dailyMinutes = dailyMinutes;
    DEMO_STATE.user.weeklyHours = weeklyHours;
    DEMO_STATE.onboarding.profile = {
      ...DEMO_STATE.onboarding.profile,
      dailyMinutes,
      weeklyHours,
    };
  };

  const recalculateAndConfirmRoute = async (routePayload, updateProgress) => {
    const routeResult = await requestLearningRoute(routePayload);
    if (routeResult.status === "clarification_required") {
      throw new Error("新的路线条件还需要补充目标范围，请先调整目标方向");
    }
    if (!routeResult.id || !Number.isInteger(routeResult.version)) {
      throw new Error("新路线缺少确认信息，请稍后重试");
    }
    DEMO_STATE.service.aiStatus = "available";
    DEMO_STATE.service.aiAvailable = true;
    if (!["feasible", "tight"].includes(routeResult.feasibility?.status)) {
      const error = new Error("新条件下可用时间不足，请增加每周时间或延后目标日期。");
      error.code = "route_needs_adjustment";
      throw error;
    }
    updateProgress?.("正在确认新路线...");
    return confirmLearningRoute(routeResult.id, routeResult.version).then((route) => {
      applyLearningRoute(route);
      DEMO_STATE.onboarding.completed = true;
      return route;
    });
  };

  const syncMemories = async () => {
    if (DEMO_STATE.isDemo || !DEMO_STATE.auth?.user) return;
    try {
      const response = await fetch("/api/v1/me/memories", { credentials: "same-origin" });
      if (!response.ok) return;
      applyMemoryResponse(await response.json());
    } catch {
      DEMO_STATE.memory.syncStatus = "offline";
    }
  };

  const syncCompanion = async () => {
    if (DEMO_STATE.isDemo || !DEMO_STATE.auth?.user) return;
    try {
      const profile = await requestCompanionProfile();
      DEMO_STATE.companion = {
        interactionCount: Number(profile.interaction_count ?? 0),
        promptVersion: profile.prompt_version ?? "",
        firstSeenAt: profile.first_seen_at ?? null,
        lastSeenAt: profile.last_seen_at ?? null,
        companionId: profile.companion_id ?? DEMO_STATE.guide.selectedAssetId,
        lastTopic: profile.last_topic ?? "",
      };
    } catch {
      DEMO_STATE.companion = { ...DEMO_STATE.companion, syncStatus: "offline" };
    }
  };

  const syncCompanionCycle = async () => {
    if (DEMO_STATE.isDemo || !DEMO_STATE.auth?.user) return;
    try {
      applyCompanionCycle(await requestCompanionToday());
    } catch (error) {
      if (isPersistenceFailure(error)) {
        DEMO_STATE.service = { ...DEMO_STATE.service, api: "degraded", persistence: "unknown", syncStatus: "degraded", persistenceNotice: error.message };
      }
      DEMO_STATE.companionCycle = { ...DEMO_STATE.companionCycle, syncStatus: "offline", syncError: error.message };
    }
  };

  const syncLearningArtifacts = async () => {
    if (DEMO_STATE.isDemo || !DEMO_STATE.auth?.user) return;
    try {
      const body = await requestLearningArtifacts();
      DEMO_STATE.learningArtifacts = Array.isArray(body.artifacts) ? body.artifacts : [];
    } catch (error) {
      if (isPersistenceFailure(error)) {
        DEMO_STATE.service = { ...DEMO_STATE.service, api: "degraded", persistence: "unknown", syncStatus: "degraded", persistenceNotice: error.message };
      }
      DEMO_STATE.learningArtifacts = DEMO_STATE.learningArtifacts ?? [];
    }
  };

  const syncUserState = async () => {
    if (DEMO_STATE.isDemo || !DEMO_STATE.auth?.user) return;
    try {
      const response = await fetch("/api/v1/me/state", { credentials: "same-origin" });
      if (!response.ok) {
        if (response.status === 401) notifySessionExpired();
        DEMO_STATE.service.syncStatus = "degraded";
        return;
      }
      const body = await response.json();
      applyUserState(body.state);
      selectedGoal = body.state?.goal_id ?? selectedGoal;
      DEMO_STATE.service.syncStatus = "synced";
    } catch {
      DEMO_STATE.service.syncStatus = "degraded";
    }
  };

  const syncServiceHealth = async () => {
    try {
      const response = await fetch("/api/v1/health", { credentials: "same-origin" });
      if (!response.ok) throw new Error("health request failed");
      const body = await response.json();
      DEMO_STATE.service = {
        api: body.status === "ok" ? "up" : "degraded",
        aiConfigured: body.ai_configured === true,
        aiAvailable: body.ai_available === true,
        aiStatus: body.ai_status ?? (body.ai_configured === true ? "unknown" : "disabled"),
        aiReasonCode: body.ai_reason_code ?? "",
        persistence: body.status === "ok" && (body.persistence === "durable" || body.persistence === "ephemeral") ? body.persistence : "unknown",
        persistenceNotice: body.status === "ok" && body.persistence === "durable" ? "" : DEMO_STATE.service?.persistenceNotice ?? "数据服务暂时未恢复，新的学习记录不会被当作已保存。",
        syncStatus: DEMO_STATE.service?.syncStatus ?? "unknown",
      };
    } catch {
      DEMO_STATE.service = { api: "down", aiConfigured: null, aiAvailable: null, aiStatus: "unknown", aiReasonCode: "", persistence: "unknown", persistenceNotice: "数据服务暂时无法确认，新的学习记录不会被当作已保存。", syncStatus: "degraded" };
    }
  };

  const syncLearningRoute = async () => {
    if (DEMO_STATE.isDemo || !DEMO_STATE.auth?.user) return;
    DEMO_STATE.learningRoute = { ...DEMO_STATE.learningRoute, syncStatus: "loading", error: "", generationQuota: null, generationQuotaStatus: "loading" };
    try {
      const response = await fetch("/api/v1/learning-routes", { credentials: "same-origin" });
      if (!response.ok) {
        if (response.status === 401) notifySessionExpired();
        DEMO_STATE.learningRoute.error = "路线暂时无法同步";
        DEMO_STATE.learningRoute.syncStatus = "error";
        DEMO_STATE.learningRoute.generationQuotaStatus = "error";
        return;
      }
      const body = await response.json();
      applyLearningRoute(body.route ?? null, body.generation_quota);
      DEMO_STATE.learningRoute.syncStatus = "synced";
      DEMO_STATE.learningRoute.generationQuotaStatus = hasGenerationQuota(body.generation_quota) ? "synced" : "error";
    } catch {
      DEMO_STATE.learningRoute.error = "路线暂时无法同步";
      DEMO_STATE.learningRoute.syncStatus = "error";
      DEMO_STATE.learningRoute.generationQuota = null;
      DEMO_STATE.learningRoute.generationQuotaStatus = "error";
    }
  };

  const refreshGenerationQuota = async () => {
    if (DEMO_STATE.isDemo || !DEMO_STATE.auth?.user) return;
    DEMO_STATE.learningRoute = { ...DEMO_STATE.learningRoute, generationQuota: null, generationQuotaStatus: "loading" };
    try {
      const response = await fetch("/api/v1/learning-routes", { credentials: "same-origin" });
      if (!response.ok) throw new Error("quota refresh failed");
      const body = await response.json();
      if (!hasGenerationQuota(body.generation_quota)) throw new Error("quota unavailable");
      DEMO_STATE.learningRoute = { ...DEMO_STATE.learningRoute, generationQuota: body.generation_quota, generationQuotaStatus: "synced" };
    } catch {
      DEMO_STATE.learningRoute = { ...DEMO_STATE.learningRoute, generationQuota: null, generationQuotaStatus: "error" };
    }
    if (renderedRoute === "/route") render("/route");
  };

  const syncReminders = async () => {
    if (DEMO_STATE.isDemo || !DEMO_STATE.auth?.user) return;
    try {
      const response = await fetch("/api/v1/me/reminders", { credentials: "same-origin" });
      if (!response.ok) return;
      const body = await response.json();
      if (!body.due || DEMO_STATE.preferences?.notifications === "off") return;
      const storageKey = `lijing-reminder:${DEMO_STATE.auth.user.id}:${body.reminder_key}`;
      if (window.localStorage?.getItem(storageKey)) return;
      window.localStorage?.setItem(storageKey, "shown");
      const message = body.tasks?.[0]?.title ? `今天还有：${body.tasks[0].title}` : "今天还有一段学习计划等待完成";
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("砺境 · 今天", { body: message });
      }
      toast(message);
    } catch {
      // Reminders are helpful but must not interrupt the learning surface when unavailable.
    }
  };

  const syncSession = async () => {
    const healthPromise = syncServiceHealth();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch("/api/v1/auth/me", { credentials: "same-origin", cache: "no-store" });
        if (response.status === 401) {
          resetToDemoState();
          void healthPromise.then(() => render());
          return;
        }
        if (!response.ok) {
          if (attempt === 0 && response.status >= 500) {
            await waitForRetry(350);
            continue;
          }
          DEMO_STATE.service.syncStatus = "degraded";
          return;
        }
        const body = await response.json();
        if (body.user) {
          resetToRealState(body.user);
          await syncAuthenticatedAccount({
            healthPromise,
            onPrimaryStateReady: () => {
              sessionResolved = true;
              render();
            },
            onComplete: () => render(window.location.pathname),
          });
        } else {
          void healthPromise.then(() => render());
        }
        return;
      } catch {
        if (attempt === 0) {
          await waitForRetry(350);
          continue;
        }
        DEMO_STATE.service.syncStatus = "degraded";
      }
    }
  };

  const render = (requestedRoute = normalizeRoute(window.location.pathname)) => {
    const authenticated = Boolean(DEMO_STATE.auth?.user) && DEMO_STATE.isDemo === false;
    const isAdmin = authenticated && DEMO_STATE.auth?.user?.is_admin === true;
    const canonicalRoute = LEGACY_ROUTE_REDIRECTS.get(requestedRoute) ?? requestedRoute;
    const isNotFound = canonicalRoute === "/404";
    const sessionPending = !sessionResolved && !authenticated && !PUBLIC_ROUTES.has(canonicalRoute);
    const route = isNotFound
      ? "/404"
      : authenticated && canonicalRoute === "/auth"
      ? "/"
        : authenticated && canonicalRoute === "/admin" && !isAdmin
          ? "/"
        : sessionPending
          ? "/state/loading"
        : !authenticated && !PUBLIC_ROUTES.has(canonicalRoute)
          ? "/auth"
          : canonicalRoute;
    const routeChanged = renderedRoute !== route;
    if (routeChanged) window.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
    renderedRoute = route;
    if (canonicalRoute !== requestedRoute && window.location.pathname !== canonicalRoute) {
      window.history.replaceState({}, "", canonicalRoute);
    }
    if (authenticated && canonicalRoute === "/auth" && window.location.pathname !== "/") {
      window.history.replaceState({}, "", "/");
    }
    if (!sessionPending && !authenticated && !PUBLIC_ROUTES.has(canonicalRoute) && window.location.pathname !== "/auth") {
      window.history.replaceState({}, "", "/auth");
    }
    document.title = `砺境 · ${getRouteMeta(route)?.label ?? "页面不存在"}`;
    const previousAuthForm = root.querySelector('form[data-demo-form="auth"]');
    const activeAuthControl = previousAuthForm?.contains(document.activeElement) ? document.activeElement : null;
    const authFormSnapshot = previousAuthForm ? {
      mode: previousAuthForm.dataset.authMode,
      values: [...new FormData(previousAuthForm).entries()],
      submitting: previousAuthForm.dataset.submitting === "true",
      errorText: previousAuthForm.querySelector("[data-auth-error]")?.textContent ?? "",
      focusedName: activeAuthControl?.name ?? "",
      selection: Number.isInteger(activeAuthControl?.selectionStart)
        ? [activeAuthControl.selectionStart, activeAuthControl.selectionEnd]
        : null,
    } : null;
    root.innerHTML = renderShell(route, DEMO_STATE, renderPage(route, DEMO_STATE));
    let restoredAuthFocus = false;
    const currentAuthForm = root.querySelector('form[data-demo-form="auth"]');
    if (route === "/auth" && currentAuthForm && authFormSnapshot?.mode === currentAuthForm.dataset.authMode) {
      for (const [name, value] of authFormSnapshot.values) {
        const field = currentAuthForm.elements.namedItem(name);
        if (field && "value" in field) field.value = value;
      }
      const errorRegion = currentAuthForm.querySelector("[data-auth-error]");
      if (errorRegion && authFormSnapshot.errorText) {
        errorRegion.textContent = authFormSnapshot.errorText;
        errorRegion.hidden = false;
      }
      if (authFormSnapshot.submitting) {
        currentAuthForm.dataset.submitting = "true";
        currentAuthForm.querySelectorAll('button[type="submit"]').forEach((button) => { button.disabled = true; });
      }
      if (authFormSnapshot.focusedName) {
        const field = currentAuthForm.elements.namedItem(authFormSnapshot.focusedName);
        if (field?.focus) {
          field.focus({ preventScroll: true });
          if (authFormSnapshot.selection && field.setSelectionRange) field.setSelectionRange(...authFormSnapshot.selection);
          restoredAuthFocus = true;
        }
      }
    }
    if (route === "/auth" && DEMO_STATE.auth?.mode === "register" && ["degraded", "down"].includes(DEMO_STATE.service?.api)) {
      const form = root.querySelector('form[data-demo-form="auth"]');
      const submit = form?.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      form?.insertAdjacentHTML("beforebegin", '<p class="auth-service-notice" role="alert">账号服务暂时不可用。为避免你填写后失败，注册已暂停；请稍后重试。</p>');
    }
    const appShell = root.querySelector(".app-shell");
    appShell?.setAttribute("data-motion", motionEnabled ? "on" : "off");
    if (DEMO_STATE.tour?.active && route === "/") {
      const tour = root.querySelector(".interface-tour");
      appShell?.setAttribute("data-tour-step", tour?.dataset.tourTargetName || "");
    } else {
      appShell?.removeAttribute("data-tour-step");
    }
    root.style.setProperty("--scroll-shift", motionEnabled ? `${Math.min(window.scrollY, 700) * 0.12}px` : "0px");
    root.style.setProperty("--scroll-ratio", motionEnabled ? `${Math.min(window.scrollY / Math.max(window.innerHeight, 1), 1)}` : "0");
    root.querySelectorAll(".page > .page-intro, .page > :not(.page-intro)").forEach((element, index) => {
      element.classList.add("reveal-item");
      element.style.setProperty("--reveal-delay", `${Math.min(index * 70, 280)}ms`);
    });
    const revealItems = [...root.querySelectorAll(".reveal-item")];
    if (revealObserver) revealObserver.disconnect();
    if (motionEnabled && "IntersectionObserver" in window) {
      revealObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in-view");
          revealObserver?.unobserve(entry.target);
        }
      }), { threshold: 0.12, rootMargin: "0px 0px -7%" });
      revealItems.forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) {
          element.classList.add("is-in-view");
          return;
        }
        revealObserver.observe(element);
      });
    } else {
      revealItems.forEach((element) => element.classList.add("is-in-view"));
    }
    bindEvents();
    if (route === "/admin" && authenticated && DEMO_STATE.adminAnalytics?.status === "idle") void syncAdminOverview();
    window.requestAnimationFrame(syncTourSpotlight);
    requestAnimationFrame(() => {
      if (!restoredAuthFocus) root.querySelector("#main-content")?.focus({ preventScroll: true });
    });
  };

  const syncTourSpotlight = () => {
    const tour = root.querySelector(".interface-tour");
    const spotlight = root.querySelector(".interface-tour__spotlight");
    if (!tour || !spotlight) return;
    const target = root.querySelector(`[data-tour-target="${tour.dataset.tourTargetName}"]`);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    if ((rect.top < 0 || rect.bottom > window.innerHeight) && !tour.dataset.didScroll) {
      tour.dataset.didScroll = "true";
      target.scrollIntoView({ block: "center", behavior: motionEnabled ? "smooth" : "auto" });
      window.requestAnimationFrame(syncTourSpotlight);
      return;
    }
    const pad = window.innerWidth <= 700 ? 7 : 11;
    spotlight.style.setProperty("--tour-x", `${Math.max(7, rect.left - pad)}px`);
    spotlight.style.setProperty("--tour-y", `${Math.max(7, rect.top - pad)}px`);
    spotlight.style.setProperty("--tour-w", `${Math.min(window.innerWidth - 14, rect.width + pad * 2)}px`);
    spotlight.style.setProperty("--tour-h", `${Math.min(window.innerHeight - 14, rect.height + pad * 2)}px`);
  };

  const navigate = (route, afterRender) => {
    const next = normalizeRoute(route);
    if (next !== window.location.pathname) window.history.pushState({}, "", next);
    root.querySelector(".app-shell")?.setAttribute("data-route-phase", "out");
    window.clearTimeout(transitionTimer);
    transitionTimer = window.setTimeout(() => {
      render(next);
      window.requestAnimationFrame(() => root.querySelector(".app-shell")?.setAttribute("data-route-phase", "in"));
      if (typeof afterRender === "function") afterRender();
    }, motionEnabled ? 120 : 0);
  };

  const toast = (message) => {
    const region = root.querySelector(".toast-region");
    if (!region) return;
    region.textContent = message;
    region.classList.add("is-visible");
    window.setTimeout(() => region.classList.remove("is-visible"), 2200);
  };

  window.addEventListener("lijing-session-expired", () => {
    if (DEMO_STATE.isDemo) return;
    resetToDemoState("login");
    navigate("/auth");
    toast("登录已过期，请重新登录后继续");
  });

  const playAscensionIntro = (nextRoute = "/") => {
    const intro = root.querySelector("#ascension-intro");
    if (!intro || !motionEnabled) {
      navigate(nextRoute);
      return;
    }
    const video = intro.querySelector(".ascension-intro__video");
    const finish = () => {
      if (intro.dataset.finished === "true") return;
      intro.dataset.finished = "true";
      window.clearTimeout(ascensionTimer);
      intro.classList.add("is-complete");
      window.setTimeout(() => navigate(nextRoute), 520);
    };
    window.clearTimeout(ascensionTimer);
    intro.dataset.finished = "false";
    intro.removeAttribute("hidden");
    intro.setAttribute("aria-hidden", "false");
    void intro.offsetWidth;
    intro.classList.add("is-playing");
    if (video) {
      if (!video.src) video.src = video.dataset.src || "";
      video.addEventListener("ended", finish, { once: true });
      video.addEventListener("error", finish, { once: true });
      video.load();
      try { video.currentTime = 0; } catch { /* The browser may not have loaded metadata yet. */ }
      video.play().catch(() => {});
    }
    ascensionTimer = window.setTimeout(finish, 5600);
  };

  function bindEvents() {
    root.querySelectorAll("[data-route]").forEach((element) => element.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(element.dataset.route);
    }));
    root.querySelectorAll('[data-action="admin-refresh"]').forEach((element) => element.addEventListener("click", () => {
      DEMO_STATE.adminAnalytics = { ...DEMO_STATE.adminAnalytics, status: "idle", error: "" };
      render("/admin");
    }));
    root.querySelectorAll("form[data-admin-date]").forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault();
      const date = form.elements.date?.value || undefined;
      void syncAdminOverview(date);
    }));
    root.querySelectorAll('[data-action="toggle-motion"]').forEach((element) => element.addEventListener("click", () => {
      motionEnabled = !motionEnabled;
      DEMO_STATE.preferences.motion = motionEnabled;
      window.localStorage?.setItem("lijing-motion", motionEnabled ? "on" : "off");
      root.querySelector(".app-shell")?.setAttribute("data-motion", motionEnabled ? "on" : "off");
      root.querySelectorAll('[data-action="toggle-motion"]').forEach((button) => button.setAttribute("aria-pressed", String(motionEnabled)));
      root.querySelectorAll(".toggle").forEach((toggle) => toggle.classList.toggle("is-on", motionEnabled));
      toast(motionEnabled ? "云雾动效已开启" : "已切换为静谧模式");
    }));
    root.querySelectorAll('[data-preference="notifications"]').forEach((element) => element.addEventListener("change", () => {
      DEMO_STATE.preferences.notifications = element.value;
      window.localStorage?.setItem("lijing-notifications", element.value);
      toast(`通知偏好已设为${element.options[element.selectedIndex]?.text ?? "当前选项"}`);
    }));
    root.querySelectorAll('[data-action="auth-mode"]').forEach((element) => element.addEventListener("click", () => {
      DEMO_STATE.auth.mode = element.dataset.authMode === "register" ? "register" : "login";
      render("/auth");
    }));
    root.querySelectorAll("[data-onboarding-minutes]").forEach((element) => element.addEventListener("input", () => {
      const output = root.querySelector("[data-onboarding-minutes-output]");
      if (output) output.textContent = element.value;
    }));
    root.querySelectorAll("[data-route-hours]").forEach((element) => element.addEventListener("input", () => {
      const output = root.querySelector("[data-route-hours-output]");
      if (output) output.textContent = element.value;
    }));
    root.querySelectorAll("[data-goal]").forEach((element) => element.addEventListener("click", () => {
      selectedGoal = element.dataset.goal;
      DEMO_STATE.goals.forEach((goal) => { goal.selected = goal.id === selectedGoal; });
      if (DEMO_STATE.onboarding?.profile) DEMO_STATE.onboarding.profile.target = selectedGoal;
      const onboardingGoal = root.querySelector("[data-onboarding-goal]");
      if (onboardingGoal) onboardingGoal.value = selectedGoal;
      const selectedGoalData = DEMO_STATE.goals.find((goal) => goal.id === selectedGoal);
      const onboardingSelection = root.querySelector("[data-onboarding-selected-goal]");
      if (onboardingSelection && selectedGoalData) {
        onboardingSelection.setAttribute("aria-label", `当前目标：${selectedGoalData.title}`);
        onboardingSelection.querySelector("[data-onboarding-selected-icon]").textContent = selectedGoalData.icon;
        onboardingSelection.querySelector("[data-onboarding-selected-title]").textContent = selectedGoalData.title;
        onboardingSelection.querySelector("[data-onboarding-selected-detail]").textContent = selectedGoalData.detail;
      }
      root.querySelectorAll("[data-goal]").forEach((goal) => {
        const selected = goal.dataset.goal === selectedGoal;
        goal.classList.toggle("is-selected", selected);
        goal.setAttribute("aria-pressed", String(selected));
      });
      if (DEMO_STATE.isDemo) toast("方向已记录在你的山门印中");
      else void persistUserState().then(() => toast("方向已保存到你的山门印中")).catch((error) => toast(error.message));
      if (["/cet", "/study", "/route"].includes(window.location.pathname)) render(window.location.pathname);
    }));
    root.querySelectorAll('[data-action="complete-onboarding"]').forEach((element) => element.addEventListener("click", (event) => {
      event.preventDefault();
      playAscensionIntro(element.getAttribute("href") || "/features");
    }));
    root.querySelectorAll('[data-action="tour-skip"]').forEach((element) => element.addEventListener("click", () => {
      DEMO_STATE.tour.active = false;
      render(window.location.pathname);
      toast("导览已收起，可从首页右上角的帮助入口再次查看");
    }));
    root.querySelectorAll('[data-action="tour-open"]').forEach((element) => element.addEventListener("click", () => {
      DEMO_STATE.tour = { active: true, step: 0 };
      if (window.location.pathname === "/") render("/"); else navigate("/");
    }));
    root.querySelectorAll('[data-action="tour-prev"]').forEach((element) => element.addEventListener("click", () => {
      DEMO_STATE.tour.step = Math.max(0, (Number(DEMO_STATE.tour.step) || 0) - 1);
      render("/");
    }));
    root.querySelectorAll('[data-action="tour-next"]').forEach((element) => element.addEventListener("click", () => {
      const lastTourStep = 3;
      if ((Number(DEMO_STATE.tour.step) || 0) < lastTourStep) {
        DEMO_STATE.tour.step += 1;
        render("/");
        return;
      }
      DEMO_STATE.tour.active = false;
      render("/");
      toast("导览完成，今天先走下一步");
    }));
    root.querySelectorAll('[data-action="companion-check-in"]').forEach((element) => element.addEventListener("click", async () => {
      const intent = element.dataset.companionIntent;
      const taskId = element.dataset.taskId;
      if (!intent || !taskId) return;
      if (DEMO_STATE.isDemo) {
        toast("登录后，引路会把这次行动保存到你的今日循环");
        return;
      }
      element.disabled = true;
      try {
        const payload = { intent, task_id: taskId };
        if (element.dataset.actionVersion) payload.action_version = Number(element.dataset.actionVersion);
        if (intent === "stuck") payload.blocker_type = root.querySelector("[data-companion-blocker]")?.value || "unknown";
        applyCompanionCycle(await requestCompanionCheckIn(payload));
        render(window.location.pathname);
        toast(intent === "start" ? "已开始这一段，完成后回来留下证据" : intent === "stuck" ? "已记下卡住的位置，先按引路给出的最小一步继续" : "今天先缓一缓，下一次会从更小的一步开始");
      } catch (error) {
        if (error.code === "action_version_conflict" || error.status === 409) {
          await syncCompanionCycle();
          render(window.location.pathname);
          toast("这条行动已经更新，页面已刷新，请按最新版本继续");
          return;
        }
        toast(error.message);
      } finally {
        element.disabled = false;
      }
    }));
    root.querySelectorAll('[data-action="select-evidence"]').forEach((element) => element.addEventListener("click", () => {
      const level = Number(element.dataset.evidenceLevel);
      DEMO_STATE.pilot.selectedEvidenceLevel = level;
      root.querySelectorAll('[data-action="select-evidence"]').forEach((item) => {
        const selected = Number(item.dataset.evidenceLevel) === level;
        item.classList.toggle("is-selected", selected);
        item.setAttribute("aria-pressed", String(selected));
      });
      const label = root.querySelector(".evidence-submit__level");
      if (label) label.textContent = `当前 L${level}`;
    }));
    root.querySelectorAll('[data-action="submit-evidence"]').forEach((element) => element.addEventListener("click", async () => {
      const input = root.querySelector("[data-evidence-input]");
      const evidence = input?.value.trim() ?? "";
      const evidenceLevel = DEMO_STATE.pilot.selectedEvidenceLevel;
      if (!evidence) {
        toast("请写下一句真实的学习记录");
        input?.focus();
        return;
      }
      DEMO_STATE.pilot.submittedEvidence = evidence;
      element.disabled = true;
      const companionTaskId = element.dataset.taskId || DEMO_STATE.companionCycle?.task?.id;
      const activeTask = DEMO_STATE.today.tasks.find((task) => task.id === companionTaskId)
        ?? DEMO_STATE.today.tasks.find((task) => task.status === "active");
      if (!DEMO_STATE.isDemo) {
        try {
          if (!companionTaskId) throw new Error("今日任务尚未同步，请刷新后再提交证据");
          applyCompanionCycle(await requestCompanionCheckIn({
            intent: "complete",
            task_id: companionTaskId,
            evidence_level: evidenceLevel,
            evidence,
          }));
        } catch (error) {
          element.disabled = false;
          toast(error.message);
          return;
        }
      }
      const iterationId = `iteration-${Date.now()}`;
      let iterationReview;
      try {
        const result = await requestAi("/api/v1/ai/review", {
          task: activeTask?.title || "当前学习任务",
          answer: evidence,
          evidence_level: evidenceLevel,
          evidence,
          context: { goal_type: routeTypeForGoal(selectedClientGoal()), goal: selectedClientGoal()?.title ?? "当前学习目标" },
        });
        iterationReview = result.review;
        DEMO_STATE.pilot.review = iterationReview;
        DEMO_STATE.pilot.reviewReady = true;
        DEMO_STATE.pilot.reviewError = "";
      } catch (error) {
        iterationReview = localReview(evidence, evidenceLevel);
        DEMO_STATE.pilot.review = iterationReview;
        DEMO_STATE.pilot.reviewReady = false;
        const invalidReviewFormat = error.code === "AI_REVIEW_FORMAT_INVALID";
        DEMO_STATE.pilot.reviewError = invalidReviewFormat ? "AI 结果未通过复盘格式校验，当前显示规则复盘。" : error.message;
        toast(invalidReviewFormat ? "AI 复盘格式不完整，已改用规则复盘；学习证据仍已保存" : "证据已留下，AI 暂时不可用，已用规则复盘继续沉淀");
      }
      if (activeTask) {
        const wasCompleted = activeTask.status === "done";
        activeTask.status = "done";
        const nextTask = DEMO_STATE.today.tasks.find((task) => task.status === "locked");
        if (nextTask) nextTask.status = "active";
        if (!wasCompleted) {
          DEMO_STATE.today.completed = Math.min(DEMO_STATE.today.completed + 1, DEMO_STATE.today.total);
        }
        const knowledge = DEMO_STATE.knowledge.find((item) => activeTask.title.includes(item.title));
        if (knowledge) {
          knowledge.evidenceLevel = evidenceLevel;
          knowledge.updated = "刚刚";
        }
      }
      if (iterationReview) {
        const payload = {
          iteration_id: iterationId,
          goal_scope: ["goal-cet4", "goal-cet6"].includes(selectedClientGoal()?.id) ? "goal-exam" : selectedClientGoal()?.id ?? "global",
          goal_title: selectedClientGoal()?.title ?? "当前学习目标",
          task_id: activeTask?.id ?? "current-task",
          evidence_level: evidenceLevel,
          evidence,
          review: { problem: iterationReview.problem, reason: iterationReview.reason, next_action: iterationReview.nextAction },
        };
        try {
          DEMO_STATE.memory.syncStatus = "saving";
          const result = DEMO_STATE.isDemo
            ? { iteration_id: iterationId, iteration_count: (DEMO_STATE.memory.iterationCount ?? 0) + 1, candidates: localMemoryCandidates(payload, iterationId) }
            : await requestMemoryIteration(payload);
          applyMemoryResponse(result);
        } catch (error) {
          DEMO_STATE.memory.syncStatus = "error";
          toast(error.message);
        }
      } else {
        DEMO_STATE.memory.syncStatus = "idle";
      }
      element.disabled = false;
      if (!DEMO_STATE.isDemo) {
        try {
          await persistEvidenceKnowledge({
            state: DEMO_STATE,
            action: activeTask ?? { id: companionTaskId, title: "当前学习任务" },
            evidence,
            evidenceLevel,
            persist: persistUserState,
          });
          const route = DEMO_STATE.learningRoute?.draft;
          const planTask = route?.plan?.today?.tasks?.find((task) => task.completion_status === "active") ?? route?.plan?.today?.tasks?.[0];
          if (route?.id && Number.isInteger(route.version) && planTask?.id) {
            applyLearningRoute(await refreshLearningPlan(route.id, route.version, [planTask.id], [], Number(DEMO_STATE.user.dailyMinutes)));
          }
          await syncCompanionCycle();
        } catch (error) {
          toast(error.message);
        }
      } else {
        await persistEvidenceKnowledge({
          state: DEMO_STATE,
          action: activeTask ?? { id: companionTaskId, title: "当前学习任务" },
          evidence,
          evidenceLevel,
        });
      }
      navigate("/review");
    }));
    root.querySelectorAll('[data-action="memory-feedback"]').forEach((element) => element.addEventListener("click", async () => {
      const memoryId = element.dataset.memoryId;
      const action = element.dataset.memoryAction;
      if (!memoryId || !action) return;
      element.disabled = true;
      try {
        if (DEMO_STATE.isDemo) {
          const memory = DEMO_STATE.memory.memories.find((item) => item.id === memoryId);
          if (memory) memory.status = action === "confirm" ? "active" : "rejected";
          DEMO_STATE.memory.memories = DEMO_STATE.memory.memories.filter((item) => item.status !== "rejected");
        } else {
          applyMemoryResponse(await requestMemoryFeedback(memoryId, action));
        }
        render(window.location.pathname);
        toast(action === "confirm" ? "这条记忆会参与下一次引路" : "已从你的长期记忆中移除");
      } catch (error) {
        toast(error.message);
      } finally {
        element.disabled = false;
      }
    }));
    root.querySelectorAll('[data-action="capture-knowledge"]').forEach((element) => element.addEventListener("click", () => {
      DEMO_STATE.knowledgeCaptureDraft = {
        title: element.dataset.knowledgeTitle ?? "",
        source: element.dataset.knowledgeSource ?? "学习 · 当前学习",
        strand: "当前学习",
      };
      DEMO_STATE.knowledgeComposerOpen = true;
      navigate("/knowledge");
    }));
    root.querySelectorAll('[data-action="ask-guide"]').forEach((element) => element.addEventListener("click", () => {
      const input = root.querySelector(".assistant-composer input");
      if (input) { input.value = element.textContent; input.focus(); }
    }));
    root.querySelectorAll('[data-action="select-knowledge"]').forEach((element) => element.addEventListener("click", () => {
      DEMO_STATE.activeKnowledgeId = element.dataset.knowledgeId;
      render(window.location.pathname);
    }));
    root.querySelectorAll('[data-action="knowledge-view"]').forEach((element) => element.addEventListener("click", () => {
      DEMO_STATE.knowledgeView = element.dataset.knowledgeView || "network";
      render(window.location.pathname);
    }));
    root.querySelectorAll('[data-action="knowledge-zoom"]').forEach((element) => element.addEventListener("click", () => {
      const mode = element.dataset.zoom;
      const current = Number(DEMO_STATE.knowledgeGraphZoom) || 1;
      DEMO_STATE.knowledgeGraphZoom = mode === "reset" ? 1 : Math.min(1.24, Math.max(.86, current + (mode === "in" ? .1 : -.1)));
      render(window.location.pathname);
    }));
    root.querySelectorAll('[data-action="open-knowledge-composer"]').forEach((element) => element.addEventListener("click", () => {
      DEMO_STATE.knowledgeCaptureDraft = null;
      DEMO_STATE.knowledgeComposerOpen = true;
      render(window.location.pathname);
    }));
    root.querySelectorAll('[data-action="close-knowledge-composer"]').forEach((element) => element.addEventListener("click", () => {
      DEMO_STATE.knowledgeComposerOpen = false;
      DEMO_STATE.knowledgeCaptureDraft = null;
      render(window.location.pathname);
    }));
    root.querySelectorAll('[data-action="retry-route-sync"]').forEach((element) => element.addEventListener("click", async () => {
      DEMO_STATE.learningRoute = { ...DEMO_STATE.learningRoute, syncStatus: "loading", error: "" };
      render(window.location.pathname);
      await syncLearningRoute();
      if (renderedRoute === "/route") render("/route");
    }));
    root.querySelectorAll('[data-action="retry-learning-route"]').forEach((element) => element.addEventListener("click", () => {
      const form = root.querySelector('form[data-demo-form="learning-route"]');
      if (form?.requestSubmit) form.requestSubmit();
    }));
    root.querySelectorAll('[data-action="confirm-learning-route"]').forEach((element) => element.addEventListener("click", async () => {
      if (DEMO_STATE.isDemo) {
        toast("请先登录真实账号，再确认学习路线");
        return;
      }
      const routeId = element.dataset.routeId;
      const expectedVersion = Number(element.dataset.routeVersion);
      if (!routeId || !Number.isInteger(expectedVersion)) return;
      element.disabled = true;
      try {
        applyLearningRoute(await confirmLearningRoute(routeId, expectedVersion));
        DEMO_STATE.learningRoute.error = "";
        DEMO_STATE.onboarding.completed = true;
        await persistUserState();
        await syncCompanionCycle();
        navigate("/", () => toast("路线已确认，今天这一条已经准备好"));
      } catch (error) {
        toast(error.message);
        element.disabled = false;
      }
    }));
    root.querySelectorAll('[data-action="export-learning-plan"]').forEach((element) => element.addEventListener("click", () => {
      if (DEMO_STATE.isDemo) {
        toast("请先登录并生成自己的七日计划");
        return;
      }
      window.print();
    }));
    root.querySelectorAll('[data-action="advance-learning-week"]').forEach((element) => element.addEventListener("click", async () => {
      const route = DEMO_STATE.learningRoute?.draft;
      if (DEMO_STATE.isDemo || !route?.id || route.id !== element.dataset.routeId) {
        toast("请先登录并打开自己的学习路线");
        return;
      }
      element.disabled = true;
      try {
        applyLearningRoute(await refreshLearningPlan(route.id, route.version, [], [], undefined, [], true));
        render("/plan");
        toast("下一周期计划已生成，并参考了你的自述反馈");
      } catch (error) {
        toast(error.message);
        element.disabled = false;
      }
    }));
    root.querySelectorAll("[data-knowledge-search]").forEach((input) => input.addEventListener("input", () => {
      const query = input.value.trim().toLowerCase();
      root.querySelectorAll("[data-knowledge-item]").forEach((item) => {
        item.hidden = Boolean(query) && !item.textContent.toLowerCase().includes(query);
      });
    }));
    root.querySelectorAll("[data-material-image]").forEach((input) => input.addEventListener("change", () => {
      const form = input.closest('form[data-demo-form="learning-artifact"]');
      if (!form) return;
      form.dataset.photoConfirmed = "false";
      const label = form.querySelector("[data-material-image-name]");
      const uncertainty = form.querySelector("[data-material-image-uncertain]");
      if (label) label.textContent = input.files?.[0]?.name || "选择图片、上传文件或直接拍摄";
      if (uncertainty) {
        uncertainty.hidden = true;
        uncertainty.textContent = "";
      }
    }));
    root.querySelectorAll("[data-material-subject]").forEach((select) => {
      const form = select.closest('form[data-demo-form="learning-artifact"]');
      const customField = form?.querySelector("[data-material-custom-subject-field]");
      const customInput = form?.querySelector("[data-material-custom-subject]");
      if (!customField || !customInput) return;
      const sync = () => {
        const custom = select.value === "其他主题";
        customField.hidden = !custom;
        customInput.required = custom;
        if (!custom) customInput.value = "";
      };
      select.addEventListener("change", sync);
      sync();
    });
    root.querySelectorAll("form[data-demo-form]").forEach((form) => form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (form.dataset.submitting === "true") return;
      form.dataset.submitting = "true";
      form.querySelectorAll("button[type=submit]").forEach((button) => { button.disabled = true; });
      try {
      if (form.dataset.demoForm === "learning-plan-feedback") {
        if (DEMO_STATE.isDemo) {
          toast("请先登录并生成自己的学习计划");
          return;
        }
        const route = DEMO_STATE.learningRoute?.draft;
        if (!route?.id || !Number.isInteger(route.version) || route.status !== "confirmed") {
          toast("请先确认学习路线，再记录执行反馈");
          return;
        }
        const values = new FormData(form);
        const actualMinutes = String(values.get("actual_minutes") ?? "").trim();
        const feedback = {
          task_id: form.dataset.taskId,
          status: String(values.get("status") ?? "not_started"),
          actual_minutes: actualMinutes === "" ? null : Number(actualMinutes),
          note: String(values.get("note") ?? "").trim(),
        };
        applyLearningRoute(await refreshLearningPlan(route.id, route.version, [], [], undefined, [feedback]));
        render("/plan");
        toast("自述反馈已保存；平台不验证你是否真实学习");
        return;
      }
      if (form.dataset.demoForm === "learning-artifact") {
        if (DEMO_STATE.isDemo) {
          toast("请先登录真实账号，再把材料交给引路");
          return;
        }
        if (DEMO_STATE.pilot.materialPending) {
          toast("AI 引路正在思考，请稍候…");
          return;
        }
        const values = new FormData(form);
        const sourceTitle = String(values.get("source_title") ?? "").trim();
        const selectedSubject = String(values.get("subject") ?? "数学").trim() || "数学";
        const customSubject = String(values.get("custom_subject") ?? "").trim();
        const subject = selectedSubject === "其他主题" ? customSubject : selectedSubject;
        const kind = String(values.get("kind") ?? "question").trim() || "question";
        const contentText = String(values.get("content_text") ?? "").trim();
        const imageInput = form.querySelector("[data-material-image]");
        const image = imageInput?.files?.[0] ?? null;
        if (image && form.dataset.photoConfirmed !== "true") {
          const extraction = await requestMaterialImageExtraction(image);
          if (extraction.status !== "ready" || !extraction.draft) {
            toast("图片暂时无法稳定识别，请直接粘贴文字后再交给引路");
            return;
          }
          const draft = extraction.draft;
          const titleInput = form.querySelector('[name="source_title"]');
          const kindInput = form.querySelector('[name="kind"]');
          const contentInput = form.querySelector('[name="content_text"]');
          if (titleInput) titleInput.value = draft.source_title;
          if (kindInput) kindInput.value = draft.kind;
          if (contentInput) contentInput.value = draft.content_text;
          form.dataset.photoConfirmed = "true";
          imageInput.value = "";
          const label = form.querySelector("[data-material-image-name]");
          if (label) label.textContent = "已提取，请确认文字后再提交";
          const uncertainty = form.querySelector("[data-material-image-uncertain]");
          if (uncertainty) {
            uncertainty.hidden = !(draft.uncertain_parts?.length);
            uncertainty.textContent = draft.uncertain_parts?.length ? `请核对：${draft.uncertain_parts.join("；")}` : "";
          }
          toast("已提取可确认文字，请核对后再提交");
          return;
        }
        if (!sourceTitle || !subject || subject.length > 80 || contentText.length < 12) {
          if (!subject) {
            toast("请填写你要学习的主题，例如 Python、物理或英语口语");
            return;
          }
          toast("请至少填写材料标题，并粘贴 12 个字以上的内容");
          return;
        }
        DEMO_STATE.pilot.materialPending = true;
        render(window.location.pathname);
        toast("AI 引路正在思考，请稍候…");
        window.requestAnimationFrame(() => root.querySelector(".companion-thinking")?.scrollIntoView({ block: "center", behavior: motionEnabled ? "smooth" : "auto" }));
        try {
          const artifactResult = await requestLearningArtifact({ kind, subject, source_title: sourceTitle, content_text: contentText });
          if (artifactResult.artifact) DEMO_STATE.learningArtifacts = [artifactResult.artifact, ...(DEMO_STATE.learningArtifacts ?? []).filter((item) => item.id !== artifactResult.artifact.id)];
          const diagnosisResult = await requestMaterialDiagnosis({ artifact_ids: [artifactResult.artifact.id], subject, focus: contentText.slice(0, 800) });
          applyCompanionCycle(diagnosisResult);
          DEMO_STATE.pilot.materialPending = false;
          if (diagnosisResult.status === "degraded") {
            DEMO_STATE.service.aiStatus = "unavailable";
            DEMO_STATE.service.aiAvailable = false;
            toast("引路暂时没有完成模型诊断，已根据材料给你一条可执行动作");
          } else {
            DEMO_STATE.service.aiStatus = "available";
            DEMO_STATE.service.aiAvailable = true;
            toast("材料已读完，第一条行动已经准备好");
          }
          render(window.location.pathname);
          window.requestAnimationFrame(() => root.querySelector(".companion-feedback")?.scrollIntoView({ block: "center", behavior: motionEnabled ? "smooth" : "auto" }));
        } catch (error) {
          DEMO_STATE.pilot.materialPending = false;
          render(window.location.pathname);
          throw error;
        }
        return;
      }
      if (form.dataset.demoForm === "material-evidence") {
        if (DEMO_STATE.isDemo) {
          toast("请先登录真实账号，再提交学习证据");
          return;
        }
        const actionId = form.dataset.actionId;
        const actionVersion = Number(form.dataset.actionVersion);
        const values = new FormData(form);
        const evidence = String(values.get("evidence") ?? "").trim();
        const evidenceLevel = Number(values.get("evidence_level"));
        const actionState = DEMO_STATE.companionCycle?.currentAction;
        if (!actionId || !Number.isInteger(actionVersion) || !evidence || !Number.isInteger(evidenceLevel)) {
          toast("请先留下证据，再提交这一条行动");
          return;
        }
        if (!actionState || actionState.id !== actionId) {
          toast("这条行动已经更新，请刷新后继续");
          return;
        }
        DEMO_STATE.pilot.selectedEvidenceLevel = evidenceLevel;
        const pendingStatus = form.querySelector("[data-evidence-pending]");
        if (pendingStatus) {
          pendingStatus.hidden = false;
          pendingStatus.textContent = "正在保存证据，并请 AI 器灵整理本轮复盘与下一步…";
        }
        form.setAttribute("aria-busy", "true");
        try {
          const attemptResult = await requestMaterialAttempt({
            artifact_ids: actionState.artifact_refs ?? [],
            action_id: actionId,
            action_version: actionVersion,
            kind: "reflection",
            content: evidence,
            self_report: "completed",
            elapsed_minutes: actionState.estimated_minutes,
          });
          const evidenceResult = await requestMaterialEvidence(actionId, {
            action_version: actionVersion,
            attempt_id: attemptResult.attempt.id,
            evidence,
            evidence_level: evidenceLevel,
          });
          const completedAction = evidenceResult.action ?? actionState;
          if (pendingStatus) pendingStatus.textContent = "证据已保存，AI 器灵正在思考复盘与下一步…";
          const reviewResult = await requestMaterialReview({
            task: completedAction.title ?? actionState.title,
            evidence,
            evidenceLevel,
            context: {
              goal_type: routeTypeForGoal(selectedClientGoal()),
              goal: selectedClientGoal()?.title ?? "当前学习目标",
              action_reason: completedAction.reason ?? actionState.reason,
            },
          });
          DEMO_STATE.pilot.submittedEvidence = evidence;
          DEMO_STATE.pilot.review = reviewResult.review;
          DEMO_STATE.pilot.reviewReady = reviewResult.reviewReady;
          DEMO_STATE.pilot.reviewError = reviewResult.reviewError;
          let stateSaved = true;
          try {
            await persistEvidenceKnowledge({ state: DEMO_STATE, action: completedAction, evidence, evidenceLevel, persist: persistUserState });
          } catch {
            DEMO_STATE.service.persistenceNotice = "证据已保存，但复盘和知识账本暂未同步到可恢复状态。";
            stateSaved = false;
          }
          const memorySaved = await recordEvidenceMemory(completedAction, evidence, evidenceLevel, reviewResult.review);
          DEMO_STATE.pilot.inlineReview = {
            completedTitle: evidenceResult.action?.title ?? actionState.title,
            evidence,
            nextTitle: evidenceResult.next_action?.title ?? "下一条行动已准备好",
            nextReason: evidenceResult.next_action?.reason ?? "根据这次留下的证据继续向前。",
          };
          applyCompanionCycle(evidenceResult);
          await syncCompanionCycle();
          render(window.location.pathname);
          toast(!stateSaved
            ? "证据已保存，但复盘和知识账本暂未确认可跨重启恢复"
            : !reviewResult.reviewReady
              ? "证据已保存，AI 暂不可用，已明确标为规则复盘"
              : memorySaved
                ? "证据已保存，复盘、知识账本和下一条行动已经生成"
                : "证据已保存，复盘和下一条行动已经生成；记忆账本稍后同步");
        } catch (error) {
          if (error.code === "action_version_conflict" || error.status === 409) {
            await syncCompanionCycle();
            render(window.location.pathname);
            toast("这条行动已经更新，页面已刷新，请按最新版本继续");
            return;
          }
          throw error;
        }
        return;
      }
      if (form.dataset.demoForm === "knowledge-capture") {
        const values = new FormData(form);
        const title = String(values.get("title") ?? "").trim();
        if (!title) return;
        const previousKnowledge = structuredClone(DEMO_STATE.knowledge);
        const strand = String(values.get("strand") ?? "新知识").trim() || "新知识";
        const source = String(values.get("source") ?? "手动收录").trim() || "手动收录";
        const note = String(values.get("note") ?? "").trim() || "这是一条刚刚进入个人知识库的新节点。";
        const relatedId = String(values.get("relatedId") ?? "");
        const position = ["east", "west"].find((candidate) => !DEMO_STATE.knowledge.some((item) => item.position === candidate)) ?? "east";
        const id = `knowledge-${Date.now()}`;
        DEMO_STATE.knowledge.unshift({ id, title, domain: `${strand} · 新节点`, strand, mastery: 12, state: "初探", gua: "新", color: "gold", source, updated: "刚刚", summary: note, note, relatedIds: relatedId ? [relatedId] : [], position });
        if (relatedId) {
          const related = DEMO_STATE.knowledge.find((item) => item.id === relatedId);
          if (related) related.relatedIds = [...new Set([...(related.relatedIds ?? []), id])];
        }
        if (!DEMO_STATE.isDemo) {
          try {
            await persistUserState();
          } catch (error) {
            DEMO_STATE.knowledge = previousKnowledge;
            toast(error.message);
            return;
          }
        }
        DEMO_STATE.activeKnowledgeId = id;
        DEMO_STATE.knowledgeComposerOpen = false;
        DEMO_STATE.knowledgeCaptureDraft = null;
        render("/knowledge");
        toast("新知识已接入你的脉络");
        return;
      }
      if (form.dataset.demoForm === "settings-profile") {
        const values = new FormData(form);
        const name = String(values.get("name") ?? "").trim();
        const stage = String(values.get("stage") ?? "").trim();
        if (!name || !stage) {
          toast("行者名和当前阶段不能为空");
          return;
        }
        const dailyMinutes = Number(String(values.get("dailyMinutes") ?? "25").trim());
        const weeklyHours = Number(String(values.get("weeklyHours") ?? DEMO_STATE.user.weeklyHours ?? "8").trim());
        if (!Number.isInteger(dailyMinutes) || dailyMinutes < 5 || dailyMinutes > 1440 || !Number.isInteger(weeklyHours) || weeklyHours < 1 || weeklyHours > 60) {
          toast("每日投入需为 5–1440 分钟，每周投入需为 1–60 小时");
          return;
        }
        const previousUser = structuredClone(DEMO_STATE.user);
        const previousProfile = structuredClone(DEMO_STATE.onboarding.profile);
        const previousRouteState = structuredClone(DEMO_STATE.learningRoute);
        const currentRoute = DEMO_STATE.learningRoute?.draft;
        const currentRouteDailyMinutes = Number(currentRoute?.goal?.requested_daily_minutes ?? currentRoute?.goal?.daily_minutes ?? DEMO_STATE.user.dailyMinutes);
        const currentRouteWeeklyHours = Number(currentRoute?.goal?.weekly_hours ?? DEMO_STATE.user.weeklyHours);
        const routeNeedsRecalculation = Boolean(currentRoute && (currentRouteDailyMinutes !== dailyMinutes || currentRouteWeeklyHours !== weeklyHours));
        const submit = form.querySelector("button[type=submit]");
        const submitLabel = submit?.innerHTML;
        let routePayload = null;
        let progressStop = null;
        let routeCommitted = false;
        DEMO_STATE.user = {
          ...DEMO_STATE.user,
          name,
          title: stage,
          stage,
          school: String(values.get("school") ?? "").trim(),
          major: String(values.get("major") ?? "").trim(),
          age: values.has("age") ? String(values.get("age") ?? "").trim() : DEMO_STATE.user.age,
          region: values.has("region") ? String(values.get("region") ?? "").trim() : DEMO_STATE.user.region,
          notes: values.has("notes") ? String(values.get("notes") ?? "").trim() : DEMO_STATE.user.notes,
          dailyMinutes: String(dailyMinutes),
          weeklyHours: String(weeklyHours),
          reminderEnabled: values.has("reminderEnabled"),
          reminderTime: values.has("reminderTime") ? String(values.get("reminderTime") ?? "20:00").trim() : DEMO_STATE.user.reminderTime,
          timezone: values.has("timezone") ? String(values.get("timezone") ?? "Asia/Shanghai").trim() : DEMO_STATE.user.timezone,
        };
        DEMO_STATE.onboarding.profile = {
          ...DEMO_STATE.onboarding.profile,
          name: DEMO_STATE.user.name,
          stage: DEMO_STATE.user.stage,
          school: DEMO_STATE.user.school,
          major: DEMO_STATE.user.major,
          age: DEMO_STATE.user.age,
          region: DEMO_STATE.user.region,
          notes: DEMO_STATE.user.notes,
          dailyMinutes: DEMO_STATE.user.dailyMinutes,
          weeklyHours: DEMO_STATE.user.weeklyHours,
          reminderEnabled: DEMO_STATE.user.reminderEnabled,
          reminderTime: DEMO_STATE.user.reminderTime,
          timezone: DEMO_STATE.user.timezone,
        };
        try {
          if (routeNeedsRecalculation) {
            routePayload = routePayloadFromDraft(currentRoute, { daily_minutes: dailyMinutes, weekly_hours: weeklyHours });
            DEMO_STATE.learningRoute = { ...DEMO_STATE.learningRoute, error: "", form: routePayload };
            const progress = document.createElement("p");
            progress.className = "settings-route-status";
            progress.setAttribute("role", "status");
            progress.setAttribute("aria-live", "polite");
            form.append(progress);
            progressStop = startRouteGenerationProgress(progress, "profile");
            if (submit) {
              submit.disabled = true;
              submit.textContent = "正在同步路线...";
            }
            await recalculateAndConfirmRoute(routePayload, (message) => { progress.textContent = message; });
            routeCommitted = true;
            applyRouteConstraintsToProfile(routePayload);
          } else if (submit) {
            submit.disabled = true;
            submit.textContent = "正在保存个人信息...";
          }
          await persistUserState();
          render("/settings");
          toast(routeNeedsRecalculation ? "个人信息已保存，路线也已按新节律重算" : "个人信息已保存到当前账户");
        } catch (error) {
          if (!routeCommitted) {
            DEMO_STATE.user = previousUser;
            DEMO_STATE.onboarding.profile = previousProfile;
            DEMO_STATE.learningRoute = routeNeedsRecalculation && routePayload
              ? { ...previousRouteState, error: error.message, form: routePayload }
              : previousRouteState;
            toast(error.message);
          } else {
            DEMO_STATE.learningRoute.error = "路线已更新，但个人信息暂时没有保存，请刷新后重试。";
            toast("路线已更新，但个人信息暂时没有保存，请刷新后重试");
          }
        } finally {
          progressStop?.();
          if (submit?.isConnected) {
            submit.disabled = false;
            submit.innerHTML = submitLabel;
          }
        }
        return;
      }
      if (form.dataset.demoForm === "feedback") {
        if (DEMO_STATE.isDemo) {
          toast("请先登录真实账号，再提交功能反馈");
          return;
        }
        const values = new FormData(form);
        const submit = form.querySelector("button[type=submit]");
        const submitLabel = submit?.innerHTML;
        if (submit) {
          submit.disabled = true;
          submit.textContent = "正在提交反馈...";
        }
        try {
          await requestFeedback({
            category: String(values.get("category") ?? "other"),
            title: String(values.get("title") ?? "").trim(),
            detail: String(values.get("detail") ?? "").trim(),
            contact_email: String(values.get("contact_email") ?? "").trim(),
          });
          form.reset();
          toast("反馈已收到，谢谢你帮砺境变得更好");
        } catch (error) {
          toast(error.message);
        } finally {
          if (submit?.isConnected) {
            submit.disabled = false;
            submit.innerHTML = submitLabel;
          }
        }
        return;
      }
      if (form.dataset.demoForm === "learning-route-adjustment") {
        if (DEMO_STATE.isDemo) {
          toast("请先登录真实账号，再调整学习路线");
          return;
        }
        const currentRoute = DEMO_STATE.learningRoute?.draft;
        if (!currentRoute) {
          toast("当前还没有可调整的路线，请先生成路线");
          return;
        }
        const values = new FormData(form);
        const targetDate = String(values.get("target_date") ?? "").trim();
        const weeklyHours = Number(values.get("weekly_hours"));
        if (!targetDate || !Number.isInteger(weeklyHours) || weeklyHours < 1 || weeklyHours > 60) {
          toast("请填写有效的目标日期和每周时间");
          return;
        }
        const routePayload = routePayloadFromDraft(currentRoute, { target_date: targetDate, weekly_hours: weeklyHours });
        const previousRouteState = structuredClone(DEMO_STATE.learningRoute);
        DEMO_STATE.learningRoute = { ...DEMO_STATE.learningRoute, error: "", form: routePayload };
        const submit = form.querySelector("button[type=submit]");
        const submitLabel = submit?.innerHTML;
        const progress = document.createElement("p");
        progress.className = "route-generation-status";
        progress.setAttribute("role", "status");
        progress.setAttribute("aria-live", "polite");
        form.append(progress);
        const progressStop = startRouteGenerationProgress(progress, "adjustment");
        let routeCommitted = false;
        if (submit) {
          submit.disabled = true;
          submit.textContent = "正在重新计算路线...";
        }
        try {
          await recalculateAndConfirmRoute(routePayload, (message) => { progress.textContent = message; });
          routeCommitted = true;
          applyRouteConstraintsToProfile(routePayload);
          await persistUserState();
          await syncCompanionCycle();
          render("/route");
          toast("路线已按新条件重新计算");
        } catch (error) {
          if (!routeCommitted) {
            DEMO_STATE.learningRoute = { ...previousRouteState, error: error.message, form: routePayload, generationQuota: null, generationQuotaStatus: "loading" };
          } else {
            DEMO_STATE.learningRoute.error = "路线已更新，但个人信息暂时没有保存，请刷新后重试。";
          }
          toast(error.message);
          render("/route");
          if (!routeCommitted) void refreshGenerationQuota();
        } finally {
          progressStop();
          if (submit?.isConnected) {
            submit.disabled = false;
            submit.innerHTML = submitLabel;
          }
        }
        return;
      }
      if (form.dataset.demoForm === "learning-route") {
        if (DEMO_STATE.isDemo) {
          toast("请先登录真实账号，再生成学习路线");
          return;
        }
        const values = new FormData(form);
        const splitEntries = (value, separator) => String(value ?? "").split(separator).map((entry) => entry.trim()).filter(Boolean);
        const selectedGoal = selectedClientGoal();
        const submit = form.querySelector("button[type=submit]");
        const submitLabel = submit?.innerHTML;
        const progress = document.createElement("p");
        progress.className = "route-generation-status";
        progress.setAttribute("role", "status");
        progress.setAttribute("aria-live", "polite");
        form.append(progress);
        const progressStop = startRouteGenerationProgress(progress, "initial");
        if (submit) {
          submit.disabled = true;
          submit.textContent = "正在核算时间并生成今天的第一步...";
        }
        let routePayload = null;
        try {
          routePayload = {
            goal_type: routeTypeForGoal(selectedGoal),
            goal_name: String(selectedGoal?.title ?? values.get("goal_name") ?? "").trim(),
            target_date: String(values.get("target_date") ?? ""),
            daily_minutes: Number(values.get("daily_minutes")),
            weekly_hours: Number(values.get("weekly_hours")),
            baseline: "starting",
            region: String(values.get("region") ?? "").trim(),
            focus_areas: ["goal-cet4", "goal-cet6"].includes(selectedGoal?.id)
              ? ["听力理解", "阅读理解", "写作", "汉译英段落"]
              : splitEntries(values.get("focus_areas"), /[，,]/),
            constraints: splitEntries(values.get("constraints"), /\r?\n/),
          };
          DEMO_STATE.learningRoute = { ...DEMO_STATE.learningRoute, draft: null, clarification: null, error: "", form: routePayload };
          const routeResult = await requestLearningRoute(routePayload);
          if (routeResult.status === "clarification_required") {
            DEMO_STATE.learningRoute = {
              ...DEMO_STATE.learningRoute,
              draft: null,
              clarification: routeResult,
              error: "",
              form: routePayload,
              generationQuota: routeResult.generation_quota ?? DEMO_STATE.learningRoute?.generationQuota ?? null,
              generationQuotaStatus: hasGenerationQuota(routeResult.generation_quota)
                ? "synced"
                : DEMO_STATE.learningRoute?.generationQuotaStatus ?? "error",
            };
            render("/route");
            toast("还需要补充目标范围和现实约束");
            return;
          }
          applyLearningRoute(routeResult);
          DEMO_STATE.service.aiStatus = "available";
          DEMO_STATE.service.aiAvailable = true;
          DEMO_STATE.learningRoute.error = "";
          if (!routeResult.id || !Number.isInteger(routeResult.version)) {
            throw new Error("路线草案缺少确认信息，请重新生成");
          }
          render("/route");
          toast("路线草案已生成，请核对后确认");
          return;
        } catch (error) {
          DEMO_STATE.learningRoute = { ...DEMO_STATE.learningRoute, error: error.message, generationQuota: null, generationQuotaStatus: "loading" };
          if (/服务商|AI 服务暂时|AI 还在恢复/.test(String(error.message))) {
            DEMO_STATE.service.aiStatus = "unavailable";
            DEMO_STATE.service.aiAvailable = false;
          }
          DEMO_STATE.learningRoute.form = routePayload;
          render("/route");
          void refreshGenerationQuota();
          toast(error.message);
        } finally {
          progressStop();
          if (submit?.isConnected) {
            submit.disabled = false;
            submit.innerHTML = submitLabel;
          }
        }
        return;
      }
      if (form.dataset.demoForm === "onboarding-profile") {
        const values = new FormData(form);
        const name = String(values.get("name") ?? DEMO_STATE.user.name ?? DEMO_STATE.auth?.user?.display_name ?? "行者").trim();
        const stage = String(values.get("stage") ?? "在校学习").trim();
        const school = DEMO_STATE.user.school ?? "";
        const major = DEMO_STATE.user.major ?? "";
        const age = DEMO_STATE.user.age ?? "";
        const region = DEMO_STATE.user.region ?? "";
        const goalId = String(values.get("goal") ?? "").trim();
        const dailyMinutes = String(values.get("dailyMinutes") ?? "25").trim();
        if (!goalId) {
          toast("请先选择当前目标");
          return;
        }
        const previousUser = structuredClone(DEMO_STATE.user);
        const previousProfile = structuredClone(DEMO_STATE.onboarding.profile);
        const previousGoals = structuredClone(DEMO_STATE.goals);
        const previousOnboardingCompleted = DEMO_STATE.onboarding.completed;
        const goal = DEMO_STATE.goals.find((item) => item.id === goalId) ?? DEMO_STATE.goals[0];
        DEMO_STATE.goals.forEach((item) => { item.selected = item.id === goal.id; });
        DEMO_STATE.user = {
          ...DEMO_STATE.user,
          name,
          title: stage,
          stage,
          school,
          major,
          age,
          region,
          target: goal.title,
          dailyMinutes,
        };
        DEMO_STATE.onboarding.profile = { name, stage, school, major, age, region, target: goal.id, dailyMinutes };
        try {
          DEMO_STATE.onboarding.completed = true;
          await persistUserState();
          DEMO_STATE.onboarding.step = 1;
          await syncCompanionCycle();
          navigate("/route", () => toast("再确认截止日期和每周时间，今天这一条就会生成"));
        } catch (error) {
          DEMO_STATE.user = previousUser;
          DEMO_STATE.onboarding.profile = previousProfile;
          DEMO_STATE.goals = previousGoals;
          DEMO_STATE.onboarding.completed = previousOnboardingCompleted;
          toast(error.message);
        }
        return;
      }
      if (form.dataset.demoForm === "assistant") {
        const values = new FormData(form);
        const prompt = String(values.get("prompt") || "").trim();
        if (!prompt) return;
        const submit = form.querySelector("button[type=submit]");
        if (submit) submit.disabled = true;
        DEMO_STATE.pilot.assistantPrompt = prompt;
        DEMO_STATE.pilot.assistantPending = true;
        DEMO_STATE.pilot.assistantError = "";
        render(window.location.pathname);
        toast("AI 引路正在思考，请稍候…");
        try {
          const routePlan = DEMO_STATE.learningRoute?.draft?.plan;
          const routeTask = routePlan?.today?.tasks?.find((task) => task.completion_status === "active") ?? routePlan?.today?.tasks?.find((task) => task.completion_status !== "done");
          const currentMonth = routePlan?.current_year?.months?.find((month) => month.month === routePlan.today?.date?.slice(0, 7)) ?? routePlan?.months?.find((month) => month.month === routePlan.today?.date?.slice(0, 7));
          const activeTask = DEMO_STATE.today.tasks.find((task) => task.status === "active");
          const result = await requestAi("/api/v1/ai/assist", {
            prompt,
            companion_id: DEMO_STATE.guide.selectedAssetId,
            context: {
              goal: DEMO_STATE.goals.find((goal) => goal.selected)?.title || "未选择目标",
              goal_type: DEMO_STATE.learningRoute?.draft?.goal?.type || null,
              teaching_style: DEMO_STATE.guide.options.find((option) => option.assetId === DEMO_STATE.guide.selectedAssetId)?.teachingStyle || null,
              task: routeTask?.title || activeTask?.title || "当前没有进行中的任务",
              task_minutes: routeTask?.planned_minutes || null,
              daily_minutes: Number(DEMO_STATE.user.dailyMinutes) || 25,
              weekly_hours: Number(DEMO_STATE.user.weeklyHours) || null,
              target_date: DEMO_STATE.learningRoute?.draft?.goal?.target_date || null,
              profile: { stage: DEMO_STATE.user.stage, school: DEMO_STATE.user.school, major: DEMO_STATE.user.major, age: DEMO_STATE.user.age, region: DEMO_STATE.user.region, notes: DEMO_STATE.user.notes },
              current_plan: routeTask ? { date: routeTask.date, type: routeTask.type, milestone_title: routeTask.milestone_title, milestone_outcome: routeTask.milestone_outcome, action: routeTask.action, expected_output: routeTask.expected_output, completion_standard: routeTask.completion_standard, review_prompt: routeTask.review_prompt } : null,
              long_term_plan: routePlan ? {
                horizon_years: routePlan.horizon?.years ?? [],
                current_year: routePlan.current_year ? { year: routePlan.current_year.year, objective: routePlan.current_year.objective, milestone_titles: routePlan.current_year.milestone_titles } : null,
                current_month: currentMonth ? { month: currentMonth.month, title: currentMonth.title, focus: currentMonth.focus, start_date: currentMonth.start_date, end_date: currentMonth.end_date } : null,
              } : null,
              evidence_level: DEMO_STATE.pilot.selectedEvidenceLevel,
              memory_context: activeMemoryContext(),
            },
          });
          DEMO_STATE.pilot.assistantResponse = result.answer;
          DEMO_STATE.pilot.assistantError = "";
          DEMO_STATE.service.aiStatus = "available";
          DEMO_STATE.service.aiAvailable = true;
        } catch (error) {
          DEMO_STATE.pilot.assistantError = error.message;
          if (/服务商|AI 服务暂时|AI 还在恢复/.test(String(error.message))) {
            DEMO_STATE.service.aiStatus = "unavailable";
            DEMO_STATE.service.aiAvailable = false;
          }
        } finally {
          await syncCompanion();
          DEMO_STATE.pilot.assistantPending = false;
          render(window.location.pathname);
        }
        return;
      }
      if (form.dataset.demoForm === "auth") {
        const values = new FormData(form);
        const mode = form.dataset.authMode === "register" ? "register" : "login";
        if (mode === "register" && ["degraded", "down"].includes(DEMO_STATE.service?.api)) {
          toast("账号服务暂时不可用，请稍后再创建账号");
          return;
        }
        const endpoint = mode === "register" ? "/api/v1/auth/register" : "/api/v1/auth/login";
        const payload = { email: String(values.get("email") ?? "").trim(), password: String(values.get("password") ?? "") };
        if (mode === "register") {
          payload.display_name = String(values.get("display_name") ?? "").trim();
          if (!payload.display_name) delete payload.display_name;
          const inviteCode = String(values.get("invite_code") ?? "").trim();
          if (inviteCode) payload.invite_code = inviteCode;
        }
        const submit = form.querySelector("button[type=submit]");
        if (submit) submit.disabled = true;
        const authError = form.querySelector("[data-auth-error]");
        if (authError) {
          authError.textContent = "";
          authError.hidden = true;
        }
        try {
          const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) {
            const message = body.code === "invite_required"
              ? "本轮试点需要邀请码，请联系邀请你的人获取"
              : body.code === "invite_invalid"
                ? "邀请码无效或已被使用，请联系邀请你的人"
                : response.status === 401 && mode === "login"
              ? "账号或密码不正确"
              : response.status === 409
                  ? "该邮箱已注册，请直接登录。"
                  : response.status >= 500
                    ? "服务暂时不可用，请稍后重试"
                    : body.message || "账号信息不正确，请检查后再试";
            throw new Error(message);
          }
          resetToRealState(body.user);
          let accountOpened = false;
          const openAccount = () => {
            if (accountOpened) return;
            accountOpened = true;
            navigate(mode === "register" || !DEMO_STATE.onboarding.completed ? "/onboarding" : "/", () => {
              toast(mode === "register" ? "山门已立好，开始认识你的方向" : "欢迎回来，继续你的山路");
            });
          };
          await syncAuthenticatedAccount({ onPrimaryStateReady: openAccount });
          openAccount();
          render(window.location.pathname);
        } catch (error) {
          const currentForm = form.isConnected
            ? form
            : root.querySelector(`form[data-demo-form="auth"][data-auth-mode="${mode}"]`);
          const errorRegion = currentForm?.querySelector("[data-auth-error]");
          if (errorRegion) {
            errorRegion.textContent = error.message;
            errorRegion.hidden = false;
          } else {
            toast(error.message);
          }
        } finally {
          if (submit) submit.disabled = false;
        }
        return;
      }
      } catch (error) {
        if (isPersistenceFailure(error)) {
          DEMO_STATE.service = { ...DEMO_STATE.service, api: "degraded", persistence: "unknown", syncStatus: "degraded", persistenceNotice: error.message };
          render(window.location.pathname);
        }
        toast(error.message || "这次操作没有完成，请稍后重试");
      } finally {
        const currentForm = form.isConnected
          ? form
          : form.dataset.demoForm === "auth"
            ? root.querySelector(`form[data-demo-form="auth"][data-auth-mode="${form.dataset.authMode}"]`)
            : null;
        if (currentForm) {
          currentForm.dataset.submitting = "false";
          currentForm.querySelectorAll("button[type=submit]").forEach((button) => { button.disabled = false; });
        }
      }
    }));
    root.querySelectorAll('[data-action="switch-account"]').forEach((element) => element.addEventListener("click", async () => {
      await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
      resetToDemoState();
      DEMO_STATE.auth.mode = element.dataset.authMode === "register" ? "register" : "login";
      navigate("/auth");
      toast(DEMO_STATE.auth.mode === "register" ? "已退出当前账号，可以注册新账号" : "已退出当前账号，可以登录另一账号");
    }));
    root.querySelectorAll('[data-action="logout"]').forEach((element) => element.addEventListener("click", async () => {
      await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
      resetToDemoState("login");
      navigate("/auth");
      toast("已退出山门");
    }));
  }

  const updateParallax = () => {
    scrollFrame = 0;
    root.style.setProperty("--scroll-shift", motionEnabled ? `${Math.min(window.scrollY, 700) * 0.12}px` : "0px");
    root.style.setProperty("--scroll-ratio", motionEnabled ? `${Math.min(window.scrollY / Math.max(window.innerHeight, 1), 1)}` : "0");
    syncTourSpotlight();
  };

  const updatePointer = (event) => {
    if (!motionEnabled || window.matchMedia?.("(pointer: coarse)").matches) return;
    const x = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2;
    const y = (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2;
    root.style.setProperty("--pointer-x", `${x.toFixed(3)}`);
    root.style.setProperty("--pointer-y", `${y.toFixed(3)}`);
  };

  window.addEventListener("scroll", () => {
    if (scrollFrame) return;
    scrollFrame = window.requestAnimationFrame(updateParallax);
  }, { passive: true });
  window.addEventListener("pointermove", updatePointer, { passive: true });
  window.addEventListener("resize", syncTourSpotlight, { passive: true });

  window.addEventListener("popstate", () => render());
  render();
  void syncRegistrationPolicy().then(() => render());
  void syncSession().then(() => {
    if (!sessionResolved) {
      sessionResolved = true;
      render();
    }
  });
  window.setInterval(() => { void syncReminders(); }, 60000);
  return { navigate, render, state: DEMO_STATE };
}
