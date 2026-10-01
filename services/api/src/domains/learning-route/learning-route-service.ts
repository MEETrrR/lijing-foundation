const crypto = require("node:crypto");
const { isValidRequestId } = require("../../platform/http/correlation-id.ts");
const { PlatformError } = require("../../platform/errors/error-catalog.ts");
const { buildLearningRoutePrompt, buildLearningWeekPrompt } = require("./learning-route-prompt.ts");
const { buildPlanHierarchy, buildWeeklyTasks, buildWeeks } = require("./plan-builder.ts");
const { effectiveDailyMinutes, flattenTasks, scheduleBudgetForDate, validatePlan, weeklyCapacityMinutes } = require("./plan-validator.ts");
const { OFFICIAL_SOURCE_REGISTRY } = require("../knowledge-retrieval/knowledge-catalog.ts");

const GOAL_TYPES = Object.freeze([
  "postgraduate_entrance_exam",
  "college_english_exam",
  "civil_service_exam",
  "employment",
  "professional_certificate",
  "personal_growth",
]);
const BASELINES = new Set(["starting", "foundation", "advanced"]);
const ASSESSMENT_STAGES = new Set(["not_started", "reviewed_once", "practiced"]);
const ASSESSMENT_RESULTS = new Set(["no_recent_practice", "below_40", "between_40_69", "above_70"]);
const ASSESSMENT_BLOCKERS = new Set(["scope", "concept", "application", "speed", "consistency"]);
const CAPACITY_BUFFER_PERCENT = 20;
const DAY_MS = 86400000;
const MAX_PLAN_MILESTONES = 4;

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

function normalizeText(value, label, { min = 0, max, errorCode = "VALIDATION_ERROR" }) {
  if (typeof value !== "string") throw new PlatformError(errorCode, `${label} must be a string`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) throw new PlatformError(errorCode, `${label} must contain ${min}-${max} characters`);
  return normalized;
}

function normalizeGeneratedText(value, label, options = {}) {
  return normalizeText(value, label, { ...options, errorCode: "AI_OUTPUT_INVALID" });
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

function dateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function addDays(value, amount) {
  return dateOnly(dateValue(value) + amount * DAY_MS);
}

function planDates(startDate, targetDate, maximum = 7) {
  const count = Math.min(maximum, Math.floor((dateValue(targetDate) - dateValue(startDate)) / DAY_MS) + 1);
  return Array.from({ length: Math.max(0, count) }, (_, index) => addDays(startDate, index));
}

function currentDate(clock, timezone = "Asia/Shanghai") {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(clock()))
      .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
    if (parts.year && parts.month && parts.day) return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    // Fall back to UTC if a legacy account contains an invalid timezone.
  }
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
    .map((value) => normalizeGeneratedText(value, label, {
      min: 1,
      max: label === "assumption" ? 45 : label === "fact_to_confirm" ? 60 : label === "milestone outcome" ? 42 : 240,
    }));
}

