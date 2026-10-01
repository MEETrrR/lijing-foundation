import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createBackendServer } = require("../../services/api/src/bootstrap/http-api.ts");
const { buildPlanHierarchy } = require("../../services/api/src/domains/learning-route/plan-builder.ts");
const { effectiveDailyMinutes, flattenTasks, validatePlan } = require("../../services/api/src/domains/learning-route/plan-validator.ts");
const { GOAL_TYPES, SOURCE_REGISTRY, parseWeeklyPlan, resourceCandidatesFor } = require("../../services/api/src/domains/learning-route/learning-route-service.ts");
const { normalizeAssistantResponse, parseAssistantResponse } = require("../../services/api/src/domains/ai-gateway/assistant-response.ts");
const { normalizePolicy, outputTokenLimitFor } = require("../../services/api/src/domains/ai-gateway/ai-gateway-service.ts");

const DAY_MS = 86400000;

test("seven-day route output has room for its schedule without raising other feature limits", () => {
  const policy = normalizePolicy();
  assert.equal(policy.featureDailyLimits.learning_route_generation, 5);
  assert.equal(outputTokenLimitFor("learning_route_generation", policy), 3500);
  assert.equal(outputTokenLimitFor("concept_explanation", policy), 1000);
  assert.equal(outputTokenLimitFor("learning_route_generation", normalizePolicy({ maxOutputTokens: 1200 })), 1200);
});

function addDays(date, amount) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + amount * DAY_MS).toISOString().slice(0, 10);
}

function weeklyPlan(startDate, weeklyHours, { practiceSourceId = null, practiceCount = 0, dailyMinutes } = {}) {
  const dailyCapacity = Math.max(5, Math.floor((weeklyHours * 60) / 6.5));
  const daily = Math.max(5, Math.min(dailyCapacity, Number.isInteger(dailyMinutes) ? dailyMinutes : dailyCapacity));
  const cycleDayBudget = Math.floor((weeklyHours * 60 * 0.8) / 7);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(startDate, index);
    const isSunday = new Date(`${date}T00:00:00.000Z`).getUTCDay() === 0;
    const sundayBudget = Math.max(5, Math.floor(daily * 0.5));
    return {
      date,
      title: `围绕目标推进第 ${index + 1} 天`,
      type: index === 6 ? "复盘" : "学习",
      topic: `学习主题 ${index + 1}`,
      action: `使用已收录资料学习主题 ${index + 1}，按来源完成安排，不生成题目。`,
      planned_minutes: Math.max(5, Math.min(daily, cycleDayBudget, isSunday ? sundayBudget : daily)),
      practice_count: practiceCount,
      practice_source_id: practiceSourceId,
      practice_scope: practiceCount ? "已收录题库中与本日主题对应的练习范围" : "",
      resource_source_id: null,
      resource_locator: "",
      expected_output: `留下主题 ${index + 1} 的简短复述。`,
    };
  });
}

function parsedWeeklyPlan(startDate, weeklyHours, dailyMinutes, resources = []) {
  const input = { weekly_hours: weeklyHours, daily_minutes: dailyMinutes };
  const schedule = weeklyPlan(startDate, weeklyHours, { dailyMinutes });
  return parseWeeklyPlan(schedule, {
    weekDates: schedule.map((task) => task.date),
    resources,
    input,
    dailyMinutes: effectiveDailyMinutes(input),
  });
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}

async function jsonRequest(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.body === undefined ? {} : { "Content-Type": "application/json" }), ...(options.headers ?? {}) },
  });
  return { response, body: await response.json() };
}

