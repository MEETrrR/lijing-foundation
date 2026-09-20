const test = require("node:test");
const assert = require("node:assert/strict");
const { createBackendServer } = require("../../services/api/src/bootstrap/http-api.ts");
const { validateProviderDiagnosis } = require("../../services/api/src/domains/companion-cycle/companion-diagnosis-service.ts");
const { InMemoryDatabase } = require("../../services/api/src/platform/persistence/database.ts");

const ids = {
  artifact: "artifact-material-flow-001",
  create: "11111111-1111-4111-8111-111111111111",
  diagnosis: "22222222-2222-4222-8222-222222222222",
  start: "33333333-3333-4333-8333-333333333333",
  evidence: "44444444-4444-4444-8444-444444444444",
};

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

async function binaryRequest(baseUrl, path, bytes, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    body: bytes,
    headers: { "Content-Type": "image/png", ...(options.headers ?? {}) },
  });
  return { response, body: await response.json() };
}

function auth(token = "dev-user-001-token") { return { Authorization: `Bearer ${token}` }; }

test("material Agent creates grounded actions, isolates artifacts, and rejects stale evidence", async () => {
  const provider = {
    async complete({ feature, input }) {
      assert.equal(feature, "material_diagnosis");
      const request = JSON.parse(input);
      const material = request.materials[0];
      assert.equal(request.output_contract.response, "json_object_only");
      assert.equal(request.output_contract.action.expected_evidence_max_characters, 300);
      assert.equal(request.output_contract.observation.evidence_excerpt, "copy_exactly_from_the_same_material_excerpt");
      return {
        source_type: "ai_assisted",
        text: JSON.stringify({
          observations: [{
            claim: "草稿还没有拆开连续条件",
            artifact_id: material.artifact_id,
            chunk_id: material.chunk_id,
            evidence_excerpt: "函数在 x=0 处连续",
            confidence: 0.82,
          }],
          unknowns: ["还没有标准答案，不能判断最终结论"],
          error_tags: ["condition-check"],
          action: {
            title: "写出 x=0 两侧的连续条件",
            reason: "材料中已经出现连续性判断，但条件还没有被拆开验证。",
            estimated_minutes: 10,
            expected_evidence: "提交左右极限、函数值和连续性结论。",
          },
        }),
      };
    },
  };
  const { server } = createBackendServer({
    aiEnabled: true,
    provider,
    pricing: { inputPer1kUsd: 1, outputPer1kUsd: 2 },
  });
  const baseUrl = await listen(server);
  try {
    const artifact = await jsonRequest(baseUrl, "/api/v1/learning-artifacts", {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "material-create-flow-01" },
      body: JSON.stringify({
        request_id: ids.create,
        artifact_id: ids.artifact,
        kind: "attempt_draft",
        subject: "高等数学",
        source_title: "连续与极限草稿",
        content_text: "我认为函数在 x=0 处连续，但还没有写出左右极限、函数值和连续性条件。",
      }),
    });
    assert.equal(artifact.response.status, 201);
    assert.equal(artifact.body.artifact.id, ids.artifact);

    const otherAccount = await jsonRequest(baseUrl, `/api/v1/learning-artifacts/${ids.artifact}`, { headers: auth("dev-user-002-token") });
    assert.equal(otherAccount.response.status, 404);

    const diagnosis = await jsonRequest(baseUrl, "/api/v1/companion/diagnoses", {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "material-diagnosis-flow-01" },
      body: JSON.stringify({ request_id: ids.diagnosis, artifact_ids: [ids.artifact], focus: "连续条件怎么验证" }),
    });
    assert.equal(diagnosis.response.status, 200);
    assert.equal(diagnosis.body.status, "ready");
    assert.equal(diagnosis.body.diagnosis.observations[0].artifact_id, ids.artifact);
    assert.equal(diagnosis.body.action.status, "planned");

    const usage = await jsonRequest(baseUrl, "/api/v1/me/ai/usage", { headers: auth() });
    assert.equal(usage.response.status, 200);
    assert.equal(usage.body.usage.total_runs, 1);
    assert.equal(usage.body.usage.completed_runs, 1);
    assert.equal(usage.body.usage.degraded_runs, 0);
    assert.equal(usage.body.usage.degraded_rate, 0);
    assert.ok(usage.body.usage.input_tokens > 0);
    assert.ok(usage.body.usage.output_tokens > 0);
    assert.ok(usage.body.usage.estimated_cost_usd > 0);

    const replayedDiagnosis = await jsonRequest(baseUrl, "/api/v1/companion/diagnoses", {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "material-diagnosis-flow-01" },
      body: JSON.stringify({ request_id: ids.diagnosis, artifact_ids: [ids.artifact], focus: "连续条件怎么验证" }),
    });
    assert.equal(replayedDiagnosis.body.replayed, true);
    assert.equal(replayedDiagnosis.body.action.id, diagnosis.body.action.id);

    const otherDiagnosis = await jsonRequest(baseUrl, "/api/v1/companion/diagnoses", {
      method: "POST",
      headers: { ...auth("dev-user-002-token"), "Idempotency-Key": "material-cross-account-01" },
      body: JSON.stringify({ request_id: "99999999-9999-4999-8999-999999999999", artifact_ids: [ids.artifact], focus: "不应读取别人的材料" }),
    });
    assert.equal(otherDiagnosis.response.status, 404);

    const today = await jsonRequest(baseUrl, "/api/v1/companion/today", { headers: auth() });
    assert.equal(today.body.screen_state, "next_action_ready");
    assert.equal(today.body.current_action.id, diagnosis.body.action.id);
    assert.equal(today.body.diagnosis_summary.observations[0].chunk_id, diagnosis.body.diagnosis.observations[0].chunk_id);
    assert.match(today.body.diagnosis_summary.observations[0].evidence_excerpt, /连续/);

    const started = await jsonRequest(baseUrl, "/api/v1/companion/check-ins", {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "material-start-flow-01" },
      body: JSON.stringify({ request_id: ids.start, intent: "start", task_id: diagnosis.body.action.id, action_version: diagnosis.body.action.version }),
    });
    assert.equal(started.response.status, 200);
    assert.equal(started.body.current_action.status, "active");

    const evidence = await jsonRequest(baseUrl, `/api/v1/companion/actions/${encodeURIComponent(diagnosis.body.action.id)}/evidence`, {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "material-evidence-flow-01" },
      body: JSON.stringify({ request_id: ids.evidence, action_version: diagnosis.body.action.version, evidence: "左右极限相等，且等于函数值，所以连续。", evidence_level: 3 }),
    });
    assert.equal(evidence.response.status, 200);
    assert.equal(evidence.body.action.status, "completed");
    assert.equal(evidence.body.screen_state, "next_action_ready");
    assert.equal(evidence.body.next_action.status, "planned");

    const stale = await jsonRequest(baseUrl, `/api/v1/companion/actions/${encodeURIComponent(diagnosis.body.action.id)}/evidence`, {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "material-evidence-stale-01" },
      body: JSON.stringify({ request_id: "55555555-5555-4555-8555-555555555555", action_version: diagnosis.body.action.version, evidence: "重复提交旧行动。", evidence_level: 2 }),
    });
    assert.equal(stale.response.status, 409);
    assert.equal(stale.body.code, "action_version_conflict");

    const recoveredToday = await jsonRequest(baseUrl, "/api/v1/companion/today", { headers: auth() });
    assert.equal(recoveredToday.body.current_action.id, evidence.body.next_action.id);
    assert.equal(recoveredToday.body.current_action.status, "planned");
  } finally {
    await close(server);
  }
});

