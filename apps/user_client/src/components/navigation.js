import { NAV_ITEMS } from "../data/routes.js";
import { icon, mark } from "./icons.js";

export function renderNavigation(currentRoute) {
  const links = NAV_ITEMS.map((item) => `<a class="nav-node nav-node--${item.position} ${item.href === currentRoute ? "is-active" : ""}" href="${item.href}" data-route="${item.href}" aria-current="${item.href === currentRoute ? "page" : "false"}">
    <span class="nav-node__orbit"></span>${mark(item.gua)}<span class="nav-node__label">${item.label}</span>
  </a>`).join("");
  return `<aside class="nav-rail" aria-label="八方导航">
    <a class="brand-seal" href="/" data-route="/" aria-label="砺境，返回山脚"><span>砺</span><small>境</small></a>
    <div class="nav-rail__caption">八方行旅</div>
    <nav class="nav-dial" aria-label="章节导航"><span class="nav-dial__line nav-dial__line--h"></span><span class="nav-dial__line nav-dial__line--v"></span>${links}</nav>
    <div class="nav-rail__bottom"><span class="nav-rail__weather">云海<br><b>未散</b></span><button class="icon-button" type="button" data-action="toggle-motion" aria-pressed="true" title="切换动效">${icon("spark", "切换动效")}</button></div>
  </aside>
  <div class="mobile-nav-bar"><a href="/" data-route="/" class="mobile-nav-bar__home" aria-label="返回山脚">${mark("☷")}</a><span class="mobile-nav-bar__label">八方行旅</span><button class="mobile-nav-trigger" type="button" data-action="toggle-menu" aria-expanded="false" aria-controls="mobile-nav-panel" title="展开八方导航">${icon("menu", "展开八方导航")}</button></div>
  <div class="mobile-nav-panel" id="mobile-nav-panel" hidden><div class="mobile-nav-panel__head"><span>八方行旅</span><button class="icon-button" type="button" data-action="toggle-menu" title="关闭导航">${icon("close", "关闭导航")}</button></div><nav>${links}</nav></div>`;
}

export function renderTopbar(meta, state) {
  return `<header class="topbar"><div class="topbar__chapter"><span class="sr-only">当前章节</span><span class="topbar__eyebrow">${meta.eyebrow}</span><span class="topbar__title">${meta.chapter}</span></div><div class="topbar__right"><span class="connection"><i></i>本地演示环境</span><a class="topbar__icon" href="/profile" data-route="/profile" aria-label="通知">${icon("bell", "通知")}</a><a class="topbar__profile" href="/profile" data-route="/profile"><span class="avatar-dot">行</span><span>${state.user.name}</span>${icon("chevron")}</a></div></header>`;
}
