# 砺境全科证据驱动 Agent 技术实现

**版本：** v3.0
**日期：** 2026-09-20
**状态：** 第一段纵切实施中
**范围：** 计算机考研全科的知识依据、每日状态连续性和行动可行性约束。

## 1. 目标与边界

砺境覆盖数学、408、计算机自命题、英语和政治，但不把所有资料混成一个会自由聊天的知识库。它对用户的承诺保持不变：

> 基于你自己的材料、已确认状态和可追溯的学习依据，给出今天能完成并留下证据的一步。

本阶段解决三个问题：

1. 让不同科目的行动拥有可见、可检索的学习知识节点，而不是套用数学或 408 的单一模板。
2. 让一次诊断读取服务端事实快照，而不是依赖模型记忆聊天历史。
3. 让行动时长、材料引用、知识依据和未知项在服务端被校验，不能由模型自行宣布掌握、正确率、考试规则或路线完成。

本阶段不做：公开题库、盗版教材全文、自动路线刷新、未经确认的长期记忆、向量数据库、OCR 文件持久化、自由聊天。

## 2. 三条知识通道

```text
私人材料 RAG
  题目 / 笔记 / 草稿 / 证据
  -> 账号隔离的片段检索
  -> 诊断的直接证据

全科学习知识节点
  数学一二三 / 408 / 自命题 / 英语一二 / 政治
  -> 经过版本化审核的概念、常见误区、行动和证据模式
  -> 行动的学习依据，不承担招生或日期事实

官方事实 RAG
  教育部 / 研招网 / 目标院校等审核来源
  -> 招生、科目、条件、日期等高时效事实
  -> 缺少证据时只输出 facts_to_confirm
```

三者禁止互相覆盖：私人材料只说明用户当前状态；学习知识节点只约束学习行动；官方 RAG 才能支持政策和院校事实。

## 3. 数据所有权

| 对象 | 事实来源 | 保存方式 | 是否进入模型上下文 |
|---|---|---|---|
| LearningArtifact | 用户确认后的文本材料 | 账户隔离持久化 | 只发送本次检索到的必要片段 |
| LearningAttempt / Evidence | 用户提交的过程或产物 | 账户隔离持久化 | 只以哈希、关联关系和必要摘要参与状态判断 |
| ExamKnowledgeNode | 版本化的自研学习指导 | 服务端只读目录 | 可作为数据上下文，不作为指令 |
| OfficialKnowledgeEvidence | 审核来源目录和片段 | 服务端知识索引 | 仅在政策/规则类任务中使用 |
| ConfirmedMemory | 用户确认或编辑后的策略/阻力 | 账户隔离持久化 | 可以进入快照；candidate/rejected 不可进入 |
| LearnerSnapshot | 从上述事实即时投影 | 不缓存为独立真相 | 每次诊断从持久化事实重建 |

`LearnerSnapshot` 不保存原材料全文、不复制模型结论，也不成为新的可变事实源。API 重启、刷新和重新登录后，它由材料、行动、诊断和确认记忆重新构造，避免“模型记住了旧聊天但服务端状态已改变”。

## 4. 全科知识节点

第一版使用确定性关键词/二元组检索。每个节点包含：

```text
id / track_ids / title / summary / keywords
common_mistakes / action_patterns / evidence_patterns
index_version / review_status / evidence_boundary
```

覆盖轨道：数学一、数学二、数学三、408、计算机自命题、英语一、英语二、政治。节点是“学习行动指导”，不是教材替代品；自命题节点只能提示用户上传院校、年份和原题，不能推断学校考试科目。

检索结果必须标记为 `curated_learning_guidance`，并明确 `not_for_admission_facts`。它和 `/api/v1/knowledge/search` 的官方来源证据使用不同字段与 UI 标签。

## 5. Agent 决策管线

```text
POST /companion/diagnoses
  -> 校验材料账户归属与请求幂等
  -> 私人材料片段检索
  -> 全科学习知识节点检索
  -> 从持久化事实生成 LearnerSnapshot
  -> AI Gateway 结构化诊断
  -> 服务端校验：引用片段、允许字段、时长、未知项
  -> 创建带 artifact_refs 与 knowledge_node_refs 的唯一行动
  -> 返回私人材料引用 + 学习依据 + 快照版本
```

模型只能提出 `observations`、`unknowns` 和一条行动。模型不选择用户归属、不写入长期记忆、不决定知识节点引用、不改路线、不宣布掌握。知识节点 ID 由服务端检索器选出并附到行动。

## 6. 可行性与降级规则

1. 材料诊断行动的时长必须在 5–30 分钟，且不能超过用户当天可用时长与 30 分钟两者的较小值。
2. `artifact_diagnosis` 行动必须有材料引用、诊断引用和至少一个私人材料片段；没有材料返回 `need_material`。
3. 模型引用不存在的材料片段、输出非法 JSON、超出时长、空输出或 Provider 失败时，生成明确标注的 `degraded` 保底行动。
4. 保底行动保留服务端选定的学习依据，但不声称该依据已经证明用户会做题或已经掌握。
5. `completed`、`superseded`、`skipped` 是终态；旧版本写入仍返回 `ACTION_VERSION_CONFLICT`。

## 7. API 与前端投影

新增：

- `GET /api/v1/knowledge/learning-guidance?subject=&q=&limit=`：读取版本化学习知识节点。
- `GET /api/v1/me/learning-snapshot`：读取账户自己的可恢复学习快照。

扩展：

- `CompanionAction.knowledge_node_refs`
- `CompanionDiagnosisResponse.guidance_evidence` 与 `learner_snapshot`
- `CompanionTodayResponse.retrieved_evidence` 与 `guidance_evidence`

`/study` 必须同时区分“材料引用”和“学习依据”。刷新后由 `/companion/today` 重建这两类依据，不依赖浏览器缓存。

## 8. 评测与放量门槛

评测按学科分桶：数学、408、英语、政治、自命题。每个评测案例记录目标材料片段、期望知识节点、不可出现的断言、最长行动时长和必要未知项。

上线门槛：

- 私人材料跨账户读取与引用为零。
- 计划和行动的事实性断言可追溯；缺少证据时进入待核验或降级。
- confirmed memory 之外的记忆不进入 Agent 上下文。
- 刷新、重新登录、API 重启后同一账户的行动、引用和快照都可重建。
- 按学科记录 `Recall@3`、知识节点引用正确率、行动完成率、Provider 降级率和单用户成本。

只有评测集和真实试点显示词法检索在同义表达或跨材料召回不足时，才评估 BM25、embedding、混合检索和 `pgvector`。接口契约不因底层检索器替换而改变。