test("material diagnosis returns need_material and degrades without a provider", async () => {
  const { server } = createBackendServer({ aiEnabled: false });
  const baseUrl = await listen(server);
  try {
    const empty = await jsonRequest(baseUrl, "/api/v1/companion/diagnoses", {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "material-empty-flow-01" },
      body: JSON.stringify({ request_id: "66666666-6666-4666-8666-666666666666", artifact_ids: [] }),
    });
    assert.equal(empty.response.status, 200);
    assert.equal(empty.body.status, "need_material");

    const artifact = await jsonRequest(baseUrl, "/api/v1/learning-artifacts", {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "material-degraded-create-01" },
      body: JSON.stringify({ request_id: "77777777-7777-4777-8777-777777777777", kind: "note", subject: "408", source_title: "数据结构笔记", content_text: "链表删除节点时需要先找到前驱节点，并重新连接指针。" }),
    });
    const degraded = await jsonRequest(baseUrl, "/api/v1/companion/diagnoses", {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "material-degraded-diagnosis-01" },
      body: JSON.stringify({ request_id: "88888888-8888-4888-8888-888888888888", artifact_ids: [artifact.body.artifact.id] }),
    });
    assert.equal(degraded.response.status, 200);
    assert.equal(degraded.body.status, "degraded");
    assert.equal(degraded.body.action.origin, "recovery_template");
    assert.deepEqual(degraded.body.diagnosis.unknowns, ["还没有足够证据确认最终答案或掌握程度。"]);
    const usage = await jsonRequest(baseUrl, "/api/v1/me/ai/usage", { headers: auth() });
    assert.equal(usage.body.usage.total_runs, 1);
    assert.equal(usage.body.usage.degraded_runs, 1);
    assert.equal(usage.body.usage.degraded_rate, 1);
  } finally {
    await close(server);
  }
});

