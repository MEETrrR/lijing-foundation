# 「砺境」生产级产品实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在中国大陆面向真实用户上线一套可运营的 RPG 游戏化 AI 学习平台，同时具备国家级比赛展示所需的完整闭环、真实数据和 3A 视觉表现。

**Architecture:** 采用 Flutter/Dart 统一用户端、React/Next.js/TypeScript 管理端、TypeScript/NestJS 模块化单体后端。业务事实由领域模块和服务端状态机维护，模块之间通过版本化 API 与领域事件通信；AI 统一经过 AI Gateway；启动、职业选择、地图、战斗和 Boss 演出由独立 Experience Runtime 承载。

**Tech Stack:** Flutter/Dart；React/Next.js/TypeScript；NestJS/TypeScript；PostgreSQL；Redis；可替换的消息队列；S3 兼容对象存储/CDN；OpenAPI/JSON Schema；OpenTelemetry；可替换的 AI Provider Adapter；Rive/Lottie/Spine/Canvas/WebGL 等视觉适配器。

---

## 执行边界

本计划覆盖多个可独立验收的子系统，执行时必须按任务边界拆分，不允许把所有模块堆进一个大版本。推荐顺序是：

1. 安全、契约和基础设施基线。
2. 身份、内容、答题、掌握度和复习闭环。
3. 任务、Boss、成长和表现事件。
4. AI Gateway 与 AI 助手基础能力。
5. 客户端 Study Runtime、RPG Runtime 和 Experience Runtime。
6. 管理后台、分析指标和比赛证据导出。
7. 灰度发布、真实用户试点、压测与灾备演练。

任何后续功能必须先回答：它属于哪个领域、谁拥有它的数据、通过哪个 API/事件接入、如何限流/审计/回滚。

## 预期仓库结构

实施开始前创建以下边界；目录只是职责边界，不允许用一个大文件跨域承载业务：

```text
apps/
  user_client/
  admin_web/
services/
  api/
packages/
  contracts/
  domain-kernel/
  design-tokens/
  experience-contracts/
  ai-policy/
infra/
  environments/
  migrations/
  observability/
docs/
  architecture/
  security/
  runbooks/
tests/
  contract/
  integration/
  load/
```

## Task 1: 建立安全、契约和仓库基线

**目标：** 在写业务逻辑前固定目录、接口、版本、数据分类和安全闸门。

**Files:**
- Create: `README.md`
- Create: `docs/architecture/module-boundaries.md`
- Create: `docs/architecture/api-versioning.md`
- Create: `docs/security/threat-model.md`
- Create: `docs/security/ai-abuse-playbook.md`
- Create: `docs/security/data-classification.md`
- Create: `packages/contracts/openapi.yaml`
- Create: `packages/contracts/events/event-envelope.schema.json`
- Create: `packages/ai-policy/default-policy.yaml`
- Create: `infra/environments/environment-matrix.md`
- Test: `tests/contract/contract-lint.test.ts`

- [ ] **Step 1: 初始化仓库边界与开发规范**

  创建 monorepo 目录、统一命名规则、环境变量命名规则、日志字段规范和模块依赖规则。README 必须明确：客户端不可信、奖励由服务端结算、AI 不可直连 Provider、模块不得跨表写入。

- [ ] **Step 2: 定义 API 与领域事件版本规则**

  在 `packages/contracts/openapi.yaml` 中约定 `/api/v1`，每个写入用例必须支持 `request_id` 和幂等键；在事件 Schema 中固定 `event_id`、`event_type`、`event_version`、`aggregate_id`、`actor_id`、`request_id`、`occurred_at`、`schema_version` 和 `payload`。

- [ ] **Step 3: 定义数据分类与日志脱敏规则**

  将账户识别信息、设备摘要、学习事实、AI 请求、上传文件、审计记录和运营统计分级。明确任何日志不得出现密码、访问 Token、模型密钥、完整手机号、完整对话原文和公开对象存储签名地址。

- [ ] **Step 4: 写出 AI 防刷与事故处置策略**

  `default-policy.yaml` 固定服务端可调整的起始值：新账户前 24 小时每日 5 次、普通账户每日 20 次、10 分钟 3 次、单用户并发 1、单次输入 4,000 Token、单次输出 1,000 Token、图片每次 2 张且每张 5 MB、复杂视觉/长文每日 3 次。策略必须带版本、有效期、调整人和审计理由。

