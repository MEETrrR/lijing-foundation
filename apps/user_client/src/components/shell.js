import { getRouteMeta } from "../data/routes.js";
import { renderNavigation, renderTopbar } from "./navigation.js";
import { renderStatusAxis } from "./status-axis.js";
import { renderWorldStage } from "./world-stage.js";

export function renderShell(currentRoute, state, content = "") {
  const meta = getRouteMeta(currentRoute);
  return `<div class="app-shell" data-motion="on" data-current-route="${currentRoute}">
    ${renderWorldStage(currentRoute)}
    ${renderNavigation(currentRoute)}
    <div class="app-frame">
      ${renderTopbar(meta, state)}
      <main id="main-content" tabindex="-1"><div class="page-view" data-page="${currentRoute}">${content}</div></main>
    </div>
    <div class="shell-status">${renderStatusAxis(state)}</div>
    <div class="toast-region" aria-live="polite" aria-atomic="true"></div>
  </div>`;
}
