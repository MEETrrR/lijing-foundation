import { DEMO_STATE } from "./data/demo-data.js";
import { normalizeRoute } from "./data/routes.js";
import { renderPage } from "./pages/index.js";
import { renderShell } from "./components/shell.js";

function newRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const AI_POLL_ATTEMPTS = 90;

async function requestAi(path, payload) {
  const feature = path.endsWith("/review") ? "wrong_answer_hint" : "concept_explanation";
  const input = path.endsWith("/review")
    ? JSON.stringify({ task: payload.task, answer: payload.answer, evidence_level: payload.evidence_level, evidence: payload.evidence })
    : JSON.stringify({ companion_id: payload.companion_id, prompt: payload.prompt, context: payload.context });
  const requestId = newRequestId();
  const response = await fetch("/api/v1/ai/requests", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "Idempotency-Key": requestId },
    body: JSON.stringify({ request_id: requestId, feature, input }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error("请先登录后再使用 AI");
    if (body.reason_code === "daily_quota_exhausted") throw new Error("今天的 AI 使用次数已用完，请明天再试");
    if (body.reason_code === "burst_limit_exhausted") throw new Error("AI 请求过于频繁，请稍等一分钟再试");
    if (body.reason_code === "concurrency_limit_exhausted") throw new Error("上一条 AI 请求还在处理中，请稍等再试");
    throw new Error(body.message || body.error || `AI 服务暂时不可用（${response.status}）`);
  }
  if (body.status === "rejected") throw new Error(body.reason_code === "input_too_long" ? "这段内容太长，请缩短后再试" : "这条 AI 请求未通过服务策略");
  let resultBody = body;
  if (body.status === "accepted" || body.status === "processing") {
    for (let attempt = 0; attempt < AI_POLL_ATTEMPTS; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 120 : 450));
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
    const candidate = resultBody.result.text.match(/\{[\s\S]*\}/)?.[0];
    try {
      const parsed = JSON.parse(candidate || "{}");
      if (["evidence_used", "problem", "reason", "next_action"].every((key) => typeof parsed[key] === "string" && parsed[key].trim())) {
        return { review: { evidenceUsed: parsed.evidence_used, problem: parsed.problem, reason: parsed.reason, nextAction: parsed.next_action } };
      }
    } catch {
      // Keep the explicit fallback below when the provider returns plain text.
    }
    return { review: { evidenceUsed: payload.evidence, problem: "模型返回了非结构化复盘，需要人工确认重点。", reason: "本次结果未能解析为标准复盘字段，因此不自动推断掌握状态。", nextAction: resultBody.result.text } };
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
  if (!response.ok) throw new Error(response.status === 401 ? "请先登录后保存长期记忆" : body.message || "记忆暂时没有写入");
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
  if (!response.ok) throw new Error(body.message || "记忆状态暂时没有更新");
  return body;
}

