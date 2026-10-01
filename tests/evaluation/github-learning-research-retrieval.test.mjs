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
  ["postgraduate-math", "考研数学 双链 知识图谱 极限与连续 Anki", "github-2026-09-20-postgraduate-math-structure", "postgraduate_entrance_exam"],
  ["408", "408 王道 OneNote 数据结构 操作系统 计算机网络", "github-2026-09-20-408-study-framework", "postgraduate_entrance_exam"],
  ["english", "考研英语 真题 手译 过程证据", "github-2026-09-20-english-evidence", "postgraduate_entrance_exam"],
  ["politics", "考研政治 选择题 标签 关系图谱", "github-2026-09-20-politics-tagging", "postgraduate_entrance_exam"],
  ["roadmaps", "awesome-math cs-self-learning 数学 课程地图 先修关系", "github-2026-09-20-math-and-cs-roadmaps", "personal_growth"],
  ["spaced-repetition", "FSRS Anki 间隔重复 复习调度", "github-2026-09-20-spaced-repetition", "personal_growth"],
  ["ai-education", "DeepTutor OpenMAIC AI 老师 AI 同学 RAG 长期学习者记忆", "github-2026-09-20-ai-education-agents", "personal_growth"],
  ["knowledge-management", "second brain LLM Wiki 原子想法 概念图谱 人工审核", "github-2026-09-20-knowledge-management-pipeline", "personal_growth"],
  ["ingestion-boundaries", "GitHub 内容型 结构型 许可证 版权 入库审核", "github-2026-09-20-ingestion-boundaries", "personal_growth"],
];

test("GitHub learning research retrieves reviewed T3 nodes within top 3", async () => {
  const service = new KnowledgeRetrievalService({ database: new InMemoryDatabase() });
  const reports = [];
  for (const [id, query, expectedId, goalType] of CASES) {
    const result = await service.search({ goal_type: goalType, query, region: "全国", limit: 3 });
    const hit = result.results.find((item) => item.chunk_id === expectedId);
    reports.push({
      id,
      query,
      expected_id: expectedId,
      returned_ids: result.results.map((item) => item.chunk_id),
      hit: Boolean(hit),
      reviewed: hit?.provenance.review_status === "reviewed",
      source_tier: hit?.metadata?.source_tier ?? null,
      source_links: hit?.source_links ?? [],
    });
  }

  const hits = reports.filter((report) => report.hit).length;
  const recallAt3 = hits / reports.length;
  assert.equal(hits, reports.length, JSON.stringify({ recallAt3, reports }, null, 2));
  assert.ok(reports.every((report) => report.reviewed && report.source_tier === "T3" && report.source_links.length > 0), JSON.stringify(reports, null, 2));
  assert.equal((await service.loadIndex()).version, KNOWLEDGE_INDEX_VERSION);
  process.stdout.write(`${JSON.stringify({ evaluation: "github-learning-research", cases: reports.length, hits, recall_at_3: recallAt3, index: KNOWLEDGE_INDEX_VERSION })}\n`);
});
