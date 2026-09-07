const crypto = require("node:crypto");
const { isValidRequestId } = require("../../platform/http/correlation-id.ts");
const { PlatformError } = require("../../platform/errors/error-catalog.ts");
const { buildLearningRoutePrompt } = require("./learning-route-prompt.ts");
const { buildPlanHierarchy, buildWeeks } = require("./plan-builder.ts");
const { OFFICIAL_SOURCE_REGISTRY } = require("../knowledge-retrieval/knowledge-catalog.ts");

const GOAL_TYPES = Object.freeze([
  "postgraduate_entrance_exam",
  "civil_service_exam",
  "employment",
  "professional_certificate",
  "personal_growth",
]);
const BASELINES = new Set(["starting", "foundation", "advanced"]);
const CAPACITY_BUFFER_PERCENT = 20;
const DAY_MS = 86400000;
const MAX_PLAN_MILESTONES = 6;

const SOURCE_REGISTRY = OFFICIAL_SOURCE_REGISTRY;

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function routeKey(actorId, routeId) { return `learning-route:${actorId}:${routeId}`; }
function routeIndexKey(routeId) { return `learning-route:index:${routeId}`; }
function latestRouteKey(actorId) { return `learning-route:latest:${actorId}`; }
function idempotencyKey(actorId, key) { return `idempotency:${actorId}:learning-routes:${key}`; }
function refreshIdempotencyKey(actorId, key) { return `idempotency:${actorId}:learning-route-refresh:${key}`; }

function normalizeIdempotencyKey(value) {
  if (typeof value !== "string" || value.length < 16 || value.length > 128 || !/^[A-Za-z0-9._~:-]+$/.test(value)) {
    throw new PlatformError("VALIDATION_ERROR", "Idempotency-Key is required and must be a safe 16-128 character value");
  }
  return value;
}

function normalizeText(value, label, { min = 0, max }) {
  if (typeof value !== "string") throw new PlatformError("VALIDATION_ERROR", `${label} must be a string`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) throw new PlatformError("VALIDATION_ERROR", `${label} must contain ${min}-${max} characters`);
  return normalized;
}

function isDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dateValue(value) {
  return Date.parse(`${value}T00:00:00.000Z`);
}

function currentDate(clock) {
  return new Date(clock()).toISOString().slice(0, 10);
}

function sourcePackFor(goalType) {
  const direct = SOURCE_REGISTRY.filter((source) => source.goal_type === goalType);
  return direct.length > 0 ? direct : SOURCE_REGISTRY.filter((source) => source.goal_type === "personal_growth");
}

function memoryScopeFor(goalType) {
  if (goalType === "employment" || goalType === "professional_certificate") return "goal-skill";
  if (goalType === "personal_growth") return "goal-life";
  return "goal-exam";
}

function uniqueTexts(values, label, max) {
  return [...new Map(values.map((value) => [value, value])).values()]
    .slice(0, max)
    .map((value) => normalizeText(value, label, { min: 1, max: label === "milestone outcome" ? 180 : 240 }));
}

function requiredFactsFor(input) {
  const facts = input.goal_type === "postgraduate_entrance_exam"
    ? ["核验目标院校当年招生章程、专业目录、考试科目和报名/初试时间。"]
    : input.goal_type === "civil_service_exam"
      ? ["核验当年公务员考试公告、职位表、报考资格、地区限制和考试时间。"]
      : input.goal_type === "professional_certificate"
        ? ["核验发证或考试机构当年的报名资格、考试时间和证书规则。"]
        : input.goal_type === "employment"
          ? ["核验目标岗位或招聘方当前的任职条件、截止时间和薪资口径。"]
          : ["核验目标学习资源的官方要求、更新时间和当前可用性。"];
  if (input.region) facts.push(`核对${input.region}适用的公告、资格条件或资源规则。`);
  return facts;
}

