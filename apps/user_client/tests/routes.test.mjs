import test from "node:test";
import assert from "node:assert/strict";
import { NAV_ITEMS, ROUTES, getRouteMeta, normalizeRoute } from "../src/data/routes.js";
import { PAGE_RENDERERS, renderPage } from "../src/pages/index.js";
import { renderShell } from "../src/components/shell.js";
import { DEMO_STATE } from "../src/data/demo-data.js";
import { getAsset } from "../src/data/assets.js";
import { readFile } from "node:fs/promises";

test("normalizes unknown paths to the real not-found route", () => {
  assert.equal(normalizeRoute("/missing"), "/404");
  assert.equal(normalizeRoute("/plan/"), "/plan");
});

test("covers every first-phase chapter in navigation metadata", () => {
  const routeKeys = new Set(Object.keys(ROUTES));
  for (const item of NAV_ITEMS) assert.equal(routeKeys.has(item.href), true);
  assert.equal(routeKeys.size >= 11, true);
  assert.equal(getRouteMeta("/study").chapter, "攀登");
});

test("every product chapter has a real page renderer", () => {
  for (const route of Object.keys(ROUTES)) {
    assert.equal(typeof PAGE_RENDERERS[route], "function", `missing renderer for ${route}`);
    const html = renderPage(route, DEMO_STATE);
    assert.equal(html.includes("demo-state"), true, `missing demo state marker for ${route}`);
  }
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
  assert.match(loginHtml, /data-action="forgot-password"/);
});

test("client keeps an already-loaded pilot invitation policy while resetting an anonymous session", async () => {
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /registrationPolicy:\s*\{\s*\.\.\.DEMO_STATE\.registrationPolicy\s*\}/);
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
  assert.match(html, /AI 引路/);
  assert.match(html, /临时本地会话，服务重启后数据会清空/);
  assert.doesNotMatch(html, /刷新和换设备仍可恢复/);
  assert.match(html, /name="detail"/);

  const authHtml = renderPage("/auth", state);
  assert.match(authHtml, /当前为公开测试版/);
  assert.doesNotMatch(authHtml, /可跨重启恢复/);
});

test("learning route intake asks for real capacity and only exposes a draft after server generation", () => {
  const state = structuredClone(DEMO_STATE);
  state.isDemo = false;
  state.learningRoute = { draft: null, error: "" };
  const emptyHtml = renderPage("/route", state);
  assert.match(emptyHtml, /data-demo-form="learning-route"/);
  assert.match(emptyHtml, /当前试点方向/);
  assert.match(emptyHtml, /考公、就业与泛学习方向开发中/);
  assert.match(emptyHtml, /name="weekly_hours"/);
  assert.match(emptyHtml, /name="constraints"/);
  assert.match(emptyHtml, /起点校准 · 先测一科/);
  assert.match(emptyHtml, /name="assessment_subject"/);
  assert.match(emptyHtml, /name="assessment_evidence"/);
  assert.match(emptyHtml, /不会拿示例计划冒充你的结果/);

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
  assert.match(draftHtml, /确认后会展开/);
  assert.match(draftHtml, /起点校准 · 学习者陈述/);
  assert.match(draftHtml, /数学二/);
  assert.match(draftHtml, /不把这份陈述当作已验证的分数或掌握结论/);
  assert.doesNotMatch(draftHtml, /route-plan-preview/);

  state.learningRoute.draft.feasibility = { ...state.learningRoute.draft.feasibility, status: "tight", message: "计划接近可用时长。" };
  const tightHtml = renderPage("/route", state);
  assert.match(tightHtml, /时间过紧/);
  assert.match(tightHtml, /data-action="confirm-learning-route"/);
  assert.match(tightHtml, /接受紧凑安排，开始今天这一步/);
});

test("first-visit onboarding collects only the minimum setup before material intake", () => {
  const state = structuredClone(DEMO_STATE);
  state.onboarding.step = 1;
  const profileHtml = renderPage("/onboarding", state);
  assert.equal(getAsset("lijing-onboarding-background-v2")?.path, "/assets/generated/source/onboarding/onboarding-background-v2.png");
  assert.doesNotMatch(profileHtml, /onboarding\/onboarding-background-v2\.png/);
  assert.match(profileHtml, /data-demo-form="onboarding-profile"/);
  assert.match(profileHtml, /name="school"/);
  assert.match(profileHtml, /你现在最想完成什么/);
  assert.match(profileHtml, /接下来直接粘贴正在卡住的材料/);
  assert.match(profileHtml, /长期技能伴学/);
  assert.match(profileHtml, /开发中/);
  assert.match(profileHtml, /进入材料诊断/);
  assert.match(profileHtml, /补充更多资料/);
  assert.doesNotMatch(profileHtml, /继续选择书鼎/);

  state.onboarding.step = 2;
  const repeatedHtml = renderPage("/onboarding", state);
  assert.match(repeatedHtml, /入山引导 · 一次填写/);
  assert.match(repeatedHtml, /data-demo-form="onboarding-profile"/);
  assert.doesNotMatch(repeatedHtml, /第二步 · 建立路线/);
  assert.doesNotMatch(repeatedHtml, /开始补充路线条件/);
});

