import { FEATURE_ITEMS, ROUTES, getRouteMeta } from "../data/routes.js";
import { assetUrl, getAsset } from "../data/assets.js";
import { icon, mark } from "../components/icons.js";
import { renderWorldMarker } from "../components/world-stage.js";
import { renderBaguaField } from "../components/bagua-field.js";

const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function selectedGoalFor(state) {
  return state.goals.find((goal) => goal.selected) ?? state.goals[0];
}

function goalTypeFor(goal) {
  return ["goal-cet4", "goal-cet6"].includes(goal?.id) ? "college_english_exam" : "postgraduate_entrance_exam";
}

function isCetGoal(state) {
  return ["goal-cet4", "goal-cet6"].includes(selectedGoalFor(state)?.id);
}

function currentLearningRoute(state) {
  const draft = state.learningRoute?.draft ?? null;
  const goal = selectedGoalFor(state);
  if (!draft || !goal || draft.goal?.type !== goalTypeFor(goal)) return null;
  if (goal.id === "goal-cet4" && !/四级|CET-4/i.test(draft.goal?.name ?? "")) return null;
  if (goal.id === "goal-cet6" && !/六级|CET-6/i.test(draft.goal?.name ?? "")) return null;
  return draft;
}

function action(label, href, className = "button button--primary", iconName = "arrow") {
  return `<a class="${className}" href="${href}" data-route="${href}">${label}${iconName ? icon(iconName) : ""}</a>`;
}

function intro(route, state, kicker = "") {
  const meta = getRouteMeta(route);
  return `<div class="page-intro"><span class="page-intro__kicker">${kicker || meta.eyebrow}</span><span class="page-intro__gua">${meta.gua}</span><h1>${meta.title}</h1><p>${meta.description}</p></div>`;
}

function sectionTitle(eyebrow, title, actionHtml = "") {
  return `<div class="section-title"><div><span>${eyebrow}</span><h2>${title}</h2></div>${actionHtml}</div>`;
}

function demoNote(state) {
  return state?.isDemo ? `<span class="demo-state" aria-label="演示数据">演示数据</span>` : "";
}

function persistenceNotice(state) {
  const service = state?.service ?? {};
  const notice = service.persistenceNotice || state?.companionCycle?.syncError;
  const thinkingNotice = state?.pilot?.materialPending
    ? `<div class="companion-thinking" role="status" aria-live="polite"><span class="companion-thinking__spinner" aria-hidden="true"></span><div><strong>AI 引路正在思考</strong><span>正在阅读你提交的材料并整理下一步行动，请稍候。</span></div></div>`
    : "";
  const persistence = service.persistence === "durable" && service.api === "up" && !notice
    ? ""
    : state?.isDemo
      ? ""
      : `<div class="persistence-notice" role="status"><strong>数据保存状态需要确认</strong><span>${esc(notice || "数据服务暂时未恢复，新的学习记录不会被当作已保存。请稍后重试。")}</span></div>`;
  return `${persistence}${thinkingNotice}`;
}

function progressBar(value, tone = "amber") {
  return `<div class="progress-line progress-line--${tone}" aria-label="完成度 ${value}%"><span style="--value:${value}%"></span></div>`;
}

function metaLine(label, value) {
  return `<div class="meta-line"><span>${label}</span><strong>${value}</strong></div>`;
}

function taskItem(task, index) {
  const statusText = { done: "已抵达", active: "现在出发", locked: "云后显现" }[task.status];
  const tag = task.status === "active" ? "a" : "article";
  const link = task.status === "active" ? ` href="/study" data-route="/study" aria-label="开始${esc(task.title)}"` : "";
  return `<${tag} class="task-row task-row--${esc(task.status)}" data-task-id="${esc(task.id)}"${link}><div class="task-row__step">${String(index + 1).padStart(2, "0")}<span></span></div><div class="task-row__gua">${esc(task.gua)}</div><div class="task-row__body"><span class="task-row__type">${esc(task.type)}</span><h3>${esc(task.title)}</h3><p>${esc(task.meta)}</p></div><div class="task-row__state">${task.status === "done" ? icon("check", "已完成") : task.status === "locked" ? icon("lock", "未解锁") : icon("play", "开始") }<span>${statusText}</span></div></${tag}>`;
}

function pageHome(state) {
  if (!state.isDemo) return pageStudyWithDiagnostic(state);
  const sceneAsset = getAsset("lijing-horizon-ink-v1");
  const routeReady = state.learningRoute?.draft?.status === "confirmed" || state.today.tasks.length > 0;
  const primaryHref = routeReady ? "/plan" : "/route";
  const primaryLabel = routeReady ? "开始今天" : "继续建立路线";
  return `<div class="page page--home" data-demo-state="${state.isDemo}">
    <section class="home-hero">
      <div class="home-hero__copy">${demoNote(state)}<span class="page-intro__kicker">第零章 · 山门 / ${state.mountain.weather}</span><h1>向山顶<br><em>而行</em></h1><p>${routeReady ? "山顶很远，但今天只需要接住下一处营地。" : "先把目标、时间和现实约束放进路线里，砺境才知道今天该带你走哪一步。"}</p><div class="home-hero__actions">${action(primaryLabel, primaryHref)}<a class="text-link" href="/map" data-route="/map">遥望整座山系 ${icon("arrow")}</a></div></div>
      <div class="home-hero__summit"><div class="summit-mark">${renderWorldMarker()}<span>主峰</span><strong>${state.mountain.summitHeight.toLocaleString("zh-CN")}m</strong></div><span class="summit-mark__caption">你在 ${state.mountain.currentHeight.toLocaleString("zh-CN")}m 处<br>云隙中已经看见了下一处营地</span></div>
      <div class="home-hero__image" style="--image:url('${sceneAsset.path}')"><span>向上学习<br><b>每一步都算数</b></span></div>
    </section>
    <section class="home-overview" data-tour-target="daily-panel"><div class="home-overview__lead"><span class="section-kicker">${routeReady ? `今天 · ${state.today.completed}/${state.today.total} 项` : "下一步 · 建立第一条路线"}</span><h2>${routeReady ? "今天不必走完全程，<br><em>只要走好下一步。</em>" : "先把远方算清楚，<br><em>今天才有得走。</em>"}</h2><p>${routeReady ? `连续 ${state.today.streak} 日，你已经把坚持变成了山路的一部分。` : "你的入山信息已经保存。补充截止日期、当前基础和现实约束后，砺境会生成可核验的长期、年度、月度和每日计划。"}</p>${action(routeReady ? "进入当前学习" : "补充路线条件", routeReady ? "/study" : "/route", "button button--ink")}</div><div class="home-overview__stats">${metaLine("有效学习", `${state.today.minutes} 分钟`)}${metaLine("当前营地", state.mountain.nextCamp)}${metaLine("专注状态", `${state.balance.focus}%`)}<div class="home-overview__seal">${mark("☯")} <span>阴阳<br>有衡</span></div></div></section>
    <section class="home-route" data-tour-target="today-route"><div class="home-route__intro">${sectionTitle(routeReady ? "脚下的路" : "路线准备", routeReady ? "今天" : "还差最后一段输入", action(routeReady ? "查看完整计划" : "继续建立路线", routeReady ? "/plan" : "/route", "text-link", "arrow"))}<p>${routeReady ? "完成一件具体的小事，山路就会向上延伸。" : "系统不会拿示例计划冒充你的结果；你确认路线后，今天的任务才会出现。"}</p></div>${routeReady ? `<div class="task-list">${state.today.tasks.slice(0, 3).map(taskItem).join("")}</div>` : `<div class="home-route__empty"><strong>目标和节律已经带入</strong><span>下一页只需要补充截止日期、当前基础和现实约束。</span>${action("开始补充路线", "/route", "button button--primary")}</div>`}</section>
    <section class="home-bottom"><div class="quote-panel"><span class="quote-panel__eyebrow">行者箴言 · 07</span><span class="quote-panel__seal">「</span><blockquote>不要因为山高而忘记<br>脚下这一阶。</blockquote><span class="quote-panel__author">砺境 · 行者箴言</span></div><div class="home-next"><span class="home-next__stamp">云后 / 章节生成中</span><span class="section-kicker">云后 · 下一阶段</span><h2>人生副本<br><em>正在远处生成</em></h2><p>当你登上这一座峰，回望来路，新的山系会在云海尽头开启。</p>${action("查看路线图", "/map", "button button--outline")}</div></section>
  </div>`;
}

function pageFeatures(state) {
  return `<div class="page page--features" data-demo-state="true">${intro("/features", state)}<section class="feature-directory"><div class="feature-directory__note"><span class="section-kicker">功能目录</span><h2>从一个方向<br><em>进入你的山路。</em></h2><p>八个方位对应八种行动。先选此刻需要的方向，之后仍然可以随时回到这里。</p></div>${renderBaguaField({ active: "", label: "功能目录", directoryItems: FEATURE_ITEMS })}</section></div>`;
}

function pageAuth(state) {
  const mode = state.auth?.mode === "register" ? "register" : "login";
  const registering = mode === "register";
  const invitationRequired = state.registrationPolicy?.invitationRequired === true;
  const persistence = state.service?.persistence;
  const serviceApi = state.service?.api;
  const accountPromise = persistence === "durable" && serviceApi === "up"
    ? "账号会保存你的学习目标和计划，可跨重启恢复。"
    : persistence === "ephemeral"
      ? "当前试点为临时会话：服务重启后学习记录不会保留，请勿用于关键进度。"
      : serviceApi === "degraded" || serviceApi === "down"
        ? "账号保存服务暂时不可用，注册已暂停，请稍后重试。"
      : "正在核验数据保存方式；确认前请勿把当前账号当作跨设备存储。";
  const emailNotice = registering
    ? "当前试点只校验邮箱格式，不会发送验证邮件；请使用你能长期访问的地址。"
    : "登录后可在设置页查看邮箱状态；当前试点尚未接入邮件验证。";
  if (registering && invitationRequired) {
    return `<div class="page page--auth" data-demo-state="false" style="--auth-image: url('${assetUrl("lijing-auth-gate-v1")}')">
      <div class="auth-backdrop" aria-hidden="true"></div><div class="auth-wrap"><div class="auth-visual"><span class="auth-visual__seal">☷</span><span class="page-intro__kicker">入山 · 账号</span><h1>先为自己<br><em>立一座山门</em></h1><p class="auth-visual__value">砺境帮助你制定目标、生成学习计划，并用学习证据生成下一步。</p><div class="auth-visual__line"></div><span>砺境 · 云海登山系统</span></div>
      <div class="paper-panel auth-panel"><div class="panel-heading"><span class="section-kicker">限量试点登记</span><h2>立下山门</h2><p>本轮为限量邀请码试点。${accountPromise}</p></div><div class="auth-tabs" role="tablist" aria-label="账号操作"><button type="button" data-action="auth-mode" data-auth-mode="login" aria-selected="false">登录</button><button type="button" data-action="auth-mode" data-auth-mode="register" aria-selected="true">注册</button></div>
      <form class="auth-form" data-demo-form="auth" data-auth-mode="register"><p class="auth-error" data-auth-error role="alert" aria-live="assertive" hidden></p><label>邮箱<input name="email" type="email" placeholder="you@example.com" autocomplete="email" required></label><label>昵称<input name="display_name" type="text" placeholder="例如：林默" autocomplete="nickname" maxlength="80"></label><label>试点邀请码<input name="invite_code" type="text" autocomplete="off" minlength="12" maxlength="128" required></label><label>密码<input name="password" type="password" placeholder="至少 8 个字符" autocomplete="new-password" minlength="8" maxlength="128" required></label><button class="button button--primary" type="submit">创建账号 ${icon("arrow")}</button></form><p class="form-footnote">邀请码只能使用一次。请使用你能长期访问的邮箱；当前试点不会发送验证邮件。</p><button class="auth-recovery-link" type="button" disabled aria-disabled="true">忘记密码（暂未开放）</button><p class="form-footnote">当前为公开测试版；${accountPromise}</p><nav class="auth-legal-links" aria-label="公开说明"><a href="/privacy" data-route="/privacy">隐私说明</a><a href="/terms" data-route="/terms">用户协议</a><a href="/contact" data-route="/contact">联系方式</a></nav></div></div></div>`;
  }
  return `<div class="page page--auth" data-demo-state="false" style="--auth-image: url('${assetUrl("lijing-auth-gate-v1")}')"><div class="auth-backdrop" aria-hidden="true"></div><div class="auth-wrap"><div class="auth-visual"><span class="auth-visual__seal">☷</span><span class="page-intro__kicker">入山 · 账号</span><h1>先为自己<br><em>立一座山门</em></h1><p class="auth-visual__value">砺境帮助你制定目标、生成学习计划，并用学习证据生成下一步。</p><div class="auth-visual__line"></div><span>砺境 · 云海登山系统</span></div><div class="paper-panel auth-panel"><div class="panel-heading"><span class="section-kicker">${registering ? "新行者登记" : "行者登录"}</span><h2>${registering ? "立下山门" : "欢迎回来"}</h2><p>${registering ? `公开测试版，注册后即可开始；${accountPromise}` : `登录后继续你的目标、学习计划和学习证据。${persistence === "ephemeral" ? " 当前会话在服务重启后不会保留。" : ""}`}</p></div><div class="auth-tabs" role="tablist" aria-label="账号操作"><button type="button" data-action="auth-mode" data-auth-mode="login" aria-selected="${!registering}">登录</button><button type="button" data-action="auth-mode" data-auth-mode="register" aria-selected="${registering}">注册</button></div><form class="auth-form" data-demo-form="auth" data-auth-mode="${mode}"><p class="auth-error" data-auth-error role="alert" aria-live="assertive" hidden></p><label>邮箱<input name="email" type="email" placeholder="you@example.com" autocomplete="email" required></label>${registering ? `<label>昵称<input name="display_name" type="text" placeholder="例如：林默" autocomplete="nickname" maxlength="80"></label>` : ""}<label>密码<input name="password" type="password" placeholder="至少 8 个字符" autocomplete="${registering ? "new-password" : "current-password"}" minlength="8" maxlength="128" required></label><button class="button button--primary" type="submit">${registering ? "创建账号" : "登录并继续"} ${icon("arrow")}</button></form><p class="form-footnote">${emailNotice}</p><button class="auth-recovery-link" type="button" disabled aria-disabled="true">忘记密码（暂未开放）</button><p class="form-footnote">当前为公开测试版；${accountPromise}</p><nav class="auth-legal-links" aria-label="公开说明"><a href="/privacy" data-route="/privacy">隐私说明</a><a href="/terms" data-route="/terms">用户协议</a><a href="/contact" data-route="/contact">联系方式</a></nav></div></div></div>`;
}

