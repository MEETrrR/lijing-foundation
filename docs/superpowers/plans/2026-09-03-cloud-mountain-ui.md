# Cloud Mountain UI Implementation Plan

> **当前状态（2026-09-04）：** 本计划已执行并形成可运行演示。实际实现将多个页面收敛在 `apps/user_client/src/pages/index.js`，当前路由、功能、素材映射和验证结果以根目录 `README.md` 及 `docs/superpowers/evidence/2026-09-04-cloud-mountain-ui-verification.md` 为准；本文保留为历史执行记录，步骤复选框不再作为当前完成状态来源。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在当前砺境架构基线上创建一个可运行的 Web 用户端，把“云海登山”叙事落成统一 App Shell、页面路由、动效系统、真实资源入口和可验证的响应式体验。

**Architecture:** 采用原生 Web Modules、语义 HTML、CSS Design Tokens 和 Node 内置静态服务器。路由由浏览器 History API 驱动，页面通过纯函数组件渲染到统一 Shell；演示数据集中在 adapter，业务状态不由动画计算。资源通过稳定 `asset_id` 映射到仓库中的 manifest 路径，服务端接入时只替换数据 adapter。

**Tech Stack:** Node.js 22+, HTML, CSS, JavaScript ES modules, Node `http`/`fs`/`path`, Node native test runner.

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `apps/user_client/index.html` | Web 应用入口、字体预连接、语义挂载点 |
| `apps/user_client/src/main.js` | 创建应用并绑定浏览器事件 |
| `apps/user_client/src/app.js` | 路由、Shell 生命周期、导航和演示状态 |
| `apps/user_client/src/data/routes.js` | 路由元数据、八方导航和章节标签 |
| `apps/user_client/src/data/demo-data.js` | 明确标记的演示用户、任务、知识、成长和地图数据 |
| `apps/user_client/src/data/assets.js` | `asset_id` 到 manifest 路径的显示层映射 |
| `apps/user_client/src/components/icons.js` | 统一的小型线性图形和可访问标签 |
| `apps/user_client/src/components/shell.js` | 桌面/移动 App Shell、顶部状态和内容挂载点 |
| `apps/user_client/src/components/navigation.js` | 八方导航、移动端太极菜单和当前方位 |
| `apps/user_client/src/components/world-stage.js` | 山景、云海、星轨、太极和页面入口氛围层 |
| `apps/user_client/src/components/status-axis.js` | 高度、阴阳平衡、卦爻和进度表达 |
| `apps/user_client/src/pages/index.js` | 入口页面渲染器和页面共享工具 |
| `apps/user_client/src/pages/home.js` | 山脚遥望和今日登山入口 |
| `apps/user_client/src/pages/auth.js` | 入山、登录、注册和欢迎态 |
| `apps/user_client/src/pages/goals.js` | 八方定向和目标选择 |
| `apps/user_client/src/pages/plan.js` | 行旅路线、营地和今日任务 |
| `apps/user_client/src/pages/study.js` | 当前山段、学习任务和答题入口 |
| `apps/user_client/src/pages/review.js` | 回环复习、巩固知识和待复习节点 |
| `apps/user_client/src/pages/knowledge.js` | 群峰、知识维度和掌握状态 |
| `apps/user_client/src/pages/assistant.js` | 云中灯火和 AI 引路入口 |
| `apps/user_client/src/pages/growth.js` | 登峰碑、等级、印记和阶段成就 |
| `apps/user_client/src/pages/map.js` | 山海路线、章节峰群和地图状态 |
| `apps/user_client/src/pages/profile.js` | 行者档案、通知、偏好和设置入口 |
| `apps/user_client/src/pages/states.js` | 加载、错误、空数据、审核、权限状态 |
| `apps/user_client/src/styles.css` | 全局 Token、场景、排版、动效、响应式和焦点样式 |
| `apps/user_client/server.mjs` | 本地静态服务、History fallback 和 `/assets` 映射 |
| `apps/user_client/tests/routes.test.mjs` | 路由、导航元数据和状态覆盖测试 |
| `assets/generated/asset-manifest.json` | 新增运行时候选资源的稳定 ID 和校验信息 |
| `package.json` | 添加 `client:test` 与 `client:serve` 脚本 |