function validateRouteRequest(input, clock) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlatformError("VALIDATION_ERROR", "learning route request must be an object");
  const allowed = new Set(["request_id", "goal_type", "goal_name", "target_date", "weekly_hours", "daily_minutes", "baseline", "region", "constraints", "focus_areas"]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new PlatformError("VALIDATION_ERROR", `unknown field: ${key}`);
  if (!isValidRequestId(input.request_id)) throw new PlatformError("VALIDATION_ERROR", "request_id must be a UUID");
  if (!GOAL_TYPES.includes(input.goal_type)) throw new PlatformError("VALIDATION_ERROR", "goal_type is not supported");
  const goalName = normalizeText(input.goal_name, "goal_name", { min: 1, max: 120 });
  if (!isDateOnly(input.target_date) || dateValue(input.target_date) <= dateValue(currentDate(clock))) {
    throw new PlatformError("VALIDATION_ERROR", "target_date must be a future YYYY-MM-DD date");
  }
  if (!Number.isInteger(input.weekly_hours) || input.weekly_hours < 1 || input.weekly_hours > 60) {
    throw new PlatformError("VALIDATION_ERROR", "weekly_hours must be an integer from 1 to 60");
  }
  const dailyMinutes = input.daily_minutes === undefined || input.daily_minutes === null || input.daily_minutes === ""
    ? null
    : Number(input.daily_minutes);
  if (dailyMinutes !== null && (!Number.isInteger(dailyMinutes) || dailyMinutes < 5 || dailyMinutes > 1440)) {
    throw new PlatformError("VALIDATION_ERROR", "daily_minutes must be an integer from 5 to 1440");
  }
  if (!BASELINES.has(input.baseline)) throw new PlatformError("VALIDATION_ERROR", "baseline is not supported");
  const region = input.region === undefined || input.region === null || input.region === "" ? "" : normalizeText(input.region, "region", { min: 1, max: 120 });
  if (input.constraints !== undefined && (!Array.isArray(input.constraints) || input.constraints.length > 10)) throw new PlatformError("VALIDATION_ERROR", "constraints must contain at most 10 entries");
  if (input.focus_areas !== undefined && (!Array.isArray(input.focus_areas) || input.focus_areas.length > 8)) throw new PlatformError("VALIDATION_ERROR", "focus_areas must contain at most 8 entries");
  const constraints = [...new Set((input.constraints ?? []).map((value) => normalizeText(value, "constraint", { min: 1, max: 160 })))];
  const focusAreas = [...new Set((input.focus_areas ?? []).map((value) => normalizeText(value, "focus_area", { min: 1, max: 80 })))];
  return {
    request_id: input.request_id,
    goal_type: input.goal_type,
    goal_name: goalName,
    target_date: input.target_date,
    weekly_hours: input.weekly_hours,
    daily_minutes: dailyMinutes,
    baseline: input.baseline,
    region,
    constraints,
    focus_areas: focusAreas,
  };
}

