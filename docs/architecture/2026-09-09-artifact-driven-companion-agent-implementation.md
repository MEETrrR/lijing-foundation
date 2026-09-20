# 砺境真实材料驱动的考研陪伴 Agent 技术实现文档

**版本：** v2.0
**日期：** 2026-09-09
**状态：** 已实现，待公网部署与受控试点验收
**适用范围：** 考研封闭试点；首批为使用真实备考材料的计算机相关专业考生
**替代范围：** 本文替代“用三道自选题自评后生成通用下一步”的实现思路；保留已有认证、持久化、AI Gateway、学习路线、记忆和器灵身份模块。

## 1. 决策与问题定义

砺境不再将自己定义为“记录学习过程的陪伴产品”，而定义为：

> 读取用户正在使用的真实学习材料，识别当前卡点，为当前任务生成一条可验证的最小行动，并依据新证据决定下一步的考研陪伴 Agent。

当前版本的三道自填诊断存在四个不可接受的问题：

1. 用户必须自己找题、找答案、判断对错和归纳错因，系统没有降低决策成本。
2. `correct/incorrect/unverified` 的计数不能表达题型、章节、推理缺口或材料差异。
3. 诊断结果只写入用户状态，不能可靠改变今日任务、路线或器灵干预。
4. 任务已完成时，客户端仍可能展示可提交的诊断按钮，导致服务端拒绝旧任务写入。

本方案的核心不是扩充公共 RAG，也不是建设通用题库。首期价值来自用户自己的题目、错题、笔记、作答草稿和课程材料；公共来源仅用于报考规则、招生政策等高时效事实的核验。

## 2. 成功定义与非目标

### 2.1 首期成功定义

一次完整循环必须满足：

```text
真实材料
  -> 材料解析与卡点诊断
  -> 服务端生成唯一当前行动
  -> 用户提交过程或结果证据
  -> 服务端校验任务状态与证据关系
  -> 更新卡点事实、候选记忆和下一条行动
```

系统只能声明“该行动的证据已被记录/仍待验证”，不能因一次作答、自评或模型输出宣称用户已经掌握知识。

### 2.2 首期非目标

- 不覆盖全部考研学科、全部学习需求或全部教育场景。
- 不提供无版权或未经授权的公共题库、课程全文和解析资料。
- 不把模型判断直接写为分数、掌握度、录取概率或学习效果。
- 不在没有用户材料时伪造具体错因或个性化建议。
- 不做开放式无限聊天；每次 Agent 调用必须服务于明确的学习任务状态。
- 不在 P0 阶段建设通用向量库、复杂知识图谱或自动推送系统。

## 3. 试点定位与用户承诺

对外定位可以是“考研学习陪伴”，但产品试点必须足够窄：

```text
用户：正在准备计算机相关专业考研的大学生
材料：数学、英语、408/专业课等用户合法持有的题目、笔记、错题和作答
核心场景：不知道今天先做什么；做到一半卡住；完成后不知道下一步是否应改变
```

首屏承诺只保留一句：

> 把你正在卡住的题、笔记或草稿交给器灵，得到一条现在能完成、做完能留下证据的下一步。

不得将“长期路线”“成长世界观”“记忆系统”作为首次价值的前置门槛。

## 4. 首次与日常用户流程

### 4.1 首次进入：90 秒内产生第一条行动

```text
登录
  -> 选择考研 + 当前科目
  -> 选择当前状态：开始 / 卡住 / 复盘
  -> 粘贴题干、上传题目/笔记/草稿，或选择已保存材料
  -> 得到一张行动卡
  -> 开始 5 至 30 分钟行动
```

首期必填信息只有：科目、当前状态、至少一份材料或材料摘要。目标日期、每周时长、长期路线和个人资料都移到第一条行动之后收集；它们不能阻塞首次价值。

### 4.2 日常循环

```text
GET /companion/today
  -> 服务端返回唯一 active action，或明确返回 need_material / completed
  -> 用户开始、卡住或提交证据
  -> 服务端检查 action_id、action_version、当前状态和幂等键
  -> 生成诊断或降级恢复动作
  -> 原 action 完成或 superseded
  -> 返回下一条 action 或当天完成状态
```

客户端不得从本地计数、旧页面状态或 `DEMO_STATE` 推断下一条行动。页面只渲染服务端投影。