test("route generation asks for missing context before calling AI", async () => {
  let providerCalls = 0;
  const { server } = createBackendServer({
    aiEnabled: true,
    clock: () => Date.parse("2026-09-18T00:00:00.000Z"),
    provider: { async complete() { providerCalls += 1; throw new Error("provider should not be called"); } },
  });
  const baseUrl = await listen(server);
  try {
    const result = await jsonRequest(baseUrl, "/api/v1/learning-routes", {
      method: "POST",
      headers: { Authorization: "Bearer dev-user-001-token", "Idempotency-Key": "route-clarify-python-0001" },
      body: JSON.stringify({
        request_id: "12121212-1212-4121-8121-121212121212",
        goal_type: "personal_growth",
        goal_name: "我想学 Python",
        target_date: "2027-01-18",
        weekly_hours: 5,
        baseline: "starting",
      }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.status, "clarification_required");
    assert.ok(result.body.questions.length >= 2);
    assert.ok(result.body.missing_fields.includes("specific_scope"));
    assert.equal(providerCalls, 0);
  } finally {
    await close(server);
  }
});

test("route clarification treats spacing and common AI goal wording consistently", async () => {
  let providerCalls = 0;
  const { server } = createBackendServer({
    aiEnabled: true,
    clock: () => Date.parse("2026-09-18T00:00:00.000Z"),
    provider: { async complete() { providerCalls += 1; throw new Error("provider should not be called"); } },
  });
  const baseUrl = await listen(server);
  try {
    for (const [index, goalName] of ["我要学会 AI", "我想学习 Python"].entries()) {
      const result = await jsonRequest(baseUrl, "/api/v1/learning-routes", {
        method: "POST",
        headers: { Authorization: "Bearer dev-user-001-token", "Idempotency-Key": `route-clarify-normalized-${index}-0001` },
        body: JSON.stringify({
          request_id: `12121212-1212-4121-8121-1212121212${30 + index}`,
          goal_type: "personal_growth",
          goal_name: goalName,
          target_date: "2027-01-18",
          weekly_hours: 5,
          baseline: "starting",
        }),
      });
      assert.equal(result.response.status, 200);
      assert.equal(result.body.status, "clarification_required");
      assert.ok(result.body.missing_fields.includes("specific_scope"));
    }
    assert.equal(providerCalls, 0);
  } finally {
    await close(server);
  }
});

test("route generation tolerates provider JSON wrapped in ordinary prose without relaxing validation", async () => {
  const provider = {
    async complete() {
      const draft = {
        summary: "先完成范围确认，再用阶段产出验证 Python 项目能力。",
        assumptions: ["每周可稳定投入 5 小时。"],
        facts_to_confirm: ["根据目标岗位要求核对项目技术范围。"],
        milestones: [
          { title: "范围确认与基础练习", start_date: "2026-09-18", end_date: "2026-09-30", planned_hours: 8, outcomes: ["完成一个可运行的小练习"] },
          { title: "项目实现与复盘", start_date: "2026-10-01", end_date: "2026-10-31", planned_hours: 8, outcomes: ["留下一个可展示项目和复盘记录"] },
        ],
        weekly_plan: weeklyPlan("2026-09-18", 5),
      };
      return { source_type: "ai_assisted", text: `路线草案如下：\n\`\`\`json\n${JSON.stringify(draft)}\n\`\`\`` };
    },
  };
  const { server } = createBackendServer({ provider, aiEnabled: true, clock: () => Date.parse("2026-09-18T00:00:00.000Z") });
  const baseUrl = await listen(server);
  try {
    const result = await jsonRequest(baseUrl, "/api/v1/learning-routes", {
      method: "POST",
      headers: { Authorization: "Bearer dev-user-001-token", "Idempotency-Key": "route-fenced-json-0001" },
      body: JSON.stringify({
        request_id: "34343434-3434-4343-8343-343434343434",
        goal_type: "personal_growth",
        goal_name: "Python 项目练习",
        target_date: "2026-10-31",
        weekly_hours: 5,
        daily_minutes: 60,
        baseline: "starting",
        focus_areas: ["Python"],
        constraints: ["工作日晚上学习"],
      }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.status, "draft");
    assert.equal(result.body.route.plan.weekly_tasks.length, 7);
    assert.equal(result.body.route.plan.today.tasks.length, 1);
    assert.deepEqual(result.body.route.plan.weekly_tasks.map((task) => task.date), Array.from({ length: 7 }, (_, index) => addDays("2026-09-18", index)));
    assert.ok(result.body.route.plan.weekly_tasks.every((task) => task.practice.count === 0));
  } finally {
    await close(server);
  }
});

test("invalid or unavailable route generation restores the user's route quota", async () => {
  const providers = [
    { async complete() { return { text: "{}", source_type: "ai_assisted" }; } },
    { async complete() { throw new Error("provider timeout"); } },
  ];
  for (const [index, provider] of providers.entries()) {
    const { server } = createBackendServer({
      aiEnabled: true,
      clock: () => Date.parse("2026-09-18T00:00:00.000Z"),
      provider,
      policy: { maxBurstRequests: 20, featureDailyLimits: { learning_route_generation: 1 } },
    });
    const baseUrl = await listen(server);
    try {
      const generated = await jsonRequest(baseUrl, "/api/v1/learning-routes", {
        method: "POST",
        headers: { Authorization: "Bearer dev-user-001-token", "Idempotency-Key": `cet4-invalid-quota-${index}-0001` },
        body: JSON.stringify({
          request_id: `eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee${index}`,
          goal_type: "college_english_exam",
          goal_name: "大学英语四级考试",
          target_date: "2026-10-20",
          weekly_hours: 8,
          daily_minutes: 30,
          baseline: "foundation",
        }),
      });
      if (index === 0) assert.equal(generated.response.status, 502);
      else {
        assert.equal(generated.response.status, 200);
        assert.equal(generated.body.status, "degraded");
      }
      const latest = await jsonRequest(baseUrl, "/api/v1/learning-routes", { headers: { Authorization: "Bearer dev-user-001-token" } });
      assert.deepEqual(latest.body.generation_quota, {
        limit: 1,
        used: 0,
        remaining: 1,
        resets_at: "2026-09-19T00:00:00.000Z",
      });
    } finally {
      await close(server);
    }
  }
});

test("fractional milestone hours and an over-budget AI day remain confirmable through the safe schedule fallback", async () => {
  const provider = {
    async complete() {
      return {
        source_type: "ai_assisted",
        text: JSON.stringify({
          summary: "按阶段目标安排学习，并用每周反馈调整节奏。",
          assumptions: ["按每周 10 小时安排。"],
          facts_to_confirm: ["核对阶段产出是否符合当前目标。"],
          milestones: [
            { title: "基础学习阶段", start_date: "2026-09-18", end_date: "2026-10-29", planned_hours: 60.5, outcomes: ["留下基础学习记录"] },
            { title: "项目巩固阶段", start_date: "2026-10-30", end_date: "2026-12-10", planned_hours: 59.5, outcomes: ["完成阶段复盘"] },
          ],
          weekly_plan: weeklyPlan("2026-09-18", 10, { dailyMinutes: 25 }).map((task) => (
            task.date === "2026-09-20" ? { ...task, planned_minutes: 13 } : task
          )),
        }),
      };
    },
  };
  const { server } = createBackendServer({ provider, aiEnabled: true, clock: () => Date.parse("2026-09-18T00:00:00.000Z") });
  const baseUrl = await listen(server);
  try {
    const created = await jsonRequest(baseUrl, "/api/v1/learning-routes", {
      method: "POST",
      headers: { Authorization: "Bearer dev-user-001-token", "Idempotency-Key": "route-equal-hours-0001" },
      body: JSON.stringify({
        request_id: "abababab-abab-4bab-8bab-abababababab",
        goal_type: "personal_growth",
        goal_name: "Python 项目练习",
        target_date: "2026-12-10",
        weekly_hours: 10,
        daily_minutes: 25,
        baseline: "starting",
        focus_areas: ["Python 项目"],
        constraints: ["工作日晚上学习"],
      }),
    });
    assert.equal(created.response.status, 200, JSON.stringify(created.body));
    const route = created.body.route;
    assert.equal(route.plan.weekly_plan_source, "milestone_fallback");
    assert.equal(route.plan.validation_warnings.some((warning) => warning.code === "PLAN_PHASE_UNSCHEDULED_CAPACITY"), false);
    assert.equal(route.feasibility.total_available_hours, 120);
    assert.equal(route.feasibility.planned_hours, 120);
    assert.notEqual(route.feasibility.status, "needs_adjustment");

    const confirmed = await jsonRequest(baseUrl, `/api/v1/learning-routes/${route.id}/confirm`, {
      method: "POST",
      headers: { Authorization: "Bearer dev-user-001-token", "Idempotency-Key": "route-equal-confirm-0001" },
      body: JSON.stringify({ request_id: "bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc", expected_version: route.version }),
    });
    assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.route.status, "confirmed");
  } finally {
    await close(server);
  }
});

test("malformed generated task text uses the safe schedule instead of becoming a user 422", async () => {
  const provider = {
    async complete() {
      const schedule = weeklyPlan("2026-09-18", 10, { dailyMinutes: 25 });
      schedule[0].action = "x".repeat(601);
      return {
        source_type: "ai_assisted",
        text: JSON.stringify({
          summary: "按阶段目标安排学习，并用每周反馈调整节奏。",
          assumptions: ["按每周 10 小时安排。"],
          facts_to_confirm: ["核对阶段产出是否符合当前目标。"],
          milestones: [
            { title: "基础学习阶段", start_date: "2026-09-18", end_date: "2026-10-29", planned_hours: 60, outcomes: ["留下基础学习记录"] },
            { title: "项目巩固阶段", start_date: "2026-10-30", end_date: "2026-12-10", planned_hours: 60, outcomes: ["完成阶段复盘"] },
          ],
          weekly_plan: schedule,
        }),
      };
    },
  };
  const { server } = createBackendServer({ provider, aiEnabled: true, clock: () => Date.parse("2026-09-18T00:00:00.000Z") });
  const baseUrl = await listen(server);
  try {
    const created = await jsonRequest(baseUrl, "/api/v1/learning-routes", {
      method: "POST",
      headers: { Authorization: "Bearer dev-user-001-token", "Idempotency-Key": "route-invalid-task-text-0001" },
      body: JSON.stringify({
        request_id: "abababab-abab-4bab-8bab-abababababac",
        goal_type: "personal_growth",
        goal_name: "Python 项目练习",
        target_date: "2026-12-10",
        weekly_hours: 10,
        daily_minutes: 25,
        baseline: "starting",
        focus_areas: ["Python 项目"],
        constraints: ["工作日晚上学习"],
      }),
    });
    assert.equal(created.response.status, 200, JSON.stringify(created.body));
    assert.equal(created.body.status, "draft");
    assert.equal(created.body.route.plan.weekly_plan_source, "milestone_fallback");
    assert.equal(created.body.route.feasibility.total_available_hours, 120);
    assert.equal(created.body.route.feasibility.planned_hours, 120);

    const route = created.body.route;
    const confirmed = await jsonRequest(baseUrl, `/api/v1/learning-routes/${route.id}/confirm`, {
      method: "POST",
      headers: { Authorization: "Bearer dev-user-001-token", "Idempotency-Key": "route-invalid-task-confirm-0001" },
      body: JSON.stringify({ request_id: "bcbcbcbc-abab-4bcb-8bcb-bcbcbcbcbcbd", expected_version: route.version }),
    });
    assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.route.status, "confirmed");
  } finally {
    await close(server);
  }
});

test("a failed route completion is reflected by the next health response", async () => {
  const provider = {
    async healthCheck() { return { status: "available", reason_code: null }; },
    async complete() { throw new Error("upstream completion failed"); },
  };
  const { server } = createBackendServer({ provider, aiEnabled: true });
  const baseUrl = await listen(server);
  try {
    const before = await jsonRequest(baseUrl, "/api/v1/health");
    assert.equal(before.body.ai_available, true);

    const failed = await jsonRequest(baseUrl, "/api/v1/learning-routes", {
      method: "POST",
      headers: { Authorization: "Bearer dev-user-001-token", "Idempotency-Key": "route-health-fail-0001" },
      body: JSON.stringify({
        request_id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
        goal_type: "personal_growth",
        goal_name: "Python 项目练习",
        target_date: "2026-10-31",
        weekly_hours: 5,
        daily_minutes: 45,
        baseline: "starting",
        focus_areas: ["Python"],
        constraints: ["工作日晚上学习"],
      }),
    });
    assert.equal(failed.response.status, 200, JSON.stringify(failed.body));
    assert.equal(failed.body.status, "degraded");

    const after = await jsonRequest(baseUrl, "/api/v1/health");
    assert.equal(after.body.ai_available, false);
    assert.equal(after.body.ai_status, "unavailable");
    assert.equal(after.body.status, "degraded");
  } finally {
    await close(server);
  }
});

test("an unverified resource in the generated week falls back to a grounded milestone schedule", async () => {
  const { server } = createBackendServer({
    provider: {
      async complete(request) {
        const prompt = JSON.parse(request.input);
        const schedule = weeklyPlan(prompt.week_dates[0], prompt.learner.weekly_hours);
        schedule[0].resource_source_id = "resource-invented-by-model";
        return {
          source_type: "ai_assisted",
          text: JSON.stringify({
            summary: "按已收录来源开始学习。",
            assumptions: ["按每周 5 小时安排。"],
            facts_to_confirm: ["核对目标范围。"],
            milestones: [
              { title: "基础学习", start_date: "2026-09-18", end_date: "2026-10-10", planned_hours: 5, outcomes: ["留下章节笔记"] },
              { title: "应用复盘", start_date: "2026-10-11", end_date: "2026-10-31", planned_hours: 5, outcomes: ["完成一次应用复盘"] },
            ],
            weekly_plan: schedule,
          }),
        };
      },
    },
    aiEnabled: true,
    clock: () => Date.parse("2026-09-18T12:00:00.000Z"),
  });
  const baseUrl = await listen(server);
  try {
    const result = await jsonRequest(baseUrl, "/api/v1/learning-routes", {
      method: "POST",
      headers: { Authorization: "Bearer dev-user-001-token", "Idempotency-Key": "route-fake-resource-0001" },
      body: JSON.stringify({
        request_id: "45454545-4545-4454-8454-454545454545",
        goal_type: "personal_growth",
        goal_name: "Python 项目实践",
        target_date: "2026-10-31",
        weekly_hours: 5,
        baseline: "starting",
        focus_areas: ["Python 项目"],
      }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.status, "draft");
    assert.equal(result.body.route.plan.weekly_plan_source, "milestone_fallback");
    assert.match(result.body.route.plan.generation_notice, /未引用未核验题库/);
    assert.equal(result.body.route.plan.weekly_tasks.length, 7);
    assert.ok(result.body.route.plan.weekly_tasks.every((task) => task.practice.count === 0));
    assert.ok(result.body.route.plan.weekly_tasks.every((task) => task.resource?.source_id !== "resource-invented-by-model"));
  } finally {
    await close(server);
  }
});

test("seven daily self-reports persist and shape the next cycle without proving study activity", async () => {
  let clock = Date.parse("2026-09-27T12:00:00.000Z");
  let nextPrompt = null;
  const provider = {
    async complete(request) {
      const prompt = JSON.parse(request.input);
      const nextCycle = prompt.task === "根据执行反馈生成下一周期";
      if (nextCycle) {
        nextPrompt = prompt;
        assert.equal(prompt.previous_week_self_reports.length, 7);
        assert.equal(prompt.previous_week_self_reports[0].note, "今天只能学 18 分钟，先缩小范围");
      }
      const weekDates = prompt.week_dates;
      const weeklyHours = nextCycle ? prompt.goal.weekly_hours : prompt.learner.weekly_hours;
      const requestedDailyMinutes = nextCycle ? prompt.goal.daily_minutes : prompt.learner.daily_minutes;
      const schedule = weeklyPlan(weekDates[0], weeklyHours, { dailyMinutes: requestedDailyMinutes ?? undefined }).map((task, index) => ({
        ...task,
        date: weekDates[index],
        resource_source_id: prompt.resource_candidates[0]?.id ?? null,
        topic: nextCycle && index === 0 ? "依据自述卡点缩小本周范围" : task.topic,
      }));
      const content = nextCycle
        ? { weekly_plan: schedule }
        : {
          summary: "按可用时间推进，并根据自述反馈调整下一周期。",
          assumptions: ["按每周 7 小时安排。"],
          facts_to_confirm: ["核对 Python 学习目标范围。"],
          milestones: [
          { title: "基础与项目准备", start_date: "2026-09-27", end_date: "2026-10-17", planned_hours: 5, outcomes: ["留下范围清单和笔记"] },
          { title: "项目应用与复盘", start_date: "2026-10-18", end_date: "2026-10-31", planned_hours: 8, outcomes: ["完成可运行的小项目"] },
          ],
          weekly_plan: schedule,
        };
      return { source_type: "ai_assisted", text: JSON.stringify(content) };
    },
  };
  const { server } = createBackendServer({ provider, aiEnabled: true, clock: () => clock, policy: { maxBurstRequests: 40 } });
  const baseUrl = await listen(server);
  const auth = { Authorization: "Bearer dev-user-001-token" };
  try {
    const created = await jsonRequest(baseUrl, "/api/v1/learning-routes", {
      method: "POST",
      headers: { ...auth, "Idempotency-Key": "route-weekly-cycle-0001" },
      body: JSON.stringify({
        request_id: "56565656-5656-4565-8565-565656565656",
        goal_type: "personal_growth",
        goal_name: "Python 项目实践",
        target_date: "2026-10-31",
        weekly_hours: 7,
        daily_minutes: 60,
        baseline: "starting",
        focus_areas: ["Python 项目"],
      }),
    });
    assert.equal(created.response.status, 200, JSON.stringify(created.body));
    const firstRoute = created.body.route;
    assert.equal(firstRoute.plan.weekly_tasks.length, 7);
    assert.deepEqual(firstRoute.plan.weekly_tasks.map((task) => task.date), Array.from({ length: 7 }, (_, index) => addDays("2026-09-27", index)));

    const confirmed = await jsonRequest(baseUrl, `/api/v1/learning-routes/${firstRoute.id}/confirm`, {
      method: "POST",
      headers: { ...auth, "Idempotency-Key": "route-weekly-confirm-0001" },
      body: JSON.stringify({ request_id: "67676767-6767-4676-8676-676767676767", expected_version: firstRoute.version }),
    });
    assert.equal(confirmed.response.status, 200);

    const tooEarly = await jsonRequest(baseUrl, `/api/v1/learning-routes/${firstRoute.id}/refresh`, {
      method: "POST",
      headers: { ...auth, "Idempotency-Key": "route-weekly-future-0001" },
      body: JSON.stringify({
        request_id: "78787878-7878-4787-8787-787878787878",
        expected_version: confirmed.body.route.version,
        task_feedbacks: [{ task_id: firstRoute.plan.weekly_tasks[1].id, status: "completed" }],
      }),
    });
    assert.equal(tooEarly.response.status, 422);

    let version = confirmed.body.route.version;
    for (let index = 0; index < firstRoute.plan.weekly_tasks.length; index += 1) {
      const task = firstRoute.plan.weekly_tasks[index];
      clock = Date.parse(`${task.date}T12:00:00.000Z`);
      const feedback = {
        task_id: task.id,
        status: index === 0 ? "partial" : index === 2 ? "not_started" : "completed",
        actual_minutes: index === 0 ? 18 : index === 2 ? 0 : 35,
        note: index === 0 ? "今天只能学 18 分钟，先缩小范围" : "",
      };
      const result = await jsonRequest(baseUrl, `/api/v1/learning-routes/${firstRoute.id}/refresh`, {
        method: "POST",
        headers: { ...auth, "Idempotency-Key": `route-weekly-feedback-${index}-0001` },
        body: JSON.stringify({
          request_id: `89898989-8989-4898-8898-00000000000${index}`,
          expected_version: version,
          task_feedbacks: [feedback],
        }),
      });
      assert.equal(result.response.status, 200);
      version = result.body.route.version;
    }

    const saved = await jsonRequest(baseUrl, "/api/v1/learning-routes", { headers: auth });
    assert.equal(saved.response.status, 200);
    assert.equal(saved.body.route.plan.weekly_tasks.filter((task) => task.feedback?.status).length, 7);
    assert.equal(saved.body.route.plan.weekly_tasks[0].feedback.note, "今天只能学 18 分钟，先缩小范围");

    clock = Date.parse("2026-10-03T12:00:00.000Z");
    const advanced = await jsonRequest(baseUrl, `/api/v1/learning-routes/${firstRoute.id}/refresh`, {
      method: "POST",
      headers: { ...auth, "Idempotency-Key": "route-weekly-advance-0001" },
      body: JSON.stringify({
        request_id: "90909090-9090-4909-8909-909090909090",
        expected_version: version,
        advance_week: true,
      }),
    });
    assert.equal(advanced.response.status, 200, JSON.stringify(advanced.body));
    assert.ok(nextPrompt);
    assert.equal(advanced.body.route.plan.weekly_tasks.length, 7);
    assert.equal(advanced.body.route.plan.weekly_tasks[0].date, "2026-10-04");
    assert.match(advanced.body.route.plan.weekly_tasks[0].topic, /依据自述卡点/);
    assert.equal(advanced.body.route.plan.weekly_tasks[0].feedback, null);
  } finally {
    await close(server);
  }
});

test("plan generation preserves a continuous seven-day executable schedule within time limits", () => {
  const input = { goal_type: "personal_growth", target_date: "2026-09-30", weekly_hours: 10, daily_minutes: 120 };
  const milestones = [
    { title: "基础建立", start_date: "2026-09-18", end_date: "2026-09-24", planned_hours: 8, outcomes: ["留下一个可复查的基础产出"] },
    { title: "独立应用", start_date: "2026-09-25", end_date: "2026-09-30", planned_hours: 8, outcomes: ["完成一次独立应用并复盘"] },
  ];
  const plan = buildPlanHierarchy({ input, milestones, weeklyPlan: parsedWeeklyPlan("2026-09-18", 10, 120), today: "2026-09-18", summary: "按阶段留下可复查产出。", clock: () => Date.parse("2026-09-18T00:00:00.000Z") });
  const validation = validatePlan({ plan, milestones, input, today: "2026-09-18" });
  const tasks = flattenTasks(plan);
  assert.equal(plan.daily_minutes, 92);
  assert.equal(plan.today.tasks.length, 1);
  assert.equal(plan.today.tasks[0].date, "2026-09-18");
  assert.equal(tasks.length, 7);
  assert.deepEqual(plan.weekly_tasks.map((task) => task.date), Array.from({ length: 7 }, (_, index) => addDays("2026-09-18", index)));
  assert.ok(tasks.every((task) => task.date >= "2026-09-18" && task.date <= "2026-09-24"));
  assert.ok(tasks.every((task) => task.topic && task.action && task.expected_output && task.planned_minutes <= (task.date.endsWith("20") ? 46 : plan.daily_minutes)));
  assert.ok(tasks.reduce((sum, task) => sum + task.planned_minutes, 0) <= 480);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  const broken = structuredClone(plan);
  broken.today.tasks = [tasks.find((task) => task.date > "2026-09-18")];
  const brokenValidation = validatePlan({ plan: broken, milestones, input, today: "2026-09-18" });
  assert.ok(brokenValidation.errors.some((error) => error.code === "PLAN_TODAY_CONTAINS_FUTURE_TASK"));
});

test("practice quantity is linked to a reviewed existing source and unreviewed links are excluded", () => {
  const source = {
    id: "resource-curated-paper-bank",
    source_id: "curated-paper-bank",
    title: "2024 年真题集",
    url: "https://example.org/papers",
    kind: "practice",
    publisher: "测试题库",
    excerpt: "按年份组织的现成试题范围",
    duration_minutes: null,
  };
  const unreviewed = resourceCandidatesFor([], {
    results: [{ title: "未审核课程", content: "视频", source_links: ["https://example.org/unreviewed"], provenance: { review_status: "unreviewed" } }],
  });
  assert.equal(unreviewed.length, 0);

  const reviewed = resourceCandidatesFor([], {
    results: [{
      title: "2024 年真题集",
      content: "已审核题库链接。",
      source_links: [source.url],
      source: { id: source.source_id, title: source.title, publisher: source.publisher },
      provenance: { review_status: "reviewed" },
    }],
  });
  assert.equal(reviewed.length, 1);
  assert.equal(reviewed[0].kind, "practice");

  const dates = Array.from({ length: 7 }, (_, index) => addDays("2026-09-18", index));
  const schedule = weeklyPlan("2026-09-18", 5, { practiceSourceId: reviewed[0].id, practiceCount: 2 });
  const parsed = parseWeeklyPlan(schedule, {
    weekDates: dates,
    resources: reviewed,
    input: { weekly_hours: 5, daily_minutes: 46 },
    dailyMinutes: 46,
  });
  assert.equal(parsed[0].practice.count, 2);
  assert.equal(parsed[0].practice.source.url, source.url);
  assert.equal(parsed[0].practice.scope, schedule[0].practice_scope);
  const inventedSchedule = structuredClone(schedule);
  inventedSchedule[0].practice_source_id = "resource-model-invented";
  assert.throws(() => parseWeeklyPlan(inventedSchedule, {
    weekDates: dates,
    resources: reviewed,
    input: { weekly_hours: 5, daily_minutes: 46 },
    dailyMinutes: 46,
  }));

  const officialReference = resourceCandidatesFor([{
    id: "official-study-outline",
    title: "官方学习大纲与章节目录",
    official_url: "https://example.org/official-outline",
    publisher: "官方来源",
    use_for: "核对学习范围、章节与知识结构",
  }], {});
  const withoutDirectCourse = weeklyPlan("2026-09-18", 5);
  const plannedWithFallback = parseWeeklyPlan(withoutDirectCourse, {
    weekDates: dates,
    resources: officialReference,
    input: { weekly_hours: 5, daily_minutes: 46 },
    dailyMinutes: 46,
  });
  assert.equal(plannedWithFallback[0].resource.url, "https://example.org/official-outline");
  assert.match(plannedWithFallback[0].resource.excerpt, /章节与知识结构/);
});

test("CET goals retain official source grounding and the model-provided schedule", () => {
  assert.equal(GOAL_TYPES.includes("college_english_exam"), true);
  assert.equal(SOURCE_REGISTRY.some((source) => source.id === "cet-official-paper-structure"), true);
  const input = { goal_type: "college_english_exam", target_date: "2026-10-20", weekly_hours: 24, daily_minutes: 60 };
  const milestones = [{ title: "CET 四项能力训练", start_date: "2026-09-18", end_date: "2026-10-20", planned_hours: 100, outcomes: ["完成一轮CET四项练习并记录错因"] }];
  const schedule = parsedWeeklyPlan("2026-09-18", 24, 60);
  schedule[0].topic = "听力理解：按现成真题来源精听一段材料";
  const plan = buildPlanHierarchy({ input, milestones, weeklyPlan: schedule, today: "2026-09-18", summary: "按审核资料和现成练习安排。", clock: () => Date.parse("2026-09-18T00:00:00.000Z") });
  assert.equal(plan.weekly_tasks.length, 7);
  assert.equal(plan.weekly_tasks[0].topic, schedule[0].topic);
});

test("practice counts require an existing named source and the schedule builder creates no questions", () => {
  const input = { goal_type: "college_english_exam", target_date: "2026-10-20", weekly_hours: 24, daily_minutes: 60 };
  const milestones = [{ title: "CET 四项能力训练", start_date: "2026-09-18", end_date: "2026-10-20", planned_hours: 100, outcomes: ["按公开来源完成学习"] }];
  const schedule = weeklyPlan("2026-09-18", 24, { practiceSourceId: "resource-1", practiceCount: 2 });
  const practiceSource = { source_id: "cet-practice", title: "已收录 CET 历年真题", url: "https://example.org/cet-papers", kind: "practice", publisher: "公开题库", duration_minutes: null, excerpt: "历年真题下载与练习", locator: "2024 年真题", verification_status: "catalogued" };
  schedule[0].practice_source_id = "resource-1";
  const parsedTasks = schedule.map((task) => ({ ...task, practice: { count: task.practice_count, source: practiceSource, scope: task.practice_scope }, resource: null }));
  const plan = buildPlanHierarchy({ input, milestones, weeklyPlan: parsedTasks, today: "2026-09-18", summary: "按现成资料学习。", clock: () => Date.parse("2026-09-18T00:00:00.000Z") });
  assert.equal(plan.weekly_tasks[0].practice.count, 2);
  assert.equal(plan.weekly_tasks[0].practice.source.url, practiceSource.url);
  assert.doesNotMatch(JSON.stringify(plan.weekly_tasks), /question_text|generated_question|题干/);
});

test("extreme daily inputs never overrun the declared weekly capacity", () => {
  for (const [weeklyHours, dailyMinutes] of [[1, 30], [2, 120], [10, 600], [60, 900]]) {
    const input = { goal_type: "personal_growth", target_date: "2026-10-31", weekly_hours: weeklyHours, daily_minutes: dailyMinutes };
    const milestones = [{ title: "压力测试阶段", start_date: "2026-09-18", end_date: "2026-10-31", planned_hours: 20, outcomes: ["完成一个可复查的小成果"] }];
    const plan = buildPlanHierarchy({ input, milestones, weeklyPlan: parsedWeeklyPlan("2026-09-18", weeklyHours, dailyMinutes), today: "2026-09-18", summary: "压力测试", clock: () => Date.parse("2026-09-18T00:00:00.000Z") });
    const validation = validatePlan({ plan, milestones, input, today: "2026-09-18" });
    assert.equal(validation.ok, true, `weekly=${weeklyHours}, daily=${dailyMinutes}`);
    assert.ok(flattenTasks(plan).every((task) => task.planned_minutes >= 5));
    assert.ok(plan.daily_minutes <= Math.floor((weeklyHours * 60) / 6.5));
  }
});

test("assistant output is normalized before it reaches the client", () => {
  const routeLike = JSON.stringify({ summary: "路线草案", milestones: [{ title: "阶段" }] });
  const normalized = normalizeAssistantResponse(routeLike);
  const parsed = parseAssistantResponse(normalized);
  assert.equal(parsed.type, "answer");
  assert.match(parsed.message, /路线草案/);
  assert.equal(Object.hasOwn(parsed, "milestones"), false);
  const plain = parseAssistantResponse(normalizeAssistantResponse("先写出一个反例，再检查你的判断条件。"));
  assert.equal(plain.message, "先写出一个反例，再检查你的判断条件。");
});