function requiredFactsFor(input) {
  const facts = input.goal_type === "postgraduate_entrance_exam"
    ? ["核验目标院校当年招生章程、专业目录、考试科目和报名/初试时间。"]
    : input.goal_type === "college_english_exam"
      ? ["核验所在学校考点当次CET报名安排、资格条件、准考证和考试要求；动态信息以教育考试院及学校通知为准。"]
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

function validateBaselineAssessment(value, required) {
  if (value === undefined || value === null) {
    if (required) throw new PlatformError("VALIDATION_ERROR", "baseline_assessment is required for the postgraduate pilot");
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PlatformError("VALIDATION_ERROR", "baseline_assessment must be an object");
  }
  const allowed = new Set(["subject", "study_stage", "recent_result", "primary_blocker", "evidence"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new PlatformError("VALIDATION_ERROR", `unknown baseline_assessment field: ${key}`);
  const subject = normalizeText(value.subject, "baseline_assessment.subject", { min: 1, max: 80 });
  if (!ASSESSMENT_STAGES.has(value.study_stage)) throw new PlatformError("VALIDATION_ERROR", "baseline_assessment.study_stage is invalid");
  if (!ASSESSMENT_RESULTS.has(value.recent_result)) throw new PlatformError("VALIDATION_ERROR", "baseline_assessment.recent_result is invalid");
  if (!ASSESSMENT_BLOCKERS.has(value.primary_blocker)) throw new PlatformError("VALIDATION_ERROR", "baseline_assessment.primary_blocker is invalid");
  return {
    subject,
    study_stage: value.study_stage,
    recent_result: value.recent_result,
    primary_blocker: value.primary_blocker,
    evidence: normalizeText(value.evidence, "baseline_assessment.evidence", { min: 12, max: 360 }),
  };
}

function baselineForAssessment(assessment, fallback) {
  if (!assessment) return fallback;
  if (assessment.study_stage === "not_started") return "starting";
  if (assessment.study_stage === "practiced" && assessment.recent_result === "above_70") return "advanced";
  return "foundation";
}

function validateRouteRequest(input, clock) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlatformError("VALIDATION_ERROR", "learning route request must be an object");
  const allowed = new Set(["request_id", "goal_type", "goal_name", "target_date", "weekly_hours", "daily_minutes", "baseline", "baseline_assessment", "region", "constraints", "focus_areas"]);
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
  const baselineAssessment = validateBaselineAssessment(input.baseline_assessment, false);
  const region = input.region === undefined || input.region === null || input.region === "" ? "" : normalizeText(input.region, "region", { min: 1, max: 120 });
  if (input.constraints !== undefined && (!Array.isArray(input.constraints) || input.constraints.length > 10)) throw new PlatformError("VALIDATION_ERROR", "constraints must contain at most 10 entries");
  if (input.focus_areas !== undefined && (!Array.isArray(input.focus_areas) || input.focus_areas.length > 8)) throw new PlatformError("VALIDATION_ERROR", "focus_areas must contain at most 8 entries");
  const constraints = [...new Set((input.constraints ?? []).map((value) => normalizeText(value, "constraint", { min: 1, max: 160 })))];
  const focusAreas = [...new Set((input.focus_areas ?? []).map((value) => normalizeText(value, "focus_area", { min: 1, max: 80 })))];
  if (baselineAssessment && !focusAreas.length) focusAreas.push(baselineAssessment.subject);
  return {
    request_id: input.request_id,
    goal_type: input.goal_type,
    goal_name: goalName,
    target_date: input.target_date,
    weekly_hours: input.weekly_hours,
    daily_minutes: dailyMinutes,
    baseline: baselineForAssessment(baselineAssessment, input.baseline),
    baseline_assessment: baselineAssessment,
    region,
    constraints,
    focus_areas: focusAreas,
  };
}

function normalizeGoalText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。！？、,.!?：:；;“”"'‘’（）()【】[\]{}]/g, "");
}

function clarificationFor(input) {
  const goalText = normalizeGoalText(input.goal_name);
  const contextText = normalizeGoalText([input.goal_name, ...input.focus_areas, ...input.constraints].join(" "));
  const genericGoal = [
    "我要变强",
    "我想变强",
    "我要学会ai",
    "我想学会ai",
    "我要学ai",
    "我想学ai",
    "我要找到工作",
    "我想找到工作",
    "我想学python",
    "我想学 python",
    "学习python",
    "学习 python",
    "提高计算机基础",
  ].some((value) => goalText === normalizeGoalText(value))
    || /^(?:我要|我想|想要|希望)?(?:学会|学习|掌握)(?:ai|人工智能|python|编程|计算机基础)$/.test(goalText);
  const multiGoal = /(同时|还想|并且|以及|考研.*实习|实习.*考研|参加比赛|比赛.*实习|实习.*比赛)/.test(contextText);
  if (!genericGoal && !multiGoal) return null;
  const missingFields = [];
  const questions = [];
  if (multiGoal) {
    missingFields.push("primary_goal", "goal_priority", "time_split");
    questions.push("如果考研、实习和比赛不能同时拉满，你希望接下来 4 周优先保住哪一个？", "其他目标每周至少保留多少时间，哪些目标可以暂缓？");
  } else {
    missingFields.push("specific_scope", "measurable_outcome");
    questions.push("你要学习的具体范围是什么，例如考试科目、岗位方向、技术栈或作品类型？", "到目标日期时，什么结果可以让你判断自己真的完成了，而不只是看过资料？");
  }
  if (!input.constraints.length) {
    missingFields.push("realistic_constraints");
    questions.push("哪些日期或时段不能学习？工作日和周末分别能拿出多少时间？");
  }
  return {
    status: "clarification_required",
    reason_code: "insufficient_context",
    message: "先补充两三个关键条件，再生成路线；否则计划会建立在猜测上。",
    missing_fields: [...new Set(missingFields)],
    questions: [...new Set(questions)],
  };
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function resourceCandidatesFor(sourcePack, retrieval = {}) {
  const candidates = [];
  const seenUrls = new Set();
  const add = ({ sourceId, title, url, kind, publisher, excerpt, durationMinutes }) => {
    const safeUrl = safeHttpsUrl(url);
    if (!safeUrl || seenUrls.has(safeUrl)) return;
    seenUrls.add(safeUrl);
    candidates.push({
      id: `resource-${candidates.length + 1}`,
      source_id: String(sourceId ?? "").slice(0, 160),
      title: String(title ?? "").slice(0, 160),
      url: safeUrl,
      kind,
      publisher: String(publisher ?? "").slice(0, 120),
      excerpt: String(excerpt ?? "").slice(0, 320),
      duration_minutes: Number.isInteger(durationMinutes) && durationMinutes > 0 ? durationMinutes : null,
    });
  };
  const candidateKind = (text) => /题库|习题集|历年真题|真题(?:集|库|下载|汇编)|试题(?:集|库|下载)|历年试卷|question[-_ ]?bank|past[-_ ]?papers?/i.test(text)
    ? "practice"
    : /课程|网课|video|lecture/i.test(text) ? "course" : "reference";
  for (const source of sourcePack) {
    add({
      sourceId: source.id,
      title: source.title,
      url: source.official_url,
      kind: candidateKind(`${source.title} ${source.use_for}`),
      publisher: source.publisher,
      excerpt: source.use_for,
    });
  }
  for (const item of retrieval.results ?? []) {
    const reviewStatus = item.provenance?.review_status ?? item.provenance?.status;
    if (!["reviewed", "active"].includes(reviewStatus)) continue;
    const metadata = item.metadata ?? {};
    const source = item.source ?? {};
    const kindText = `${item.title} ${source.title} ${source.source_type ?? ""} ${metadata.resource_kind ?? ""}`;
    const links = [...new Set([...(item.source_links ?? []), source.official_url].filter(Boolean))];
    for (const url of links.slice(0, 4)) {
      add({
        sourceId: item.source_id ?? source.id,
        title: item.title || source.title,
        url,
        kind: candidateKind(kindText),
        publisher: source.publisher,
        excerpt: item.content,
        durationMinutes: metadata.duration_minutes,
      });
    }
  }
  return candidates.slice(0, 16);
}

function parseJsonObject(text, label, maximum = 24000) {
  if (typeof text !== "string" || text.length > maximum) throw new PlatformError("AI_OUTPUT_INVALID", `${label} was missing or too large`);
  let value;
  try {
    const normalized = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    try {
      value = JSON.parse(normalized);
    } catch {
      const start = normalized.indexOf("{");
      const end = normalized.lastIndexOf("}");
      if (start < 0 || end <= start) throw new Error("route draft did not contain a JSON object");
      value = JSON.parse(normalized.slice(start, end + 1));
    }
  } catch (error) {
    throw new PlatformError("AI_OUTPUT_INVALID", `${label} was not valid JSON`, { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlatformError("AI_OUTPUT_INVALID", `${label} must be an object`);
  return value;
}

function publicResource(candidate, locator = "") {
  if (!candidate) return null;
  return {
    source_id: candidate.source_id,
    title: candidate.title,
    url: candidate.url,
    kind: candidate.kind,
    publisher: candidate.publisher,
    duration_minutes: candidate.duration_minutes,
    excerpt: candidate.excerpt,
    locator,
    verification_status: "catalogued",
  };
}

function parseWeeklyPlan(value, { weekDates, resources, input, dailyMinutes }) {
  if (!Array.isArray(value) || value.length !== weekDates.length) throw new PlatformError("AI_OUTPUT_INVALID", "AI weekly plan does not cover the requested dates");
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]));
  const allowedFields = new Set(["date", "title", "type", "topic", "action", "planned_minutes", "practice_count", "practice_source_id", "practice_scope", "resource_source_id", "resource_locator", "expected_output"]);
  const taskTypes = new Set(["学习", "练习", "产出", "修正", "复盘"]);
  const tasks = value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some((key) => !allowedFields.has(key))) {
      throw new PlatformError("AI_OUTPUT_INVALID", "AI weekly plan contains unsupported task fields");
    }
    const date = weekDates[index];
    if (item.date !== date) throw new PlatformError("AI_OUTPUT_INVALID", "AI weekly plan dates are not consecutive");
    if (!taskTypes.has(item.type)) throw new PlatformError("AI_OUTPUT_INVALID", "AI weekly plan task type is invalid");
    const plannedMinutes = item.planned_minutes;
    const dayBudget = scheduleBudgetForDate(date, dailyMinutes);
    if (!Number.isInteger(plannedMinutes) || plannedMinutes < 5 || plannedMinutes > dayBudget) {
      throw new PlatformError("AI_OUTPUT_INVALID", "AI weekly plan exceeds the daily time budget");
    }
    if (!Number.isInteger(item.practice_count) || item.practice_count < 0 || item.practice_count > 100) {
      throw new PlatformError("AI_OUTPUT_INVALID", "AI weekly plan practice count is invalid");
    }
    const selectedResource = item.resource_source_id === null ? null : resourceById.get(item.resource_source_id);
    const resourceCandidate = selectedResource ?? (item.resource_source_id === null
      ? resources.find((resource) => resource.kind === "reference") ?? resources.find((resource) => resource.kind === "course") ?? null
      : null);
    const practiceCandidate = item.practice_source_id === null ? null : resourceById.get(item.practice_source_id);
    if (item.resource_source_id !== null && !resourceCandidate) throw new PlatformError("AI_OUTPUT_INVALID", "AI weekly plan referenced an unknown learning resource");
    if (item.practice_source_id !== null && (!practiceCandidate || practiceCandidate.kind !== "practice")) {
      throw new PlatformError("AI_OUTPUT_INVALID", "AI weekly plan referenced an unverified practice source");
    }
    if (item.practice_count > 0 && (!practiceCandidate || typeof item.practice_scope !== "string" || !item.practice_scope.trim())) {
      throw new PlatformError("AI_OUTPUT_INVALID", "AI weekly plan practice requires an existing source and range");
    }
    const resourceLocator = normalizeGeneratedText(item.resource_locator ?? "", "resource_locator", { max: 140 });
    if (!resourceCandidate && resourceLocator) throw new PlatformError("AI_OUTPUT_INVALID", "AI weekly plan added a location without a verified resource");
    return {
      date,
      title: normalizeGeneratedText(item.title, "daily title", { min: 1, max: 100 }),
      type: item.type,
      topic: normalizeGeneratedText(item.topic, "daily topic", { min: 1, max: 180 }),
      action: normalizeGeneratedText(item.action, "daily action", { min: 1, max: 600 }),
      planned_minutes: plannedMinutes,
      practice: {
        count: item.practice_count,
        source: publicResource(practiceCandidate, ""),
        scope: item.practice_count > 0 ? normalizeGeneratedText(item.practice_scope, "practice_scope", { min: 1, max: 180 }) : "",
      },
      resource: publicResource(resourceCandidate, resourceLocator),
      expected_output: normalizeGeneratedText(item.expected_output, "expected_output", { min: 1, max: 240 }),
    };
  });
  const weeklyBudget = Math.floor(weeklyCapacityMinutes(input.weekly_hours) * 0.8);
  if (tasks.reduce((total, task) => total + task.planned_minutes, 0) > weeklyBudget) {
    throw new PlatformError("AI_OUTPUT_INVALID", "AI weekly plan exceeds the protected weekly time budget");
  }
  return tasks;
}

