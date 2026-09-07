# 本地后端纵向切片

这是一条可运行的本地 API 纵向切片，目标是先把客户端和真实后端之间的信任边界固定下来，再替换基础设施适配器。

## 启动

```powershell
$env:HOST='127.0.0.1'
$env:PORT='4400'
$env:AI_ENABLED='false'
pnpm backend:serve
```

本地开发默认使用：

- `IdentityService`（注册、登录、session cookie；另保留仅本地开发用的固定 token）
- `InMemoryDatabase`
- `InMemoryCache`
- `InMemoryMessageBus`
- `MockAiProvider`

这些适配器只用于开发和测试，进程重启后数据会丢失。

## 用户级状态持久化

登录用户的资料、目标、引路器选择、知识节点、今日任务显示状态和最近一次证据/复盘会通过：

- `GET /api/v1/me/state` 读取
- `PUT /api/v1/me/state` 保存

服务端从会话或 bearer 身份取得 `actorId`，客户端不能指定其他用户 ID。当前实现使用已有的服务端数据库适配器按 `user:state:<actorId>` 保存，并要求 `Idempotency-Key` 防止重复写入。答题判定、奖励、能量和长期记忆仍由各自的服务端领域接口负责，用户状态接口不会接受这些结算结果作为权威事实。

本地没有设置 `SUPABASE_DATABASE_URL` 时，接口仍可用但使用测试用 `InMemoryDatabase`，重启后会丢失；要验证真实跨重启持久化，必须执行迁移并在 API 服务环境设置 Supabase PostgreSQL 连接串。

## 注册、登录和会话

注册和登录会通过 `HttpOnly; SameSite=Lax` 的 `lijing_session` cookie 建立会话，服务端只保存密码哈希和 session token 哈希，不保存明文密码或明文 session。浏览器端使用同源 cookie；脚本客户端也可以把 cookie 或服务端签发的 bearer token 放入请求头。

```powershell
$register = @{ email = 'pilot@example.com'; password = 'correct horse battery'; display_name = '试点行者' } | ConvertTo-Json
$session = Invoke-WebRequest http://127.0.0.1:4400/api/v1/auth/register -Method Post -ContentType 'application/json' -Body $register -SessionVariable webSession

Invoke-RestMethod http://127.0.0.1:4400/api/v1/auth/me -WebSession $webSession
Invoke-RestMethod http://127.0.0.1:4400/api/v1/auth/logout -Method Post -WebSession $webSession
```

登录使用 `POST /api/v1/auth/login`，请求字段为 `email` 和 `password`。重复邮箱返回 `409`，错误密码返回通用 `401`，避免暴露账号是否存在。

## 切换 Supabase PostgreSQL

先在 Supabase SQL Editor 或 Supabase CLI 中执行 [`202609040001_create_lijing_runtime_kv.sql`](E:/AI个人OS/supabase/migrations/202609040001_create_lijing_runtime_kv.sql)。该表是当前纵向切片的兼容存储层，已启用 RLS，并撤销了 `anon`、`authenticated` 和 `public` 的表权限；只有后端数据库连接角色可以访问。

然后只在 API 服务环境中设置连接串：

```powershell
$env:SUPABASE_DATABASE_URL='postgresql://postgres.<project-ref>:<password>@<pooler-host>:5432/postgres'
$env:SUPABASE_DB_SSL='true'
# 自建 PostgreSQL 使用独立 CA 时，设置公开 CA 文件路径；不要把私钥或密码写入仓库。
# $env:SUPABASE_DB_SSL_CA='infra/certs/aliyun-wuhan-postgres-ca.crt'
$env:PORT='4400'
pnpm backend:serve
```

连接串包含数据库密码，不能提交到 Git、前端变量、日志或浏览器。服务会使用真实 PostgreSQL 事务，因此答题结算、幂等键和 AI 并发计数不会因为 API 进程重启而丢失。

## 接入 OpenAI 兼容 Provider

密钥只放在 API 进程环境中：

```powershell
$env:AI_ENABLED='true'
$env:AI_PROVIDER_BASE_URL='https://api.openai.com/v1'
$env:AI_MODEL='你的模型名'
$env:AI_PROVIDER_API_KEY='只在服务端设置'
pnpm backend:serve
```