function parseProviderDraft(text, input, today) {
  if (typeof text !== "string" || text.length > 12000) throw new PlatformError("DEPENDENCY_UNAVAILABLE", "AI route draft was missing or too large");
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new PlatformError("DEPENDENCY_UNAVAILABLE", "AI route draft was not valid JSON", { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlatformError("DEPENDENCY_UNAVAILABLE", "AI route draft must be an object");
  const allowed = new Set(["summary", "assumptions", "facts_to_confirm", "milestones"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new PlatformError("DEPENDENCY_UNAVAILABLE", "AI route draft contains unsupported fields");
  const summary = normalizeText(value.summary, "summary", { min: 1, max: 500 });
  if (!Array.isArray(value.assumptions) || value.assumptions.length < 1 || value.assumptions.length > 6) throw new PlatformError("DEPENDENCY_UNAVAILABLE", "AI route draft assumptions are invalid");
  if (!Array.isArray(value.facts_to_confirm) || value.facts_to_confirm.length < 1 || value.facts_to_confirm.length > 8) throw new PlatformError("DEPENDENCY_UNAVAILABLE", "AI route draft facts_to_confirm are invalid");
  if (!Array.isArray(value.milestones) || value.milestones.length < 2 || value.milestones.length > MAX_PLAN_MILESTONES) throw new PlatformError("DEPENDENCY_UNAVAILABLE", "AI route draft milestones are invalid");
  const assumptions = uniqueTexts([
    `按每周${input.weekly_hours}小时安排。`,
    `当前基础按${input.baseline}处理。`,
    ...value.assumptions,
  ], "assumption", 6);
  const factsToConfirm = uniqueTexts([
    ...requiredFactsFor(input),
    ...value.facts_to_confirm,
  ], "fact_to_confirm", 8);
  let previousEnd = dateValue(today) - DAY_MS;
  const milestones = value.milestones.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new PlatformError("DEPENDENCY_UNAVAILABLE", "AI route milestone is invalid");
    const keys = Object.keys(item);
    if (keys.some((key) => !["title", "start_date", "end_date", "planned_hours", "outcomes"].includes(key))) throw new PlatformError("DEPENDENCY_UNAVAILABLE", "AI route milestone contains unsupported fields");
    const title = normalizeText(item.title, "milestone title", { min: 1, max: 100 });
    if (!isDateOnly(item.start_date) || !isDateOnly(item.end_date)) throw new PlatformError("DEPENDENCY_UNAVAILABLE", "AI route milestone dates are invalid");
    const start = dateValue(item.start_date);
    const end = dateValue(item.end_date);
    if (start < dateValue(today) || start <= previousEnd || end < start || end > dateValue(input.target_date)) {
      throw new PlatformError("DEPENDENCY_UNAVAILABLE", "AI route milestone dates are not feasible");
    }
    if (!Number.isInteger(item.planned_hours) || item.planned_hours < 1 || item.planned_hours > 1000) throw new PlatformError("DEPENDENCY_UNAVAILABLE", "AI route milestone planned_hours are invalid");
    if (!Array.isArray(item.outcomes) || item.outcomes.length < 1 || item.outcomes.length > 4) throw new PlatformError("DEPENDENCY_UNAVAILABLE", "AI route milestone outcomes are invalid");
    previousEnd = end;
    return {
      title,
      start_date: item.start_date,
      end_date: item.end_date,
      planned_hours: item.planned_hours,
      outcomes: uniqueTexts(item.outcomes, "milestone outcome", 4),
    };
  });
  return { summary, assumptions, facts_to_confirm: factsToConfirm, milestones };
}

function feasibilityFor(input, milestones, today) {
  const daysRemaining = Math.round((dateValue(input.target_date) - dateValue(today)) / DAY_MS) + 1;
  const totalAvailableHours = Math.floor((daysRemaining / 7) * input.weekly_hours);
  const protectedCapacityHours = Math.floor(totalAvailableHours * ((100 - CAPACITY_BUFFER_PERCENT) / 100));
  const plannedHours = milestones.reduce((total, milestone) => total + milestone.planned_hours, 0);
  const capacityByMilestone = milestones.map((milestone) => {
    const days = Math.round((dateValue(milestone.end_date) - dateValue(milestone.start_date)) / DAY_MS) + 1;
    const availableHours = Math.floor((days / 7) * input.weekly_hours);
    const protectedHours = Math.floor(availableHours * ((100 - CAPACITY_BUFFER_PERCENT) / 100));
    const status = milestone.planned_hours > availableHours
      ? "over_capacity"
      : milestone.planned_hours > protectedHours
        ? "tight"
        : "feasible";
    return {
      title: milestone.title,
      days,
      available_hours: availableHours,
      protected_hours: protectedHours,
      planned_hours: milestone.planned_hours,
      status,
    };
  });
  const issues = capacityByMilestone
    .filter((item) => item.status !== "feasible")
    .map((item) => item.status === "over_capacity"
      ? `${item.title}安排${item.planned_hours}小时，超过该阶段可用的${item.available_hours}小时。`
      : `${item.title}安排${item.planned_hours}小时，超过保留缓冲后的${item.protected_hours}小时。`);
  const status = plannedHours > totalAvailableHours || capacityByMilestone.some((item) => item.status === "over_capacity")
    ? "needs_adjustment"
    : plannedHours > protectedCapacityHours || capacityByMilestone.some((item) => item.status === "tight")
      ? "tight"
      : "feasible";
  const message = status === "feasible"
    ? "计划时长保留了系统缓冲，可进入用户确认。"
    : status === "tight"
      ? "计划接近可用时长，建议缩减范围或调整阶段安排；确认前请重新评估。"
      : "计划超过用户声明的可用时间，不能确认。";
  return {
    status,
    days_remaining: daysRemaining,
    weekly_hours: input.weekly_hours,
    total_available_hours: totalAvailableHours,
    protected_capacity_hours: protectedCapacityHours,
    planned_hours: plannedHours,
    buffer_percent: CAPACITY_BUFFER_PERCENT,
    message,
    capacity_by_milestone: capacityByMilestone,
    issues,
  };
}

function validateRefreshRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlatformError("VALIDATION_ERROR", "plan refresh must be an object");
  const allowed = new Set(["request_id", "expected_version", "completed_task_ids", "skipped_task_ids", "available_minutes"]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new PlatformError("VALIDATION_ERROR", `unknown refresh field: ${key}`);
  if (!isValidRequestId(input.request_id)) throw new PlatformError("VALIDATION_ERROR", "request_id must be a UUID");
  if (!Number.isInteger(input.expected_version) || input.expected_version < 1) throw new PlatformError("VALIDATION_ERROR", "expected_version is invalid");
  const normalizeIds = (value, label) => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 100 || value.some((id) => typeof id !== "string" || !/^plan-day-\d{4}-\d{2}-\d{2}$/.test(id))) {
      throw new PlatformError("VALIDATION_ERROR", `${label} is invalid`);
    }
    return [...new Set(value)];
  };
  if (input.available_minutes !== undefined && (!Number.isInteger(input.available_minutes) || input.available_minutes < 0 || input.available_minutes > 1440)) {
    throw new PlatformError("VALIDATION_ERROR", "available_minutes is invalid");
  }
  return {
    request_id: input.request_id,
    expected_version: input.expected_version,
    completed_task_ids: normalizeIds(input.completed_task_ids, "completed_task_ids"),
    skipped_task_ids: normalizeIds(input.skipped_task_ids, "skipped_task_ids"),
    available_minutes: input.available_minutes ?? null,
  };
}