test("learning image extraction is transient, idempotent, and requires learner confirmation before material storage", async () => {
  let providerCalls = 0;
  let providerRequest = null;
  const provider = {
    async complete(request) {
      providerCalls += 1;
      providerRequest = request;
      assert.equal(request.feature, "material_image_extraction");
      assert.equal(request.imageDataUrls.length, 1);
      assert.match(request.imageDataUrls[0], /^data:image\/png;base64,/);
      return {
        source_type: "ai_assisted",
        text: JSON.stringify({
          source_title: "极限题照片",
          kind: "question",
          content_text: "求函数在 x=0 处的极限，并写出左右极限相等的判断条件。",
          uncertain_parts: ["右下角的一处手写符号不清晰"],
        }),
      };
    },
  };
  const { server } = createBackendServer({ aiEnabled: true, provider });
  const baseUrl = await listen(server);
  const requestId = "12121212-1212-4121-8121-121212121212";
  const image = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("temporary-learning-image")]);
  try {
    const extraction = await binaryRequest(baseUrl, "/api/v1/learning-image-extractions", image, {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "material-image-extract-01", "X-Request-Id": requestId },
    });
    assert.equal(extraction.response.status, 200);
    assert.equal(extraction.body.status, "ready");
    assert.equal(extraction.body.request_id, requestId);
    assert.equal(extraction.body.draft.source_title, "极限题照片");
    assert.equal(providerCalls, 1);
    assert.match(providerRequest.systemPrompt, /学习材料图片转写/);
    const providerInput = JSON.parse(providerRequest.input);
    assert.equal(providerInput.image_sha256.length, 64);
    assert.doesNotMatch(providerRequest.input, /temporary-learning-image/);

    const beforeConfirmation = await jsonRequest(baseUrl, "/api/v1/learning-artifacts", { headers: auth() });
    assert.equal(beforeConfirmation.body.artifacts.length, 0);

    const replay = await binaryRequest(baseUrl, "/api/v1/learning-image-extractions", image, {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "material-image-extract-01", "X-Request-Id": requestId },
    });
    assert.equal(replay.response.status, 200);
    assert.equal(replay.body.status, "ready");
    assert.equal(providerCalls, 1);

    const missingRequestId = await binaryRequest(baseUrl, "/api/v1/learning-image-extractions", image, {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "material-image-no-request-01" },
    });
    assert.equal(missingRequestId.response.status, 422);
    assert.equal(providerCalls, 1);

    const confirmed = await jsonRequest(baseUrl, "/api/v1/learning-artifacts", {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "material-image-confirm-01" },
      body: JSON.stringify({
        request_id: "13131313-1313-4131-8131-131313131313",
        kind: extraction.body.draft.kind,
        subject: "数学",
        source_title: extraction.body.draft.source_title,
        content_text: extraction.body.draft.content_text,
      }),
    });
    assert.equal(confirmed.response.status, 201);
    assert.equal(confirmed.body.artifact.source_title, "极限题照片");

    const invalid = await binaryRequest(baseUrl, "/api/v1/learning-image-extractions", Buffer.from("not-an-image"), {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "material-image-invalid-01", "X-Request-Id": "14141414-1414-4141-8141-141414141414" },
    });
    assert.equal(invalid.response.status, 422);
    assert.equal(invalid.body.code, "invalid_request");
  } finally {
    await close(server);
  }
});

