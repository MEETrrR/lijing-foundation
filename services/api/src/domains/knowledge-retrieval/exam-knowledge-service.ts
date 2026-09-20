const { PlatformError } = require("../../platform/errors/error-catalog.ts");
const { tokenSet } = require("./knowledge-retrieval-service.ts");

const EXAM_KNOWLEDGE_INDEX_VERSION = "2026-09-20.exam-v1";
const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 6;

const EXAM_SUBJECT_TRACKS = Object.freeze([
  Object.freeze({ id: "math_1", label: "数学一", aliases: ["数学一", "数一"] }),
  Object.freeze({ id: "math_2", label: "数学二", aliases: ["数学二", "数二"] }),
  Object.freeze({ id: "math_3", label: "数学三", aliases: ["数学三", "数三"] }),
  Object.freeze({ id: "math_general", label: "数学", aliases: ["数学", "高等数学", "线性代数", "概率论"] }),
  Object.freeze({ id: "408", label: "408", aliases: ["408", "计算机学科专业基础"] }),
  Object.freeze({ id: "cs_custom", label: "计算机自命题", aliases: ["计算机自命题", "自命题", "专业课自命题"] }),
  Object.freeze({ id: "english_1", label: "英语一", aliases: ["英语一", "英一"] }),
  Object.freeze({ id: "english_2", label: "英语二", aliases: ["英语二", "英二"] }),
  Object.freeze({ id: "english_general", label: "英语", aliases: ["英语", "考研英语"] }),
  Object.freeze({ id: "politics", label: "政治", aliases: ["政治", "考研政治"] }),
]);