Provider 通过服务端 `POST /chat/completions` 调用。客户端不能直接访问 Provider，也不能读取密钥。

## 本地开发身份

仅本地开发适配器提供两个固定令牌：

- `dev-user-001-token` -> `account-001`
- `dev-user-002-token` -> `account-002`

生产环境默认关闭这两个固定令牌；公网只使用注册登录建立的 session。它们只用于没有初始化账号数据的本地回归测试，不得用于公网。

## 接口示例

读取进度：

```powershell
Invoke-RestMethod http://127.0.0.1:4400/api/v1/me/progress -Headers @{ Authorization = 'Bearer dev-user-001-token' }
```

提交答题。服务端只接受意图字段，`correct`、`mastery_state`、`reward_summary` 等客户端伪造字段会被拒绝：

```powershell
$body = @{
  request_id = '11111111-1111-4111-8111-111111111111'
  attempt_id = 'attempt-001'
  question_id = 'limits-continuity-001'
  answer = 'B'
  action = 'submit'
} | ConvertTo-Json

Invoke-RestMethod http://127.0.0.1:4400/api/v1/learning/attempts `
  -Method Post `
  -Headers @{ Authorization = 'Bearer dev-user-001-token'; 'Idempotency-Key' = 'attempt-key-000001' } `
  -ContentType 'application/json' `
  -Body $body
```

调用正式 AI Gateway：

```powershell
$body = @{
  request_id = '22222222-2222-4222-8222-222222222222'
  feature = 'concept_explanation'
  input = '请解释连续与可导的区别，并给出一个反例。'
} | ConvertTo-Json

Invoke-RestMethod http://127.0.0.1:4400/api/v1/ai/requests `
  -Method Post `
  -Headers @{ Authorization = 'Bearer dev-user-001-token'; 'Idempotency-Key' = 'ai-key-0000000001' } `
  -ContentType 'application/json' `
  -Body $body
```

POST 会快速返回 `accepted`，客户端再用返回的 `request_id` 轮询 `GET /api/v1/ai/requests/{request_id}`，直到得到 `completed`、`degraded` 或 `rejected`；客户端必须按状态处理，不能把 `degraded` 当成模型成功。

## 查询官方知识 RAG

路线生成会自动按目标类型、地区和重点内容检索官方知识片段。也可以直接查看检索结果：

```powershell
Invoke-RestMethod 'http://127.0.0.1:4400/api/v1/knowledge/search?goal_type=postgraduate_entrance_exam&q=专业目录%20数学&region=江西' `
  -Headers @{ Authorization = 'Bearer dev-user-001-token' }
```

结果中的 `chunk_id`、`source_id`、`knowledge_index_version` 和 `source.official_url` 用于追溯依据。没有检索依据的动态事实不会被当成已确认事实写入路线；路线会把它们放入 `facts_to_confirm`。

## 已实现的服务端控制

- Bearer 身份映射和用户数据隔离。
- 学习答题的服务端判题、奖励、能量和掌握状态结算。
- `Idempotency-Key` 按用户和操作范围隔离，并拒绝不同请求复用同一键。
- AI 输入长度、图片数量、日配额、突发限额、每用户并发限制和 Provider 输出校验。
- AI 审计只保存 feature、状态、原因和输入 SHA-256，不保存原始提示词。
- Provider 失败降级为 `template`，不把失败伪装成模型结果。
- 统一请求 ID、追踪 ID、安全错误响应和基础健康检查。

## 上生产前必须替换

1. 当前用户和 session 已可通过 Supabase KV 持久化；后续按增长需要迁移到结构化 Identity 表，并保留唯一约束和审计记录。
2. 用 Redis 或同等共享存储实现跨实例限流、并发租约和幂等锁。
3. 接入邮箱验证、密码找回、设备管理和管理员 MFA；这些需要邮件/短信服务和运维策略，当前未伪造为已完成。
4. 增加 Provider 内容安全、敏感信息识别、成本账本、预算 kill switch 和人工复核策略。
5. 增加 outbox/event 消费、结构化日志、指标、告警、备份恢复和灰度部署。
6. 在正式域名、隐私政策、数据分类、未成年人保护和上线审批完成后再开放公网流量。
