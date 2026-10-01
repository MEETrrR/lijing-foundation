import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEMO_STATE } from "../src/data/demo-data.js";
import { hydrateKnowledgeNodes, persistEvidenceKnowledge, serializeKnowledgeNodes } from "../src/data/knowledge-evidence.js";
import { userStatePayload } from "../src/app.js";
import { renderPage } from "../src/pages/index.js";
import { UserStateService, initialState } from "../../../services/api/src/domains/profile/user-state-service.ts";

function createDatabase() {
  const values = new Map();
  return {
    async get(key) { return values.has(key) ? structuredClone(values.get(key)) : null; },
    async set(key, value) { values.set(key, structuredClone(value)); },
    async transaction(work) { return work(this); },
  };
}

test("submitted learning evidence is saved, restored and shown in the knowledge library", async () => {
  const state = structuredClone(DEMO_STATE);
  state.isDemo = false;
  state.goals.forEach((goal) => { goal.selected = goal.id === "goal-cet6"; });
  state.knowledge = [];
  state.activeKnowledgeId = "";
  const service = new UserStateService({ database: createDatabase() });
  const requestId = "550e8400-e29b-41d4-a716-446655440000";
  let writes = 0;

  const node = await persistEvidenceKnowledge({
    state,
    action: { id: "task-cet4-reading-1", title: "六级阅读定位", artifact_refs: [] },
    evidence: "我先定位转折句再回到原文核对选项依据",
    evidenceLevel: 3,
    persist: async () => {
      writes += 1;
      const savedState = initialState();
      savedState.profile = { ...savedState.profile, name: "测试行者", stage: "备考学习" };
      savedState.goal_id = "goal-cet6";
      savedState.knowledge = serializeKnowledgeNodes(state.knowledge);
      await service.saveState("account-1", {
        request_id: requestId,
        state: savedState,
      }, requestId);
      const recovered = await service.getState("account-1", requestId);
      state.knowledge = hydrateKnowledgeNodes(recovered.state.knowledge);
    },
  });

  assert.equal(writes, 1);
  assert.equal(node.id, "evidence-task-cet4-reading-1");
  assert.equal(state.knowledge[0].goalId, "goal-cet6");
  assert.equal(state.knowledge[0].evidenceLevel, 3);
  assert.equal(state.knowledge[0].summary, "我先定位转折句再回到原文核对选项依据");
  const html = renderPage("/knowledge", { ...state, activeKnowledgeId: node.id });
  assert.match(html, /六级阅读定位/);
  assert.match(html, /我先定位转折句再回到原文核对选项依据/);
  assert.doesNotMatch(html, /这里还没有你的知识节点/);
});

test("L1 evidence and route task state persist and read back for a fresh account", async () => {
  const state = structuredClone(DEMO_STATE);
  state.isDemo = false;
  state.user = { ...state.user, name: "新账号测试", stage: "四级备考", age: "", dailyMinutes: "25", weeklyHours: "8" };
  state.onboarding = { ...state.onboarding, completed: true };
  state.goals.forEach((goal) => { goal.selected = goal.id === "goal-cet4"; });
  state.knowledge = [];
  state.activeKnowledgeId = "";
  state.today = {
    completed: 0,
    total: 1,
    streak: 0,
    minutes: 25,
    tasks: [{
      id: "task-r9-fresh-account",
      type: "学习",
      title: "四级阅读定位",
      meta: `25 分钟 · ${"读取资料并核对判断依据。".repeat(12)} · 产出：${"留下可复查记录。".repeat(8)}`,
      status: "active",
      gua: "☲",
    }],
  };
  state.pilot = {
    ...state.pilot,
    selectedEvidenceLevel: 1,
    submittedEvidence: "我完成了这一段学习。",
    selectedAnswer: "",
    review: {
      evidenceUsed: "我完成了这一段学习。",
      problem: "当前没有可核验的学习产物。",
      reason: "本轮是学习者自我声明。",
      nextAction: "下次补充一段笔记或练习过程。",
    },
    reviewReady: true,
  };
  assert.ok(state.today.tasks[0].meta.length > 160);

  const service = new UserStateService({ database: createDatabase() });
  let readBack;
  const node = await persistEvidenceKnowledge({
    state,
    action: { id: "action-r9-fresh-account", title: "四级阅读定位" },
    evidence: state.pilot.submittedEvidence,
    evidenceLevel: 1,
    persist: async () => {
      const payload = userStatePayload(state);
      assert.ok(payload.today.tasks[0].meta.length <= 160);
      assert.equal(payload.pilot.selected_answer, "");
      await service.saveState("fresh-account", {
        request_id: "550e8400-e29b-41d4-a716-446655440001",
        state: payload,
      }, "r9-fresh-account-state-0001");
      readBack = await service.getState("fresh-account", "550e8400-e29b-41d4-a716-446655440001");
      state.knowledge = hydrateKnowledgeNodes(readBack.state.knowledge);
    },
  });

  assert.equal(node.evidenceLevel, 1);
  assert.equal(readBack.state.knowledge.length, 1);
  assert.equal(readBack.state.knowledge[0].id, "evidence-action-r9-fresh-account");
  assert.equal(readBack.state.knowledge[0].evidence_level, 1);
  assert.equal(readBack.state.pilot.review_ready, true);
  assert.equal(readBack.state.pilot.submitted_evidence, "我完成了这一段学习。");
  const library = renderPage("/knowledge", { ...state, activeKnowledgeId: node.id });
  assert.match(library, /四级阅读定位/);
  assert.doesNotMatch(library, /这里还没有你的知识节点/);
});