### 4.3 两个关键分支

**用户不知道学什么**：如果路线已经确认，服务端选择当前最小任务；如果没有路线，先要求提交一份真实材料，生成“首个材料行动”，再异步邀请用户补全长期路线。

**用户卡住**：用户提交材料引用和一个阻塞类型，Agent 必须从该材料中指出已知信息、缺失判断和一个 5 至 30 分钟的最小动作。没有材料引用时，系统只能请求补充材料或给出明确标注为模板的恢复动作。

## 5. 领域模型与所有权

新增领域目录：`services/api/src/domains/learning-artifact/`。器灵循环继续位于 `services/api/src/domains/companion-cycle/`，但不再保存或解释原始学习材料。

| 领域 | 拥有事实 | 允许写入者 | 不能承担的职责 |
|---|---|---|---|
| Learning Artifact | 用户材料、处理状态、材料摘要、私有对象引用 | 用户上传流程、服务端解析器 | 宣称用户掌握度、自动公开材料 |
| Learning Attempt | 一次作答、过程证据、用户自述结果 | 认证用户和服务端校验 | 覆盖原始材料、伪造正确率 |
| Learning Diagnosis | 材料支持的卡点、待验证项、诊断置信度 | 服务端 Agent 工作流 | 直接写入路线完成状态 |
| Companion Cycle | 当前行动、动作版本、签到、阻塞、状态迁移 | 服务端状态机 | 存储完整题目或自由文本证据 |
| Learning Route | 长期目标、路线版本、计划刷新 | LearningRouteService | 依据未验证诊断自动重排 |
| Memory | 用户确认的重复策略/阻力 | MemoryService + 用户确认 | 把一次模型判断变成长记忆 |

所有记录以认证后的 `actorId` 为唯一用户边界。客户端不传入、也不能覆盖任何用户 ID。

## 6. 数据契约

### 6.1 LearningArtifact

建议键：`learning:artifact:<actorId>:<artifactId>`。首期文本和私有附件同时支持；二进制文件只保存对象存储引用，禁止写入 KV、日志或模型审计记录。

```json
{
  "id": "artifact-...",
  "actor_id": "server-owned",
  "kind": "question|note|attempt_draft|answer_reference|plan_outline",
  "subject": "数学二",
  "source_title": "2023 数学二真题第 4 题",
  "content_text": "可选，最多 12000 字符",
  "attachment": {
    "object_key": "private/actor/...",
    "media_type": "image/jpeg",
    "sha256": "..."
  },
  "processing_status": "pending|ready|rejected|failed",
  "summary": {
    "topic_labels": ["极限", "分段函数"],
    "extracted_text_version": "v1",
    "confidence": 0.82
  },
  "created_at": "2026-09-09T00:00:00.000Z",
  "updated_at": "2026-09-09T00:00:00.000Z"
}
```

`content_text`、OCR/视觉提取内容和附件元数据都属于私密学习材料。对象存储必须使用私有桶、短时签名 URL、服务端 MIME/大小校验和恶意文件扫描。

### 6.2 LearningAttempt

```json
{
  "id": "attempt-...",
  "artifact_id": "artifact-question-...",
  "action_id": "action-...",
  "action_version": 3,
  "kind": "work_log|answer|retry|reflection",
  "content": "用户作答、步骤或复盘，最多 6000 字符",
  "attachment_refs": ["artifact-draft-..."],
  "self_report": "completed|stuck|needs_check",
  "elapsed_minutes": 12,
  "created_at": "..."
}
```

`self_report` 是用户陈述，不是正确率或掌握度事实。

### 6.3 LearningDiagnosis

诊断必须引用材料和尝试，不能只引用 `incorrect` 数量。

```json
{
  "id": "diagnosis-...",
  "artifact_refs": ["artifact-question-...", "artifact-draft-..."],
  "attempt_id": "attempt-...",
  "status": "ready|needs_material|needs_user_check|degraded",
  "observations": [
    {
      "claim": "在分段条件切换处缺少判定依据",
      "evidence_ref": "artifact-draft-...",
      "evidence_excerpt": "截断后的最小必要片段",
      "confidence": 0.74
    }
  ],
  "unknowns": ["未提供标准答案，不能判断最终结果"],
  "error_tags": ["condition-check", "concept-gap"],
  "generated_at": "...",
  "policy_version": "diagnosis-v1"
}
```