const EXAM_KNOWLEDGE_NODES = Object.freeze([
  node("math.limit-continuity", ["math_1", "math_2", "math_3"], "极限与连续", "把左右极限、函数值和定义条件拆开书写，避免只比较一个量。", ["极限", "连续", "左右极限", "函数值", "分段函数"], ["只比较函数值", "跳过定义域或单侧条件"], "分别写已知条件、左右极限和函数值，再标出缺失的等式。", "提交三行条件与结论，并说明仍未确定的量。"),
  node("math.derivative-mean-value", ["math_1", "math_2", "math_3"], "导数与中值定理", "先确认定理条件，再决定计算或证明路径。", ["导数", "中值定理", "拉格朗日", "罗尔", "可导", "连续"], ["未验条件就套定理", "把结论当作前提"], "写出区间、连续性、可导性和准备使用的定理。", "提交定理条件检查表和对应的一步推导。"),
  node("math.linear-algebra-matrix", ["math_1", "math_2", "math_3"], "线性代数矩阵与秩", "将行变换、秩、特征值等操作与目标量分开记录。", ["矩阵", "秩", "行变换", "特征值", "特征向量"], ["行变换后忘记目标量变化", "把特征向量与特征值混用"], "写出目标量和允许的初等变换，再完成一轮变换。", "提交变换前后矩阵、目标量和读取依据。"),
  node("math.probability-modeling", ["math_1", "math_3"], "概率论建模", "先定义随机变量和条件事件，再选择公式。", ["概率", "条件概率", "随机变量", "分布", "期望", "方差"], ["没有条件事件就代公式", "把独立性当成默认条件"], "用一句话定义事件或随机变量，并写出所需条件。", "提交事件定义、条件和使用公式的理由。"),
  node("408.data-structure", ["408"], "408 数据结构", "先标明数据结构不变量，再处理指针、边界和复杂度。", ["链表", "树", "栈", "队列", "排序", "哈希", "复杂度"], ["只写主流程不写空表或边界", "没有说明复杂度"], "写出输入、结构不变量和一个边界样例。", "提交伪代码/手推过程、边界样例和复杂度。"),
  node("408.operating-system", ["408"], "408 操作系统", "把资源、状态转换和调度条件按时间顺序展开。", ["进程", "线程", "死锁", "调度", "页表", "页面置换", "虚拟内存"], ["把必要条件当充分条件", "忽略状态转换"], "画出资源或状态变化的最小序列。", "提交状态序列和每一步满足或违反的条件。"),
  node("408.computer-organization", ["408"], "408 组成原理", "先拆地址、数据通路或流水线阶段，再计算字段或周期。", ["cache", "地址", "流水线", "指令", "存储器", "数据冒险"], ["直接套公式未拆字段", "漏掉暂停或转发条件"], "标出字段、单位和已知条件，再做第一步计算。", "提交字段拆分图或阶段表，并给出第一步计算。"),
  node("408.computer-network", ["408"], "408 计算机网络", "按协议层、报文方向和触发条件判断网络行为。", ["tcp", "udp", "ip", "子网", "拥塞控制", "可靠传输"], ["混淆层次和报文", "只背术语不说明触发条件"], "写出协议层、报文方向和触发事件。", "提交三列：层次、触发条件、相应行为。"),
  node("cs-custom.syllabus-boundary", ["cs_custom"], "自命题范围核验", "院校、年份和原题是自命题专业课的前置材料，不能由通用知识库推断。", ["院校", "年份", "自命题", "考试范围", "专业课", "真题"], ["把别校范围当成本校范围", "没有年份仍安排重点"], "先补齐院校、年份、科目和原题/目录来源。", "提交院校、年份、科目和一份可引用材料。"),
  node("cs-custom.past-paper-analysis", ["cs_custom"], "自命题真题复盘", "从原题和作答中归纳可观察的题型与卡点，不把单年题目当作固定规律。", ["真题", "题型", "复盘", "错题", "院校"], ["用一套真题推断全部命题规律", "没有原题就归因"], "标注题目考查点、你的步骤和卡住的位置。", "提交题目位置、作答片段和一个待验证规律。"),
  node("english.reading-evidence", ["english_1", "english_2"], "英语阅读证据定位", "答案必须回到原文的定位句、同义替换或逻辑关系。", ["阅读", "定位", "同义替换", "主旨", "细节", "推断"], ["只凭感觉选项", "没有区分原文事实与推断"], "圈出题干关键词、定位句和一个干扰项差异。", "提交题干关键词、原文证据句和选项判断理由。"),
  node("english.translation", ["english_1", "english_2"], "英语翻译句法拆解", "先找主干和修饰关系，再处理从句、非谓语与词义选择。", ["翻译", "长难句", "从句", "非谓语", "主干", "语法"], ["逐词硬译", "遗漏主谓关系"], "先标主谓宾和一个修饰结构，再给出译文。", "提交句子主干、结构标注和一版完整译文。"),
  node("english.writing", ["english_1", "english_2"], "英语写作输出", "围绕题目要求建立段落功能、论点和可检查的语言修正。", ["作文", "写作", "图表", "应用文", "段落", "论点"], ["只背模板不回应题目", "一次修改太多语言问题"], "先列每段功能和一句中心句，再修改一个语言问题。", "提交段落提纲、中心句和修订前后的一处对比。"),
  node("politics.choice-discernment", ["politics"], "政治选择题辨析", "将选项拆成概念、限定词和因果关系，记录排除依据。", ["政治", "选择题", "选项", "概念", "辨析", "错题"], ["凭熟悉度选择", "只记答案不记排除理由"], "逐项标注概念、限定词和能否由材料支持。", "提交正确项依据与一个错误项的排除理由。"),
  node("politics.subjective-output", ["politics"], "政治主观题输出", "先对齐设问、材料和分点，再组织术语与解释。", ["政治", "主观题", "材料题", "设问", "分点", "背诵"], ["背诵内容不回应设问", "没有分点或材料对应"], "圈出设问动词和材料关键词，列出两到三点答案骨架。", "提交设问关键词、分点骨架和一处材料对应。"),
  node("politics.current-affairs-boundary", ["politics"], "政治时政核验", "时政名称、时间和政策表述必须回到明确来源，学习节点不替代事实核验。", ["时政", "政策", "会议", "时间", "政治"], ["把旧资料当作当前事实", "没有来源就补全日期或表述"], "标出要核验的事实和资料年份，再检索权威来源。", "提交待核验事实、资料年份和来源链接/出处。"),
]);

