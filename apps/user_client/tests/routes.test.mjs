import test from "node:test";
import assert from "node:assert/strict";
import { NAV_ITEMS, ROUTES, getRouteMeta, normalizeRoute } from "../src/data/routes.js";
import { PAGE_RENDERERS, renderPage } from "../src/pages/index.js";
import { renderShell } from "../src/components/shell.js";
import { DEMO_STATE } from "../src/data/demo-data.js";
import { getAsset } from "../src/data/assets.js";
import { readFile } from "node:fs/promises";

test("normalizes unknown paths to the world entrance", () => {
  assert.equal(normalizeRoute("/missing"), "/");
  assert.equal(normalizeRoute("/plan/"), "/plan");
});

test("covers every first-phase chapter in navigation metadata", () => {
  const routeKeys = new Set(Object.keys(ROUTES));
  for (const item of NAV_ITEMS) assert.equal(routeKeys.has(item.href), true);
  assert.equal(routeKeys.size >= 11, true);
  assert.equal(getRouteMeta("/study").chapter, "攀登");
});

test("every product chapter has a real page renderer", () => {
  for (const route of Object.keys(ROUTES)) {
    assert.equal(typeof PAGE_RENDERERS[route], "function", `missing renderer for ${route}`);
    const html = renderPage(route, DEMO_STATE);
    assert.equal(html.includes("demo-state"), true, `missing demo state marker for ${route}`);
  }
});

test("first-visit onboarding collects a profile, a goal, a companion and feature orientation", () => {
  const state = structuredClone(DEMO_STATE);
  state.onboarding.step = 1;
  const profileHtml = renderPage("/onboarding", state);
  assert.equal(getAsset("lijing-onboarding-background-v2")?.path, "/assets/generated/source/onboarding/onboarding-background-v2.png");
  assert.match(profileHtml, /onboarding\/onboarding-background-v2\.png/);
  assert.match(profileHtml, /data-demo-form="onboarding-profile"/);
  assert.match(profileHtml, /name="school"/);
  assert.match(profileHtml, /你现在最想完成什么/);

  state.onboarding.step = 2;
  const guideHtml = renderPage("/onboarding", state);
  assert.match(guideHtml, /第二步 · 选择书鼎/);
  assert.equal((guideHtml.match(/data-action="onboarding-select-guide"/g) ?? []).length, 4);
  assert.match(guideHtml, /教学方式/);

  state.onboarding.step = 3;
  state.onboarding.featureIndex = 5;
  const featureHtml = renderPage("/onboarding", state);
  assert.match(featureHtml, /第三步 · 认识功能/);
  assert.equal((featureHtml.match(/data-action="onboarding-feature-select"/g) ?? []).length, 6);
  for (const title of ["今日计划", "专注学习", "学习复盘", "知识库", "问书鼎", "成长记录"]) {
    assert.match(featureHtml, new RegExp(title));
  }
  assert.doesNotMatch(featureHtml, /data-feature-route="\/goals"/);
  assert.match(featureHtml, /data-action="onboarding-feature-open"/);
  assert.match(featureHtml, /完成引导，进入砺境/);
});

test("bagua reference is registered and integrated into orientation chapters", () => {
  assert.equal(getAsset("bagua-ink-compass-v1")?.path, "/assets/generated/source/bagua-ink-compass-v1.png");
  assert.match(renderPage("/review", DEMO_STATE), /bagua-field/);
  assert.match(renderPage("/goals", DEMO_STATE), /data-bagua="乾"/);
});