- [ ] **Step 5: 编写契约校验测试并运行**

  Run: `pnpm contract:lint`

  Expected: OpenAPI、事件 Schema 和 AI policy 均通过校验；缺少版本、幂等字段或必需审计字段时测试失败。

- [ ] **Step 6: 提交基线变更**

  当仓库完成 Git 初始化后，提交：`chore: establish architecture and security contracts`。

## Task 2: 建立生产基础设施与观测能力

**目标：** 让后续模块在隔离环境、可观测、可回滚的基础上运行。

**Files:**
- Create: `services/api/src/platform/config/configuration.ts`
- Create: `services/api/src/platform/http/request-context.ts`
- Create: `services/api/src/platform/errors/error-catalog.ts`
- Create: `services/api/src/platform/security/secret-provider.ts`
- Create: `services/api/src/platform/observability/telemetry.ts`
- Create: `services/api/src/platform/persistence/database.ts`
- Create: `services/api/src/platform/cache/cache.ts`
- Create: `services/api/src/platform/messaging/message-bus.ts`
- Create: `infra/environments/local.env.example`
- Create: `infra/environments/staging.env.example`
- Create: `infra/environments/production.env.example`
- Create: `infra/observability/dashboards/core-metrics.json`
- Create: `docs/runbooks/incident-response.md`
- Create: `tests/integration/platform-health.test.ts`

- [ ] **Step 1: 定义 local、staging、production 三套配置边界**

  三套环境分别使用独立数据库、Redis、对象存储、队列、AI 凭证和预算。示例文件只写变量名和安全说明，不写真实密钥。

- [ ] **Step 2: 实现统一请求上下文与错误目录**

  每个请求生成或继承 `trace_id`、`request_id`、客户端版本和匿名设备摘要。错误响应只返回用户可理解的错误码与重试建议，内部堆栈只能进入受控日志。

- [ ] **Step 3: 建立数据库、缓存、消息和密钥适配器**

  业务模块只能依赖接口，不直接依赖某一家云厂商 SDK。缓存不可作为唯一事实；消息消费必须支持幂等、重试和死信。

- [ ] **Step 4: 建立基础监控看板与告警**

  至少包含 API 成功率、P95/P99、5xx、限流、队列积压、数据库连接、AI 请求量、Token、成本、拒绝率、降级率和客户端崩溃率。

- [ ] **Step 5: 写健康检查与配置泄露测试**

  Run: `pnpm test tests/integration/platform-health.test.ts`

  Expected: 健康检查能区分应用、数据库、缓存、队列和对象存储；测试必须确认日志和错误响应不会泄露密钥或完整个人信息。

- [ ] **Step 6: 提交基础设施变更**

  提交：`chore: add production platform and observability baseline`。

## Task 3: 实现 Identity、User Profile 与权限基础

**目标：** 建立安全账户、会话、设备、用户目标和组织/租户上下文，为个人用户和未来 B 端隔离数据。

**Files:**
- Create: `services/api/src/modules/identity/`
- Create: `services/api/src/modules/user-profile/`
- Create: `services/api/src/modules/policy-configuration/`
- Create: `services/api/src/modules/identity/identity.module.ts`
- Create: `services/api/src/modules/identity/application/session-service.ts`
- Create: `services/api/src/modules/identity/domain/account.ts`
- Create: `services/api/src/modules/identity/domain/session.ts`
- Create: `services/api/src/modules/identity/infrastructure/identity-repository.ts`
- Create: `services/api/src/modules/user-profile/application/profile-service.ts`
- Create: `services/api/src/modules/policy-configuration/application/policy-service.ts`
- Create: `tests/integration/identity/session-security.test.ts`
- Create: `tests/integration/user-profile/profile-rights.test.ts`

- [ ] **Step 1: 定义账户、会话、设备和租户边界**

  内部使用不可预测的 `account_id`；手机号、邮箱和第三方身份标识与账户主键隔离。Web 使用安全 Cookie，移动端使用操作系统安全存储；长期凭证不能放在 `localStorage`。

- [ ] **Step 2: 实现会话轮换、撤销和风险升级**

  验证码、重置密码和高风险操作都有过期时间、尝试次数、账户/设备/IP 频控；异常登录可以撤销全部会话并要求重新验证。

- [ ] **Step 3: 实现用户资料、目标和同意记录**

  资料服务支持考试目标、考试日期、可用时段、学习偏好、年龄段安全模式和协议版本同意记录。隐私设置、个性化推荐开关、数据导出和账号注销必须走服务端用例。

