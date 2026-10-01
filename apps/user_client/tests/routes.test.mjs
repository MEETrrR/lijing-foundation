import test from "node:test";
import assert from "node:assert/strict";
import { FEATURE_ITEMS, NAV_ITEMS, ROUTES, getRouteMeta, normalizeRoute } from "../src/data/routes.js";
import { defaultRouteTargetDate, PAGE_RENDERERS, renderPage } from "../src/pages/index.js";
import { renderShell } from "../src/components/shell.js";
import { DEMO_STATE } from "../src/data/demo-data.js";
import { getAsset } from "../src/data/assets.js";
import { renderBaguaField } from "../src/components/bagua-field.js";
import { renderWorldStage } from "../src/components/world-stage.js";
import { readFile } from "node:fs/promises";

test("normalizes unknown paths to the real not-found route", () => {
  assert.equal(normalizeRoute("/missing"), "/404");
  assert.equal(normalizeRoute("/plan/"), "/plan");
});

test("covers every first-phase chapter in navigation metadata", () => {
  const routeKeys = new Set(Object.keys(ROUTES));
  for (const item of NAV_ITEMS) assert.equal(routeKeys.has(item.href), true);
  assert.equal(routeKeys.size >= 11, true);
  assert.equal(getRouteMeta("/study").chapter, "学习");
});

test("every product chapter has a real page renderer", () => {
  for (const route of Object.keys(ROUTES)) {
    assert.equal(typeof PAGE_RENDERERS[route], "function", `missing renderer for ${route}`);
    const html = renderPage(route, DEMO_STATE);
    assert.equal(html.includes("demo-state"), route !== "/state/loading", `unexpected demo state marker for ${route}`);
  }
});

test("CET workspace links to the supplied plan and never inserts original questions", () => {
  const state = structuredClone(DEMO_STATE);
  state.goals.forEach((goal) => { goal.selected = goal.id === "goal-cet4"; });
  const cet4 = renderPage("/cet", state);
  assert.match(cet4, /125 分钟/);
  assert.match(cet4, /教育考试院笔试说明/);
  assert.match(cet4, /不生成原创练习题/);
  assert.doesNotMatch(cet4, /data-cet-practice|data-cet-choice|A student is preparing/);
  assert.match(renderShell("/cet", state, cet4), /mobile-primary-nav--cet/);
  state.learningRoute = { draft: { goal: { type: "college_english_exam", name: "大学英语四级", timezone: "Asia/Shanghai" }, status: "confirmed", plan: { today: { tasks: [] }, weekly_tasks: [{ id: "cet-task-01", date: "2026-09-27", type: "学习", title: "听力材料结构", topic: "听力理解", action: "使用收录的真题音频练习", planned_minutes: 25, expected_output: "留下听力错因笔记", resource: null, resource_search_url: "https://search.bilibili.com/all?keyword=CET", practice: { count: 0, source: null, scope: "" } }] } } };
  const cetStudy = renderPage("/study", state);
  assert.match(cetStudy, /CET-4 · 今日安排/);
  assert.match(cetStudy, /听力材料结构/);
  assert.match(cetStudy, /B站站内搜索/);
  assert.doesNotMatch(cetStudy, /data-cet-choice|data-action="submit-evidence"|data-cet-practice|原创短练|A student is preparing/);

  state.goals.forEach((goal) => { goal.selected = goal.id === "goal-cet6"; });
  const cet6 = renderPage("/cet", state);
  assert.match(cet6, /130 分钟/);
  state.learningRoute = { draft: { goal: { type: "college_english_exam", name: "大学英语六级", timezone: "Asia/Shanghai" }, status: "confirmed", plan: { today: { tasks: [] }, weekly_tasks: [{ id: "cet-task-02", date: "2026-09-27", type: "学习", title: "六级阅读定位", topic: "阅读理解", action: "按已收录教材章节复习定位方法", planned_minutes: 30, expected_output: "留下一段阅读方法笔记", resource: { title: "官方资料", url: "https://cet.neea.edu.cn/html1/folder/16113/1586-1.htm", kind: "reference", publisher: "教育考试院", verification_status: "catalogued" }, practice: { count: 0, source: null, scope: "" } }] } } };
  const study = renderPage("/study", state);
  assert.match(study, /CET-6 · 今日安排/);
  assert.match(study, /六级阅读定位/);
  assert.match(study, /现成练习 0 项/);
  assert.doesNotMatch(study, /data-cet-choice|data-action="submit-evidence"|data-cet-practice|原创短练|A student is preparing/);
});

test("the seven-day page presents sourced tasks, self-report fields and a printable plan copy", () => {
  const state = structuredClone(DEMO_STATE);
  state.isDemo = false;
  const selected = state.goals.find((goal) => !["goal-cet4", "goal-cet6"].includes(goal.id));
  state.goals.forEach((goal) => { goal.selected = goal === selected; });
  const start = "2026-09-27";
  const tasks = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.parse(`${start}T00:00:00.000Z`) + index * 86400000).toISOString().slice(0, 10);
    return {
      id: `plan-day-${date}`,
      date,
      type: index === 6 ? "复盘" : "学习",
      title: `第 ${index + 1} 天 · 数学基础`,
      topic: `极限与连续 · ${index + 1}`,
      action: "阅读指定章节并整理三个关键概念。",
      planned_minutes: 35,
      expected_output: "一段不看资料的概念复述。",
      milestone_title: "基础阶段",
      resource: index === 0 ? { source_id: "curated-source", title: "已收录教材与课程来源", url: "https://example.org/course", kind: "course", publisher: "测试来源", duration_minutes: 42, excerpt: "公开课程目录", locator: "第 1 章", verification_status: "catalogued" } : null,
      resource_search_url: "https://search.bilibili.com/all?keyword=limit",
      practice: index === 0 ? { count: 2, source: { source_id: "curated-papers", title: "已收录真题来源", url: "https://example.org/papers", kind: "practice", publisher: "测试题库", duration_minutes: null, excerpt: "历年试题", locator: "2024 年第 1-2 题", verification_status: "catalogued" }, scope: "2024 年第 1-2 题" } : { count: 0, source: null, scope: "" },
      feedback: index === 0 ? { status: "partial", actual_minutes: 20, note: "时间不足", reported_at: "2026-09-27T12:00:00.000Z" } : null,
    };
  });
  state.learningRoute = {
    draft: {
      id: "route-11111111-1111-4111-8111-111111111111",
      version: 2,
      status: "confirmed",
      goal: { type: "postgraduate_entrance_exam", name: "计算机专业考研", timezone: "Asia/Shanghai", weekly_hours: 7 },
      summary: "按可用时间推进数学基础。",
      plan: { daily_minutes: 45, weekly_hours: 7, cycle_start_date: start, cycle_end_date: tasks.at(-1).date, weekly_tasks: tasks, today: { date: start, tasks: [tasks[0]] }, current_year: null, horizon: { years: [] } },
    },
  };

  const html = renderPage("/plan", state);
  assert.equal((html.match(/data-plan-day=/g) ?? []).length, 7);
  assert.equal((html.match(/data-demo-form="learning-plan-feedback"/g) ?? []).length, 7);
  assert.match(html, /data-action="export-learning-plan"/);
  assert.match(html, /打印 \/ 保存 PDF/);
  assert.match(html, /2024 年第 1-2 题/);
  assert.match(html, /href="https:\/\/example\.org\/course"/);
  assert.match(html, /B站站内搜索/);
  assert.match(html, /name="actual_minutes"/);
  assert.match(html, /value=\"\" selected disabled>请选择/);
  assert.match(html, /name="note"/);
  assert.match(html, /□ 今日完成/);
  assert.match(html, /手写备注/);
  assert.match(html, /不代表平台验证了真实学习结果/);
  assert.doesNotMatch(html, /data-cet-choice|生成诊断题/);
});

