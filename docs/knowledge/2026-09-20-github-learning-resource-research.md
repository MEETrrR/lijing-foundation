# GitHub 学习资源调研入库记录

## 输入与边界

输入是 `GitHub学习资源调研·砺境知识库版.html`。文档标题写“20 个仓库”，但实际可见的 GitHub 链接卡片为 18 个；本次入库按实际 18 个链接处理，没有补造缺失的两个仓库。

入库内容是调研结论、学习动作、来源链接和审核边界，不复制仓库 README、笔记正文、真题或页面 HTML。仓库 star 数、更新时间、许可证和内容状态都按 2026-09-20 快照处理，回答时应回到当前来源复核。

## 入库结果

| 知识节点 | 覆盖资源 | 用途 |
| --- | --- | --- |
| 考研数学结构 | `obsidian_math`、`Math-Notes`、`kaoyanshuxue`、`Kaoyan-Math-Doc` | 章节、先修关系、重点标记、知识点与复习单元 |
| 408 学习框架 | `cs-408`、`408` | 四科范围、复习证据和年度大纲边界 |
| 考研英语证据 | `kaoyanzhenti`、`KaoYan-English` | 真题练习、逐句手译和过程证据 |
| 考研政治标签 | `Politics-Obsidian-Note` | 模块、题型标签和关系图谱 |
| 数学与计算机路线 | `awesome-math`、`cs-self-learning` | 资源地图、身份分流、先修关系和路线容量 |
| 间隔重复 | `fsrs4anki`、`anki` | 根据答题表现安排下一次复习 |
| AI 教育 Agent | `DeepTutor`、`OpenMAIC` | 辅导、出题、调度、长期记忆和互动课堂的结构参照 |
| 知识管理管线 | `second-brain`、`building-a-second-brain`、`awesome-basb` | 原始材料、原子想法、引用、人工审核、复习和写作 |
| 入库治理边界 | 综合附件入库指南 | 区分内容型材料和结构型参照，保留来源与许可证核验边界 |

共新增 9 个 `reviewed` 知识片段，全部标记为 `source_tier: T3`，用于学习方法和产品结构参考，不替代官方考试政策、当年大纲、版权判断或真实学习效果评测。

## 检索与索引

- 数据文件：`services/api/src/domains/knowledge-retrieval/2026-09-20-github-learning-research-entries.json`
- 来源入口：`github-postgraduate-learning-research`、`github-learning-method-research`、`github-ai-education-research`
- 索引版本：`2026-09-20.rag-v8`
- 评测：`tests/evaluation/github-learning-research-retrieval.test.mjs`

## 使用规则

1. 资源推荐只能转成与用户目标、基础和时间匹配的下一行动。
2. 社区仓库可以提供结构和方法参照，不能自动变成当年官方事实。
3. 内容型材料先核验来源年份、许可证和可分发范围；结构型资源只提炼设计模式。
4. AI 教育项目的功能演示不能替代材料出处、用户确认、持久化恢复和真实学习产出证据。