只保存可解释、可追溯的结论；模型原始长输出保留在受控 AI 请求存储中，遵循最小保留与脱敏规则。

### 6.4 CompanionAction

`CompanionAction` 是系统真正的核心对象。每日循环只投影它，所有页面提交都必须绑定其版本。

```json
{
  "id": "action-...",
  "version": 1,
  "cycle_id": "cycle-...",
  "route_id": "route-...|null",
  "origin": "route|artifact_diagnosis|recovery_template|weekly_review",
  "status": "planned|active|stuck|completed|superseded|skipped",
  "title": "先写出分段点两侧各自适用的条件",
  "reason": "基于你上传的题目和草稿，当前无法确认分段条件。",
  "diagnosis_ref": "diagnosis-...|null",
  "artifact_refs": ["artifact-question-...", "artifact-draft-..."],
  "estimated_minutes": 10,
  "expected_evidence": "提交两侧条件与对应表达式，或上传标注后的草稿。",
  "created_at": "...",
  "updated_at": "..."
}
```

硬约束：`title`、`reason`、`expected_evidence` 不能为空；`estimated_minutes` 只能为 5 至 30；`origin=artifact_diagnosis` 时至少一个 `artifact_ref` 和一个 `diagnosis_ref` 必填。

## 7. 服务端状态机

### 7.1 Action 状态迁移

```text
planned -> active
active -> stuck
active -> completed
active -> skipped
stuck -> active
stuck -> superseded
skipped -> superseded
completed -> terminal
superseded -> terminal
```

规则：

- 一个 `cycle_id` 同时最多一个 `active` 或 `stuck` 的行动。
- `completed`、`superseded` 是终态；不能再次提交开始、卡住或证据。
- 服务端在同一事务中完成“旧行动终态化 + 新行动创建”，避免出现两个活跃任务。
- 每次写入要求 `action_id`、`action_version`、`request_id` 与 `Idempotency-Key`。
- 版本不匹配返回 `409 ACTION_VERSION_CONFLICT`，响应中附带最新 `today` 投影；客户端刷新而不是重试旧请求。

### 7.2 修复已发现的完成后断点

`GET /api/v1/companion/today` 必须返回明确的屏幕状态：

```json
{
  "screen_state": "action_active|need_material|cycle_completed|next_action_ready",
  "current_action": null,
  "next_action": null,
  "cycle": { "status": "completed" }
}
```

前端渲染规则：

- `action_active`：显示开始、卡住、提交证据。
- `need_material`：只显示材料输入，不显示“完成任务”。
- `cycle_completed`：只显示完成结果、证据摘要、回望入口；绝不渲染提交按钮。
- `next_action_ready`：只显示新 `action_id` 的行动卡；旧 action 的任何控件必须被卸载。

服务端仍保留终态拒绝，作为安全边界；前端不能依赖 `409` 来表达正常流程。

## 8. API 设计

所有写接口均要求登录、`request_id` 和 `Idempotency-Key`。OpenAPI 先于实现更新，客户端根据契约生成或校验请求。

### 8.1 材料与附件

| 接口 | 作用 | MVP |
|---|---|---|
| `POST /api/v1/learning-artifacts/upload-intents` | 为私有附件申请短时上传地址 | P1 |
| `POST /api/v1/learning-artifacts` | 创建文本材料或确认附件材料 | P0 |
| `GET /api/v1/learning-artifacts/{artifact_id}` | 读取本人材料元数据与受控内容 | P0 |
| `POST /api/v1/learning-artifacts/{artifact_id}/process` | OCR/视觉/文本解析异步处理 | P1 |

上传 intent 返回对象键和短时地址，不返回存储凭据。提交材料后，服务端校验对象归属、哈希、MIME、大小和处理状态。

### 8.2 尝试、诊断与行动

| 接口 | 作用 | MVP |
|---|---|---|
| `POST /api/v1/learning-attempts` | 记录一次作答、过程或复盘 | P0 |
| `POST /api/v1/companion/diagnoses` | 基于材料和尝试产生受约束诊断 | P0 |
| `GET /api/v1/companion/today` | 获取唯一当前行动与屏幕状态 | P0 |
| `POST /api/v1/companion/check-ins` | 对当前行动提交 start/stuck/complete/skip | 改造现有接口 |
| `POST /api/v1/companion/actions/{action_id}/evidence` | 绑定尝试、完成行动并生成后续行动 | P0 |
| `POST /api/v1/learning-routes/{route_id}/refresh` | 用户确认后把诊断摘要应用到路线 | 改造现有接口 |

