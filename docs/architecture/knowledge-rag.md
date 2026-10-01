# 官方知识 RAG

砺境的知识系统分为两条边界：

## 两套知识

- **个人知识库**：用户的学习记录、错题、困难、掌握反馈和目标上下文。它回答“这个用户现在处在什么状态”。数据按账户隔离，由 `MemoryService` 和用户状态服务管理。
- **官方知识 RAG**：考研、考公等目标域的来源目录和经过审核的知识片段。它回答“这条建议依据什么”。检索结果必须携带 `source_id`、`chunk_id`、来源 URL、索引版本和审核状态。

个人知识不能覆盖官方来源。动态日期、报名条件、职位数量、院校要求等事实没有检索证据时，只能进入 `facts_to_confirm`，不能由模型补全。

## 生成链路

```text
用户目标与条件
  -> 官方知识检索
  -> 个人知识上下文
  -> AI Gateway
  -> 结构化路线草案
  -> 时间容量校验
  -> 返回来源证据和待核验事项
  -> 用户确认
```

当前 v1 使用服务端持久化的审核知识索引和确定性关键词/二元组召回，确保本地和测试环境可运行。2026-09-20 起，考研素材包中的政策与科目结构条目进入官方索引，数学、408、英语和政治的框架与诊断映射进入独立的学习指导索引；随后加入 Python、HTML/CSS/JavaScript/HTTP、Git、PostgreSQL、TypeScript、OWASP Web/LLM 安全、Go、Java、Linux、C 工具链、AI 风险治理，以及 GitHub 学习资源调研的 9 条学习节点。当前索引为 `2026-09-20.rag-v8`，共 128 个审核知识片段和 34 个来源入口；T1/T2事实证据、T3学习方法和个人成长技术资料仍分开标注。检索服务的输入输出与模型生成解耦，后续可以把索引适配器替换为 PostgreSQL `pgvector` 或混合检索，而不改变 `/api/v1/knowledge/search` 和 `/api/v1/learning-routes` 的契约。

## 当前接口

- `GET /api/v1/knowledge/sources`：读取官方来源目录。
- `GET /api/v1/knowledge/search?goal_type=...&q=...&region=...`：读取带来源证据的检索结果。
- `POST /api/v1/learning-routes`：检索官方知识后生成路线草案；响应中的 `knowledge_evidence` 是本次实际注入模型的证据。

索引当前通过已有后端数据库适配器保存。未配置 `SUPABASE_DATABASE_URL` 时使用内存适配器，重启会丢失；配置后会持久化到服务端 KV。客户端不能直接访问数据库、来源索引或模型 Provider。