function fallbackWeeklyPlan({ weekDates, milestones, resources, input, dailyMinutes }) {
  const weeklyBudget = Math.floor(weeklyCapacityMinutes(input.weekly_hours) * 0.8);
  const dailyBudget = Math.floor(weeklyBudget / weekDates.length);
  const schedule = weekDates.map((date) => {
    const milestone = milestones.find((item) => date >= item.start_date && date <= item.end_date)
      ?? milestones.filter((item) => item.end_date < date).at(-1)
      ?? milestones.find((item) => item.start_date > date)
      ?? milestones.at(-1);
    const outcome = milestone.outcomes[0];
    const isReviewDay = new Date(`${date}T00:00:00.000Z`).getUTCDay() === 0;
    return {
      date,
      title: `${milestone.title} · ${isReviewDay ? "阶段回望" : "当天推进"}`,
      type: isReviewDay ? "复盘" : "学习",
      topic: milestone.title,
      action: `围绕“${outcome}”整理一条学习记录或卡点，不补写未核验题目。`,
      planned_minutes: Math.max(5, Math.min(scheduleBudgetForDate(date, dailyMinutes), dailyBudget)),
      practice_count: 0,
      practice_source_id: null,
      practice_scope: "",
      resource_source_id: null,
      resource_locator: "",
      expected_output: `留下与“${outcome}”有关的一条可复查记录。`,
    };
  });
  return parseWeeklyPlan(schedule, { weekDates, resources, input, dailyMinutes });
}