## Task 1: 建立路由、演示数据和资源边界

**Files:**
- Create: `apps/user_client/src/data/routes.js`
- Create: `apps/user_client/src/data/demo-data.js`
- Create: `apps/user_client/src/data/assets.js`
- Test: `apps/user_client/tests/routes.test.mjs`

- [ ] **Step 1: 写路由和状态的失败测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { NAV_ITEMS, ROUTES, normalizeRoute } from "../src/data/routes.js";

test("normalizes unknown paths to the world entrance", () => {
  assert.equal(normalizeRoute("/missing"), "/");
});

test("covers every first-phase chapter in navigation metadata", () => {
  const routeKeys = new Set(Object.keys(ROUTES));
  for (const item of NAV_ITEMS) assert.equal(routeKeys.has(item.href), true);
  assert.equal(routeKeys.size >= 11, true);
});
```

- [ ] **Step 2: 运行测试确认它因模块不存在而失败**

Run: `node --test apps/user_client/tests/routes.test.mjs`  
Expected: FAIL with an import or module-not-found error for `../src/data/routes.js`.

- [ ] **Step 3: 写最小路由和数据模块**

`routes.js` exports `ROUTES`, `NAV_ITEMS`, `normalizeRoute(pathname)` and `getRouteMeta(pathname)`. `demo-data.js` exports a single `DEMO_STATE` object with `isDemo: true`; all numeric progress values are presentation-only. `assets.js` exports `ASSET_CATALOG` keyed by stable IDs and never accepts a raw download filename from a page.

- [ ] **Step 4: 运行测试确认路由元数据通过**

Run: `node --test apps/user_client/tests/routes.test.mjs`  
Expected: PASS with all route and navigation assertions green.

- [ ] **Step 5: 提交路由边界**

```powershell
git add apps/user_client/src/data apps/user_client/tests/routes.test.mjs
git commit -m "feat: add cloud mountain client route boundaries"
```

## Task 2: 建立入口 HTML、Node 服务与客户端启动器

**Files:**
- Create: `apps/user_client/index.html`
- Create: `apps/user_client/server.mjs`
- Create: `apps/user_client/src/main.js`
- Modify: `package.json`

- [ ] **Step 1: 添加可运行入口的结构检查测试**

测试读取 `apps/user_client/index.html` 和 `server.mjs`，断言存在 `#app`、`type="module"`、History fallback 和 `/assets/` 映射。

- [ ] **Step 2: 运行结构测试确认入口尚不存在**

Run: `node --test apps/user_client/tests/routes.test.mjs`  
Expected: FAIL because the entry files are not present.

- [ ] **Step 3: 实现入口和内置服务**

`server.mjs` only serves files under the repository root, maps `/assets/...` to `assets/...`, falls back unknown non-file paths to `apps/user_client/index.html`, sets image/content types, and returns `404` for paths outside the workspace. Add scripts:

```json
{
  "client:test": "node --no-warnings --test apps/user_client/tests/routes.test.mjs",
  "client:serve": "node apps/user_client/server.mjs"
}
```

- [ ] **Step 4: 运行静态检查**

Run: `node --check apps/user_client/server.mjs; node --check apps/user_client/src/main.js`  
Expected: both commands exit 0.

- [ ] **Step 5: 提交启动器**

```powershell
git add apps/user_client/index.html apps/user_client/server.mjs apps/user_client/src/main.js package.json
git commit -m "feat: add runnable user client entrypoint"
```

## Task 3: 建立全局视觉 Token、场景层和 App Shell

**Files:**
- Create: `apps/user_client/src/components/icons.js`
- Create: `apps/user_client/src/components/world-stage.js`
- Create: `apps/user_client/src/components/status-axis.js`
- Create: `apps/user_client/src/components/navigation.js`
- Create: `apps/user_client/src/components/shell.js`
- Create: `apps/user_client/src/styles.css`
- Modify: `apps/user_client/src/main.js`