function onboardingProfileStep(state) {
  const onboarding = state.onboarding ?? {};
  const profile = onboarding.profile ?? state.user;
  const selectedGoal = state.goals.find((goal) => goal.id === profile.target) ?? state.goals.find((goal) => goal.selected) ?? state.goals[0];
  const dailyMinutes = Number(profile.dailyMinutes ?? 25) || 25;
  return `<section class="onboarding-panel onboarding-profile-step"><div class="onboarding-panel__heading"><span class="section-kicker">入山引导 · 15 秒</span><h2>先定今天的<br><em>可用时间。</em></h2><p>只用两项信息，下一页就生成今天的第一条路线。</p></div><form class="onboarding-form onboarding-form--minimal" data-demo-form="onboarding-profile"><input type="hidden" name="goal" data-onboarding-goal value="${selectedGoal?.id ?? "goal-exam"}"><section class="onboarding-choice"><span class="onboarding-form__label">当前方向</span><div class="goal-option is-selected" data-onboarding-selected-goal aria-label="当前目标：${esc(selectedGoal?.title ?? "考研备考")}"><span class="goal-option__icon" data-onboarding-selected-icon>${esc(selectedGoal?.icon ?? "峰")}</span><span><strong data-onboarding-selected-title>${esc(selectedGoal?.title ?? "考研备考")}</strong><small data-onboarding-selected-detail>${esc(selectedGoal?.detail ?? "首期试点：把备考变成每天可执行的一步")}</small></span><i>${icon("check", "已选择")}</i></div></section><section class="onboarding-time"><div><span class="onboarding-form__label">每天能留出的时间</span><strong><output data-onboarding-minutes-output>${dailyMinutes}</output> 分钟</strong></div><input data-onboarding-minutes name="dailyMinutes" type="range" min="10" max="120" step="5" value="${dailyMinutes}"><div class="onboarding-time__scale"><span>10 分钟</span><span>2 小时</span></div></section><div class="onboarding-form__footer"><span>其他资料可在「我的」中随时补充。</span><button class="button button--primary" type="submit">生成今天这一步 ${icon("arrow")}</button></div></form></section>`;
}

function onboardingGoalPicker(state) {
  return `<section class="onboarding-goals"><span class="onboarding-form__label">先选一个当前目标</span><div class="onboarding-goals__choices">${state.goals.filter((goal) => ["goal-exam", "goal-cet4", "goal-cet6"].includes(goal.id)).map((goal) => `<button class="onboarding-goal ${goal.selected ? "is-selected" : ""}" type="button" data-goal="${esc(goal.id)}" aria-pressed="${goal.selected}"><span>${esc(goal.icon)}</span><strong>${esc(goal.title)}</strong><small>${esc(goal.detail)}</small></button>`).join("")}</div></section>`;
}

function pageOnboarding(state) {
  return `<div class="page page--onboarding" data-demo-state="${state.isDemo}"><div class="onboarding-head"><div><span class="page-intro__kicker">入山引导 · 两步</span><h1>一分钟内拿到<br><em>今天这一件事。</em></h1></div><div class="onboarding-head__aside">${demoNote(state)}<span class="onboarding-nav-note">目标 + 时间 · 可随时修改</span></div></div>${onboardingGoalPicker(state)}${onboardingProfileStep(state)}</div>`;
}

function pageGoals(state) {
  const selectedGoal = selectedGoalFor(state);
  const cet = ["goal-cet4", "goal-cet6"].includes(selectedGoal?.id);
  return `<div class="page page--goals" data-demo-state="${state.isDemo}">${intro("/goals", state, "第一章 · 我的目标")}<div class="goals-layout"><section class="goal-selection"><div class="section-title"><div><span>当前开放：考研与大学英语四六级</span><h2>先选一个目标，<br><em>把下一步安排清楚。</em></h2></div>${demoNote(state)}</div><div class="goal-options">${state.goals.map((goal) => `<button class="goal-option ${goal.selected ? "is-selected" : ""}" type="button" ${goal.available === false ? "disabled aria-disabled=\"true\"" : `data-goal="${esc(goal.id)}" aria-pressed="${goal.selected}"`}><span class="goal-option__icon">${esc(goal.icon)}</span><span><strong>${esc(goal.title)}</strong><small>${esc(goal.detail)}</small></span><i>${goal.available === false ? "开发中" : goal.selected ? icon("check", "已选择") : icon("arrow", "选择")}</i></button>`).join("")}</div><div class="goal-foot"><a class="button button--primary" href="/route" data-action="complete-onboarding">建立当前目标路线 ${icon("arrow")}</a><span>目标可随时切换，路线需要按新目标重新确认。</span></div></section><aside class="orientation-panel"><span class="section-kicker">${esc(selectedGoal?.title ?? "当前目标")}</span><h3>${cet ? "今天先完成一项\n英语练习" : "先把备考落在\n可行的时间里"}</h3><p>${cet ? "听力、阅读、写作和翻译按真实练习证据逐步校准。" : "先核算可用时间，再给出今天能执行的一步。"}</p></aside></div></div>`;
}

const ANNOUNCED_POSTGRADUATE_EXAM_DATES = ["2026-12-20"];

export function defaultRouteTargetDate(goalType, now = new Date()) {
  const today = dateInputValue(now);
  const announcedDate = goalType === "postgraduate_entrance_exam"
    ? ANNOUNCED_POSTGRADUATE_EXAM_DATES.find((date) => date >= today)
    : null;
  if (announcedDate) return announcedDate;
  const date = new Date(now);
  date.setMonth(date.getMonth() + 6);
  return dateInputValue(date);
}

function dateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function minimumRouteTargetDate() {
  const date = new Date();
  date.setDate(date.getDate() + 6);
  return dateInputValue(date);
}

const ROUTE_ASSESSMENT_LABELS = {
  study_stage: {
    not_started: "尚未系统开始",
    reviewed_once: "学过一遍但不稳定",
    practiced: "已经做过独立练习",
  },
  recent_result: {
    no_recent_practice: "没有独立练习记录",
    below_40: "最近独立练习低于四成",
    between_40_69: "最近独立练习约四到七成",
    above_70: "最近独立练习七成以上",
  },
  primary_blocker: {
    scope: "不知道该从哪里开始",
    concept: "概念和条件混淆",
    application: "看懂但不会独立做",
    speed: "会做但速度太慢",
    consistency: "难以稳定开始",
  },
};

function routeAssessmentSummary(assessment) {
  if (!assessment) return "";
  const stage = ROUTE_ASSESSMENT_LABELS.study_stage[assessment.study_stage] ?? "未标记";
  const result = ROUTE_ASSESSMENT_LABELS.recent_result[assessment.recent_result] ?? "未标记";
  const blocker = ROUTE_ASSESSMENT_LABELS.primary_blocker[assessment.primary_blocker] ?? "未标记";
  return `<section class="route-assessment-summary"><div><span class="section-kicker">起点信息 · 学习者自述</span><h3>${esc(assessment.subject)}</h3><p>仅用于调整学习安排；无需先答诊断题，也不作为平台验证的掌握结论。</p></div><dl><div><dt>学习阶段</dt><dd>${esc(stage)}</dd></div><div><dt>自述练习情况</dt><dd>${esc(result)}</dd></div><div><dt>主要卡点</dt><dd>${esc(blocker)}</dd></div></dl><blockquote>${esc(assessment.evidence)}</blockquote></section>`;
}

function routeAdjustmentForm(draft, state) {
  const goal = draft?.goal ?? {};
  const savedForm = state.learningRoute?.form ?? {};
  const minimumDate = minimumRouteTargetDate();
  const goalType = goal.type ?? goalTypeFor(selectedGoalFor(state));
  const requestedDate = savedForm.target_date ?? goal.target_date ?? defaultRouteTargetDate(goalType);
  const targetDate = requestedDate < minimumDate ? minimumDate : requestedDate;
  const weeklyHours = Math.min(60, Math.max(1, Number(savedForm.weekly_hours ?? goal.weekly_hours ?? state.user.weeklyHours ?? 8) || 8));
  const quotaNotice = generationQuotaNotice(state);
  const quota = state.learningRoute?.generationQuota;
  const quotaLoading = state.learningRoute?.generationQuotaStatus === "loading";
  const quotaExhausted = state.learningRoute?.generationQuotaStatus === "synced" && Number.isInteger(quota?.remaining) && quota.remaining <= 0;
  const error = state.learningRoute?.error
    ? `<p class="route-adjustment__error" role="alert">${esc(state.learningRoute.error)}</p>`
    : "";
  return `<section class="route-adjustment-panel"><div class="route-adjustment-panel__heading"><span class="section-kicker">路线约束</span><h3>条件变了，路线就重新算。</h3><p>只改截止日期或每周时间，确认前的旧路线仍会保留。</p></div>${error}<form class="route-form route-form--adjustment" data-demo-form="learning-route-adjustment">${quotaNotice}<label>目标日期<input name="target_date" type="date" min="${minimumDate}" value="${esc(targetDate)}" required></label><label class="route-hours">每周可投入 <strong><output data-route-hours-output>${weeklyHours}</output> 小时</strong><input data-route-hours name="weekly_hours" type="range" min="1" max="60" step="1" value="${weeklyHours}"><span><small>1 小时</small><small>60 小时</small></span></label><button class="button button--ink" type="submit" ${(quotaExhausted || quotaLoading) ? "disabled aria-disabled=\"true\"" : ""}>${quotaLoading ? "正在读取今日额度…" : "重新计算路线"} ${icon("refresh")}</button><a class="text-link" href="/goals" data-route="/goals">调整目标方向 ${icon("arrow")}</a></form></section>`;
}

function generationQuotaNotice(state) {
  if (state.isDemo) return "";
  const quota = state.learningRoute?.generationQuota;
  if (state.learningRoute?.generationQuotaStatus === "loading") {
    return `<p class="route-generation-quota" role="status" aria-live="polite">正在读取今日路线生成额度…</p>`;
  }
  if (state.learningRoute?.generationQuotaStatus === "error") {
    return `<p class="route-generation-quota" role="status">今日额度暂时无法读取；提交前仍会由服务端核验。</p>`;
  }
  if (!Number.isInteger(quota?.remaining) || !Number.isInteger(quota?.limit)) return "";
  const used = Number.isInteger(quota.used) ? quota.used : Math.max(0, quota.limit - quota.remaining);
  const resetAt = quota.resets_at ? new Date(quota.resets_at) : null;
  const resetLabel = resetAt && !Number.isNaN(resetAt.getTime())
    ? ` · 按本地时间 ${new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(resetAt)} 刷新`
    : "";
  const exhausted = quota.remaining <= 0 ? " · 刷新前无法生成新路线" : "";
  return `<p class="route-generation-quota" role="status">今日 AI 路线生成：已用 ${used}/${quota.limit} 次，剩余 ${Math.max(0, quota.remaining)} 次${resetLabel}${exhausted}。</p>`;
}

function learningRouteResult(draft, clarification, error) {
  if (!draft && clarification) {
    return `<section class="route-empty route-empty--clarification"><span class="section-kicker">还需要一点上下文</span><h2>先把目标说具体，<br><em>再让 AI 排路线。</em></h2><p>${esc(clarification.message || "当前信息不足，继续生成会让系统替你猜。")}</p><ul>${(clarification.questions ?? []).map((question) => `<li>${esc(question)}</li>`).join("")}</ul><small>补充后再次提交，原有表单内容会保留。</small></section>`;
  }
  if (!draft) return `<section class="route-empty">${error ? `<div class="route-error" role="alert"><strong>${esc(error)}</strong><small>你刚才填写的目标和时间已经保留，不需要重新填写。</small><button class="button button--outline" type="button" data-action="retry-learning-route">重新生成路线 ${icon("refresh")}</button></div>` : ""}<span class="section-kicker">尚未生成路线</span><h2>先留下你的真实条件。</h2><p>系统只会在服务端 AI 返回通过结构校验的草案后展示路线，不会拿示例计划冒充你的结果。</p></section>`;
  const feasibilityText = { feasible: "可确认", tight: "时间过紧", needs_adjustment: "需要调整" }[draft.feasibility.status] ?? "待核算";
  const canConfirm = draft.status === "draft" && ["feasible", "tight"].includes(draft.feasibility.status);
  const evidence = draft.knowledge_evidence ?? [];
  const plan = draft.plan;
  const assessment = routeAssessmentSummary(draft.goal?.baseline_assessment);
  const currentMonth = plan?.current_year?.months?.find((month) => month.month === plan.today?.date?.slice(0, 7));
  const firstTask = plan?.today?.tasks?.[0];
  const generationNotice = plan?.generation_notice
    ? `<p class="route-capacity__note" role="status">${esc(plan.generation_notice)}</p>`
    : "";
  const routeConfirmed = draft.status === "confirmed";
  const compactPlan = plan ? `<section class="route-next-step"><div><span class="section-kicker">${routeConfirmed ? "今日行动" : "正在准备"}</span><h3>先走当前这一段</h3><p>${esc(currentMonth?.title ?? draft.milestones[0]?.title ?? "当前阶段")}</p></div><div><span>今天的第一步</span><strong>${esc(firstTask?.title ?? (routeConfirmed ? "回到今天开始学习" : "正在生成今日任务"))}</strong><small>${firstTask ? `${firstTask.planned_minutes} 分钟 · ${esc(firstTask.action || firstTask.review_prompt)}` : routeConfirmed ? "回到今天页开始这一条行动" : "路线生成完成后会直接回到今天"}</small></div></section>` : "";
  const confirmationLabel = draft.feasibility.status === "tight" ? "接受紧凑安排，开始今天这一步" : "确认路线，开始今天这一步";
  return `<section class="route-draft"><div class="route-draft__header"><div><span class="section-kicker">${draft.status === "confirmed" ? "已确认路线" : "AI 路线草案"}</span><h2>${esc(draft.goal.name)}</h2><p>${esc(draft.summary)}</p></div><span class="route-feasibility route-feasibility--${esc(draft.feasibility.status)}">${feasibilityText}</span></div><div class="route-capacity"><div><span>距目标</span><strong>${draft.feasibility.days_remaining} 天</strong></div><div><span>可用时长</span><strong>${draft.feasibility.total_available_hours} 小时</strong></div><div><span>计划时长</span><strong>${draft.feasibility.planned_hours} 小时</strong></div><div><span>每日投入</span><strong>${draft.plan?.daily_minutes ?? draft.goal?.daily_minutes ?? "-"} 分钟</strong></div></div><p class="route-capacity__note">${esc(draft.feasibility.message)}</p>${generationNotice}${assessment}${compactPlan}<div class="route-draft__body"><div class="route-milestones"><span class="section-kicker">阶段路线</span>${draft.milestones.map((milestone, index) => `<article class="route-milestone"><span>0${index + 1}</span><div><small>${esc(milestone.start_date)} 至 ${esc(milestone.end_date)} · ${milestone.planned_hours} 小时</small><h3>${esc(milestone.title)}</h3><ul>${milestone.outcomes.map((outcome) => `<li>${esc(outcome)}</li>`).join("")}</ul></div></article>`).join("")}</div><aside class="route-verification"><span class="section-kicker">确认前核验</span><h3>只核对会影响路线的事实</h3><ul>${draft.facts_to_confirm.map((fact) => `<li>${esc(fact)}</li>`).join("")}</ul><div class="route-sources">${draft.sources.slice(0, 3).map((source) => `<a href="${esc(source.official_url)}" target="_blank" rel="noreferrer"><strong>${esc(source.title)}</strong><small>${esc(source.publisher)} · ${esc(source.freshness)}</small></a>`).join("")}</div><div class="route-evidence"><span class="section-kicker">已接入依据 · ${esc(draft.knowledge_index_version ?? "未标记")}</span><p>${evidence.length ? `已结合 ${evidence.length} 条审核知识片段；动态信息仍需你在官方来源中确认。` : "当前没有可展示的检索片段，只保留行动建议并要求人工核验。"}</p></div>${canConfirm ? `<button class="button button--primary" type="button" data-action="confirm-learning-route" data-route-id="${esc(draft.id)}" data-route-version="${draft.version}">${confirmationLabel} ${icon("check")}</button>` : draft.status === "confirmed" ? `<span class="route-confirmed">${icon("check", "已确认")} 已作为后续学习计划依据</span>` : `<span class="route-blocked">调整截止日期、每周时间或目标范围后，再生成草案。</span>`}</aside></div></section>`;
}