- [ ] **Step 4: 实现 RBAC、MFA 和危险操作保护**

  管理员角色至少区分客服、题库审核、内容运营、数据分析、财务和超级管理员；高危操作需要 MFA、二次确认和审计，普通管理员不能删除审计记录。

- [ ] **Step 5: 编写账户接管、越权和数据权利测试**

  Run: `pnpm test tests/integration/identity/session-security.test.ts tests/integration/user-profile/profile-rights.test.ts`

  Expected: 重放验证码、并发刷新凭证、跨账户访问、越权下载、注销后继续访问和普通管理员删除审计记录均失败。

- [ ] **Step 6: 提交身份与权限变更**

  提交：`feat: add secure identity and authorization foundation`。

## Task 4: 实现 Exam、Knowledge、Content 与 Assessment

**目标：** 建立有来源、有版本、有审核状态的知识点和题目基础，并记录不可覆盖的答题事实。

**Files:**
- Create: `services/api/src/modules/exam-knowledge/`
- Create: `services/api/src/modules/content/`
- Create: `services/api/src/modules/assessment/`
- Create: `services/api/src/modules/content/domain/content-version.ts`
- Create: `services/api/src/modules/content/domain/review-state.ts`
- Create: `services/api/src/modules/assessment/domain/question-attempt.ts`
- Create: `services/api/src/modules/assessment/application/submit-answer.ts`
- Create: `services/api/src/modules/assessment/application/evaluate-assessment.ts`
- Create: `services/api/src/modules/content/infrastructure/upload-quarantine.ts`
- Create: `tests/unit/content/content-versioning.test.ts`
- Create: `tests/integration/assessment/idempotent-answer.test.ts`
- Create: `tests/integration/content/upload-security.test.ts`

- [ ] **Step 1: 定义考试、科目、章节、知识点和标签关系**

  任何题目必须关联考试和至少一个知识点；知识点拥有稳定 ID，名称和解释可以版本化，不能用题目文本作为唯一标识。

- [ ] **Step 2: 定义内容来源、版权和审核状态**

  题目、解析、课程卡片和资源必须记录来源、版权状态、审核人、审核时间、版本、适用范围和下架状态。用户可见内容只能来自已发布版本。

- [ ] **Step 3: 实现答题尝试和服务端评估**

  客户端提交题目 ID、选项、开始/提交动作和幂等键；服务端读取答案版本完成评估，写入 `QuestionAttemptRecorded`，客户端不能提交正确与否、奖励或掌握度。

- [ ] **Step 4: 实现上传隔离区**

  上传先进入私有隔离区，重新检测 MIME、扩展名、大小、像素、病毒和脚本风险，再送 OCR/审核 worker。任何解析失败的文件不能进入公共内容池。

- [ ] **Step 5: 编写版本、重放和上传攻击测试**

  Run: `pnpm test tests/unit/content/content-versioning.test.ts tests/integration/assessment/idempotent-answer.test.ts tests/integration/content/upload-security.test.ts`

  Expected: 旧版本可还原历史答题；重复提交只结算一次；伪造正确率、奖励、文件类型、超大图片和恶意外链均被拒绝。

- [ ] **Step 6: 提交题库与答题基础**

  提交：`feat: add versioned learning content and assessment facts`。

## Task 5: 实现 Mastery、Review 与 Planning

**目标：** 将答题事实转换为可解释的知识点掌握度、复习任务和每日计划，不让掌握度与复习调度形成循环依赖。

**Files:**
- Create: `services/api/src/modules/mastery/`
- Create: `services/api/src/modules/review/`
- Create: `services/api/src/modules/planning/`
- Create: `services/api/src/modules/mastery/domain/mastery-state.ts`
- Create: `services/api/src/modules/review/domain/review-schedule.ts`
- Create: `services/api/src/modules/planning/domain/study-plan.ts`
- Create: `services/api/src/modules/mastery/application/update-mastery.ts`
- Create: `services/api/src/modules/review/application/schedule-review.ts`
- Create: `services/api/src/modules/planning/application/rebuild-daily-plan.ts`
- Create: `tests/unit/mastery/mastery-state-machine.test.ts`
- Create: `tests/unit/review/review-scheduler.test.ts`
- Create: `tests/unit/planning/time-allocation.test.ts`
- Create: `tests/integration/review/mastery-event-consumer.test.ts`

