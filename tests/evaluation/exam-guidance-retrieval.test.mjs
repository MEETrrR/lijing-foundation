import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ExamKnowledgeService } = require("../../services/api/src/domains/knowledge-retrieval/exam-knowledge-service.ts");

const CASES = [
  ["math-01", "数学一", "分段函数左右极限和函数值", "math.limit-continuity"],
  ["math-02", "数学二", "拉格朗日中值定理连续可导条件", "math.derivative-mean-value"],
  ["math-03", "数学三", "随机变量条件概率独立性", "math.probability-modeling"],
  ["math-04", "数学二", "矩阵秩初等行变换", "math.linear-algebra-matrix"],
  ["408-01", "408", "链表前驱节点和边界复杂度", "408.data-structure"],
  ["408-02", "408", "死锁必要条件与进程状态", "408.operating-system"],
  ["408-03", "408", "Cache 地址标记行号流水线冒险", "408.computer-organization"],
  ["408-04", "408", "TCP 拥塞控制和子网地址", "408.computer-network"],
  ["custom-01", "计算机自命题", "院校年份专业课考试范围", "cs-custom.syllabus-boundary"],
  ["custom-02", "计算机自命题", "真题作答题型错题复盘", "cs-custom.past-paper-analysis"],
  ["english-01", "英语一", "阅读题干关键词原文定位句", "english.reading-evidence"],
  ["english-02", "英语二", "长难句翻译主谓宾从句", "english.translation"],
  ["english-03", "英语一", "图表作文段落中心句修改", "english.writing"],
  ["english-04", "英语二", "阅读细节题同义替换干扰项", "english.reading-evidence"],
  ["politics-01", "政治", "选择题选项限定词概念辨析", "politics.choice-discernment"],
  ["politics-02", "政治", "材料主观题设问分点对应", "politics.subjective-output"],
  ["politics-03", "政治", "时政会议日期政策来源核验", "politics.current-affairs-boundary"],
  ["math-05", "数学一", "特征值特征向量矩阵", "math.linear-algebra-matrix"],
  ["408-05", "408", "页面置换访问顺序", "408.operating-system"],
  ["english-05", "英语一", "应用文写作题目要求段落", "english.writing"],
];

test("curated cross-subject guidance retrieves the expected node within top 3", () => {
  const service = new ExamKnowledgeService();
  const reports = CASES.map(([id, subject, query, expectedId]) => {
    const result = service.search({ subject, query, limit: 3 });
    return {
      id,
      subject,
      expected_id: expectedId,
      returned_ids: result.results.map((item) => item.id),
      hit: result.results.some((item) => item.id === expectedId),
      boundary_ok: result.results.every((item) => item.provenance.evidence_boundary === "not_for_admission_facts"),
    };
  });
  const hits = reports.filter((item) => item.hit).length;
  const recallAt3 = hits / reports.length;
  assert.ok(recallAt3 >= 0.95, JSON.stringify({ recallAt3, reports }, null, 2));
  assert.ok(reports.every((item) => item.boundary_ok), JSON.stringify(reports, null, 2));
  assert.equal(reports.length, 20);
  process.stdout.write(`${JSON.stringify({ evaluation: "exam-guidance-retrieval", cases: reports.length, hits, recall_at_3: recallAt3 })}\n`);
});
