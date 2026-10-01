const { PlatformError } = require("../../platform/errors/error-catalog.ts");
const { tokenSet } = require("./knowledge-retrieval-service.ts");

const EXAM_KNOWLEDGE_INDEX_VERSION = "2026-09-20.exam-v2";
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
  node("math.scope-and-paper-structure", ["math_1", "math_2", "math_3"], "数学一二三范围与试卷结构", "先确认目标是数学一、二还是三并核对当年大纲，再按科目范围安排复习；旧版题型结构只能标记为历史资料。", ["数学一", "数学二", "数学三", "数一", "数二", "数三", "高数", "线性代数", "概率论", "试卷结构", "单选", "填空", "解答", "旧版"], ["把数学二安排成含概率论", "把2021年前题型结构当现行结构"], "建立目标科目范围清单，给每个模块标记来源、状态和是否需要官方复核。", "提交科目、模块清单，并纠正一条旧版范围或题型说法。"),
  node("math.math2-calculus-framework", ["math_2"], "数二高数六模块", "数二高数复习可按函数极限连续、微分学、中值定理与导数应用、积分学、多元微分与二重积分、常微分方程六个模块组织。", ["数学二", "数二", "高等数学", "函数", "极限", "连续", "导数", "中值定理", "积分", "二重积分", "常微分方程"], ["只刷计算不检查定理条件", "积分应用不会建模", "二重积分换序或极坐标漏条件"], "选一个模块写出核心公式、适用条件和一道独立练习的完整步骤。", "提交模块编号、关键条件、解题步骤和一个仍未确定的卡点。"),
  node("math.math2-linear-algebra-framework", ["math_2"], "数二线代四模块", "数二线代可按行列式、矩阵、向量与线性方程组、特征值与二次型四个模块组织，重点记录目标量和变换依据。", ["数学二", "数二", "线性代数", "行列式", "矩阵", "秩", "线性方程组", "特征值", "特征向量", "二次型", "正交变换"], ["行变换后忘记目标量变化", "把特征值和特征向量混用", "含参方程组只写结论不写秩条件"], "先写目标量、允许的初等变换和判定条件，再完成一轮矩阵或方程组推导。", "提交变换前后对象、判定条件和读取结果的依据。"),
  node("math.diagnostic-mapping", ["math_1", "math_2", "math_3"], "数学错题诊断映射", "数学错题标注按科目、模块、知识点、题型和卡点类型展开，优先区分概念、条件、公式、计算、方法和步骤问题。", ["数学", "错题", "诊断映射", "概念不清", "条件漏判", "公式误用", "计算失误", "方法选择", "步骤中断", "审题漏条件"], ["只记题号不记录卡点", "把一次计算错误泛化成不会整个模块"], "给一道错题补齐五级标签，并写出下一次练习要观察的证据。", "提交五级标签、错误位置和一条可复核的修正证据。"),
  node("408.exam-structure", ["408"], "408试卷结构与时间分配", "复习时按数据结构、计算机组成原理、操作系统和计算机网络拆分；多年稳定的题号和分值只能作为经验框架，仍需核对当年大纲。", ["408", "150分", "180分钟", "数据结构", "计算机组成原理", "操作系统", "计算机网络", "45分", "35分", "25分", "题号", "单项选择", "综合应用"], ["把经验题号分布当官方承诺", "只背四课名词不练综合应用", "不按时间做取舍"], "先做四课范围清单，再用一套限时小卷记录每课耗时、失分和未完成原因。", "提交四课清单、时间记录和一个下一轮调整动作。"),
  node("408.data-structure-framework", ["408"], "408数据结构考点树", "数据结构复习从线性结构扩展到树、图、查找、排序和字符串，必须同时记录不变量、边界和复杂度。", ["408", "数据结构", "线性表", "栈", "队列", "二叉树", "图", "DFS", "BFS", "最小生成树", "最短路径", "查找", "排序", "KMP", "复杂度"], ["只写主流程不写空表或边界", "不会比较排序稳定性和复杂度", "图算法只背名称不写触发条件"], "选一个结构或算法画出输入、关键不变量、边界样例和复杂度。", "提交伪代码或手推过程、边界样例和复杂度说明。"),
  node("408.computer-organization-framework", ["408"], "408计算机组成原理考点树", "组成原理按数据表示、存储系统、指令系统、CPU流水线、总线与I/O展开，计算前先拆字段、单位和数据通路。", ["408", "计算机组成原理", "原码", "补码", "浮点数", "Cache", "地址", "映射", "指令", "流水线", "数据冒险", "总线", "中断", "DMA"], ["直接套Cache公式不拆字段", "忽略流水线暂停或转发", "补码和浮点规格化步骤缺失"], "把一道计算题拆成字段表或阶段表，再完成第一步计算并标注单位。", "提交字段或阶段表、第一步计算和一个边界条件。"),
  node("408.operating-system-framework", ["408"], "408操作系统考点树", "操作系统复习围绕进程线程、同步死锁、内存管理、文件系统和I/O管理展开，按资源与状态转换组织答案。", ["408", "操作系统", "进程", "线程", "调度", "PV操作", "同步", "死锁", "分页", "分段", "虚拟内存", "页面置换", "文件系统", "磁盘调度"], ["把死锁必要条件当充分条件", "PV操作不画时序", "页面置换只背算法不跟踪访问序列"], "画出资源或进程状态的最小变化序列，并标注每一步满足的条件。", "提交状态序列、条件判断和一个可复算的访问顺序。"),
  node("408.computer-network-framework", ["408"], "408计算机网络考点树", "计算机网络按分层、报文方向和触发条件组织，覆盖链路、网络、传输和应用层的过程与计算。", ["408", "计算机网络", "OSI", "TCP/IP", "奈氏", "香农", "CSMA/CD", "滑动窗口", "IP", "子网", "RIP", "OSPF", "TCP", "UDP", "拥塞控制", "DNS", "HTTP"], ["混淆协议层次和报文", "子网计算漏掉网络号或主机号", "只背TCP握手不解释触发条件"], "写出协议层、报文方向和触发事件，再完成一道子网或拥塞控制练习。", "提交三列表格：层次、触发条件、相应行为，并附计算结果。"),
  node("408.diagnostic-mapping", ["408"], "408错题诊断映射", "408错题标注按模块、章节、知识点、题型和卡点类型展开，区分概念混淆、计算失误、算法思路、步骤中断和跨模块整合。", ["408", "错题", "诊断映射", "模块", "章节", "知识点", "概念混淆", "计算失误", "算法思路", "步骤中断", "跨模块整合"], ["只按科目记错题不定位章节", "把不会背诵和不会推导混在一起"], "从一道错题中抽取模块、题型、卡点和下一次独立产出的证据。", "提交五级标签、卡点解释和一条重新作答证据。"),
  node("english.paper-framework", ["english_1", "english_2"], "英语一二试卷结构", "英语一和英语二都要拆分完形、阅读、翻译与写作的任务类型；路线先按目标科目确定重点，题目级诊断另需真实材料。", ["英语一", "英语二", "考研英语", "完形", "阅读", "翻译", "写作", "小作文", "大作文", "学硕", "专硕"], ["把英语一和英语二分值结构混用", "只背模板不看题目要求", "没有原文材料就宣称阅读能力"], "确认目标科目后，为每类题型建立一个可提交的训练产出。", "提交目标科目、题型清单和一项带原文或题目依据的练习产出。"),
  node("english.stage-plan", ["english_1", "english_2"], "英语阶段备考路线", "英语路线可按词汇与长难句、真题阅读精读、写作与套卷分阶段推进；阶段建议属于教研经验，不能替代当年大纲。", ["英语", "词汇", "长难句", "真题阅读", "精读", "写作", "套卷", "去模板化", "阶段", "备考节奏"], ["只看单词数量不做语境练习", "阅读不定位原文证据", "写作套模板不回应题目"], "每阶段只设一个可检查产出，例如一篇精读记录或一段按题目要求修改的作文。", "提交阶段目标、独立产出和一处具体修正前后对比。"),
  node("politics.paper-framework", ["politics"], "政治试卷与五大学科", "政治学习先按马原、毛中特、史纲、思修法基、形势与政策建立框架，再分别安排选择题和材料分析题产出。", ["政治", "思想政治理论", "马原", "毛中特", "史纲", "思修法基", "形势与政策", "单选", "多选", "材料分析", "100分"], ["只背材料不区分学科", "选择题只记答案不记排除依据", "主观题背诵内容不回应设问"], "选定一个学科或题型，拆出概念、限定词、材料对应和分点答案骨架。", "提交学科标签、选择题排除理由或主观题分点骨架。"),
  node("politics.stage-and-update", ["politics"], "政治大纲变动与备考节奏", "政治的大纲变动主要影响理论表述、时政内容和素材，稳定部分可先学，年度变化要在大纲发布后回到权威表述复核。", ["政治", "大纲变动", "理论表述", "时政", "素材", "毛中特", "暑期", "大纲后", "10月", "11月", "12月", "复核"], ["把预测热词写成已考事实", "旧版毛中特表述不复核", "只背主观题不做选择题辨析"], "记录资料年份和待核验表述，先完成稳定概念，再安排大纲后的差异复核。", "提交一个待核验表述、资料年份、来源位置和复核动作。"),
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
    // Never substitute a math or 408 node for an explicit subject outside the curated index.
    if (subject && !track) {
      return {
        subject,
        track: null,
        query,
        learning_knowledge_index_version: EXAM_KNOWLEDGE_INDEX_VERSION,
        retrieved_at: new Date(this.clock()).toISOString(),
        results: [],
      };
    }
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
