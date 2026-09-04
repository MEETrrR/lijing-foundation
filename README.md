# 砺境（Lijing）

> 面向中国用户的 AI 学习 RPG。把目标拆成今天能完成的一段学习，把学习证据、复盘和知识连接成自己的山路。

**仓库状态：** 公开协作准备完成，默认分支为 `master`<br>
**文档更新时间：** 2026-09-04<br>
**当前可运行内容：** `apps/user_client` 云海登山 Web 演示客户端

## 当前进度

仓库目前由两部分组成：

- **可运行演示：** 用户端已经有统一的东方水墨世界壳层、八卦功能目录、页面转场、个人知识脉络、学习证据试点、回望复盘和引路灵器选择。
- **生产基线：** API 契约、模块边界、AI 安全策略、数据分类、环境隔离、运行手册和测试基线已经建立，真实业务服务仍按文档中的实施计划推进。

演示客户端当前聚焦一个可验证方向：**考研数学二 · 高等数学 · 极限与连续**，以 14 天学习证据试点展示完整体验，不代表真实用户数据或生产结算。

## 快速运行

环境要求：Node.js `>=22.18.0`、pnpm。

```powershell
pnpm install
pnpm client:serve
```

浏览器打开 `http://127.0.0.1:4187`。如果端口被占用，可在 PowerShell 中运行：

```powershell
$env:PORT=4190; pnpm client:serve
```

## 已实现演示功能

- 八卦功能目录：八个方位对应定向、行旅、攀登、回望、知识库、引路、成长和山海图。
- 八卦导航：从左上角入口展开为全屏选择面，保留水墨八卦、阴阳核心和缩放转场。
- 中式水墨场景：遥望、回望、档案、成长行旅、攀登山顶、引路背景和八卦方向图按模块映射。
- 学习证据流：选择证据等级、提交一句学习证据，并进入演示态行动型复盘。
- 个人知识库：知识点以节点、连接、来源、理解和回望入口组成个人脉络，可从攀登页收录新记录。
- 引路灵器：天书、宝塔、重鼎、折扇四种无性别器物可切换。
- 入山转场：龙凤水墨素材通过 CSS 动效升腾并收束到八卦核心。
- 响应式与无障碍基础：桌面/移动布局、键盘焦点、动效开关和 `prefers-reduced-motion` 降级。

## 页面路由

主要页面：`/` 遥望、`/auth` 入山、`/goals` 定向、`/plan` 行旅、`/study` 攀登、`/review` 回望、`/knowledge` 知识库、`/assistant` 引路、`/growth` 成长、`/map` 山海图、`/profile` 档案、`/features` 八方功能目录。

状态页面：`/state/loading`、`/state/empty`、`/state/error`、`/state/review`、`/state/permission`。

## 演示与生产边界

- 当前用户端使用集中式 `DEMO_STATE`，数据只存在浏览器内存，刷新页面会恢复演示初始状态。
- 登录、真实 AI Gateway、数据库持久化、服务端掌握度/奖励/等级结算尚未接入。
- 演示页面中的目标、进度、知识节点、复盘结论和地图路线都是合成数据，不能作为真实学习结果或机构数据使用。
- 客户端不得保存 Provider 密钥，也不得自行宣布掌握度、奖励、能量或完成事实；生产版必须通过 `/api/v1` 契约和服务端领域模块完成。
- 图片资源仍是候选资源，需经过艺术、内容、版权、无障碍和性能复核后才能作为正式资产。

## 架构与安全底线

- 客户端不可信；服务端负责最终状态、规则版本、账本和幂等判断。
- AI 只能经服务端 AI Gateway 访问，密钥不进入客户端、源码或日志。
- 模块只写自己拥有的事实，跨模块通过版本化接口或领域事件协作。
- 写请求使用 `/api/v1`、`request_id` 和 `Idempotency-Key`；契约不暴露数据库表、SQL 或 Provider SDK。
- `.env`、密钥、证书、`secrets/`、依赖和本地工作树已加入忽略规则；公开前仍要人工复核新增文件。
- `package.json` 中的 `"private": true` 只是 npm 包发布设置，不决定 GitHub 仓库的公开/私有状态。

## 常用校验

```powershell
pnpm client:test
pnpm contract:lint
pnpm platform:test
pnpm image:test
git diff --check
```

提交代码前应让以上命令全部通过。客户端浏览器回归证据见 [`docs/superpowers/evidence/2026-09-04-cloud-mountain-ui-verification.md`](docs/superpowers/evidence/2026-09-04-cloud-mountain-ui-verification.md)。

## 文档地图

- [`docs/architecture/module-boundaries.md`](docs/architecture/module-boundaries.md)：模块所有权和跨模块边界。
- [`docs/architecture/api-versioning.md`](docs/architecture/api-versioning.md)：API 版本与兼容策略。
- [`docs/security/threat-model.md`](docs/security/threat-model.md)：威胁模型和服务端控制点。
- [`docs/security/ai-abuse-playbook.md`](docs/security/ai-abuse-playbook.md)：AI 滥用、成本和降级处理。
- [`docs/security/data-classification.md`](docs/security/data-classification.md)：数据分类与日志边界。
- [`docs/runbooks/incident-response.md`](docs/runbooks/incident-response.md)：事件响应和恢复流程。
- [`docs/superpowers/specs/2026-09-03-cloud-mountain-ui-design.md`](docs/superpowers/specs/2026-09-03-cloud-mountain-ui-design.md)：云海登山视觉与交互规范。
- [`docs/superpowers/plans/`](docs/superpowers/plans/)：生产实现、素材配置和后续工作计划；计划文档不是已完成能力清单。
- [`assets/generated/README.md`](assets/generated/README.md)：生成素材目录、稳定 `asset_id` 和审核状态。

## 团队协作

- 默认分支 `master` 只接受经过检查的合并提交；日常工作使用 `feature/...`、`fix/...` 或 `docs/...` 分支并提交 PR。
- PR 描述需要说明影响范围、演示/生产边界、测试命令和未完成风险；涉及视觉改动时附页面截图或浏览器验证结果。
- 不要提交真实密钥、用户隐私、未经授权的图片、视频或音频；大素材先确认用途、版权和压缩策略。
- 修改契约、模块边界、AI 策略或数据分类时，同时更新对应文档和测试。

## 公开前说明

本仓库的公开目的是让队员查看、讨论和协作开发，不等于产品已经上线或生产就绪。大陆地区的隐私、内容、版权、未成年人保护、数据合规和上线审批仍需在正式发布前由具备资质的人员完成评审。