test("knowledge chapter exposes a personal graph and node detail", () => {
  const html = renderPage("/knowledge", DEMO_STATE);
  assert.match(html, /个人复利 Agent 知识库/);
  assert.match(html, /个人复利知识关系网络/);
  assert.match(html, /PERSONAL COMPOUND/);
  assert.match(html, /Agent 管理/);
  assert.match(html, /外部资源归档/);
  assert.equal((html.match(/data-action="select-knowledge"/g) ?? []).length >= 6, true);
  assert.equal((html.match(/class="knowledge-network__dot /g) ?? []).length, 96);
  assert.match(html, /把这次理解接入知识库|我留下的理解/);
  assert.match(html, /搜索节点、来源或关键词/);
  assert.match(html, /data-knowledge-view="directory"/);
});

test("knowledge network stays legible as the library grows", () => {
  const state = structuredClone(DEMO_STATE);
  state.knowledge = Array.from({ length: 300 }, (_, index) => ({
    ...DEMO_STATE.knowledge[index % DEMO_STATE.knowledge.length],
    id: `scaled-node-${index}`,
    title: `知识节点 ${index + 1}`,
    relatedIds: index > 0 ? [`scaled-node-${index - 1}`] : [],
    position: undefined,
  }));
  state.activeKnowledgeId = "scaled-node-299";
  const html = renderPage("/knowledge", state);
  assert.match(html, /关系网络 · 300 个核心节点/);
  assert.equal((html.match(/class="knowledge-network__node /g) ?? []).length, 9);
  assert.equal((html.match(/knowledge-network__dot--interactive/g) ?? []).length, 291);
  assert.equal((html.match(/data-knowledge-item/g) ?? []).length, 300);
});

test("study chapter exposes the evidence protocol and action-oriented review contract", () => {
  const studyHtml = renderPage("/study", DEMO_STATE);
  assert.equal((studyHtml.match(/data-action="select-evidence"/g) ?? []).length, 4);
  assert.match(studyHtml, /data-evidence-input/);
  assert.match(studyHtml, /提交证据并生成复盘/);
  assert.match(studyHtml, /study-knowledge-capture/);
  assert.match(studyHtml, /把这次理解接入知识库/);
  assert.doesNotMatch(studyHtml, /收录这一段到知识库/);
  const reviewHtml = renderPage("/review", DEMO_STATE);
  for (const label of ["用了什么证据", "发现了什么问题", "为什么这样判断", "明日行动"]) assert.match(reviewHtml, new RegExp(label));
});

test("knowledge can be captured from study and added through a composer", () => {
  const studyHtml = renderPage("/study", DEMO_STATE);
  assert.match(studyHtml, /data-action="capture-knowledge"/);
  const state = structuredClone(DEMO_STATE);
  state.knowledgeComposerOpen = true;
  const knowledgeHtml = renderPage("/knowledge", state);
  assert.match(knowledgeHtml, /data-demo-form="knowledge-capture"/);
  assert.match(knowledgeHtml, /name="relatedId"/);
  assert.match(knowledgeHtml, /收录进知识库/);
});

test("approved chapter backgrounds are mapped to their matching modules", () => {
  const expectedScenes = {
    "/": "lijing-horizon-ink-v1.png",
    "/plan": "lijing-growth-journey-ink-v1.png",
    "/growth": "lijing-growth-journey-ink-v1.png",
    "/study": "lijing-summit-climb-ink-v2.png",
    "/knowledge": "lijing-summit-climb-ink-v2.png",
    "/map": "lijing-summit-climb-ink-v2.png",
    "/review": "lijing-recall-ink-v1.png",
    "/profile": "lijing-archive-ink-v2.png",
    "/assistant": "guides/lijing-guide-background-ink-v1.png",
    "/onboarding": "onboarding/onboarding-background-v2.png",
  };
  for (const [route, filename] of Object.entries(expectedScenes)) {
    assert.match(renderShell(route, DEMO_STATE), new RegExp(`/assets/generated/source/${filename}`));
  }
});

test("guide chapter offers gender-neutral Chinese relic guides", () => {
  const html = renderPage("/assistant", DEMO_STATE);
  assert.match(html, /选择你的书鼎/);
  assert.equal((html.match(/data-action="select-guide"/g) ?? []).length, 4);
  for (const assetId of ["lijing-guide-heavenly-book-v1", "lijing-guide-pagoda-v1", "lijing-guide-ding-v1", "lijing-guide-fan-v1"]) {
    assert.match(html, new RegExp(assetId));
  }
  assert.doesNotMatch(html, /aaa-hero-character-female-v2/);
});

test("guide selection renders the selected relic as the active guide", () => {
  const state = structuredClone(DEMO_STATE);
  state.guide.selectedAssetId = "lijing-guide-ding-v1";
  const html = renderPage("/assistant", state);
  assert.match(html, /教学人格 · 专注、减负、短行动<\/span><strong>重鼎 · 镇心<\/strong>/);
  assert.match(html, /data-guide="lijing-guide-ding-v1" aria-pressed="true"/);
  assert.match(html, /guide-option--ding is-selected/);
});

test("assistant presents companion teaching identity instead of a visual-only guide", () => {
  const state = structuredClone(DEMO_STATE);
  state.guide.selectedAssetId = "lijing-guide-fan-v1";
  const html = renderPage("/assistant", state);
  assert.match(html, /专属教学人格/);
  assert.match(html, /教学人格 · 类比、反例、换角度/);
  assert.match(html, /它会改变解释、提问和反馈方式/);
});

test("feature directory exposes eight clickable directions", () => {
  const html = renderPage("/features", DEMO_STATE);
  assert.equal((html.match(/class="bagua-node /g) ?? []).length, 8);
  assert.equal((html.match(/data-route="\//g) ?? []).length, 8);
  assert.match(html, /功能目录/);
  assert.match(html, /八方皆可入山/);
});

test("navigation centers on the feature directory and keeps the eight modules around it", () => {
  const html = renderShell("/features", DEMO_STATE);
  assert.match(html, /href="\/features"[^>]+data-route="\/features"/);
  for (const route of ["/goals", "/plan", "/study", "/review", "/knowledge", "/assistant", "/growth", "/map"]) {
    assert.match(html, new RegExp(`data-route="${route.replace("/", "\\/")}"`));
  }
});

test("bagua navigation opens as a full-screen selection surface", async () => {
  const html = renderShell("/study", DEMO_STATE);
  assert.match(html, /class="feature-nav-trigger"/);
  assert.match(html, /aria-controls="feature-nav-overlay"/);
  assert.match(html, /class="feature-nav-overlay"/);
  assert.match(html, /class="feature-nav-dial"/);
  assert.match(html, /bagua-ink-compass-v1\.png/);
  assert.match(html, /bagua-yinyang-core-v1\.png/);
  assert.match(html, /feature-nav-dial__ink/);
  assert.match(html, /feature-nav-trigger__core/);
  assert.equal((html.match(/class="feature-nav-trigger__direction /g) ?? []).length, 8);
  assert.equal((html.match(/class="feature-nav-node /g) ?? []).length, 8);
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.feature-nav-overlay \{[^}]*transform-origin: 51px 48px/);
  assert.match(styles, /feature-nav-trigger-rotate/);
  assert.match(styles, /feature-nav-trigger-breathe/);
});

test("onboarding completion exposes a dragon-phoenix ascension transition", () => {
  const html = renderShell("/goals", DEMO_STATE, renderPage("/goals", DEMO_STATE));
  assert.match(html, /data-action="complete-onboarding"/);
  assert.match(html, /opening\/opening-dragon-v1\.png/);
  assert.match(html, /opening\/opening-phoenix-v1\.png/);
  assert.match(html, /id="ascension-intro"/);
});

test("core actions use human language", () => {
  assert.equal(renderPage("/", DEMO_STATE).includes("开始今日行旅"), true);
  assert.equal(renderPage("/plan", DEMO_STATE).includes("今日行旅"), true);
  assert.equal(renderPage("/growth", DEMO_STATE).includes("回望来路"), true);
});

test("shell exposes navigation, motion controls and content landmarks", () => {
  const html = renderShell("/plan", DEMO_STATE);
  assert.equal(html.includes('aria-label="打开全部功能导航"'), true);
  assert.equal(html.includes('data-motion="on"'), true);
  assert.equal(html.includes('data-current-route="/plan"'), true);
  assert.equal(html.includes('class="app-shell" data-route='), false);
  assert.equal(html.includes('<main id="main-content"'), true);
  assert.equal(html.includes("当前章节"), true);
});

test("onboarding shell replaces the global starfield with the submitted Chinese landscape", () => {
  const html = renderShell("/onboarding", DEMO_STATE, renderPage("/onboarding", DEMO_STATE));
  assert.match(html, /class="app-shell app-shell--onboarding"/);
  assert.match(html, /onboarding\/onboarding-background-v2\.png/);
  assert.match(html, /左上角 · 全部功能/);
  assert.match(html, /data-scene="onboarding"/);
  assert.doesNotMatch(html, /starforged-frontier-scene-v1\.png/);
});

test("native browser entry loads CSS as a stylesheet, not a JS module", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(html, /<link rel="stylesheet" href="\/apps\/user_client\/src\/styles\.css">/);
  assert.doesNotMatch(main, /import\s+["']\.\/styles\.css["']/);
});
