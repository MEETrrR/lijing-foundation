import test from "node:test";
import assert from "node:assert/strict";
import { NAV_ITEMS, ROUTES, getRouteMeta, normalizeRoute } from "../src/data/routes.js";
import { PAGE_RENDERERS, renderPage } from "../src/pages/index.js";
import { renderShell } from "../src/components/shell.js";
import { DEMO_STATE } from "../src/data/demo-data.js";
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

test("core actions use human language", () => {
  assert.equal(renderPage("/", DEMO_STATE).includes("开始今日行旅"), true);
  assert.equal(renderPage("/plan", DEMO_STATE).includes("今日行旅"), true);
  assert.equal(renderPage("/growth", DEMO_STATE).includes("回望来路"), true);
});

test("shell exposes navigation, motion controls and content landmarks", () => {
  const html = renderShell("/plan", DEMO_STATE);
  assert.equal(html.includes('aria-label="八方导航"'), true);
  assert.equal(html.includes('data-motion="on"'), true);
  assert.equal(html.includes('data-current-route="/plan"'), true);
  assert.equal(html.includes('class="app-shell" data-route='), false);
  assert.equal(html.includes('<main id="main-content"'), true);
  assert.equal(html.includes("当前章节"), true);
});

test("native browser entry loads CSS as a stylesheet, not a JS module", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(html, /<link rel="stylesheet" href="\/apps\/user_client\/src\/styles\.css">/);
  assert.doesNotMatch(main, /import\s+["']\.\/styles\.css["']/);
});