function pageLearningRoute(state) {
  if (!state.isDemo && state.learningRoute?.syncStatus === "loading") {
    return `<div class="page page--route" data-demo-state="false">${intro("/route", state, "路线 · 正在恢复已保存安排")}<section class="route-empty" role="status" aria-live="polite"><span class="section-kicker">正在同步路线</span><h2>正在读取你的已保存计划。</h2><p>同步完成前不会创建新路线，也不会覆盖已有安排。</p></section></div>`;
  }
  if (!state.isDemo && state.learningRoute?.syncStatus === "error") {
    return `<div class="page page--route" data-demo-state="false">${intro("/route", state, "路线 · 同步暂时中断")}<section class="route-empty" role="alert"><span class="section-kicker">路线尚未同步</span><h2>没有创建或覆盖任何计划。</h2><p>请检查网络后重新读取当前账号的路线。</p><button class="button button--outline" type="button" data-action="retry-route-sync">重新同步路线</button></section></div>`;
  }
  const draft = currentLearningRoute(state);
  const selectedGoal = selectedGoalFor(state);
  const savedFormCandidate = state.learningRoute?.form ?? {};
  const savedLevelMatches = selectedGoal?.id === "goal-cet4"
    ? /四级|CET-4/i.test(savedFormCandidate.goal_name ?? "")
    : selectedGoal?.id === "goal-cet6"
      ? /六级|CET-6/i.test(savedFormCandidate.goal_name ?? "")
      : true;
  const savedForm = savedFormCandidate.goal_type === goalTypeFor(selectedGoal) && savedLevelMatches ? savedFormCandidate : {};
  const formGoal = draft?.goal ?? {
    type: savedForm.goal_type,
    name: savedForm.goal_name,
    target_date: savedForm.target_date,
    weekly_hours: savedForm.weekly_hours,
    daily_minutes: savedForm.daily_minutes,
    region: savedForm.region,
    focus_areas: savedForm.focus_areas,
    constraints: savedForm.constraints,
    baseline_assessment: savedForm.baseline_assessment,
  };
  const minimumDate = minimumRouteTargetDate();
  const routeGoalType = formGoal.type ?? savedForm.goal_type ?? goalTypeFor(selectedGoal);
  const requestedDate = formGoal.target_date ?? defaultRouteTargetDate(routeGoalType);
  const targetDate = requestedDate < minimumDate ? minimumDate : requestedDate;
  if (!draft) {
    const weeklyHours = Number(savedForm.weekly_hours ?? state.user.weeklyHours ?? 8) || 8;
    const goalName = savedForm.goal_name ?? selectedGoal?.title ?? "考研备考";
    const quota = state.learningRoute?.generationQuota;
    const quotaLoading = state.learningRoute?.generationQuotaStatus === "loading";
    const quotaExhausted = state.learningRoute?.generationQuotaStatus === "synced" && Number.isInteger(quota?.remaining) && quota.remaining <= 0;
    const error = state.learningRoute?.error
      ? `<p class="route-adjustment__error" role="alert" aria-live="assertive">${esc(state.learningRoute.error)}</p>`
      : "";
    const submitLabel = state.learningRoute?.error ? "重新生成今天这一步" : "生成今天这一步";
    return `<div class="page page--route page--route-quick" data-demo-state="${state.isDemo}">${intro("/route", state, "路线 · 只核对会影响今天的两件事")}<section class="route-quick"><div><span class="section-kicker">当前目标路线 · 第 2 步</span><h2>给出截止日期和<br><em>每周可用时间。</em></h2><p>完整路线会在后台展开；今天先从一条能完成的行动开始。</p></div><form class="route-form route-form--minimal" data-demo-form="learning-route">${error}${generationQuotaNotice(state)}<input name="goal_type" type="hidden" value="${esc(savedForm.goal_type ?? routeGoalType)}"><input name="goal_name" type="hidden" value="${esc(goalName)}"><input name="daily_minutes" type="hidden" value="${esc(state.user.dailyMinutes ?? 25)}"><label>目标日期<input name="target_date" type="date" min="${minimumDate}" value="${esc(targetDate)}" required></label><label class="route-hours">每周可投入 <strong><output data-route-hours-output>${weeklyHours}</output> 小时</strong><input data-route-hours name="weekly_hours" type="range" min="1" max="60" step="1" value="${weeklyHours}"><span><small>1 小时</small><small>60 小时</small></span></label><button class="button button--primary" type="submit" ${(quotaExhausted || quotaLoading) ? "disabled aria-disabled=\"true\"" : ""}>${quotaLoading ? "正在读取今日额度…" : submitLabel} ${icon("arrow")}</button><a class="text-link route-goal-link" href="/goals" data-route="/goals">调整目标方向 ${icon("arrow")}</a></form></section></div>`;
  }
  return `<div class="page page--route" data-demo-state="${state.isDemo}">${intro("/route", state, "路线 · 当前安排与可调整的长期方向")}<section class="route-layout">${learningRouteResult(draft, null, "")}</section>${routeAdjustmentForm(draft, state)}</div>`;
}

function pageCET(state) {
  const selectedGoal = selectedGoalFor(state);
  const level = selectedGoal?.id === "goal-cet6" ? "CET-6" : "CET-4";
  const draft = currentLearningRoute(state);
  const examMinutes = level === "CET-6" ? 130 : 125;
  const listeningMinutes = level === "CET-6" ? 30 : 25;
  return `<div class="page page--cet" data-demo-state="${state.isDemo}">${intro("/cet", state, "CET-4 / CET-6 · 学习台")}<section class="cet-level"><span class="section-kicker">当前备考级别</span><div class="cet-level__switch" role="group" aria-label="选择备考级别">${state.goals.filter((goal) => ["goal-cet4", "goal-cet6"].includes(goal.id)).map((goal) => `<button type="button" data-goal="${esc(goal.id)}" aria-pressed="${goal.selected}" class="${goal.selected ? "is-selected" : ""}">${esc(goal.title)}</button>`).join("")}</div></section><section class="cet-facts" aria-label="笔试结构"><div><span>笔试时长</span><strong>${examMinutes} 分钟</strong></div><div><span>写作</span><strong>15% · 30 分钟</strong></div><div><span>听力</span><strong>35% · ${listeningMinutes} 分钟</strong></div><div><span>阅读</span><strong>35% · 40 分钟</strong></div><div><span>翻译</span><strong>15% · 30 分钟</strong></div></section><section class="cet-today"><div class="cet-today__copy"><span class="section-kicker">${draft ? "当前路线" : "开始前先定节奏"}</span><h2>${draft ? esc(draft.goal.name) : `为 ${level} 建立一条可执行路线`}</h2><p>${draft ? `今天的任务：${esc(draft.plan?.today?.tasks?.[0]?.title ?? "进入专项训练")}` : "设定考试目标日期与每周可用时间后，系统会把学习主题、现成资料、练习来源和用时排进七日计划。"}</p></div>${action(draft ? "开始今日训练" : "设置考试目标与时间", draft ? "/study" : "/route", "button button--primary", "arrow")}</section><section class="cet-sections"><div class="cet-sections__heading"><span class="section-kicker">按官方笔试板块练</span><h2>把官方考试结构<br><em>放进七日计划。</em></h2></div><div class="cet-sections__list"><div><span>01 / 听力理解</span><strong>${listeningMinutes} 分钟 · 短材料、长对话与篇章</strong></div><div><span>02 / 阅读理解</span><strong>40 分钟 · 选词、匹配与仔细阅读</strong></div><div><span>03 / 写作</span><strong>30 分钟 · 独立构思、成文与修改</strong></div><div><span>04 / 翻译</span><strong>30 分钟 · 汉译英段落与句子结构</strong></div></div></section><section class="cet-boundary"><p>本页只说明考试结构，不生成原创练习题，也不预测 CET 成绩。具体学习和练习范围以你的七日计划及其中收录的资料来源为准。</p><a href="https://cet.neea.edu.cn/html1/folder/16113/1586-1.htm" target="_blank" rel="noreferrer">查看教育考试院笔试说明 ${icon("arrow")}</a><small>当次考试日期、报名资格与考点安排，请以教育考试院和所在学校通知为准。</small></section></div>`;
}

function pageCETStudy(state) {
  const route = currentLearningRoute(state);
  if (!route) return `<div class="page page--cet-study">${intro("/study", state, "CET-4 / CET-6 · 今日安排")}<section class="empty-panel"><span class="section-kicker">先建立目标路线</span><h2>把考试时间和每周节奏<br><em>告诉砺境。</em></h2><p>生成七日计划后，从每天的安排打开对应资料和现成题库。</p>${action("设置目标与时间", "/route", "button button--ink")}</section></div>`;
  const tasks = route.plan?.weekly_tasks ?? [];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: route.goal?.timezone || "Asia/Shanghai" }).format(new Date());
  const task = tasks.find((item) => item.date === today) ?? tasks.find((item) => !item.feedback?.status) ?? route.plan?.today?.tasks?.[0] ?? null;
  const level = selectedGoalFor(state)?.id === "goal-cet6" ? "CET-6" : "CET-4";
  if (!task) return `<div class="page page--cet-study" data-demo-state="${state.isDemo}">${intro("/study", state, `${level} · 七日计划`)}${action("查看学习计划", "/plan", "button button--ink")}</div>`;
  const resource = task.resource;
  const practice = task.practice ?? { count: 0, source: null, scope: "" };
  const resourceLink = resource?.url
    ? `<a href="${esc(resource.url)}" target="_blank" rel="noreferrer">${esc(resource.title)} · ${esc(resource.publisher || "已收录来源")}</a>`
    : task.resource_search_url
      ? `<a href="${esc(task.resource_search_url)}" target="_blank" rel="noreferrer">B站站内搜索：${esc(task.topic)}（非课程直达链接，结果未核验）</a>`
      : "<span>没有可核验的课程直达链接，请按计划主题使用教材或公开来源。</span>";
  const practiceLink = Number(practice.count) > 0 && practice.source?.url
    ? `<a href="${esc(practice.source.url)}" target="_blank" rel="noreferrer">${esc(practice.source.title)} · ${practice.count} 项 · ${esc(practice.scope)}</a>`
    : `<span>现成练习 ${Number(practice.count) || 0} 项。${practice.count ? esc(practice.scope) : "没有核验到题库时不另造练习题。"}</span>`;
  return `<div class="page page--cet-study" data-demo-state="${state.isDemo}">${intro("/study", state, `${level} · 今日安排`)}${persistenceNotice(state)}<section class="cet-session"><div><span class="section-kicker">${esc(task.date)} · ${esc(task.type)} · ${task.planned_minutes} 分钟</span><h2>${esc(task.title)}</h2><strong>${esc(task.topic)}</strong><p>${esc(task.action)}</p><p>结束时留下：${esc(task.expected_output ?? "简短复述或笔记")}</p></div></section><section class="cet-session__resources"><h2>今天使用的资料与练习</h2><div>${resourceLink}</div><div>${practiceLink}</div></section>${action("记录今天的自述反馈", "/plan", "button button--ink", "check")}</div>`;
}

function planTaskCard(task, index, { canReport, todayDate, isDemo }) {
  const resource = task.resource;
  const practice = task.practice ?? { count: 0, source: null, scope: "" };
  const saved = task.feedback;
  const future = task.date > todayDate;
  const resourceRow = resource?.url
    ? `<div class="plan-resource"><span>已收录资料</span><a href="${esc(resource.url)}" target="_blank" rel="noreferrer">${esc(resource.title)}</a><small>${esc(resource.publisher || "来源已收录")}${resource.duration_minutes ? ` · 课程约 ${resource.duration_minutes} 分钟` : resource.kind === "course" ? " · 课程时长未收录" : ""}${resource.locator ? ` · ${esc(resource.locator)}` : ""}${resource.excerpt ? ` · ${esc(resource.excerpt)}` : ""}</small></div>`
    : `<div class="plan-resource"><span>资料核验</span><strong>没有可核验的课程直达链接</strong><small>按计划主题使用下方已收录的官方或教材来源；B站搜索只提供检索入口，不代表课程已核验。</small>${task.resource_search_url ? `<a href="${esc(task.resource_search_url)}" target="_blank" rel="noreferrer">B站站内搜索：${esc(task.topic)}</a>` : ""}</div>`;
  const practiceRow = Number(practice.count) > 0
    ? `<div class="plan-practice"><span>现成练习 · ${practice.count} 项</span>${practice.source?.url ? `<a href="${esc(practice.source.url)}" target="_blank" rel="noreferrer">${esc(practice.source.title)}</a>` : `<strong>${esc(practice.source?.title ?? "练习来源")}</strong>`}<small>${esc(practice.scope || "按来源中与本日主题对应的范围完成")}</small></div>`
    : `<div class="plan-practice"><span>现成练习 · 0 项</span><small>当前资料目录没有可核验的题库范围；本日按资料学习与复述执行，不另造题目。</small></div>`;
  const statusLabel = { completed: "完成", partial: "部分完成", not_started: "未开始" }[saved?.status] ?? "尚未自述";
  const feedbackForm = canReport
    ? `<form class="plan-feedback" data-demo-form="learning-plan-feedback" data-task-id="${esc(task.id)}"><div class="plan-feedback__fields"><label>完成情况<select name="status" required>${saved ? "" : "<option value=\"\" selected disabled>请选择</option>"}<option value="completed" ${saved?.status === "completed" ? "selected" : ""}>完成</option><option value="partial" ${saved?.status === "partial" ? "selected" : ""}>部分完成</option><option value="not_started" ${saved?.status === "not_started" ? "selected" : ""}>未开始</option></select></label><label>实际用时（分钟）<input name="actual_minutes" type="number" min="0" max="1440" step="1" value="${saved?.actual_minutes ?? ""}" placeholder="选填"></label></div><label>卡点（选填）<textarea name="note" rows="2" maxlength="500" placeholder="例如：资料章节太长，或今天临时少了 20 分钟">${esc(saved?.note ?? "")}</textarea></label><div class="plan-feedback__footer"><small>${future ? "到当天再记录" : saved ? `已保存自述：${statusLabel}${saved.actual_minutes !== null && saved.actual_minutes !== undefined ? ` · ${saved.actual_minutes} 分钟` : ""}` : "只记录你的自述，不需要上传学习证明。"}</small><button class="button button--outline" type="submit" ${future ? "disabled" : ""}>${saved ? "更新自述" : "保存自述"} ${icon("check")}</button></div></form>`
    : `<div class="plan-feedback__locked">${isDemo ? "登录并生成自己的计划后，可按日记录执行反馈。" : future ? "到当天再记录执行情况。" : "确认学习路线后可记录自述反馈。"}</div>`;
  return `<article class="plan-day" data-plan-day="${esc(task.date)}"><header class="plan-day__header"><span>第 ${index + 1} 天 · ${esc(task.date)}</span><span class="plan-day__self-report">${saved ? `自述：${statusLabel}` : "待自述"}</span></header><h2>${esc(task.title)}</h2><div class="plan-day__meta"><span>${esc(task.type)}</span><span>${task.planned_minutes} 分钟</span><span>${esc(task.milestone_title ?? "当前阶段")}</span></div><section class="plan-day__detail"><h3>学习主题</h3><p>${esc(task.topic)}</p><h3>今天具体做什么</h3><p>${esc(task.action)}</p>${resourceRow}${practiceRow}<div class="plan-day__output"><strong>结束时留下</strong><span>${esc(task.expected_output ?? "一条简短复述或学习笔记")}</span></div></section><div class="plan-day__print-check"><span>□ 今日完成</span><span>实际用时：________ 分钟</span></div><div class="plan-day__write-space"><span>手写备注：</span><i></i><i></i></div>${feedbackForm}</article>`;
}