function node(id, trackIds, title, summary, keywords, commonMistakes, actionPattern, evidencePattern) {
  return Object.freeze({
    id,
    track_ids: Object.freeze(trackIds),
    title,
    summary,
    keywords: Object.freeze(keywords),
    common_mistakes: Object.freeze(commonMistakes),
    action_pattern: actionPattern,
    evidence_pattern: evidencePattern,
    provenance: Object.freeze({
      source_type: "curated_learning_guidance",
      index_version: EXAM_KNOWLEDGE_INDEX_VERSION,
      review_status: "curated",
      evidence_boundary: "not_for_admission_facts",
    }),
  });
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function resolveTrack(subject) {
  const normalized = normalize(subject);
  if (!normalized) return null;
  return EXAM_SUBJECT_TRACKS.find((track) => track.aliases.some((alias) => normalized === normalize(alias) || normalized.includes(normalize(alias)))) ?? null;
}

function matchesTrack(nodeValue, track) {
  if (!track) return true;
  if (track.id === "math_general") return nodeValue.track_ids.some((id) => id.startsWith("math_"));
  if (track.id === "english_general") return nodeValue.track_ids.some((id) => id.startsWith("english_"));
  return nodeValue.track_ids.includes(track.id);
}

function scoreNode(nodeValue, query, track) {
  const queryTokens = tokenSet(query);
  const corpus = `${nodeValue.title} ${nodeValue.summary} ${nodeValue.keywords.join(" ")} ${nodeValue.common_mistakes.join(" ")}`;
  const corpusTokens = tokenSet(corpus);
  const overlap = [...queryTokens].filter((token) => corpusTokens.has(token)).length;
  const lexical = queryTokens.size ? overlap / queryTokens.size : 0.2;
  const title = queryTokens.size ? [...queryTokens].filter((token) => tokenSet(nodeValue.title).has(token)).length / queryTokens.size : 0;
  const trackBoost = matchesTrack(nodeValue, track) ? 0.25 : 0;
  return Number((lexical * 0.65 + title * 0.25 + trackBoost).toFixed(6));
}

function publicNode(nodeValue, score) {
  return {
    id: nodeValue.id,
    track_ids: [...nodeValue.track_ids],
    title: nodeValue.title,
    summary: nodeValue.summary,
    common_mistakes: [...nodeValue.common_mistakes],
    action_pattern: nodeValue.action_pattern,
    evidence_pattern: nodeValue.evidence_pattern,
    score,
    provenance: { ...nodeValue.provenance },
  };
}

function validateSearch(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlatformError("VALIDATION_ERROR", "learning guidance query is invalid");
  const subject = String(input.subject ?? "").trim();
  const query = String(input.query ?? "").trim();
  const limit = input.limit ?? DEFAULT_LIMIT;
  if (subject.length > 80) throw new PlatformError("VALIDATION_ERROR", "subject is invalid");
  if (query.length > 1200) throw new PlatformError("VALIDATION_ERROR", "query must contain at most 1200 characters");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new PlatformError("VALIDATION_ERROR", `limit must be an integer from 1 to ${MAX_LIMIT}`);
  return { subject, query, limit };
}

class ExamKnowledgeService {
  constructor({ clock = () => Date.now() } = {}) {
    this.clock = clock;
  }

  search(input = {}) {
    const { subject, query, limit } = validateSearch(input);
    const track = resolveTrack(subject);
    const effectiveQuery = `${subject} ${query}`.trim();
    const results = EXAM_KNOWLEDGE_NODES
      .filter((item) => matchesTrack(item, track))
      .map((item) => ({ item, score: scoreNode(item, effectiveQuery, track) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id))
      .slice(0, limit)
      .map(({ item, score }) => publicNode(item, score));
    return {
      subject: subject || null,
      track: track ? { id: track.id, label: track.label } : null,
      query,
      learning_knowledge_index_version: EXAM_KNOWLEDGE_INDEX_VERSION,
      retrieved_at: new Date(this.clock()).toISOString(),
      results,
    };
  }

  getByIds(ids = []) {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !/^[a-z0-9._-]{1,120}$/i.test(id))) throw new PlatformError("VALIDATION_ERROR", "knowledge node references are invalid");
    const nodes = new Map(EXAM_KNOWLEDGE_NODES.map((item) => [item.id, item]));
    return [...new Set(ids)].map((id) => nodes.get(id)).filter(Boolean).map((item) => publicNode(item, 1));
  }
}

module.exports = {
  EXAM_KNOWLEDGE_INDEX_VERSION,
  EXAM_KNOWLEDGE_NODES,
  EXAM_SUBJECT_TRACKS,
  ExamKnowledgeService,
  resolveTrack,
  validateSearch,
};
