import { NAV_ITEMS } from "../data/routes.js";
import { icon } from "./icons.js";

export function renderNavigation(currentRoute, state) {
  const cetSelected = state?.goals?.some((goal) => goal.selected && ["goal-cet4", "goal-cet6"].includes(goal.id));
  const items = cetSelected
    ? [NAV_ITEMS[0], { href: "/cet", label: "四六级", icon: "search" }, ...NAV_ITEMS.slice(1)]
    : NAV_ITEMS;
  const navClass = cetSelected ? " primary-nav--cet" : "";
  const mobileClass = cetSelected ? " mobile-primary-nav--cet" : "";
  const links = items.map((item) => `<a class="primary-nav__link ${item.href === currentRoute ? "is-active" : ""}" href="${item.href}" data-route="${item.href}" aria-current="${item.href === currentRoute ? "page" : "false"}">${icon(item.icon, item.label)}<span>${item.label}</span></a>`).join("");
  return `<nav class="primary-nav${navClass}" data-tour-target="feature-nav" aria-label="主导航">${links}</nav><nav class="mobile-primary-nav${mobileClass}" aria-label="移动主导航">${links}</nav>`;
}

export function renderTopbar(meta, state, currentRoute = "") {
  if (currentRoute === "/auth") {
    return `<header class="topbar topbar--auth"><a class="topbar__auth-brand" href="/auth" data-route="/auth"><span class="topbar__chapter-mark">☷</span><span>砺境</span></a><span class="topbar__auth-note">从今天这一条开始</span></header>`;
  }
  const tourAction = currentRoute === "/"
    ? `<button class="topbar__icon topbar__help" type="button" data-action="tour-open" aria-label="重看首页导览" title="重看首页导览">${icon("spark", "重看首页导览")}</button>`
    : "";
  const connectionLabel = state.isDemo
    ? "本地演示环境"
    : state.service?.persistence === "durable"
      ? "真实账户 · 可跨重启保存"
      : state.service?.persistence === "ephemeral"
      ? "真实账户 · 临时会话"
        : "真实账户 · 正在确认保存方式";
  const adminAction = state.auth?.user?.is_admin === true
    ? `<a class="topbar__admin-link" href="/admin" data-route="/admin" aria-label="打开运营后台">运营后台</a>`
    : "";
  if (currentRoute === "/onboarding") {
    return `<header class="topbar topbar--onboarding"><div class="topbar__chapter"><span class="topbar__chapter-mark">☷</span><div><span class="sr-only">当前章节</span><span class="topbar__eyebrow">入山引导 · 一次填写</span><span class="topbar__title">入山引导</span></div></div><div class="topbar__right"><span class="connection"><i></i>${connectionLabel}</span><a class="topbar__onboarding-exit" href="/" data-route="/">稍后再设置</a><a class="topbar__profile" href="/settings" data-route="/settings" aria-label="打开设置"><span class="avatar-dot">行</span><span>${state.user?.name || "行者"}</span>${icon("chevron")}</a></div></header>`;
  }
  return `<header class="topbar" data-tour-target="topbar"><div class="topbar__chapter"><span class="topbar__chapter-mark">${meta.gua}</span><div><span class="sr-only">当前章节</span><span class="topbar__eyebrow">${meta.eyebrow}</span><span class="topbar__title">${meta.chapter}</span></div></div><div class="topbar__right"><span class="connection"><i></i>${connectionLabel}</span>${tourAction}${adminAction}<a class="topbar__icon" href="/profile" data-route="/profile" aria-label="通知">${icon("bell", "通知")}</a><a class="topbar__profile" href="/settings" data-route="/settings" aria-label="打开设置"><span class="avatar-dot">行</span><span>${state.user.name}</span>${icon("chevron")}</a></div></header>`;
}