test("bagua reference is registered and integrated into orientation chapters", () => {
  assert.equal(getAsset("bagua-ink-compass-v1")?.path, "/assets/generated/source/bagua-ink-compass-v1.png");
  assert.match(renderPage("/review", DEMO_STATE), /bagua-field/);
  assert.match(renderPage("/goals", DEMO_STATE), /data-bagua="乾"/);
});

test("knowledge chapter exposes a personal graph and node detail", () => {
  const html = renderPage("/knowledge", DEMO_STATE);
  assert.match(html, /个人复利 Agent 知识库/);
  assert.match(html, /个人复利知识关系网络/);
  assert.match(html, /PERSONAL COMPOUND/);
  assert.match(html, /Agent 管理/);
  assert.match(html, /外部资源归档/);
  assert.equal((html.match(/data-action="select-knowledge"/g) ?? []).length >= 6, true);
  assert.equal((html.match(/class="knowledge-network__dot /g) ?? []).length, 96);
  assert.match(html, /把这次理解接入知识库|我留下的理解/);
  assert.match(html, /搜索节点、来源或关键词/);
  assert.match(html, /data-knowledge-view="directory"/);
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
  const html = renderPage("/knowledge", state);
  assert.match(html, /关系网络 · 300 个核心节点/);
  assert.equal((html.match(/class="knowledge-network__node /g) ?? []).length, 9);
  assert.equal((html.match(/knowledge-network__dot--interactive/g) ?? []).length, 291);
  assert.equal((html.match(/data-knowledge-item/g) ?? []).length, 300);
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

test("real accounts prioritize material intake over legacy route diagnostics", () => {
  const state = structuredClone(DEMO_STATE);
  state.isDemo = false;
  state.companionCycle = {
    routeAvailable: true,
    task: { id: "route-task-writing-01", title: "完成论文提纲的三个小节", type: "写作", estimated_minutes: 35 },
    cycle: {
      status: "stuck",
      task: { id: "route-task-writing-01", title: "完成论文提纲的三个小节", type: "写作", estimated_minutes: 35 },
      intervention: { next_action: "先列出三个小标题，再补每个标题的一句话。" },
    },
    nextAction: "先列出三个小标题，再补每个标题的一句话。",
  };
  const html = renderPage("/study", state);
  assert.match(html, /data-demo-form="learning-artifact"/);
  assert.match(html, /先把正在卡住的地方交出来/);
  assert.doesNotMatch(html, /完成论文提纲的三个小节/);
  assert.doesNotMatch(html, /首日独立诊断/);
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
  assert.match(html, /交给器灵/);
  assert.doesNotMatch(html, /data-demo-form="material-evidence"/);
  assert.doesNotMatch(html, /data-action="companion-check-in"/);
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
  };
  const activeHtml = renderPage("/study", state);
  assert.match(activeHtml, /拆出连续条件/);
  assert.match(activeHtml, /chunk-1/);
  assert.match(activeHtml, /data-action-version="2"/);
  assert.match(activeHtml, /data-demo-form="material-evidence"/);

  state.companionCycle.diagnosisSummary = {
    status: "degraded",
    unknowns: ["还没有足够证据确认最终答案或掌握程度。"],
  };
  const degradedHtml = renderPage("/study", state);
  assert.match(degradedHtml, /基于材料生成的保底行动/);
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
  assert.match(html, /个人材料 RAG · 证据来源/);
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

test("guide chapter offers gender-neutral Chinese relic guides", () => {
  const html = renderPage("/assistant", DEMO_STATE);
  assert.match(html, /选择你的书鼎/);
  assert.equal((html.match(/data-action="select-guide"/g) ?? []).length, 4);
  for (const assetId of ["lijing-guide-heavenly-book-v2", "lijing-guide-pagoda-v2", "lijing-guide-ding-v2", "lijing-guide-fan-v2"]) {
    assert.match(html, new RegExp(assetId));
  }
  assert.doesNotMatch(html, /aaa-hero-character-female-v2/);
});

test("guide selection renders the selected relic as the active guide", () => {
  const state = structuredClone(DEMO_STATE);
  state.guide.selectedAssetId = "lijing-guide-ding-v2";
  const html = renderPage("/assistant", state);
  assert.match(html, /教学人格 · 专注、减负、短行动<\/span><strong>重鼎 · 镇心<\/strong>/);
  assert.match(html, /data-guide="lijing-guide-ding-v2" aria-pressed="true"/);
  assert.match(html, /guide-option--ding is-selected/);
});

test("assistant presents companion teaching identity instead of a visual-only guide", () => {
  const state = structuredClone(DEMO_STATE);
  state.guide.selectedAssetId = "lijing-guide-fan-v2";
  const html = renderPage("/assistant", state);
  assert.match(html, /专属教学人格/);
  assert.match(html, /教学人格 · 类比、反例、换角度/);
  assert.match(html, /它会改变解释、提问和反馈方式/);
});

test("feature directory exposes eight clickable directions", () => {
  const html = renderPage("/features", DEMO_STATE);
  assert.equal((html.match(/class="bagua-node /g) ?? []).length, 8);
  assert.equal((html.match(/data-route="\//g) ?? []).length, 8);
  assert.match(html, /功能目录/);
  assert.match(html, /八方皆可入山/);
});

test("navigation centers on the feature directory and keeps the eight modules around it", () => {
  const html = renderShell("/features", DEMO_STATE);
  assert.match(html, /href="\/features"[^>]+data-route="\/features"/);
  for (const route of ["/goals", "/plan", "/study", "/review", "/knowledge", "/assistant", "/growth", "/map"]) {
    assert.match(html, new RegExp(`data-route="${route.replace("/", "\\/")}"`));
  }
});

test("bagua navigation opens as a full-screen selection surface", async () => {
  const html = renderShell("/study", DEMO_STATE);
  assert.match(html, /class="feature-nav-trigger"/);
  assert.match(html, /aria-controls="feature-nav-overlay"/);
  assert.match(html, /class="feature-nav-overlay"/);
  assert.match(html, /class="feature-nav-dial"/);
  assert.match(html, /bagua-ink-compass-v1\.png/);
  assert.match(html, /bagua-yinyang-core-v1\.png/);
  assert.match(html, /feature-nav-dial__ink/);
  assert.match(html, /feature-nav-trigger__core/);
  assert.equal((html.match(/class="feature-nav-trigger__direction /g) ?? []).length, 8);
  assert.equal((html.match(/class="feature-nav-node /g) ?? []).length, 8);
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.feature-nav-overlay \{[^}]*transform-origin: 51px 48px/);
  assert.match(styles, /feature-nav-trigger-rotate/);
  assert.match(styles, /feature-nav-trigger-breathe/);
});

test("onboarding completion exposes the approved dragon-phoenix video transition", () => {
  const html = renderShell("/goals", DEMO_STATE, renderPage("/goals", DEMO_STATE));
  assert.match(html, /data-action="complete-onboarding"/);
  assert.equal(getAsset("opening-longfeng-clean-v1")?.path, "/assets/generated/source/opening/ink_longfeng_clean_1920x1080_24fps.mp4");
  assert.match(html, /opening\/ink_longfeng_clean_1920x1080_24fps\.mp4/);
  assert.match(html, /class="ascension-intro__video"/);
  assert.match(html, /playsinline/);
  assert.match(html, /id="ascension-intro"/);
});

test("core actions use human language", () => {
  assert.equal(renderPage("/", DEMO_STATE).includes("开始今日行旅"), true);
  const newUserState = structuredClone(DEMO_STATE);
  newUserState.today = { completed: 0, total: 0, streak: 0, minutes: 0, tasks: [] };
  assert.equal(renderPage("/", newUserState).includes("继续建立路线"), true);
  assert.equal(renderPage("/plan", DEMO_STATE).includes("今日行旅"), true);
  assert.equal(renderPage("/growth", DEMO_STATE).includes("回望来路"), true);
});

test("shell exposes navigation, motion controls and content landmarks", () => {
  const html = renderShell("/plan", DEMO_STATE);
  assert.equal(html.includes('aria-label="打开全部功能导航"'), true);
  assert.equal(html.includes('data-motion="on"'), true);
  assert.equal(html.includes('data-current-route="/plan"'), true);
  assert.equal(html.includes('class="app-shell" data-route='), false);
  assert.equal(html.includes('<main id="main-content"'), true);
  assert.equal(html.includes("当前章节"), true);
});

test("onboarding shell keeps the focused surface and approved background", () => {
  const html = renderShell("/onboarding", DEMO_STATE, renderPage("/onboarding", DEMO_STATE));
  assert.match(html, /class="app-shell app-shell--onboarding"/);
  assert.match(html, /约 1 分钟 · 可随时修改/);
  assert.doesNotMatch(html, /class="feature-nav-trigger"/);
  assert.match(html, /onboarding\/onboarding-background-v2\.png/);
  assert.match(html, /data-scene="onboarding"/);
});

test("auth shell is a focused entry surface", () => {
  const html = renderShell("/auth", DEMO_STATE, renderPage("/auth", DEMO_STATE));
  assert.match(html, /class="app-shell app-shell--auth"/);
  assert.match(html, /lijing-auth-gate-v1\.png/);
  assert.match(html, /topbar--auth/);
  assert.doesNotMatch(html, /class="feature-nav-trigger"/);
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