- [ ] **Step 1: 实现掌握度状态机**

  只消费答题评估结果，维护 `NEW`、`LEARNING`、`PRACTICED`、`MASTERED`、`DECAYING` 和 `REVIEW_DUE` 状态；每次迁移记录规则版本、输入事实和解释字段。

- [ ] **Step 2: 实现复习调度器**

  Review 模块消费 `MasteryUpdated` 事件，生成 1/3/7/15 天复习任务；连续巩固达到永久掌握条件时记录判定依据，不修改原始答题事实。

- [ ] **Step 3: 实现时间分配引擎**

  以分值占比、基础水平、进度落后系数和阶段比例计算计划；每日新知识点不超过 8 个，计划使用可用时间的 80%-90%，每 7 天生成轻量日。

- [ ] **Step 4: 实现周调整与异常疲劳提示**

  每周重算实际时长、正确率、掌握度和进度；连续超时且正确率下降时发布疲劳建议事件，不用惩罚机制逼迫用户继续学习。

- [ ] **Step 5: 编写规则与事件测试**

  Run: `pnpm test tests/unit/mastery/mastery-state-machine.test.ts tests/unit/review/review-scheduler.test.ts tests/unit/planning/time-allocation.test.ts tests/integration/review/mastery-event-consumer.test.ts`

  Expected: 重复消费同一事件不重复创建复习任务；规则版本可解释；跨时区、夏令时、跳过任务、无可用时间和连续失败均有稳定结果。

- [ ] **Step 6: 提交学习调度基础**

  提交：`feat: add mastery review and adaptive planning domains`。

## Task 6: 实现 Quest、Boss、Progression 与 Economy

**目标：** 将学习事实映射成安全的 RPG 反馈，保证客户端不能伪造奖励，付费不能购买知识掌握。

**Files:**
- Create: `services/api/src/modules/quest-boss/`
- Create: `services/api/src/modules/progression/`
- Create: `services/api/src/modules/economy/`
- Create: `services/api/src/modules/quest-boss/domain/quest-state.ts`
- Create: `services/api/src/modules/quest-boss/domain/boss-attempt.ts`
- Create: `services/api/src/modules/progression/domain/reward-ledger.ts`
- Create: `services/api/src/modules/economy/domain/balance-ledger.ts`
- Create: `services/api/src/modules/progression/application/settle-reward.ts`
- Create: `tests/unit/progression/reward-ledger.test.ts`
- Create: `tests/integration/quest-boss/server-authoritative-settlement.test.ts`
- Create: `tests/integration/economy/replay-and-double-spend.test.ts`

- [ ] **Step 1: 定义任务、关卡、怪物和 Boss 状态机**

  任务开始、答题、章节测试、失败重试和通关都由服务端状态机确认；失败不删除学习事实，不直接扣除用户已有掌握度。

- [ ] **Step 2: 实现奖励账本**

  EXP、金币、体力、道具和称号记录来源事件、规则版本、变更前后值和幂等键。客户端只展示服务端余额，不提交最终奖励。

- [ ] **Step 3: 实现战力与有效学习量化**

  战力只由知识点掌握、复习巩固率、测试正确率和系统课程完成度等学习事实计算；在线时长不参与战力结算。

- [ ] **Step 4: 预留 Economy 与 Billing 边界**

  首期只实现非付费道具和体力模型；未来付费权益通过独立 Billing 接入，不能直接写 Economy 余额或绕过学习结果。

- [ ] **Step 5: 编写奖励伪造和重放测试**

  Run: `pnpm test tests/unit/progression/reward-ledger.test.ts tests/integration/quest-boss/server-authoritative-settlement.test.ts tests/integration/economy/replay-and-double-spend.test.ts`

  Expected: 修改客户端时间、重复提交、并发结算、伪造掌握度、伪造通关和重复消费事件均不能产生额外奖励。

- [ ] **Step 6: 提交 RPG 核心闭环**

  提交：`feat: add server-authoritative rpg progression loop`。

## Task 7: 实现 AI Gateway、策略、审计与助手基础能力

**目标：** 让 AI 可用但不可被无限调用，所有模型请求、成本、风险和输出都可追踪、止损和回滚。

