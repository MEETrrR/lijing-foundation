import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createBackendServer } = require("../../services/api/src/bootstrap/http-api.ts");
const { buildPlanHierarchy } = require("../../services/api/src/domains/learning-route/plan-builder.ts");
const { flattenTasks, validatePlan } = require("../../services/api/src/domains/learning-route/plan-validator.ts");
const { normalizeAssistantResponse, parseAssistantResponse } = require("../../services/api/src/domains/ai-gateway/assistant-response.ts");

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
    assert.equal(result.body.route.plan.today.tasks.length, 1);
  } finally {
    await close(server);
  }
});

test("plan generation enforces the weekly and today-task contract", () => {
  const input = { goal_type: "personal_growth", target_date: "2026-09-30", weekly_hours: 10, daily_minutes: 120 };
  const milestones = [
    { title: "基础建立", start_date: "2026-09-18", end_date: "2026-09-24", planned_hours: 8, outcomes: ["留下一个可复查的基础产出"] },
    { title: "独立应用", start_date: "2026-09-25", end_date: "2026-09-30", planned_hours: 8, outcomes: ["完成一次独立应用并复盘"] },
  ];
  const plan = buildPlanHierarchy({ input, milestones, today: "2026-09-18", summary: "按阶段留下可复查产出。", clock: () => Date.parse("2026-09-18T00:00:00.000Z") });
  const validation = validatePlan({ plan, milestones, input, today: "2026-09-18" });
  const tasks = flattenTasks(plan);
  assert.equal(plan.daily_minutes, 92);
  assert.equal(plan.today.tasks.length, 1);
  assert.equal(plan.today.tasks[0].date, "2026-09-18");
  assert.ok(tasks.every((task) => task.date >= "2026-09-18" && task.date <= "2026-09-30"));
  assert.equal(validation.ok, true);
  const broken = structuredClone(plan);
  broken.today.tasks = [tasks.find((task) => task.date > "2026-09-18")];
  const brokenValidation = validatePlan({ plan: broken, milestones, input, today: "2026-09-18" });
  assert.ok(brokenValidation.errors.some((error) => error.code === "PLAN_TODAY_CONTAINS_FUTURE_TASK"));
});

test("extreme daily inputs never overrun the declared weekly capacity", () => {
  for (const [weeklyHours, dailyMinutes] of [[1, 30], [2, 120], [10, 600], [60, 900]]) {
    const input = { goal_type: "personal_growth", target_date: "2026-10-31", weekly_hours: weeklyHours, daily_minutes: dailyMinutes };
    const milestones = [{ title: "压力测试阶段", start_date: "2026-09-18", end_date: "2026-10-31", planned_hours: 20, outcomes: ["完成一个可复查的小成果"] }];
    const plan = buildPlanHierarchy({ input, milestones, today: "2026-09-18", summary: "压力测试", clock: () => Date.parse("2026-09-18T00:00:00.000Z") });
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
