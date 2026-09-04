# 考研决策工作台与计划自律联动实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有砺境基础仓库中实现一个可运行的考研决策纵向链路：用户可以选择或获得推荐的院校专业，查看可追溯的评估，生成并确认学习计划，连接提醒与自律记录，并在演示数据刷新后查看变化。

**Architecture:** 新增 `Postgraduate Decision` 应用模块和可替换的 `Education Data` 适配器。规则引擎负责筛选、分档和计划计算；AI 只解释结构化结果，不能创造学校、分数或薪资事实。由于当前仓库还没有 HTTP 应用和前端运行时，首期提供一个 Node 22 原生 HTTP demo 与无框架浏览器页面，业务服务通过 Planning/Notification 应用接口协作。

**Tech Stack:** Node 22 native TypeScript strip-types、CommonJS、`node:test`、OpenAPI 3.1、AJV/Redocly 现有契约工具、Node built-in `http`、原生 HTML/CSS/ES modules。

---

## 0. 文件地图

实现前先按下面的职责建立文件，不把所有逻辑塞进一个 service：

| 文件 | 职责 |
|---|---|
| `docs/architecture/module-boundaries.md` | 登记 `Postgraduate Decision` 与 `Education Data` 的所有权和依赖边界 |
| `packages/contracts/openapi.yaml` | 院校专业查询、画像、目标、推荐、计划、更新和自律记录的 `/api/v1` 契约 |
| `tests/contract/contract-lint.test.ts` | 新操作的安全、幂等、服务端权威结果和 schema fixture 检查 |
| `services/api/src/postgraduate/domain/types.ts` | 决策、证据、画像、计划和更新所需的运行时常量与类型 |
| `services/api/src/postgraduate/data/education-data.ts` | 教育数据端口、演示目录、数据快照和变化读取 |
| `services/api/src/postgraduate/decision/profile.ts` | 画像输入的边界校验和规范化 |
| `services/api/src/postgraduate/decision/assessment.ts` | 目标院校专业的硬条件、维度评分和三档评估 |
| `services/api/src/postgraduate/decision/recommendation.ts` | 根据画像筛选、排序和保证多样性的推荐 |
| `services/api/src/platform/http/idempotency.ts` | 可复用的请求指纹和进程内幂等执行器 |
| `services/api/src/postgraduate/application/postgraduate-decision-service.ts` | 保存画像/目标、生成评估/推荐、生成草稿和确认计划的应用编排 |
| `services/api/src/postgraduate/planning/plan-generator.ts` | 根据考试日期和投入时间生成确定性的阶段、周、日任务 |
| `services/api/src/planning/application/planning-port.ts` | Planning 模块的应用接口 |
| `services/api/src/planning/in-memory-planning-service.ts` | demo/test 使用的计划与任务完成记录实现 |
| `services/api/src/notification/application/notification-port.ts` | Notification 模块的提醒意图接口 |
| `services/api/src/notification/in-memory-notification-service.ts` | demo/test 使用的提醒意图实现 |
| `services/api/src/postgraduate/ai/explanation.ts` | 结构化证据校验、模板解释和 AI 结果降级 |
| `tools/postgraduate-demo/server.mjs` | 启动 demo HTTP 服务并把 API 路由到应用服务 |
| `apps/user_client/postgraduate/index.html` | 考研决策工作台页面骨架 |
| `apps/user_client/postgraduate/app.mjs` | 页面状态、API 请求和交互渲染 |
| `apps/user_client/postgraduate/styles.css` | 砺境工具化视觉、响应式、焦点和减少动画样式 |
| `tests/unit/postgraduate/*.test.ts` | 教育数据、画像、评估、推荐、计划和解释的单元测试 |
| `tests/integration/postgraduate-decision-service.test.ts` | 应用服务、幂等、跨模块接口和服务端权威结果测试 |
| `tests/postgraduate-demo.test.mjs` | demo HTTP、静态页面和关键 API 流程烟测 |

所有新增 TypeScript 文件沿用仓库现有 `.ts` + `module.exports` 风格；不引入 ORM、Web 框架或 provider SDK。

## Task 1: 锁定契约与模块边界

**Files:**
- Modify: `docs/architecture/module-boundaries.md`
- Modify: `packages/contracts/openapi.yaml`
- Modify: `tests/contract/contract-lint.test.ts`

- [ ] **Step 1: 先写会失败的契约测试**

在 `tests/contract/contract-lint.test.ts` 的 `OPERATION_SECURITY` 中加入下面这些预期操作，并新增一个测试，先让它因为 OpenAPI 路径不存在而失败：

```ts
const POSTGRADUATE_OPERATIONS = [
  "GET /api/v1/postgraduate/programs",
  "GET /api/v1/postgraduate/programs/{program_id}",
  "GET /api/v1/me/postgraduate/profile",
  "PUT /api/v1/me/postgraduate/profile",
  "POST /api/v1/me/postgraduate/targets",
  "POST /api/v1/me/postgraduate/recommendations",
  "GET /api/v1/me/postgraduate/targets/{target_id}/assessment",
  "POST /api/v1/me/postgraduate/targets/{target_id}/plan-drafts",
  "POST /api/v1/me/postgraduate/plan-drafts/{draft_id}/confirm",
  "POST /api/v1/me/postgraduate/self-discipline-records",
  "GET /api/v1/me/postgraduate/updates",
];

test("postgraduate operations expose evidence and reject client-owned conclusions", async () => {
  const api = await parseAndValidateOpenApi(readRequired("packages/contracts/openapi.yaml"));
  const operations = new Set(listOperations(api).map(({ method, pathTemplate }) => `${method.toUpperCase()} ${pathTemplate}`));

  for (const operation of POSTGRADUATE_OPERATIONS) {
    assert.ok(operations.has(operation), `missing operation: ${operation}`);
  }

  const targetRequest = api.paths["/api/v1/me/postgraduate/targets"].post.requestBody.content["application/json"].schema;
  assert.ok(targetRequest.required.includes("request_id"));
  assert.equal(targetRequest.properties.decision_level, undefined);
  assert.equal(targetRequest.properties.score_gap, undefined);

  const assessment = api.components.schemas.PostgraduateAssessmentResponse;
  assert.ok(assessment.required.includes("data_snapshot_id"));
  assert.ok(assessment.required.includes("rule_version"));
  assert.ok(assessment.required.includes("evidence"));
});
```

Run:

```text
pnpm contract:lint
```