**Files:**
- Create: `services/api/src/modules/ai-gateway/`
- Create: `services/api/src/modules/ai-gateway/application/ai-request-service.ts`
- Create: `services/api/src/modules/ai-gateway/application/quota-service.ts`
- Create: `services/api/src/modules/ai-gateway/domain/ai-request.ts`
- Create: `services/api/src/modules/ai-gateway/domain/usage-ledger.ts`
- Create: `services/api/src/modules/ai-gateway/infrastructure/provider-adapter.ts`
- Create: `services/api/src/modules/ai-gateway/infrastructure/prompt-registry.ts`
- Create: `services/api/src/modules/ai-gateway/infrastructure/output-validator.ts`
- Create: `services/api/src/modules/ai-assistant/`
- Create: `services/api/src/modules/ai-assistant/application/assistant-use-cases.ts`
- Create: `services/api/src/modules/trust-safety/`
- Create: `tests/unit/ai-gateway/quota-policy.test.ts`
- Create: `tests/integration/ai-gateway/token-abuse.test.ts`
- Create: `tests/integration/ai-gateway/prompt-injection.test.ts`
- Create: `tests/integration/ai-gateway/provider-failure.test.ts`
- Create: `tests/evaluation/ai-assistant/regression-cases.yaml`

- [ ] **Step 1: 实现 AI Gateway 的请求闸门**

  依次校验身份、权限、账户/设备/IP/功能限流、日/月/全局预算、输入输出长度、附件大小、重复指纹和并发。所有拒绝写入 `AiRequestRejected` 与 usage ledger。

- [ ] **Step 2: 实现额度预留与最终结算**

  接受请求时预留额度；成功响应按实际 Token 结算；超时、拒绝和取消释放未使用额度，避免并发请求绕过预算。所有逻辑以 `request_id` 幂等。

- [ ] **Step 3: 实现 Provider Adapter 与熔断降级**

  Provider 适配器只接受规范化请求，不暴露密钥给业务模块；单请求最多一次有限重试。模型超时或全局预算触发时切换低成本模型、模板回答或异步队列。

- [ ] **Step 4: 实现 Prompt Registry、来源白名单和输出校验**

  系统指令、用户输入、检索内容和工具参数分层；工具只允许白名单动作；输出必须满足结构 Schema、敏感内容策略和答案来源/版本要求。

- [ ] **Step 5: 实现助手用例**

  首期只开放概念解释、错题提示、学习计划建议、进度查询和情绪支持安全响应；每个回答以学习行动收束，但不使用羞辱、恐吓、内疚、依赖诱导或考试作弊话术。

- [ ] **Step 6: 编写 Token、提示注入和 Provider 故障测试**

  Run: `pnpm test tests/unit/ai-gateway/quota-policy.test.ts tests/integration/ai-gateway/token-abuse.test.ts tests/integration/ai-gateway/prompt-injection.test.ts tests/integration/ai-gateway/provider-failure.test.ts`

  Expected: 批量注册、并发刷请求、重复请求、超长输入、越权工具、恶意上传、Provider 超时和预算耗尽均无法无限消耗 Token；系统能返回限额提示或安全降级。

- [ ] **Step 7: 建立 AI 离线回归集**

  `regression-cases.yaml` 至少覆盖概念解释、题目解析、情绪支持、作弊、危险请求、提示注入、越权、错误答案和隐私泄露。模型、Prompt、策略或供应商变化必须生成可比较评估结果。

- [ ] **Step 8: 提交 AI 安全边界**

  提交：`feat: add guarded ai gateway and assistant safety policies`。

## Task 8: 建立客户端基础与统一设计系统

**目标：** 让移动端和 Web 用户端共享业务契约和视觉语言，同时保持沉浸层与效率层边界。

**Files:**
- Create: `apps/user_client/lib/app/`
- Create: `apps/user_client/lib/core/network/`
- Create: `apps/user_client/lib/core/auth/`
- Create: `apps/user_client/lib/core/design_system/`
- Create: `apps/user_client/lib/features/study/`
- Create: `apps/user_client/lib/features/rpg/`
- Create: `packages/design-tokens/tokens.json`
- Create: `packages/design-tokens/motion.json`
- Create: `packages/experience-contracts/presentation-events.json`
- Create: `tests/client/navigation/auth-guard.test.dart`
- Create: `tests/client/design-system/token-coverage.test.dart`

- [ ] **Step 1: 建立 App Shell 与网络错误边界**

  实现路由、会话恢复、版本检查、网络状态、错误页、降级页和减少动态效果设置。所有写入请求携带幂等键并处理 trace ID。

- [ ] **Step 2: 建立设计 Token 与组件层**

  将颜色、字体、间距、层级、圆角、阴影、动效、声音和触感定义为 Token；业务页面只引用 Token，不散落硬编码颜色和时长。

