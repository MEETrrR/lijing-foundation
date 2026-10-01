import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { InMemoryDatabase } = require("../../services/api/src/platform/persistence/database.ts");
const { KNOWLEDGE_INDEX_VERSION, KnowledgeRetrievalService } = require("../../services/api/src/domains/knowledge-retrieval/knowledge-retrieval-service.ts");

const CASES = [
  ["go-types", "Go 类型 零值 数组 切片 映射 nil", "official-2026-09-20-go-language-types"],
  ["go-errors", "Go error 错误返回 defer 资源释放", "official-2026-09-20-go-errors-defer"],
  ["go-concurrency", "Go goroutine channel select 并发 数据竞争", "official-2026-09-20-go-concurrency"],
  ["go-modules", "Go modules go.mod go.sum 依赖", "official-2026-09-20-go-modules"],
  ["java-oop", "Java 类 对象 继承 接口 面向对象", "official-2026-09-20-java-oop"],
  ["java-collections", "Java List Set Map Queue 集合 泛型", "official-2026-09-20-java-collections"],
  ["java-exceptions", "Java try catch finally try-with-resources 异常", "official-2026-09-20-java-exceptions"],
  ["java-concurrency", "Java 并发 线程 同步 Executor 线程池", "official-2026-09-20-java-concurrency"],
  ["linux-processes", "Linux 进程 线程 系统调用 信号 排障", "official-2026-09-20-linux-processes"],
  ["linux-memory", "Linux 内存 虚拟内存 缓存 swap OOM", "official-2026-09-20-linux-memory"],
  ["linux-networking", "Linux 网络 TCP 套接字 路由 超时 排障", "official-2026-09-20-linux-networking"],
  ["c-build", "C GCC 预处理 编译 汇编 链接 构建", "official-2026-09-20-c-build-pipeline"],
  ["c-warnings", "C GCC 编译警告 隐式转换 质量门", "official-2026-09-20-c-warnings"],
  ["c-instrumentation", "C GCC sanitizer 插桩 内存错误 调试", "official-2026-09-20-c-instrumentation"],
  ["ai-risk", "AI RMF 风险管理 Govern Map Measure Manage 治理", "official-2026-09-20-ai-risk-management"],
  ["ai-tevv", "AI TEVV 测试 评估 验证 确认 RAG 证据", "official-2026-09-20-ai-tevv"],
];

test("official knowledge expansion v2 retrieves reviewed primary-source nodes within top 3", async () => {
  const service = new KnowledgeRetrievalService({ database: new InMemoryDatabase() });
  const reports = [];
  for (const [id, query, expectedId] of CASES) {
    const result = await service.search({ goal_type: "personal_growth", query, region: "全球/通用", limit: 3 });
    const hit = result.results.find((item) => item.chunk_id === expectedId);
    reports.push({
      id,
      query,
      expected_id: expectedId,
      returned_ids: result.results.map((item) => item.chunk_id),
      hit: Boolean(hit),
      reviewed: hit?.provenance.review_status === "reviewed",
      source_tier: hit?.metadata?.source_tier ?? null,
    });
  }
  const hits = reports.filter((report) => report.hit).length;
  const recallAt3 = hits / reports.length;
  assert.equal(hits, reports.length, JSON.stringify({ recallAt3, reports }, null, 2));
  assert.ok(reports.every((report) => report.reviewed && report.source_tier === "T1"), JSON.stringify(reports, null, 2));
  assert.equal((await service.loadIndex()).version, KNOWLEDGE_INDEX_VERSION);
  process.stdout.write(`${JSON.stringify({ evaluation: "official-knowledge-expansion-v2", cases: reports.length, hits, recall_at_3: recallAt3, index: KNOWLEDGE_INDEX_VERSION })}\n`);
});