Expected: FAIL because the new paths and schema are not present yet. The failure must mention a missing operation or schema, not a malformed test.

- [ ] **Step 2: Add the versioned OpenAPI operations**

Add a `postgraduate` tag and the following paths to `packages/contracts/openapi.yaml`. Every write request must require `request_id`, include the existing `Idempotency-Key` parameter, and define `401` and `403` responses:

```yaml
  /api/v1/postgraduate/programs:
    get:
      tags: [postgraduate]
      operationId: searchPostgraduatePrograms
      summary: Search postgraduate programs
      security:
        - bearerAuth: []
      parameters:
        - { name: query, in: query, required: false, schema: { type: string, maxLength: 100 } }
        - { name: region, in: query, required: false, schema: { type: string, maxLength: 64 } }
        - { name: max_results, in: query, required: false, schema: { type: integer, minimum: 1, maximum: 20, default: 10 } }
      responses:
        '200':
          description: Search results with snapshot and demo status.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PostgraduateProgramSearchResponse'
        '401': { $ref: '#/components/responses/Unauthorized' }

  /api/v1/postgraduate/programs/{program_id}:
    get:
      tags: [postgraduate]
      operationId: getPostgraduateProgram
      summary: Read a postgraduate program and its evidence
      security:
        - bearerAuth: []
      parameters:
        - { name: program_id, in: path, required: true, schema: { type: string, minLength: 1, maxLength: 100 } }
      responses:
        '200':
          description: Program detail with source metadata.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/PostgraduateProgramDetailResponse' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/ValidationError' }

  /api/v1/me/postgraduate/profile:
    get:
      tags: [postgraduate]
      operationId: getMyPostgraduateProfile
      summary: Read my postgraduate decision profile
      security:
        - bearerAuth: []
      responses:
        '200':
          description: Current profile or an empty profile projection.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/PostgraduateProfileResponse' }
        '401': { $ref: '#/components/responses/Unauthorized' }
    put:
      tags: [postgraduate]
      operationId: saveMyPostgraduateProfile
      summary: Save my postgraduate decision profile
      security:
        - bearerAuth: []
      parameters:
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/PostgraduateProfileWriteRequest' }
      responses:
        '200':
          description: Normalized profile.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/PostgraduateProfileResponse' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '409': { $ref: '#/components/responses/IdempotencyConflict' }
        '422': { $ref: '#/components/responses/ValidationError' }
```

Add equivalent operations for targets, recommendations, assessment, plan drafts, confirmation, self-discipline records, and updates. The write schemas must use these explicit fields:

- `PostgraduateTargetWriteRequest`: `request_id`, `program_id`, optional `note`; no `decision_level`, `score`, `completed`, `reward`, `salary`, or `probability` fields.
- `PostgraduateRecommendationRequest`: `request_id`, profile fields, and `max_results`; no client-provided ranking or result list.
- `PostgraduatePlanDraftRequest`: `request_id`, `target_id`, `exam_date`, `daily_minutes`, `plan_mode`, `reminder_enabled`; no client-provided generated tasks or completion state.
- `PostgraduatePlanConfirmRequest`: `request_id`, `draft_id`, `action` with `confirm` or `reject`.
- `PostgraduateSelfDisciplineRecordRequest`: `request_id`, `record_date`, `title`, `subject`, `actual_minutes`, `outcome` with `completed`, `deferred`, or `cancelled`; no client-provided progress percentage.

Add these schemas with `additionalProperties: false`: `PostgraduateEvidence`, `PostgraduateProgramSummary`, `PostgraduateProgramDetailResponse`, `PostgraduateProgramSearchResponse`, `PostgraduateProfileWriteRequest`, `PostgraduateProfileResponse`, `PostgraduateTargetResponse`, `PostgraduateAssessmentResponse`, `PostgraduateRecommendationResponse`, `PostgraduateRecommendationsResponse`, `PostgraduatePlanDraftResponse`, `PostgraduatePlanConfirmResponse`, `PostgraduateSelfDisciplineRecordResponse`, and `PostgraduateUpdatesResponse`.

The assessment and recommendation response schemas must require `data_snapshot_id`, `rule_version`, `generated_at`, `evidence`, `risks`, and `next_actions`. `decision_level` may be `reach`, `match`, `safer`, or `null` when `eligibility` is `blocked` or `unknown`. There must be no probability field.

- [ ] **Step 3: Register explicit operation security and schema fixtures**

Map every new operation to `"bearer"` in `OPERATION_SECURITY`. Extend the contract tests so that:

```ts
for (const operation of POSTGRADUATE_OPERATIONS) {
  assert.equal(OPERATION_SECURITY[operation], "bearer");
}

const validateAssessment = compileOpenApiSchema(api, "PostgraduateAssessmentResponse");
assert.equal(validateAssessment({
  request_id: "11111111-1111-4111-8111-111111111111",
  target_id: "demo-target-001",
  eligibility: "eligible",
  decision_level: "match",
  rule_version: "postgraduate-rules-v1",
  data_snapshot_id: "demo-postgraduate-v1",
  generated_at: "2026-09-03T00:00:00.000Z",
  evidence: [{
    source_type: "demo",
    source_reference: "demo-fixture",
    data_year: 2026,
    observed_at: "2026-09-03T00:00:00.000Z",
  }],
  dimensions: [],
  risks: [],
  next_actions: [],
}), true);
```

The fixture is explicitly `source_type: demo`; production adapters may use `official`, `market_sample`, or `inferred`. Add a negative fixture proving a target request containing `decision_level` is rejected by AJV.

- [ ] **Step 4: Update the module boundary document**

Add rows for `Postgraduate Decision` and `Education Data` to `docs/architecture/module-boundaries.md`. State that Postgraduate Decision owns user targets, comparisons, assessment snapshots, recommendation snapshots, and plan-draft state; Education Data owns normalized facts, source metadata, snapshots, and changes; Planning and Notification are called through application interfaces only.

- [ ] **Step 5: Run the contract suite and commit**

Run:

```text
pnpm contract:lint
git diff --check
```

Expected: all existing and new contract tests pass, with no unresolved references or trailing whitespace.

Commit:

```text
git add docs/architecture/module-boundaries.md packages/contracts/openapi.yaml tests/contract/contract-lint.test.ts
git commit -m "feat: define postgraduate decision contracts"
```

## Task 2: Build the education data port and transparent demo catalog

**Files:**
- Create: `services/api/src/postgraduate/domain/types.ts`
- Create: `services/api/src/postgraduate/data/education-data.ts`
- Create: `tests/unit/postgraduate/education-data.test.ts`