function roundHours(minutes) {
  return Math.round(minutes / 60 * 10) / 10;
}

function replanAfterRefresh(plan, request, clock) {
  const dailyMinutes = request.available_minutes === null ? plan.daily_minutes : Math.max(5, request.available_minutes);
  const completed = new Set(request.completed_task_ids);
  const skipped = new Set(request.skipped_task_ids);
  const today = plan.today?.date;
  const updateDays = (days) => days.map((day) => {
    const nextStatus = completed.has(day.id)
      ? "done"
      : skipped.has(day.id)
        ? "planned"
        : day.completion_status;
    if (day.date < today || nextStatus === "done") return { ...day, completion_status: nextStatus };
    const targetMinutes = day.type === "复盘" ? Math.max(5, Math.round(dailyMinutes * 0.5)) : dailyMinutes;
    return { ...day, completion_status: nextStatus, planned_minutes: targetMinutes };
  });
  const months = plan.months.map((month) => {
    const days = updateDays(month.days);
    return {
      ...month,
      planned_hours: roundHours(days.reduce((total, day) => total + day.planned_minutes, 0)),
      weeks: buildWeeks(days),
      days,
    };
  });
  const years = (plan.horizon?.years ?? []).map((year) => {
    const yearMonths = months.filter((month) => month.month.startsWith(String(year.year)));
    return { ...year, planned_hours: Math.round(yearMonths.reduce((total, month) => total + month.planned_hours, 0) * 10) / 10 };
  });
  const currentYear = plan.current_year
    ? {
      ...plan.current_year,
      planned_hours: Math.round(months.filter((month) => month.month.startsWith(String(plan.current_year.year))).reduce((total, month) => total + month.planned_hours, 0) * 10) / 10,
      months: months.filter((month) => month.month.startsWith(String(plan.current_year.year))),
    }
    : null;
  const updatedAt = new Date(clock()).toISOString();
  const changedCount = completed.size + skipped.size;
  const updateReason = request.available_minutes === null
    ? `${changedCount} 项今日记录已结算，后续任务已重新排布。`
    : `根据今日可用的 ${request.available_minutes} 分钟，${changedCount} 项记录已结算，后续任务已重新排布。`;
  return {
    ...plan,
    daily_minutes: dailyMinutes,
    last_updated_at: updatedAt,
    update_reason: updateReason,
    horizon: { ...plan.horizon, years },
    current_year: currentYear,
    months,
    today: { ...plan.today, tasks: updateDays(plan.today?.tasks ?? []) },
  };
}

class LearningRouteService {
  constructor({ database, ai, knowledge, memory, userState, clock = () => Date.now() }) {
    this.database = database;
    this.ai = ai;
    this.knowledge = knowledge;
    this.memory = memory;
    this.userState = userState;
    this.clock = clock;
  }

  getSources(goalType) {
    if (goalType !== undefined && !GOAL_TYPES.includes(goalType)) throw new PlatformError("VALIDATION_ERROR", "goal_type is not supported");
    const sources = goalType ? sourcePackFor(goalType) : SOURCE_REGISTRY;
    return { source_registry_version: "2026-09-06.2", sources: sources.map((source) => ({ ...source })) };
  }