### 8.3 `POST /companion/diagnoses` 请求与响应

```json
{
  "request_id": "uuid",
  "subject": "数学二",
  "artifact_ids": ["artifact-question-1", "artifact-draft-1"],
  "attempt_id": "attempt-1",
  "intent": "stuck|review|first_action"
}
```

```json
{
  "request_id": "uuid",
  "status": "completed|needs_material|degraded",
  "diagnosis": { "id": "diagnosis-1", "status": "ready" },
  "action": {
    "id": "action-1",
    "version": 1,
    "title": "...",
    "reason": "...",
    "estimated_minutes": 10,
    "expected_evidence": "..."
  },
  "replayed": false
}
```

AI 不可用时：`status=degraded`，服务端仅在有材料时生成含材料标题的确定性行动；没有材料时返回 `needs_material`。禁止把模板结果标记为诊断完成。

## 9. Agent 工作流

### 9.1 上下文最小化

每次诊断仅允许进入模型：

```text
当前 action
+ 1 至 3 份明确选择的用户材料
+ 一次相关尝试
+ 同一科目最近 3 条已确认记忆摘要
+ 当前路线中与本次材料相关的一项任务
+ 安全与输出合同
```

禁止把完整历史、全部材料、未确认记忆、原始身份信息和无关公共 RAG 直接拼进提示词。

### 9.2 结构化输出合同

模型输出必须通过 JSON Schema 校验：

```json
{
  "status": "ready|needs_material|needs_user_check",
  "observations": [
    {
      "claim": "不超过 120 字",
      "artifact_id": "必须属于输入 artifact_ids",
      "evidence_quote": "不超过 240 字",
      "confidence": 0.0
    }
  ],
  "unknowns": ["最多 3 项"],
  "error_tags": ["枚举且最多 3 项"],
  "next_action": {
    "title": "不超过 100 字",
    "reason": "必须引用 observation",
    "estimated_minutes": 5,
    "expected_evidence": "不超过 160 字"
  },
  "memory_candidates": []
}
```

服务端额外验证：

- `artifact_id` 必须来自本次输入，且归属当前用户。
- `evidence_quote` 必须可在对应材料抽取文本中定位；无法定位则拒绝该观察。
- 行动必须含至少一项可提交证据；不能只写“继续学习”“多练习”“保持努力”。
- `estimated_minutes` 必须落在 5 至 30。
- 无标准答案时，不得输出“正确/错误/掌握/准确率”。
- 情绪、医疗、风险内容触发专门安全策略，不进入学习诊断结论。

### 9.3 确定性降级

| 失败条件 | 返回行为 |
|---|---|
| 无材料 | `need_material`，要求题目、笔记或草稿之一 |
| 材料提取失败 | 显示处理失败，允许文本粘贴；不生成诊断 |
| AI 超时或被拒绝 | 基于当前材料标题和任务状态返回确定性最小动作，标记 `template` |
| Schema 或引用校验失败 | 丢弃模型结果，记录安全原因码，走确定性降级 |
| 旧 action 写入 | `409 ACTION_VERSION_CONFLICT`，返回最新行动投影 |

## 10. 记忆与路线刷新

### 10.1 记忆

只在以下条件同时成立时创建长期记忆候选：

1. 诊断引用至少一份材料和一次尝试；
2. 同类卡点或有效策略在两次以上行动中出现；
3. 用户在页面上确认、编辑或拒绝候选。

未经确认的候选只能用于当前对话的短期上下文，不得成为 `active` 记忆。

### 10.2 路线刷新

诊断不能静默改写长期路线。满足以下条件后，客户端向用户展示“将这一变化应用到计划”的明确选择：

- 同一 `error_tag` 在三次行动中出现；
- 用户连续两次跳过或卡住同一任务；
- 用户主动请求缩小、延后或替换当前计划。

用户确认后调用既有路线刷新能力。刷新请求只传递结构化摘要：错误标签、涉及科目、累计次数、可用时间变化和候选行动；不把整份原始材料传入路线生成提示词。