- [ ] **Step 1: Write failing catalog tests**

Create tests for search, detail, evidence, demo labeling, empty results, and updates:

```ts
const assert = require("node:assert/strict");
const test = require("node:test");
const { createDemoEducationDataCatalog } = require("../../../services/api/src/postgraduate/data/education-data.ts");

test("demo catalog returns bounded program summaries with an explicit demo snapshot", () => {
  const catalog = createDemoEducationDataCatalog();
  const result = catalog.search({ query: "计算机", maxResults: 2 });

  assert.equal(result.data_mode, "demo");
  assert.equal(result.programs.length <= 2, true);
  assert.ok(result.programs.every((program) => program.program_id));
  assert.equal(result.data_snapshot_id, "demo-postgraduate-v1");
});

test("program detail preserves evidence for every decision-sensitive metric", () => {
  const catalog = createDemoEducationDataCatalog();
  const program = catalog.getById("demo-program-001");

  assert.equal(program.data_mode, "demo");
  assert.ok(program.evidence.some((item) => item.metric === "preliminary_line"));
  assert.ok(program.evidence.some((item) => item.metric === "salary_range"));
  assert.ok(program.evidence.every((item) => item.source_reference));
});

test("unknown program and empty search return honest empty results", () => {
  const catalog = createDemoEducationDataCatalog();

  assert.equal(catalog.getById("missing-program"), undefined);
  assert.deepEqual(catalog.search({ query: "不存在的专业" }).programs, []);
});

test("updates are snapshots and do not mutate the current program", () => {
  const catalog = createDemoEducationDataCatalog();
  const updates = catalog.listUpdates("demo-program-001");
  const current = catalog.getById("demo-program-001");

  assert.ok(Array.isArray(updates));
  assert.equal(current.data_snapshot_id, "demo-postgraduate-v1");
  assert.ok(updates.every((update) => update.data_snapshot_id));
});
```

Run:

```text
node --no-warnings --test tests/unit/postgraduate/education-data.test.ts
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 2: Define the shared runtime vocabulary**

In `types.ts`, define the runtime constants and type-only structures used by later tasks:

```ts
const SOURCE_TYPES = Object.freeze(["official", "market_sample", "inferred", "demo"]);
const DATA_MODES = Object.freeze(["demo", "production"]);
const DECISION_LEVELS = Object.freeze(["reach", "match", "safer"]);
const PLAN_MODES = Object.freeze(["auto", "hybrid", "manual"]);
const TASK_OUTCOMES = Object.freeze(["completed", "deferred", "cancelled"]);

module.exports = {
  SOURCE_TYPES,
  DATA_MODES,
  DECISION_LEVELS,
  PLAN_MODES,
  TASK_OUTCOMES,
};
```

The type shape for a program must include `program_id`, institution and program names, discipline, region, exam subjects, duration, tuition, cross-major policy, competition band, decision-sensitive metrics, `data_mode`, `data_snapshot_id`, and metric-level evidence. Evidence must contain `metric`, `source_type`, `source_reference`, `data_year`, and `observed_at`.

- [ ] **Step 3: Implement the adapter with synthetic records only**

In `education-data.ts`, implement `EducationDataCatalog` with this API:

```ts
class EducationDataCatalog {
  search({ query = "", region, maxResults = 10 } = {}) {}
  getById(programId) {}
  listUpdates(programId) {}
  getSnapshot() {}
}

function createDemoEducationDataCatalog() {}

module.exports = { EducationDataCatalog, createDemoEducationDataCatalog };
```

Use three clearly synthetic records with IDs `demo-program-001`, `demo-program-002`, and `demo-program-003`; names must contain `演示` or `Demo`, and every record must expose `data_mode: "demo"` and `data_snapshot_id: "demo-postgraduate-v1"`. Do not use a real institution name or present fixture values as current official statistics.

Use deterministic case-insensitive matching over institution name, program name, discipline, region, and exam subject. Clamp `maxResults` to 1 through 20. Return a new array and frozen metadata so callers cannot mutate the catalog.

The demo snapshot must contain at least one synthetic update per program with `previous_value`, `current_value`, `changed_at`, and `data_snapshot_id: "demo-postgraduate-v1"`. `listUpdates` must return copies sorted newest first.

- [ ] **Step 4: Run the data tests and commit**

Run:

```text
node --no-warnings --test tests/unit/postgraduate/education-data.test.ts
git diff --check
```

Expected: all data tests pass and the demo label is present in every response.

Commit:

```text
git add services/api/src/postgraduate/domain/types.ts services/api/src/postgraduate/data/education-data.ts tests/unit/postgraduate/education-data.test.ts
git commit -m "feat: add postgraduate education data adapter"
```

## Task 3: Implement profile normalization, assessment, and recommendation rules

**Files:**
- Create: `services/api/src/postgraduate/decision/profile.ts`
- Create: `services/api/src/postgraduate/decision/assessment.ts`
- Create: `services/api/src/postgraduate/decision/recommendation.ts`
- Create: `tests/unit/postgraduate/profile-and-decision.test.ts`

- [ ] **Step 1: Write failing profile and decision tests**

Add tests for bounded inputs, hard blocks, missing baseline, dimension explanations, no probability, and diverse recommendations:

```ts
const assert = require("node:assert/strict");
const test = require("node:test");
const { createDemoEducationDataCatalog } = require("../../../services/api/src/postgraduate/data/education-data.ts");
const { normalizeProfile } = require("../../../services/api/src/postgraduate/decision/profile.ts");
const { assessProgram } = require("../../../services/api/src/postgraduate/decision/assessment.ts");
const { recommendPrograms } = require("../../../services/api/src/postgraduate/decision/recommendation.ts");

const profileInput = {
  undergraduate_major: "计算机相关专业",
  english_level: "medium",
  mathematics_level: "medium",
  preferred_regions: ["演示地区A"],
  max_tuition_cny_per_year: 20000,
  accepts_cross_major: true,
  target_directions: ["软件工程"],
  daily_minutes: 180,
  expected_score: 330,
  exam_date: "2027-12-25",
};

test("profile normalization rejects unbounded values and keeps only declared fields", () => {
  assert.throws(
    () => normalizeProfile({ ...profileInput, daily_minutes: 99999 }),
    /daily_minutes/,
  );
  const profile = normalizeProfile(profileInput);
  assert.equal(profile.daily_minutes, 180);
  assert.equal(profile.unexpected, undefined);
});

