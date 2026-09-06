import { getRouteMeta } from "../data/routes.js";
import { renderNavigation, renderTopbar } from "./navigation.js";
import { renderStatusAxis } from "./status-axis.js";
import { renderWorldStage } from "./world-stage.js";
import { renderAscensionIntro } from "./ascension-intro.js";
import { assetUrl } from "../data/assets.js";
import { icon } from "./icons.js";

const INTERFACE_TOUR_STEPS = [
  { id: "feature-nav", kicker: "界面导览 · 01 / 04", title: "左上角八卦，是总入口", body: "点开它，可以看到砺境的全部功能。你不需要记住每个名字，想去哪里时从这里找就好。" },
  { id: "topbar", kicker: "界面导览 · 02 / 04", title: "顶部这一行，告诉你身在何处", body: "左侧是当前章节，右侧是通知和你的行者档案。以后看到章节名变化，就知道自己正在使用哪一段功能。" },
  { id: "daily-panel", kicker: "界面导览 · 03 / 04", title: "首页先看今天，不看一生", body: "这里会把你的目标折成今天走得完的一小段。先看当前营地和专注状态，再决定要不要进入当前山段。" },
  { id: "today-route", kicker: "界面导览 · 04 / 04", title: "今日行旅，是你每天真正要走的路", body: "任务会按“现在出发、已抵达、云后显现”展开。完成学习后留下证据，砺境才会把下一步交给你。" },
];

function renderInterfaceTour(state) {
  const rawIndex = Number(state.tour?.step) || 0;
  const index = Math.min(Math.max(rawIndex, 0), INTERFACE_TOUR_STEPS.length - 1);
  const step = INTERFACE_TOUR_STEPS[index];
  const last = index === INTERFACE_TOUR_STEPS.length - 1;
  return `<div class="interface-tour" data-tour-target-name="${step.id}" data-tour-step-index="${index}" role="dialog" aria-modal="true" aria-labelledby="interface-tour-title" aria-describedby="interface-tour-copy">
    <div class="interface-tour__scrim" aria-hidden="true"></div>
    <div class="interface-tour__spotlight" aria-hidden="true"></div>
    <aside class="interface-tour__card">
      <div class="interface-tour__topline"><span>${step.kicker}</span><span>首次进入可回看</span></div>
      <h2 id="interface-tour-title">${step.title}</h2>
      <p id="interface-tour-copy">${step.body}</p>
      <div class="interface-tour__path"><span>目标</span><i>→</i><span>今日行旅</span><i>→</i><span>证据</span><i>→</i><span>回望</span></div>
      <div class="interface-tour__actions"><button class="interface-tour__skip" type="button" data-action="tour-skip">稍后再看</button><div><button class="button button--outline interface-tour__prev" type="button" data-action="tour-prev"${index === 0 ? " hidden" : ""}>返回</button><button class="button button--primary" type="button" data-action="tour-next">${last ? "完成导览" : "下一处"} ${icon("arrow")}</button></div></div>
    </aside>
  </div>`;
}

export function renderShell(currentRoute, state, content = "") {
  const meta = getRouteMeta(currentRoute);
  const shellMode = currentRoute === "/onboarding" ? "onboarding" : currentRoute === "/auth" ? "auth" : "standard";
  const isAuth = currentRoute === "/auth";
  const onboardingStyle = currentRoute === "/onboarding"
    ? ` style="--onboarding-image: url('${assetUrl("lijing-onboarding-background-v2")}')"`
    : "";
  return `<div class="app-shell app-shell--${shellMode}"${onboardingStyle} data-motion="on" data-current-route="${currentRoute}" data-route-phase="in">
    ${isAuth ? "" : renderWorldStage(currentRoute)}
    ${isAuth ? "" : renderNavigation(currentRoute)}
    <div class="app-frame">
      ${renderTopbar(meta, state, currentRoute)}
      <main id="main-content" tabindex="-1"><div class="page-view" data-page="${currentRoute}">${content}</div></main>
    </div>
    <div class="shell-status">${isAuth ? "" : renderStatusAxis(state)}</div>
    <div class="toast-region" aria-live="polite" aria-atomic="true"></div>
    ${currentRoute === "/" && state.tour?.active ? renderInterfaceTour(state) : ""}
    ${renderAscensionIntro()}
  </div>`;
}
