# Agent 真实试点可靠性

本手册用于 2026-09-21 至 2026-10-18 的 3–5 个真实账号试点。它只覆盖材料驱动的“材料 → 诊断 → 行动 → 证据”闭环，不包含图片/OCR、周回望、候选记忆、路线自动刷新或向量数据库。

## 放量前硬门槛

- `APP_ENV=pilot` 或 `production`。
- `SUPABASE_DATABASE_URL` 已配置，`SUPABASE_DB_SSL` 未关闭，`/api/v1/health` 返回 `persistence: durable`。
- `lijing_runtime_kv` 迁移已执行，连接池、事务提交/回滚和数据库重启恢复已验证。
- `pnpm backend:test`、`pnpm contract:lint`、`pnpm client:test`、`pnpm client:ai:test` 和 `pnpm rag:evaluate` 通过。
- `pnpm agent:provider-smoke` 至少 20 次请求，成功率达到 95%；失败请求必须进入可解释降级。
- 登录后调用 `GET /api/v1/me/ai/usage` 可以看到运行次数、降级率、token 估算和估算成本，且不包含材料、Prompt 或模型响应。

## 真实账号验收

每个账号连续使用 7 天，至少覆盖：

1. 登录后粘贴题目、笔记或草稿。
2. 获取材料引用、诊断摘要和唯一行动卡。
3. 提交符合 `expected_evidence` 的证据，生成下一行动。
4. 在行动进行中刷新页面、重启 API、退出登录再重新登录。
5. 覆盖一次卡住、一次 Provider 降级和一次旧行动版本冲突。
6. 使用另一个账号尝试读取、引用或提交前一个账号的资源，必须被拒绝且不泄露资源存在性。

记录账号、时间、`run_id`、`action_id`、状态、错误码和恢复结果；不要记录原始题目、笔记、Prompt、模型响应、token 或 session 内容。

## 故障判断

- `persistence_unavailable`：本次操作没有保存；不要向用户显示成功，也不要切换到内存状态。
- `ACTION_VERSION_CONFLICT`：先重新获取 `/api/v1/companion/today`，不要重复提交旧证据。
- `degraded`：只显示“基于材料生成的保底行动”，不能给出掌握度、正确率或路线结论。
- `need_material`：要求用户提交自己的题目、笔记或草稿，不根据空上下文猜测错因。
- 健康检查为 `persistence: unknown`：停止邀请新的材料提交，先恢复数据库连接。

## 放量记录

试点每周记录首个行动完成率、D7 留存、每周学习证据次数、卡住后 48 小时回归率、理解度评分、单用户 Agent 成本和降级率。只有数据库恢复 100% 通过、Provider 双门槛通过、无跨账户泄露/假成功，并且 3–5 个账号连续 7 天无阻断性问题后，才进入 15–20 人、14 天试点。