async function requestCompanionProfile() {
  const response = await fetch("/api/v1/me/companion", { credentials: "same-origin", cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "陪伴档案暂时无法同步");
  return body;
}

async function requestLearningAttempt(payload) {
  const response = await fetch("/api/v1/learning/attempts", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "Idempotency-Key": newRequestId() },
    body: JSON.stringify({ request_id: newRequestId(), ...payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status === 401 ? "请先登录后记录学习结果" : body.message || "学习结果暂时没有写入");
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
  if (!response.ok) throw new Error(response.status === 401 ? "请先登录后保存个人状态" : body.message || "个人状态暂时没有写入");
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
  if (!response.ok) throw new Error(response.status === 401 ? "请先登录后提交反馈" : body.message || "反馈暂时没有提交成功");
  return body;
}

async function requestLearningRoute(payload) {
  const response = await fetch("/api/v1/learning-routes", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "Idempotency-Key": newRequestId() },
    body: JSON.stringify({ request_id: newRequestId(), ...payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error("请先登录真实账号，再生成学习路线");
    if (body.reason_code === "daily_quota_exhausted") throw new Error("今天的 AI 路线生成次数已用完，请明天再试");
    if (body.reason_code === "burst_limit_exhausted") throw new Error("请求过于频繁，请稍等一分钟再试");
    throw new Error(body.message || "学习路线暂时没有生成成功");
  }
  if (body.status === "degraded") throw new Error("AI 服务暂时无法生成可校验草案，请稍后再试");
  if (body.status !== "draft" || !body.route) throw new Error("学习路线返回格式不完整，请稍后再试");
  return body.route;
}

async function confirmLearningRoute(routeId, expectedVersion) {
  const response = await fetch(`/api/v1/learning-routes/${encodeURIComponent(routeId)}/confirm`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "Idempotency-Key": newRequestId() },
    body: JSON.stringify({ request_id: newRequestId(), expected_version: expectedVersion }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "路线暂时不能确认，请重新生成后再试");
  return body.route;
}

async function refreshLearningPlan(routeId, expectedVersion, completedTaskIds = [], skippedTaskIds = [], availableMinutes) {
  const response = await fetch(`/api/v1/learning-routes/${encodeURIComponent(routeId)}/refresh`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "Idempotency-Key": newRequestId() },
    body: JSON.stringify({ request_id: newRequestId(), expected_version: expectedVersion, completed_task_ids: completedTaskIds, skipped_task_ids: skippedTaskIds, ...(availableMinutes === undefined ? {} : { available_minutes: availableMinutes }) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "今日记录已保存，但计划暂时没有更新");
  return body.route;
}

function localReview(evidence, evidenceLevel, answer) {
  return {
    evidenceUsed: evidence,
    problem: answer.includes("B")
      ? "你已经抓住结论，但还需要把边界条件和反例连起来。"
      : "这次短测答案还没有形成可回看的判断依据。",
    reason: `本轮留下了 L${evidenceLevel} 证据，先把能被复查的步骤留下来，再判断是否掌握。`,
    nextAction: "明天用 15 分钟写出一个反例，再用三句话解释它为什么成立。",
  };
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

function userStatePayload() {
  const selectedGoal = DEMO_STATE.goals.find((goal) => goal.selected) ?? DEMO_STATE.goals[0];
  const profile = DEMO_STATE.onboarding?.profile ?? {};
  const pilot = DEMO_STATE.pilot ?? {};
  return {
    version: 1,
    profile: {
      name: DEMO_STATE.user.name,
      stage: DEMO_STATE.user.stage,
      school: DEMO_STATE.user.school,
      major: DEMO_STATE.user.major,
      age: String(DEMO_STATE.user.age ?? profile.age ?? ""),
      region: DEMO_STATE.user.region ?? profile.region ?? "",
      notes: DEMO_STATE.user.notes ?? profile.notes ?? "",
      daily_minutes: String(DEMO_STATE.user.dailyMinutes ?? profile.dailyMinutes ?? "25"),
      weekly_hours: String(DEMO_STATE.user.weeklyHours ?? profile.weeklyHours ?? ""),
      reminder_enabled: DEMO_STATE.user.reminderEnabled !== false,
      reminder_time: DEMO_STATE.user.reminderTime ?? "20:00",
      timezone: DEMO_STATE.user.timezone ?? "Asia/Shanghai",
    },
    goal_id: selectedGoal?.id ?? profile.target ?? "goal-exam",
    guide_asset_id: DEMO_STATE.guide.selectedAssetId,
    onboarding_completed: Boolean(DEMO_STATE.onboarding?.completed),
    today: {
      completed: DEMO_STATE.today.completed,
      total: DEMO_STATE.today.total,
      streak: DEMO_STATE.today.streak,
      minutes: DEMO_STATE.today.minutes,
      tasks: DEMO_STATE.today.tasks.map((task) => ({ id: task.id, type: task.type, title: task.title, meta: task.meta, status: task.status, gua: task.gua })),
    },
    pilot: {
      selected_evidence_level: pilot.selectedEvidenceLevel,
      submitted_evidence: pilot.submittedEvidence,
      selected_answer: pilot.selectedAnswer,
      review: pilot.review ? {
        evidence_used: pilot.review.evidenceUsed,
        problem: pilot.review.problem,
        reason: pilot.review.reason,
        next_action: pilot.review.nextAction,
      } : null,
      review_ready: Boolean(pilot.reviewReady),
    },
    knowledge: DEMO_STATE.knowledge.map((item) => ({
      id: item.id,
      title: item.title,
      domain: item.domain,
      strand: item.strand,
      mastery: item.mastery,
      state: item.state,
      gua: item.gua,
      color: item.color,
      source: item.source,
      updated: item.updated,
      summary: item.summary,
      note: item.note,
      related_ids: item.relatedIds ?? [],
      position: item.position ?? "",
      ...(item.evidenceLevel === undefined ? {} : { evidence_level: item.evidenceLevel }),
    })),
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
      selectedAnswer: state.pilot.selected_answer ?? DEMO_STATE.pilot.selectedAnswer,
      review: state.pilot.review ? {
        evidenceUsed: state.pilot.review.evidence_used,
        problem: state.pilot.review.problem,
        reason: state.pilot.review.reason,
        nextAction: state.pilot.review.next_action,
      } : DEMO_STATE.pilot.review,
      reviewReady: state.pilot.review_ready ?? DEMO_STATE.pilot.reviewReady,
    };
  }
  if (Array.isArray(state.knowledge)) {
    DEMO_STATE.knowledge = state.knowledge.map((item) => ({
      ...item,
      relatedIds: Array.isArray(item.related_ids) ? item.related_ids : [],
      ...(item.evidence_level === undefined ? {} : { evidenceLevel: item.evidence_level }),
    }));
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
    state.preferences = { notifications: "important", motion: true };
    state.service = { api: "unknown", aiConfigured: null };
    state.pilot = {
      ...state.pilot,
      selectedEvidenceLevel: 1,
      submittedEvidence: "",
      selectedAnswer: "",
      assistantResponse: "",
      assistantError: "",
      assistantPending: false,
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
    state.learningRoute = { draft: null, error: "" };
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
  let revealObserver;
  DEMO_STATE.auth ??= { user: null, mode: "login" };
  DEMO_STATE.memory ??= { iterationCount: 0, syncStatus: "idle", lastIterationId: "", memories: [] };
  DEMO_STATE.companion ??= { interactionCount: 0, promptVersion: "", firstSeenAt: null, lastSeenAt: null, companionId: DEMO_STATE.guide.selectedAssetId };
  DEMO_STATE.preferences ??= { notifications: window.localStorage?.getItem("lijing-notifications") ?? "important", motion: motionEnabled };
  DEMO_STATE.service ??= { api: "unknown", aiConfigured: null };
  DEMO_STATE.learningRoute ??= { draft: null, error: "" };

  const applyMemoryResponse = (body) => {
    DEMO_STATE.memory.iterationCount = Number(body.iteration_count ?? DEMO_STATE.memory.iterationCount ?? 0);
    DEMO_STATE.memory.memories = Array.isArray(body.memories) ? body.memories : (Array.isArray(body.candidates) ? body.candidates : []);
    DEMO_STATE.memory.lastIterationId = body.iteration_id ?? DEMO_STATE.memory.lastIterationId;
    DEMO_STATE.memory.syncStatus = "synced";
  };

  const replaceState = (nextState) => {
    for (const key of Object.keys(DEMO_STATE)) delete DEMO_STATE[key];
    Object.assign(DEMO_STATE, structuredClone(nextState));
    selectedGoal = DEMO_STATE.goals.find((goal) => goal.selected)?.id ?? DEMO_STATE.goals[0]?.id ?? "";
  };

  const resetToDemoState = () => replaceState({ ...initialDemoState, isDemo: true, auth: { user: null, mode: "login" }, memory: { iterationCount: 0, syncStatus: "idle", lastIterationId: "", memories: [] } });
  const resetToRealState = (user) => replaceState(createRealState(user));

  const persistUserState = async () => {
    if (DEMO_STATE.isDemo || !DEMO_STATE.auth?.user) return;
    const result = await requestUserState(userStatePayload());
    applyUserState(result.state);
    selectedGoal = result.state?.goal_id ?? selectedGoal;
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

  const syncUserState = async () => {
    if (DEMO_STATE.isDemo || !DEMO_STATE.auth?.user) return;
    try {
      const response = await fetch("/api/v1/me/state", { credentials: "same-origin" });
      if (!response.ok) return;
      const body = await response.json();
      applyUserState(body.state);
      selectedGoal = body.state?.goal_id ?? selectedGoal;
    } catch {
      // The current account remains usable with its server session if state recovery is unavailable.
    }
  };

  const syncServiceHealth = async () => {
    try {
      const response = await fetch("/api/v1/health", { credentials: "same-origin" });
      if (!response.ok) throw new Error("health request failed");
      const body = await response.json();
      DEMO_STATE.service = { api: body.status === "ok" ? "up" : "degraded", aiConfigured: body.ai_configured === true };
    } catch {
      DEMO_STATE.service = { api: "down", aiConfigured: null };
    }
  };

  const syncLearningRoute = async () => {
    if (DEMO_STATE.isDemo || !DEMO_STATE.auth?.user) return;
    try {
      const response = await fetch("/api/v1/learning-routes", { credentials: "same-origin" });
      if (!response.ok) return;
      const body = await response.json();
      DEMO_STATE.learningRoute = { draft: body.route ?? null, error: "" };
    } catch {
      DEMO_STATE.learningRoute.error = "路线暂时无法同步";
    }
  };

  const syncReminders = async () => {
    if (DEMO_STATE.isDemo || !DEMO_STATE.auth?.user) return;
    try {
      const response = await fetch("/api/v1/me/reminders", { credentials: "same-origin" });
      if (!response.ok) return;
      const body = await response.json();
      if (!body.due || DEMO_STATE.preferences?.notifications === "off") return;
      const storageKey = `lijing-reminder:${body.reminder_key}`;
      if (window.localStorage?.getItem(storageKey)) return;
      window.localStorage?.setItem(storageKey, "shown");
      const message = body.tasks?.[0]?.title ? `今天还有：${body.tasks[0].title}` : "今天还有一段学习计划等待完成";
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("砺境 · 今日行旅", { body: message });
      }
      toast(message);
    } catch {
      // Reminders are helpful but must not interrupt the learning surface when unavailable.
    }
  };

  const syncSession = async () => {
    try {
      const response = await fetch("/api/v1/auth/me", { credentials: "same-origin" });
      if (!response.ok) return;
      const body = await response.json();
      if (body.user) {
        resetToRealState(body.user);
        await Promise.all([syncUserState(), syncMemories(), syncCompanion(), syncServiceHealth(), syncLearningRoute(), syncReminders()]);
      }
    } catch {
      // Keep the sign-in surface usable when the API is unavailable.
    }
  };

  const render = (requestedRoute = normalizeRoute(window.location.pathname)) => {
    const authenticated = Boolean(DEMO_STATE.auth?.user) && DEMO_STATE.isDemo === false;
    const route = authenticated && requestedRoute === "/auth"
      ? "/"
      : !authenticated && requestedRoute !== "/auth"
        ? "/auth"
        : requestedRoute;
    document.title = `砺境 · ${route === "/" ? "向山顶而行" : "云海登山"}`;
    root.innerHTML = renderShell(route, DEMO_STATE, renderPage(route, DEMO_STATE));
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
    if (revealObserver) revealObserver.disconnect();
    if (motionEnabled && "IntersectionObserver" in window) {
      revealObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in-view");
          revealObserver?.unobserve(entry.target);
        }
      }), { threshold: 0.12, rootMargin: "0px 0px -7%" });
      root.querySelectorAll(".reveal-item").forEach((element) => revealObserver.observe(element));
    } else {
      root.querySelectorAll(".reveal-item").forEach((element) => element.classList.add("is-in-view"));
    }
    bindEvents();
    window.requestAnimationFrame(syncTourSpotlight);
    requestAnimationFrame(() => root.querySelector("#main-content")?.focus({ preventScroll: true }));
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

  const openFeatureNav = () => {
    const overlay = root.querySelector("#feature-nav-overlay");
    const trigger = root.querySelector('[data-action="toggle-feature-nav"]');
    if (!overlay) return;
    overlay.removeAttribute("hidden");
    overlay.setAttribute("aria-hidden", "false");
    trigger?.setAttribute("aria-expanded", "true");
    window.requestAnimationFrame(() => overlay.classList.add("is-open"));
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

  const closeFeatureNav = () => {
    const overlay = root.querySelector("#feature-nav-overlay");
    const trigger = root.querySelector('[data-action="toggle-feature-nav"]');
    if (!overlay) return;
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    trigger?.setAttribute("aria-expanded", "false");
    window.setTimeout(() => {
      if (!overlay.classList.contains("is-open")) overlay.setAttribute("hidden", "");
    }, 460);
  };

  const playAscensionIntro = (nextRoute = "/features") => {
    const intro = root.querySelector("#ascension-intro");
    if (!intro || !motionEnabled) {
      navigate(nextRoute, nextRoute === "/features" ? openFeatureNav : undefined);
      return;
    }
    const video = intro.querySelector(".ascension-intro__video");
    const finish = () => {
      if (intro.dataset.finished === "true") return;
      intro.dataset.finished = "true";
      window.clearTimeout(ascensionTimer);
      intro.classList.add("is-complete");
      window.setTimeout(() => navigate(nextRoute, nextRoute === "/features" ? openFeatureNav : undefined), 520);
    };
    window.clearTimeout(ascensionTimer);
    intro.dataset.finished = "false";
    intro.removeAttribute("hidden");
    intro.setAttribute("aria-hidden", "false");
    void intro.offsetWidth;
    intro.classList.add("is-playing");
    if (video) {
      video.addEventListener("ended", finish, { once: true });
      video.addEventListener("error", finish, { once: true });
      try { video.currentTime = 0; } catch { /* The browser may not have loaded metadata yet. */ }
      video.play().catch(() => {});
    }
    ascensionTimer = window.setTimeout(finish, 5600);
  };

  function bindEvents() {
    root.querySelectorAll("[data-route]").forEach((element) => element.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (element.closest("#feature-nav-overlay")) closeFeatureNav();
      navigate(element.dataset.route);
    }));
    root.querySelectorAll('[data-action="toggle-feature-nav"]').forEach((element) => element.addEventListener("click", () => {
      const overlay = root.querySelector("#feature-nav-overlay");
      if (!overlay) return;
      const open = !overlay.classList.contains("is-open");
      if (!open) {
        closeFeatureNav();
        return;
      }
      openFeatureNav();
    }));
    root.querySelectorAll('[data-action="close-feature-nav"]').forEach((element) => element.addEventListener("click", closeFeatureNav));
    root.querySelectorAll('[data-action="toggle-menu"]').forEach((element) => element.addEventListener("click", () => {
      const panel = root.querySelector("#mobile-nav-panel");
      const open = panel?.hasAttribute("hidden");
      if (!panel) return;
      if (open) panel.removeAttribute("hidden"); else panel.setAttribute("hidden", "");
      root.querySelectorAll('[data-action="toggle-menu"]').forEach((button) => button.setAttribute("aria-expanded", String(open)));
    }));
    root.querySelectorAll('[data-action="toggle-dial"]').forEach((element) => element.addEventListener("click", () => {
      const rail = root.querySelector(".nav-rail");
      const open = !rail?.classList.contains("is-dial-open");
      if (!rail) return;
      rail.classList.toggle("is-dial-open", open);
      element.setAttribute("aria-expanded", String(open));
      element.setAttribute("title", open ? "收起八方导航" : "展开八方导航");
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
    root.querySelectorAll("[data-goal]").forEach((element) => element.addEventListener("click", () => {
      selectedGoal = element.dataset.goal;
      DEMO_STATE.goals.forEach((goal) => { goal.selected = goal.id === selectedGoal; });
      if (DEMO_STATE.onboarding?.profile) DEMO_STATE.onboarding.profile.target = selectedGoal;
      const onboardingGoal = root.querySelector("[data-onboarding-goal]");
      if (onboardingGoal) onboardingGoal.value = selectedGoal;
      root.querySelectorAll("[data-goal]").forEach((goal) => {
        const selected = goal.dataset.goal === selectedGoal;
        goal.classList.toggle("is-selected", selected);
        goal.setAttribute("aria-pressed", String(selected));
      });
      if (DEMO_STATE.isDemo) toast("方向已记录在你的山门印中");
      else void persistUserState().then(() => toast("方向已保存到你的山门印中")).catch((error) => toast(error.message));
    }));
    root.querySelectorAll('[data-action="bagua-node"]').forEach((element) => element.addEventListener("click", () => {
      const active = element.dataset.bagua;
      root.querySelectorAll('[data-action="bagua-node"]').forEach((node) => {
        const selected = node.dataset.bagua === active;
        node.classList.toggle("is-active", selected);
        node.setAttribute("aria-pressed", String(selected));
      });
      toast(`${active}位已点亮，今日行旅将沿此方向展开`);
    }));
    root.querySelectorAll('[data-action="complete-onboarding"]').forEach((element) => element.addEventListener("click", (event) => {
      event.preventDefault();
      playAscensionIntro(element.getAttribute("href") || "/features");
    }));
    root.querySelectorAll('[data-action="onboarding-next"]').forEach((element) => element.addEventListener("click", async () => {
      element.disabled = true;
      try {
        await persistUserState();
        DEMO_STATE.onboarding.step = 3;
        DEMO_STATE.onboarding.featureIndex = 0;
        render("/onboarding");
        toast(`${DEMO_STATE.guide.options.find((option) => option.assetId === DEMO_STATE.guide.selectedAssetId)?.name ?? "书鼎"} 已认领`);
      } catch (error) {
        toast(error.message);
        element.disabled = false;
      }
    }));
    root.querySelectorAll('[data-action="onboarding-back"]').forEach((element) => element.addEventListener("click", () => {
      if (DEMO_STATE.onboarding.step <= 1) {
        navigate("/auth");
        return;
      }
      DEMO_STATE.onboarding.step -= 1;
      render("/onboarding");
    }));
    root.querySelectorAll('[data-action="onboarding-select-guide"]').forEach((element) => element.addEventListener("click", () => {
      DEMO_STATE.guide.selectedAssetId = element.dataset.guide;
      render("/onboarding");
      if (!DEMO_STATE.isDemo) void persistUserState().catch((error) => toast(error.message));
    }));
    root.querySelectorAll('[data-action="onboarding-feature-select"]').forEach((element) => element.addEventListener("click", () => {
      DEMO_STATE.onboarding.featureIndex = Number(element.dataset.featureIndex) || 0;
      render("/onboarding");
    }));
    root.querySelectorAll('[data-action="onboarding-feature-open"]').forEach((element) => element.addEventListener("click", () => {
      navigate(element.dataset.featureRoute || "/plan");
    }));
    root.querySelectorAll('[data-action="onboarding-feature-next"]').forEach((element) => element.addEventListener("click", async () => {
      const lastFeature = 5;
      if (DEMO_STATE.onboarding.featureIndex < lastFeature) {
        DEMO_STATE.onboarding.featureIndex += 1;
        render("/onboarding");
        return;
      }
      DEMO_STATE.onboarding.completed = true;
      try {
        await persistUserState();
        DEMO_STATE.tour = { active: true, step: 0 };
        navigate("/");
        toast("山门已为你打开，先用半分钟认识首页");
      } catch (error) {
        DEMO_STATE.onboarding.completed = false;
        toast(error.message);
      }
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
    root.querySelectorAll('[data-action="answer"]').forEach((element) => element.addEventListener("click", () => {
      root.querySelectorAll('[data-action="answer"]').forEach((answer) => answer.classList.remove("is-selected"));
      element.classList.add("is-selected");
      DEMO_STATE.pilot.selectedAnswer = element.textContent.trim();
    }));
    root.querySelectorAll('[data-action="submit-answer"]').forEach((element) => element.addEventListener("click", async () => {
      const answer = DEMO_STATE.pilot.selectedAnswer;
      if (!answer) {
        toast("请先选择一个答案");
        return;
      }
      if (DEMO_STATE.isDemo) {
        toast("演示答案已记下，登录后会由服务端确认");
        return;
      }
      element.disabled = true;
      try {
        const result = await requestLearningAttempt({ attempt_id: `attempt-${Date.now()}`, question_id: "limits-continuity-001", answer, action: "submit" });
        toast(result.evaluation?.correct ? "服务端已确认：这次判断正确" : "服务端已记下：这次需要回望");
      } catch (error) {
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
      if (!evidence) {
        toast("请先写一句你实际留下的证据");
        input?.focus();
        return;
      }
      DEMO_STATE.pilot.submittedEvidence = evidence;
      element.disabled = true;
      const activeTask = DEMO_STATE.today.tasks.find((task) => task.status === "active");
      const iterationId = `iteration-${Date.now()}`;
      let iterationReview;
      try {
        const result = await requestAi("/api/v1/ai/review", {
          task: activeTask?.title || "当前学习任务",
          answer: DEMO_STATE.pilot.selectedAnswer,
          evidence_level: DEMO_STATE.pilot.selectedEvidenceLevel,
          evidence,
        });
        iterationReview = result.review;
        DEMO_STATE.pilot.review = iterationReview;
        DEMO_STATE.pilot.reviewReady = true;
        DEMO_STATE.pilot.reviewError = "";
      } catch (error) {
        iterationReview = DEMO_STATE.isDemo
          ? localReview(evidence, DEMO_STATE.pilot.selectedEvidenceLevel, DEMO_STATE.pilot.selectedAnswer)
          : null;
        DEMO_STATE.pilot.review = iterationReview;
        DEMO_STATE.pilot.reviewReady = false;
        DEMO_STATE.pilot.reviewError = error.message;
        toast(DEMO_STATE.isDemo ? "证据已留下，先用本地复盘继续走" : "证据已留下，但服务端 AI 暂时不可用，未生成复盘");
      }
      if (activeTask) {
        activeTask.status = "done";
        const nextTask = DEMO_STATE.today.tasks.find((task) => task.status === "locked");
        if (nextTask) nextTask.status = "active";
        DEMO_STATE.today.completed = Math.min(DEMO_STATE.today.completed + 1, DEMO_STATE.today.total);
        const knowledge = DEMO_STATE.knowledge.find((item) => activeTask.title.includes(item.title));
        if (knowledge) {
          knowledge.evidenceLevel = DEMO_STATE.pilot.selectedEvidenceLevel;
          knowledge.updated = "刚刚";
        }
      }
      if (iterationReview) {
        const payload = {
          iteration_id: iterationId,
          goal_scope: DEMO_STATE.goals.find((goal) => goal.selected)?.id ?? "global",
          goal_title: DEMO_STATE.goals.find((goal) => goal.selected)?.title ?? "当前学习目标",
          task_id: activeTask?.id ?? "current-task",
          evidence_level: DEMO_STATE.pilot.selectedEvidenceLevel,
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
          await persistUserState();
          const route = DEMO_STATE.learningRoute?.draft;
          const planTask = route?.plan?.today?.tasks?.find((task) => task.completion_status === "active") ?? route?.plan?.today?.tasks?.[0];
          if (route?.id && Number.isInteger(route.version) && planTask?.id) {
            DEMO_STATE.learningRoute.draft = await refreshLearningPlan(route.id, route.version, [planTask.id], [], Number(DEMO_STATE.user.dailyMinutes));
          }
        } catch (error) {
          toast(error.message);
        }
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
        source: element.dataset.knowledgeSource ?? "攀登 · 当前山段",
        strand: "当前学习",
      };
      DEMO_STATE.knowledgeComposerOpen = true;
      navigate("/knowledge");
    }));
    root.querySelectorAll('[data-action="ask-guide"]').forEach((element) => element.addEventListener("click", () => {
      const input = root.querySelector(".assistant-composer input");
      if (input) { input.value = element.textContent; input.focus(); }
    }));
    root.querySelectorAll('[data-action="select-guide"]').forEach((element) => element.addEventListener("click", () => {
      DEMO_STATE.guide.selectedAssetId = element.dataset.guide;
      render(window.location.pathname);
      if (DEMO_STATE.isDemo) toast("引路灵器已换为你的选择");
      else void persistUserState().then(() => toast("引路灵器选择已保存")).catch((error) => toast(error.message));
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
        DEMO_STATE.learningRoute.draft = await confirmLearningRoute(routeId, expectedVersion);
        DEMO_STATE.learningRoute.error = "";
        render("/route");
        toast("路线已确认，后续学习计划会以它为依据");
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
    root.querySelectorAll("form[data-demo-form]").forEach((form) => form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (form.dataset.demoForm === "knowledge-capture") {
        const values = new FormData(form);
        const title = String(values.get("title") ?? "").trim();
        if (!title) return;
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
          dailyMinutes: String(values.get("dailyMinutes") ?? "25").trim(),
          weeklyHours: values.has("weeklyHours") ? String(values.get("weeklyHours") ?? "").trim() : DEMO_STATE.user.weeklyHours,
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
          await persistUserState();
          render("/settings");
          toast("个人信息已保存到当前账户");
        } catch (error) {
          toast(error.message);
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
        if (submit) submit.disabled = true;
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
          if (submit) submit.disabled = false;
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
        const submit = form.querySelector("button[type=submit]");
        if (submit) submit.disabled = true;
        try {
          DEMO_STATE.learningRoute.draft = await requestLearningRoute({
            goal_type: String(values.get("goal_type") ?? ""),
            goal_name: String(values.get("goal_name") ?? "").trim(),
            target_date: String(values.get("target_date") ?? ""),
            daily_minutes: Number(values.get("daily_minutes")),
            weekly_hours: Number(values.get("weekly_hours")),
            baseline: String(values.get("baseline") ?? ""),
            region: String(values.get("region") ?? "").trim(),
            focus_areas: splitEntries(values.get("focus_areas"), /[，,]/),
            constraints: splitEntries(values.get("constraints"), /\r?\n/),
          });
          DEMO_STATE.learningRoute.error = "";
          render("/route");
          toast("路线草案已生成，请先核对动态信息再确认");
        } catch (error) {
          DEMO_STATE.learningRoute.error = error.message;
          toast(error.message);
        } finally {
          if (submit) submit.disabled = false;
        }
        return;
      }
      if (form.dataset.demoForm === "onboarding-profile") {
        const values = new FormData(form);
        const name = String(values.get("name") ?? "").trim();
        const stage = String(values.get("stage") ?? "").trim();
        const school = String(values.get("school") ?? "").trim();
        const major = String(values.get("major") ?? "").trim();
        const age = String(values.get("age") ?? "").trim();
        const region = String(values.get("region") ?? "").trim();
        const goalId = String(values.get("goal") ?? "").trim();
        const dailyMinutes = String(values.get("dailyMinutes") ?? "25").trim();
        if (!name || !stage || !goalId) {
          toast("请先留下行者名、当前阶段和一个主方向");
          return;
        }
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
          await persistUserState();
          DEMO_STATE.onboarding.step = 2;
          render("/onboarding");
          toast("你的方向已保存，现在认领一位书鼎");
        } catch (error) {
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
        } catch (error) {
          DEMO_STATE.pilot.assistantError = error.message;
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
        const endpoint = mode === "register" ? "/api/v1/auth/register" : "/api/v1/auth/login";
        const payload = { email: String(values.get("email") ?? "").trim(), password: String(values.get("password") ?? "") };
        if (mode === "register") {
          payload.display_name = String(values.get("display_name") ?? "").trim();
          payload.invite_code = String(values.get("invite_code") ?? "").trim();
        }
        const submit = form.querySelector("button[type=submit]");
        if (submit) submit.disabled = true;
        try {
          const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(response.status === 409 ? "这个邮箱已经注册过了" : response.status === 403 ? "当前试点仅限受邀用户，请输入有效邀请码" : body.message || "账号信息不正确，请检查后再试");
          resetToRealState(body.user);
           await Promise.all([syncUserState(), syncMemories(), syncCompanion(), syncServiceHealth(), syncLearningRoute(), syncReminders()]);
          toast(mode === "register" ? "山门已立好，开始认识你的方向" : "欢迎回来，继续你的山路");
          navigate(mode === "register" || !DEMO_STATE.onboarding.completed ? "/onboarding" : "/");
        } catch (error) {
          toast(error.message);
        } finally {
          if (submit) submit.disabled = false;
        }
        return;
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
      resetToDemoState();
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
  void syncSession().then(() => render());
  window.setInterval(() => { void syncReminders(); }, 60000);
  return { navigate, render, state: DEMO_STATE };
}