function pagePlan(state) {
  const route = currentLearningRoute(state);
  const routePlan = route?.plan;
  const storedTasks = routePlan?.weekly_tasks;
  const tasks = storedTasks?.length ? storedTasks : [
    ...(routePlan?.today?.tasks ?? []),
    ...(routePlan?.upcoming_tasks ?? []),
  ].slice(0, 7);
  const routeMonths = routePlan?.current_year?.months ?? routePlan?.months ?? [];
  const today = route?.goal?.timezone
    ? new Intl.DateTimeFormat("en-CA", { timeZone: route.goal.timezone }).format(new Date())
    : dateInputValue(new Date());
  const cycleEnd = tasks.at(-1)?.date ?? routePlan?.cycle_end_date ?? "";
  const allReported = tasks.length > 0 && tasks.every((task) => Boolean(task.feedback?.status));
  const canAdvance = allReported && cycleEnd <= today;
  const canReport = Boolean(route && !state.isDemo && route.status === "confirmed");
  const progress = routePlan ? Math.round((tasks.filter((task) => task.feedback?.status).length / Math.max(1, tasks.length)) * 100) : 0;
  const years = routePlan?.horizon?.years ?? [];
  const emptyState = `<section class="plan-empty"><span class="section-kicker">今天的学习安排</span><h2>先生成一份属于你的七日计划。</h2><p>填写目标、基础自述和可用时间后，计划会列出每天的主题、资料、练习范围与预计用时。</p>${action("建立学习路线", "/route", "button button--primary")}</section>`;
  const nextCycle = route && routePlan
    ? `<section class="plan-cycle-next"><div><span class="section-kicker">七日周期</span><h2>${allReported ? canAdvance ? "可以开始下一周期" : "七天自述已齐" : `已记录 ${tasks.filter((task) => task.feedback?.status).length} / ${tasks.length} 天`}</h2><p>周期调整只参考你填报的完成情况、用时和卡点，不代表平台验证了真实学习结果。</p></div><button class="button button--ink" type="button" data-action="advance-learning-week" data-route-id="${esc(route.id)}" data-route-version="${route.version}" ${canAdvance ? "" : "disabled"}>生成下一周期 ${icon("refresh")}</button></section>`
    : "";
  const planBody = routePlan
    ? `<header class="plan-print-header"><span class="section-kicker">砺境 · 七日执行计划</span><h2>${esc(route.goal?.name ?? "学习计划")}</h2><p>${esc(route.summary ?? "")} · ${esc(tasks[0]?.date ?? routePlan.cycle_start_date ?? "")} 至 ${esc(cycleEnd)}</p><small>此文档是计划副本；勾选和手写备注留在纸面，不需要上传。</small></header><div class="plan-tools"><span>自述反馈 ${tasks.filter((task) => task.feedback?.status).length} / ${tasks.length} 天 · 每日最多 ${routePlan.daily_minutes} 分钟</span><button class="button button--outline" type="button" data-action="export-learning-plan">打印 / 保存 PDF ${icon("arrow")}</button></div>${route?.status !== "confirmed" ? `<p class="plan-confirm-note">这是一份待确认路线的计划预览。确认路线后，可在网页提交每日自述。</p>` : ""}<section class="plan-week-list" aria-label="七日学习安排">${tasks.map((task, index) => planTaskCard(task, index, { canReport, todayDate: today, isDemo: state.isDemo })).join("")}</section>${nextCycle}${years.length ? `<section class="plan-horizon"><span class="section-kicker">长期路线 · ${years.length} 年</span>${years.map((year) => `<article><strong>${year.year}</strong><span>${esc(year.title)}</span><small>${esc(year.objective)}</small></article>`).join("")}</section>` : ""}`
    : emptyState;
  return `<div class="page page--plan" data-demo-state="${state.isDemo}">${intro("/plan", state)}${routePlan ? `<div class="plan-head"><div class="plan-head__progress"><span>当前七日周期</span><strong>${esc(tasks[0]?.date ?? routePlan.cycle_start_date ?? "今天")} <small>至 ${esc(cycleEnd)}</small></strong>${progressBar(progress)}<div><span>待自述</span><span>${tasks.length} 天计划</span><span>${routePlan.weekly_hours ?? route.goal.weekly_hours} 小时/周</span></div></div><div class="plan-head__balance"><div class="balance-wheel balance-wheel--large"><span></span><b>☯</b></div><div><span>执行反馈</span><strong>${tasks.filter((task) => task.feedback?.status).length} / ${tasks.length}</strong><p>学习情况由你自行记录</p>${routePlan.requested_daily_minutes && routePlan.requested_daily_minutes !== routePlan.daily_minutes ? `<small class="plan-update-note">你填写每日 ${routePlan.requested_daily_minutes} 分钟；按每周 ${routePlan.weekly_hours} 小时，实际计划按 ${routePlan.daily_minutes} 分钟排入。</small>` : ""}</div></div></div>` : ""}${planBody}</div>`;
}

function evidenceLevelItem(item, selected) {
  return `<button class="evidence-level ${selected ? "is-selected" : ""}" type="button" data-action="select-evidence" data-evidence-level="${item.level}" aria-pressed="${selected}"><span class="evidence-level__number">L${item.level}</span><span><strong>${item.title}</strong><small>${item.detail}</small></span>${selected ? icon("check", "已选择") : icon("arrow", "选择")}</button>`;
}

function evidenceReview(state) {
  const review = reviewForDisplay(state) ?? {
    evidenceUsed: "尚未提交学习证据",
    problem: "本轮还没有生成复盘。",
    reason: "提交证据后，系统才会依据可复查的内容提出下一步。",
    nextAction: "先留下可复查的证据，系统会据此生成下一步行动。",
  };
  const evidence = state.pilot.submittedEvidence ? `用户提交：${esc(state.pilot.submittedEvidence)}` : esc(review.evidenceUsed);
  const status = reviewStatusFor(state);
  const reviewHeading = status === "规则复盘" ? "行动型规则复盘" : "行动型 AI 复盘";
  const note = reviewForDisplay(state)
    ? `本次结论基于 L${state.pilot.selectedEvidenceLevel} 级证据，不等同于最终掌握。`
    : "提交学习证据后，这里会显示本轮复盘与下一步。";
  return `<section class="evidence-review"><div class="section-title"><div><span>${reviewHeading}</span><h2>下一步不是一句鼓励，<br><em>而是一件明天能做的事。</em></h2></div><span class="evidence-review__status">${status}</span></div><div class="evidence-review__grid"><div class="evidence-review__cell evidence-review__cell--evidence"><span>用了什么证据</span><strong>${evidence}</strong></div><div class="evidence-review__cell evidence-review__cell--problem"><span>发现了什么问题</span><strong>${esc(review.problem)}</strong></div><div class="evidence-review__cell evidence-review__cell--reason"><span>为什么这样判断</span><strong>${esc(review.reason)}</strong></div><div class="evidence-review__cell evidence-review__next"><span>明日行动</span><strong>${esc(review.nextAction)}</strong></div></div><small class="evidence-review__note">${note}</small></section>`;
}

function reviewForDisplay(state) {
  const pilot = state.pilot ?? {};
  if (state.isDemo) return pilot.review ?? null;
  if (pilot.reviewReady || pilot.reviewError) return pilot.review ?? null;
  return String(pilot.submittedEvidence ?? "").trim() && pilot.review ? pilot.review : null;
}

function reviewStatusFor(state) {
  const review = reviewForDisplay(state);
  if (state.pilot?.reviewReady && review) return "AI 复盘";
  if (review && (!state.isDemo || state.pilot?.reviewError)) return "规则复盘";
  if (state.isDemo && review) return "演示样例";
  return String(state.pilot?.submittedEvidence ?? "").trim() ? "待复盘" : "待提交";
}

function reviewChain(state) {
  const pilot = state.pilot ?? {};
  const review = reviewForDisplay(state);
  const submittedEvidence = String(pilot.submittedEvidence ?? "").trim();
  const evidenceText = submittedEvidence || String(review?.evidenceUsed ?? "").trim();
  const hasEvidence = Boolean(evidenceText);
  const hasReview = Boolean(review);
  const level = Number(pilot.selectedEvidenceLevel) || 1;
  const brief = (value, fallback) => {
    const text = String(value ?? "").trim() || fallback;
    return esc(text.length > 76 ? `${text.slice(0, 76)}…` : text);
  };
  const evidenceValue = state.isDemo && hasReview
    ? `L${level} · 演示样例`
    : hasEvidence ? `L${level} · 已提交` : "待提交";
  const evidenceDetail = hasEvidence
    ? brief(evidenceText, "已留下学习证据")
    : "完成今天的行动后，留下作答或笔记。";
  const steps = [
    { label: "学习证据", value: evidenceValue, detail: evidenceDetail, complete: hasEvidence },
    { label: "复盘判断", value: hasReview ? reviewStatusFor(state) : "待生成", detail: hasReview ? brief(review.problem, "已完成复盘") : "提交证据后生成判断。", complete: hasReview },
    { label: "下一步行动", value: hasReview ? "已给出" : "待生成", detail: hasReview ? brief(review.nextAction, "查看下方行动建议") : "复盘完成后显示具体行动。", complete: hasReview },
  ];
  const headingCaption = state.isDemo && hasReview ? `演示样例 · L${level}` : hasEvidence ? `本轮学习 · L${level} 级证据` : "本轮学习 · 尚无证据";
  return `<section class="review-chain" aria-label="本轮学习进度"><div class="review-chain__heading"><div><span class="section-kicker">${headingCaption}</span><h2>证据怎样走到<br><em>下一步。</em></h2></div><span class="review-chain__status">${reviewStatusFor(state)}</span></div><ol class="review-chain__steps">${steps.map((step, index) => `<li class="review-chain__step ${step.complete ? "is-complete" : "is-pending"}"><span class="review-chain__number">0${index + 1}</span><div><span class="review-chain__label">${step.label}</span><strong>${step.value}</strong><p>${step.detail}</p></div></li>`).join("")}</ol><div class="review-chain__footer">${action("继续今天的学习", "/study", "button button--ink")}<span>记忆迭代 · ${state.memory?.iterationCount ?? 0} 次</span></div></section>`;
}

function memoryLoop(state) {
  const memories = (state.memory?.memories ?? []).filter((memory) => memory.status !== "rejected").slice(0, 3);
  const statusText = state.memory?.syncStatus === "saving" ? "正在沉淀" : state.memory?.syncStatus === "error" ? "等待再次写入" : memories.some((memory) => memory.status === "active") ? "已确认" : "等你确认";
  return `<section class="memory-loop"><div class="section-title"><div><span>本轮新记忆 · ${state.memory?.iterationCount ?? 0} 次迭代</span><h2>让这次行动，<br><em>改变下一次引路。</em></h2></div><span class="memory-loop__status">${statusText}</span></div>${memories.length ? `<div class="memory-loop__list">${memories.map((memory) => `<article class="memory-loop__item memory-loop__item--${memory.kind}"><span class="memory-loop__mark">${memory.kind === "friction" ? "问" : "行"}</span><div class="memory-loop__body"><span>${memory.status === "active" ? "已记住" : "待确认"} · ${memory.scope === "goal-exam" ? "考试目标" : memory.scope === "goal-skill" ? "技能目标" : memory.scope === "goal-life" ? "生活目标" : "共同记忆"}</span><h3>${esc(memory.title)}</h3><p>${esc(memory.content)}</p><small>观察 ${memory.observation_count ?? 1} 次 · 置信度 ${Math.round((memory.confidence ?? 0) * 100)}%</small></div>${memory.status === "candidate" ? `<div class="memory-loop__actions"><button class="button button--ink" type="button" data-action="memory-feedback" data-memory-id="${esc(memory.id)}" data-memory-action="confirm">记住</button><button class="text-link" type="button" data-action="memory-feedback" data-memory-id="${esc(memory.id)}" data-memory-action="reject">不再记住</button></div>` : `<span class="memory-loop__confirmed">${icon("check", "已确认")}</span>`}</article>`).join("")}</div>` : `<div class="memory-loop__empty"><span>本轮还没有长期记忆</span><p>留下证据后，砺境会先提出候选，再由你决定是否记住。</p></div>`}</section>`;
}

function companionStatus(status) {
  return {
    planned: "等待开始",
    active: "正在进行",
    started: "正在进行",
    stuck: "已标记卡住",
    skipped: "今天先缓一缓",
    completed: "已留下证据",
  }[status] ?? "等待开始";
}

