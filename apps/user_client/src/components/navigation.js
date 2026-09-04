import { NAV_ITEMS } from "../data/routes.js";
import { assetUrl } from "../data/assets.js";
import { icon, mark } from "./icons.js";

export function renderNavigation(currentRoute) {
  const links = NAV_ITEMS.filter((item) => item.href !== "/features").map((item) => `<a class="feature-nav-node feature-nav-node--${item.position} ${item.href === currentRoute ? "is-active" : ""}" href="${item.href}" data-route="${item.href}" aria-current="${item.href === currentRoute ? "page" : "false"}">
    <span class="feature-nav-node__orbit"></span><span class="feature-nav-node__gua">${item.gua}</span><span class="feature-nav-node__label">${item.label}</span><small>${item.chapter ?? item.label}</small>
  </a>`).join("");
  return `<button class="feature-nav-trigger" type="button" data-action="toggle-feature-nav" aria-label="八方导航" aria-expanded="false" aria-controls="feature-nav-overlay" title="打开八方功能导航"><span class="feature-nav-trigger__orbit"></span>${mark("☯")}<span class="feature-nav-trigger__label">八方</span></button>
  <div class="feature-nav-overlay" id="feature-nav-overlay" role="dialog" aria-modal="true" aria-label="八方功能导航" aria-hidden="true" hidden style="--bagua-base-image: url('${assetUrl("bagua-ink-compass-v1")}')">
    <div class="feature-nav-overlay__inner"><div class="feature-nav-overlay__topline"><span>砺境 · 八方行旅</span><small>选择一条路，进入对应功能界面</small></div><button class="feature-nav-overlay__close" type="button" data-action="close-feature-nav" title="关闭八方功能导航">${icon("close", "关闭八方功能导航")}</button><nav class="feature-nav-dial" aria-label="八方功能导航" style="--bagua-core-image: url('${assetUrl("bagua-yinyang-core-v1")}')"><span class="feature-nav-dial__ink"></span><span class="feature-nav-dial__halo"></span><span class="feature-nav-dial__ring feature-nav-dial__ring--outer"></span><span class="feature-nav-dial__ring feature-nav-dial__ring--inner"></span><span class="feature-nav-dial__axis feature-nav-dial__axis--horizontal"></span><span class="feature-nav-dial__axis feature-nav-dial__axis--vertical"></span><a class="feature-nav-center ${currentRoute === "/features" ? "is-active" : ""}" href="/features" data-route="/features" aria-current="${currentRoute === "/features" ? "page" : "false"}"><strong>☯</strong><span>功能目录</span><small>八方皆可入山</small></a>${links}</nav><div class="feature-nav-overlay__footer"><span>当前章节 · ${currentRoute === "/" ? "遥望" : currentRoute}</span><button class="icon-button" type="button" data-action="toggle-motion" aria-pressed="true" title="切换动效">${icon("spark", "切换动效")}</button></div></div>
  </div>`;
}

export function renderTopbar(meta, state) {
  return `<header class="topbar"><div class="topbar__chapter"><span class="topbar__chapter-mark">${meta.gua}</span><div><span class="sr-only">当前章节</span><span class="topbar__eyebrow">${meta.eyebrow}</span><span class="topbar__title">${meta.chapter}</span></div></div><div class="topbar__right"><span class="connection"><i></i>本地演示环境</span><a class="topbar__icon" href="/profile" data-route="/profile" aria-label="通知">${icon("bell", "通知")}</a><a class="topbar__profile" href="/profile" data-route="/profile"><span class="avatar-dot">行</span><span>${state.user.name}</span>${icon("chevron")}</a></div></header>`;
}
