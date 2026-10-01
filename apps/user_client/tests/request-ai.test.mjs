import test from "node:test";
import assert from "node:assert/strict";

const { requestAi, requestLearningRoute, requestMaterialReview } = await import("../src/app.js");

test("AI client retries a lost response with the same request id and idempotency key", async () => {
  const calls = [];
  let attempt = 0;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options: { ...options } });
      attempt += 1;
      if (attempt === 1) throw new Error("connection reset");
      return {
        ok: true,
        status: 200,
        async json() {
          return { status: "completed", result: { text: JSON.stringify({ type: "answer", message: "可以" }) } };
        },
      };
    };

    const result = await requestAi("/api/v1/ai/assist", {
      companion_id: "lijing-guide-fan-v2",
      prompt: "请给我一个可执行的学习动作",
      context: { goal_type: "personal_growth" },
    });

    assert.deepEqual(result, { answer: "可以", suggestions: [] });
    assert.equal(calls.length, 2);
    const firstBody = JSON.parse(calls[0].options.body);
    const secondBody = JSON.parse(calls[1].options.body);
    assert.equal(firstBody.request_id, secondBody.request_id);
    assert.equal(calls[0].options.headers["Idempotency-Key"], calls[1].options.headers["Idempotency-Key"]);
    assert.equal(calls[0].options.headers["Idempotency-Key"], firstBody.request_id);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("review request opts into the strict evidence-review format", async () => {
  const originalFetch = globalThis.fetch;
  let submittedBody;
  try {
    globalThis.fetch = async (_url, options) => ({
      ok: true,
      status: 200,
      async json() {
        submittedBody = JSON.parse(options.body);
        return {
          status: "completed",
          result: {
            text: JSON.stringify({
              evidence_used: "独立完成一道段落翻译，并标记了时态卡点。",
              problem: "时态选择还需要核对上下文。",
              reason: "提交内容明确记录了时态判断不确定。",
              next_action: "明天用 10 分钟重译这句话并解释时态选择。",
            }),
          },
        };
      },
    });

    const result = await requestAi("/api/v1/ai/review", {
      task: "完成一条翻译练习",
      answer: "I have finished the task.",
      evidence_level: 2,
      evidence: "独立完成一道段落翻译，并标记了时态卡点。",
    });

    assert.equal(result.review.problem, "时态选择还需要核对上下文。");
    assert.equal(submittedBody.feature, "wrong_answer_hint");
    assert.equal(JSON.parse(submittedBody.input).response_format, "lijing_evidence_review_v1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("review client rejects provider output that is not the complete strict JSON contract", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      async json() {
        return { status: "completed", result: { text: "复习一下时态就好。" } };
      },
    });

    await assert.rejects(
      requestAi("/api/v1/ai/review", { evidence: "我完成了一道题。", evidence_level: 1 }),
      (error) => error.code === "AI_REVIEW_FORMAT_INVALID" && !error.message.includes("复习一下时态"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("material evidence review distinguishes AI output from a rule fallback", async () => {
  const aiReview = {
    evidenceUsed: "已完成一段翻译，并标出时态疑问。",
    problem: "时态选择还需要核对上下文。",
    reason: "提交内容记录了判断依据和疑问。",
    nextAction: "明天用 10 分钟重译并解释时态选择。",
  };
  let reviewRequest;
  const completed = await requestMaterialReview({
    task: "完成一条翻译练习",
    evidence: aiReview.evidenceUsed,
    evidenceLevel: 2,
    context: { goal: "大学英语四级" },
  }, async (path, payload) => {
    reviewRequest = { path, payload };
    return { review: aiReview };
  });

  assert.deepEqual(completed, { review: aiReview, reviewReady: true, reviewError: "" });
  assert.equal(reviewRequest.path, "/api/v1/ai/review");
  assert.equal(reviewRequest.payload.evidence_level, 2);
  assert.equal(reviewRequest.payload.answer, aiReview.evidenceUsed);

  const error = Object.assign(new Error("AI 暂时没有响应"), { code: "dependency_unavailable" });
  const fallback = await requestMaterialReview({
    task: "完成一条翻译练习",
    evidence: aiReview.evidenceUsed,
    evidenceLevel: 2,
    context: {},
  }, async () => { throw error; });

  assert.equal(fallback.reviewReady, false);
  assert.match(fallback.review.reason, /规则复盘/);
  assert.equal(fallback.reviewError, error.message);
});

test("learning route retry keeps one idempotent request", async () => {
  const calls = [];
  let attempt = 0;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options: { ...options } });
      attempt += 1;
      if (attempt === 1) throw new Error("connection reset");
      return {
        ok: true,
        status: 200,
        async json() {
          return { status: "clarification_required", questions: ["目标日期是什么？"] };
        },
      };
    };

    const result = await requestLearningRoute({ goal: { type: "postgraduate_entrance_exam" } });

    assert.deepEqual(result, { status: "clarification_required", questions: ["目标日期是什么？"] });
    assert.equal(calls.length, 2);
    const firstBody = JSON.parse(calls[0].options.body);
    const secondBody = JSON.parse(calls[1].options.body);
    assert.equal(firstBody.request_id, secondBody.request_id);
    assert.equal(calls[0].options.headers["Idempotency-Key"], calls[1].options.headers["Idempotency-Key"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a route 503 is shown without replaying the same request; a manual retry gets a new id", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options: { ...options } });
      return {
        ok: false,
        status: 503,
        async json() {
          return { code: "dependency_unavailable", message: "AI 服务暂时不可用，请稍后再试", retryable: true };
        },
      };
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(
        requestLearningRoute({ goal_type: "college_english_exam", goal_name: "大学英语四级" }),
        (error) => error.status === 503 && error.retryable && error.message === "AI 服务暂时不可用，请稍后再试",
      );
    }

    assert.equal(calls.length, 2);
    const first = JSON.parse(calls[0].options.body);
    const second = JSON.parse(calls[1].options.body);
    assert.notEqual(first.request_id, second.request_id);
    assert.notEqual(calls[0].options.headers["Idempotency-Key"], calls[1].options.headers["Idempotency-Key"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
