const test = require("node:test");
const assert = require("node:assert/strict");
const { createBackendServer } = require("../../services/api/src/bootstrap/http-api.ts");

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