  async generateDraft(actorId, body, rawIdempotencyKey) {
    const input = validateRouteRequest(body, this.clock);
    const normalizedIdempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    const fingerprint = sha256(stableStringify(input));
    const existing = await this.database.get(`learning-route:request:${actorId}:${input.request_id}`);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new PlatformError("CONFLICT", "request_id was reused with a different route request");
      return existing.response;
    }
    const savedState = this.userState ? (await this.userState.getState(actorId, input.request_id)).state : null;
    const savedProfile = savedState?.profile ?? {};
    const learnerProfile = { ...savedProfile, guide_asset_id: savedState?.guide_asset_id ?? null };
    const savedDailyMinutes = Number(savedProfile.daily_minutes);
    const routeInput = {
      ...input,
      daily_minutes: input.daily_minutes ?? (Number.isInteger(savedDailyMinutes) ? savedDailyMinutes : null),
    };
    const sourcePack = sourcePackFor(input.goal_type);
    const today = currentDate(this.clock);
    const retrieval = this.knowledge
      ? await this.knowledge.search({
        goal_type: input.goal_type,
        query: [routeInput.goal_name, ...routeInput.focus_areas, ...routeInput.constraints, savedProfile.major, savedProfile.stage].filter(Boolean).join(" "),
        region: input.region,
        limit: 6,
      })
      : { knowledge_index_version: "unavailable", retrieved_at: new Date(this.clock()).toISOString(), results: [] };
    const personalMemoryScope = memoryScopeFor(input.goal_type);
    const personalKnowledge = this.memory
      ? { ...(await this.memory.getMemories(actorId, input.request_id, personalMemoryScope)), scope: personalMemoryScope }
      : { scope: personalMemoryScope, memories: [] };
    const aiResponse = await this.ai.submit(actorId, {
      request_id: input.request_id,
      feature: "learning_route_generation",
      input: buildLearningRoutePrompt(routeInput, sourcePack, today, retrieval, this.knowledge?.formatContext(retrieval), personalKnowledge, learnerProfile),
    }, normalizedIdempotencyKey);
    if (aiResponse.status !== "completed") {
      const response = { request_id: input.request_id, status: "degraded", reason_code: "ai_unavailable" };
      await this.database.set(`learning-route:request:${actorId}:${input.request_id}`, { fingerprint, response });
      return response;
    }
    const draft = parseProviderDraft(aiResponse.result.text, input, today);
    const feasibility = feasibilityFor(routeInput, draft.milestones, today);
    const plan = buildPlanHierarchy({ input: routeInput, milestones: draft.milestones, today, summary: draft.summary, profile: savedProfile, clock: this.clock });
    const route = {
      id: `route-${crypto.randomUUID()}`,
      version: 1,
      status: "draft",
      goal: {
        type: input.goal_type,
        name: input.goal_name,
        target_date: routeInput.target_date,
        weekly_hours: routeInput.weekly_hours,
        baseline: routeInput.baseline,
        region: routeInput.region || savedProfile.region || null,
        constraints: routeInput.constraints,
        focus_areas: routeInput.focus_areas,
        daily_minutes: plan.daily_minutes,
      },
      summary: draft.summary,
      assumptions: draft.assumptions,
      facts_to_confirm: draft.facts_to_confirm,
      milestones: draft.milestones,
      plan,
      feasibility,
      sources: sourcePack.map((source) => ({ ...source })),
      source_registry_version: "2026-09-06.2",
      knowledge_evidence: retrieval.results,
      knowledge_index_version: retrieval.knowledge_index_version,
      knowledge_retrieved_at: retrieval.retrieved_at,
      personal_memory_scope: personalMemoryScope,
      personal_memory_refs: personalKnowledge.memories.map((memory) => memory.id),
      created_at: new Date(this.clock()).toISOString(),
      confirmed_at: null,
    };
    const response = { request_id: input.request_id, status: "draft", route };
    await this.database.transaction(async (database) => {
      const replay = await database.get(idempotencyKey(actorId, normalizedIdempotencyKey));
      if (replay) {
        if (replay.fingerprint !== fingerprint) throw new PlatformError("CONFLICT", "idempotency key was reused with a different route request");
        return;
      }
      await database.set(routeKey(actorId, route.id), route);
      await database.set(routeIndexKey(route.id), actorId);
      await database.set(latestRouteKey(actorId), route.id);
      await database.set(`learning-route:request:${actorId}:${input.request_id}`, { fingerprint, response });
      await database.set(idempotencyKey(actorId, normalizedIdempotencyKey), { fingerprint, response });
    });
    return response;
  }

  async confirmDraft(actorId, routeId, body, rawIdempotencyKey) {
    if (typeof routeId !== "string" || !/^route-[0-9a-f-]{36}$/i.test(routeId)) throw new PlatformError("VALIDATION_ERROR", "route_id is invalid");
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new PlatformError("VALIDATION_ERROR", "route confirmation must be an object");
    if (Object.keys(body).some((key) => !["request_id", "expected_version"].includes(key))) throw new PlatformError("VALIDATION_ERROR", "route confirmation contains unknown fields");
    if (!isValidRequestId(body.request_id)) throw new PlatformError("VALIDATION_ERROR", "request_id must be a UUID");
    if (!Number.isInteger(body.expected_version) || body.expected_version < 1) throw new PlatformError("VALIDATION_ERROR", "expected_version is invalid");
    const normalizedIdempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    const fingerprint = sha256(stableStringify({ route_id: routeId, request_id: body.request_id, expected_version: body.expected_version }));
    return this.database.transaction(async (database) => {
      const replay = await database.get(idempotencyKey(actorId, normalizedIdempotencyKey));
      if (replay) {
        if (replay.fingerprint !== fingerprint) throw new PlatformError("CONFLICT", "idempotency key was reused with a different route confirmation");
        return replay.response;
      }
      const indexedActor = await database.get(routeIndexKey(routeId));
      if (indexedActor && indexedActor !== actorId) throw new PlatformError("FORBIDDEN", "learning route belongs to another actor");
      const route = await database.get(routeKey(actorId, routeId));
      if (!route) throw new PlatformError("NOT_FOUND", "learning route was not found");
      if (route.version !== body.expected_version) throw new PlatformError("CONFLICT", "learning route version has changed");
      if (route.feasibility.status !== "feasible") throw new PlatformError("VALIDATION_ERROR", "only feasible learning routes can be confirmed");
      const confirmed = {
        ...route,
        version: route.version + 1,
        status: "confirmed",
        confirmed_at: new Date(this.clock()).toISOString(),
      };
      const response = { request_id: body.request_id, route: confirmed, replayed: false };
      await database.set(routeKey(actorId, routeId), confirmed);
      await database.set(latestRouteKey(actorId), routeId);
      await database.set(idempotencyKey(actorId, normalizedIdempotencyKey), { fingerprint, response });
      return response;
    });
  }

  async refreshPlan(actorId, routeId, body, rawIdempotencyKey) {
    if (typeof routeId !== "string" || !/^route-[0-9a-f-]{36}$/i.test(routeId)) throw new PlatformError("VALIDATION_ERROR", "route_id is invalid");
    const request = validateRefreshRequest(body);
    const normalizedIdempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    const fingerprint = sha256(stableStringify({ route_id: routeId, ...request }));
    return this.database.transaction(async (database) => {
      const replay = await database.get(refreshIdempotencyKey(actorId, normalizedIdempotencyKey));
      if (replay) {
        if (replay.fingerprint !== fingerprint) throw new PlatformError("CONFLICT", "idempotency key was reused with a different plan refresh");
        return replay.response;
      }
      const indexedActor = await database.get(routeIndexKey(routeId));
      if (indexedActor && indexedActor !== actorId) throw new PlatformError("FORBIDDEN", "learning route belongs to another actor");
      const route = await database.get(routeKey(actorId, routeId));
      if (!route) throw new PlatformError("NOT_FOUND", "learning route was not found");
      if (route.version !== request.expected_version) throw new PlatformError("CONFLICT", "learning route version has changed");
      if (!route.plan) throw new PlatformError("CONFLICT", "learning route has no executable plan");
      const updatedPlan = replanAfterRefresh(route.plan, request, this.clock);
      const updated = {
        ...route,
        version: route.version + 1,
        plan: updatedPlan,
        updated_at: new Date(this.clock()).toISOString(),
      };
      const response = { request_id: request.request_id, route: updated, replayed: false };
      await database.set(routeKey(actorId, routeId), updated);
      await database.set(latestRouteKey(actorId), routeId);
      await database.set(refreshIdempotencyKey(actorId, normalizedIdempotencyKey), { fingerprint, response });
      return response;
    });
  }

  async getLatest(actorId) {
    const routeId = await this.database.get(latestRouteKey(actorId));
    return { route: routeId ? await this.database.get(routeKey(actorId, routeId)) ?? null : null };
  }
}

module.exports = {
  BASELINES,
  CAPACITY_BUFFER_PERCENT,
  GOAL_TYPES,
  LearningRouteService,
  SOURCE_REGISTRY,
  memoryScopeFor,
};
