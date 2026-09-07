import { NAV_ITEMS } from "../data/routes.js";
import { assetUrl } from "../data/assets.js";
import { icon, mark } from "./icons.js";

export function renderNavigation(currentRoute) {
  const links = NAV_ITEMS.filter((item) => item.href !== "/features").map((item) => `<a class="feature-nav-node feature-nav-node--${item.position} ${item.href === currentRoute ? "is-active" : ""}" href="${item.href}" data-route="${item.href}" aria-current="${item.href === currentRoute ? "page" : "false"}">
    <span class="feature-nav-node__orbit"></span><span class="feature-nav-node__gua">${item.gua}</span><span class="feature-nav-node__label">${item.label}</span><small>${item.chapter ?? item.label}</small>
  </a>`).join("");
  const triggerDirections = NAV_ITEMS.filter((item) => item.href !== "/features").map((item) => `<span class="feature-nav-trigger__direction feature-nav-trigger__direction--${item.position}" aria-hidden="true">${item.gua}</span>`).join("");
  return `<button class="feature-nav-trigger" data-tour-target="feature-nav" type="button" data-action="toggle-feature-nav" aria-label="打开全部功能导航" aria-expanded="false" aria-controls="feature-nav-overlay" title="打开全部功能导航"><span class="feature-nav-trigger__orbit"></span><span class="feature-nav-trigger__dial" aria-hidden="true"><span class="feature-nav-trigger__directions">${triggerDirections}</span><span class="feature-nav-trigger__core">${mark("☯")}</span></span><span class="feature-nav-trigger__label">全部功能</span></button>
  <div class="feature-nav-overlay" id="feature-nav-overlay" role="dialog" aria-modal="true" aria-label="全部功能导航" aria-hidden="true" hidden style="--bagua-base-image: url('${assetUrl("bagua-ink-compass-v1")}')">
    <div class="feature-nav-overlay__inner"><div class="feature-nav-overlay__topline"><span>砺境 · 全部功能</span><small>选择一个功能开始</small></div><button class="feature-nav-overlay__close" type="button" data-action="close-feature-nav" title="关闭全部功能导航">${icon("close", "关闭全部功能导航")}</button><nav class="feature-nav-dial" aria-label="全部功能导航" style="--bagua-core-image: url('${assetUrl("bagua-yinyang-core-v1")}')"><span class="feature-nav-dial__ink"></span><span class="feature-nav-dial__halo"></span><span class="feature-nav-dial__ring feature-nav-dial__ring--outer"></span><span class="feature-nav-dial__ring feature-nav-dial__ring--inner"></span><span class="feature-nav-dial__axis feature-nav-dial__axis--horizontal"></span><span class="feature-nav-dial__axis feature-nav-dial__axis--vertical"></span><a class="feature-nav-center ${currentRoute === "/features" ? "is-active" : ""}" href="/features" data-route="/features" aria-current="${currentRoute === "/features" ? "page" : "false"}"><strong>☯</strong><span>全部功能</span><small>选择一个方向</small></a>${links}</nav><div class="feature-nav-overlay__footer"><span>当前章节 · ${currentRoute === "/" ? "遥望" : currentRoute}</span><button class="icon-button" type="button" data-action="toggle-motion" aria-pressed="true" title="切换动效">${icon("spark", "切换动效")}</button></div></div>
  </div>`;
}

export function renderTopbar(meta, state, currentRoute = "") {
  if (currentRoute === "/auth") {
    return `<header class="topbar topbar--auth"><a class="topbar__auth-brand" href="/auth" data-route="/auth"><span class="topbar__chapter-mark">☷</span><span>砺境</span></a><span class="topbar__auth-note">云海登山系统 · 先从今天开始</span></header>`;
  }
  const tourAction = currentRoute === "/"
    ? `<button class="topbar__icon topbar__help" type="button" data-action="tour-open" aria-label="重看首页导览" title="重看首页导览">${icon("spark", "重看首页导览")}</button>`
    : "";
  const connectionLabel = state.isDemo ? "本地演示环境" : "真实账户 · 服务端保存";
  return `<header class="topbar" data-tour-target="topbar"><div class="topbar__chapter"><span class="topbar__chapter-mark">${meta.gua}</span><div><span class="sr-only">当前章节</span><span class="topbar__eyebrow">${meta.eyebrow}</span><span class="topbar__title">${meta.chapter}</span></div></div><div class="topbar__right"><span class="connection"><i></i>${connectionLabel}</span>${tourAction}<a class="topbar__icon" href="/profile" data-route="/profile" aria-label="通知">${icon("bell", "通知")}</a><a class="topbar__profile" href="/settings" data-route="/settings" aria-label="打开设置"><span class="avatar-dot">行</span><span>${state.user.name}</span>${icon("chevron")}</a></div></header>`;
}