test("learning image extraction degrades when provider output cannot be confirmed", async () => {
  const provider = { async complete() { return { source_type: "ai_assisted", text: "不是结构化转写" }; } };
  const { server } = createBackendServer({ aiEnabled: true, provider });
  const baseUrl = await listen(server);
  const image = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("temporary-learning-image")]);
  try {
    const degraded = await binaryRequest(baseUrl, "/api/v1/learning-image-extractions", image, {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "material-image-degraded-01", "X-Request-Id": "15151515-1515-4151-8151-151515151515" },
    });
    assert.equal(degraded.response.status, 200);
    assert.equal(degraded.body.status, "degraded");
    assert.equal(degraded.body.draft, null);
    const usage = await jsonRequest(baseUrl, "/api/v1/me/ai/usage", { headers: auth() });
    assert.equal(usage.body.usage.total_runs, 1);
    assert.equal(usage.body.usage.completed_runs, 0);
    assert.equal(usage.body.usage.degraded_runs, 1);
  } finally {
    await close(server);
  }
});

test("material diagnosis degrades when provider output is invalid or cites unavailable chunks", async () => {
  const invalidProvider = { async complete() { return { source_type: "ai_assisted", text: "这不是 JSON" }; } };
  const { server } = createBackendServer({ aiEnabled: true, provider: invalidProvider });
  const baseUrl = await listen(server);
  try {
    const artifact = await jsonRequest(baseUrl, "/api/v1/learning-artifacts", {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "material-invalid-create-01" },
      body: JSON.stringify({ request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "question", subject: "数学", source_title: "非法 JSON 测试", content_text: "这里有足够长的题目材料，用来验证非法 JSON 会被降级处理。" }),
    });
    const invalid = await jsonRequest(baseUrl, "/api/v1/companion/diagnoses", {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "material-invalid-diagnosis-01" },
      body: JSON.stringify({ request_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", artifact_ids: [artifact.body.artifact.id] }),
    });
    assert.equal(invalid.response.status, 200);
    assert.equal(invalid.body.status, "degraded");
    assert.equal(invalid.body.action.origin, "recovery_template");
    assert.deepEqual(invalid.body.diagnosis.unknowns, ["还没有足够证据确认最终答案或掌握程度。"]);
    const invalidUsage = await jsonRequest(baseUrl, "/api/v1/me/ai/usage", { headers: auth() });
    assert.equal(invalidUsage.body.usage.total_runs, 1);
    assert.equal(invalidUsage.body.usage.completed_runs, 0);
    assert.equal(invalidUsage.body.usage.degraded_runs, 1);
  } finally {
    await close(server);
  }

  const badReferenceProvider = {
    async complete() {
      return {
        source_type: "ai_assisted",
        text: JSON.stringify({
          observations: [{ claim: "伪造引用", artifact_id: "artifact-missing", chunk_id: "chunk-1", evidence_excerpt: "不存在的片段", confidence: 0.9 }],
          unknowns: [],
          error_tags: [],
          action: { title: "不应采用", reason: "不应采用", estimated_minutes: 5, expected_evidence: "不应采用" },
        }),
      };
    },
  };
  const badServer = createBackendServer({ aiEnabled: true, provider: badReferenceProvider }).server;
  const badBaseUrl = await listen(badServer);
  try {
    const artifact = await jsonRequest(badBaseUrl, "/api/v1/learning-artifacts", {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "material-bad-ref-create-01" },
      body: JSON.stringify({ request_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", kind: "note", subject: "408", source_title: "错误引用测试", content_text: "这是一段足够长的 408 笔记材料，用于验证引用必须来自私人材料。" }),
    });
    const invalidReference = await jsonRequest(badBaseUrl, "/api/v1/companion/diagnoses", {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "material-bad-ref-diagnosis-01" },
      body: JSON.stringify({ request_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", artifact_ids: [artifact.body.artifact.id] }),
    });
    assert.equal(invalidReference.response.status, 200);
    assert.equal(invalidReference.body.status, "degraded");
    assert.equal(invalidReference.body.action.origin, "recovery_template");
    assert.deepEqual(invalidReference.body.diagnosis.unknowns, ["还没有足够证据确认最终答案或掌握程度。"]);
    const referenceUsage = await jsonRequest(badBaseUrl, "/api/v1/me/ai/usage", { headers: auth() });
    assert.equal(referenceUsage.body.usage.total_runs, 1);
    assert.equal(referenceUsage.body.usage.completed_runs, 0);
    assert.equal(referenceUsage.body.usage.degraded_runs, 1);
  } finally {
    await close(badServer);
  }
});

test("cross-subject guidance, confirmed-memory snapshots, and action budgets stay server-grounded", async () => {
  const providerContexts = [];
  const provider = {
    async complete({ input }) {
      const context = JSON.parse(input);
      providerContexts.push(context);
      const material = context.materials[0];
      return {
        source_type: "ai_assisted",
        text: JSON.stringify({
          observations: [{
            claim: "作答没有写出原文定位句",
            artifact_id: material.artifact_id,
            chunk_id: material.chunk_id,
            evidence_excerpt: "原文定位句",
            confidence: 0.8,
          }],
          unknowns: ["未提供其他选项，不能判断所有干扰项。"],
          error_tags: ["evidence-location"],
          action: {
            title: "标出题干关键词和原文定位句",
            reason: "先用题干关键词回到原文，避免只凭印象选择。",
            estimated_minutes: 10,
            expected_evidence: "提交题干关键词、原文定位句和一个选项判断理由。",
          },
        }),
      };
    },
  };
  const { server, services } = createBackendServer({ aiEnabled: true, provider });
  const baseUrl = await listen(server);
  try {
    const actor = (await services.identity.authenticate({ authorization: auth().Authorization })).actorId;
    await services.database.set(`user:state:${actor}`, { profile: { daily_minutes: "10", timezone: "Asia/Shanghai" }, goal_id: "goal-exam" });
    const candidate = await services.memory.recordIteration(actor, {
      request_id: "16161616-1616-4161-8161-161616161616",
      iteration_id: "iteration-snapshot-001",
      goal_scope: "goal-exam",
      goal_title: "计算机考研",
      task_id: "task-snapshot-001",
      evidence_level: 2,
      evidence: "我先把阅读题的题干关键词和定位句写下来。",
      review: { problem: "总是凭印象选阅读题。", reason: "没有回到原文定位。", next_action: "先圈题干关键词和定位句。" },
    }, "memory-snapshot-candidate-01");
    assert.equal(candidate.response.candidates.every((memory) => memory.status === "candidate"), true);

    for (const subject of ["数学一", "数学二", "数学三", "408", "计算机自命题", "英语一", "英语二", "政治"]) {
      const guidance = await jsonRequest(baseUrl, `/api/v1/knowledge/learning-guidance?subject=${encodeURIComponent(subject)}&q=${encodeURIComponent("错题 复盘")}`, { headers: auth() });
      assert.equal(guidance.response.status, 200);
      assert.ok(guidance.body.results.length > 0, subject);
      assert.equal(guidance.body.results[0].provenance.evidence_boundary, "not_for_admission_facts");
    }

    const artifact = await jsonRequest(baseUrl, "/api/v1/learning-artifacts", {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "cross-subject-artifact-01" },
      body: JSON.stringify({
        request_id: "17171717-1717-4171-8171-171717171717",
        kind: "attempt_draft",
        subject: "英语一",
        source_title: "英语阅读定位草稿",
        content_text: "这道阅读题我只凭感觉选择，没有写出题干关键词和原文定位句，也没有说明选项差异。",
      }),
    });
    const first = await jsonRequest(baseUrl, "/api/v1/companion/diagnoses", {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "cross-subject-diagnosis-01" },
      body: JSON.stringify({ request_id: "18181818-1818-4181-8181-181818181818", artifact_ids: [artifact.body.artifact.id], subject: "英语一", focus: "阅读定位" }),
    });
    assert.equal(first.response.status, 200);
    assert.equal(first.body.status, "ready");
    assert.equal(first.body.action.estimated_minutes, 10);
    assert.ok(first.body.action.knowledge_node_refs.includes("english.reading-evidence"));
    assert.ok(first.body.guidance_evidence.some((item) => item.id === "english.reading-evidence"));
    assert.equal(first.body.learner_snapshot.confirmed_memories.length, 0);
    assert.equal(providerContexts[0].context.learner_snapshot.action_budget_minutes, 10);
    assert.equal(providerContexts[0].context.learner_snapshot.confirmed_memories.length, 0);
    assert.match(providerContexts[0].output_contract.action.estimated_minutes, /10/);

    const confirmed = await services.memory.updateMemory(actor, candidate.response.candidates[0].id, {
      request_id: "19191919-1919-4191-8191-191919191919",
      action: "confirm",
    }, "memory-snapshot-confirm-01");
    assert.equal(confirmed.response.memory.status, "active");
    const snapshot = await jsonRequest(baseUrl, "/api/v1/me/learning-snapshot", { headers: auth() });
    assert.equal(snapshot.response.status, 200);
    assert.equal(snapshot.body.snapshot.current_action.id, first.body.action.id);
    assert.ok(snapshot.body.snapshot.confirmed_memories.some((memory) => memory.id === candidate.response.candidates[0].id));

    const second = await jsonRequest(baseUrl, "/api/v1/companion/diagnoses", {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "cross-subject-diagnosis-02" },
      body: JSON.stringify({ request_id: "20202020-2020-4202-8202-202020202020", artifact_ids: [artifact.body.artifact.id], subject: "英语一", focus: "阅读定位" }),
    });
    assert.equal(second.response.status, 200);
    assert.ok(providerContexts[1].context.learner_snapshot.confirmed_memories.some((memory) => memory.id === candidate.response.candidates[0].id));

    assert.throws(() => validateProviderDiagnosis({
      observations: [{ claim: "定位不足", artifact_id: "artifact-1", chunk_id: "chunk-1", evidence_excerpt: "原文定位句", confidence: 0.8 }],
      unknowns: [],
      error_tags: [],
      action: { title: "超出预算", reason: "不应通过", estimated_minutes: 15, expected_evidence: "不应通过" },
    }, [{ artifact_id: "artifact-1", chunk_id: "chunk-1", excerpt: "原文定位句" }], 10), /duration/);
  } finally {
    await close(server);
  }
});