function parseProviderDraft(text, input, today, weekDates, resources, profile = {}) {
  const value = parseJsonObject(text, "AI route draft");
  const allowed = new Set(["summary", "assumptions", "facts_to_confirm", "milestones", "weekly_plan"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new PlatformError("AI_OUTPUT_INVALID", "AI route draft contains unsupported fields");
  const summary = normalizeGeneratedText(value.summary, "summary", { min: 1, max: 120 });
  if (!Array.isArray(value.assumptions) || value.assumptions.length < 1 || value.assumptions.length > 4) throw new PlatformError("AI_OUTPUT_INVALID", "AI route draft assumptions are invalid");
  if (!Array.isArray(value.facts_to_confirm) || value.facts_to_confirm.length < 1 || value.facts_to_confirm.length > 4) throw new PlatformError("AI_OUTPUT_INVALID", "AI route draft facts_to_confirm are invalid");
  if (!Array.isArray(value.milestones) || value.milestones.length < 2 || value.milestones.length > MAX_PLAN_MILESTONES) throw new PlatformError("AI_OUTPUT_INVALID", "AI route draft milestones are invalid");
  const assumptions = uniqueTexts([
    `按每周${input.weekly_hours}小时安排。`,
    `当前基础按${input.baseline}处理。`,
    ...value.assumptions,
    ], "assumption", 4);
  const factsToConfirm = uniqueTexts([
    ...requiredFactsFor(input),
    ...value.facts_to_confirm,
  ], "fact_to_confirm", 4);
  let previousEnd = dateValue(today) - DAY_MS;
  let firstMilestone = true;
  const milestones = value.milestones.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new PlatformError("AI_OUTPUT_INVALID", "AI route milestone is invalid");
    const keys = Object.keys(item);
    if (keys.some((key) => !["title", "start_date", "end_date", "planned_hours", "outcomes"].includes(key))) throw new PlatformError("AI_OUTPUT_INVALID", "AI route milestone contains unsupported fields");
    const title = normalizeGeneratedText(item.title, "milestone title", { min: 1, max: 24 });
    if (!isDateOnly(item.start_date) || !isDateOnly(item.end_date)) throw new PlatformError("AI_OUTPUT_INVALID", "AI route milestone dates are invalid");
    const start = dateValue(item.start_date);
    const end = dateValue(item.end_date);
    if (firstMilestone && item.start_date !== today) {
      throw new PlatformError("AI_OUTPUT_INVALID", "AI route must start with an executable task today");
    }
    if (start < dateValue(today) || start <= previousEnd || end < start || end > dateValue(input.target_date)) {
      throw new PlatformError("AI_OUTPUT_INVALID", "AI route milestone dates are not feasible");
    }
    if (typeof item.planned_hours !== "number"
      || !Number.isFinite(item.planned_hours)
      || item.planned_hours < 1
      || item.planned_hours > 1000
      || Math.abs(item.planned_hours * 10 - Math.round(item.planned_hours * 10)) > 1e-8) {
      throw new PlatformError("AI_OUTPUT_INVALID", "AI route milestone planned_hours are invalid");
    }
    if (!Array.isArray(item.outcomes) || item.outcomes.length < 1 || item.outcomes.length > 2) throw new PlatformError("AI_OUTPUT_INVALID", "AI route milestone outcomes are invalid");
    previousEnd = end;
    firstMilestone = false;
    return {
      title,
      start_date: item.start_date,
      end_date: item.end_date,
      planned_hours: Math.round(item.planned_hours * 10) / 10,
      outcomes: uniqueTexts(item.outcomes, "milestone outcome", 2),
    };
  });
  const dailyMinutes = effectiveDailyMinutes(input, profile);
  let weeklyPlan;
  let weeklyPlanFallback = false;
  try {
    weeklyPlan = parseWeeklyPlan(value.weekly_plan, { weekDates, resources, input, dailyMinutes });
  } catch (error) {
    if (error?.code !== "AI_OUTPUT_INVALID") throw error;
    weeklyPlan = fallbackWeeklyPlan({ weekDates, milestones, resources, input, dailyMinutes });
    weeklyPlanFallback = true;
  }
  return { summary, assumptions, facts_to_confirm: factsToConfirm, milestones, weekly_plan: weeklyPlan, weekly_plan_fallback: weeklyPlanFallback };
}

