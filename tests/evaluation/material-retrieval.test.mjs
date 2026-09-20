import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { InMemoryDatabase } = require("../../services/api/src/platform/persistence/database.ts");
const { LearningArtifactService } = require("../../services/api/src/domains/learning-artifact/learning-artifact-service.ts");

const ACTOR_ID = "evaluation-account";

const CASES = [
  ["math-01", "数学", "导数链式法则", "复合函数求导时要先识别外层函数和内层函数，再使用导数链式法则。", "导数链式法则"],
  ["math-02", "数学", "连续与左右极限", "判断函数在一点连续，需要比较左右极限、函数值和极限存在性。", "左右极限 函数值 连续"],
  ["math-03", "数学", "定积分换元", "定积分换元时要同步替换积分变量、积分上下限和微分项。", "定积分换元 积分上下限"],
  ["math-04", "数学", "矩阵秩", "矩阵秩可以通过初等行变换化为阶梯形矩阵后读取非零行数。", "矩阵秩 阶梯形矩阵"],
  ["math-05", "数学", "特征值与特征向量", "求矩阵特征值要先建立特征方程，随后代回求对应特征向量。", "特征值 特征向量"],
  ["math-06", "数学", "条件概率", "条件概率的分母是已知条件事件，不能直接把两个独立事件的概率相乘。", "条件概率 已知条件事件"],
  ["math-07", "数学", "数列收敛", "证明数列收敛时可以使用单调有界定理，但必须分别证明单调性和有界性。", "数列收敛 单调有界"],
  ["math-08", "数学", "微分中值定理", "使用拉格朗日中值定理前要检查闭区间连续和开区间可导两个条件。", "拉格朗日中值定理 连续 可导"],
  ["math-09", "数学", "泰勒公式余项", "泰勒展开的近似误差要结合余项形式判断，不能只写有限项就宣称等式成立。", "泰勒公式 余项 近似误差"],
  ["math-10", "数学", "正交对角化", "实对称矩阵可以使用正交矩阵进行对角化，特征向量需要规范正交。", "正交对角化 实对称矩阵"],
  ["408-01", "408", "链表删除节点", "单链表删除中间节点时要先找到前驱节点，再修改前驱的 next 指针。", "链表 删除节点 前驱节点"],
  ["408-02", "408", "二叉树遍历", "二叉树的先序遍历顺序是根、左子树、右子树，中序遍历顺序是左、根、右。", "二叉树 先序遍历 中序遍历"],
  ["408-03", "408", "堆排序建堆", "堆排序建堆需要从最后一个非叶结点开始向下调整，而不是从根结点开始。", "堆排序 建堆 非叶结点"],
  ["408-04", "408", "Cache 地址映射", "直接映射 Cache 中主存块只能映射到唯一的 Cache 行，需要计算标记和行号。", "Cache 直接映射 标记 行号"],
  ["408-05", "408", "流水线数据冒险", "流水线遇到数据冒险时可以通过暂停、转发或编译器调度减少等待。", "流水线 数据冒险 转发"],
  ["408-06", "408", "LRU 页面置换", "LRU 页面置换优先淘汰最长时间没有被访问的页面，需要维护访问顺序。", "LRU 页面置换 访问顺序"],
  ["408-07", "408", "死锁必要条件", "操作系统死锁的必要条件包括互斥、占有并等待、不可剥夺和循环等待。", "操作系统 死锁 必要条件"],
  ["408-08", "408", "TCP 拥塞控制", "TCP 拥塞控制包含慢启动、拥塞避免、快速重传和快速恢复等机制。", "TCP 拥塞控制 慢启动"],
  ["408-09", "408", "子网掩码", "IPv4 子网掩码用于区分网络号和主机号，按位与可以得到网络地址。", "IPv4 子网掩码 网络地址"],
  ["408-10", "408", "哈希冲突处理", "开放定址法处理哈希冲突时需要探查新的空槽位，删除操作不能简单清空导致查找链断裂。", "哈希冲突 开放定址法 空槽位"],
].map(([id, subject, title, content, query], index) => ({
  id,
  subject,
  title,
  content,
  query,
  request_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
}));

test("personal material retrieval evaluation keeps math/408 recall@3 at or above 95%", async () => {
  const service = new LearningArtifactService({ database: new InMemoryDatabase() });
  for (const item of CASES) {
    await service.createArtifact(ACTOR_ID, {
      request_id: item.request_id,
      artifact_id: `artifact-${item.id}`,
      kind: item.subject === "数学" ? "note" : "attempt_draft",
      subject: item.subject,
      source_title: item.title,
      content_text: item.content,
    }, `retrieval-eval-create-${item.id}`);
  }

  const reports = [];
  for (const item of CASES) {
    const results = await service.search(ACTOR_ID, { query: item.query, limit: 3 });
    const expectedArtifact = `artifact-${item.id}`;
    reports.push({ id: item.id, query: item.query, hit: results.some((result) => result.artifact_id === expectedArtifact), top: results[0]?.artifact_id ?? null });
  }

  const hits = reports.filter((report) => report.hit).length;
  const recallAt3 = hits / reports.length;
  assert.ok(recallAt3 >= 0.95, JSON.stringify({ recallAt3, reports }, null, 2));
  assert.equal(reports.length, 20);
  assert.ok(reports.every((report) => report.top));
  process.stdout.write(`${JSON.stringify({ evaluation: "personal-material-retrieval", cases: reports.length, hits, recall_at_3: recallAt3 })}\n`);
});