test("auth chapter exposes real login and registration forms", () => {
  const state = structuredClone(DEMO_STATE);
  state.auth = { user: null, mode: "register" };
  const html = renderPage("/auth", state);
  assert.equal(getAsset("lijing-auth-gate-v1")?.path, "/assets/generated/source/auth/lijing-auth-gate-v1.png");
  assert.match(html, /auth\/lijing-auth-gate-v1\.png/);
  assert.match(html, /class="auth-backdrop"/);
  assert.match(html, /data-demo-form="auth" data-auth-mode="register"/);
  assert.match(html, /name="email"/);
  assert.match(html, /name="display_name"/);
  assert.match(html, /class="auth-error" data-auth-error role="alert" aria-live="assertive" hidden/);
  assert.doesNotMatch(html, /name="invite_code"/);
  assert.match(html, /data-action="auth-mode" data-auth-mode="login"/);
  assert.match(html, /砺境帮助你制定目标、生成学习计划，并用学习证据生成下一步。/);
  assert.match(html, /正在核验数据保存方式/);
  assert.match(html, /公开测试版/);
  assert.match(html, /创建账号/);

  state.registrationPolicy = { invitationRequired: true, registrationOpen: true, loaded: true };
  const inviteHtml = renderPage("/auth", state);
  assert.match(inviteHtml, /限量邀请码试点/);
  assert.match(inviteHtml, /name="invite_code"/);
  assert.match(inviteHtml, /邀请码只能使用一次/);

  state.auth.mode = "login";
  const loginHtml = renderPage("/auth", state);
  assert.match(loginHtml, /登录并继续/);
  assert.match(loginHtml, /当前试点尚未接入邮件验证/);
  assert.match(loginHtml, /class="auth-error" data-auth-error role="alert" aria-live="assertive" hidden/);
  assert.match(loginHtml, /class="auth-recovery-link" type="button" disabled aria-disabled="true">忘记密码（暂未开放）/);
  assert.doesNotMatch(loginHtml, /data-action="forgot-password"/);
});

test("client keeps an already-loaded pilot invitation policy while resetting an anonymous session", async () => {
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /registrationPolicy:\s*\{\s*\.\.\.DEMO_STATE\.registrationPolicy\s*\}/);
});

test("protected routes wait for session recovery and legacy links have canonical destinations", async () => {
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /sessionPending\s*\n?\s*\?\s*"\/state\/loading"/);
  assert.doesNotMatch(source, /sessionPending\s*\n?\s*\?\s*"\/auth"/);
  assert.match(source, /LEGACY_ROUTE_REDIRECTS/);
  assert.match(source, /\["\/plan", "\/"\]/);
  assert.match(source, /\["\/profile", "\/settings"\]/);
});

test("anonymous bootstrap rerenders preserve auth drafts and pending submissions", async () => {
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /new FormData\(previousAuthForm\)/);
  assert.match(source, /authFormSnapshot\?\.mode === currentAuthForm\.dataset\.authMode/);
  assert.match(source, /authFormSnapshot\.submitting/);
  assert.match(source, /restoredAuthFocus/);
  assert.match(source, /currentForm\.dataset\.submitting = "false"/);
});

test("account bootstrap renders after user state and restores secondary data in parallel", async () => {
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const start = source.indexOf("const syncAuthenticatedAccount");
  const end = source.indexOf("const syncAdminOverview", start);
  const bootstrap = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(bootstrap.indexOf("await syncUserState()") < bootstrap.indexOf("onPrimaryStateReady?.()"));
  assert.ok(bootstrap.indexOf("onPrimaryStateReady?.()") < bootstrap.indexOf("await Promise.all(["));
  assert.match(bootstrap, /syncLearningRoute\(\)/);
  assert.match(source, /syncStatus:\s*"loading"/);
});

test("route recovery never offers route creation before sync succeeds", () => {
  const state = structuredClone(DEMO_STATE);
  state.isDemo = false;
  state.learningRoute = { ...state.learningRoute, syncStatus: "loading" };
  const loading = renderPage("/route", state);
  assert.match(loading, /正在读取你的已保存计划/);
  assert.doesNotMatch(loading, /data-demo-form="learning-route"/);

  state.learningRoute.syncStatus = "error";
  const failed = renderPage("/route", state);
  assert.match(failed, /没有创建或覆盖任何计划/);
  assert.match(failed, /data-action="retry-route-sync"/);
  assert.doesNotMatch(failed, /data-demo-form="learning-route"/);
});

test("unknown pages expose a recoverable 404 surface", () => {
  const html = renderPage("/404", DEMO_STATE);
  assert.match(html, /404/);
  assert.match(html, /地址可能写错了/);
  assert.match(html, /data-route="\/"/);
});

test("public legal pages are reachable before authentication and state their pilot limits", () => {
  for (const route of ["/privacy", "/terms", "/contact"]) {
    const html = renderPage(route, DEMO_STATE);
    assert.match(html, /公开试点版/);
    assert.match(html, /当前/);
  }
  assert.match(renderPage("/privacy", DEMO_STATE), /尚未接入邮箱验证/);
  assert.match(renderPage("/contact", DEMO_STATE), /没有配置独立客服邮箱/);
});

test("home task content is escaped before it enters the HTML surface", () => {
  const state = structuredClone(DEMO_STATE);
  state.today = {
    ...state.today,
    tasks: [{ id: "task-xss", type: "练习", title: '<img src=x onerror="window.__xss=1">', meta: "可复查记录" , status: "active", gua: "☲" }],
    total: 1,
    completed: 0,
  };
  const html = renderPage("/", state);
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.match(html, /&lt;img src=x onerror=&quot;window\.__xss=1&quot;&gt;/);
});

test("profile settings always exposes the exit action in demo state", () => {
  const state = structuredClone(DEMO_STATE);
  state.auth = { user: null, mode: "login" };
  const html = renderPage("/profile", state);
  assert.match(html, /class="setting-row setting-row--danger" type="button" data-action="logout"/);
  assert.match(html, /<strong>退出山门<\/strong>/);
});

test("complete settings exposes account controls, editable profile, service status, and real feedback input", () => {
  const state = structuredClone(DEMO_STATE);
  state.auth = { user: { id: "user-1", email: "pilot@example.com", display_name: "试点行者", created_at: "2026-09-06T00:00:00.000Z" }, mode: "login" };
  state.isDemo = false;
  state.service = { api: "up", aiConfigured: true, persistence: "ephemeral" };
  const html = renderPage("/settings", state);
  assert.match(html, /data-demo-form="settings-profile"/);
  assert.match(html, /data-demo-form="feedback"/);
  assert.match(html, /data-action="switch-account" data-auth-mode="login"/);
  assert.match(html, /data-action="switch-account" data-auth-mode="register"/);
  assert.match(html, /data-action="logout"/);
  assert.doesNotMatch(html, /REAL INPUT/);
  assert.match(html, /AI 引路/);
  assert.match(html, /临时本地会话，服务重启后数据会清空/);
  assert.doesNotMatch(html, /刷新和换设备仍可恢复/);
  assert.match(html, /name="detail"/);

  const authHtml = renderPage("/auth", state);
  assert.match(authHtml, /当前为公开测试版/);
  assert.doesNotMatch(authHtml, /可跨重启恢复/);
});