function materialStudyPage(state) {
  const companion = state.companionCycle ?? {};
  const currentAction = companion.currentAction ?? null;
  const artifacts = state.learningArtifacts ?? [];
  const citations = (companion.retrievedEvidence ?? []).slice(0, 4);
  const guidance = (companion.guidanceEvidence ?? []).slice(0, 3);
  const diagnosis = companion.diagnosisSummary ?? null;
  const evidenceLevels = state.pilot?.evidenceLevels ?? [];
  const selectedLevel = Number(state.pilot?.selectedEvidenceLevel ?? 2);
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const actionArtifacts = currentAction?.artifact_refs?.map((id) => artifactById.get(id)).filter(Boolean) ?? [];
  const feedbackDegraded = diagnosis?.status === "degraded";
  const feedbackSummary = feedbackDegraded
    ? "模型诊断暂未完成，但引路已经根据你提交的材料整理出一条可执行行动。"
    : diagnosis?.reason ?? "引路已经读完你提交的材料，并整理好了当前判断与下一步行动。";
  const feedbackBlock = currentAction
    ? `<section class="companion-feedback companion-feedback--${feedbackDegraded ? "degraded" : "ready"}" role="status" aria-live="polite"><div class="companion-feedback__mark">引</div><div class="companion-feedback__copy"><span>引路反馈 · 刚刚生成</span><strong>${feedbackDegraded ? "引路已给出保底反馈" : "引路已完成反馈"}</strong><p>${esc(feedbackSummary)}</p></div><span class="companion-feedback__state">已回应</span></section>`
    : "";
  const inlineReview = state.pilot?.inlineReview
    ? `<section class="inline-review" role="status"><span>已完成这一条 · 回望</span><div><strong>${esc(state.pilot.inlineReview.completedTitle)}</strong><p>${esc(state.pilot.inlineReview.evidence)}</p></div><div><span>下一步</span><strong>${esc(state.pilot.inlineReview.nextTitle)}</strong><p>${esc(state.pilot.inlineReview.nextReason)}</p></div></section>`
    : "";

  if (!currentAction) {
    return `<div class="page page--study page--study-material" data-demo-state="${state.isDemo}">${intro("/study", state, "材料驱动 · 先把卡住的地方交给引路")}${persistenceNotice(state)}<div class="study-layout"><section class="study-focus study-focus--material"><div class="study-focus__top"><span class="section-kicker">${companion.screenState === "need_material" ? "等待你的材料" : "材料入口"}</span>${demoNote(state)}<span class="study-focus__timer">文字或图片</span></div><div class="study-focus__title"><span class="study-focus__gua">引</span><h2>先把正在卡住的地方交出来</h2><p>可以是一道题、一段笔记、作答草稿或错因说明。引路会基于提交内容整理下一步。</p></div><section class="study-action material-intake"><div class="study-action__heading"><span>第一步 · 留下可检索的材料</span><h3>材料 → 诊断 → 一条现在能完成的行动</h3><p>可以直接粘贴文字、上传题目或笔记截图，或在手机上直接拍摄。确认后的文字会按你的账号隔离，并保留引用位置。</p></div><form class="material-intake__form" data-demo-form="learning-artifact"><div class="material-intake__grid"><label>材料标题<input name="source_title" type="text" maxlength="160" placeholder="例如：极限题 12 · 洛必达条件混淆"></label><label>科目<select data-material-subject name="subject"><option value="数学二" selected>数学二</option><option value="数学一">数学一</option><option value="数学三">数学三</option><option value="408">408</option><option value="计算机自命题">计算机自命题</option><option value="英语一">英语一</option><option value="英语二">英语二</option><option value="政治">政治</option><option value="其他主题">其他主题</option></select></label><label data-material-custom-subject-field hidden>主题名称<input data-material-custom-subject name="custom_subject" type="text" maxlength="80" placeholder="例如：Python、物理或英语口语"></label><label>材料类型<select name="kind"><option value="question" selected>题目</option><option value="note">笔记</option><option value="attempt_draft">作答草稿</option><option value="answer_reference">错因说明 / 参考答案</option></select></label></div><label>粘贴材料<textarea name="content_text" rows="10" maxlength="12000" placeholder="把题干、你的思路、写到哪一步、哪里不确定一起贴进来……"></textarea></label><label class="material-photo">拍照 / 上传图片<input name="material_image" data-material-image type="file" accept="image/jpeg,image/png,image/gif" capture="environment"><span data-material-image-name>选择图片、上传文件或直接拍摄</span></label><p class="material-photo__notice">支持 JPEG、PNG、GIF，最大 20 MB。图片仅用于本次识别，不会保存；识别后请确认文字再交给引路。</p><p class="material-photo__uncertain" data-material-image-uncertain hidden></p><div class="material-intake__footer"><span>建议包含：题目条件、你的尝试、卡住的位置。</span><button class="button button--ink material-intake__submit" type="submit"><span class="material-submit-label material-submit-label--default">交给引路</span><span class="material-submit-label material-submit-label--confirm">确认文字并交给引路</span> ${icon("arrow")}</button></div></form>${artifacts.length ? `<div class="material-library"><div class="material-library__head"><span>已保存材料</span><strong>${artifacts.length} 份</strong></div><div class="material-library__list">${artifacts.slice(0, 4).map((artifact) => `<article><span>${esc(artifact.kind)}</span><strong>${esc(artifact.source_title)}</strong><small>${esc(artifact.subject)} · ${esc(artifact.updated_at ? new Date(artifact.updated_at).toLocaleDateString("zh-CN") : "刚刚")}</small></article>`).join("")}</div></div>` : ""}</section><aside class="study-aside"><section class="study-aside__tip"><span class="study-aside__tip-mark">知</span><div class="study-aside__tip-copy"><span>引路的边界</span><p>没有材料，就没有诊断；没有证据，就不把一次完成写成掌握。</p><a href="/assistant" data-route="/assistant">先问一个问题 ${icon("arrow")}</a></div></section></aside></div></div>`;
  }

  const terminal = ["completed", "superseded", "skipped"].includes(currentAction.status);
  const canWrite = !state.isDemo && !terminal;
  const relatedMaterial = actionArtifacts.length
    ? actionArtifacts.map((artifact) => `<span class="material-ref">${esc(artifact.source_title)}</span>`).join("")
    : currentAction.artifact_refs?.map((id) => `<span class="material-ref">材料 ${esc(id)}</span>`).join("") ?? "";
  const citationBlock = citations.length
    ? `<div class="material-citations"><div class="material-citations__head"><span>材料引用</span><small>只来自你的私人材料</small></div>${citations.map((citation) => `<article><span>${esc(citation.title)} · ${esc(citation.chunk_id)}</span><p>${esc(citation.excerpt)}</p><small>位置 ${citation.locator?.start ?? 0}-${citation.locator?.end ?? 0}</small></article>`).join("")}</div>`
    : "";
  const guidanceBlock = guidance.length
    ? `<div class="material-guidance"><div class="material-citations__head"><span>学习依据</span><small>学习节点，不用于招生或日期事实</small></div>${guidance.map((item) => `<article><strong>${esc(item.title)}</strong><p>${esc(item.summary)}</p><small>建议：${esc(item.action_pattern)}</small></article>`).join("")}</div>`
    : `<div class="material-guidance material-guidance--empty"><div class="material-citations__head"><span>学习依据</span><small>下一条行动暂未绑定审核节点</small></div><p>这条行动只根据你刚提交的材料和证据生成，不会套用其他学科模板。你可以继续留下证据，或补充更具体的主题和问题。</p></div>`;
  const diagnosisBlock = diagnosis
    ? diagnosis.status === "degraded"
      ? `<div class="material-diagnosis material-diagnosis--degraded"><span>引路反馈 · 保底行动</span><p>模型诊断暂未完成。这条行动只根据你提交的材料生成，不作掌握、正确率或路线结论。</p>${Array.isArray(diagnosis.unknowns) && diagnosis.unknowns.length ? `<small>仍待验证：${esc(diagnosis.unknowns.join("；"))}</small>` : ""}</div>`
      : `<div class="material-diagnosis"><span>引路反馈 · 判断依据</span><p>${esc(diagnosis.reason ?? currentAction.reason)}</p>${Array.isArray(diagnosis.unknowns) && diagnosis.unknowns.length ? `<small>仍未知：${esc(diagnosis.unknowns.join("；"))}</small>` : ""}</div>`
    : "";
  const controls = canWrite ? `<div class="study-action__controls">${["planned", "stuck"].includes(currentAction.status) ? `<button class="button button--ink" type="button" data-action="companion-check-in" data-companion-intent="start" data-task-id="${esc(currentAction.id)}" data-action-version="${currentAction.version}">${currentAction.status === "planned" ? "开始这一条" : "继续这一条"} ${icon("play")}</button>` : ""}<label>卡住原因<select data-companion-blocker><option value="difficulty">内容太难</option><option value="time">时间不够</option><option value="emotion">状态不稳</option><option value="environment">环境受限</option><option value="unknown">说不清楚</option></select></label><button class="button button--outline" type="button" data-action="companion-check-in" data-companion-intent="stuck" data-task-id="${esc(currentAction.id)}" data-action-version="${currentAction.version}">我卡住了</button><button class="text-link" type="button" data-action="companion-check-in" data-companion-intent="skip" data-task-id="${esc(currentAction.id)}" data-action-version="${currentAction.version}">先缩小这一步</button></div>` : terminal ? `<div class="material-terminal"><span>这条行动已经关闭</span><p>页面不再提供写入控件，刷新后以服务端状态为准。</p></div>` : "";
  const evidenceForm = canWrite ? `<form class="material-evidence" data-demo-form="material-evidence" data-action-id="${esc(currentAction.id)}" data-action-version="${currentAction.version}"><div class="section-title"><div><span>完成证据</span><h2>你实际留下了什么？</h2></div><span class="evidence-submit__level">选择一档</span></div><p>${esc(currentAction.expected_evidence)}</p><div class="material-evidence__levels">${evidenceLevels.map((item) => `<label class="material-evidence__level"><input type="radio" name="evidence_level" value="${item.level}" ${item.level === selectedLevel ? "checked" : ""}><span><strong>L${item.level} · ${esc(item.title)}</strong><small>${esc(item.detail)}</small></span></label>`).join("")}</div><label class="material-evidence__field">证据内容<textarea name="evidence" rows="6" maxlength="1200" placeholder="写下你做了什么、得到什么、还卡在哪里……" required></textarea></label><p class="material-evidence__status" data-evidence-pending hidden role="status" aria-live="polite"></p><button class="button button--ink" type="submit">提交证据并生成下一步 ${icon("arrow")}</button></form>` : "";
  return `<div class="page page--study page--study-material" data-demo-state="${state.isDemo}">${intro("/study", state, "材料驱动 · 唯一行动卡")}${persistenceNotice(state)}<div class="study-layout"><section class="study-focus study-focus--material"><div class="study-focus__top"><span class="section-kicker">引路同行 · ${companionStatus(currentAction.status)}</span>${demoNote(state)}<span class="study-focus__timer">${currentAction.estimated_minutes} 分钟</span></div>${feedbackBlock}${inlineReview}<div class="study-focus__title"><span class="study-focus__gua">引</span><h2>${esc(currentAction.title)}</h2><p>做完后就在这里留下证据，下一步会原地出现。</p></div><section class="study-action"><div class="study-action__heading"><span>为什么现在做</span><h3>${esc(currentAction.reason)}</h3><p>${relatedMaterial}</p></div>${controls}</section>${diagnosisBlock}${citationBlock}${guidanceBlock}${evidenceForm}</section><aside class="study-aside"><section class="study-aside__tip"><span class="study-aside__tip-mark">行</span><div class="study-aside__tip-copy"><span>完成标准</span><p>${esc(currentAction.expected_evidence)}</p><a href="/knowledge" data-route="/knowledge">查看材料来源 ${icon("arrow")}</a></div></section></aside></div></div>`;
}

function pageStudy(state) {
  const companion = state.companionCycle ?? {};
  const cycle = companion.cycle ?? null;
  const cycleTask = companion.task ?? cycle?.task ?? null;
  const cycleAppliesToTask = Boolean(cycle && cycleTask && cycle.task?.id === cycleTask.id);
  const localTask = state.today.tasks.find((task) => task.status === "active") ?? state.today.tasks.at(-1);
  const active = cycleTask
    ? { ...cycleTask, meta: `${cycleTask.estimated_minutes} 分钟`, gua: cycleTask.type === "复盘" ? "☵" : "☲" }
    : localTask;
  if (!active) {
    return `<div class="page page--study page--study-empty">${intro("/study", state)}<section class="empty-panel"><span class="section-kicker">当前还没有学习任务</span><h2>先完成入山信息，<br><em>再建立你的第一段路线。</em></h2><p>完成目标和节律设置后，服务端会为你的账号保存学习记录。</p>${action("继续入山引导", "/onboarding", "button button--ink")}</section></div>`;
  }
  const routeTask = state.learningRoute?.draft?.plan?.today?.tasks?.find((task) => task.id === active.id);
  const status = cycleAppliesToTask ? cycle.status : "planned";
  const canCheckIn = !state.isDemo && Boolean(cycleTask) && status !== "completed";
  const startLabel = status === "planned" ? "开始这一段" : "继续这一段";
  const actionText = routeTask?.action || `先完成“${active.title}”中最小、可留下痕迹的一步。`;
  const intervention = (cycleAppliesToTask && (companion.nextAction || cycle?.intervention?.next_action)) || `先开始“${active.title}”中最小、可留下痕迹的一步。`;
  return `<div class="page page--study" data-demo-state="${state.isDemo}">${intro("/study", state)}<div class="study-layout"><section class="study-focus"><div class="study-focus__top"><span class="section-kicker">当前学习 · ${esc(active.type)}</span>${demoNote(state)}<span class="study-focus__timer">${active.estimated_minutes ?? routeTask?.planned_minutes ?? 25} 分钟</span></div><div class="study-focus__title"><span class="study-focus__gua">${active.gua}</span><h2>${esc(active.title)}</h2><p>完成时留下你能提供的最高等级证据。</p></div><section class="study-action" aria-label="今日行动"><div class="study-action__heading"><span>引路同行 · ${companionStatus(status)}</span><h3>${esc(actionText)}</h3><p>${esc(intervention)}</p></div>${canCheckIn ? `<div class="study-action__controls">${status === "started" ? "" : `<button class="button button--ink" type="button" data-action="companion-check-in" data-companion-intent="start" data-task-id="${esc(active.id)}">${startLabel} ${icon("play")}</button>`}<label>卡住原因<select data-companion-blocker><option value="difficulty">内容太难</option><option value="time">时间不够</option><option value="emotion">状态不稳</option><option value="environment">环境受限</option><option value="unknown">说不清楚</option></select></label><button class="button button--outline" type="button" data-action="companion-check-in" data-companion-intent="stuck" data-task-id="${esc(active.id)}">我卡住了</button><button class="text-link" type="button" data-action="companion-check-in" data-companion-intent="skip" data-task-id="${esc(active.id)}">今天先缓一缓</button></div>` : ""}</section><div class="evidence-submit"><div class="section-title"><div><span>完成证据</span><h2>你这次留下了什么？</h2></div><span class="evidence-submit__level">当前 L${state.pilot.selectedEvidenceLevel}</span></div><p>选择最高证据等级，并用一句话记录内容。完成证据会先写入今日行动，再进入复盘。</p><div class="evidence-levels">${state.pilot.evidenceLevels.map((item) => evidenceLevelItem(item, item.level === state.pilot.selectedEvidenceLevel)).join("")}</div><label class="evidence-submit__field">证据摘要<textarea data-evidence-input rows="4" placeholder="例如：写下一个反例，并说明它为什么能支持当前结论。">${esc(state.pilot.submittedEvidence)}</textarea></label><button class="button button--ink" type="button" data-action="submit-evidence" data-task-id="${esc(active.id)}" ${status === "completed" ? "disabled" : ""}>提交证据并生成复盘 ${icon("arrow")}</button><div class="study-knowledge-capture"><div class="study-knowledge-capture__copy"><span>可选 · 留下脉络</span><strong>把这次理解接入知识库</strong><small>以后复习时，从这条记录继续。</small></div><button class="knowledge-capture-link" type="button" data-action="capture-knowledge" data-knowledge-title="${esc(active.title)}" data-knowledge-source="学习 · 当前学习">记入知识库 ${icon("arrow")}</button></div></div></section><aside class="study-aside"><div class="study-aside__route"><span class="section-kicker">试点记录</span><div class="mini-mountain"><span class="mini-mountain__path"></span><i class="mini-mountain__dot mini-mountain__dot--one"></i><i class="mini-mountain__dot mini-mountain__dot--two"></i><i class="mini-mountain__dot mini-mountain__dot--three"></i></div><div class="study-aside__legend"><span><i class="dot dot--gold"></i>今日任务</span><span><i class="dot dot--gray"></i>证据解锁下一步</span></div></div><div class="study-aside__tip"><span class="study-aside__tip-mark">灯</span><div class="study-aside__tip-copy"><span>卡住时的下一步</span><p>${esc(intervention)}</p><a href="/review" data-route="/review">查看复盘记录 ${icon("arrow")}</a></div></div></aside></div></div>`;
}

function pageStudyWithDiagnostic(state) {
  const companion = state.companionCycle ?? {};
  const routeTaskVisible = companion.routeAvailable
    && companion.task
    && (!companion.currentAction || companion.currentAction.origin === "route")
    && ["action_active", "cycle_completed"].includes(companion.screenState);
  if (!state.isDemo && routeTaskVisible) {
    const route = currentLearningRoute(state);
    if (isCetGoal(state) && route?.status === "confirmed") return pageCETStudy(state);
    return pageStudy(state);
  }
  if (isCetGoal(state) && state.isDemo) return pageCETStudy(state);
  if (!state.isDemo) return materialStudyPage(state);
  return pageStudy(state);
}

function pageReview(state) {
  return `<div class="page page--review" data-demo-state="${state.isDemo}">${intro("/review", state)}${reviewChain(state)}${evidenceReview(state)}${memoryLoop(state)}<section class="review-list">${sectionTitle("需要你回望的山脊", "证据覆盖情况", action("查看档案", "/knowledge", "text-link", "arrow"))}<div class="knowledge-rows">${state.knowledge.slice(0, 3).map((item) => `<article class="knowledge-row"><span class="knowledge-row__gua">${item.gua}</span><div><span>${item.domain}</span><h3>${item.title}</h3></div><div class="knowledge-row__mastery">${progressBar(item.mastery, item.color === "cinnabar" ? "red" : "amber")}<strong>L${item.evidenceLevel ?? 2} · ${item.mastery}%</strong></div><a href="/study" data-route="/study" aria-label="复习 ${item.title}">${icon("arrow", "复习")}</a></article>`).join("")}</div></section></div>`;
}