test("assessment blocks a cross-major target that does not accept cross-major applicants", () => {
  const catalog = createDemoEducationDataCatalog();
  const program = { ...catalog.getById("demo-program-003"), accepts_cross_major: false };
  const assessment = assessProgram({ profile: normalizeProfile(profileInput), program });

  assert.equal(assessment.eligibility, "blocked");
  assert.equal(assessment.decision_level, null);
  assert.ok(assessment.risks.some((risk) => risk.code === "cross_major_not_allowed"));
});

test("assessment explains a low baseline as reach without publishing probability", () => {
  const catalog = createDemoEducationDataCatalog();
  const profile = normalizeProfile({ ...profileInput, expected_score: 250 });
  const assessment = assessProgram({ profile, program: catalog.getById("demo-program-001") });

  assert.equal(assessment.eligibility, "eligible");
  assert.equal(assessment.decision_level, "reach");
  assert.ok(assessment.risks.some((risk) => risk.code === "score_gap"));
  assert.equal(Object.hasOwn(assessment, "probability"), false);
});

test("recommendations contain multiple levels and respect accepted cross-major scope", () => {
  const catalog = createDemoEducationDataCatalog();
  const recommendations = recommendPrograms({
    profile: normalizeProfile(profileInput),
    programs: catalog.search({ maxResults: 20 }).programs,
    maxResults: 5,
  });

  assert.ok(recommendations.length > 0);
  assert.ok(recommendations.length <= 5);
  assert.ok(recommendations.every((item) => item.evidence.length > 0));
  assert.ok(new Set(recommendations.map((item) => item.decision_level)).size >= 2);
});
```

Run and confirm the expected missing-module failures:

```text
node --no-warnings --test tests/unit/postgraduate/profile-and-decision.test.ts
```

- [ ] **Step 2: Implement profile normalization**

`normalizeProfile(input)` must return a frozen object containing only declared fields. Enforce these bounds:

```ts
const PROFILE_LIMITS = Object.freeze({
  undergraduate_major: [1, 100],
  preferred_regions: [0, 5],
  target_directions: [0, 5],
  max_tuition_cny_per_year: [0, 1000000],
  daily_minutes: [30, 960],
  expected_score: [0, 500],
});
```

`english_level` and `mathematics_level` accept `low`, `medium`, or `high`; `exam_date` must be a future `YYYY-MM-DD` date; arrays are deduplicated and bounded. Missing optional baseline values remain `undefined` and are represented as an explicit missing-data risk by the assessment engine.

- [ ] **Step 3: Implement deterministic assessment rules**

In `assessment.ts`, use a fixed `RULE_VERSION = "postgraduate-rules-v1"` and these weights:

```ts
const DIMENSION_WEIGHTS = Object.freeze({
  readiness: 30,
  exam_fit: 20,
  direction_fit: 15,
  region_fit: 10,
  cost_fit: 10,
  competition: 15,
});
```

Implement `assessProgram({ profile, program, now = () => new Date().toISOString() })` with this order:

1. Check `accepts_cross_major`; return `eligibility: "blocked"`, `decision_level: null`, and a `cross_major_not_allowed` risk when the user accepts cross-major but the program does not.
2. Check missing or invalid program facts; return `eligibility: "unknown"` when a required fact cannot be evaluated.
3. Calculate readiness from `expected_score - preliminary_line`: at least 15 points above line is high, at or above line is medium-high, within 10 points below is medium-low, and farther below is low.
4. Calculate exam fit from subject overlap and language/math self-assessment.
5. Calculate direction and region fit from exact or normalized label overlap.
6. Calculate cost fit from the user's maximum tuition; missing budget produces a neutral dimension and a `budget_not_provided` note.
7. Calculate competition from the program's `low`, `medium`, or `high` competition band.
8. Store the internal ranking score for sorting, but do not include a probability or claim of admission.
9. Map the score to `reach` below 55, `match` from 55 through 74, and `safer` at 75 or above. `safer` means relatively lower decision risk, never guaranteed admission.

Return:

```ts
{
  eligibility: "eligible" | "blocked" | "unknown",
  decision_level: "reach" | "match" | "safer" | null,
  dimensions: [{ code, label, band, reason, evidence_ids }],
  risks: [{ code, severity: "low" | "medium" | "high", label, action }],
  next_actions: [{ code, label }],
  evidence: [...program.evidence],
  rule_version: "postgraduate-rules-v1",
  data_snapshot_id: program.data_snapshot_id,
  generated_at: now(),
  internal_rank_score: number,
}
```

- [ ] **Step 4: Implement recommendation filtering and diversity**

`recommendPrograms({ profile, programs, maxResults = 5 })` must:

- discard programs blocked by cross-major policy;
- rank the remainder by `internal_rank_score`, then by lower competition, then stable `program_id`;
- select at most two items per decision level before filling remaining slots;
- avoid duplicate `institution_id` when another level is available;
- return only structured assessment objects with evidence and risks;
- return `[]` when no candidate satisfies hard constraints.

Do not use randomization, live model output, or a probability calculation.

- [ ] **Step 5: Run unit tests and commit**

Run:

```text
node --no-warnings --test tests/unit/postgraduate/profile-and-decision.test.ts
git diff --check
```

Expected: profile, assessment, and recommendation tests pass.

Commit:

```text
git add services/api/src/postgraduate/decision/profile.ts services/api/src/postgraduate/decision/assessment.ts services/api/src/postgraduate/decision/recommendation.ts tests/unit/postgraduate/profile-and-decision.test.ts
git commit -m "feat: add postgraduate decision rules"
```

## Task 4: Add idempotent application orchestration

**Files:**
- Create: `services/api/src/platform/http/idempotency.ts`
- Create: `services/api/src/postgraduate/application/postgraduate-decision-service.ts`
- Create: `tests/integration/postgraduate-decision-service.test.ts`

- [ ] **Step 1: Write failing idempotency and service tests**

Cover same-key replay, same-key conflict, target ownership, and server-owned assessment fields:

```ts
const assert = require("node:assert/strict");
const test = require("node:test");
const { createDemoEducationDataCatalog } = require("../../services/api/src/postgraduate/data/education-data.ts");
const { PostgraduateDecisionService } = require("../../services/api/src/postgraduate/application/postgraduate-decision-service.ts");

function createService() {
  return new PostgraduateDecisionService({ catalog: createDemoEducationDataCatalog() });
}