- [ ] **Step 3: 建立 Study Runtime**

  先实现任务、知识点、题目、解析、错题、复习和 AI 对话的效率层组件；题面、答案状态、加载状态、错误状态和无障碍焦点必须独立可测试。

- [ ] **Step 4: 建立 RPG Runtime**

  消费服务端返回的关卡、怪物、Boss、经验和奖励状态；禁止客户端自行计算战力、掌握度和奖励。

- [ ] **Step 5: 编写客户端核心流程测试**

  Run: `flutter test tests/client/navigation/auth-guard.test.dart tests/client/design-system/token-coverage.test.dart`

  Expected: 未登录不能访问学习页；Token 过期能恢复或安全退出；网络失败不丢失已确认答题；减少动效模式不影响学习功能。

- [ ] **Step 6: 提交客户端基础**

  提交：`feat: add cross-platform app shell and study design system`。

## Task 9: 实现 3A Experience Runtime 与资源管线

**目标：** 在不阻塞学习事务的前提下，建立可持续生产高质量画面、角色、动画、音频和场景的视觉系统。

**Files:**
- Create: `apps/user_client/lib/experience/scene_host.dart`
- Create: `apps/user_client/lib/experience/asset_catalog.dart`
- Create: `apps/user_client/lib/experience/animation_orchestrator.dart`
- Create: `apps/user_client/lib/experience/character_presentation.dart`
- Create: `apps/user_client/lib/experience/audio_bus.dart`
- Create: `apps/user_client/lib/experience/haptic_adapter.dart`
- Create: `apps/user_client/lib/experience/performance_policy.dart`
- Create: `packages/experience-contracts/presentation-events.json`
- Create: `infra/assets/asset-manifest.schema.json`
- Create: `docs/architecture/visual-asset-pipeline.md`
- Create: `tests/client/experience/presentation-event.test.dart`
- Create: `tests/client/experience/asset-fallback.test.dart`
- Create: `tests/client/experience/reduced-motion.test.dart`

- [ ] **Step 1: 定义表现事件与业务事件映射**

  `QuestCompleted`、`BossDefeated`、`LevelUp` 和 `ReviewDue` 等服务端事件通过客户端映射为表现事件；动画完成不能反向修改业务状态。

- [ ] **Step 2: 实现资源清单与版本加载**

  清单记录资源 ID、版本、哈希、版权来源、尺寸、适用场景、最低客户端版本、降级资源和 CDN 地址。资源默认私有/签名访问，加载失败有静态降级。

- [ ] **Step 3: 实现沉浸场景**

  按优先级实现启动序列、职业选择、新手村、世界地图、怪物出现、Boss 战、升级和章节通关。每个场景支持跳过、静音、低清资源和减少动态效果。

- [ ] **Step 4: 实现角色与助手表现层**

  角色、职业、助手和装备外观只依赖 `AssetId`、表现状态和主题 Token；不把角色数值、掌握度或奖励逻辑写入动画脚本。

- [ ] **Step 5: 做视觉性能和回归测试**

  Run: `flutter test tests/client/experience/presentation-event.test.dart tests/client/experience/asset-fallback.test.dart tests/client/experience/reduced-motion.test.dart`

  Expected: 资源缺失、音频关闭、低端模式和动画异常都不阻塞答题与结算；同一表现事件不会重复触发奖励；关键场景可从错误状态恢复。

- [ ] **Step 6: 进行多尺寸视觉验收**

  在移动竖屏、移动横屏、桌面浏览器和比赛大屏比例下检查文字、按钮、角色、地图、特效和题目区域不重叠、不溢出。输出带设备、客户端版本和资源版本的验收记录。

- [ ] **Step 7: 提交 Experience Runtime**

  提交：`feat: add event-driven 3a experience runtime`。

## Task 10: 实现管理后台、Trust & Safety 与审核闭环

**目标：** 让真实运营人员能审核题目、处理举报、调整策略、查看成本和安全事件，不通过直接改数据库解决问题。

**Files:**
- Create: `apps/admin_web/src/modules/content-review/`
- Create: `apps/admin_web/src/modules/user-support/`
- Create: `apps/admin_web/src/modules/risk-control/`
- Create: `apps/admin_web/src/modules/analytics/`
- Create: `apps/admin_web/src/modules/feature-flags/`
- Create: `services/api/src/modules/trust-safety/`
- Create: `services/api/src/modules/analytics-evidence/`
- Create: `services/api/src/modules/notification/`
- Create: `docs/runbooks/content-incident.md`
- Create: `docs/runbooks/ai-cost-incident.md`
- Create: `tests/integration/admin/rbac-scope.test.ts`
- Create: `tests/integration/admin/content-review-workflow.test.ts`
- Create: `tests/integration/admin/ai-cost-kill-switch.test.ts`