function knowledgeCaptureForm(state) {
  const draft = state.knowledgeCaptureDraft ?? {};
  const relationOptions = state.knowledge.map((item) => `<option value="${item.id}" ${item.id === draft.relatedId ? "selected" : ""}>${item.title}</option>`).join("");
  return `<form class="knowledge-capture" data-demo-form="knowledge-capture"><div class="knowledge-capture__heading"><div><span class="section-kicker">收录新知识</span><h3>让一个新节点接入你的脉络</h3></div><button class="icon-button" type="button" data-action="close-knowledge-composer" title="关闭新增知识">${icon("close", "关闭")}</button></div><div class="knowledge-capture__fields"><label>知识名称<input name="title" type="text" value="${esc(draft.title ?? "")}" placeholder="例如：牛顿第二定律" required></label><label>归入脉络<input name="strand" type="text" value="${esc(draft.strand ?? "新知识")}" placeholder="例如：物理 · 力学" required></label><label>来源<input name="source" type="text" value="${esc(draft.source ?? "手动收录")}" placeholder="例如：今天的课程 / 一段对话" required></label><label>连接到<select name="relatedId"><option value="">暂不连接</option>${relationOptions}</select></label><label class="knowledge-capture__note">我的理解<textarea name="note" rows="4" placeholder="写下你自己的理解……">${esc(draft.note ?? "")}</textarea></label></div><div class="knowledge-capture__footer"><span>新节点会以“初探”状态加入，并和你选择的节点建立连接。</span><button class="button button--ink" type="submit">收录进知识库 ${icon("plus")}</button></div></form>`;
}

const KNOWLEDGE_GRAPH_POSITIONS = {
  northwest: [27, 27],
  north: [50, 19],
  northeast: [74, 28],
  west: [20, 51],
  east: [80, 51],
  southwest: [30, 76],
  south: [51, 82],
  southeast: [73, 74],
};

function knowledgeNodePosition(item, index, total = 0) {
  if (index < 8 && KNOWLEDGE_GRAPH_POSITIONS[item.position]) {
    const [x, y] = KNOWLEDGE_GRAPH_POSITIONS[item.position];
    if (total <= 3 && ["east", "west"].includes(item.position)) return [x, 32];
    return [x, y];
  }
  const seed = [...String(item.id ?? index)].reduce((value, char) => ((value * 31) + char.charCodeAt(0)) % 997, 17);
  const angle = index * 2.399963 + seed / 997;
  const radius = Math.min(44, 12 + Math.sqrt(index + 1) * 3.1);
  return [
    Math.min(94, Math.max(6, 50 + Math.cos(angle) * radius)),
    Math.min(93, Math.max(7, 50 + Math.sin(angle) * radius * .74)),
  ];
}

function knowledgeGraphTone(item) {
  return item.color === "cinnabar" ? "red" : item.color === "blue" ? "teal" : item.color === "rock" ? "gray" : "gold";
}

function knowledgeGraphProjection(items, activeId = "") {
  if (!items.length) return { nodes: [], dots: [], lines: [], relationCount: 0 };
  const labelLimit = items.length <= 18 ? items.length : 8;
  const labelIds = new Set(items.slice(0, labelLimit).map((item) => item.id));
  if (activeId) labelIds.add(activeId);
  const nodes = items.map((item, index) => {
    const [x, y] = knowledgeNodePosition(item, index, items.length);
    return { item, x, y, tone: knowledgeGraphTone(item), isLabel: labelIds.has(item.id) };
  });
  const positions = new Map(nodes.map((node) => [node.item.id, node]));
  const lines = nodes.filter((node) => node.isLabel).map((node) => `<line class="knowledge-network__line knowledge-network__line--core" x1="50" y1="50" x2="${node.x}" y2="${node.y}"></line>`);
  const relationKeys = new Set();
  nodes.forEach((node) => (node.item.relatedIds ?? []).forEach((relatedId) => {
    const related = positions.get(relatedId);
    if (!related) return;
    const key = [node.item.id, relatedId].sort().join("|");
    if (relationKeys.has(key)) return;
    relationKeys.add(key);
    lines.push(`<line class="knowledge-network__line knowledge-network__line--relation" x1="${node.x}" y1="${node.y}" x2="${related.x}" y2="${related.y}"></line>`);
  }));

  const dots = [];
  const dotCount = Math.min(220, Math.max(96, Math.round(items.length * .65)));
  for (let index = 0; index < dotCount; index += 1) {
    const node = nodes[index % nodes.length];
    const angle = index * 2.399963;
    const radius = 8 + ((index * 13) % 18) * 1.15;
    const x = Math.min(96, Math.max(4, node.x + Math.cos(angle) * radius));
    const y = Math.min(94, Math.max(6, node.y + Math.sin(angle) * radius * .72));
    const size = 2 + (index % 4);
    dots.push(`<span class="knowledge-network__dot knowledge-network__dot--${node.tone}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;--dot-size:${size}px" aria-hidden="true"></span>`);
    if (index % 3 === 0) lines.push(`<line class="knowledge-network__line knowledge-network__line--thread" x1="${node.x}" y1="${node.y}" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}"></line>`);
  }
  return { nodes, dots, lines, relationCount: relationKeys.size };
}

function knowledgeNetwork(state, active) {
  const items = state.knowledge ?? [];
  if (items.length === 0) return "";
  const projection = knowledgeGraphProjection(items, active.id);
  const zoom = Math.min(1.24, Math.max(.86, Number(state.knowledgeGraphZoom) || 1));
  const visibleNodes = projection.nodes.map((node) => node.isLabel
    ? `<button class="knowledge-network__node knowledge-network__node--${node.tone} ${node.item.id === active.id ? "is-active" : ""}" type="button" data-action="select-knowledge" data-knowledge-id="${node.item.id}" data-knowledge-item aria-pressed="${node.item.id === active.id}" style="left:${node.x}%;top:${node.y}%"><span>${node.item.gua}</span><strong>${esc(node.item.title)}</strong><small>${esc(node.item.state)} · L${node.item.evidenceLevel ?? 2}</small></button>`
    : `<button class="knowledge-network__dot knowledge-network__dot--interactive knowledge-network__dot--${node.tone}" type="button" data-action="select-knowledge" data-knowledge-id="${node.item.id}" data-knowledge-item aria-label="查看 ${esc(node.item.title)}" title="查看 ${esc(node.item.title)}" style="left:${node.x}%;top:${node.y}%;--dot-size:7px"></button>`).join("");
  const labelNote = items.length > projection.nodes.filter((node) => node.isLabel).length ? ` · ${projection.nodes.filter((node) => node.isLabel).length} 个标签` : "";
  return `<section class="knowledge-network" aria-label="个人知识关系网络"><div class="knowledge-network__head"><div><span class="section-kicker">关系网络 · ${items.length} 个核心节点</span><h3>看见知识如何彼此借力</h3></div><span class="knowledge-network__mode">${projection.relationCount} 条已知连接 · 密度预览${labelNote}</span></div><div class="knowledge-network__viewport"><div class="knowledge-network__plane" style="--knowledge-zoom:${zoom}"><svg class="knowledge-network__connections" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${projection.lines.join("")}</svg><div class="knowledge-network__dots">${projection.dots.join("")}</div><div class="knowledge-network__core"><span>个人学习证据</span><strong>${items.length}</strong><small>核心节点</small></div>${visibleNodes}</div></div><div class="knowledge-network__footer"><div class="knowledge-network__legend"><span><i class="dot dot--gold"></i>已稳固</span><span><i class="dot dot--red"></i>待回望</span><span><i class="dot dot--gray"></i>初探</span></div><div class="knowledge-network__zoom"><button type="button" data-action="knowledge-zoom" data-zoom="out" aria-label="缩小网络">-</button><span>${Math.round(zoom * 100)}%</span><button type="button" data-action="knowledge-zoom" data-zoom="in" aria-label="放大网络">+</button><button type="button" data-action="knowledge-zoom" data-zoom="reset">重置</button></div></div></section>`;
}

function knowledgeCatalog(state) {
  const collections = [
    { label: "学习目标", detail: "你当前选择的方向", count: state.goals?.filter((goal) => goal.selected).length ?? 0 },
    { label: "知识记录", detail: "由学习证据整理", count: state.knowledge?.length ?? 0 },
    { label: "学习材料", detail: "用于诊断与回看", count: state.learningArtifacts?.length ?? 0 },
  ];
  return `<aside class="knowledge-catalog"><div class="knowledge-catalog__head"><span>你的学习记录</span><strong>${state.knowledge?.length ?? 0}</strong></div><div class="knowledge-catalog__groups">${collections.map((item, index) => `<div class="knowledge-catalog__item ${index === 1 ? "is-active" : ""}"><span class="knowledge-catalog__index">0${index + 1}</span><div><strong>${item.label}</strong><small>${item.detail}</small></div><b>${item.count}</b></div>`).join("")}</div><div class="knowledge-catalog__foot"><span>复利链路</span><strong>输入 → 关联 → 复习 → 迁移</strong></div></aside>`;
}

function knowledgeDirectory(state, recentOnly = false) {
  const items = recentOnly ? (state.knowledge ?? []).slice(0, 6) : state.knowledge ?? [];
  const groups = new Map();
  items.forEach((item) => {
    const key = recentOnly ? "最近更新" : item.strand;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return `<section class="knowledge-directory"><div class="knowledge-directory__head"><div><span class="section-kicker">${recentOnly ? "最近收录" : "分层目录"}</span><h3>${recentOnly ? "最近进入网络的记录" : "按知识脉络查看"}</h3></div><span>${items.length} 条记录</span></div>${[...groups.entries()].map(([group, groupItems]) => `<div class="knowledge-directory__group"><div class="knowledge-directory__group-head"><strong>${esc(group)}</strong><span>${groupItems.length}</span></div>${groupItems.map((item) => `<button class="knowledge-directory__row" type="button" data-action="select-knowledge" data-knowledge-id="${item.id}" data-knowledge-item aria-pressed="${item.id === state.activeKnowledgeId}"><span class="knowledge-directory__row-gua">${item.gua}</span><span class="knowledge-directory__row-copy"><strong>${esc(item.title)}</strong><small>${esc(item.domain)} · ${esc(item.source)}</small></span><span class="knowledge-directory__row-level">L${item.evidenceLevel ?? 2}</span>${icon("chevron", "查看节点")}</button>`).join("")}</div>`).join("") || `<div class="knowledge-directory__empty"><span>巽</span><strong>还没有记录</strong><small>从一次学习证据开始建立第一条连接。</small></div>`}</section>`;
}

function knowledgeInspector(active, related) {
  if (!active || active.id === "empty") return "";
  return `<aside class="knowledge-inspector"><div class="knowledge-inspector__top"><span>当前节点 · ${active.gua}</span><b>${active.state}</b></div><h3>${esc(active.title)}</h3><span class="knowledge-inspector__strand">${esc(active.strand)}</span><p>${esc(active.summary)}</p><div class="knowledge-inspector__mastery"><div><span>证据覆盖</span><strong>L${active.evidenceLevel ?? 2} · ${active.mastery}%</strong></div>${progressBar(active.mastery, active.color === "cinnabar" ? "red" : active.color === "rock" ? "gray" : "amber")}</div><div class="knowledge-inspector__meta"><div><span>来自</span><strong>${esc(active.source)}</strong></div><div><span>最近更新</span><strong>${esc(active.updated)}</strong></div></div><div class="knowledge-inspector__links"><span>它连接到</span><div>${related.map((item) => `<button type="button" data-action="select-knowledge" data-knowledge-id="${item.id}">${item.gua} ${esc(item.title)}</button>`).join("") || `<small>还没有关联节点</small>`}</div></div><div class="knowledge-inspector__note"><span>我留下的理解</span><p>${esc(active.note)}</p></div>${action("沿这条脉络回望", "/review", "button button--ink")}</aside>`;
}

function pageKnowledge(state) {
  const items = state.knowledge ?? [];
  if (items.length === 0) {
    return `<div class="page page--knowledge" data-demo-state="${state.isDemo}">${intro("/knowledge", state, "个人学习证据")}<section class="knowledge-empty"><h2>这里还没有你的知识节点</h2><p>完成一次学习并提交证据后，第一条记录会自动出现在这里。</p>${action("开始今天的学习", "/", "button button--ink")}</section></div>`;
  }
  const active = items.find((item) => item.id === state.activeKnowledgeId) ?? items[0];
  const related = (active.relatedIds ?? []).map((id) => items.find((item) => item.id === id)).filter(Boolean);
  const view = ["network", "directory", "recent"].includes(state.knowledgeView) ? state.knowledgeView : "directory";
  const workspace = view === "directory" ? knowledgeDirectory(state) : view === "recent" ? knowledgeDirectory(state, true) : knowledgeNetwork(state, active);
  const composer = state.knowledgeComposerOpen ? knowledgeCaptureForm(state) : "";
  return `<div class="page page--knowledge" data-demo-state="${state.isDemo === true}">${intro("/knowledge", state, "个人学习证据")}<section class="knowledge-workbench"><div class="knowledge-workbench__head"><div><span class="section-kicker">LEARNING EVIDENCE · LIBRARY</span><h2>让每一条记录，<br><em>接上下一条。</em></h2><p>每一条记录都会回到你的学习里，成为下一步判断的依据。</p></div><div class="knowledge-workbench__stats">${metaLine("记录", `${items.length}`)}${metaLine("关联", `${knowledgeGraphProjection(items).relationCount}`)}${metaLine("材料", `${state.learningArtifacts?.length ?? 0}`)}</div></div><div class="knowledge-workbench__toolbar"><div class="knowledge-view-tabs" role="tablist" aria-label="知识库视图"><button type="button" data-action="knowledge-view" data-knowledge-view="network" role="tab" aria-selected="${view === "network"}">关系图</button><button type="button" data-action="knowledge-view" data-knowledge-view="directory" role="tab" aria-selected="${view === "directory"}">目录</button><button type="button" data-action="knowledge-view" data-knowledge-view="recent" role="tab" aria-selected="${view === "recent"}">最近</button></div><label class="knowledge-search"><span class="sr-only">搜索知识节点</span>${icon("search", "搜索知识节点")}<input data-knowledge-search type="search" placeholder="搜索节点、来源或关键词" autocomplete="off"></label><button class="button button--outline knowledge-add-button" type="button" data-action="open-knowledge-composer">${icon("plus")}新增记录</button></div><div class="knowledge-workbench__body">${knowledgeCatalog(state)}<section class="knowledge-workspace" data-knowledge-view-current="${view}">${workspace}</section>${knowledgeInspector(active, related)}</div>${composer}</section></div>`;
}

function knowledgeMaterials(state) {
  const materials = state.learningArtifacts ?? [];
  const diagnosis = state.companionCycle?.diagnosisSummary ?? null;
  const observations = Array.isArray(diagnosis?.observations) ? diagnosis.observations : [];
  return `<section class="knowledge-materials"><div class="knowledge-materials__head"><div><span class="section-kicker">个人材料 · 证据来源</span><h2>引路引用了什么？</h2><p>这里展示只属于当前账号的题目、笔记和草稿。官方知识不会覆盖你的个人状态。</p></div><span class="knowledge-materials__count">${materials.length} 份材料</span></div>${materials.length ? `<div class="knowledge-materials__list">${materials.slice(0, 8).map((material) => `<article><div><span>${esc(material.kind)} · ${esc(material.subject)}</span><h3>${esc(material.source_title)}</h3></div><p>${esc(String(material.content_text ?? "").slice(0, 180))}${String(material.content_text ?? "").length > 180 ? "…" : ""}</p><small>保存于 ${esc(material.updated_at ? new Date(material.updated_at).toLocaleDateString("zh-CN") : "最近")}</small></article>`).join("")}</div>` : `<div class="knowledge-materials__empty"><strong>还没有个人材料</strong><span>回到“学习”，粘贴一道题、笔记或作答草稿，引路才会开始引用你的真实状态。</span></div>`}${observations.length ? `<div class="knowledge-materials__citations"><span>最近一次诊断引用</span>${observations.map((observation) => `<article><strong>${esc(observation.claim)}</strong><p>“${esc(observation.evidence_excerpt)}”</p><small>${esc(observation.artifact_id)} · ${esc(observation.chunk_id)} · 置信度 ${Math.round(Number(observation.confidence ?? 0) * 100)}%</small></article>`).join("")}</div>` : ""}</section>`;
}

function pageKnowledgeWithMaterials(state) {
  const hasKnowledge = (state.knowledge ?? []).length > 0;
  const observations = state.companionCycle?.diagnosisSummary?.observations ?? [];
  const hasPersonalMaterials = (state.learningArtifacts ?? []).length > 0 || observations.length > 0;
  if (!hasKnowledge && !hasPersonalMaterials) return pageKnowledge(state);
  const html = pageKnowledge(state);
  const close = html.lastIndexOf("</div>");
  return close === -1 ? html : `${html.slice(0, close)}${knowledgeMaterials(state)}${html.slice(close)}`;
}

function assistantDisplayText(value) {
  const raw = String(value ?? "");
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.type === "answer" && typeof parsed.message === "string") return parsed.message;
    if (Array.isArray(parsed?.milestones) || parsed?.plan) return "这次返回的内容更像路线草案，已经拦截；请回到路线页面确认目标和时间。";
  } catch {
    // Existing plain-text responses remain readable.
  }
  return raw;
}

