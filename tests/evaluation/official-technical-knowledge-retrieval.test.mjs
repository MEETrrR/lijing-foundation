import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { InMemoryDatabase } = require("../../services/api/src/platform/persistence/database.ts");
const {
  KNOWLEDGE_INDEX_VERSION,
  KnowledgeRetrievalService,
} = require("../../services/api/src/domains/knowledge-retrieval/knowledge-retrieval-service.ts");

const CASES = [
  ["python-control-flow", "Python for循环 enumerate zip 控制流", "official-2026-09-20-python-control-flow"],
  ["python-data-structures", "Python 列表 元组 集合 字典 deque 数据结构", "official-2026-09-20-python-data-structures"],
  ["python-comprehensions", "Python 列表推导式 enumerate zip sorted", "official-2026-09-20-python-comprehensions"],
  ["python-exceptions", "Python try except finally raise 异常处理", "official-2026-09-20-python-exceptions"],
  ["python-modules", "Python import 模块 命名空间 main 入口", "official-2026-09-20-python-modules"],
  ["python-classes", "Python 类 实例 继承 类属性 对象", "official-2026-09-20-python-classes"],
  ["python-asyncio", "Python asyncio async await 协程 并发", "official-2026-09-20-python-asyncio"],
  ["html-semantics", "HTML 语义化 元素 属性 嵌套 页面结构", "official-2026-09-20-mdn-html-semantics"],
  ["css", "CSS 选择器 层叠 盒模型 Flexbox Grid", "official-2026-09-20-mdn-css"],
  ["javascript", "JavaScript DOM 事件 函数 前端交互", "official-2026-09-20-mdn-javascript"],
  ["http", "HTTP 请求 响应 状态码 头部 API", "official-2026-09-20-mdn-http"],
  ["fetch", "Fetch Promise response.ok AbortController 取消请求", "official-2026-09-20-mdn-fetch"],
  ["accessibility", "Web 可访问性 a11y 键盘 语义 HTML 表单", "official-2026-09-20-mdn-accessibility"],
  ["git-workflow", "Git 工作区 暂存区 commit diff status", "official-2026-09-20-git-workflow"],
  ["git-branches", "Git 分支 HEAD switch 协作", "official-2026-09-20-git-branches"],
  ["git-merge", "Git merge 合并冲突 冲突标记 测试", "official-2026-09-20-git-merge-conflicts"],
  ["git-rebase", "Git rebase 历史重写 强推 冲突", "official-2026-09-20-git-rebase"],
  ["git-reset", "Git reset revert 撤销 恢复历史", "official-2026-09-20-git-reset-revert"],
  ["postgres-sql", "PostgreSQL SQL SELECT JOIN 表 关系数据库", "official-2026-09-20-postgres-sql"],
  ["postgres-transactions", "PostgreSQL 事务 BEGIN COMMIT ROLLBACK SAVEPOINT", "official-2026-09-20-postgres-transactions"],
  ["postgres-indexes", "PostgreSQL 索引 查询性能 写入开销", "official-2026-09-20-postgres-indexes"],
  ["postgres-explain", "PostgreSQL EXPLAIN 查询计划 顺序扫描 索引扫描", "official-2026-09-20-postgres-explain"],
  ["postgres-constraints", "PostgreSQL 约束 主键 外键 唯一 数据完整性", "official-2026-09-20-postgres-constraints"],
  ["typescript-types", "TypeScript 类型推断 any 联合类型 interface", "official-2026-09-20-typescript-everyday-types"],
  ["typescript-functions", "TypeScript 函数 参数 返回值 Promise 回调", "official-2026-09-20-typescript-functions"],
  ["typescript-narrowing", "TypeScript 联合类型 类型收窄 typeof 判别联合", "official-2026-09-20-typescript-narrowing"],
  ["typescript-generics", "TypeScript 泛型 类型参数 约束 可复用", "official-2026-09-20-typescript-generics"],
  ["owasp-top10", "OWASP Top10 Web安全 风险 威胁建模", "official-2026-09-20-owasp-top10"],
  ["owasp-authentication", "OWASP 认证 Session 密码 MFA TLS 账号枚举", "official-2026-09-20-owasp-authentication"],
  ["owasp-input", "OWASP 输入验证 白名单 参数 编码 注入", "official-2026-09-20-owasp-input-validation"],
  ["owasp-prompt-injection", "LLM 提示词注入 RAG Agent 越权 输出校验", "official-2026-09-20-owasp-llm-prompt-injection"],
];

test("official technical knowledge retrieves the expected reviewed node within top 3", async () => {
  const service = new KnowledgeRetrievalService({ database: new InMemoryDatabase() });
  const reports = [];
  for (const [id, query, expectedId] of CASES) {
    const result = await service.search({
      goal_type: "personal_growth",
      query,
      region: "全球/通用",
      limit: 3,
    });
    const hit = result.results.find((item) => item.chunk_id === expectedId);
    reports.push({
      id,
      query,
      expected_id: expectedId,
      returned_ids: result.results.map((item) => item.chunk_id),
      hit: Boolean(hit),
      source_id: hit?.source_id ?? null,
      reviewed: hit?.provenance.review_status === "reviewed",
      source_tier: hit?.metadata?.source_tier ?? null,
    });
  }

  const hits = reports.filter((report) => report.hit).length;
  const recallAt3 = hits / reports.length;
  assert.equal(hits, reports.length, JSON.stringify({ recallAt3, reports }, null, 2));
  assert.ok(reports.every((report) => report.reviewed && report.source_tier === "T1"), JSON.stringify(reports, null, 2));
  assert.equal((await service.loadIndex()).version, KNOWLEDGE_INDEX_VERSION);
  process.stdout.write(`${JSON.stringify({ evaluation: "official-technical-knowledge", cases: reports.length, hits, recall_at_3: recallAt3, index: KNOWLEDGE_INDEX_VERSION })}\n`);
});