test("saving a target returns the same server result for an identical idempotency replay", async () => {
  const service = createService();
  const input = {
    actorId: "account-001",
    requestId: "11111111-1111-4111-8111-111111111111",
    idempotencyKey: "target-create-key-001",
    programId: "demo-program-001",
  };

  const first = await service.saveTarget(input);
  const replay = await service.saveTarget(input);

  assert.deepEqual(replay, first);
  assert.equal(replay.assessment.rule_version, "postgraduate-rules-v1");
  assert.equal(replay.assessment.probability, undefined);
});

test("reusing an idempotency key with a different target is a conflict", async () => {
  const service = createService();
  const base = {
    actorId: "account-001",
    requestId: "22222222-2222-4222-8222-222222222222",
    idempotencyKey: "target-create-key-002",
  };

  await service.saveTarget({ ...base, programId: "demo-program-001" });
  await assert.rejects(
    () => service.saveTarget({ ...base, programId: "demo-program-002" }),
    /idempotency/i,
  );
});

test("recommendation results belong to the authenticated actor and carry snapshot provenance", async () => {
  const service = createService();
  const result = await service.recommend({
    actorId: "account-002",
    requestId: "33333333-3333-4333-8333-333333333333",
    idempotencyKey: "recommend-key-001",
    profile: {
      undergraduate_major: "演示专业",
      english_level: "medium",
      mathematics_level: "medium",
      preferred_regions: [],
      target_directions: [],
      accepts_cross_major: true,
      daily_minutes: 180,
      exam_date: "2027-12-25",
    },
  });

  assert.ok(result.recommendations.length > 0);
  assert.ok(result.recommendations.every((item) => item.data_snapshot_id === "demo-postgraduate-v1"));
});
```

Run:

```text
node --no-warnings --test tests/integration/postgraduate-decision-service.test.ts
```

Expected: FAIL because the idempotency store and service do not exist.

- [ ] **Step 2: Implement the generic in-memory idempotency executor**

In `idempotency.ts`, export `InMemoryIdempotencyStore` and `IdempotencyConflictError`. Normalize the key and compute a SHA-256 fingerprint from a recursively key-sorted JSON value:

```ts
class InMemoryIdempotencyStore {
  constructor() {
    this.records = new Map();
  }

  async execute({ actorId, route, key, payload, operation }) {
    const recordKey = `${actorId}:${route}:${String(key).trim()}`;
    const fingerprint = stableFingerprint(payload);
    const existing = this.records.get(recordKey);
    if (existing && existing.fingerprint !== fingerprint) {
      throw new IdempotencyConflictError();
    }
    if (existing) return existing.result;

    const result = await operation();
    this.records.set(recordKey, { fingerprint, result });
    return result;
  }
}
```

Reject blank keys and payloads containing `decision_level`, `internal_rank_score`, `completed`, `reward`, `probability`, or `salary` when they are supplied as client input. The store must never log payload contents.

- [ ] **Step 3: Implement the application service with isolated ownership maps**

Construct `PostgraduateDecisionService` with `{ catalog, clock, idempotency }`, defaulting to the demo catalog, `new Date().toISOString`, and a new in-memory idempotency store. Keep these maps private to the service: `profiles`, `targets`, `recommendations`, `assessments`, and `planDrafts`.

Implement these methods with the exact input/output intent:

```ts
saveProfile({ actorId, requestId, idempotencyKey, profile })
saveTarget({ actorId, requestId, idempotencyKey, programId, note })
recommend({ actorId, requestId, idempotencyKey, profile, maxResults })
getProfile({ actorId })
getProgram({ programId })
searchPrograms({ query, region, maxResults })
getAssessment({ actorId, targetId })
listUpdates({ actorId, programId })
```

`saveTarget` must verify the program exists, store an actor-owned target ID, normalize the existing profile if present, and compute an assessment snapshot. If no profile exists, return `eligibility: "unknown"` with a `profile_incomplete` risk rather than inventing readiness.

Every write result includes the accepted `request_id`; every read result includes the current `data_snapshot_id` where a stale projection could affect a decision. Use `PlatformError` from `services/api/src/platform/errors/error-catalog.ts` for public error mapping and keep target IDs opaque.

- [ ] **Step 4: Run integration tests and commit**

Run:

```text
node --no-warnings --test tests/integration/postgraduate-decision-service.test.ts
git diff --check
```

Expected: replay returns byte-equivalent data, conflicts fail, and no client-supplied conclusion appears in the service result.

Commit:

```text
git add services/api/src/platform/http/idempotency.ts services/api/src/postgraduate/application/postgraduate-decision-service.ts tests/integration/postgraduate-decision-service.test.ts
git commit -m "feat: add postgraduate decision application service"
```

## Task 5: Generate plans and connect Planning, Notification, and self-discipline

**Files:**
- Create: `services/api/src/postgraduate/planning/plan-generator.ts`
- Create: `services/api/src/planning/application/planning-port.ts`
- Create: `services/api/src/planning/in-memory-planning-service.ts`
- Create: `services/api/src/notification/application/notification-port.ts`
- Create: `services/api/src/notification/in-memory-notification-service.ts`
- Modify: `services/api/src/postgraduate/application/postgraduate-decision-service.ts`
- Create: `tests/unit/postgraduate/plan-generator.test.ts`
- Modify: `tests/integration/postgraduate-decision-service.test.ts`

- [ ] **Step 1: Write failing plan-generation tests**

Test date allocation, all three modes, daily task bounds, and short-window errors:

```ts
const assert = require("node:assert/strict");
const test = require("node:test");
const { createDemoEducationDataCatalog } = require("../../../services/api/src/postgraduate/data/education-data.ts");
const { generatePlanDraft } = require("../../../services/api/src/postgraduate/planning/plan-generator.ts");

const program = createDemoEducationDataCatalog().getById("demo-program-001");
const profile = {
  daily_minutes: 180,
  exam_date: "2027-12-25",
  expected_score: 330,
  target_directions: ["软件工程"],
};

test("auto mode creates four dated phases and bounded daily tasks", () => {
  const draft = generatePlanDraft({
    targetId: "demo-target-001",
    program,
    profile,
    planMode: "auto",
    today: "2026-09-03",
  });

  assert.equal(draft.plan_mode, "auto");
  assert.deepEqual(draft.phases.map((phase) => phase.code), ["foundation", "intensification", "sprint", "review"]);
  assert.ok(draft.tasks.length > 0);
  assert.ok(draft.tasks.every((task) => task.estimated_minutes > 0 && task.estimated_minutes <= 180));
  assert.equal(draft.requires_confirmation, true);
});