function pageAssistant(state) {
  const guide = state.guide;
  const selected = guide.options.find((option) => option.assetId === guide.selectedAssetId) ?? guide.options[0];
  const selectedAsset = getAsset(selected.assetId);
  const companion = state.companion ?? {};
  const interactionCount = Number(companion.interactionCount ?? 0);
  const iterationCount = Number(state.memory?.iterationCount ?? 0);
  const response = state.pilot.assistantPending
    ? `<span class="assistant-pending" role="status" aria-live="polite"><i aria-hidden="true"></i>AI 引路正在思考，已收到你的问题；正在结合你的目标、今日任务和学习记录整理下一步……</span>`
    : state.pilot.assistantResponse
    ? esc(assistantDisplayText(state.pilot.assistantResponse)).replace(/\n/g, "<br>")
    : state.pilot.assistantError
      ? `这次回答没有完成：${esc(state.pilot.assistantError)}`
      : state.isDemo
        ? esc(selected.opening)
        : "服务正在连接。先把问题写下来，回答会在后台完成后回到这里。";
  const aiStatus = state.pilot.assistantPending
    ? "AI 引路正在思考"
    : state.service?.aiStatus === "available"
      ? "AI 当前可用"
      : state.service?.aiStatus === "unavailable"
        ? "AI 暂不可用"
        : state.service?.aiConfigured === true
          ? "AI 已配置，等待真实请求验证"
          : state.service?.aiConfigured === false
            ? "当前未接通 AI"
            : "正在连接 AI";
  const aiStatusClass = state.pilot.assistantPending ? "is-pending" : state.service?.aiStatus === "available" ? "is-online" : state.service?.aiStatus === "unavailable" ? "is-offline" : "is-pending";
  const promptValue = state.pilot.assistantPending ? state.pilot.assistantPrompt : "";
  const submitLabel = state.pilot.assistantPending ? "正在回答" : "发送问题";
  const continuity = state.isDemo
    ? "演示模式：这段对话不会被伪装成你的长期记忆。"
    : interactionCount > 0
      ? `已同行 ${interactionCount} 次 · 学习记忆迭代 ${iterationCount} 次`
      : "服务端正在记录你们的第一次同行";
  const lastSeen = !state.isDemo && companion.lastSeenAt ? `最近同行：${formatAccountDate(companion.lastSeenAt)}` : "这里只显示已确认的学习记录";
  return `<div class="page page--assistant" data-demo-state="${state.isDemo}">${intro("/assistant", state)}<div class="assistant-layout"><section class="assistant-dialog"><div class="assistant-dialog__header"><span class="assistant-dialog__seal">${selected.mark}</span><div><span>专属引路 · 卡住时使用</span><strong>${selected.name}</strong></div><i class="online-dot ${aiStatusClass}" title="${aiStatus}"></i><small>${aiStatus} · 根据当前任务、目标和学习记录给出下一步</small></div><div class="assistant-dialog__body"><div class="message message--guide"><span class="message__mark">${selected.mark}</span><div class="message__body"><span class="message__eyebrow">引路回声 · 当前学习</span><p>${response}</p><span class="message__footer">先回答问题，再给一个可验证的下一步</span></div></div><div class="suggestion-list"><button type="button" data-action="ask-guide">根据我的错题，明天先补什么？</button><button type="button" data-action="ask-guide">按我的可用时间拆一个今天的动作</button><button type="button" data-action="ask-guide">我还没有证据，最小输出是什么？</button></div></div><form class="assistant-composer" data-demo-form="assistant"><input name="prompt" value="${esc(promptValue)}" placeholder="说出你卡住的地方……" aria-label="向引路提问" ${state.pilot.assistantPending ? "disabled" : ""}><button type="submit" class="icon-button icon-button--dark" title="${submitLabel}" ${state.pilot.assistantPending ? "disabled" : ""}>${icon("arrow", submitLabel)}</button></form></section><aside class="assistant-aside"><section class="assistant-guide-card assistant-guide-card--${selected.kind}"><div class="assistant-guide-card__art"><img src="${selectedAsset.path}" alt="${selectedAsset.alt}"></div><div class="assistant-guide-card__copy"><span class="section-kicker">引路方式 · ${selected.teachingStyle}</span><strong>${selected.name}</strong><p>${selected.detail}</p></div></section><div class="assistant-aside__note"><span class="section-kicker">同行记录</span><strong>${continuity}</strong><p>${lastSeen}</p><small>${state.isDemo ? "真实账号登录后，互动次数和记忆迭代会按账号保存。" : `当前提示词 ${esc(companion.promptVersion || "服务端版本")}`}</small></div><div class="assistant-aside__note"><span class="section-kicker">今日提示</span><p>回答会先看你的目标、当前任务和可用时间，再决定是解释、追问还是安排一个动作。</p></div></aside></div></div>`;
}

function pageGrowth(state) {
  const growthTitle = state.isDemo ? "七天不息" : state.today.streak ? `${state.today.streak}天不息` : "第一步还在等待";
  const growthMeter = state.isDemo ? "640 <small>/ 1,000 气韵</small>" : `${state.today.minutes} <small>分钟已记录</small>`;
  return `<div class="page page--growth" data-demo-state="true">${intro("/growth", state)}<div class="growth-hero"><div class="growth-hero__seal"><div class="growth-hero__ring"></div><span>行者</span><strong>07</strong><small>初见山门</small></div><div class="growth-hero__copy"><span class="section-kicker">气韵 · 正在积累</span><h2>你已经走了<br><em>${growthTitle}。</em></h2><p>这不是一条漂亮的统计线，而是七次你本可以放弃、却又回到山路上的证据。</p>${action("继续今天", "/plan", "button button--ink")}</div><div class="growth-hero__meter"><div class="meter-label"><span>距下一枚印记</span><strong>${growthMeter}</strong></div>${progressBar(state.isDemo ? 64 : 0)}<span>${state.isDemo ? "云隙初光 · 已点亮" : "完成第一条真实记录后解锁"}</span></div></div><section class="achievements">${sectionTitle("成就", "已经留下的印记", action("查看路线图", "/map", "text-link", "arrow"))}<div class="achievement-grid">${state.achievements.map((item) => `<article class="achievement ${item.unlocked ? "is-unlocked" : "is-locked"}"><span class="achievement__mark">${item.unlocked ? item.mark : icon("lock", "未解锁")}</span><div><span>${item.unlocked ? "已解锁" : "尚在云后"}</span><h3>${item.title}</h3><p>${item.detail}</p></div>${item.unlocked ? icon("check", "已解锁") : ""}</article>`).join("")}</div></section><section class="summit-tease"><span class="summit-tease__cloud"></span><div><span class="section-kicker">隐藏成就 · 登临</span><h2>等你站上山顶，<br><em>回望这一路。</em></h2><p>完成当前阶段后，人生副本将开启下一座山。</p></div><span class="summit-tease__height">8,848<small>m</small></span></section></div>`;
}

function pageMap(state) {
  const scene = assetUrl("lijing-summit-climb-ink-v2");
  return `<div class="page page--map" data-demo-state="true">${intro("/map", state)}<div class="map-stage" style="--map-image:url('${scene}')"><div class="map-stage__veil"></div><div class="map-stage__title"><span>路线图 · 远方山系</span><strong>云后还有<br>新的峰顶</strong></div><div class="map-stage__route">${state.map.map((item, index) => `<button class="map-node map-node--${item.state}" type="button" data-action="map-node"><span>${index + 1}</span><strong>${item.title}</strong><small>${item.subtitle}</small><em>${item.height}</em></button>`).join("")}<span class="map-stage__path"></span></div><div class="map-stage__caption"><span class="dot dot--gold"></span> 已点亮的路会为你留下光<br><span class="dot dot--gray"></span> 还未走到的地方，先不必急着看清</div></div></div>`;
}

function pageProfile(state) {
  const account = state.auth?.user;
  const profileMilestone = state.isDemo ? "七日不息" : state.today.streak ? `${state.today.streak}日不息` : "第一步还在等待";
  const profileDays = state.isDemo ? "7 日" : `${state.today.streak ?? 0} 日`;
  const profileReviews = state.isDemo ? "12" : `${state.memory?.iterationCount ?? 0}`;
  return `<div class="page page--profile" data-demo-state="true">${intro("/profile", state)}<div class="profile-layout"><section class="profile-card"><div class="profile-card__top"><div class="profile-card__seal">行</div><div><span class="section-kicker">账号类型 · ${account ? "正式账号" : "演示账号"}</span><h2>${esc(state.user.name)}</h2><p>${esc(state.user.title)}</p></div><a class="icon-button" href="/settings" data-route="/settings" aria-label="打开完整设置" title="打开完整设置">${icon("settings", "打开完整设置")}</a></div><div class="profile-card__path"><span>第一次入山</span><i></i><strong>${profileMilestone}</strong><i></i><span>下一枚印记</span></div><div class="profile-card__footer">${metaLine("已行进", profileDays)}${metaLine("当前高度", `${state.mountain.currentHeight.toLocaleString("zh-CN")}m`)}${metaLine("回望次数", profileReviews)}</div></section><section class="settings-list">${sectionTitle("行者设置", "管理你的账户", demoNote(state))}<a class="setting-row" href="/settings" data-route="/settings"><span>${icon("settings")}</span><div><strong>打开完整设置</strong><small>个人信息、账号切换、偏好和功能反馈</small></div>${icon("chevron")}</a><button class="setting-row" type="button" data-action="toggle-motion"><span>${icon("spark")}</span><div><strong>动效与云雾</strong><small>保留沉浸感，减少不必要的运动</small></div><i class="toggle is-on"><b></b></i></button><button class="setting-row setting-row--danger" type="button" data-action="logout"><span>${icon("arrow", "退出")}</span><div><strong>退出山门</strong><small>结束当前设备上的登录会话</small></div>${icon("chevron")}</button></section></div></div>`;
}

function formatAccountDate(value) {
  if (!value) return "尚未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "尚未记录" : date.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
}

