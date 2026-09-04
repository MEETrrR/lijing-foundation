import { DEMO_STATE } from "./data/demo-data.js";
import { normalizeRoute } from "./data/routes.js";
import { renderPage } from "./pages/index.js";
import { renderShell } from "./components/shell.js";

async function requestAi(path, payload) {
  const healthResponse = await fetch("/api/v1/health");
  const health = await healthResponse.json().catch(() => ({}));
  if (!healthResponse.ok || health.ai_configured !== true) throw new Error("AI 服务尚未配置");
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || "AI 服务暂时不可用");
  return body;
}

export function createApp(root = document.querySelector("#app")) {
  if (!root) throw new Error("Missing #app mount point");
  let motionEnabled = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches !== true;
  let selectedGoal = DEMO_STATE.goals.find((goal) => goal.selected)?.id ?? DEMO_STATE.goals[0]?.id ?? "";
  let scrollFrame = 0;
  let transitionTimer = 0;
  let ascensionTimer = 0;
  let revealObserver;

  const render = (route = normalizeRoute(window.location.pathname)) => {
    document.title = `砺境 · ${route === "/" ? "向山顶而行" : "云海登山"}`;
    root.innerHTML = renderShell(route, DEMO_STATE, renderPage(route, DEMO_STATE));
    root.querySelector(".app-shell")?.setAttribute("data-motion", motionEnabled ? "on" : "off");
    root.style.setProperty("--scroll-shift", motionEnabled ? `${Math.min(window.scrollY, 700) * 0.12}px` : "0px");
    root.style.setProperty("--scroll-ratio", motionEnabled ? `${Math.min(window.scrollY / Math.max(window.innerHeight, 1), 1)}` : "0");
    root.querySelectorAll(".page > .page-intro, .page > :not(.page-intro)").forEach((element, index) => {
      element.classList.add("reveal-item");
      element.style.setProperty("--reveal-delay", `${Math.min(index * 70, 280)}ms`);
    });
    if (revealObserver) revealObserver.disconnect();
    if (motionEnabled && "IntersectionObserver" in window) {
      revealObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in-view");
          revealObserver?.unobserve(entry.target);
        }
      }), { threshold: 0.12, rootMargin: "0px 0px -7%" });
      root.querySelectorAll(".reveal-item").forEach((element) => revealObserver.observe(element));
    } else {
      root.querySelectorAll(".reveal-item").forEach((element) => element.classList.add("is-in-view"));
    }
    bindEvents();
    requestAnimationFrame(() => root.querySelector("#main-content")?.focus({ preventScroll: true }));
  };

  const openFeatureNav = () => {
    const overlay = root.querySelector("#feature-nav-overlay");
    const trigger = root.querySelector('[data-action="toggle-feature-nav"]');
    if (!overlay) return;
    overlay.removeAttribute("hidden");
    overlay.setAttribute("aria-hidden", "false");
    trigger?.setAttribute("aria-expanded", "true");
    window.requestAnimationFrame(() => overlay.classList.add("is-open"));
  };

  const navigate = (route, afterRender) => {
    const next = normalizeRoute(route);
    if (next !== window.location.pathname) window.history.pushState({}, "", next);
    root.querySelector(".app-shell")?.setAttribute("data-route-phase", "out");
    window.clearTimeout(transitionTimer);
    transitionTimer = window.setTimeout(() => {
      render(next);
      window.requestAnimationFrame(() => root.querySelector(".app-shell")?.setAttribute("data-route-phase", "in"));
      if (typeof afterRender === "function") afterRender();
    }, motionEnabled ? 120 : 0);
  };

  const toast = (message) => {
    const region = root.querySelector(".toast-region");
    if (!region) return;
    region.textContent = message;
    region.classList.add("is-visible");
    window.setTimeout(() => region.classList.remove("is-visible"), 2200);
  };

  const closeFeatureNav = () => {
    const overlay = root.querySelector("#feature-nav-overlay");
    const trigger = root.querySelector('[data-action="toggle-feature-nav"]');
    if (!overlay) return;
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    trigger?.setAttribute("aria-expanded", "false");
    window.setTimeout(() => {
      if (!overlay.classList.contains("is-open")) overlay.setAttribute("hidden", "");
    }, 460);
  };

  const playAscensionIntro = (nextRoute = "/features") => {
    const intro = root.querySelector("#ascension-intro");
    if (!intro || !motionEnabled) {
      navigate(nextRoute, nextRoute === "/features" ? openFeatureNav : undefined);
      return;
    }
    window.clearTimeout(ascensionTimer);
    intro.removeAttribute("hidden");
    intro.setAttribute("aria-hidden", "false");
    void intro.offsetWidth;
    intro.classList.add("is-playing");
    ascensionTimer = window.setTimeout(() => {
      intro.classList.add("is-complete");
      window.setTimeout(() => navigate(nextRoute, nextRoute === "/features" ? openFeatureNav : undefined), 520);
    }, 3200);
  };

  function bindEvents() {
    root.querySelectorAll("[data-route]").forEach((element) => element.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (element.closest("#feature-nav-overlay")) closeFeatureNav();
      navigate(element.dataset.route);
    }));
    root.querySelectorAll('[data-action="toggle-feature-nav"]').forEach((element) => element.addEventListener("click", () => {
      const overlay = root.querySelector("#feature-nav-overlay");
      if (!overlay) return;
      const open = !overlay.classList.contains("is-open");
      if (!open) {
        closeFeatureNav();
        return;
      }
      openFeatureNav();
    }));
    root.querySelectorAll('[data-action="close-feature-nav"]').forEach((element) => element.addEventListener("click", closeFeatureNav));
    root.querySelectorAll('[data-action="toggle-menu"]').forEach((element) => element.addEventListener("click", () => {
      const panel = root.querySelector("#mobile-nav-panel");
      const open = panel?.hasAttribute("hidden");
      if (!panel) return;
      if (open) panel.removeAttribute("hidden"); else panel.setAttribute("hidden", "");
      root.querySelectorAll('[data-action="toggle-menu"]').forEach((button) => button.setAttribute("aria-expanded", String(open)));
    }));
    root.querySelectorAll('[data-action="toggle-dial"]').forEach((element) => element.addEventListener("click", () => {
      const rail = root.querySelector(".nav-rail");
      const open = !rail?.classList.contains("is-dial-open");
      if (!rail) return;
      rail.classList.toggle("is-dial-open", open);
      element.setAttribute("aria-expanded", String(open));
      element.setAttribute("title", open ? "收起八方导航" : "展开八方导航");
    }));
    root.querySelectorAll('[data-action="toggle-motion"]').forEach((element) => element.addEventListener("click", () => {
      motionEnabled = !motionEnabled;
      root.querySelector(".app-shell")?.setAttribute("data-motion", motionEnabled ? "on" : "off");
      root.querySelectorAll('[data-action="toggle-motion"]').forEach((button) => button.setAttribute("aria-pressed", String(motionEnabled)));
      root.querySelectorAll(".toggle").forEach((toggle) => toggle.classList.toggle("is-on", motionEnabled));
      toast(motionEnabled ? "云雾动效已开启" : "已切换为静谧模式");
    }));
    root.querySelectorAll("[data-goal]").forEach((element) => element.addEventListener("click", () => {
      selectedGoal = element.dataset.goal;
      DEMO_STATE.goals.forEach((goal) => { goal.selected = goal.id === selectedGoal; });
      root.querySelectorAll("[data-goal]").forEach((goal) => {
        const selected = goal.dataset.goal === selectedGoal;
        goal.classList.toggle("is-selected", selected);
        goal.setAttribute("aria-pressed", String(selected));
      });
      toast("方向已记录在你的山门印中");
    }));
    root.querySelectorAll('[data-action="bagua-node"]').forEach((element) => element.addEventListener("click", () => {
      const active = element.dataset.bagua;
      root.querySelectorAll('[data-action="bagua-node"]').forEach((node) => {
        const selected = node.dataset.bagua === active;
        node.classList.toggle("is-active", selected);
        node.setAttribute("aria-pressed", String(selected));
      });
      toast(`${active}位已点亮，今日行旅将沿此方向展开`);
    }));
    root.querySelectorAll('[data-action="complete-onboarding"]').forEach((element) => element.addEventListener("click", (event) => {
      event.preventDefault();
      playAscensionIntro(element.getAttribute("href") || "/features");
    }));
    root.querySelectorAll('[data-action="answer"]').forEach((element) => element.addEventListener("click", () => {
      root.querySelectorAll('[data-action="answer"]').forEach((answer) => answer.classList.remove("is-selected"));
      element.classList.add("is-selected");
      DEMO_STATE.pilot.selectedAnswer = element.textContent.trim();
    }));
    root.querySelectorAll('[data-action="submit-answer"]').forEach((element) => element.addEventListener("click", () => toast("这一阶已记下，正在等待服务端确认")));
    root.querySelectorAll('[data-action="select-evidence"]').forEach((element) => element.addEventListener("click", () => {
      const level = Number(element.dataset.evidenceLevel);
      DEMO_STATE.pilot.selectedEvidenceLevel = level;
      root.querySelectorAll('[data-action="select-evidence"]').forEach((item) => {
        const selected = Number(item.dataset.evidenceLevel) === level;
        item.classList.toggle("is-selected", selected);
        item.setAttribute("aria-pressed", String(selected));
      });
      const label = root.querySelector(".evidence-submit__level");
      if (label) label.textContent = `当前 L${level}`;
    }));
    root.querySelectorAll('[data-action="submit-evidence"]').forEach((element) => element.addEventListener("click", async () => {
      const input = root.querySelector("[data-evidence-input]");
      const evidence = input?.value.trim() ?? "";
      if (!evidence) {
        toast("请先写一句你实际留下的证据");
        input?.focus();
        return;
      }
      DEMO_STATE.pilot.submittedEvidence = evidence;
      element.disabled = true;
      try {
        const activeTask = DEMO_STATE.today.tasks.find((task) => task.status === "active");
        const result = await requestAi("/api/v1/ai/review", {
          task: activeTask?.title || "当前学习任务",
          answer: DEMO_STATE.pilot.selectedAnswer,
          evidence_level: DEMO_STATE.pilot.selectedEvidenceLevel,
          evidence,
        });
        DEMO_STATE.pilot.review = result.review;
        DEMO_STATE.pilot.reviewReady = true;
        DEMO_STATE.pilot.reviewError = "";
        if (activeTask) {
          activeTask.status = "done";
          const nextTask = DEMO_STATE.today.tasks.find((task) => task.status === "locked");
          if (nextTask) nextTask.status = "active";
          DEMO_STATE.today.completed = Math.min(DEMO_STATE.today.completed + 1, DEMO_STATE.today.total);
        }
        if (activeTask) {
          const knowledge = DEMO_STATE.knowledge.find((item) => activeTask.title.includes(item.title));
          if (knowledge) {
            knowledge.evidenceLevel = DEMO_STATE.pilot.selectedEvidenceLevel;
            knowledge.updated = "刚刚";
          }
        }
        navigate("/review");
      } catch (error) {
        DEMO_STATE.pilot.reviewReady = false;
        DEMO_STATE.pilot.reviewError = error.message;
        navigate("/review");
        toast("证据已留在本地，AI 复盘暂未完成");
      } finally {
        element.disabled = false;
      }
    }));
    root.querySelectorAll('[data-action="capture-knowledge"]').forEach((element) => element.addEventListener("click", () => {
      DEMO_STATE.knowledgeCaptureDraft = {
        title: element.dataset.knowledgeTitle ?? "",
        source: element.dataset.knowledgeSource ?? "攀登 · 当前山段",
        strand: "当前学习",
      };
      DEMO_STATE.knowledgeComposerOpen = true;
      navigate("/knowledge");
    }));
    root.querySelectorAll('[data-action="ask-guide"]').forEach((element) => element.addEventListener("click", () => {
      const input = root.querySelector(".assistant-composer input");
      if (input) { input.value = element.textContent; input.focus(); }
    }));
    root.querySelectorAll('[data-action="select-guide"]').forEach((element) => element.addEventListener("click", () => {
      DEMO_STATE.guide.selectedAssetId = element.dataset.guide;
      render(window.location.pathname);
      toast("引路灵器已换为你的选择");
    }));
    root.querySelectorAll('[data-action="select-knowledge"]').forEach((element) => element.addEventListener("click", () => {
      DEMO_STATE.activeKnowledgeId = element.dataset.knowledgeId;
      render(window.location.pathname);
    }));
    root.querySelectorAll('[data-action="open-knowledge-composer"]').forEach((element) => element.addEventListener("click", () => {
      DEMO_STATE.knowledgeCaptureDraft = null;
      DEMO_STATE.knowledgeComposerOpen = true;
      render(window.location.pathname);
    }));
    root.querySelectorAll('[data-action="close-knowledge-composer"]').forEach((element) => element.addEventListener("click", () => {
      DEMO_STATE.knowledgeComposerOpen = false;
      DEMO_STATE.knowledgeCaptureDraft = null;
      render(window.location.pathname);
    }));
    root.querySelectorAll("[data-knowledge-search]").forEach((input) => input.addEventListener("input", () => {
      const query = input.value.trim().toLowerCase();
      root.querySelectorAll("[data-knowledge-item]").forEach((item) => {
        item.hidden = Boolean(query) && !item.textContent.toLowerCase().includes(query);
      });
    }));
    root.querySelectorAll("form[data-demo-form]").forEach((form) => form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (form.dataset.demoForm === "knowledge-capture") {
        const values = new FormData(form);
        const title = String(values.get("title") ?? "").trim();
        if (!title) return;
        const strand = String(values.get("strand") ?? "新知识").trim() || "新知识";
        const source = String(values.get("source") ?? "手动收录").trim() || "手动收录";
        const note = String(values.get("note") ?? "").trim() || "这是一条刚刚进入个人知识库的新节点。";
        const relatedId = String(values.get("relatedId") ?? "");
        const position = ["east", "west"].find((candidate) => !DEMO_STATE.knowledge.some((item) => item.position === candidate)) ?? "east";
        const id = `knowledge-${Date.now()}`;
        DEMO_STATE.knowledge.unshift({ id, title, domain: `${strand} · 新节点`, strand, mastery: 12, state: "初探", gua: "新", color: "gold", source, updated: "刚刚", summary: note, note, relatedIds: relatedId ? [relatedId] : [], position });
        if (relatedId) {
          const related = DEMO_STATE.knowledge.find((item) => item.id === relatedId);
          if (related) related.relatedIds = [...new Set([...(related.relatedIds ?? []), id])];
        }
        DEMO_STATE.activeKnowledgeId = id;
        DEMO_STATE.knowledgeComposerOpen = false;
        DEMO_STATE.knowledgeCaptureDraft = null;
        render("/knowledge");
        toast("新知识已接入你的脉络");
        return;
      }
      if (form.dataset.demoForm === "assistant") {
        const values = new FormData(form);
        const prompt = String(values.get("prompt") || "").trim();
        if (!prompt) return;
        const submit = form.querySelector("button[type=submit]");
        if (submit) submit.disabled = true;
        try {
          const activeTask = DEMO_STATE.today.tasks.find((task) => task.status === "active");
          const result = await requestAi("/api/v1/ai/assist", {
            prompt,
            context: {
              goal: DEMO_STATE.goals.find((goal) => goal.selected)?.title || "未选择目标",
              task: activeTask?.title || "当前没有进行中的任务",
              evidence_level: DEMO_STATE.pilot.selectedEvidenceLevel,
            },
          });
          DEMO_STATE.pilot.assistantResponse = result.answer;
          DEMO_STATE.pilot.assistantError = "";
        } catch (error) {
          DEMO_STATE.pilot.assistantError = error.message;
        } finally {
          render(window.location.pathname);
        }
        return;
      }
      toast("演示身份已准备好，下一步请选择登山方向");
    }));
  }

  const updateParallax = () => {
    scrollFrame = 0;
    root.style.setProperty("--scroll-shift", motionEnabled ? `${Math.min(window.scrollY, 700) * 0.12}px` : "0px");
    root.style.setProperty("--scroll-ratio", motionEnabled ? `${Math.min(window.scrollY / Math.max(window.innerHeight, 1), 1)}` : "0");
  };

  const updatePointer = (event) => {
    if (!motionEnabled || window.matchMedia?.("(pointer: coarse)").matches) return;
    const x = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2;
    const y = (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2;
    root.style.setProperty("--pointer-x", `${x.toFixed(3)}`);
    root.style.setProperty("--pointer-y", `${y.toFixed(3)}`);
  };

  window.addEventListener("scroll", () => {
    if (scrollFrame) return;
    scrollFrame = window.requestAnimationFrame(updateParallax);
  }, { passive: true });
  window.addEventListener("pointermove", updatePointer, { passive: true });

  window.addEventListener("popstate", () => render());
  render();
  return { navigate, render, state: DEMO_STATE };
}