test("evidence nodes form a bidirectional chain within the selected goal only", async () => {
  const state = structuredClone(DEMO_STATE);
  state.goals.forEach((goal) => { goal.selected = goal.id === "goal-cet4"; });
  state.activeKnowledgeId = "prior-cet6";
  state.knowledge = [
    { id: "prior-cet6", goalId: "goal-cet6", relatedIds: [] },
    { id: "prior-cet4", goalId: "goal-cet4", relatedIds: [] },
    { id: "legacy-node", relatedIds: [] },
  ];

  const first = await persistEvidenceKnowledge({
    state,
    action: { id: "cet4-task-1", title: "四级阅读" },
    evidence: "先定位题干关键词，再核对原文。",
    evidenceLevel: 2,
  });
  const second = await persistEvidenceKnowledge({
    state,
    action: { id: "cet4-task-2", title: "四级听力" },
    evidence: "先识别转折，再判断说话人的态度。",
    evidenceLevel: 3,
  });

  assert.deepEqual(first.relatedIds, ["prior-cet4", second.id]);
  assert.deepEqual(second.relatedIds, [first.id]);
  assert.deepEqual(state.knowledge.find((item) => item.id === "prior-cet4").relatedIds, [first.id]);
  assert.deepEqual(state.knowledge.find((item) => item.id === "prior-cet6").relatedIds, []);
  assert.deepEqual(state.knowledge.find((item) => item.id === "legacy-node").relatedIds, []);
  const graph = renderPage("/knowledge", {
    ...state,
    knowledge: [second, first],
    activeKnowledgeId: second.id,
    knowledgeView: "network",
  });
  assert.match(graph, /left:20%;top:32%/);
  assert.match(graph, /left:80%;top:32%/);

  state.goals.forEach((goal) => { goal.selected = goal.id === "goal-cet6"; });
  const otherGoal = await persistEvidenceKnowledge({
    state,
    action: { id: "cet6-task-1", title: "六级阅读" },
    evidence: "回到原文定位论据。",
    evidenceLevel: 2,
  });
  assert.equal(otherGoal.goalId, "goal-cet6");
  assert.deepEqual(otherGoal.relatedIds, ["prior-cet6"]);
  const restored = hydrateKnowledgeNodes(serializeKnowledgeNodes(state.knowledge));
  assert.equal(restored.find((item) => item.id === first.id).goalId, "goal-cet4");
});

test("knowledge persistence failure rolls back the unsaved node", async () => {
  const state = structuredClone(DEMO_STATE);
  state.knowledge = [];
  state.activeKnowledgeId = "";

  await assert.rejects(persistEvidenceKnowledge({
    state,
    action: { id: "task-1", title: "一次学习行动" },
    evidence: "留下了一条证据。",
    evidenceLevel: 2,
    persist: async () => { throw new Error("state save failed"); },
  }), /state save failed/);
  assert.deepEqual(state.knowledge, []);
  assert.equal(state.activeKnowledgeId, "");
});

test("both evidence submission handlers use the shared knowledge persistence flow", async () => {
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /data-action="submit-evidence"[\s\S]*?persistEvidenceKnowledge\(/);
  assert.match(source, /form\.dataset\.demoForm === "material-evidence"[\s\S]*?persistEvidenceKnowledge\(/);
});