function parseWeeklyPlanDraft(text, options) {
  const value = parseJsonObject(text, "AI next-week plan");
  if (Object.keys(value).some((key) => key !== "weekly_plan")) throw new PlatformError("AI_OUTPUT_INVALID", "AI next-week plan contains unsupported fields");
  return parseWeeklyPlan(value.weekly_plan, options);
}

function feasibilityFor(input, milestones, today, plan) {
  const daysRemaining = Math.round((dateValue(input.target_date) - dateValue(today)) / DAY_MS) + 1;
  const totalAvailableHours = Math.floor((daysRemaining / 7) * input.weekly_hours);
  const protectedCapacityHours = Math.floor(totalAvailableHours * ((100 - CAPACITY_BUFFER_PERCENT) / 100));
  const plannedHoursTenths = milestones.reduce((total, milestone) => total + Math.round(milestone.planned_hours * 10), 0);
  const plannedHours = plannedHoursTenths / 10;
  const scheduledMinutes = flattenTasks(plan).reduce((total, task) => total + (Number(task.planned_minutes) || 0), 0);
  const capacityByMilestone = milestones.map((milestone) => {
    const days = Math.round((dateValue(milestone.end_date) - dateValue(milestone.start_date)) / DAY_MS) + 1;
    const availableHours = Math.floor((days / 7) * input.weekly_hours);
    const protectedHours = Math.floor(availableHours * ((100 - CAPACITY_BUFFER_PERCENT) / 100));
    const milestoneHoursTenths = Math.round(milestone.planned_hours * 10);
    const status = milestoneHoursTenths > availableHours * 10
      ? "over_capacity"
      : milestoneHoursTenths > protectedHours * 10
        ? "tight"
        : "feasible";
    return {
      title: milestone.title,
      days,
      available_hours: availableHours,
      protected_hours: protectedHours,
      planned_hours: milestoneHoursTenths / 10,
      status,
    };
  });
  const issues = capacityByMilestone
    .filter((item) => item.status !== "feasible")
    .map((item) => item.status === "over_capacity"
      ? `${item.title}安排${item.planned_hours}小时，超过该阶段可用的${item.available_hours}小时。`
      : `${item.title}安排${item.planned_hours}小时，超过保留缓冲后的${item.protected_hours}小时。`);
  const status = plannedHoursTenths > totalAvailableHours * 10
    ? "needs_adjustment"
    : plannedHoursTenths > protectedCapacityHours * 10 || capacityByMilestone.some((item) => item.status !== "feasible")
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
    scheduled_hours: Math.round(scheduledMinutes / 60 * 10) / 10,
    requested_daily_minutes: input.daily_minutes,
    effective_daily_minutes: plan?.daily_minutes ?? effectiveDailyMinutes(input),
    buffer_percent: CAPACITY_BUFFER_PERCENT,
    message,
    capacity_by_milestone: capacityByMilestone,
    issues,
  };
}

function validateRefreshRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlatformError("VALIDATION_ERROR", "plan refresh must be an object");
  const allowed = new Set(["request_id", "expected_version", "completed_task_ids", "skipped_task_ids", "available_minutes", "task_feedbacks", "advance_week"]);
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
  if (input.task_feedbacks !== undefined && (!Array.isArray(input.task_feedbacks) || input.task_feedbacks.length > 7)) {
    throw new PlatformError("VALIDATION_ERROR", "task_feedbacks must contain at most seven daily reports");
  }
  const feedbackIds = new Set();
  const taskFeedbacks = (input.task_feedbacks ?? []).map((feedback) => {
    if (!feedback || typeof feedback !== "object" || Array.isArray(feedback)
      || Object.keys(feedback).some((key) => !["task_id", "status", "actual_minutes", "note"].includes(key))) {
      throw new PlatformError("VALIDATION_ERROR", "daily task feedback is invalid");
    }
    if (typeof feedback.task_id !== "string" || !/^plan-day-\d{4}-\d{2}-\d{2}$/.test(feedback.task_id) || feedbackIds.has(feedback.task_id)) {
      throw new PlatformError("VALIDATION_ERROR", "daily task feedback id is invalid or duplicated");
    }
    feedbackIds.add(feedback.task_id);
    if (!["completed", "partial", "not_started"].includes(feedback.status)) throw new PlatformError("VALIDATION_ERROR", "daily task feedback status is invalid");
    if (feedback.actual_minutes !== undefined && feedback.actual_minutes !== null
      && (!Number.isInteger(feedback.actual_minutes) || feedback.actual_minutes < 0 || feedback.actual_minutes > 1440)) {
      throw new PlatformError("VALIDATION_ERROR", "daily task feedback minutes are invalid");
    }
    const note = feedback.note === undefined ? "" : normalizeText(feedback.note, "feedback note", { max: 500 });
    return {
      task_id: feedback.task_id,
      status: feedback.status,
      actual_minutes: feedback.actual_minutes ?? null,
      note,
    };
  });
  if (input.advance_week !== undefined && typeof input.advance_week !== "boolean") throw new PlatformError("VALIDATION_ERROR", "advance_week must be a boolean");
  return {
    request_id: input.request_id,
    expected_version: input.expected_version,
    completed_task_ids: normalizeIds(input.completed_task_ids, "completed_task_ids"),
    skipped_task_ids: normalizeIds(input.skipped_task_ids, "skipped_task_ids"),
    available_minutes: input.available_minutes ?? null,
    task_feedbacks: taskFeedbacks,
    advance_week: input.advance_week === true,
  };
}