test("hybrid mode keeps editable system tasks while manual mode creates no generated tasks", () => {
  const hybrid = generatePlanDraft({ targetId: "demo-target-001", program, profile, planMode: "hybrid", today: "2026-09-03" });
  const manual = generatePlanDraft({ targetId: "demo-target-001", program, profile, planMode: "manual", today: "2026-09-03" });

  assert.ok(hybrid.tasks.every((task) => task.editable === true));
  assert.deepEqual(manual.tasks, []);
  assert.equal(manual.requires_user_tasks, true);
});

test("plan generation rejects a preparation window shorter than 28 days", () => {
  assert.throws(
    () => generatePlanDraft({
      targetId: "demo-target-001",
      program,
      profile: { ...profile, exam_date: "2026-09-20" },
      planMode: "auto",
      today: "2026-09-03",
    }),
    /preparation window/i,
  );
});
```

Run and confirm the expected missing-module failure:

```text
node --no-warnings --test tests/unit/postgraduate/plan-generator.test.ts
```

- [ ] **Step 2: Implement date-only phase and task generation**

Use UTC date-only arithmetic so local daylight-saving changes cannot move a task to another date. Allocate the remaining days as 45% foundation, 30% intensification, 20% sprint, and 5% review, enforcing at least one day per phase. Use `exam_date` and `today` from the request/application clock; do not hardcode a calendar year.

Export:

```ts
function generatePlanDraft({ targetId, program, profile, planMode, today }) {}
module.exports = { generatePlanDraft };
```

For `auto` and `hybrid`, create one editable task per exam subject per scheduled study day, split `daily_minutes` evenly and assign the remainder to the first subject. Each task contains `task_id`, `phase_code`, `task_date`, `subject`, `title`, `estimated_minutes`, `source: "system"`, and `editable`. For `manual`, return an empty task list and `requires_user_tasks: true`.

The draft must include explicit assumptions:

```ts
assumptions: {
  today,
  exam_date: profile.exam_date,
  daily_minutes: profile.daily_minutes,
  generated_from: "demo-postgraduate-v1",
}
```

- [ ] **Step 3: Define Planning and Notification application ports**

Create the interfaces as documented runtime contracts:

```ts
// services/api/src/planning/application/planning-port.ts
class PlanningPort {
  async createPlan(_input) { throw new Error("PlanningPort.createPlan must be provided"); }
  async recordTaskOutcome(_input) { throw new Error("PlanningPort.recordTaskOutcome must be provided"); }
}
module.exports = { PlanningPort };

// services/api/src/notification/application/notification-port.ts
class NotificationPort {
  async createReminderIntent(_input) { throw new Error("NotificationPort.createReminderIntent must be provided"); }
}
module.exports = { NotificationPort };
```

Implement in-memory adapters with actor ownership, generated IDs, and deterministic clock injection. `createPlan` stores the confirmed draft and `recordTaskOutcome` stores only the submitted outcome. `createReminderIntent` stores schedule, quiet-hours input, and `status: "pending"`; it must not claim that a notification was delivered.

- [ ] **Step 4: Extend the application service for draft, confirm, and self-discipline**

Add these methods:

```ts
createPlanDraft({ actorId, requestId, idempotencyKey, targetId, examDate, dailyMinutes, planMode, reminderEnabled })
confirmPlanDraft({ actorId, requestId, idempotencyKey, draftId, action })
recordSelfDiscipline({ actorId, requestId, idempotencyKey, recordDate, title, subject, actualMinutes, outcome })
```

`createPlanDraft` validates the target and produces a draft only. `confirmPlanDraft` performs these steps in order:

1. Verify the draft belongs to the actor and has `status: "draft"`.
2. Create a Planning record if `planning_id` is absent.
3. Create a Notification reminder intent only when `reminder_enabled` is true and `notification_id` is absent.
4. Mark the draft `confirmed` only after the required calls succeed.
5. If Notification fails after Planning succeeds, keep `confirmation_state: "pending_notification"`, return a retryable error, and reuse the existing `planning_id` on retry.

Never overwrite user-edited manual tasks during confirmation. `recordSelfDiscipline` delegates the completion fact to Planning and returns the server-created record.

- [ ] **Step 5: Add cross-module tests and commit**

Extend the integration test with:

```ts
const { InMemoryPlanningService } = require("../../services/api/src/planning/in-memory-planning-service.ts");
const { InMemoryNotificationService } = require("../../services/api/src/notification/in-memory-notification-service.ts");

test("confirming a plan writes through Planning and creates a pending reminder intent", async () => {
  const planning = new InMemoryPlanningService();
  const notification = new InMemoryNotificationService();
  const actorId = "account-003";
  const service = new PostgraduateDecisionService({
    catalog: createDemoEducationDataCatalog(),
    planning,
    notification,
  });

  await service.saveProfile({
    actorId,
    requestId: "44444444-4444-4444-8444-444444444444",
    idempotencyKey: "profile-key-001",
    profile: {
      undergraduate_major: "演示专业",
      english_level: "medium",
      mathematics_level: "medium",
      preferred_regions: ["演示地区A"],
      target_directions: ["软件工程"],
      accepts_cross_major: true,
      daily_minutes: 180,
      exam_date: "2027-12-25",
    },
  });

  const target = await service.saveTarget({
    actorId,
    requestId: "55555555-5555-4555-8555-555555555555",
    idempotencyKey: "target-key-001",
    programId: "demo-program-001",
  });

  const draft = await service.createPlanDraft({
    actorId,
    requestId: "66666666-6666-4666-8666-666666666666",
    idempotencyKey: "draft-key-001",
    targetId: target.target_id,
    examDate: "2027-12-25",
    dailyMinutes: 180,
    planMode: "hybrid",
    reminderEnabled: true,
  });

  const confirmed = await service.confirmPlanDraft({
    actorId,
    requestId: "77777777-7777-4777-8777-777777777777",
    idempotencyKey: "confirm-key-001",
    draftId: draft.draft_id,
    action: "confirm",
  });

  assert.equal(confirmed.status, "confirmed");
  assert.ok(confirmed.planning_id);
  assert.ok(confirmed.notification_id);
  assert.equal((await planning.listPlans(actorId)).length, 1);
  assert.equal((await notification.listIntents(actorId)).length, 1);
});
```

Run:

```text
node --no-warnings --test tests/unit/postgraduate/plan-generator.test.ts tests/integration/postgraduate-decision-service.test.ts
git diff --check
```

Commit:

```text
git add services/api/src/postgraduate/planning/plan-generator.ts services/api/src/planning/application/planning-port.ts services/api/src/planning/in-memory-planning-service.ts services/api/src/notification/application/notification-port.ts services/api/src/notification/in-memory-notification-service.ts services/api/src/postgraduate/application/postgraduate-decision-service.ts tests/unit/postgraduate/plan-generator.test.ts tests/integration/postgraduate-decision-service.test.ts
git commit -m "feat: connect postgraduate plans to self discipline"
```

## Task 6: Add evidence-safe explanation and snapshot update behavior

**Files:**
- Create: `services/api/src/postgraduate/ai/explanation.ts`
- Modify: `services/api/src/postgraduate/data/education-data.ts`
- Create: `tests/unit/postgraduate/explanation-and-updates.test.ts`

- [ ] **Step 1: Write failing explanation and update tests**

```ts
const assert = require("node:assert/strict");
const test = require("node:test");
const { createDemoEducationDataCatalog } = require("../../../services/api/src/postgraduate/data/education-data.ts");
const { explainAssessment, validateAiExplanation } = require("../../../services/api/src/postgraduate/ai/explanation.ts");