- [ ] **Step 1: 实现题目、解析和 UGC 审核工作流**

  状态至少包含草稿、待机审、待人工审、已发布、已下架、申诉中和已恢复；每次状态变化记录操作人、原因、版本和影响范围。

- [ ] **Step 2: 实现举报、申诉和批量下架**

  支持按题目、知识点、资源版本、用户和传播范围查询；批量下架必须可预览、可确认、可回滚，不能直接删除历史事实。

- [ ] **Step 3: 实现 AI Token 看板与紧急开关**

  展示按用户、设备、IP、功能、模型、Prompt 版本和时间段的请求量、Token、成本、拒绝、降级和异常峰值；管理员可按功能或供应商关闭 AI，但操作需要 MFA 和审计。

- [ ] **Step 4: 实现运营策略与 feature flag**

  额度、规则、Prompt、推荐、题目和视觉资源均支持版本、有效期、灰度范围和回滚；高风险策略变更需要双人审批。

- [ ] **Step 5: 实现通知频控**

  早/中/晚提醒、复习提醒和公告按用户偏好、静默时间、重要等级和频率上限发送；打怪和 Boss 战期间不插入普通提醒。

- [ ] **Step 6: 编写后台越权、审核和止损测试**

  Run: `pnpm test tests/integration/admin/rbac-scope.test.ts tests/integration/admin/content-review-workflow.test.ts tests/integration/admin/ai-cost-kill-switch.test.ts`

  Expected: 不同角色只能看到授权数据；下架可追溯和回滚；AI 成本异常时能关闭对应功能而不影响登录和已确认学习记录。

- [ ] **Step 7: 提交运营后台与安全闭环**

  提交：`feat: add moderation operations and safety controls`。

## Task 11: 建立 Analytics & Evidence 与国奖材料数据链

**目标：** 让产品效果、用户试点、学习质量和安全成本都能从真实事件生成可解释证据。

**Files:**
- Create: `services/api/src/modules/analytics-evidence/event-consumer.ts`
- Create: `services/api/src/modules/analytics-evidence/metric-definitions.ts`
- Create: `services/api/src/modules/analytics-evidence/experiment-service.ts`
- Create: `services/api/src/modules/analytics-evidence/evidence-export.ts`
- Create: `docs/analytics/metric-dictionary.md`
- Create: `docs/analytics/pilot-study-protocol.md`
- Create: `tests/integration/analytics/event-replay.test.ts`
- Create: `tests/integration/analytics/evidence-export.test.ts`

- [ ] **Step 1: 定义指标字典**

  明确注册、激活、D1/D7 留存、有效学习时长、掌握知识点、复习完成率、正确率变化、计划完成率、AI 成本/用户、举报率和内容纠错时间的计算公式、时间窗口、数据来源和版本。

- [ ] **Step 2: 建立只读事件消费与可重建投影**

  Analytics 只能消费事件，不修改学习事实；投影损坏时可以从事件重建，指标结果记录计算版本。

- [ ] **Step 3: 建立试点实验与前后测**

  设计真实用户试点的招募、同意、前测、使用周期、后测、满意度和退出流程；比赛材料只导出脱敏、聚合和有来源的数据。

- [ ] **Step 4: 实现证据导出**

  导出用户增长、学习效果、留存、安全事件、AI 成本和课程/题库质量的 CSV/JSON/可读报告；每份报告带生成时间、指标版本、数据范围和脱敏说明。

- [ ] **Step 5: 编写重放与证据一致性测试**

  Run: `pnpm test tests/integration/analytics/event-replay.test.ts tests/integration/analytics/evidence-export.test.ts`

  Expected: 相同事件集重放得到相同指标；导出不包含手机号、Token、完整对话和未授权个人信息；指标能追溯到来源事件和计算版本。

- [ ] **Step 6: 提交数据证据链**

  提交：`feat: add auditable learning analytics and evidence exports`。

## Task 12: 生产发布、压测、灾备与真实用户试点

**目标：** 在公开推广前验证安全、容量、成本、恢复和真实学习闭环。