- [ ] **Step 1: 写 Shell 行为测试**

测试断言 Shell 生成 `aria-label="八方导航"`、当前路由标记、`data-motion` 开关和 `main` 内容挂载点；测试不依赖动画结束。

- [ ] **Step 2: 运行测试确认 Shell 组件不存在**

Run: `pnpm client:test`  
Expected: FAIL with the missing component import until the Shell modules are created.

- [ ] **Step 3: 实现视觉基础**

CSS 定义 `paper-0`、`paper-1`、`ink-950`、`ink-800`、`rock-500`、`amber-500`、`cinnabar-500`、`mist-100` 和动效时长 Token。Shell 使用三层结构：沉浸场景、效率内容、导航/状态层。云雾用有限的 `.mist-layer` 元素和 transform/opacity 动画，不创建大量粒子节点。

- [ ] **Step 4: 实现导航与状态轴**

桌面端显示窄幅八方导航和当前卦位，移动端用中心太极按钮展开导航。状态轴显示演示高度、阴阳平衡和卦爻，不参与业务计算。所有图形按钮带 `title`、`aria-label` 和可见焦点。

- [ ] **Step 5: 运行测试和静态检查**

Run: `pnpm client:test; node --check apps/user_client/src/main.js`  
Expected: PASS and exit 0.

- [ ] **Step 6: 提交 App Shell**

```powershell
git add apps/user_client/src
git commit -m "feat: add cloud mountain app shell and motion system"
```

## Task 4: 实现页面章节与统一内容组件

**Files:**
- Create: `apps/user_client/src/pages/index.js`
- Create: `apps/user_client/src/pages/home.js`
- Create: `apps/user_client/src/pages/auth.js`
- Create: `apps/user_client/src/pages/goals.js`
- Create: `apps/user_client/src/pages/plan.js`
- Create: `apps/user_client/src/pages/study.js`
- Create: `apps/user_client/src/pages/review.js`
- Create: `apps/user_client/src/pages/knowledge.js`
- Create: `apps/user_client/src/pages/assistant.js`
- Create: `apps/user_client/src/pages/growth.js`
- Create: `apps/user_client/src/pages/map.js`
- Create: `apps/user_client/src/pages/profile.js`
- Create: `apps/user_client/src/pages/states.js`
- Modify: `apps/user_client/src/app.js`

- [ ] **Step 1: 写页面覆盖测试**

测试遍历 `ROUTES`，断言每条第一阶段路由有页面 renderer；断言首页包含“开始今日学习”、计划页包含当前试点主题、登顶页状态包含“回望来路”这类真实动作词，而不是空的占位标题。

- [ ] **Step 2: 运行测试确认页面覆盖不完整**

Run: `pnpm client:test`  
Expected: FAIL and identify missing renderers for the page registry.

- [ ] **Step 3: 实现页面渲染器**

页面全部通过 `renderPage(route, state)` 返回 HTML，使用 `DEMO_STATE` 的真实可替换字段。首页采用“山脚遥望 + 今日路径 + 远方峰顶”；学习/复习/知识页把功能放在高对比纸面层；成长页展示阶段成就和登顶回望；地图页使用 `starforged-frontier-scene-v1` 作为章节视觉入口；助手页使用 manifest 中的 `assistant-portrait-v1`。

- [ ] **Step 4: 接入交互**

导航、主行动、目标选择、任务展开、移动端菜单、减少动效开关、回望/下一阶段按钮均走事件委托和 History API。点击行动后只更新演示 UI 状态，不声明真实结算成功。

- [ ] **Step 5: 运行页面测试**

Run: `pnpm client:test; node --check apps/user_client/src/app.js`  
Expected: PASS, route renderers complete, syntax check exits 0.

- [ ] **Step 6: 提交页面章节**

```powershell
git add apps/user_client/src/app.js apps/user_client/src/pages
git commit -m "feat: add cloud mountain learning chapters"
```

## Task 5: 注册并接入真实视觉资源

