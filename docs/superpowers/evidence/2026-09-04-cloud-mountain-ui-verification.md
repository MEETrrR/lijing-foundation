# 云海登山客户端验证记录

日期：2026-09-04

## 改造前后页面

改造前的 `HEAD`（`05b71ff`）包含云山客户端的设计规范与实施计划，但没有可运行的 `apps/user_client` 入口。

当前实现通过 Node 原生静态服务提供 `http://127.0.0.1:4187`，并覆盖以下 17 个路由：

- `/features`：八方功能目录
- `/`：山脚入口
- `/auth`：入山身份
- `/goals`：登山方向
- `/plan`：今日行旅
- `/study`：当前攀登
- `/review`：回望复盘
- `/knowledge`：知识群峰
- `/assistant`：云中引路人
- `/growth`：成长记录
- `/map`：山海图
- `/profile`：行者档案
- `/state/loading`、`/state/empty`、`/state/error`、`/state/review`、`/state/permission`：加载、空数据、错误、审核、权限状态

## 视觉规范

- 主题：中式水墨与云海登山叙事，页面内容围绕“每次完成一段真实学习并留下证据”展开。
- 主色：深墨蓝黑、岩灰、琥珀金，少量朱砂红作为状态强调。
- 场景：主要页面使用无人物水墨山海背景，导航使用八方卦位、太极与星轨结构；引路页提供无性别器物选择。
- 排版：中文标题使用书写感衬线字体栈，正文与操作控件保持清晰的无衬线层级；页面采用低圆角、细边界和大留白。
- 资源：实际运行资源通过稳定 `asset_id` 映射，图片仍标记为候选资源，等待艺术、内容、版权、无障碍与性能复核。

## 动效规范

- 默认启用：页面入场、云雾漂移、星轨旋转、进度线展开，以及随滚动变化的轻微远景视差。
- 静谧模式：`data-motion="off"` 时关闭页面、进度、云雾、星轨动画，并清零远景视差。
- 系统偏好：`prefers-reduced-motion: reduce` 时关闭平滑滚动，并将动画/过渡压到 `0.001s`。
- 动效不承载业务状态；目标选择、答题选择和菜单导航均可在无动效状态下完成。

## 演示数据边界

- 客户端使用静态 `DEMO_STATE`，当前演示聚焦“考研数学二 · 高等数学 · 极限与连续”14 天证据试点，所有用户、山路、目标、知识、成就和地图数据均为演示内容。
- 认证表单、助手提问和答案提交只反馈演示提示；当前不会调用真实 AI Gateway、身份服务或持久化后端。
- 页面统一保留 `demo-state` 标记；演示身份使用 `行者 01` 与 `DEMO-01`，不代表真实用户或真实学习结果。
- 生成图片通过资源清单记录来源、用途、尺寸、哈希与待复核状态；未使用的素材和角色参考图不进入运行页面。

## 浏览器回归

使用 Codex 运行时 Playwright 驱动系统 Edge，访问本地静态服务完成检查：

- 17/17 路由均返回真实 `h1`。
- 1440px 桌面端与 390px 移动端：`document.body.scrollWidth === innerWidth`，全部通过。
- 控制台错误：0；页面错误：0；请求失败：0。
- 移动导航：初始关闭，点击后打开，点击 `/study` 后正确导航并关闭。
- 目标选择：`goal-exam-math2` 获得 `is-selected` 与 `aria-pressed="true"`。
- 证据流：四级证据选择器、证据摘要和演示态行动型复盘均可见。
- 答案选择：第二个答案获得 `is-selected`；提交后显示演示提示。
- 动效开关：设置行点击后 `data-motion="off"`。
- 减少动效：Shell 为 `off`，页面动画时长为 `0.001s`，滚动行为为 `auto`。

## 截图

截图目录：`C:\Users\Lenovo\.codex\visualizations\2026\09\04\01a06a2d-4eb3-74e0-b149-e56bfd900ee2\`

- `cloud-mountain-home-desktop-final.png`
- `cloud-mountain-home-mobile-final.png`
- `cloud-mountain-plan-desktop.png`
- `cloud-mountain-study-desktop.png`
- `cloud-mountain-knowledge-desktop.png`
- `cloud-mountain-assistant-desktop.png`
- `cloud-mountain-growth-desktop.png`
- `cloud-mountain-map-desktop.png`

## 工程验证

- `pnpm contract:lint`：7/7 通过。
- `pnpm platform:test`：22/22 通过。
- `pnpm client:test`：17/17 通过。
- `pnpm image:test`：8/8 通过。
- `node --check`：`apps/user_client` 下全部 JS/MJS 文件通过。
- `git diff --check`：通过。