## 11. 前端改造

### 11.1 删除的交互

- 删除三道题来源、对照结果、用时、判断依据组成的 `initialDiagnosticForm`。
- 删除按错误数量生成的 `diagnosticNextAction`。
- 删除“保存诊断并生成下一步”这一不真实承诺。
- 删除客户端根据旧任务或本地任务列表补齐 active task 的回退逻辑。

### 11.2 新的页面组件

| 组件 | 责任 | 关键状态 |
|---|---|---|
| `MaterialComposer` | 粘贴文本、选择材料、上传附件 | empty/uploading/ready/failed |
| `ActionCard` | 显示唯一当前行动、依据、时长和证据要求 | active/stuck/completed/superseded |
| `EvidenceComposer` | 创建 Attempt 并绑定当前 action 版本 | idle/submitting/conflict/success |
| `DiagnosisPanel` | 展示可追溯观察、未知项和行动原因 | ready/needs_material/degraded |
| `CycleCompleted` | 展示今日完成与回望入口 | terminal |

所有页面刷新、路由返回和写入失败后都调用 `GET /companion/today` 获取服务端投影。前端不缓存可写状态。

### 11.3 页面行为准则

- `cycle_completed` 和 `superseded` 时卸载表单与提交监听器，不是仅给按钮加 `disabled`。
- 使用行动卡的 `reason` 展示“依据什么”，使用 `expected_evidence` 展示“怎么证明推进”，而不是展示泛化鼓励。
- 未上传材料时，界面只显示材料入口和示例格式，不展示虚构分析。
- 全部错误状态给出下一条可执行操作；不显示内部状态码、Provider 信息或敏感诊断。

## 12. 后端实现任务

| 顺序 | 任务 | 主要文件/模块 | 完成标准 |
|---:|---|---|---|
| 1 | 定义 Artifact、Attempt、Diagnosis、Action 契约 | `packages/contracts/openapi.yaml` | 合同测试覆盖成功、鉴权和错误分支 |
| 2 | 实现 `LearningArtifactService` 与私有材料存储边界 | `domains/learning-artifact/` | 跨账户读取、对象伪造和超限文件被拒绝 |
| 3 | 将 Companion Cycle 改为 Action 投影状态机 | `domains/companion-cycle/` | 一个 cycle 只存在一个活跃行动 |
| 4 | 实现材料驱动诊断编排 | 新 `diagnosis-service.ts` + AI Gateway | 结果可引用材料，失败可降级 |
| 5 | 让证据提交原子更新 Attempt、Action、Cycle | `companion-cycle-service.ts` | 幂等重放不生成第二个行动 |
| 6 | 改造路线刷新输入 | `learning-route-service.ts` | 仅经用户确认的摘要可刷新路线 |
| 7 | 替换前端自评诊断 | `apps/user_client/src/app.js`、`pages/index.js` | 完成后不显示可写旧动作 |
| 8 | 加入埋点和成本记录 | telemetry + AI Gateway | 可计算激活、恢复、留存和成本 |

## 13. 迁移策略

### 13.1 不迁移为事实的数据

现有 `pilot.initial_diagnostic`、自填 `correct/incorrect/unverified`、旧 `next_action` 和旧规则复盘不能转化为 Diagnosis 或长期记忆；它们缺少材料引用与可验证依据。

保留为只读历史展示，标记为“旧版自填记录”。不得用于重新生成路线、判定能力或驱动 Agent。

### 13.2 兼容路径

1. 发布新的 `screen_state` 字段与 Action 投影。
2. 新客户端优先读取 Action；旧客户端继续只读现有 cycle，写操作返回迁移提示。
3. 现有已完成 cycle 统一投影为 `cycle_completed`，确保不再显示诊断提交。
4. 新用户直接进入材料驱动首日流程；已有用户在下一次进入时看到“提交当前材料，生成新的行动卡”。
5. 观察一周无旧客户端写入后，移除旧诊断表单及相关客户端状态。

## 14. 安全、隐私与成本

### 14.1 数据安全

- 题目、笔记、草稿和附件默认私有，不用于公共知识库训练或推荐，除非用户另行授权。
- 日志只记录 artifact ID、哈希、处理状态和原因码；不得记录题目全文、草稿全文、签名 URL 或模型密钥。
- 文件扫描、MIME/大小限制、私有对象键校验和短时签名 URL 是附件流程的上线前置条件。
- 删除账户时，删除或按已声明策略匿名化材料、Attempt、Diagnosis、Cycle、Memory 与派生索引。