function pageSettings(state) {
  const account = state.auth?.user ?? {};
  const profile = state.user ?? {};
  const service = state.service ?? {};
  const notificationMode = state.preferences?.notifications ?? "important";
  const motionEnabled = state.preferences?.motion !== false;
  const aiLabel = service.aiStatus === "available"
    ? "最近一次真实请求成功"
    : service.aiStatus === "unavailable"
      ? "最近一次真实请求失败，请稍后重试"
      : service.aiConfigured === true
        ? "已配置，尚未完成真实请求验证"
        : service.aiConfigured === false
          ? "AI 尚未配置"
          : "正在检查 AI 状态";
  const aiDot = service.aiStatus === "available" ? "up" : service.aiStatus === "unavailable" ? "down" : "pending";
  const durablePersistence = service.persistence === "durable";
  const persistenceLabel = durablePersistence ? "已接通可跨重启保存的数据库" : service.persistence === "ephemeral" ? "临时本地会话，服务重启后数据会清空" : "正在确认数据保存方式";
  const accountStorageLabel = state.isDemo ? "本地演示数据" : durablePersistence ? "真实账户 · 可跨重启保存" : service.persistence === "ephemeral" ? "真实账户 · 临时本地会话" : "真实账户 · 正在确认保存方式";
  const emailStatusLabel = state.isDemo ? "演示邮箱" : account.email_verified === true ? "邮箱已验证" : "邮箱未验证 · 当前试点仅校验格式";
  const profilePersistenceNote = durablePersistence ? "保存后会同步到当前账户，刷新和换设备仍可恢复。" : service.persistence === "ephemeral" ? "当前为临时本地会话：可在本次服务运行期间使用，重启后不会保留。" : "正在确认数据保存方式，确认前不要把当前会话当作跨设备存储。";
  const dailyMinutes = String(profile.dailyMinutes || "25");
  const weeklyHours = String(Math.min(60, Math.max(1, Number(profile.weeklyHours) || 8)));
  const timezone = String(profile.timezone || "Asia/Shanghai");
  return `<div class="page page--settings" data-demo-state="${state.isDemo}">${intro("/settings", state)}<div class="settings-layout"><section class="settings-account"><div class="settings-account__heading"><span class="section-kicker">账号 · ${state.isDemo ? "演示" : "真实账户"}</span><h2>${esc(account.display_name || profile.name || "未命名行者")}</h2><p>${esc(account.email || "当前没有登录邮箱")}</p><span class="settings-account__status"><i></i>${accountStorageLabel}</span><span class="settings-account__email-status">${emailStatusLabel}</span></div><dl class="settings-facts"><div><dt>账户 ID</dt><dd>${esc(account.id || "DEMO-01")}</dd></div><div><dt>注册时间</dt><dd>${formatAccountDate(account.created_at)}</dd></div><div><dt>当前阶段</dt><dd>${esc(profile.stage || "待填写")}</dd></div><div><dt>每日投入</dt><dd>${esc(dailyMinutes)} 分钟</dd></div></dl><div class="settings-account__actions"><button class="button button--outline" type="button" data-action="switch-account" data-auth-mode="login">${icon("user")}切换账号</button><button class="button button--ink" type="button" data-action="switch-account" data-auth-mode="register">${icon("plus")}注册新账号</button><button class="text-link" type="button" data-action="logout">退出当前账号 ${icon("arrow")}</button></div></section><section class="settings-service"><div class="section-title"><div><span>服务状态</span><h2>真实使用边界</h2></div><span class="settings-service__pulse">${service.api === "up" ? "在线" : "检查中"}</span></div><div class="service-status-row"><span>${icon("compass")}</span><div><strong>砺境服务</strong><small>${service.api === "up" ? "当前服务可以处理账户、学习记录和反馈" : "正在确认服务是否可用"}</small></div><i class="status-dot status-dot--${service.api === "up" ? "up" : "pending"}"></i></div><div class="service-status-row"><span>${icon("lock")}</span><div><strong>数据保存</strong><small>${persistenceLabel}</small></div><i class="status-dot status-dot--${durablePersistence ? "up" : service.persistence === "ephemeral" ? "down" : "pending"}"></i></div><div class="service-status-row"><span>${icon("spark")}</span><div><strong>AI 引路</strong><small>${aiLabel}</small></div><i class="status-dot status-dot--${aiDot}"></i></div><p class="settings-service__note">服务端只返回必要状态，不会在页面或日志中暴露 AI 密钥。</p></section><section class="settings-panel settings-panel--profile"><div class="section-title"><div><span>个人信息</span><h2>让山路更懂你</h2></div></div><form class="settings-form" data-demo-form="settings-profile"><div class="settings-form__grid"><label>行者名<input name="name" type="text" value="${esc(profile.name || "")}" maxlength="80" required></label><label>当前阶段<select name="stage"><option ${profile.stage === "高中学习" ? "selected" : ""}>高中学习</option><option ${profile.stage === "大学学习" ? "selected" : ""}>大学学习</option><option ${profile.stage === "考研备考" ? "selected" : ""}>考研备考</option><option ${profile.stage === "兴趣探索" ? "selected" : ""}>兴趣探索</option><option ${!profile.stage || profile.stage === "待填写" ? "selected" : ""}>待填写</option></select></label><label>学校<input name="school" type="text" value="${esc(profile.school || "")}" maxlength="160" placeholder="可选"></label><label>专业<input name="major" type="text" value="${esc(profile.major || "")}" maxlength="160" placeholder="可选"></label><label>年龄<input name="age" type="number" min="13" max="100" value="${esc(profile.age || "")}" placeholder="可选"></label><label>所在地区<input name="region" type="text" value="${esc(profile.region || "")}" maxlength="120" placeholder="例如：江西"></label><label>每日投入（分钟）<input name="dailyMinutes" type="number" min="5" max="1440" step="5" value="${esc(dailyMinutes)}" required><small>按你的真实节律填写，不限制为一小时。</small></label><label>每周投入（小时）<input name="weeklyHours" type="number" min="1" max="60" step="1" value="${esc(weeklyHours)}"><small>用于核算长期路线是否可行。</small></label></div><label>补充说明<textarea name="notes" rows="4" maxlength="2000" placeholder="例如：工作日只能晚上学习，周末可以安排整块时间。">${esc(profile.notes || "")}</textarea></label><div class="settings-form__grid"><label class="setting-row setting-row--select"><span>${icon("bell")}</span><div><strong>每日提醒</strong><small>到点后提醒你查看今天的未完成计划。</small></div><input name="reminderEnabled" type="checkbox" value="on" ${profile.reminderEnabled !== false ? "checked" : ""}></label><label>提醒时间<input name="reminderTime" type="time" value="${esc(profile.reminderTime || "20:00")}" required></label><label>时区<input name="timezone" type="text" value="${esc(timezone)}" maxlength="80" placeholder="Asia/Shanghai" required></label></div><div class="settings-form__footer"><small>${profilePersistenceNote}</small><button class="button button--ink" type="submit">保存个人信息 ${icon("check")}</button></div></form></section><section class="settings-panel settings-panel--preferences"><div class="section-title"><div><span>使用偏好</span><h2>调整你的节律</h2></div></div><button class="setting-row" type="button" data-action="toggle-motion"><span>${icon("spark")}</span><div><strong>动效与云雾</strong><small>设备本地偏好 · 当前${motionEnabled ? "开启" : "关闭"}</small></div><i class="toggle ${motionEnabled ? "is-on" : ""}"><b></b></i></button><label class="setting-row setting-row--select"><span>${icon("bell")}</span><div><strong>通知与提醒</strong><small>只影响这个浏览器，不会读取其他应用通知</small></div><select data-preference="notifications" aria-label="通知与提醒"><option value="off" ${notificationMode === "off" ? "selected" : ""}>关闭</option><option value="important" ${notificationMode === "important" ? "selected" : ""}>仅重要提醒</option><option value="daily" ${notificationMode === "daily" ? "selected" : ""}>每日摘要</option></select></label></section><section class="settings-panel settings-panel--feedback"><div class="section-title"><div><span>功能反馈</span><h2>把遇到的问题告诉我们</h2></div></div><form class="settings-form" data-demo-form="feedback"><label>反馈类型<select name="category"><option value="bug">功能问题</option><option value="idea">功能建议</option><option value="account">账号与数据</option><option value="ai">AI 使用</option><option value="other">其他</option></select></label><label>标题<input name="title" type="text" maxlength="120" placeholder="例如：设置页保存后没有更新" required></label><label>详细描述<textarea name="detail" rows="6" maxlength="3000" placeholder="请描述你做了什么、看到了什么，以及你希望它怎样工作。" required></textarea></label><label>联系邮箱 <small>可选</small><input name="contact_email" type="email" maxlength="320" value="${esc(account.email || "")}" placeholder="需要回复时填写"></label><div class="settings-form__footer"><small>反馈会关联当前账号，服务端收到后进入处理队列。</small><button class="button button--primary" type="submit">提交反馈 ${icon("arrow")}</button></div></form></section></div></div>`;
}

function pageAdmin(state) {
  const admin = state.adminAnalytics ?? { status: "idle", data: null, error: "" };
  const overview = admin.data;
  const totals = overview?.totals ?? {};
  const number = (value) => Number(value || 0).toLocaleString("zh-CN");
  const money = (value) => `$${Number(value || 0).toFixed(4)}`;
  const date = overview?.date ?? "";
  const statusPanel = admin.status === "forbidden"
    ? `<section class="admin-state admin-state--locked"><span class="admin-state__icon">${icon("lock", "权限受限")}</span><h2>这里是管理员区域</h2><p>当前账号没有运营数据权限。页面没有读取任何统计内容。</p></section>`
    : admin.status === "error"
      ? `<section class="admin-state admin-state--error"><span class="admin-state__icon">${icon("refresh", "重试")}</span><h2>运营数据暂时无法读取</h2><p>${esc(admin.error || "请稍后重试")}</p><button class="button button--primary" type="button" data-action="admin-refresh">${icon("refresh")}重新读取</button></section>`
      : admin.status !== "ready"
        ? `<section class="admin-state"><span class="admin-state__icon">${icon("spark", "读取中")}</span><h2>正在读取运营数据</h2><p>正在从服务端获取聚合统计。</p></section>`
        : "";
  const kpis = [
    ["今日活跃用户", number(totals.dau), "DAU"],
    ["近 7 日活跃", number(totals.active_users_7d), "WAU"],
    ["近 30 日活跃", number(totals.active_users_30d), "MAU"],
    ["注册用户总数", number(totals.registered_users_total), "账户"],
    ["今日新增", number(totals.new_users_today), "注册"],
    ["首个行动", number(totals.first_action_users_today), "用户"],
    ["提交材料", number(totals.material_submitted_users_today), "用户"],
    ["完成证据", number(totals.evidence_submitted_users_today), "用户"],
    ["AI 请求", number(totals.ai_requests_today), "今日"],
    ["AI 完成", number(totals.ai_completed_today), "今日"],
    ["预计成本", money(totals.estimated_cost_usd_today), "今日"],
  ];
  const series = Array.isArray(overview?.series) ? overview.series : [];
  const table = series.length > 0
    ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>日期</th><th>日活</th><th>新增</th><th>首个行动</th><th>材料</th><th>证据</th><th>AI 请求</th><th>AI 完成</th></tr></thead><tbody>${series.map((item) => `<tr><th scope="row">${esc(item.date)}</th><td>${number(item.dau)}</td><td>${number(item.new_users)}</td><td>${number(item.first_action_users)}</td><td>${number(item.material_submitted_users)}</td><td>${number(item.evidence_submitted_users)}</td><td>${number(item.ai_requests)}</td><td>${number(item.ai_completed)}</td></tr>`).join("")}</tbody></table></div>`
    : `<div class="admin-empty">还没有可展示的统计记录。数据会从后台启用后开始累计。</div>`;
  return `<div class="page page--admin" data-demo-state="${state.isDemo}">${intro("/admin", state)}<section class="admin-toolbar"><div><span class="section-kicker">管理员专用</span><p>只读聚合数据 · 不含用户明细</p></div><form class="admin-toolbar__form" data-admin-date><label for="admin-date">查看日期</label><input id="admin-date" name="date" type="date" value="${esc(date)}"><button class="icon-button" type="submit" aria-label="刷新运营数据" title="刷新运营数据">${icon("refresh", "刷新运营数据")}</button></form></section>${statusPanel}${admin.status === "ready" ? `<section class="admin-kpis">${kpis.map(([label, value, note]) => `<article class="admin-kpi"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join("")}</section><section class="admin-detail"><div class="section-title"><div><span>最近 7 天</span><h2>活跃与关键行动</h2></div><span class="admin-detail__date">统计日 · ${esc(date)}</span></div>${table}</section><section class="admin-definition"><span class="section-kicker">数据口径</span><p>日活按当天至少访问一次服务的去重账号计算；近 7 日和近 30 日按活跃账号去重。账号标识在服务端使用单向摘要保存，页面不读取邮箱、学习内容或提示词。</p></section>` : ""}</div>`;
}

function pageState(route, state) {
  if (route === "/state/loading") {
    return `<div class="page page--state page--state-loading"><div class="state-scene" role="status" aria-live="polite"><div class="state-scene__symbol" aria-hidden="true">${icon("spark")}</div><h1>正在同步你的学习状态</h1><p>正在核对账号与已保存的学习记录，请稍候。</p></div></div>`;
  }
  const stateMap = {
    "/state/empty": { iconName: "mountain", action: "去选择方向", href: "/goals" },
    "/state/error": { iconName: "arrow", action: "再次尝试", href: "/plan" },
    "/state/review": { iconName: "compass", action: "回到山脚", href: "/" },
    "/state/permission": { iconName: "lock", action: "返回可用路线", href: "/" },
  }[route];
  return `<div class="page page--state page--state-${route.split("/").pop()}" data-demo-state="true"><div class="state-scene"><div class="state-scene__symbol">${icon(stateMap.iconName)}</div><span class="page-intro__kicker">${getRouteMeta(route).eyebrow}</span><h1>${getRouteMeta(route).title}</h1><p>${getRouteMeta(route).description}</p>${action(stateMap.action, stateMap.href)}<small>状态内容 · ${demoNote(state)}</small></div></div>`;
}

function pageNotFound(state) {
  return `<div class="page page--not-found" data-demo-state="${state.isDemo}"><section class="not-found-panel"><span class="page-intro__kicker">404 · 云路未铺</span><div class="not-found-panel__mark">404</div><h1>这条山路还没有铺开。</h1><p>地址可能写错了，或内容已经移动。已保存的账户数据不会受影响。</p><div class="not-found-panel__actions">${action("回到山脚", "/")}<a class="text-link" href="/features" data-route="/features">查看功能目录 ${icon("arrow")}</a></div></section></div>`;
}

function pageLegal(route, state) {
  const documents = {
    "/privacy": {
      title: "隐私说明",
      updated: "2026-09-15 · 公开试点版",
      sections: [
        ["我们会收集什么", "注册邮箱、昵称、个人学习资料、目标与学习记录，以及你主动提交的反馈。密码只保存为不可逆校验值，不保存明文。"],
        ["为什么收集", "用于创建账户、保存你的学习进度、提供路线与复盘功能、处理故障和改进服务。不会把邮箱或学习内容写入公开页面。"],
        ["如何保护", "会话使用 HttpOnly Cookie；接口默认返回必要字段，并使用 HTTPS 与基础安全响应头。请不要在反馈中提交身份证号、支付卡号或其他与学习无关的敏感信息。"],
        ["当前未完成的能力", "公开试点尚未接入邮箱验证、密码自助找回、账号自助注销和独立客服邮箱。页面会如实提示，不把格式校验冒充真实邮箱证明。"],
        ["你的选择", "如需更正或删除试点数据，请先登录后通过设置页的功能反馈提交请求，并写明账号邮箱和处理目的。正式运营前会补充负责人、保存期限和正式申诉渠道。"],
      ],
    },
    "/terms": {
      title: "用户协议",
      updated: "2026-09-15 · 公开试点版",
      sections: [
        ["服务性质", "砺境当前是公开测试版。功能、数据保存策略和可用性可能调整；请不要把它当作考试、医疗、法律或财务决定的唯一依据。"],
        ["账号责任", "你应使用自己可控制的邮箱并保管密码。当前只校验邮箱格式，不代表邮箱已验证；如忘记密码，现阶段没有自助找回流程。"],
        ["合理使用", "不得攻击、探测、绕过权限、提交恶意内容、冒用他人身份或干扰其他用户。发现安全问题请通过联系方式页留下可复现信息，不要公开利用细节。"],
        ["内容与记录", "你提交的目标、学习证据和反馈归你使用；服务为保存、展示和提供功能所需处理这些内容。涉及第三方资料时，请确认你有权使用。"],
        ["变更与终止", "试点可能暂停或调整功能。涉及账号数据的重要变化会在页面说明；正式运营前会补充完整的运营主体、责任限制和争议处理条款。"],
      ],
    },
    "/contact": {
      title: "联系方式",
      updated: "2026-09-15 · 公开试点版",
      sections: [
        ["当前反馈入口", "登录后进入“设置 → 功能反馈”，选择“功能问题”或“账号与数据”，填写复现步骤和希望的结果。提交后会关联当前账号，便于追踪。"],
        ["还没有什么", "当前没有配置独立客服邮箱、电话客服或承诺响应时限。请不要把紧急事项、支付信息或身份证件发送到反馈中。"],
        ["反馈写法", "请写清页面地址、操作步骤、预期结果、实际结果、设备类型和发生时间；不要附带密码、验证码、Cookie 或密钥。"],
        ["正式运营前", "我们会补充运营主体、公开客服邮箱、隐私负责人、处理时段和数据删除申请渠道。"],
      ],
    },
  }[route];
  return `<div class="page page--legal" data-demo-state="${state.isDemo}">${intro(route, state)}<article class="legal-document"><div class="legal-document__meta">${documents.updated}</div>${documents.sections.map(([heading, body]) => `<section><h2>${heading}</h2><p>${body}</p></section>`).join("")}<div class="legal-document__actions">${action("返回入山", "/auth", "button button--primary")}<a class="text-link" href="/contact" data-route="/contact">查看联系方式 ${icon("arrow")}</a></div></article></div>`;
}

export const PAGE_RENDERERS = {
  "/features": pageFeatures,
  "/": pageHome,
  "/auth": pageAuth,
  "/404": pageNotFound,
  "/privacy": (state) => pageLegal("/privacy", state),
  "/terms": (state) => pageLegal("/terms", state),
  "/contact": (state) => pageLegal("/contact", state),
  "/onboarding": pageOnboarding,
  "/goals": pageGoals,
  "/route": pageLearningRoute,
  "/cet": pageCET,
  "/plan": pagePlan,
  "/study": pageStudyWithDiagnostic,
  "/review": pageReview,
  "/knowledge": pageKnowledgeWithMaterials,
  "/assistant": pageAssistant,
  "/growth": pageGrowth,
  "/map": pageMap,
  "/profile": pageProfile,
  "/settings": pageSettings,
  "/admin": pageAdmin,
  "/state/loading": (state) => pageState("/state/loading", state),
  "/state/empty": (state) => pageState("/state/empty", state),
  "/state/error": (state) => pageState("/state/error", state),
  "/state/review": (state) => pageState("/state/review", state),
  "/state/permission": (state) => pageState("/state/permission", state),
};

export function renderPage(route, state) {
  const normalized = Object.hasOwn(ROUTES, route) ? route : "/404";
  return PAGE_RENDERERS[normalized](state);
}