**Files:**
- Create: `infra/environments/production/deployment-manifest.yaml`
- Create: `infra/environments/production/backup-policy.yaml`
- Create: `infra/environments/production/alert-policy.yaml`
- Create: `tests/load/core-user-journey.k6.ts`
- Create: `tests/load/ai-gateway-abuse.k6.ts`
- Create: `tests/security/api-abuse.test.ts`
- Create: `docs/runbooks/release-checklist.md`
- Create: `docs/runbooks/backup-restore-drill.md`
- Create: `docs/runbooks/rollback.md`
- Create: `docs/release/pilot-release-report.md`

- [ ] **Step 1: 验证部署和密钥隔离**

  确认 production 不读取 local/staging 凭证；静态资源、数据库、队列、AI Provider 和后台权限均独立；构建产物可追溯到源码、依赖清单和版本。

- [ ] **Step 2: 运行核心用户链路压测**

  Run: `pnpm load:test tests/load/core-user-journey.k6.ts`

  Expected: 覆盖登录、首次测评、开始任务、答题、结算、复习和查询进度；报告包含吞吐、P95/P99、错误率、队列积压和数据库资源使用。

- [ ] **Step 3: 运行 AI 滥用和成本压测**

  Run: `pnpm load:test tests/load/ai-gateway-abuse.k6.ts`

  Expected: 批量注册、同账户并发、同设备多账户、重复请求、超长输入和 Provider 超时都被限流/降级；全局成本上限不会被突破。

- [ ] **Step 4: 运行安全与恢复演练**

  Run: `pnpm test tests/security/api-abuse.test.ts`

  Expected: 验证 CSRF、CORS、SSRF、文件上传、权限越界、请求重放、凭证撤销和日志脱敏；执行数据库恢复、对象存储恢复、队列死信恢复和回滚演练。

- [ ] **Step 5: 进行小规模真实用户试点**

  先邀请有限用户完成完整学习周期，观察有效学习时长、掌握度、复习完成率、AI 成本、崩溃率、举报率和客服问题。任何扩大用户范围的决定都必须引用试点数据和未解决风险清单。

- [ ] **Step 6: 完成大陆上线核对**

  核验域名/应用相关备案或登记、隐私与用户规则、第三方 SDK、素材版权、AI 服务形态、推荐策略、用户注销和数据删除流程；最终由专业合规人员确认，不用工程文档代替法律意见。

- [ ] **Step 7: 发布试点报告并确定推广闸门**

  在 `docs/release/pilot-release-report.md` 记录版本、用户范围、指标、事故、成本、内容质量、已知问题、回滚点和下一阶段放量条件。未满足安全、成本和学习效果闸门时，不进入大规模推广。

- [ ] **Step 8: 提交首个生产版本**

  提交：`release: launch guarded pilot for lijing`。

## 安全验收闸门

以下任一项不通过，都不能声明“可上线”：

- 客户端不存在 AI、数据库、对象存储或支付密钥。
- AI Gateway 能按账户、设备、IP、功能和全局预算限流，并能独立关闭高成本能力。
- AI 请求有输入/输出上限、并发上限、幂等、成本账本、超时、熔断和安全降级。
- 掌握度、复习、经验、金币、体力和通关结果均由服务端结算。
- 题目、解析、课程和素材有来源、版权、审核和版本记录。
- Web/移动端认证、管理员 MFA、RBAC、会话撤销和审计测试通过。
- 上传文件经过隔离、扫描和大小/类型限制，公共内容不能绕过审核。
- 生产环境有监控、告警、备份、恢复演练、灰度和回滚路径。
- 比赛数据可追溯、可脱敏、可解释，不伪造真实用户效果。
- 3A 动画、音效、资源加载或视觉引擎故障不会阻塞核心学习事务。

## 计划自审结果

- 已覆盖架构中的用户端、管理端、领域模块、AI Gateway、Trust & Safety、Analytics、3A Runtime、基础设施和部署恢复。
- 已覆盖用户提出的 Token 防刷、用户规范、工程安全、真实用户上线和国奖证据要求。
- 已避免把掌握度/复习和 AI/风控设计成双向硬依赖。
- 已明确所有高风险配置必须服务端可调整、带版本、有效期和审计记录。
- 未把 Unity/Unreal、社交、UGC、付费和就业大陆放进首个不可控大版本；它们保留在已有模块边界内逐步接入。

计划完成后，下一步不是直接写全部功能，而是从 Task 1 的安全与契约基线开始，逐任务验收。