test("settings keeps route constraints aligned and no longer binds dormant actions", async () => {
  const [appSource, pageSource, styleSource] = await Promise.all([
    readFile(new URL("../src/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/index.js", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(pageSource, /name="weeklyHours" type="number" min="1" max="60"/);
  assert.match(appSource, /routeNeedsRecalculation/);
  assert.match(appSource, /recalculateAndConfirmRoute/);
  assert.match(appSource, /当前路线会继续保留/);
  assert.doesNotMatch(appSource, /data-action="onboarding-back"|data-action="onboarding-feature-next"|data-action="answer"|data-action="submit-answer"/);
  assert.doesNotMatch(appSource, /requestLearningAttempt/);
  assert.doesNotMatch(styleSource, /onboarding-optional|route-form__grid/);
});

test("learning route starts with only the constraints that determine today's action", () => {
  const state = structuredClone(DEMO_STATE);
  state.isDemo = false;
  state.learningRoute = { draft: null, error: "" };
  const emptyHtml = renderPage("/route", state);
  assert.match(emptyHtml, /data-demo-form="learning-route"/);
  assert.match(emptyHtml, /路线 · 只核对会影响今天的两件事/);
  assert.match(emptyHtml, /当前目标路线 · 第 2 步/);
  assert.match(emptyHtml, /name="target_date"/);
  assert.match(emptyHtml, /name="weekly_hours"/);
  assert.match(emptyHtml, /data-route-hours/);
  assert.match(emptyHtml, /生成今天这一步/);
  assert.doesNotMatch(emptyHtml, /name="constraints"|name="assessment_subject"|name="assessment_evidence"/);
  const failedState = structuredClone(state);
  failedState.learningRoute.error = "AI 服务暂时不可用，请稍后再试";
  const failedHtml = renderPage("/route", failedState);
  assert.match(failedHtml, /role="alert" aria-live="assertive">AI 服务暂时不可用/);
  assert.match(failedHtml, /重新生成今天这一步/);

  state.learningRoute.draft = {
    id: "route-11111111-1111-4111-8111-111111111111",
    version: 1,
    status: "draft",
    goal: {
      name: "计算机专业硕士复习", type: "postgraduate_entrance_exam", target_date: "2026-12-20", baseline: "foundation", region: "江西", constraints: [], focus_areas: ["数学"],
      baseline_assessment: { subject: "数学二", study_stage: "reviewed_once", recent_result: "between_40_69", primary_blocker: "concept", evidence: "最近做分段函数极限题时，不确定该先判断哪一段。" },
    },
    summary: "以阶段产出推进。",
    assumptions: ["每周 10 小时。"],
    facts_to_confirm: ["核验当年专业目录。"],
    milestones: [{ title: "基础诊断", start_date: "2026-09-07", end_date: "2026-10-01", planned_hours: 20, outcomes: ["留下诊断记录"] }, { title: "阶段回望", start_date: "2026-10-02", end_date: "2026-12-01", planned_hours: 40, outcomes: ["留下学习证据"] }],
    plan: { daily_minutes: 25, current_year: { months: [{ month: "2026-09", title: "基础诊断" }] }, today: { date: "2026-09-08", tasks: [{ title: "基础诊断 · 建立框架", planned_minutes: 25, action: "整理知识边界" }] } },
    feasibility: { status: "feasible", days_remaining: 105, weekly_hours: 10, total_available_hours: 150, protected_capacity_hours: 120, planned_hours: 60, buffer_percent: 20, message: "可确认。" },
    sources: [{ id: "chsi-postgraduate-directory", goal_type: "postgraduate_entrance_exam", title: "中国研究生招生信息网", publisher: "教育部学生服务与素质发展中心", official_url: "https://yz.chsi.com.cn/", use_for: "专业目录", freshness: "annual", region_scope: "全国" }],
    source_registry_version: "2026-09-06.1",
    knowledge_evidence: [{ chunk_id: "pg-directory-verification", source_id: "chsi-postgraduate-directory", title: "考研院校、专业目录与报名信息", content: "涉及目标院校时核对当年页面。", score: 1, source: { id: "chsi-postgraduate-directory", goal_type: "postgraduate_entrance_exam", title: "中国研究生招生信息网", publisher: "教育部学生服务与素质发展中心", official_url: "https://yz.chsi.com.cn/", use_for: "专业目录", freshness: "annual", region_scope: "全国" }, source_links: ["https://yz.chsi.com.cn/"], metadata: { claim_status: "conditional" }, provenance: { knowledge_index_version: "2026-09-06.rag-v2", review_status: "reviewed", region_scope: "全国", claim_status: "conditional", review_note: "年度目录需要复核。" } }],
    knowledge_index_version: "2026-09-06.rag-v2",
    knowledge_retrieved_at: "2026-09-06T00:00:00.000Z",
    personal_memory_scope: "goal-exam",
    personal_memory_refs: [],
    created_at: "2026-09-06T00:00:00.000Z",
    confirmed_at: null,
  };
  const draftHtml = renderPage("/route", state);
  assert.match(draftHtml, /确认前核验/);
  assert.match(draftHtml, /data-action="confirm-learning-route"/);
  assert.match(draftHtml, /中国研究生招生信息网/);
  assert.match(draftHtml, /正在准备/);
  assert.match(draftHtml, /起点信息 · 学习者自述/);
  assert.match(draftHtml, /数学二/);
  assert.match(draftHtml, /无需先答诊断题/);
  assert.match(draftHtml, /data-demo-form="learning-route-adjustment"/);
  assert.match(draftHtml, /重新计算路线/);
  assert.doesNotMatch(draftHtml, /route-plan-preview/);
  assert.doesNotMatch(draftHtml, /update_reason/);

  state.learningRoute.draft = { ...state.learningRoute.draft, status: "confirmed" };
  const confirmedHtml = renderPage("/route", state);
  assert.match(confirmedHtml, /已确认路线/);
  assert.match(confirmedHtml, /今日行动/);
  assert.match(confirmedHtml, /data-demo-form="learning-route-adjustment"/);
  assert.doesNotMatch(confirmedHtml, /data-action="confirm-learning-route"/);

  state.learningRoute.draft = { ...state.learningRoute.draft, status: "draft", feasibility: { ...state.learningRoute.draft.feasibility, status: "tight", message: "计划接近可用时长。" } };
  const tightHtml = renderPage("/route", state);
  assert.match(tightHtml, /时间过紧/);
  assert.match(tightHtml, /data-action="confirm-learning-route"/);
  assert.match(tightHtml, /接受紧凑安排，开始今天这一步/);
});

test("first-visit onboarding asks only for goal and available time", () => {
  const state = structuredClone(DEMO_STATE);
  state.onboarding.step = 1;
  const profileHtml = renderPage("/onboarding", state);
  assert.equal(getAsset("lijing-onboarding-background-v2")?.path, "/assets/generated/source/onboarding/onboarding-background-v2.png");
  assert.doesNotMatch(profileHtml, /onboarding\/onboarding-background-v2\.png/);
  assert.match(profileHtml, /data-demo-form="onboarding-profile"/);
  assert.match(profileHtml, /入山引导 · 15 秒/);
  assert.match(profileHtml, /当前方向/);
  assert.match(profileHtml, /data-onboarding-selected-detail/);
  assert.match(profileHtml, /data-onboarding-minutes/);
  assert.match(profileHtml, /生成今天这一步/);
  assert.doesNotMatch(profileHtml, /name="school"|name="major"|name="age"|name="region"|开发中|补充更多资料/);
  assert.doesNotMatch(profileHtml, /继续选择书鼎/);

  state.onboarding.step = 2;
  const repeatedHtml = renderPage("/onboarding", state);
  assert.match(repeatedHtml, /入山引导 · 15 秒/);
  assert.match(repeatedHtml, /data-demo-form="onboarding-profile"/);
  assert.doesNotMatch(repeatedHtml, /第二步 · 建立路线/);
  assert.doesNotMatch(repeatedHtml, /开始补充路线条件|name="school"/);
});

test("onboarding summary matches the selected CET goal", () => {
  for (const [goalId, title, detail] of [
    ["goal-cet4", "大学英语四级", "按听力、阅读、写作和翻译安排每日练习"],
    ["goal-cet6", "大学英语六级", "按六级题型与当前基础安排每日练习"],
  ]) {
    const state = structuredClone(DEMO_STATE);
    state.onboarding.profile.target = goalId;
    const html = renderPage("/onboarding", state);
    assert.match(html, new RegExp(`<strong data-onboarding-selected-title>${title}</strong>`));
    assert.match(html, new RegExp(`<small data-onboarding-selected-detail>${detail}</small>`));
    assert.doesNotMatch(html, /首期只专注把考研拆成每天可执行的一步/);
  }
});

test("bagua is limited to actionable directory links and removed from review", () => {
  assert.equal(getAsset("bagua-ink-compass-v1")?.path, "/assets/generated/source/bagua-ink-compass-v1.png");
  const directoryHtml = renderPage("/features", DEMO_STATE);
  const reviewHtml = renderPage("/review", DEMO_STATE);
  assert.match(directoryHtml, /bagua-field/);
  assert.doesNotMatch(reviewHtml, /bagua-field|data-action="bagua-node"/);
  assert.doesNotMatch(renderPage("/goals", DEMO_STATE), /bagua-field|data-bagua=/);
  assert.equal((directoryHtml.match(/class="bagua-node /g) ?? []).length, 8);
  assert.equal(renderBaguaField(), "");
  assert.throws(() => renderBaguaField({ directoryItems: [{ direction: "north", label: "A" }, { direction: "north", label: "B" }] }), /重复方位/);
  assert.throws(() => renderBaguaField({ directoryItems: [{ direction: "unknown", label: "A" }] }), /未知方位/);
});

test("review chain uses real evidence and does not expose demo review to real accounts", () => {
  const state = structuredClone(DEMO_STATE);
  state.isDemo = false;
  state.pilot.submittedEvidence = "";
  state.pilot.reviewReady = false;
  state.pilot.reviewError = "";
  state.pilot.review = null;
  const emptyHtml = renderPage("/review", state);
  assert.match(emptyHtml, /data-demo-state="false"/);
  assert.match(emptyHtml, /class="review-chain"/);
  assert.match(emptyHtml, /证据怎样走到/);
  assert.match(emptyHtml, /待提交/);
  assert.match(emptyHtml, /本轮学习 · 尚无证据/);
  assert.match(emptyHtml, /提交学习证据后，这里会显示本轮复盘与下一步/);
  assert.doesNotMatch(emptyHtml, /本次结论基于 L2 级证据/);
  assert.ok(!emptyHtml.includes(DEMO_STATE.pilot.review.evidenceUsed));
  assert.ok(!emptyHtml.includes(DEMO_STATE.pilot.review.nextAction));

  state.pilot.submittedEvidence = "独立完成两道题，第二题还卡在边界判断。";
  const pendingHtml = renderPage("/review", state);
  assert.match(pendingHtml, /class="review-chain__status">待复盘/);
  assert.match(pendingHtml, /L2 · 已提交/);
  assert.ok(!pendingHtml.includes(DEMO_STATE.pilot.review.evidenceUsed));

  state.pilot.submittedEvidence = "独立完成两道题，第二题还卡在边界判断。";
  state.pilot.reviewReady = true;
  state.pilot.review = { evidenceUsed: "独立完成两道题", problem: "边界判断不稳", reason: "第二题的边界条件遗漏", nextAction: "明天用反例检验边界" };
  const completedHtml = renderPage("/review", state);
  assert.match(completedHtml, /L2 · 已提交/);
  assert.match(completedHtml, /AI 复盘/);
  assert.match(completedHtml, /明天用反例检验边界/);

  state.pilot.reviewReady = false;
  state.pilot.reviewError = "";
  const fallbackHtml = renderPage("/review", state);
  assert.match(fallbackHtml, /规则复盘/);
  assert.match(fallbackHtml, /行动型规则复盘/);
  assert.doesNotMatch(fallbackHtml, /行动型 AI 复盘/);
});

test("route generation makes a long AI wait explicit and removes the dormant initial diagnostic", async () => {
  const [appSource, pageSource] = await Promise.all([
    readFile(new URL("../src/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/index.js", import.meta.url), "utf8"),
  ]);
  assert.match(appSource, /ROUTE_GENERATION_TIMEOUT_MS = 90000/);
  assert.match(appSource, /正在匹配当前目标的起点与阶段/);
  assert.doesNotMatch(appSource, /正在匹配考研备考的起点与阶段/);
  assert.match(appSource, /路线仍在生成，通常需要 30 到 60 秒/);
  assert.match(appSource, /路线草案已生成，请核对后确认/);
  assert.doesNotMatch(appSource, /applyLearningRoute\(await confirmLearningRoute\(routeResult\.id, routeResult\.version\)\)/);
  assert.doesNotMatch(appSource, /initialDiagnostic|initial_diagnostic/);
  assert.doesNotMatch(pageSource, /initialDiagnostic|initial-diagnostic|data-diagnostic/);
});

test("evidence completion writes the knowledge ledger and candidate memory loop", async () => {
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /persistEvidenceKnowledge\(\{ state: DEMO_STATE, action: completedAction, evidence, evidenceLevel, persist: persistUserState \}\)/);
  assert.match(source, /requestMemoryIteration\(payload\)/);
  assert.match(source, /iteration_id: `iteration-\$\{action\.id\}`/);
  assert.match(source, /next_action: review\.nextAction/);
  assert.match(source, /const memorySaved = await recordEvidenceMemory/);
  assert.match(source, /记忆账本稍后同步/);
  assert.match(source, /await persistUserState\(\)/);
});

test("knowledge chapter defaults to a searchable directory", () => {
  const state = structuredClone(DEMO_STATE);
  state.isDemo = false;
  const html = renderPage("/knowledge", state);
  assert.match(html, /个人学习证据/);
  assert.match(html, /LEARNING EVIDENCE · LIBRARY/);
  assert.match(html, /data-knowledge-view="directory"/);
  assert.doesNotMatch(html, /个人复利知识关系网络|PERSONAL COMPOUND/);
  assert.doesNotMatch(html, /Agent 管理|知识库本体|控制配置|证据层/);
  assert.match(html, /学习目标/);
  assert.match(html, /学习材料/);
  assert.match(html, /data-demo-state="false"/);
  assert.doesNotMatch(html, /待接入/);
  assert.equal((html.match(/data-action="select-knowledge"/g) ?? []).length >= 6, true);
  assert.equal((html.match(/data-knowledge-item/g) ?? []).length >= 6, true);
  assert.match(html, /把这次理解接入知识库|我留下的理解/);
  assert.match(html, /搜索节点、来源或关键词/);
});

test("the initial shell has a visible boot state and a public favicon asset", async () => {
  const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const favicon = await readFile(new URL("../../../assets/generated/source/lijing-favicon.svg", import.meta.url), "utf8");
  assert.match(index, /<div id="app"><div class="boot-state"/);
  assert.match(index, /href="\/assets\/generated\/source\/lijing-favicon\.svg"/);
  assert.doesNotMatch(index, /\/apps\/user_client\/src\/favicon\.svg/);
  assert.match(favicon, /<svg[\s>]/);
});

test("onboarding selection and mobile action controls meet contrast and target-size requirements", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.onboarding-goal\.is-selected\s*\{[^}]*color:\s*var\(--ink\)[^}]*background:\s*var\(--gold-light\)/s);
  assert.match(css, /@media\s*\(pointer:\s*coarse\)[\s\S]*?min-height:\s*44px[\s\S]*?min-width:\s*44px/);
  assert.match(css, /\.auth-legal-links a\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.study-action__controls\s+\.button--outline[^}]*color:\s*var\(--ink\)/);
  assert.match(css, /\.study-action__controls\s+\.button--outline\s*\{[^}]*background:\s*var\(--paper\)/);
  assert.match(css, /@media\s*\(pointer:\s*coarse\)[\s\S]*?\.study-aside__tip a\s*\{[^}]*min-height:\s*44px/);
});

test("empty knowledge chapter offers a focused first action", () => {
  const state = structuredClone(DEMO_STATE);
  state.knowledge = [];
  state.activeKnowledgeId = "";
  const html = renderPage("/knowledge", state);
  assert.match(html, /这里还没有你的知识节点/);
  assert.match(html, /data-route="\/"/);
  assert.doesNotMatch(html, /0 个核心节点|0 条已知连接|data-action="knowledge-zoom"|L1 · 0%|待接入/);
  assert.doesNotMatch(html, /knowledge-network|knowledge-inspector/);
});

test("knowledge chapter shows submitted materials before the first evidence node exists", () => {
  const state = structuredClone(DEMO_STATE);
  state.knowledge = [];
  state.activeKnowledgeId = "";
  state.learningArtifacts = [{
    id: "artifact-first-note",
    kind: "note",
    subject: "408",
    source_title: "链表错因记录",
    content_text: "删除节点前先找到前驱节点。",
  }];
  state.companionCycle = { diagnosisSummary: { observations: [] } };

  const html = renderPage("/knowledge", state);
  assert.match(html, /这里还没有你的知识节点/);
  assert.match(html, /个人材料 · 证据来源/);
  assert.match(html, /链表错因记录/);
  assert.match(html, /删除节点前先找到前驱节点/);
  assert.doesNotMatch(html, /knowledge-directory__row|knowledge-network__node/);
});

test("knowledge network stays legible as the library grows", () => {
  const state = structuredClone(DEMO_STATE);
  state.knowledge = Array.from({ length: 300 }, (_, index) => ({
    ...DEMO_STATE.knowledge[index % DEMO_STATE.knowledge.length],
    id: `scaled-node-${index}`,
    title: `知识节点 ${index + 1}`,
    relatedIds: index > 0 ? [`scaled-node-${index - 1}`] : [],
    position: undefined,
  }));
  state.activeKnowledgeId = "scaled-node-299";
  state.knowledgeView = "network";
  const html = renderPage("/knowledge", state);
  assert.match(html, /关系网络 · 300 个核心节点/);
  assert.equal((html.match(/class="knowledge-network__node /g) ?? []).length, 9);
  assert.match(html, /个人学习证据/);
  assert.doesNotMatch(html, /PERSONAL COMPOUND/);
  assert.equal((html.match(/knowledge-network__dot--interactive/g) ?? []).length, 291);
  assert.equal((html.match(/data-knowledge-item/g) ?? []).length, 300);
});

test("profile uses user language for account status", () => {
  const demoHtml = renderPage("/profile", DEMO_STATE);
  assert.match(demoHtml, /账号类型 · 演示账号/);
  assert.doesNotMatch(demoHtml, /行者编号|DEMO-01|REAL/);

  const realState = structuredClone(DEMO_STATE);
  realState.isDemo = false;
  realState.auth = { user: { id: "user-1", display_name: "真实用户" } };
  const realHtml = renderPage("/profile", realState);
  assert.match(realHtml, /账号类型 · 正式账号/);
  assert.doesNotMatch(realHtml, /行者编号|DEMO-01|REAL/);
});

test("study chapter exposes the evidence protocol and action-oriented review contract", () => {
  const studyHtml = renderPage("/study", DEMO_STATE);
  assert.equal((studyHtml.match(/data-action="select-evidence"/g) ?? []).length, 4);
  assert.match(studyHtml, /data-evidence-input/);
  assert.match(studyHtml, /提交证据并生成复盘/);
  assert.match(studyHtml, /study-knowledge-capture/);
  assert.match(studyHtml, /把这次理解接入知识库/);
  assert.doesNotMatch(studyHtml, /收录这一段到知识库/);
  const reviewHtml = renderPage("/review", DEMO_STATE);
  for (const label of ["用了什么证据", "发现了什么问题", "为什么这样判断", "明日行动"]) assert.match(reviewHtml, new RegExp(label));
});

test("today follows the server route state and never treats an unconfirmed CET draft as active", () => {
  const state = structuredClone(DEMO_STATE);
  state.isDemo = false;
  state.learningRoute = {
    draft: {
      status: "confirmed",
      goal: { type: "postgraduate_entrance_exam" },
      plan: { today: { tasks: [{ id: "route-task-writing-01", title: "完成论文提纲的三个小节", action: "先列出三个小标题，再补每个标题的一句话。", planned_minutes: 35 }] } },
    },
  };
  state.companionCycle = {
    routeAvailable: true,
    task: { id: "route-task-writing-01", title: "完成论文提纲的三个小节", type: "写作", estimated_minutes: 35 },
    screenState: "action_active",
    currentAction: { id: "route-task-writing-01", origin: "route", status: "active" },
    cycle: null,
    nextAction: "先列出三个小标题，再补每个标题的一句话。",
  };
  const html = renderPage("/study", state);
  assert.match(html, /完成论文提纲的三个小节/);
  assert.match(html, /先列出三个小标题，再补每个标题的一句话/);
  assert.doesNotMatch(html, /data-demo-form="learning-artifact"/);

  state.goals.forEach((goal) => { goal.selected = goal.id === "goal-cet4"; });
  state.learningRoute.draft = {
    status: "draft",
    goal: { type: "college_english_exam", name: "大学英语四级" },
    plan: { today: { tasks: [{ id: "cet-draft-task", title: "未确认的 CET 草案" }] } },
  };
  state.companionCycle = { routeAvailable: false, task: null, currentAction: null, screenState: "need_material" };
  const draftHtml = renderPage("/study", state);
  assert.match(draftHtml, /data-demo-form="learning-artifact"/);
  assert.doesNotMatch(draftHtml, /未确认的 CET 草案|CET-4 · 今日安排/);

  state.goals.forEach((goal) => { goal.selected = goal.id === "goal-cet6"; });
  state.learningRoute.draft = {
    status: "draft",
    goal: { type: "college_english_exam", name: "大学英语六级" },
    plan: { today: { tasks: [{ id: "cet6-draft-task", title: "未确认的 CET-6 草案" }] } },
  };
  const cet6DraftHtml = renderPage("/study", state);
  assert.match(cet6DraftHtml, /data-demo-form="learning-artifact"/);
  assert.doesNotMatch(cet6DraftHtml, /未确认的 CET-6 草案|CET-6 · 今日安排/);
});

test("CET route form keeps the selected goal, shows remaining quota, and postgraduate default uses the announced date", () => {
  const state = structuredClone(DEMO_STATE);
  state.isDemo = false;
  state.goals.forEach((goal) => { goal.selected = goal.id === "goal-cet4"; });
  state.learningRoute = { draft: null, generationQuota: { limit: 5, used: 3, remaining: 2, resets_at: "2026-09-29T00:00:00.000Z" }, generationQuotaStatus: "synced" };
  const html = renderPage("/route", state);
  assert.match(html, /name="goal_type" type="hidden" value="college_english_exam"/);
  assert.doesNotMatch(html, /name="goal_name" type="hidden" value="考研备考"/);
  assert.match(html, /今日 AI 路线生成：已用 3\/5 次，剩余 2 次/);
  assert.match(html, /按本地时间 .* 刷新/);
  assert.equal(defaultRouteTargetDate("postgraduate_entrance_exam", new Date(2026, 8, 28)), "2026-12-20");
  assert.equal(defaultRouteTargetDate("college_english_exam", new Date(2026, 8, 28)), "2027-03-28");
});

test("route generation quota has clear loading, exhausted and unavailable states", () => {
  const state = structuredClone(DEMO_STATE);
  state.isDemo = false;
  state.learningRoute = { draft: null, generationQuotaStatus: "loading" };
  const loading = renderPage("/route", state);
  assert.match(loading, /正在读取今日路线生成额度/);
  assert.match(loading, /正在读取今日额度…/);
  assert.match(loading, /type="submit" disabled aria-disabled="true"/);

  state.learningRoute = {
    draft: null,
    generationQuotaStatus: "synced",
    generationQuota: { limit: 5, used: 5, remaining: 0, resets_at: "2026-09-29T00:00:00.000Z" },
  };
  const exhausted = renderPage("/route", state);
  assert.match(exhausted, /剩余 0 次/);
  assert.match(exhausted, /刷新前无法生成新路线/);
  assert.match(exhausted, /type="submit" disabled aria-disabled="true"/);

  state.learningRoute = { draft: null, generationQuota: null, generationQuotaStatus: "error" };
  const unavailable = renderPage("/route", state);
  assert.match(unavailable, /今日额度暂时无法读取/);
  assert.match(unavailable, /服务端核验/);
  assert.doesNotMatch(unavailable, /正在读取今日路线生成额度/);
});

test("material intake supports a temporary photo-to-text confirmation step", async () => {
  const state = structuredClone(DEMO_STATE);
  state.isDemo = false;
  state.companionCycle = { screenState: "need_material" };
  const html = renderPage("/study", state);
  assert.match(html, /name="material_image"/);
  assert.match(html, /data-material-image/);
  assert.match(html, /拍照 \/ 上传图片/);
  assert.match(html, /选择图片、上传文件或直接拍摄/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/gif"/);
  for (const subject of ["数学一", "数学二", "数学三", "408", "计算机自命题", "英语一", "英语二", "政治"]) assert.match(html, new RegExp(subject));
  assert.match(html, /其他主题/);
  assert.match(html, /data-material-custom-subject/);
  assert.match(html, /capture="environment"/);
  assert.match(html, /图片仅用于本次识别，不会保存/);
  assert.match(html, /material-submit-label--confirm/);
  assert.match(html, /确认文字并交给引路/);
  assert.doesNotMatch(html, /首版只接收文字/);

  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /requestMaterialImageExtraction/);
  assert.match(source, /photoConfirmed/);
  assert.match(source, /选择图片、上传文件或直接拍摄/);
  assert.match(source, /form\.dataset\.photoConfirmed = "true"/);
});

test("material study state asks for real material before showing a diagnosis", () => {
  const state = structuredClone(DEMO_STATE);
  state.isDemo = false;
  state.companionCycle = { screenState: "need_material", currentAction: null, task: null };
  state.learningArtifacts = [];
  const html = renderPage("/study", state);
  assert.match(html, /data-demo-form="learning-artifact"/);
  assert.match(html, /name="source_title"/);
  assert.match(html, /name="content_text"/);
  assert.match(html, /交给引路/);
  assert.doesNotMatch(html, /data-demo-form="material-evidence"/);
  assert.doesNotMatch(html, /data-action="companion-check-in"/);
});

test("a real CET learner can use material diagnosis before creating a route", () => {
  const state = structuredClone(DEMO_STATE);
  state.isDemo = false;
  state.goals.forEach((goal) => { goal.selected = goal.id === "goal-cet4"; });
  state.learningRoute = { draft: null, error: "" };
  state.companionCycle = { routeAvailable: false, screenState: "need_material", currentAction: null, task: null };
  const html = renderPage("/", state);
  assert.match(html, /data-demo-form="learning-artifact"/);
  assert.match(html, /先把正在卡住的地方交出来/);
  assert.doesNotMatch(html, /先建立目标路线/);
});

test("material action cards expose citations and remove write controls for terminal actions", () => {
  const state = structuredClone(DEMO_STATE);
  state.isDemo = false;
  state.learningArtifacts = [{ id: "artifact-1", kind: "question", subject: "数学", source_title: "连续题草稿", content_text: "函数在 x=0 处连续。" }];
  state.companionCycle = {
    screenState: "action_active",
    currentAction: {
      id: "action-1",
      version: 2,
      status: "active",
      title: "拆出连续条件",
      reason: "材料中出现了连续判断，但还没有拆出验证条件。",
      expected_evidence: "提交左右极限、函数值和结论。",
      estimated_minutes: 10,
      artifact_refs: ["artifact-1"],
    },
    diagnosisSummary: { reason: "先核对三个条件。", unknowns: ["还没有标准答案"] },
    retrievedEvidence: [{ title: "连续题草稿", chunk_id: "chunk-1", excerpt: "函数在 x=0 处连续。", locator: { start: 0, end: 12 } }],
    guidanceEvidence: [{ title: "极限与连续", summary: "把左右极限、函数值和定义条件拆开书写。", action_pattern: "分别写已知条件、左右极限和函数值。" }],
  };
  const activeHtml = renderPage("/study", state);
  assert.match(activeHtml, /引路反馈 · 刚刚生成/);
  assert.match(activeHtml, /引路已完成反馈/);
  assert.match(activeHtml, /role="status" aria-live="polite"/);
  assert.match(activeHtml, /拆出连续条件/);
  assert.match(activeHtml, /chunk-1/);
  assert.match(activeHtml, /学习依据/);
  assert.match(activeHtml, /极限与连续/);
  assert.match(activeHtml, /不用于招生或日期事实/);
  assert.match(activeHtml, /data-action-version="2"/);
  assert.match(activeHtml, /data-demo-form="material-evidence"/);
  assert.match(activeHtml, /data-evidence-pending hidden role="status" aria-live="polite"/);

  state.pilot.inlineReview = {
    completedTitle: "拆出连续条件",
    evidence: "我写出了左右极限、函数值和结论。",
    nextTitle: "复现连续条件",
    nextReason: "明天先不看资料，独立写出三个条件。",
  };
  const inlineReviewHtml = renderPage("/study", state);
  assert.match(inlineReviewHtml, /已完成这一条/);
  assert.match(inlineReviewHtml, /我写出了左右极限、函数值和结论/);
  assert.match(inlineReviewHtml, /复现连续条件/);

  state.companionCycle.guidanceEvidence = [];
  const noGuidanceHtml = renderPage("/study", state);
  assert.match(noGuidanceHtml, /下一条行动暂未绑定审核节点/);
  assert.match(noGuidanceHtml, /不会套用其他学科模板/);

  state.companionCycle.diagnosisSummary = {
    status: "degraded",
    unknowns: ["还没有足够证据确认最终答案或掌握程度。"],
  };
  const degradedHtml = renderPage("/study", state);
  assert.match(degradedHtml, /引路已给出保底反馈/);
  assert.match(degradedHtml, /引路反馈 · 保底行动/);
  assert.match(degradedHtml, /不作掌握、正确率或路线结论/);
  assert.doesNotMatch(degradedHtml, /diagnosis action.expected_evidence is invalid/);

  state.companionCycle.currentAction.status = "completed";
  state.companionCycle.screenState = "cycle_completed";
  const terminalHtml = renderPage("/study", state);
  assert.match(terminalHtml, /这条行动已经关闭/);
  assert.doesNotMatch(terminalHtml, /data-demo-form="material-evidence"/);
  assert.doesNotMatch(terminalHtml, /data-action="companion-check-in"/);
});

test("material study warns when durable persistence is not confirmed", () => {
  const state = structuredClone(DEMO_STATE);
  state.isDemo = false;
  state.service = { ...state.service, api: "degraded", persistence: "unknown", persistenceNotice: "数据服务暂时不可用，本次操作没有保存，请稍后重试。" };
  state.companionCycle = { screenState: "need_material", currentAction: null, task: null };
  const html = renderPage("/study", state);
  assert.match(html, /数据保存状态需要确认/);
  assert.match(html, /本次操作没有保存/);
});

test("legacy route diagnostics do not replace material intake for real accounts", () => {
  const state = structuredClone(DEMO_STATE);
  state.isDemo = false;
  state.companionCycle = {
    routeAvailable: true,
    task: { id: "plan-day-2026-09-09", title: "围绕数学二完成 3 道不看答案的独立练习。", type: "诊断", estimated_minutes: 30 },
    cycle: { status: "started", task: { id: "plan-day-2026-09-09", title: "围绕数学二完成 3 道不看答案的独立练习。", type: "诊断", estimated_minutes: 30 } },
  };
  state.learningRoute = {
    draft: {
      plan: {
        today: {
          tasks: [{ id: "plan-day-2026-09-09", title: "起点校准 · 数学二独立练习", type: "诊断", planned_minutes: 30, action: "围绕数学二完成 3 道不看答案的独立练习。" }],
        },
      },
    },
    error: "",
  };
  const html = renderPage("/study", state);
  assert.match(html, /data-demo-form="learning-artifact"/);
  assert.match(html, /材料 → 诊断 → 一条现在能完成的行动/);
  assert.doesNotMatch(html, /首日独立诊断/);
  assert.equal((html.match(/data-diagnostic-source=/g) ?? []).length, 0);
  assert.equal((html.match(/data-diagnostic-outcome=/g) ?? []).length, 0);
});

test("review chapter exposes the user-controlled memory loop", () => {
  const state = structuredClone(DEMO_STATE);
  state.memory = {
    iterationCount: 1,
    syncStatus: "synced",
    memories: [
      { id: "memory-friction-goal-exam-task-01", kind: "friction", title: "当前需要回望", content: "边界条件仍然混淆。", scope: "goal-exam", status: "candidate", confidence: 0.51, observation_count: 1 },
      { id: "memory-strategy-goal-exam-task-01", kind: "strategy", title: "已发现的下一步", content: "明天用 15 分钟写出一个反例。", scope: "goal-exam", status: "active", confidence: 0.8, observation_count: 1 },
    ],
  };
  const html = renderPage("/review", state);
  assert.match(html, /本轮新记忆 · 1 次迭代/);
  assert.match(html, /data-action="memory-feedback"/);
  assert.match(html, /data-memory-action="confirm"/);
  assert.match(html, /data-memory-action="reject"/);
  assert.match(html, /已确认/);
});

test("knowledge can be captured from study and added through a composer", () => {
  const studyHtml = renderPage("/study", DEMO_STATE);
  assert.match(studyHtml, /data-action="capture-knowledge"/);
  const state = structuredClone(DEMO_STATE);
  state.knowledgeComposerOpen = true;
  const knowledgeHtml = renderPage("/knowledge", state);
  assert.match(knowledgeHtml, /data-demo-form="knowledge-capture"/);
  assert.match(knowledgeHtml, /name="relatedId"/);
  assert.match(knowledgeHtml, /收录进知识库/);
});

test("knowledge chapter distinguishes private material and grounded citations", () => {
  const state = structuredClone(DEMO_STATE);
  state.learningArtifacts = [{ id: "artifact-1", kind: "note", subject: "408", source_title: "链表错因", content_text: "删除节点前要先找到前驱节点。" }];
  state.companionCycle = { diagnosisSummary: { observations: [{ claim: "缺少前驱节点判断", artifact_id: "artifact-1", chunk_id: "chunk-1", evidence_excerpt: "删除节点前要先找到前驱节点。", confidence: 0.9 }] } };
  const html = renderPage("/knowledge", state);
  assert.match(html, /个人材料 · 证据来源/);
  assert.match(html, /链表错因/);
  assert.match(html, /最近一次诊断引用/);
  assert.match(html, /chunk-1/);
});

test("functional chapters keep their approved full-screen scene backgrounds", () => {
  const expectedScenes = {
    "/": "lijing-horizon-ink-v1.png",
    "/route": "lijing-growth-journey-ink-v1.png",
    "/plan": "lijing-growth-journey-ink-v1.png",
    "/study": "lijing-summit-climb-ink-v2.png",
    "/review": "lijing-recall-ink-v1.png",
    "/knowledge": "lijing-summit-climb-ink-v2.png",
    "/map": "lijing-summit-climb-ink-v2.png",
    "/profile": "lijing-archive-ink-v2.png",
    "/settings": "lijing-archive-ink-v2.png",
    "/assistant": "guides/lijing-guide-background-ink-v1.png",
    "/onboarding": "onboarding/onboarding-background-v2.png",
  };
  for (const [route, filename] of Object.entries(expectedScenes)) {
    const html = renderShell(route, DEMO_STATE);
    assert.match(html, /class="world-stage/);
    assert.match(html, new RegExp(`/assets/generated/source/${filename}`));
  }
});

test("loading state uses the approved ink fallback and removes the rejected frontier asset", () => {
  const html = renderWorldStage("/state/loading");
  assert.match(html, /data-scene="horizon"/);
  assert.match(html, /lijing-horizon-ink-v1\.png/);
  assert.doesNotMatch(html, /starforged-frontier-scene-v1/);
  assert.equal(getAsset("starforged-frontier-scene-v1"), null);
});

test("cold-start loading never renders demo identity or mountain values", () => {
  const loading = renderShell("/state/loading", DEMO_STATE, renderPage("/state/loading", DEMO_STATE));
  assert.match(loading, /正在同步你的学习状态/);
  assert.match(loading, /role="status"/);
  assert.doesNotMatch(loading, /本地演示环境|状态内容 · 演示数据|演示数据|行者 01|1,280m|专注线|回息线|2\.4 km|data-demo-state="true"/);
  assert.doesNotMatch(loading, /class="(?:world-stage|primary-nav|topbar|status-axis)/);

  const demo = renderShell("/", DEMO_STATE, renderPage("/", DEMO_STATE));
  assert.match(demo, /本地演示环境/);
  assert.match(demo, /演示数据/);
});

test("assistant keeps one default guide without a picker", () => {
  const html = renderPage("/assistant", DEMO_STATE);
  assert.match(html, /lijing-guide-heavenly-book-v2/);
  assert.doesNotMatch(html, /assistant-guide-picker|data-action="select-guide"|选择你的书鼎/);
  assert.doesNotMatch(html, /lijing-guide-pagoda-v2|lijing-guide-ding-v2|lijing-guide-fan-v2/);
  assert.doesNotMatch(html, /aaa-hero-character-female-v2/);
});

test("assistant falls back to the default guide for a historic selection", () => {
  const state = structuredClone(DEMO_STATE);
  state.guide.selectedAssetId = "lijing-guide-ding-v2";
  const html = renderPage("/assistant", state);
  assert.match(html, /引路方式 · 拆解、追问、复述<\/span><strong>引路<\/strong>/);
  assert.doesNotMatch(html, /lijing-guide-ding-v2/);
});

test("assistant presents companion teaching identity without a picker", () => {
  const state = structuredClone(DEMO_STATE);
  state.guide.selectedAssetId = "lijing-guide-fan-v2";
  const html = renderPage("/assistant", state);
  assert.match(html, /专属引路/);
  assert.match(html, /引路方式 · 拆解、追问、复述/);
  assert.doesNotMatch(html, /它会改变解释、提问和反馈方式/);
});

test("assistant makes the AI companion thinking state explicit while waiting", () => {
  const state = structuredClone(DEMO_STATE);
  state.pilot.assistantPending = true;
  state.pilot.assistantPrompt = "我不知道今天该先做什么";
  const html = renderPage("/assistant", state);
  assert.match(html, /AI 引路正在思考/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /name="prompt"[^>]+disabled/);
});

test("material intake shows the AI companion thinking state while diagnosis runs", () => {
  const state = structuredClone(DEMO_STATE);
  state.isDemo = false;
  state.pilot.materialPending = true;
  const html = renderPage("/study", state);
  assert.match(html, /class="companion-thinking"/);
  assert.match(html, /AI 引路正在思考/);
  assert.match(html, /正在阅读你提交的材料并整理下一步行动/);
});

test("feature directory exposes eight clickable directions", () => {
  const html = renderPage("/features", DEMO_STATE);
  assert.equal((html.match(/class="bagua-node /g) ?? []).length, 8);
  assert.equal((html.match(/data-route="\//g) ?? []).length, 8);
  assert.match(html, /功能目录/);
  assert.match(html, /八方皆可入山/);
});

test("primary navigation keeps the daily loop to five destinations", () => {
  const html = renderShell("/study", DEMO_STATE);
  assert.equal(FEATURE_ITEMS.length, 8);
  assert.equal((html.match(/class="primary-nav__link/g) ?? []).length, 10);
  for (const route of ["/", "/route", "/review", "/knowledge", "/settings"]) {
    assert.match(html, new RegExp(`data-route="${route.replace("/", "\\/")}"`));
  }
  assert.doesNotMatch(html, /feature-nav-trigger|feature-nav-overlay|feature-nav-dial/);
  assert.match(renderPage("/route", DEMO_STATE), /data-route="\/goals"/);
});

test("primary navigation remains legible over pale ink scenes", async () => {
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.primary-nav \{[^}]*backdrop-filter: blur\(10px\)/);
  assert.match(styles, /\.primary-nav__link \{[^}]*color: rgba\(247, 244, 237, \.86\)/);
  assert.match(styles, /\.primary-nav__link \{[^}]*text-shadow:/);
  assert.match(styles, /\.primary-nav__link\.is-active \{[^}]*box-shadow:/);
});

test("onboarding completion exposes the approved dragon-phoenix video transition", () => {
  const html = renderShell("/goals", DEMO_STATE, renderPage("/goals", DEMO_STATE));
  assert.match(html, /data-action="complete-onboarding"/);
  assert.equal(getAsset("opening-longfeng-clean-v1")?.path, "/assets/generated/source/opening/ink_longfeng_clean_1920x1080_24fps.mp4");
  assert.match(html, /opening\/ink_longfeng_clean_1920x1080_24fps\.mp4/);
  assert.match(html, /class="ascension-intro__video"/);
  assert.match(html, /playsinline/);
  assert.match(html, /preload="none"/);
  assert.match(html, /data-src="\/assets\/generated\/source\/opening\/ink_longfeng_clean_1920x1080_24fps\.mp4"/);
  assert.doesNotMatch(html, /autoplay/);
  assert.match(html, /id="ascension-intro"/);
});

test("core actions use human language", () => {
  assert.equal(renderPage("/", DEMO_STATE).includes("开始今天"), true);
  const newUserState = structuredClone(DEMO_STATE);
  newUserState.today = { completed: 0, total: 0, streak: 0, minutes: 0, tasks: [] };
  assert.equal(renderPage("/", newUserState).includes("继续建立路线"), true);
  assert.equal(renderPage("/plan", DEMO_STATE).includes("今天"), true);
  assert.equal(renderPage("/growth", DEMO_STATE).includes("回望来路"), true);
});

test("visible product language uses one guide and plain navigation labels", () => {
  const legacyTerms = /器灵|书鼎|引路人|行旅|攀登|山段|山海图|登峰碑|身份印记|八方行旅/;
  for (const route of Object.keys(ROUTES)) {
    assert.doesNotMatch(renderPage(route, DEMO_STATE), legacyTerms, route);
  }
  assert.doesNotMatch(renderShell("/study", DEMO_STATE), legacyTerms);
  assert.match(renderPage("/review", DEMO_STATE), /本次结论基于 L2 级证据，不等同于最终掌握/);
});

test("shell exposes navigation, motion controls and content landmarks", () => {
  const html = renderShell("/plan", DEMO_STATE);
  assert.equal(html.includes('aria-label="主导航"'), true);
  assert.equal(html.includes('data-motion="on"'), true);
  assert.equal(html.includes('data-current-route="/plan"'), true);
  assert.equal(html.includes('class="app-shell" data-route='), false);
  assert.equal(html.includes('<main id="main-content"'), true);
  assert.equal(html.includes("当前章节"), true);
});

test("onboarding shell keeps the focused surface and approved background", () => {
  const html = renderShell("/onboarding", DEMO_STATE, renderPage("/onboarding", DEMO_STATE));
  assert.match(html, /class="app-shell app-shell--onboarding"/);
  assert.match(html, /目标 \+ 时间 · 可随时修改/);
  assert.doesNotMatch(html, /class="primary-nav"/);
  assert.match(html, /onboarding\/onboarding-background-v2\.png/);
  assert.match(html, /data-scene="onboarding"/);
});

test("auth shell is a focused entry surface", () => {
  const html = renderShell("/auth", DEMO_STATE, renderPage("/auth", DEMO_STATE));
  assert.match(html, /class="app-shell app-shell--auth"/);
  assert.match(html, /lijing-auth-gate-v1\.png/);
  assert.match(html, /topbar--auth/);
  assert.doesNotMatch(html, /class="primary-nav"/);
  assert.doesNotMatch(html, /class="status-axis"/);
});

test("home shell exposes a replayable interface tour with real targets", () => {
  const state = structuredClone(DEMO_STATE);
  state.tour = { active: true, step: 0 };
  const html = renderShell("/", state, renderPage("/", state));
  assert.match(html, /class="interface-tour"/);
  assert.match(html, /data-tour-target-name="feature-nav"/);
  assert.match(html, /data-tour-target="feature-nav"/);
  assert.match(html, /data-tour-target="topbar"/);
  assert.match(html, /data-tour-target="daily-panel"/);
  assert.match(html, /data-tour-target="today-route"/);
  assert.match(html, /data-action="tour-open"/);
});

test("native browser entry loads CSS as a stylesheet, not a JS module", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(html, /<link rel="stylesheet" href="\/apps\/user_client\/src\/styles\.css">/);
  assert.doesNotMatch(main, /import\s+["']\.\/styles\.css["']/);
});