function roundHours(minutes) {
  return Math.round(minutes / 60 * 10) / 10;
}

function replanAfterRefresh(plan, request, clock, currentDay) {
  const dailyMinutes = request.available_minutes === null
    ? plan.daily_minutes
    : Math.max(5, Math.min(plan.daily_minutes, request.available_minutes));
  const completed = new Set(request.completed_task_ids);
  const skipped = new Set(request.skipped_task_ids);
  const reports = new Map(request.task_feedbacks.map((feedback) => [feedback.task_id, feedback]));
  const today = currentDay;
  const updateDays = (days) => days.map((day) => {
    const feedback = reports.get(day.id);
    const effectiveFeedback = feedback ?? day.feedback;
    const nextStatus = completed.has(day.id)
      ? "done"
      : skipped.has(day.id)
        ? "planned"
        : effectiveFeedback?.status === "completed"
          ? "done"
          : effectiveFeedback
            ? day.date === today ? "active" : "planned"
        : day.completion_status;
    const withFeedback = feedback
      ? { ...day, feedback: { status: feedback.status, actual_minutes: feedback.actual_minutes, note: feedback.note, reported_at: new Date(clock()).toISOString() } }
      : day;
    if (day.date <= today || nextStatus === "done" || effectiveFeedback) return { ...withFeedback, completion_status: nextStatus };
    const targetMinutes = day.type === "复盘" ? Math.max(5, Math.round(dailyMinutes * 0.5)) : dailyMinutes;
    return { ...withFeedback, completion_status: nextStatus, planned_minutes: targetMinutes };
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
  const allTasks = plan.weekly_tasks ?? [];
  const weeklyTasks = updateDays(allTasks);
  const updateReason = request.available_minutes === null
    ? `${changedCount + request.task_feedbacks.length} 项执行情况已保存。`
    : `根据今日可用的 ${request.available_minutes} 分钟，${changedCount + request.task_feedbacks.length} 项执行情况已保存。`;
  return {
    ...plan,
    daily_minutes: dailyMinutes,
    last_updated_at: updatedAt,
    update_reason: updateReason,
    horizon: { ...plan.horizon, years },
    current_year: currentYear,
    months,
    weekly_tasks: weeklyTasks,
    cycle_start_date: weeklyTasks[0]?.date ?? plan.cycle_start_date,
    cycle_end_date: weeklyTasks.at(-1)?.date ?? plan.cycle_end_date,
    today: { date: today, tasks: weeklyTasks.filter((day) => day.date === today) },
    upcoming_tasks: weeklyTasks.filter((day) => day.date > today),
  };
}

function advancePlanWindow(plan, route, weeklyPlan, startDate, clock) {
  const input = {
    goal_type: route.goal.type,
    goal_name: route.goal.name,
    target_date: route.goal.target_date,
    weekly_hours: route.goal.weekly_hours,
    daily_minutes: route.goal.daily_minutes,
    baseline: route.goal.baseline,
    constraints: route.goal.constraints ?? [],
    focus_areas: route.goal.focus_areas ?? [],
  };
  const tasks = buildWeeklyTasks({ weeklyPlan, milestones: route.milestones, today: startDate, input });
  const taskById = new Map(flattenTasks(plan).map((task) => [task.id, task]));
  for (const task of tasks) taskById.set(task.id, task);
  const allTasks = [...taskById.values()].sort((left, right) => left.date.localeCompare(right.date));
  const months = plan.months.map((month) => {
    const days = allTasks.filter((day) => day.date >= `${month.month}-01` && day.date <= month.end_date);
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
  return {
    ...plan,
    generated_at: updatedAt,
    last_updated_at: updatedAt,
    update_reason: "已参考上一个七日周期的自我反馈生成下一周期。",
    horizon: { ...plan.horizon, years },
    current_year: currentYear,
    months,
    cycle_start_date: tasks[0]?.date ?? startDate,
    cycle_end_date: tasks.at(-1)?.date ?? startDate,
    weekly_tasks: tasks,
    today: { date: startDate, tasks: tasks.filter((task) => task.date === startDate) },
    upcoming_tasks: tasks.filter((task) => task.date > startDate),
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
    const replay = await this.database.get(idempotencyKey(actorId, normalizedIdempotencyKey));
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw new PlatformError("CONFLICT", "idempotency key was reused with a different route request");
      return replay.response;
    }
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
    const clarification = clarificationFor(routeInput);
    if (clarification) {
      const response = { request_id: input.request_id, ...clarification };
      await this.database.transaction(async (database) => {
        const existingReplay = await database.get(idempotencyKey(actorId, normalizedIdempotencyKey));
        if (existingReplay) {
          if (existingReplay.fingerprint !== fingerprint) throw new PlatformError("CONFLICT", "idempotency key was reused with a different route request");
          return;
        }
        await database.set(`learning-route:request:${actorId}:${input.request_id}`, { fingerprint, response });
        await database.set(idempotencyKey(actorId, normalizedIdempotencyKey), { fingerprint, response });
      });
      return response;
    }
    const sourcePack = sourcePackFor(input.goal_type);
    const today = currentDate(this.clock, savedProfile.timezone || "Asia/Shanghai");
    const weekDates = planDates(today, routeInput.target_date);
    if (weekDates.length !== 7) {
      throw new PlatformError("VALIDATION_ERROR", "目标日期至少需要覆盖从今天起的连续七天，才能生成首个七日计划");
    }
    const retrieval = this.knowledge
      ? await this.knowledge.search({
        goal_type: input.goal_type,
        query: [routeInput.goal_name, ...routeInput.focus_areas, ...routeInput.constraints, savedProfile.major, savedProfile.stage].filter(Boolean).join(" "),
        region: input.region,
        limit: 6,
      })
      : { knowledge_index_version: "unavailable", retrieved_at: new Date(this.clock()).toISOString(), results: [] };
    const resourceCandidates = resourceCandidatesFor(sourcePack, retrieval);
    const personalMemoryScope = memoryScopeFor(input.goal_type);
    const personalKnowledge = this.memory
      ? { ...(await this.memory.getMemories(actorId, input.request_id, personalMemoryScope)), scope: personalMemoryScope }
      : { scope: personalMemoryScope, memories: [] };
    const aiResponse = await this.ai.submit(actorId, {
      request_id: input.request_id,
      feature: "learning_route_generation",
      input: buildLearningRoutePrompt(routeInput, sourcePack, today, retrieval, this.knowledge?.formatContext(retrieval), personalKnowledge, learnerProfile, weekDates, resourceCandidates),
    }, normalizedIdempotencyKey);
    if (aiResponse.status !== "completed") {
      await this.ai.releaseFeatureQuota(actorId, input.request_id);
      const response = { request_id: input.request_id, status: "degraded", reason_code: "ai_unavailable" };
      await this.database.transaction(async (database) => {
        await database.set(`learning-route:request:${actorId}:${input.request_id}`, { fingerprint, response });
        await database.set(idempotencyKey(actorId, normalizedIdempotencyKey), { fingerprint, response });
      });
      return response;
    }
    let draft;
    try {
      draft = parseProviderDraft(aiResponse.result.text, routeInput, today, weekDates, resourceCandidates, savedProfile);
    } catch (error) {
      if (error?.code === "AI_OUTPUT_INVALID") await this.ai.releaseFeatureQuota(actorId, input.request_id);
      throw error;
    }
    let weeklyPlanFallback = draft.weekly_plan_fallback;
    let plan = buildPlanHierarchy({ input: routeInput, milestones: draft.milestones, weeklyPlan: draft.weekly_plan, today, summary: draft.summary, profile: savedProfile, clock: this.clock });
    let planValidation = validatePlan({ plan, milestones: draft.milestones, input: routeInput, profile: savedProfile, today });
    if (!planValidation.ok && !weeklyPlanFallback) {
      const fallback = fallbackWeeklyPlan({
        weekDates,
        milestones: draft.milestones,
        resources: resourceCandidates,
        input: routeInput,
        dailyMinutes: plan.daily_minutes,
      });
      const fallbackPlan = buildPlanHierarchy({ input: routeInput, milestones: draft.milestones, weeklyPlan: fallback, today, summary: draft.summary, profile: savedProfile, clock: this.clock });
      const fallbackValidation = validatePlan({ plan: fallbackPlan, milestones: draft.milestones, input: routeInput, profile: savedProfile, today });
      if (fallbackValidation.ok) {
        plan = fallbackPlan;
        planValidation = fallbackValidation;
        weeklyPlanFallback = true;
      }
    }
    if (!planValidation.ok) {
      await this.ai.releaseFeatureQuota(actorId, input.request_id);
      throw new PlatformError("AI_OUTPUT_INVALID", "AI route plan failed deterministic validation", { metadata: { planValidation } });
    }
    const generationNotice = weeklyPlanFallback
      ? "AI 七日安排未通过校验；已按有效阶段目标生成保守日程，未引用未核验题库。"
      : "";
    plan.weekly_plan_source = weeklyPlanFallback ? "milestone_fallback" : "ai_generated";
    plan.generation_notice = generationNotice;
    plan.validation_warnings = [...planValidation.warnings, ...(generationNotice ? [generationNotice] : [])];
    const feasibility = feasibilityFor(routeInput, draft.milestones, today, plan);
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
        baseline_assessment: routeInput.baseline_assessment,
        region: routeInput.region || savedProfile.region || null,
        constraints: routeInput.constraints,
        focus_areas: routeInput.focus_areas,
        daily_minutes: plan.daily_minutes,
        requested_daily_minutes: routeInput.daily_minutes,
        timezone: savedProfile.timezone || "Asia/Shanghai",
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
      if (!["feasible", "tight"].includes(route.feasibility.status)) throw new PlatformError("VALIDATION_ERROR", "only feasible or tight learning routes can be confirmed");
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
    const replayKey = refreshIdempotencyKey(actorId, normalizedIdempotencyKey);
    const replay = await this.database.get(replayKey);
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw new PlatformError("CONFLICT", "idempotency key was reused with a different plan refresh");
      return replay.response;
    }
    const indexedActor = await this.database.get(routeIndexKey(routeId));
    if (indexedActor && indexedActor !== actorId) throw new PlatformError("FORBIDDEN", "learning route belongs to another actor");
    const route = await this.database.get(routeKey(actorId, routeId));
    if (!route) throw new PlatformError("NOT_FOUND", "learning route was not found");
    if (route.version !== request.expected_version) throw new PlatformError("CONFLICT", "learning route version has changed");
    if (!route.plan) throw new PlatformError("CONFLICT", "learning route has no executable plan");
    const currentWeekIds = new Set((route.plan.weekly_tasks ?? []).map((task) => task.id));
    if (request.task_feedbacks.some((feedback) => !currentWeekIds.has(feedback.task_id))) {
      throw new PlatformError("VALIDATION_ERROR", "feedback must reference a task in the current seven-day plan");
    }
    const today = currentDate(this.clock, route.goal.timezone || "Asia/Shanghai");
    const taskById = new Map((route.plan.weekly_tasks ?? []).map((task) => [task.id, task]));
    if (request.task_feedbacks.some((feedback) => taskById.get(feedback.task_id)?.date > today)) {
      throw new PlatformError("VALIDATION_ERROR", "未来日期的计划暂时不能提交执行反馈");
    }
    let updatedPlan = replanAfterRefresh(route.plan, request, this.clock, today);
    if (request.advance_week) {
      const currentTasks = updatedPlan.weekly_tasks ?? [];
      const endDate = currentTasks.at(-1)?.date;
      if (!currentTasks.length || currentTasks.some((task) => !task.feedback?.status)) {
        throw new PlatformError("VALIDATION_ERROR", "请先为本周期七天分别提交执行反馈，再生成下一周计划");
      }
      if (endDate > today) throw new PlatformError("CONFLICT", "本周期尚未结束，暂时不能生成下一周计划");
      const nextStartDate = addDays(endDate, 1);
      const weekDates = planDates(nextStartDate, route.goal.target_date);
      if (weekDates.length !== 7) throw new PlatformError("CONFLICT", "距离目标日期不足七天，当前路线已进入最后一个计划周期");
      const sourcePack = sourcePackFor(route.goal.type);
      const retrieval = this.knowledge
        ? await this.knowledge.search({
          goal_type: route.goal.type,
          query: [route.goal.name, ...(route.goal.focus_areas ?? []), ...currentTasks.map((task) => task.topic), ...currentTasks.map((task) => task.feedback?.note)].filter(Boolean).join(" "),
          region: route.goal.region,
          limit: 6,
        })
        : { knowledge_index_version: "unavailable", retrieved_at: new Date(this.clock()).toISOString(), results: [] };
      const resources = resourceCandidatesFor(sourcePack, retrieval);
      const aiResponse = await this.ai.submit(actorId, {
        request_id: request.request_id,
        feature: "learning_route_generation",
        input: buildLearningWeekPrompt({ route, weekDates, resourceCandidates: resources, priorTasks: currentTasks }),
      }, sha256(`${normalizedIdempotencyKey}:weekly-plan`));
      if (aiResponse.status !== "completed") throw new PlatformError("DEPENDENCY_UNAVAILABLE", "AI 下一周期计划暂时不可用，当前反馈已经保留");
      const weeklyPlan = parseWeeklyPlanDraft(aiResponse.result.text, {
        weekDates,
        resources,
        input: {
          weekly_hours: route.goal.weekly_hours,
          daily_minutes: route.goal.daily_minutes,
        },
        dailyMinutes: effectiveDailyMinutes({ weekly_hours: route.goal.weekly_hours, daily_minutes: route.goal.daily_minutes }),
      });
      updatedPlan = advancePlanWindow(updatedPlan, route, weeklyPlan, nextStartDate, this.clock);
      const validation = validatePlan({
        plan: updatedPlan,
        milestones: route.milestones,
        input: {
          goal_type: route.goal.type,
          target_date: route.goal.target_date,
          weekly_hours: route.goal.weekly_hours,
          daily_minutes: route.goal.daily_minutes,
        },
        today: nextStartDate,
      });
      if (!validation.ok) throw new PlatformError("AI_OUTPUT_INVALID", "AI next-week plan failed deterministic validation", { metadata: { validation } });
    }
    return this.database.transaction(async (database) => {
      const transactionReplay = await database.get(replayKey);
      if (transactionReplay) {
        if (transactionReplay.fingerprint !== fingerprint) throw new PlatformError("CONFLICT", "idempotency key was reused with a different plan refresh");
        return transactionReplay.response;
      }
      const indexedActor = await database.get(routeIndexKey(routeId));
      if (indexedActor && indexedActor !== actorId) throw new PlatformError("FORBIDDEN", "learning route belongs to another actor");
      const latestRoute = await database.get(routeKey(actorId, routeId));
      if (!latestRoute) throw new PlatformError("NOT_FOUND", "learning route was not found");
      if (latestRoute.version !== request.expected_version) throw new PlatformError("CONFLICT", "learning route version has changed");
      const updated = {
        ...latestRoute,
        version: latestRoute.version + 1,
        plan: updatedPlan,
        updated_at: new Date(this.clock()).toISOString(),
      };
      const response = { request_id: request.request_id, route: updated, replayed: false };
      await database.set(routeKey(actorId, routeId), updated);
      await database.set(latestRouteKey(actorId), routeId);
      await database.set(replayKey, { fingerprint, response });
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
  parseWeeklyPlan,
  resourceCandidatesFor,
};
