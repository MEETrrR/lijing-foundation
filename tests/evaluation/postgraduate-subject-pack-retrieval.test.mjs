import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { InMemoryDatabase } = require("../../services/api/src/platform/persistence/database.ts");
const {
  KNOWLEDGE_INDEX_VERSION,
  KnowledgeRetrievalService,
} = require("../../services/api/src/domains/knowledge-retrieval/knowledge-retrieval-service.ts");
const { ExamKnowledgeService } = require("../../services/api/src/domains/knowledge-retrieval/exam-knowledge-service.ts");

const OFFICIAL_CASES = [
  ["timeline", "2027预报名正式报名初试时间", "pack-2026-09-20-pg-2027-timeline"],
  ["registration", "报名号缴费网上确认非全日制定向就业", "pack-2026-09-20-pg-registration-rules"],
  ["outline", "统考大纲自命题专业目录参考书目", "pack-2026-09-20-pg-outline-channels"],
  ["subjects", "数学二不考概率408英语一政治科目结构", "pack-2026-09-20-pg-subject-structure"],
  ["monitoring", "2027管理规定大纲改考408报考点facts_to_confirm", "pack-2026-09-20-pg-policy-monitoring"],
];

const GUIDANCE_CASES = [
  ["math-2-calculus", "数学二", "高数二重积分常微分方程六模块", "math.math2-calculus-framework"],
  ["math-2-linear", "数学二", "线性代数矩阵秩特征值二次型", "math.math2-linear-algebra-framework"],
  ["408-network", "408", "TCP拥塞控制IP子网DNS HTTP协议层", "408.computer-network-framework"],
  ["408-os", "408", "PV操作死锁页面置换进程状态", "408.operating-system-framework"],
  ["english", "英语二", "完形阅读翻译写作题型", "english.paper-framework"],
  ["politics", "政治", "马原毛中特史纲思修法基形势与政策", "politics.paper-framework"],
];

test("2026-09-20 postgraduate pack retrieves official chunks with status metadata", async () => {
  const service = new KnowledgeRetrievalService({ database: new InMemoryDatabase() });
  const reports = [];
  for (const [id, query, expectedId] of OFFICIAL_CASES) {
    const result = await service.search({
      goal_type: "postgraduate_entrance_exam",
      query,
      region: "全国",
      limit: 6,
    });
    const hit = result.results.find((item) => item.chunk_id === expectedId);
    reports.push({
      id,
      expected_id: expectedId,
      returned_ids: result.results.map((item) => item.chunk_id),
      hit: Boolean(hit),
      source_tier: hit?.metadata?.source_tier ?? null,
      status: hit?.metadata?.status ?? null,
    });
  }

  assert.equal(reports.every((report) => report.hit), true, JSON.stringify(reports, null, 2));
  assert.equal(reports.every((report) => report.source_tier), true, JSON.stringify(reports, null, 2));
  assert.equal(reports.find((report) => report.id === "timeline")?.status, "预计待确认");
  assert.equal(reports.find((report) => report.id === "subjects")?.status, "预计待确认");
  assert.equal((await service.loadIndex()).version, KNOWLEDGE_INDEX_VERSION);
  process.stdout.write(JSON.stringify({
    evaluation: "postgraduate-subject-pack-official",
    cases: reports.length,
    hits: reports.filter((report) => report.hit).length,
    index: KNOWLEDGE_INDEX_VERSION,
  }) + "\n");
});

test("learning guidance exposes the added math/408/English/politics framework nodes", () => {
  const service = new ExamKnowledgeService();
  const reports = GUIDANCE_CASES.map(([id, subject, query, expectedId]) => {
    const result = service.search({ subject, query, limit: 6 });
    return {
      id,
      expected_id: expectedId,
      returned_ids: result.results.map((item) => item.id),
      hit: result.results.some((item) => item.id === expectedId),
      boundary_ok: result.results.every((item) => item.provenance.evidence_boundary === "not_for_admission_facts"),
    };
  });

  assert.equal(reports.every((report) => report.hit), true, JSON.stringify(reports, null, 2));
  assert.equal(reports.every((report) => report.boundary_ok), true, JSON.stringify(reports, null, 2));
  process.stdout.write(JSON.stringify({
    evaluation: "postgraduate-subject-pack-guidance",
    cases: reports.length,
    hits: reports.filter((report) => report.hit).length,
  }) + "\n");
});