test("template explanation remains usable when AI is unavailable", () => {
  const catalog = createDemoEducationDataCatalog();
  const program = catalog.getById("demo-program-001");
  const assessment = {
    decision_level: "match",
    dimensions: [{ code: "readiness", label: "准备度", reason: "当前基础与演示数据中的参考线存在可补强空间", evidence_ids: [program.evidence[0].evidence_id] }],
    risks: [],
    next_actions: [{ code: "practice", label: "安排一轮真题自测" }],
    evidence: program.evidence,
  };

  const result = explainAssessment({ assessment, aiResult: null });
  assert.equal(result.mode, "template");
  assert.match(result.text, /匹配|依据|下一步/);
});

test("AI explanation is rejected when it introduces an unknown evidence id", () => {
  assert.throws(
    () => validateAiExplanation({
      text: "这是一段解释",
      evidence_ids: ["not-in-assessment"],
    }, { evidence: [] }),
    /evidence/i,
  );
});

test("data updates are returned as changes and do not rewrite old assessment snapshots", () => {
  const catalog = createDemoEducationDataCatalog();
  const firstSnapshot = catalog.getSnapshot();
  const updates = catalog.listUpdates("demo-program-001");

  assert.ok(updates.length > 0);
  assert.equal(firstSnapshot.data_snapshot_id, "demo-postgraduate-v1");
  assert.ok(updates.every((update) => update.data_snapshot_id === firstSnapshot.data_snapshot_id));
});
```

Run:

```text
node --no-warnings --test tests/unit/postgraduate/explanation-and-updates.test.ts
```

Expected: FAIL because explanation validation is not implemented.

- [ ] **Step 2: Implement schema-bound explanation and template fallback**

Export:

```ts
function validateAiExplanation(aiResult, assessment) {}
function explainAssessment({ assessment, aiResult }) {}
module.exports = { validateAiExplanation, explainAssessment };
```

`validateAiExplanation` accepts only `{ text, evidence_ids, action_codes }`, requires every evidence ID and action code to exist in the supplied assessment, limits text to 4000 characters, and rejects new numeric claims. `explainAssessment` returns `{ mode: "ai", text }` only after validation; otherwise it returns `{ mode: "template", text }` generated from `decision_level`, risks, next actions, and evidence status.

Do not call a provider in this task. The existing AI Gateway contract remains the only future provider boundary.

- [ ] **Step 3: Implement update reads as explicit immutable snapshots**

Implement `getSnapshot()` and `listUpdates(programId)` in the adapter. Update results must include old/new values, metric, source reference, data year, changed time, and snapshot ID. Never mutate a previously returned program or assessment object.

- [ ] **Step 4: Run tests and commit**

Run:

```text
node --no-warnings --test tests/unit/postgraduate/explanation-and-updates.test.ts tests/unit/postgraduate/education-data.test.ts
git diff --check
```

Commit:

```text
git add services/api/src/postgraduate/ai/explanation.ts services/api/src/postgraduate/data/education-data.ts tests/unit/postgraduate/explanation-and-updates.test.ts
git commit -m "feat: make postgraduate evidence updates traceable"
```

## Task 7: Build the runnable demo API and user-facing workbench

**Files:**
- Modify: `package.json`
- Create: `tools/postgraduate-demo/server.mjs`
- Create: `apps/user_client/postgraduate/index.html`
- Create: `apps/user_client/postgraduate/app.mjs`
- Create: `apps/user_client/postgraduate/styles.css`
- Create: `tests/postgraduate-demo.test.mjs`

- [ ] **Step 1: Write the HTTP smoke test first**

Create a test that starts the server on an ephemeral port and verifies the two entry paths and the plan flow:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { createPostgraduateDemoServer } = require("../tools/postgraduate-demo/server.mjs");

test("demo serves the decision workbench and target search API", async (t) => {
  const server = await createPostgraduateDemoServer({ port: 0 });
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(`${baseUrl}/`);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /考研决策工作台/);
  assert.match(html, /我已有目标/);
  assert.match(html, /我还不确定/);

  const response = await fetch(`${baseUrl}/api/v1/postgraduate/programs?query=计算机`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data_mode, "demo");
  assert.ok(body.programs.length > 0);
});
```

Run:

```text
node --no-warnings --test tests/postgraduate-demo.test.mjs
```

Expected: FAIL because the server and page do not exist.

- [ ] **Step 2: Add the demo scripts**

Add to `package.json`:

```json
{
  "scripts": {
    "postgraduate:test": "node --no-warnings --test tests/unit/postgraduate/*.test.ts tests/integration/postgraduate-decision-service.test.ts tests/postgraduate-demo.test.mjs",
    "postgraduate:demo": "node --no-warnings tools/postgraduate-demo/server.mjs"
  }
}
```

Keep the existing scripts unchanged.

- [ ] **Step 3: Implement the demo server**

`tools/postgraduate-demo/server.mjs` must use Node `http`, `url`, `fs`, and `path` only. Export `createPostgraduateDemoServer({ port = 4174, service } = {})`, create a service with the demo catalog and in-memory Planning/Notification adapters when one is not supplied, and serve:

