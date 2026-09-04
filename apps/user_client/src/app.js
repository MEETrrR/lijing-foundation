import { DEMO_STATE } from "./data/demo-data.js";
import { normalizeRoute } from "./data/routes.js";
import { renderPage } from "./pages/index.js";
import { renderShell } from "./components/shell.js";

export function createApp(root = document.querySelector("#app")) {
  if (!root) throw new Error("Missing #app mount point");
  let motionEnabled = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches !== true;
  let selectedGoal = DEMO_STATE.goals.find((goal) => goal.selected)?.id ?? "goal-exam";
  let scrollFrame = 0;

  const render = (route = normalizeRoute(window.location.pathname)) => {
    document.title = `砺境 · ${route === "/" ? "向山顶而行" : "云海登山"}`;
    root.innerHTML = renderShell(route, DEMO_STATE, renderPage(route, DEMO_STATE));
    root.querySelector(".app-shell")?.setAttribute("data-motion", motionEnabled ? "on" : "off");
    root.style.setProperty("--scroll-shift", motionEnabled ? `${Math.min(window.scrollY, 700) * 0.12}px` : "0px");
    bindEvents();
    requestAnimationFrame(() => root.querySelector("#main-content")?.focus({ preventScroll: true }));
  };

  const navigate = (route) => {
    const next = normalizeRoute(route);
    if (next !== window.location.pathname) window.history.pushState({}, "", next);
    render(next);
  };

  const toast = (message) => {
    const region = root.querySelector(".toast-region");
    if (!region) return;
    region.textContent = message;
    region.classList.add("is-visible");
    window.setTimeout(() => region.classList.remove("is-visible"), 2200);
  };

  function bindEvents() {
    root.querySelectorAll("[data-route]").forEach((element) => element.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(element.dataset.route);
    }));
    root.querySelectorAll('[data-action="toggle-menu"]').forEach((element) => element.addEventListener("click", () => {
      const panel = root.querySelector("#mobile-nav-panel");
      const open = panel?.hasAttribute("hidden");
      if (!panel) return;
      if (open) panel.removeAttribute("hidden"); else panel.setAttribute("hidden", "");
      root.querySelectorAll('[data-action="toggle-menu"]').forEach((button) => button.setAttribute("aria-expanded", String(open)));
    }));
    root.querySelectorAll('[data-action="toggle-motion"]').forEach((element) => element.addEventListener("click", () => {
      motionEnabled = !motionEnabled;
      root.querySelector(".app-shell")?.setAttribute("data-motion", motionEnabled ? "on" : "off");
      toast(motionEnabled ? "云雾动效已开启" : "已切换为静谧模式");
    }));
    root.querySelectorAll("[data-goal]").forEach((element) => element.addEventListener("click", () => {
      selectedGoal = element.dataset.goal;
      root.querySelectorAll("[data-goal]").forEach((goal) => {
        const selected = goal.dataset.goal === selectedGoal;
        goal.classList.toggle("is-selected", selected);
        goal.setAttribute("aria-pressed", String(selected));
      });
      toast("方向已记录在你的山门印中");
    }));
    root.querySelectorAll('[data-action="answer"]').forEach((element) => element.addEventListener("click", () => {
      root.querySelectorAll('[data-action="answer"]').forEach((answer) => answer.classList.remove("is-selected"));
      element.classList.add("is-selected");
    }));
    root.querySelectorAll('[data-action="submit-answer"]').forEach((element) => element.addEventListener("click", () => toast("这一阶已记下，正在等待服务端确认")));
    root.querySelectorAll('[data-action="ask-guide"]').forEach((element) => element.addEventListener("click", () => {
      const input = root.querySelector(".assistant-composer input");
      if (input) { input.value = element.textContent; input.focus(); }
    }));
    root.querySelectorAll("form[data-demo-form]").forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault();
      toast(form.dataset.demoForm === "assistant" ? "问题已送到云中，演示环境暂不调用 AI Gateway" : "演示身份已准备好，下一步请选择登山方向");
    }));
  }

  const updateParallax = () => {
    scrollFrame = 0;
    if (!motionEnabled) return;
    root.style.setProperty("--scroll-shift", `${Math.min(window.scrollY, 700) * 0.12}px`);
  };

  window.addEventListener("scroll", () => {
    if (scrollFrame) return;
    scrollFrame = window.requestAnimationFrame(updateParallax);
  }, { passive: true });

  window.addEventListener("popstate", () => render());
  render();
  return { navigate, render, state: DEMO_STATE };
}
