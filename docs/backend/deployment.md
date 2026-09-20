# 部署砺境 Web + API

当前部署入口是一体化 Node 服务：同一个进程提供 `apps/user_client` 静态页面和 `/api/v1` API。生产数据使用 Supabase PostgreSQL，Provider 只从服务器环境变量读取。

## 1. Supabase 初始化

在 Supabase SQL Editor 或 Supabase CLI 执行：

```text
supabase/migrations/202609040001_create_lijing_runtime_kv.sql
```

该迁移创建后端专用的 KV 存储。用户、会话、学习事实、幂等记录和 AI 请求都按服务端 key 保存；客户端不能访问这张表。生产连接串使用 Supabase pooler 的连接信息，并打开 TLS。

## 2. 生产环境变量

最少需要在部署平台的 Secret/Environment Variables 中设置：

```text
APP_ENV=production
NODE_ENV=production
HOST=0.0.0.0
PORT=<平台提供的端口，未提供时使用 4187>
SUPABASE_DATABASE_URL=<生产 Supabase PostgreSQL 连接串>
SUPABASE_DB_SSL=true
# 自建 PostgreSQL 使用独立 CA 时，再设置为服务器上的公开 CA 文件路径。
# SUPABASE_DB_SSL_CA=/etc/lijing/certs/postgres-ca.crt
# 如果连接地址是本机/内网地址，但证书签发给另一主机，再设置证书身份。
# SUPABASE_DB_SSL_SERVER_NAME=<证书中的主机名或 IP>
AI_ENABLED=true
AI_PROVIDER_BASE_URL=https://api.openai.com/v1
AI_PROVIDER_API_KEY=<仅服务器 Secret>
AI_MODEL=<已批准且有预算的模型名>
# 可选：用于记录单用户估算成本，不写入 Prompt 或模型响应。
# AI_INPUT_COST_PER_1K_USD=0
# AI_OUTPUT_COST_PER_1K_USD=0
# 限量公开试点：设置 15-20 个高熵邀请码，以逗号分隔。每个码只能注册一个账号。
# PILOT_INVITE_CODES=<仅服务器 Secret，不要写入公开文案>
```

不要把 `SUPABASE_DATABASE_URL`、`AI_PROVIDER_API_KEY`、`PILOT_INVITE_CODES` 或任何 session/token 写入 Git、前端变量、日志和聊天记录。生产环境必须保留 `APP_ENV=production`，这样固定开发 token 会被关闭，session cookie 会带 `Secure`。朋友圈试点应将邀请码私发给已确认参与者，而不是写在公开文案中。

## 3. Docker 部署

仓库自带 `Dockerfile`，可以部署到支持 Docker 的服务器、Railway、Render、Fly.io 或其他容器平台：

```powershell
docker build -t lijing .
docker run --rm -p 4187:4187 --env-file .env.production lijing
```

部署完成后先检查：

```powershell
Invoke-RestMethod https://<你的域名>/api/v1/health
```

响应中的 `ai_configured` 只有在 `AI_ENABLED=true`、Provider URL、密钥和模型都存在时才为 `true`。健康检查为 `200` 不代表 AI Provider 已通过真实调用，仍需用新注册账号完成一次 AI 请求验证。

未设置 `PILOT_INVITE_CODES` 时注册保持开放；设置后，注册页会明确要求邀请码。AI 输入默认上限为 12,000 个字符，超限请求会在调用 Provider 前以 `input_too_long` 拒绝。上线前仍需用新注册账号完成一次注册、登录、状态保存、刷新恢复和 AI 请求验证。

试点环境可以使用 `APP_ENV=pilot`。该环境和生产一样要求 `SUPABASE_DATABASE_URL`，禁止以内存库作为降级存储；如果启用 AI，也必须同时提供 Provider URL、密钥和模型。健康检查返回 `persistence: unknown` 时，不应邀请用户提交新的学习材料。

## 4. 账号和 AI 冒烟验证

```powershell
$register = @{ email = 'pilot@example.com'; password = 'change-this-password'; display_name = '公开测试行者' } | ConvertTo-Json
$session = Invoke-WebRequest https://<你的域名>/api/v1/auth/register -Method Post -ContentType 'application/json' -Body $register -SessionVariable webSession

Invoke-RestMethod https://<你的域名>/api/v1/auth/me -WebSession $webSession

$ai = @{
  request_id = [guid]::NewGuid().ToString()
  feature = 'concept_explanation'
  input = '请解释连续与可导的区别，并给出一个反例。'
} | ConvertTo-Json

Invoke-RestMethod https://<你的域名>/api/v1/ai/requests -Method Post -ContentType 'application/json' -Body $ai -Headers @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() } -WebSession $webSession
```

`/api/v1/auth/register`、`/api/v1/auth/login` 和 `/api/v1/auth/me` 返回的用户对象不包含密码哈希。AI 请求先快速返回 `accepted`，再通过 request state 查询最终结果；AI Provider 失败时返回 `degraded` 模板状态，不伪装成模型成功。

## 5. 上线前检查

- Supabase 已执行迁移，连接串来自生产 Secret，数据库备份和恢复演练已完成。
- Provider 项目、模型、日/月预算、告警和停用开关已确认，先用小范围试点。
- 域名使用 HTTPS，反向代理/平台健康检查指向 `/api/v1/health`。
- 运行 `pnpm backend:test`、`pnpm contract:lint`、`pnpm client:test`、`pnpm client:ai:test` 和 `git diff --check`。
- 真实 Provider 调用和真实公网部署必须单独记录证据；本地 mock、Docker 构建或健康检查不能替代它们。
- Provider 试点前烟测：`pnpm agent:provider-smoke`。脚本只输出请求数、成功率、延迟和错误码，不输出模型响应或密钥。
- 个人材料检索评估：`pnpm rag:evaluate`，当前固定评估集包含 20 个数学/408 案例，目标为 recall@3 ≥ 95%。
- 账户级 Agent 使用汇总：登录后读取 `GET /api/v1/me/ai/usage`，只返回运行次数、降级率、token 估算和估算成本。