### 14.2 AI 成本

- 单次诊断上限为 3 个材料引用、1 个尝试、最多 4 条已确认记忆。
- 相同 `actorId + actionId + actionVersion + artifact hash + attempt hash` 的请求复用已完成诊断。
- 无材料、完成确认、普通开始和首次卡住优先走确定性流程。
- 所有模型调用经过现有 AI Gateway 的鉴权、并发、预算、审计、输出校验和 Provider 降级机制。

## 15. 测试与验收

### 15.1 必须新增的自动化测试

```text
tests/integration/learning-artifact-api.test.ts
tests/integration/artifact-companion-loop.test.ts
tests/contract/artifact-companion-contract.test.ts
apps/user_client/tests/artifact-companion-routes.test.mjs
```

至少覆盖：

- 未认证、跨账户、伪造对象键、超限文本和非法 MIME 全部被拒绝。
- 用户不能用不存在或其他账户的 artifact 生成诊断。
- 模型引用了未输入材料、无法定位的引文、非法枚举、超长文本或“掌握”断言时，服务端拒绝结果并降级。
- 同一 action 的证据重复提交只产生一个 Attempt 结算和一个后续行动。
- `completed` 后 UI 不存在 `submit-evidence`、`start`、`stuck` 控件；服务端旧写入返回可读冲突响应。
- 诊断完成后，新 action 的 `diagnosis_ref` 与 `artifact_refs` 完整存在；不得只由错误计数生成。
- 路线刷新必须有用户确认；未确认的诊断不得改写路线。
- 记忆候选在用户确认前不会进入长期 Agent 上下文。
- 服务重启后，材料元数据、行动、尝试、诊断和确认记忆仍可读取且账号隔离。

### 15.2 真实账号验收路径

```text
注册试点账号
  -> 提交一份真实题目与一份作答草稿
  -> 得到含材料引用的行动卡
  -> 开始并提交证据
  -> 获得新行动或完成状态
  -> 刷新浏览器、重新登录、重启服务
  -> 验证材料、行动、诊断和记忆仍存在
```

验收失败条件：任何一步需要用户重新填写已提交材料、完成后仍可提交旧行动、诊断不含材料引用，或下一步与本次证据无关。

## 16. 两周封闭试点与决策门槛

招募 15 至 20 名真实考研学生，连续运行 14 天。试点不以页面浏览量、注册数或聊天次数判定成功。

| 指标 | 定义 | 首期门槛 |
|---|---|---:|
| 首次行动激活 | 登录后 10 分钟内开始一条 Action | >= 60% |
| 材料二次提交 | 用户在首份材料后再次提交真实材料 | >= 45% |
| 卡住后恢复 | 标记 stuck 后 48 小时内完成或替换行动 | >= 35% |
| D7 留存 | 首日激活用户第 7 天仍有真实行动 | >= 35% |
| 诊断可解释性 | 用户认为“下一步依据了我的材料”评分 4/5 以上 | >= 70% |
| 付费意愿 | 完成至少 3 个循环的用户中，愿为持续服务付费 | >= 10% |

这些是待验证目标，不是现有经营数据。若材料二次提交或卡住后恢复低于门槛，停止新增视觉、世界观、泛学习和付费功能，先分析“材料输入 -> 行动 -> 证据”哪一环没有创造价值。

## 17. 上线完成定义

只有同时满足以下条件，才能称为“真实材料驱动的考研陪伴 Agent 已上线”：

1. 新用户能在 90 秒内提交材料并获得含材料依据的首个行动。
2. 每条个性化行动均有服务端 action ID、版本、材料引用、诊断引用、时长和预期证据。
3. 已完成或已替换的行动永远不会在客户端出现可写提交控件。
4. AI 不可用、材料不足或模型结果不可信时，系统明确降级，不伪造诊断成功。
5. 材料、行动、尝试、诊断和已确认记忆可跨刷新、重新登录和服务重启持久化读取。
6. 14 天真实试点至少能够回答：用户是否更快开始、卡住后是否回来、是否再次交付材料、是否愿意为连续价值付费。