**Files:**
- Modify: `assets/generated/asset-manifest.json`
- Modify: `apps/user_client/src/data/assets.js`
- Add: `assets/generated/source/starforged-frontier-scene-v1.png`
- Add: `assets/generated/source/aaa-home-title-screen-female-v2.png`
- Add: `assets/generated/source/aaa-hero-character-female-v2.png`

- [ ] **Step 1: 先校验候选资源**

为每个实际显示的 PNG 读取尺寸和 SHA-256，确认文件存在且尺寸大于 0；manifest 记录 `asset_id`、用途、尺寸、来源、候选审核状态和降级资源。

- [ ] **Step 2: 更新资源映射**

`ASSET_CATALOG` 只暴露 `asset_id`、路径和用途；页面通过 `asset("starforged-frontier-scene-v1")` 获取 URL。未审阅的角色表和参考板继续保持 reference-only，不直接展示。

- [ ] **Step 3: 运行资源检查**

Run: `pnpm image:test; pnpm client:test`  
Expected: existing image-generation tests pass and all displayed IDs resolve to files.

- [ ] **Step 4: 提交资源管线**

```powershell
git add assets/generated/asset-manifest.json assets/generated/source/starforged-frontier-scene-v1.png assets/generated/source/aaa-home-title-screen-female-v2.png assets/generated/source/aaa-hero-character-female-v2.png apps/user_client/src/data/assets.js
git commit -m "feat: register cloud mountain visual assets"
```

## Task 6: 浏览器验证、响应式修正和交付材料

**Files:**
- Modify: `apps/user_client/src/styles.css`
- Modify: `apps/user_client/src/app.js`
- Create: `docs/superpowers/evidence/2026-09-03-cloud-mountain-ui-verification.md`

- [ ] **Step 1: 启动本地服务**

Run: `pnpm client:serve`  
Expected: local server listens on `http://127.0.0.1:4187` and responds with the app shell.

- [ ] **Step 2: 浏览器检查桌面与移动端**

检查 1440px、1280px、1024px、390px 和 375px：路由进入、八方导航、首页主行动、移动菜单、任务/计划页面、图片请求、无横向溢出、文字不遮挡、焦点可见、减少动效可用。

- [ ] **Step 3: 修复验证发现的问题**

只调整真实失败点：布局溢出改容器约束，文字拥挤改断行或尺寸，动效问题改 transform/opacity，资源问题改 manifest 映射或降级。不要用隐藏溢出掩盖内容错误。

- [ ] **Step 4: 运行最终命令**

Run: `pnpm client:test; pnpm image:test; node --check apps/user_client/server.mjs; git diff --check`  
Expected: all tests pass, syntax checks exit 0, and diff check is clean.

- [ ] **Step 5: 记录证据**

在验证文档中记录改造前后页面清单、视觉规范入口、动效规范入口、视口、资源版本、测试命令、截图路径和未接入真实 API 的演示态边界。

- [ ] **Step 6: 提交交付材料**

```powershell
git add apps/user_client/src/styles.css apps/user_client/src/app.js docs/superpowers/evidence/2026-09-03-cloud-mountain-ui-verification.md
git commit -m "test: verify cloud mountain client experience"
```

## Self-review

- **Spec coverage:** 页面章节由 Task 4 覆盖；Token、Shell、八方导航与动效由 Task 3 覆盖；云雾和登顶状态由 Task 3/4 覆盖；资源 ID 与降级由 Task 5 覆盖；键盘、移动端、减少动效、错误和资源失败由 Task 6 覆盖；改造前后清单和截图由 Task 6 交付。
- **Security boundary:** UI 只展示演示 adapter 的状态；不写奖励、掌握度或 AI Provider 逻辑；真实 API 接入位置固定在 `src/data` adapter 边界。
- **Performance boundary:** 首屏只加载入口章节资源；云雾不使用大规模粒子；移动端减少层数；页面转场不阻塞操作。
- **No placeholders:** 计划没有使用 TBD/TODO 或“适当处理”类空泛步骤；每个任务都有文件、命令和预期结果。
- **Type consistency:** `ROUTES`、`NAV_ITEMS`、`normalizeRoute`、`DEMO_STATE` 和 `ASSET_CATALOG` 在各任务中的名称保持一致。