test("a fresh API process rebuilds the current action and learning evidence from persisted facts", async () => {
  const database = new InMemoryDatabase();
  const clock = () => Date.UTC(2026, 8, 20, 12, 0, 0);
  const provider = {
    async complete({ input }) {
      const material = JSON.parse(input).materials[0];
      return {
        source_type: "ai_assisted",
        text: JSON.stringify({
          observations: [{
            claim: "作答还没有逐项辨析选项",
            artifact_id: material.artifact_id,
            chunk_id: material.chunk_id,
            evidence_excerpt: "没有逐项写出选项的限定词",
            confidence: 0.78,
          }],
          unknowns: ["没有提供完整选项，不能判断其他选项。"],
          error_tags: ["option-discernment"],
          action: {
            title: "写出一个错误项的限定词和排除理由",
            reason: "先把选项拆成概念与限定词，避免只记答案。",
            estimated_minutes: 10,
            expected_evidence: "提交一个错误项的限定词和排除理由。",
          },
        }),
      };
    },
  };
  const first = createBackendServer({ database, clock, aiEnabled: true, provider });
  const firstUrl = await listen(first.server);
  try {
    const artifact = await jsonRequest(firstUrl, "/api/v1/learning-artifacts", {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "restart-artifact-01" },
      body: JSON.stringify({
        request_id: "21212121-2121-4212-8212-212121212121",
        kind: "attempt_draft",
        subject: "政治",
        source_title: "政治选择题草稿",
        content_text: "我选了答案，但没有逐项写出选项的限定词，也没有说明为什么要排除错误项。",
      }),
    });
    const diagnosis = await jsonRequest(firstUrl, "/api/v1/companion/diagnoses", {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": "restart-diagnosis-01" },
      body: JSON.stringify({ request_id: "22222222-2121-4212-8212-212121212121", artifact_ids: [artifact.body.artifact.id], subject: "政治", focus: "选择题限定词" }),
    });
    assert.equal(diagnosis.body.status, "ready");
    assert.ok(diagnosis.body.action.knowledge_node_refs.includes("politics.choice-discernment"));
  } finally {
    await close(first.server);
  }

  const restarted = createBackendServer({ database, clock, aiEnabled: false });
  const restartedUrl = await listen(restarted.server);
  try {
    const today = await jsonRequest(restartedUrl, "/api/v1/companion/today", { headers: auth() });
    assert.equal(today.response.status, 200);
    assert.equal(today.body.current_action.title, "写出一个错误项的限定词和排除理由");
    assert.ok(today.body.retrieved_evidence.some((item) => item.artifact_id === "artifact-material-flow-001") === false);
    assert.ok(today.body.retrieved_evidence.some((item) => item.title === "政治选择题草稿"));
    assert.ok(today.body.guidance_evidence.some((item) => item.id === "politics.choice-discernment"));

    const snapshot = await jsonRequest(restartedUrl, "/api/v1/me/learning-snapshot", { headers: auth() });
    assert.equal(snapshot.response.status, 200);
    assert.equal(snapshot.body.snapshot.current_action.id, today.body.current_action.id);
    assert.ok(snapshot.body.snapshot.recent_materials.some((item) => item.source_title === "政治选择题草稿"));
    assert.doesNotMatch(JSON.stringify(snapshot.body.snapshot), /没有逐项写出选项/);
  } finally {
    await close(restarted.server);
  }
});