- `GET /` -> `apps/user_client/postgraduate/index.html`;
- `GET /app.mjs` -> `apps/user_client/postgraduate/app.mjs`;
- `GET /styles.css` -> `apps/user_client/postgraduate/styles.css`;
- `GET /api/v1/postgraduate/programs` -> `searchPrograms`;
- `GET /api/v1/postgraduate/programs/{id}` -> `getProgram`;
- `GET /api/v1/me/postgraduate/updates` -> `listUpdates`;
- `PUT /api/v1/me/postgraduate/profile` -> `saveProfile`;
- `POST /api/v1/me/postgraduate/targets` -> `saveTarget`;
- `POST /api/v1/me/postgraduate/recommendations` -> `recommend`;
- `POST /api/v1/me/postgraduate/targets/{id}/plan-drafts` -> `createPlanDraft`;
- `POST /api/v1/me/postgraduate/plan-drafts/{id}/confirm` -> `confirmPlanDraft`;
- `POST /api/v1/me/postgraduate/self-discipline-records` -> `recordSelfDiscipline`.

Use a fixed demo actor `demo-account` only inside the demo server. Generate a UUID request ID when the browser omits one, require an `Idempotency-Key` for writes, return JSON errors through `toHttpError`, and never include stack traces or full request bodies in responses.

- [ ] **Step 4: Implement the HTML as a usable first screen**

`index.html` must contain a compact workbench, not a marketing hero. Include:

- a header with the product name and visible `演示数据` status;
- a segmented entry control with `我已有目标` and `我还不确定`;
- a search form for institution/program/region;
- a result list with selectable program rows;
- a target assessment area showing level, dimensions, risks, evidence source type, data year, and update time;
- a profile question form shown only for the recommendation entry;
- recommendation groups for 冲刺/匹配/稳妥;
- a plan mode control for 自动规划/混合规划/自己安排;
- a plan draft confirmation area with today tasks and reminder state;
- a manual self-discipline form with date, subject, title, minutes, and outcome;
- an updates area showing change records and a `重新评估` action.

Do not put explanatory marketing copy in the page. Use labels that describe the control or data. Every disabled, empty, loading, and error state must have a concrete action or reason.

- [ ] **Step 5: Implement browser state and interactions**

In `app.mjs`, keep a single state object with these keys:

```js
const state = {
  mode: "target",
  profile: null,
  selectedProgram: null,
  assessment: null,
  recommendations: [],
  planDraft: null,
  updates: [],
  loading: false,
  error: null,
};
```

Implement `requestJson`, `render`, `searchPrograms`, `selectProgram`, `saveProfile`, `loadRecommendations`, `createPlanDraft`, `confirmPlanDraft`, `recordSelfDiscipline`, and `loadUpdates`. All writes generate a fresh UUID-shaped `request_id` and a stable action-specific `Idempotency-Key`; the browser never sends assessment level, score, probability, completed state, or reminder delivery state.

The target path must let the user select a program before asking for optional profile details. The recommendation path must collect the profile before making a recommendation request. A successful plan confirmation must render the server-returned Planning ID and reminder status; it must not infer success from the button click.

- [ ] **Step 6: Implement the restrained responsive visual system**

Use these CSS tokens in `styles.css`:

```css
:root {
  --ink: #101820;
  --ink-soft: #27343a;
  --rock: #667078;
  --paper: #f4f1e8;
  --line: #c9c5b9;
  --amber: #d2a54a;
  --cinnabar: #b34b3d;
  --white: #fffdf7;
  --focus: #245e9b;
}
```

Use `clamp` only for spacing where necessary; do not scale font size with viewport width. Use a readable sans-serif body, a restrained serif display treatment for the page title, compact table-like rows for data, low-radius surfaces, visible focus rings, and `@media (prefers-reduced-motion: reduce)` to disable transitions. The mobile layout must stack the search/results/assessment/plan columns without horizontal scrolling.

- [ ] **Step 7: Run the demo smoke test and commit**

Run:

```text
pnpm postgraduate:test
pnpm postgraduate:demo
```

Open `http://127.0.0.1:4174/` and manually verify both entry paths, program selection, assessment evidence, recommendation refresh, all three plan modes, manual self-discipline recording, and update display. Stop the server after verification.

Also run:

```text
git diff --check
```

Commit:

```text
git add package.json tools/postgraduate-demo/server.mjs apps/user_client/postgraduate/index.html apps/user_client/postgraduate/app.mjs apps/user_client/postgraduate/styles.css tests/postgraduate-demo.test.mjs
git commit -m "feat: add postgraduate decision workbench demo"
```

## Task 8: Full verification and delivery checkpoint

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-03-postgraduate-decision-workbench-design.md`

- [ ] **Step 1: Document the runnable entry point and demo-data boundary**

Add a short section to `README.md` with these exact commands and constraints:

```text
pnpm contract:lint
pnpm platform:test
pnpm postgraduate:test
pnpm postgraduate:demo
```

State that the demo uses synthetic records, that production facts require an approved data adapter and source review, and that AI never replaces the deterministic assessment engine.

Verify that the design document status is `已获用户确认，已进入实施计划`.

- [ ] **Step 2: Run the complete verification suite**

Run from the repository root:

```text
pnpm contract:lint
pnpm platform:test
pnpm image:test
pnpm postgraduate:test
git diff --check
git status --short --branch
```

Expected:

- all contract, platform, image, decision, planning, and demo tests pass;
- no credential-pattern or stack-trace output is present;
- `git diff --check` is clean;
- existing unrelated untracked assets and `.codegraph/` remain untouched unless the user explicitly asks to add them.

- [ ] **Step 3: Perform UI acceptance checks**

With `pnpm postgraduate:demo` running, verify at desktop width and a narrow mobile width:

- no horizontal overflow;
- keyboard focus is visible on entry controls, search, result rows, forms, and confirmation buttons;
- empty search, missing profile, no recommendation, stale/demo data, and API error states explain the next action;
- all text fits its parent and no assessment/evidence/task section overlaps another;
- reduced-motion preference removes nonessential transitions;
- the page never displays an admission probability or claims a real-time official statistic while using demo data.

- [ ] **Step 4: Commit the documentation and report exact evidence**

Run:

```text
git add README.md docs/superpowers/specs/2026-09-03-postgraduate-decision-workbench-design.md
git commit -m "docs: document postgraduate workbench verification"
```

Final report must name the passing commands, the demo URL, the synthetic-data limitation, and any browser verification that could not be completed. Do not claim real market data, live scraping, production persistence, or AI provider integration unless those checks were actually performed.
