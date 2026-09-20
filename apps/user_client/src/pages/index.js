import { FEATURE_ITEMS, ROUTES, getRouteMeta } from "../data/routes.js";
import { assetUrl, getAsset } from "../data/assets.js";
import { icon, mark } from "../components/icons.js";
import { renderWorldMarker } from "../components/world-stage.js";
import { renderBaguaField } from "../components/bagua-field.js";

const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

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
  if (service.persistence === "durable" && service.api === "up" && !notice) return "";
  if (state?.isDemo) return "";
  return `<div class="persistence-notice" role="status"><strong>数据保存状态需要确认</strong><span>${esc(notice || "数据服务暂时未恢复，新的学习记录不会被当作已保存。请稍后重试。")}</span></div>`;
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
  const sceneAsset = getAsset("lijing-horizon-ink-v1");
  const routeReady = state.learningRoute?.draft?.status === "confirmed" || state.today.tasks.length > 0;
  const primaryHref = routeReady ? "/plan" : "/route";
  const primaryLabel = routeReady ? "开始今日行旅" : "继续建立路线";
  return `<div class="page page--home" data-demo-state="${state.isDemo}">
    <section class="home-hero">
      <div class="home-hero__copy">${demoNote(state)}<span class="page-intro__kicker">第零章 · 山门 / ${state.mountain.weather}</span><h1>向山顶<br><em>而行</em></h1><p>${routeReady ? "山顶很远，但今天只需要接住下一处营地。" : "先把目标、时间和现实约束放进路线里，砺境才知道今天该带你走哪一步。"}</p><div class="home-hero__actions">${action(primaryLabel, primaryHref)}<a class="text-link" href="/map" data-route="/map">遥望整座山系 ${icon("arrow")}</a></div></div>
      <div class="home-hero__summit"><div class="summit-mark">${renderWorldMarker()}<span>主峰</span><strong>${state.mountain.summitHeight.toLocaleString("zh-CN")}m</strong></div><span class="summit-mark__caption">你在 ${state.mountain.currentHeight.toLocaleString("zh-CN")}m 处<br>云隙中已经看见了下一处营地</span></div>
      <div class="home-hero__image" style="--image:url('${sceneAsset.path}')"><span>向上攀登<br><b>每一步都算数</b></span></div>
    </section>
    <section class="home-overview" data-tour-target="daily-panel"><div class="home-overview__lead"><span class="section-kicker">${routeReady ? `今日 · ${state.today.completed}/${state.today.total} 段行旅` : "下一步 · 建立第一条路线"}</span><h2>${routeReady ? "今天不必走完全程，<br><em>只要走好下一步。</em>" : "先把远方算清楚，<br><em>今天才有得走。</em>"}</h2><p>${routeReady ? `连续 ${state.today.streak} 日，你已经把坚持变成了山路的一部分。` : "你的入山信息已经保存。补充截止日期、当前基础和现实约束后，砺境会生成可核验的长期、年度、月度和每日计划。"}</p>${action(routeReady ? "进入当前山段" : "补充路线条件", routeReady ? "/study" : "/route", "button button--ink")}</div><div class="home-overview__stats">${metaLine("有效学习", `${state.today.minutes} 分钟`)}${metaLine("当前营地", state.mountain.nextCamp)}${metaLine("专注状态", `${state.balance.focus}%`)}<div class="home-overview__seal">${mark("☯")} <span>阴阳<br>有衡</span></div></div></section>
    <section class="home-route" data-tour-target="today-route"><div class="home-route__intro">${sectionTitle(routeReady ? "脚下的路" : "路线准备", routeReady ? "今日行旅" : "还差最后一段输入", action(routeReady ? "查看完整计划" : "继续建立路线", routeReady ? "/plan" : "/route", "text-link", "arrow"))}<p>${routeReady ? "完成一件具体的小事，山路就会向上延伸。" : "系统不会拿示例计划冒充你的结果；你确认路线后，今天的任务才会出现。"}</p></div>${routeReady ? `<div class="task-list">${state.today.tasks.slice(0, 3).map(taskItem).join("")}</div>` : `<div class="home-route__empty"><strong>目标和节律已经带入</strong><span>下一页只需要补充截止日期、当前基础和现实约束。</span>${action("开始补充路线", "/route", "button button--primary")}</div>`}</section>
    <section class="home-bottom"><div class="quote-panel"><span class="quote-panel__eyebrow">行者箴言 · 07</span><span class="quote-panel__seal">「</span><blockquote>不要因为山高而忘记<br>脚下这一阶。</blockquote><span class="quote-panel__author">砺境 · 行者箴言</span></div><div class="home-next"><span class="home-next__stamp">云后 / 章节生成中</span><span class="section-kicker">云后 · 下一阶段</span><h2>人生副本<br><em>正在远处生成</em></h2><p>当你登上这一座峰，回望来路，新的山系会在云海尽头开启。</p>${action("查看山海图", "/map", "button button--outline")}</div></section>
  </div>`;
}

function pageFeatures(state) {
  return `<div class="page page--features" data-demo-state="true">${intro("/features", state)}<section class="feature-directory"><div class="feature-directory__note"><span class="section-kicker">八方行旅 · 功能目录</span><h2>从一个方向<br><em>进入你的山路。</em></h2><p>八个方位对应八种行动。先选此刻需要的方向，之后仍然可以随时回到这里。</p></div>${renderBaguaField({ active: "", label: "功能目录 · 八方行旅", directoryItems: FEATURE_ITEMS })}</section></div>`;
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
        ? "服务端依赖尚未恢复，注册后请先在设置页确认数据保存状态。"
      : "正在核验数据保存方式；确认前请勿把当前账号当作跨设备存储。";
  const emailNotice = registering
    ? "当前试点只校验邮箱格式，不会发送验证邮件；请使用你能长期访问的地址。"
    : "登录后可在设置页查看邮箱状态；当前试点尚未接入邮件验证。";
  if (registering && invitationRequired) {
    return `<div class="page page--auth" data-demo-state="false" style="--auth-image: url('${assetUrl("lijing-auth-gate-v1")}')">
      <div class="auth-backdrop" aria-hidden="true"></div><div class="auth-wrap"><div class="auth-visual"><span class="auth-visual__seal">☷</span><span class="page-intro__kicker">入山 · 身份印记</span><h1>先为自己<br><em>立一座山门</em></h1><p class="auth-visual__value">砺境帮助你制定目标、生成学习计划，并用学习证据生成下一步。</p><div class="auth-visual__line"></div><span>砺境 · 云海登山系统</span></div>
      <div class="paper-panel auth-panel"><div class="panel-heading"><span class="section-kicker">限量试点登记</span><h2>立下山门</h2><p>本轮为限量邀请码试点。${accountPromise}</p></div><div class="auth-tabs" role="tablist" aria-label="账号操作"><button type="button" data-action="auth-mode" data-auth-mode="login" aria-selected="false">登录</button><button type="button" data-action="auth-mode" data-auth-mode="register" aria-selected="true">注册</button></div>
      <form class="auth-form" data-demo-form="auth" data-auth-mode="register"><label>邮箱<input name="email" type="email" placeholder="you@example.com" autocomplete="email" required></label><label>昵称<input name="display_name" type="text" placeholder="例如：林默" autocomplete="nickname" maxlength="80"></label><label>试点邀请码<input name="invite_code" type="text" autocomplete="off" minlength="12" maxlength="128" required></label><label>密码<input name="password" type="password" placeholder="至少 8 个字符" autocomplete="new-password" minlength="8" maxlength="128" required></label><button class="button button--primary" type="submit">创建账号 ${icon("arrow")}</button></form><p class="form-footnote">邀请码只能使用一次。请使用你能长期访问的邮箱；当前试点不会发送验证邮件。</p><button class="auth-recovery-link" type="button" data-action="forgot-password">忘记密码？</button><p class="form-footnote">当前为公开测试版；${accountPromise}</p><nav class="auth-legal-links" aria-label="公开说明"><a href="/privacy" data-route="/privacy">隐私说明</a><a href="/terms" data-route="/terms">用户协议</a><a href="/contact" data-route="/contact">联系方式</a></nav></div></div></div>`;
  }
  return `<div class="page page--auth" data-demo-state="false" style="--auth-image: url('${assetUrl("lijing-auth-gate-v1")}')"><div class="auth-backdrop" aria-hidden="true"></div><div class="auth-wrap"><div class="auth-visual"><span class="auth-visual__seal">☷</span><span class="page-intro__kicker">入山 · 身份印记</span><h1>先为自己<br><em>立一座山门</em></h1><p class="auth-visual__value">砺境帮助你制定目标、生成学习计划，并用学习证据生成下一步。</p><div class="auth-visual__line"></div><span>砺境 · 云海登山系统</span></div><div class="paper-panel auth-panel"><div class="panel-heading"><span class="section-kicker">${registering ? "新行者登记" : "行者登录"}</span><h2>${registering ? "立下山门" : "欢迎回来"}</h2><p>${registering ? `公开测试版，注册后即可开始；${accountPromise}` : `登录后继续你的目标、学习计划和学习证据。${persistence === "ephemeral" ? " 当前会话在服务重启后不会保留。" : ""}`}</p></div><div class="auth-tabs" role="tablist" aria-label="账号操作"><button type="button" data-action="auth-mode" data-auth-mode="login" aria-selected="${!registering}">登录</button><button type="button" data-action="auth-mode" data-auth-mode="register" aria-selected="${registering}">注册</button></div><form class="auth-form" data-demo-form="auth" data-auth-mode="${mode}"><label>邮箱<input name="email" type="email" placeholder="you@example.com" autocomplete="email" required></label>${registering ? `<label>昵称<input name="display_name" type="text" placeholder="例如：林默" autocomplete="nickname" maxlength="80"></label>` : ""}<label>密码<input name="password" type="password" placeholder="至少 8 个字符" autocomplete="${registering ? "new-password" : "current-password"}" minlength="8" maxlength="128" required></label><button class="button button--primary" type="submit">${registering ? "创建账号" : "登录并继续"} ${icon("arrow")}</button></form><p class="form-footnote">${emailNotice}</p><button class="auth-recovery-link" type="button" data-action="forgot-password">忘记密码？</button><p class="form-footnote">当前为公开测试版；${accountPromise}</p><nav class="auth-legal-links" aria-label="公开说明"><a href="/privacy" data-route="/privacy">隐私说明</a><a href="/terms" data-route="/terms">用户协议</a><a href="/contact" data-route="/contact">联系方式</a></nav></div></div></div>`;
}

function onboardingProfileStep(state) {
  const onboarding = state.onboarding ?? {};
  const profile = onboarding.profile ?? state.user;
  const selectedGoal = state.goals.find((goal) => goal.id === profile.target) ?? state.goals.find((goal) => goal.selected) ?? state.goals[0];
  const stages = ["高中学习", "大学学习", "考研备考", "职业转型", "兴趣探索"];
  const optionalFields = `<details class="onboarding-optional"><summary>补充更多资料 <small>可选</small><span aria-hidden="true">+</span></summary><div class="onboarding-form__grid"><label>学校<input name="school" type="text" value="${esc(profile.school ?? "")}" placeholder="例如：某某大学"></label><label>专业<input name="major" type="text" value="${esc(profile.major ?? "")}" placeholder="例如：计算机科学"></label><label>年龄<input name="age" type="number" min="13" max="100" value="${esc(profile.age ?? "")}" placeholder="用于更贴合资格和节律"></label><label>所在地区<input name="region" type="text" value="${esc(profile.region ?? "")}" placeholder="例如：江西"></label></div></details>`;
  return `<section class="onboarding-panel onboarding-profile-step"><div class="onboarding-panel__heading"><span class="section-kicker">入山引导 · 一次填写</span><h2>先说清你现在<br><em>最想完成什么。</em></h2><p>先完成最少信息，其他资料之后也能补充。</p></div><form class="onboarding-form" data-demo-form="onboarding-profile"><div class="onboarding-form__grid"><label>怎么称呼你<input name="name" type="text" value="${esc(profile.name ?? "")}" placeholder="例如：林默" required></label><label>你现在处于<select name="stage" required>${stages.map((stage) => `<option value="${stage}" ${stage === profile.stage ? "selected" : ""}>${stage}</option>`).join("")}</select></label></div>${optionalFields}<div class="onboarding-form__section"><span class="onboarding-form__label">你现在最想完成什么？</span><input type="hidden" name="goal" data-onboarding-goal value="${selectedGoal?.id ?? ""}"><div class="goal-options onboarding-goal-options">${state.goals.map((goal) => `<button class="goal-option ${goal.id === selectedGoal?.id ? "is-selected" : ""}" type="button" ${goal.available === false ? "disabled aria-disabled=\"true\"" : `data-goal="${goal.id}" aria-pressed="${goal.id === selectedGoal?.id}"`}><span class="goal-option__icon">${goal.icon}</span><span><strong>${goal.title}</strong><small>${goal.detail}</small></span><i>${goal.available === false ? "开发中" : goal.id === selectedGoal?.id ? icon("check", "已选择") : icon("arrow", "选择")}</i></button>`).join("")}</div></div><div class="onboarding-form__footer"><label>每天愿意留出的时间<input name="dailyMinutes" type="number" min="5" max="1440" step="5" value="${esc(profile.dailyMinutes ?? "25")}"><small>按你的真实节律填写</small></label><button class="button button--primary" type="submit">继续补充路线 ${icon("arrow")}</button></div></form></section>`;
}

function onboardingFeatureStep(state) {
  const goal = state.goals.find((item) => item.selected) ?? state.goals[0];
  const dailyMinutes = state.user?.dailyMinutes || state.onboarding?.profile?.dailyMinutes || "25";
  return `<section class="onboarding-panel onboarding-route-step"><div class="onboarding-panel__heading"><span class="section-kicker">第二步 · 建立路线</span><h2>你的方向已经有了，<br><em>现在只补充路线条件。</em></h2><p>下一页只问截止日期、每周时间和现实约束，生成后你先确认是否可行，再进入今天的学习。</p></div><div class="onboarding-handoff"><div class="onboarding-handoff__identity"><span>已准备好的入山信息</span><strong>${esc(goal?.title || "你的主方向")}</strong><small>${esc(state.user?.name || "行者")} · 每日 ${esc(dailyMinutes)} 分钟 · 默认引路已就位</small></div><div class="onboarding-route-checklist"><span>下一页会核对</span><strong>截止日期 · 每周时间 · 现实约束</strong><small>书鼎可以之后在“引路”里随时更换，不会挡住第一次开始学习。</small></div></div><div class="onboarding-actions"><button class="button button--outline" type="button" data-action="onboarding-back">返回修改信息</button><button class="button button--primary" type="button" data-action="onboarding-feature-next">开始补充路线条件 ${icon("arrow")}</button></div></section>`;
}

function pageOnboarding(state) {
  return `<div class="page page--onboarding" data-demo-state="${state.isDemo}"><div class="onboarding-head"><div><span class="page-intro__kicker">入山引导 · 一次填写</span><h1>先说清目标和时间，<br><em>再拿到今天这一步。</em></h1></div><div class="onboarding-head__aside">${demoNote(state)}<span class="onboarding-nav-note">约 2 分钟 · 可随时修改</span></div></div>${onboardingProfileStep(state)}</div>`;
}

function pageGoals(state) {
  return `<div class="page page--goals" data-demo-state="${state.isDemo}">${intro("/goals", state, "第一章 · 试点方向")}<div class="goals-layout"><section class="goal-selection"><div class="section-title"><div><span>当前仅开放考研试点</span><h2>先把一个闭环<br><em>做到值得每天打开。</em></h2></div>${demoNote(state)}</div><div class="goal-options">${state.goals.map((goal) => `<button class="goal-option ${goal.selected ? "is-selected" : ""}" type="button" ${goal.available === false ? "disabled aria-disabled=\"true\"" : `data-goal="${goal.id}" aria-pressed="${goal.selected}"`}><span class="goal-option__icon">${goal.icon}</span><span><strong>${goal.title}</strong><small>${goal.detail}</small></span><i>${goal.available === false ? "开发中" : goal.selected ? icon("check", "已选择") : icon("arrow", "选择")}</i></button>`).join("")}</div><div class="goal-foot"><a class="button button--primary" href="/route" data-action="complete-onboarding">建立考研路线${icon("arrow")}</a><span>考公、技能与生活方向仍在开发，不拿未验证的能力冒充已开放功能。</span></div></section><aside class="orientation-panel"><div class="orientation-panel__bagua">${renderBaguaField({ active: "乾", compact: true, label: "当前方位 · 乾位" })}</div><h3>先把备考落在<br>可行的时间里</h3><p>先核算可用时间，再给出今天能执行的一步。</p></aside></div></div>`;
}

function defaultRouteTargetDate() {
  const date = new Date();
  date.setMonth(date.getMonth() + 6);
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
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

function assessmentOptions(group, selected) {
  return Object.entries(ROUTE_ASSESSMENT_LABELS[group]).map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function routeAssessmentForm(assessment) {
  const value = {
    subject: "",
    study_stage: "not_started",
    recent_result: "no_recent_practice",
    primary_blocker: "concept",
    evidence: "",
    ...assessment,
  };
  return `<fieldset class="route-assessment"><legend>起点校准 · 先测一科</legend><p>这不是系统给你的分数。先交代一个真实样本，确认路线后第一段会用独立练习核对它。</p><div class="route-form__grid"><label>先校准哪一科<input name="assessment_subject" type="text" maxlength="80" value="${esc(value.subject)}" placeholder="例如：数学二 · 高等数学" required></label><label>目前学到哪里<select name="assessment_study_stage">${assessmentOptions("study_stage", value.study_stage)}</select></label><label>最近一次不看答案的练习<select name="assessment_recent_result">${assessmentOptions("recent_result", value.recent_result)}</select></label><label>最主要卡点<select name="assessment_primary_blocker">${assessmentOptions("primary_blocker", value.primary_blocker)}</select></label></div><label>写一条真实样本<textarea name="assessment_evidence" rows="4" minlength="12" maxlength="360" placeholder="例如：极限题会套公式，但遇到分段函数不知道先判断什么；最近 5 题只独立完成了 2 题。" required>${esc(value.evidence)}</textarea><small>写题型、你的判断或卡住的位置即可；不要把“我感觉还行”当作测评结果。</small></label></fieldset>`;
}

function routeAssessmentSummary(assessment) {
  if (!assessment) return "";
  const stage = ROUTE_ASSESSMENT_LABELS.study_stage[assessment.study_stage] ?? "未标记";
  const result = ROUTE_ASSESSMENT_LABELS.recent_result[assessment.recent_result] ?? "未标记";
  const blocker = ROUTE_ASSESSMENT_LABELS.primary_blocker[assessment.primary_blocker] ?? "未标记";
  return `<section class="route-assessment-summary"><div><span class="section-kicker">起点校准 · 学习者陈述</span><h3>${esc(assessment.subject)}</h3><p>第一段会用独立练习核对，不把这份陈述当作已验证的分数或掌握结论。</p></div><dl><div><dt>学习阶段</dt><dd>${esc(stage)}</dd></div><div><dt>最近练习</dt><dd>${esc(result)}</dd></div><div><dt>主要卡点</dt><dd>${esc(blocker)}</dd></div></dl><blockquote>${esc(assessment.evidence)}</blockquote></section>`;
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
  const compactPlan = plan ? `<section class="route-next-step"><div><span class="section-kicker">确认后会展开</span><h3>先走当前这一段</h3><p>${esc(currentMonth?.title ?? draft.milestones[0]?.title ?? "当前阶段")}</p></div><div><span>今天的第一步</span><strong>${esc(firstTask?.title ?? "确认后生成今日任务")}</strong><small>${firstTask ? `${firstTask.planned_minutes} 分钟 · ${esc(firstTask.action || firstTask.review_prompt)}` : "确认后进入今日计划"}</small></div></section>` : "";
  const confirmationLabel = draft.feasibility.status === "tight" ? "接受紧凑安排，开始今天这一步" : "确认路线，开始今天这一步";
  return `<section class="route-draft"><div class="route-draft__header"><div><span class="section-kicker">${draft.status === "confirmed" ? "已确认路线" : "AI 路线草案"}</span><h2>${esc(draft.goal.name)}</h2><p>${esc(draft.summary)}</p></div><span class="route-feasibility route-feasibility--${esc(draft.feasibility.status)}">${feasibilityText}</span></div><div class="route-capacity"><div><span>距目标</span><strong>${draft.feasibility.days_remaining} 天</strong></div><div><span>可用时长</span><strong>${draft.feasibility.total_available_hours} 小时</strong></div><div><span>计划时长</span><strong>${draft.feasibility.planned_hours} 小时</strong></div><div><span>每日投入</span><strong>${draft.plan?.daily_minutes ?? draft.goal?.daily_minutes ?? "-"} 分钟</strong></div></div><p class="route-capacity__note">${esc(draft.feasibility.message)}</p>${assessment}${compactPlan}<div class="route-draft__body"><div class="route-milestones"><span class="section-kicker">阶段路线</span>${draft.milestones.map((milestone, index) => `<article class="route-milestone"><span>0${index + 1}</span><div><small>${esc(milestone.start_date)} 至 ${esc(milestone.end_date)} · ${milestone.planned_hours} 小时</small><h3>${esc(milestone.title)}</h3><ul>${milestone.outcomes.map((outcome) => `<li>${esc(outcome)}</li>`).join("")}</ul></div></article>`).join("")}</div><aside class="route-verification"><span class="section-kicker">确认前核验</span><h3>只核对会影响路线的事实</h3><ul>${draft.facts_to_confirm.map((fact) => `<li>${esc(fact)}</li>`).join("")}</ul><div class="route-sources">${draft.sources.slice(0, 3).map((source) => `<a href="${esc(source.official_url)}" target="_blank" rel="noreferrer"><strong>${esc(source.title)}</strong><small>${esc(source.publisher)} · ${esc(source.freshness)}</small></a>`).join("")}</div><div class="route-evidence"><span class="section-kicker">已接入依据 · ${esc(draft.knowledge_index_version ?? "未标记")}</span><p>${evidence.length ? `已结合 ${evidence.length} 条审核知识片段；动态信息仍需你在官方来源中确认。` : "当前没有可展示的检索片段，只保留行动建议并要求人工核验。"}</p></div>${canConfirm ? `<button class="button button--primary" type="button" data-action="confirm-learning-route" data-route-id="${esc(draft.id)}" data-route-version="${draft.version}">${confirmationLabel} ${icon("check")}</button>` : draft.status === "confirmed" ? `<span class="route-confirmed">${icon("check", "已确认")} 已作为后续学习计划依据</span>` : `<span class="route-blocked">调整截止日期、每周时间或目标范围后，再生成草案。</span>`}</aside></div></section>`;
}

function pageLearningRoute(state) {
  const draft = state.learningRoute?.draft ?? null;
  const savedForm = state.learningRoute?.form ?? {};
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
  const assessment = formGoal.baseline_assessment ?? { subject: formGoal.focus_areas?.[0] ?? "", study_stage: "not_started", recent_result: "no_recent_practice", primary_blocker: "concept", evidence: "" };
  const goalType = formGoal.type ?? "postgraduate_entrance_exam";
  const targetDate = formGoal.target_date ?? defaultRouteTargetDate();
  const currentDate = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const firstRoute = !draft && !state.onboarding?.completed;
  const selectedGoal = state.goals.find((goal) => goal.selected);
  return `<div class="page page--route" data-demo-state="${state.isDemo}">${intro("/route", state)}<div class="route-layout"><section class="route-intake"><div class="section-title"><div><span>${firstRoute ? "考研试点信息已带入" : "真实条件"}</span><h2>${firstRoute ? "先校准起点，<br><em>再生成今天这一步。</em>" : "给路线一张<br><em>可以落地的底图。</em>"}</h2></div><span class="route-intake__stamp">${state.isDemo ? "登录后可生成" : "SERVER AI"}</span></div>${firstRoute ? `<div class="route-context"><strong>${esc(selectedGoal?.title || state.user?.target || "考研备考")}</strong><span>${esc(state.user?.name || "行者")} · 每日 ${esc(state.user?.dailyMinutes || "25")} 分钟</span><small>首期只做考研伴学：先留下真实起点，再核算时间和路线。</small></div>` : ""}<form class="route-form" data-demo-form="learning-route"><input name="goal_type" type="hidden" value="${esc(goalType)}"><label>当前试点方向<input value="考研备考" readonly aria-readonly="true"><small>考公、就业与泛学习方向开发中，暂不开放建路。</small></label><label>目标名称<input name="goal_name" type="text" maxlength="120" value="${esc(formGoal.name ?? "")}" placeholder="例如：2027 计算机专业硕士复习" required></label><input name="daily_minutes" type="hidden" value="${esc(formGoal.daily_minutes ?? state.user.dailyMinutes ?? 25)}"><div class="route-form__grid"><label>目标日期<input name="target_date" type="date" min="${currentDate}" value="${esc(targetDate)}" required></label><label>每周可投入小时<input name="weekly_hours" type="number" min="1" max="60" step="1" value="${esc(formGoal.weekly_hours ?? state.user.weeklyHours ?? 8)}" required></label><label>报考地区 <small>可选</small><input name="region" type="text" maxlength="120" value="${esc(formGoal.region ?? state.user.region ?? "")}" placeholder="例如：江西"></label><label>重点科目 <small>可选，多个用中文逗号隔开</small><input name="focus_areas" type="text" maxlength="500" value="${esc((formGoal.focus_areas ?? []).join("，"))}" placeholder="例如：数学，英语，专业课，政治"></label></div>${routeAssessmentForm(assessment)}<label>现实约束 <small>每行一条，可选</small><textarea name="constraints" rows="4" maxlength="1600" placeholder="例如：工作日只能晚上学习&#10;周末可安排整块时间">${esc((formGoal.constraints ?? []).join("\n"))}</textarea></label><button class="button button--ink" type="submit">先生成独立诊断，再建立路线 ${icon("arrow")}</button></form></section>${learningRouteResult(draft, state.learningRoute?.clarification, state.learningRoute?.error)}</div></div>`;
}

function pagePlanLegacy(state) {
  const routePlan = state.learningRoute?.draft?.plan;
  const routeTasks = routePlan?.today?.tasks ?? [];
  const tasks = routeTasks.length ? routeTasks.map((task) => ({ id: task.id, type: task.type, title: task.title, meta: `${task.planned_minutes} 分钟 · ${task.action || task.review_prompt}${task.expected_output ? ` · 产出：${task.expected_output}` : ""}`, status: task.completion_status === "active" ? "active" : task.completion_status === "done" ? "done" : "locked", gua: task.type === "复盘" ? "☵" : "☲" })) : state.today.tasks;
  const routeMonths = routePlan?.current_year?.months ?? routePlan?.months ?? [];
  return `<div class="page page--plan" data-demo-state="${state.isDemo}">${intro("/plan", state)}<div class="plan-head"><div class="plan-head__progress"><span>${routePlan ? "当前年度计划" : "本阶段行进"}</span><strong>${routePlan?.current_year?.year ?? state.mountain.currentHeight.toLocaleString("zh-CN")} <small>${routePlan ? `· ${routeMonths.length} 个月已展开` : `/ ${state.mountain.summitHeight.toLocaleString("zh-CN")}m`}</small></strong>${progressBar(routePlan ? Math.min(100, Math.round(((routeMonths.findIndex((month) => month.month === routePlan.today.date.slice(0, 7)) + 1) / Math.max(1, routeMonths.length)) * 100)) : state.mountain.visiblePercent)}<div><span>长期主线</span><span>当前年度</span><span>今日行动</span></div></div><div class="plan-head__balance"><div class="balance-wheel balance-wheel--large"><span></span><b>☯</b></div><div><span>今日完成</span><strong>${routePlan ? `${tasks.filter((task) => task.status === "done").length} / ${tasks.length}` : `${state.today.completed} / ${state.today.total}`}</strong><p>${routePlan ? `每日 ${routePlan.daily_minutes} 分钟 · ${routePlan.today.date}` : "该收束时，就好好收束。"}</p></div></div></div>${routePlan ? `<section class="plan-horizon"><span class="section-kicker">多年路线 · ${routePlan.horizon.years.length} 年</span>${routePlan.horizon.years.map((year) => `<article><strong>${year.year}</strong><span>${esc(year.title)}</span><small>${esc(year.objective)}</small></article>`).join("")}</section>` : ""}<div class="plan-route"><div class="plan-route__label"><span>${routePlan ? routePlan.today.date : "DAY 07"}</span><strong>${routePlan ? "今日计划" : "九月 · 第四日"}</strong><small>完成后会进入复盘并更新下一步</small></div><div class="plan-route__list">${tasks.map(taskItem).join("")}<div class="route-future"><span class="route-future__line"></span><span class="route-future__cloud">云后还有一处营地</span></div></div></div></div>`;
}

function pagePlan(state) {
  const routePlan = state.learningRoute?.draft?.plan;
  const routeTasks = routePlan?.today?.tasks ?? [];
  const tasks = routeTasks.length ? routeTasks.map((task) => ({ id: task.id, type: task.type, title: task.title, meta: `${task.planned_minutes} 分钟 · ${task.action || task.review_prompt}${task.expected_output ? ` · 产出：${task.expected_output}` : ""}`, status: task.completion_status === "active" ? "active" : task.completion_status === "done" ? "done" : "locked", gua: task.type === "复盘" ? "☵" : "☲" })) : state.today.tasks;
  const routeMonths = routePlan?.current_year?.months ?? routePlan?.months ?? [];
  const progress = routePlan ? Math.min(100, Math.round(((routeMonths.findIndex((month) => month.month === routePlan.today.date.slice(0, 7)) + 1) / Math.max(1, routeMonths.length)) * 100)) : state.mountain.visiblePercent;
  const nextAction = routePlan ? action("开始当前山段", "/study", "button button--ink") : action("先建立路线", "/route", "button button--primary");
  return `<div class="page page--plan" data-demo-state="${state.isDemo}">${intro("/plan", state)}<div class="plan-head"><div class="plan-head__progress"><span>${routePlan ? "当前年度计划" : "本阶段行进"}</span><strong>${routePlan?.current_year?.year ?? state.mountain.currentHeight.toLocaleString("zh-CN")} <small>${routePlan ? `· ${routeMonths.length} 个月已展开` : `/ ${state.mountain.summitHeight.toLocaleString("zh-CN")}m`}</small></strong>${progressBar(progress)}<div><span>长期主线</span><span>当前年度</span><span>今日行动</span></div></div><div class="plan-head__balance"><div class="balance-wheel balance-wheel--large"><span></span><b>☯</b></div><div><span>今日完成</span><strong>${routePlan ? `${tasks.filter((task) => task.status === "done").length} / ${tasks.length}` : `${state.today.completed} / ${state.today.total}`}</strong><p>${routePlan ? `每日 ${routePlan.daily_minutes} 分钟 · ${routePlan.today.date}` : "该收束时，就好好收束。"}</p>${routePlan?.requested_daily_minutes && routePlan.requested_daily_minutes !== routePlan.daily_minutes ? `<small class="plan-update-note">你填写了每日 ${routePlan.requested_daily_minutes} 分钟；按每周 ${routePlan.weekly_hours} 小时，当前按 ${routePlan.daily_minutes} 分钟排入。</small>` : ""}${routePlan?.update_reason ? `<small class="plan-update-note">${esc(routePlan.update_reason)}</small>` : ""}</div></div></div>${routePlan ? `<section class="plan-horizon"><span class="section-kicker">多年路线 · ${routePlan.horizon.years.length} 年</span>${routePlan.horizon.years.map((year) => `<article><strong>${year.year}</strong><span>${esc(year.title)}</span><small>${esc(year.objective)}</small></article>`).join("")}</section>` : ""}<div class="plan-route"><div class="plan-route__label"><span>${routePlan ? routePlan.today.date : "DAY 07"}</span><strong>${routePlan ? "今日计划" : "九月 · 第四日"}</strong><small>当前计划由服务端按时间约束生成；完成后会进入复盘并更新下一步。</small>${nextAction}</div><div class="plan-route__list">${tasks.map(taskItem).join("")}<div class="route-future"><span class="route-future__line"></span><span class="route-future__cloud">云后还有一处营地</span></div></div></div></div>`;
}

function evidenceLevelItem(item, selected) {
  return `<button class="evidence-level ${selected ? "is-selected" : ""}" type="button" data-action="select-evidence" data-evidence-level="${item.level}" aria-pressed="${selected}"><span class="evidence-level__number">L${item.level}</span><span><strong>${item.title}</strong><small>${item.detail}</small></span>${selected ? icon("check", "已选择") : icon("arrow", "选择")}</button>`;
}

const DIAGNOSTIC_OUTCOME_LABELS = {
  correct: "按已有答案核对：正确",
  incorrect: "按已有答案核对：错误",
  unverified: "尚未与答案核对",
};

function isInitialDiagnosticTask(task) {
  return task?.type === "诊断" && /起点校准/.test(task.title ?? "");
}

function initialDiagnosticForm(task) {
  const subject = task.title.replace(/^起点校准 · /, "").replace(/独立练习$/, "").trim() || "当前科目";
  const rows = [1, 2, 3].map((index) => `<article class="diagnostic-item"><div class="diagnostic-item__head"><span>0${index}</span><strong>独立作答</strong></div><div class="diagnostic-item__grid"><label>题目或来源<input data-diagnostic-source="${index}" type="text" minlength="6" maxlength="120" placeholder="例如：2023 数二真题选择第 4 题" required></label><label>对照结果<select data-diagnostic-outcome="${index}">${Object.entries(DIAGNOSTIC_OUTCOME_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label><label>本题用时（分钟）<input data-diagnostic-minutes="${index}" type="number" min="1" max="180" step="1" placeholder="例如：8" required></label></div><label>判断依据或卡住位置<textarea data-diagnostic-note="${index}" rows="2" minlength="4" maxlength="180" placeholder="写你如何判断，或具体卡在哪一步；不要只写“不会”。" required></textarea></label></article>`).join("");
  return `<section class="initial-diagnostic" data-initial-diagnostic data-diagnostic-subject="${esc(subject)}"><div class="initial-diagnostic__heading"><div><span>首日独立诊断 · ${esc(subject)}</span><h3>用三道真实题，校准今天从哪里开始。</h3></div><b>L3</b></div><p>从你的真题、习题册或课程练习中各选一道，先独立作答，再按原题答案自行核对。砺境只记录过程和结果，不生成虚假分数，也不宣称你已经掌握。</p><div class="diagnostic-items">${rows}</div><small>提交后会保存正确/错误/未核对数量、总用时和卡点，并把下一段行动缩到这份记录能支持的范围。</small></section>`;
}

function diagnosticAdjustment(state) {
  const diagnostic = state.pilot?.initialDiagnostic;
  if (!diagnostic?.nextAction) return "";
  return `<section class="plan-diagnostic-note"><span>起点诊断已写入</span><strong>${esc(diagnostic.subject)} · 正确 ${diagnostic.correct} / 错误 ${diagnostic.incorrect} / 待核对 ${diagnostic.unverified} · ${diagnostic.totalMinutes} 分钟</strong><p>${esc(diagnostic.nextAction)}</p></section>`;
}

function evidenceReview(state) {
  const review = state.pilot.review ?? {
    evidenceUsed: "本地已保存用户提交的证据",
    problem: "本轮还没有生成复盘。",
    reason: "提交证据后，系统才会依据可复查的内容提出下一步。",
    nextAction: "检查服务配置后重新提交，不自动推断学习结果。",
  };
  const evidence = state.pilot.submittedEvidence ? `用户提交：${esc(state.pilot.submittedEvidence)}` : review.evidenceUsed;
  const status = reviewStatusFor(state);
  return `<section class="evidence-review"><div class="section-title"><div><span>行动型 AI 复盘</span><h2>下一步不是一句鼓励，<br><em>而是一件明天能做的事。</em></h2></div><span class="evidence-review__status">${status}</span></div><div class="evidence-review__grid"><div class="evidence-review__cell evidence-review__cell--evidence"><span>用了什么证据</span><strong>${evidence}</strong></div><div class="evidence-review__cell evidence-review__cell--problem"><span>发现了什么问题</span><strong>${esc(review.problem)}</strong></div><div class="evidence-review__cell evidence-review__cell--reason"><span>为什么这样判断</span><strong>${esc(review.reason)}</strong></div><div class="evidence-review__cell evidence-review__next"><span>明日行动</span><strong>${esc(review.nextAction)}</strong></div></div></section>`;
}

function reviewStatusFor(state) {
  if (state.pilot?.reviewReady && state.pilot?.review) return "AI 复盘";
  if (state.pilot?.review && (state.pilot?.reviewError || state.pilot?.initialDiagnostic)) return "规则复盘";
  return state.isDemo ? "演示样例" : "待提交";
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
  const diagnosis = companion.diagnosisSummary ?? null;
  const evidenceLevels = state.pilot?.evidenceLevels ?? [];
  const selectedLevel = Number(state.pilot?.selectedEvidenceLevel ?? 2);
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const actionArtifacts = currentAction?.artifact_refs?.map((id) => artifactById.get(id)).filter(Boolean) ?? [];

  if (!currentAction) {
    return `<div class="page page--study page--study-material" data-demo-state="${state.isDemo}">${intro("/study", state, "材料驱动 · 先把卡住的地方交给器灵")}${persistenceNotice(state)}<div class="study-layout"><section class="study-focus study-focus--material"><div class="study-focus__top"><span class="section-kicker">${companion.screenState === "need_material" ? "等待你的材料" : "材料入口"}</span>${demoNote(state)}<span class="study-focus__timer">文本材料</span></div><div class="study-focus__title"><span class="study-focus__gua">器</span><h2>先把正在卡住的地方交出来</h2><p>可以是一道题、一段笔记、作答草稿或错因说明。器灵只根据你给出的内容判断，不替你编造错因。</p></div><section class="study-action material-intake"><div class="study-action__heading"><span>第一步 · 留下可检索的材料</span><h3>材料 → 诊断 → 一条现在能完成的行动</h3><p>首版只接收文字，保存后会按你的账号隔离，并保留引用位置。</p></div><form class="material-intake__form" data-demo-form="learning-artifact"><div class="material-intake__grid"><label>材料标题<input name="source_title" type="text" maxlength="160" placeholder="例如：极限题 12 · 洛必达条件混淆" required></label><label>科目<select name="subject"><option value="数学" selected>数学</option><option value="408">408</option><option value="数学 / 408">数学 / 408</option></select></label><label>材料类型<select name="kind"><option value="question" selected>题目</option><option value="note">笔记</option><option value="attempt_draft">作答草稿</option><option value="answer_reference">错因说明 / 参考答案</option></select></label></div><label>粘贴材料<textarea name="content_text" rows="10" maxlength="12000" placeholder="把题干、你的思路、写到哪一步、哪里不确定一起贴进来……" required></textarea></label><div class="material-intake__footer"><span>建议包含：题目条件、你的尝试、卡住的位置。</span><button class="button button--ink" type="submit">交给器灵 ${icon("arrow")}</button></div></form>${artifacts.length ? `<div class="material-library"><div class="material-library__head"><span>已保存材料</span><strong>${artifacts.length} 份</strong></div><div class="material-library__list">${artifacts.slice(0, 4).map((artifact) => `<article><span>${esc(artifact.kind)}</span><strong>${esc(artifact.source_title)}</strong><small>${esc(artifact.subject)} · ${esc(artifact.updated_at ? new Date(artifact.updated_at).toLocaleDateString("zh-CN") : "刚刚")}</small></article>`).join("")}</div></div>` : ""}</section><aside class="study-aside"><section class="study-aside__tip"><span class="study-aside__tip-mark">知</span><div class="study-aside__tip-copy"><span>器灵的边界</span><p>没有材料，就没有诊断；没有证据，就不把一次完成写成掌握。</p><a href="/assistant" data-route="/assistant">先问一个问题 ${icon("arrow")}</a></div></section></aside></div></div>`;
  }

  const terminal = ["completed", "superseded", "skipped"].includes(currentAction.status);
  const canWrite = !state.isDemo && !terminal;
  const relatedMaterial = actionArtifacts.length
    ? actionArtifacts.map((artifact) => `<span class="material-ref">${esc(artifact.source_title)}</span>`).join("")
    : currentAction.artifact_refs?.map((id) => `<span class="material-ref">材料 ${esc(id)}</span>`).join("") ?? "";
  const citationBlock = citations.length
    ? `<div class="material-citations"><div class="material-citations__head"><span>材料引用</span><small>只来自你的私人材料</small></div>${citations.map((citation) => `<article><span>${esc(citation.title)} · ${esc(citation.chunk_id)}</span><p>${esc(citation.excerpt)}</p><small>位置 ${citation.locator?.start ?? 0}-${citation.locator?.end ?? 0}</small></article>`).join("")}</div>`
    : "";
  const diagnosisBlock = diagnosis
    ? `<div class="material-diagnosis"><span>当前判断</span><p>${esc(diagnosis.reason ?? currentAction.reason)}</p>${Array.isArray(diagnosis.unknowns) && diagnosis.unknowns.length ? `<small>仍未知：${esc(diagnosis.unknowns.join("；"))}</small>` : ""}</div>`
    : "";
  const controls = canWrite ? `<div class="study-action__controls">${["planned", "stuck"].includes(currentAction.status) ? `<button class="button button--ink" type="button" data-action="companion-check-in" data-companion-intent="start" data-task-id="${esc(currentAction.id)}" data-action-version="${currentAction.version}">${currentAction.status === "planned" ? "开始这一条" : "继续这一条"} ${icon("play")}</button>` : ""}<label>卡住原因<select data-companion-blocker><option value="difficulty">内容太难</option><option value="time">时间不够</option><option value="emotion">状态不稳</option><option value="environment">环境受限</option><option value="unknown">说不清楚</option></select></label><button class="button button--outline" type="button" data-action="companion-check-in" data-companion-intent="stuck" data-task-id="${esc(currentAction.id)}" data-action-version="${currentAction.version}">我卡住了</button><button class="text-link" type="button" data-action="companion-check-in" data-companion-intent="skip" data-task-id="${esc(currentAction.id)}" data-action-version="${currentAction.version}">先缩小这一步</button></div>` : terminal ? `<div class="material-terminal"><span>这条行动已经关闭</span><p>页面不再提供写入控件，刷新后以服务端状态为准。</p></div>` : "";
  const evidenceForm = canWrite ? `<form class="material-evidence" data-demo-form="material-evidence" data-action-id="${esc(currentAction.id)}" data-action-version="${currentAction.version}"><div class="section-title"><div><span>完成证据</span><h2>你实际留下了什么？</h2></div><span class="evidence-submit__level">选择一档</span></div><p>${esc(currentAction.expected_evidence)}</p><div class="material-evidence__levels">${evidenceLevels.map((item) => `<label class="material-evidence__level"><input type="radio" name="evidence_level" value="${item.level}" ${item.level === selectedLevel ? "checked" : ""}><span><strong>L${item.level} · ${esc(item.title)}</strong><small>${esc(item.detail)}</small></span></label>`).join("")}</div><label class="material-evidence__field">证据内容<textarea name="evidence" rows="6" maxlength="1200" placeholder="写下你做了什么、得到什么、还卡在哪里……" required></textarea></label><button class="button button--ink" type="submit">提交证据并生成下一步 ${icon("arrow")}</button></form>` : "";
  return `<div class="page page--study page--study-material" data-demo-state="${state.isDemo}">${intro("/study", state, "材料驱动 · 唯一行动卡")}${persistenceNotice(state)}<div class="study-layout"><section class="study-focus study-focus--material"><div class="study-focus__top"><span class="section-kicker">器灵同行 · ${companionStatus(currentAction.status)}</span>${demoNote(state)}<span class="study-focus__timer">${currentAction.estimated_minutes} 分钟</span></div><div class="study-focus__title"><span class="study-focus__gua">器</span><h2>${esc(currentAction.title)}</h2><p>这张行动卡只对应你当前提交的材料，并且带有版本号。做完后留下证据，下一步才会生成。</p></div><section class="study-action"><div class="study-action__heading"><span>为什么现在做</span><h3>${esc(currentAction.reason)}</h3><p>${relatedMaterial}</p></div>${controls}</section>${diagnosisBlock}${citationBlock}${evidenceForm}</section><aside class="study-aside"><section class="study-aside__tip"><span class="study-aside__tip-mark">行</span><div class="study-aside__tip-copy"><span>完成标准</span><p>${esc(currentAction.expected_evidence)}</p><a href="/knowledge" data-route="/knowledge">查看材料来源 ${icon("arrow")}</a></div></section></aside></div></div>`;
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
    return `<div class="page page--study page--study-empty">${intro("/study", state)}<section class="empty-panel"><span class="section-kicker">当前还没有学习任务</span><h2>先完成入山信息，<br><em>再建立你的第一段路线。</em></h2><p>这里不会展示合成题目或虚构进度。完成目标、节律和引路器设置后，服务端才会为你的账号保存真实学习记录。</p>${action("继续入山引导", "/onboarding", "button button--ink")}</section></div>`;
  }
  const routeTask = state.learningRoute?.draft?.plan?.today?.tasks?.find((task) => task.id === active.id);
  const status = cycleAppliesToTask ? cycle.status : "planned";
  const canCheckIn = !state.isDemo && Boolean(cycleTask) && status !== "completed";
  const startLabel = status === "planned" ? "开始这一段" : "继续这一段";
  const actionText = routeTask?.action || `先完成“${active.title}”中最小、可留下痕迹的一步。`;
  const intervention = (cycleAppliesToTask && (companion.nextAction || cycle?.intervention?.next_action)) || `先开始“${active.title}”中最小、可留下痕迹的一步。`;
  return `<div class="page page--study" data-demo-state="${state.isDemo}">${intro("/study", state)}<div class="study-layout"><section class="study-focus"><div class="study-focus__top"><span class="section-kicker">当前山段 · ${esc(active.type)}</span>${demoNote(state)}<span class="study-focus__timer">${active.estimated_minutes ?? routeTask?.planned_minutes ?? 25} 分钟</span></div><div class="study-focus__title"><span class="study-focus__gua">${active.gua}</span><h2>${esc(active.title)}</h2><p>完成时留下你能提供的最高等级证据。砺境不会把一次自报完成变成“已掌握”。</p></div><section class="study-action" aria-label="今日行动"><div class="study-action__heading"><span>器灵同行 · ${companionStatus(status)}</span><h3>${esc(actionText)}</h3><p>${esc(intervention)}</p></div>${canCheckIn ? `<div class="study-action__controls">${status === "started" ? "" : `<button class="button button--ink" type="button" data-action="companion-check-in" data-companion-intent="start" data-task-id="${esc(active.id)}">${startLabel} ${icon("play")}</button>`}<label>卡住原因<select data-companion-blocker><option value="difficulty">内容太难</option><option value="time">时间不够</option><option value="emotion">状态不稳</option><option value="environment">环境受限</option><option value="unknown">说不清楚</option></select></label><button class="button button--outline" type="button" data-action="companion-check-in" data-companion-intent="stuck" data-task-id="${esc(active.id)}">我卡住了</button><button class="text-link" type="button" data-action="companion-check-in" data-companion-intent="skip" data-task-id="${esc(active.id)}">今天先缓一缓</button></div>` : ""}</section><div class="evidence-submit"><div class="section-title"><div><span>完成证据</span><h2>你这次留下了什么？</h2></div><span class="evidence-submit__level">当前 L${state.pilot.selectedEvidenceLevel}</span></div><p>选择最高证据等级，并用一句话记录内容。完成证据会先写入今日行动，再进入复盘。</p><div class="evidence-levels">${state.pilot.evidenceLevels.map((item) => evidenceLevelItem(item, item.level === state.pilot.selectedEvidenceLevel)).join("")}</div><label class="evidence-submit__field">证据摘要<textarea data-evidence-input rows="4" placeholder="例如：写下一个反例，并说明它为什么能支持当前结论。">${esc(state.pilot.submittedEvidence)}</textarea></label><button class="button button--ink" type="button" data-action="submit-evidence" data-task-id="${esc(active.id)}" ${status === "completed" ? "disabled" : ""}>提交证据并生成复盘 ${icon("arrow")}</button><div class="study-knowledge-capture"><div class="study-knowledge-capture__copy"><span>可选 · 留下脉络</span><strong>把这次理解接入知识库</strong><small>以后复习时，从这条记录继续。</small></div><button class="knowledge-capture-link" type="button" data-action="capture-knowledge" data-knowledge-title="${esc(active.title)}" data-knowledge-source="攀登 · 当前山段">记入知识库 ${icon("arrow")}</button></div></div></section><aside class="study-aside"><div class="study-aside__route"><span class="section-kicker">试点记录</span><div class="mini-mountain"><span class="mini-mountain__path"></span><i class="mini-mountain__dot mini-mountain__dot--one"></i><i class="mini-mountain__dot mini-mountain__dot--two"></i><i class="mini-mountain__dot mini-mountain__dot--three"></i></div><div class="study-aside__legend"><span><i class="dot dot--gold"></i>今日任务</span><span><i class="dot dot--gray"></i>证据解锁下一步</span></div></div><div class="study-aside__tip"><span class="study-aside__tip-mark">灯</span><div class="study-aside__tip-copy"><span>卡住时的下一步</span><p>${esc(intervention)}</p><a href="/review" data-route="/review">查看复盘记录 ${icon("arrow")}</a></div></div></aside></div></div>`;
}

function pageStudyWithDiagnostic(state) {
  if (!state.isDemo && (state.companionCycle?.screenState === "need_material" || state.companionCycle?.currentAction)) return materialStudyPage(state);
  const html = pageStudy(state);
  const companionTask = state.companionCycle?.task ?? state.companionCycle?.cycle?.task ?? null;
  const active = companionTask ?? state.today.tasks.find((task) => task.status === "active") ?? state.today.tasks.at(-1);
  const routeTask = state.learningRoute?.draft?.plan?.today?.tasks?.find((task) => task.id === active?.id);
  if (isInitialDiagnosticTask(routeTask ?? active)) {
    const evidenceStart = html.indexOf('<div class="evidence-submit">');
    const evidenceEnd = html.indexOf('</section><aside class="study-aside">', evidenceStart);
    if (evidenceStart !== -1 && evidenceEnd !== -1) {
      const task = routeTask ?? active;
      const diagnosticBlock = `<div class="evidence-submit evidence-submit--diagnostic">${initialDiagnosticForm(task)}<button class="button button--ink" type="button" data-action="submit-evidence" data-task-id="${esc(active.id)}">保存诊断并生成下一步 ${icon("arrow")}</button></div>`;
      return `${html.slice(0, evidenceStart)}${diagnosticBlock}${html.slice(evidenceEnd)}`;
    }
  }
  if (state.pilot?.initialDiagnostic?.nextAction) {
    return html.replace('<section class="study-action"', `${diagnosticAdjustment(state)}<section class="study-action"`);
  }
  return html;
}

function pageReview(state) {
  const reviewStatus = reviewStatusFor(state);
  return `<div class="page page--review" data-demo-state="true">${intro("/review", state)}<div class="review-top"><div class="review-top__bagua">${renderBaguaField({ active: "坎", label: "今日回望 · 坎位" })}</div><div class="review-top__copy"><span class="section-kicker">今日回望 · 坎位</span><h2>让走过的路<br><em>变成下一步行动。</em></h2><p>复盘只根据你提交的证据，不把自报完成包装成掌握结论。</p>${action("继续提交证据", "/study", "button button--ink")}</div><div class="review-top__stats">${metaLine("本次证据", `L${state.pilot.selectedEvidenceLevel}`)}${metaLine("复盘状态", reviewStatus)}${metaLine("记忆迭代", `${state.memory?.iterationCount ?? 0} 次`)}</div></div>${evidenceReview(state)}${memoryLoop(state)}<section class="review-list">${sectionTitle("需要你回望的山脊", "证据覆盖情况", action("查看档案", "/knowledge", "text-link", "arrow"))}<div class="knowledge-rows">${state.knowledge.slice(0, 3).map((item) => `<article class="knowledge-row"><span class="knowledge-row__gua">${item.gua}</span><div><span>${item.domain}</span><h3>${item.title}</h3></div><div class="knowledge-row__mastery">${progressBar(item.mastery, item.color === "cinnabar" ? "red" : "amber")}<strong>L${item.evidenceLevel ?? 2} · ${item.mastery}%</strong></div><a href="/study" data-route="/study" aria-label="复习 ${item.title}">${icon("arrow", "复习")}</a></article>`).join("")}</div></section></div>`;
}

function pageKnowledgeLegacy(state) {
  const active = state.knowledge.find((item) => item.id === state.activeKnowledgeId) ?? state.knowledge[0];
  const related = active.relatedIds.map((id) => state.knowledge.find((item) => item.id === id)).filter(Boolean);
  const edges = ["northwest", "northeast", "southwest", "south", "southeast"].map((position) => `<span class="knowledge-graph__edge knowledge-graph__edge--${position}"></span>`).join("");
  return `<div class="page page--knowledge" data-demo-state="true">${intro("/knowledge", state)}<div class="knowledge-atlas"><section class="knowledge-library"><div class="knowledge-library__heading"><div><span class="section-kicker">个人知识库 · ${state.knowledge.length} 个节点</span><h2>我的知识脉络</h2><p>把学过的内容、错题和自己的理解，连成一张只属于你的图。</p></div><span class="knowledge-library__seal">巽<br><small>连通</small></span></div><div class="knowledge-library__toolbar"><span class="knowledge-library__count">已沉淀 <strong>${state.knowledge.length}</strong> 个节点</span><label class="knowledge-search"><span class="sr-only">搜索知识库</span>${icon("search", "搜索知识库")}<input data-knowledge-search type="search" placeholder="搜索知识、错题或笔记" autocomplete="off"></label></div><div class="knowledge-graph" aria-label="个人知识脉络图"><span class="knowledge-graph__stamp">MY / KNOWLEDGE / MAP</span>${edges}<div class="knowledge-graph__core"><span>我的知识库</span><strong>${state.knowledge.length}<small> 个节点</small></strong><b>今日新增 · 02</b></div>${state.knowledge.map((item) => `<button class="knowledge-map-node knowledge-map-node--${item.position} ${item.id === active.id ? "is-active" : ""}" type="button" data-action="select-knowledge" data-knowledge-id="${item.id}" data-knowledge-item aria-pressed="${item.id === active.id}"><span>${item.gua}</span><strong>${item.title}</strong><small>${item.state} · ${item.mastery}%</small></button>`).join("")}<div class="knowledge-graph__legend"><span><i class="dot dot--gold"></i>已稳固</span><span><i class="dot dot--red"></i>待回望</span><span><i class="dot dot--gray"></i>初探</span></div></div><div class="knowledge-trail"><div><span class="section-kicker">最近沉淀</span><small>从今天的学习记录进入知识库</small></div><div class="knowledge-trail__list">${state.knowledge.slice(0, 3).map((item) => `<button class="knowledge-trail__item" type="button" data-action="select-knowledge" data-knowledge-id="${item.id}" data-knowledge-item><span>${item.source}</span><strong>${item.title}</strong><small>${item.updated}</small></button>`).join("")}</div></div></section><aside class="knowledge-detail"><div class="knowledge-detail__top"><span>当前节点 · ${active.gua}</span><b>${active.state}</b></div><h2>${active.title}</h2><span class="knowledge-detail__strand">${active.strand}</span><p class="knowledge-detail__summary">${active.summary}</p><div class="knowledge-detail__mastery"><div><span>我的掌握度</span><strong>${active.mastery}%</strong></div>${progressBar(active.mastery, active.color === "cinnabar" ? "red" : active.color === "rock" ? "gray" : "amber")}</div><div class="knowledge-detail__meta"><div><span>来自</span><strong>${active.source}</strong></div><div><span>最近更新</span><strong>${active.updated}</strong></div></div><div class="knowledge-detail__section"><span>它连接到</span><div class="knowledge-related">${related.map((item) => `<button type="button" data-action="select-knowledge" data-knowledge-id="${item.id}">${item.gua} ${item.title}</button>`).join("")}</div></div><div class="knowledge-detail__note"><span>我留下的理解</span><p>${active.note}</p></div>${action("沿这条脉络回望", "/review", "button button--ink")}</aside></div></div>`;
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

function knowledgeNodePosition(item, index) {
  if (index < 8 && KNOWLEDGE_GRAPH_POSITIONS[item.position]) return KNOWLEDGE_GRAPH_POSITIONS[item.position];
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
    const [x, y] = knowledgeNodePosition(item, index);
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
  const projection = knowledgeGraphProjection(items, active.id);
  const zoom = Math.min(1.24, Math.max(.86, Number(state.knowledgeGraphZoom) || 1));
  const visibleNodes = projection.nodes.map((node) => node.isLabel
    ? `<button class="knowledge-network__node knowledge-network__node--${node.tone} ${node.item.id === active.id ? "is-active" : ""}" type="button" data-action="select-knowledge" data-knowledge-id="${node.item.id}" data-knowledge-item aria-pressed="${node.item.id === active.id}" style="left:${node.x}%;top:${node.y}%"><span>${node.item.gua}</span><strong>${esc(node.item.title)}</strong><small>${esc(node.item.state)} · L${node.item.evidenceLevel ?? 2}</small></button>`
    : `<button class="knowledge-network__dot knowledge-network__dot--interactive knowledge-network__dot--${node.tone}" type="button" data-action="select-knowledge" data-knowledge-id="${node.item.id}" data-knowledge-item aria-label="查看 ${esc(node.item.title)}" title="查看 ${esc(node.item.title)}" style="left:${node.x}%;top:${node.y}%;--dot-size:7px"></button>`).join("");
  const labelNote = items.length > projection.nodes.filter((node) => node.isLabel).length ? ` · ${projection.nodes.filter((node) => node.isLabel).length} 个标签` : "";
  return `<section class="knowledge-network" aria-label="个人复利知识关系网络"><div class="knowledge-network__head"><div><span class="section-kicker">关系网络 · ${items.length} 个核心节点</span><h3>看见知识如何彼此借力</h3></div><span class="knowledge-network__mode">${projection.relationCount} 条已知连接 · 密度预览${labelNote}</span></div><div class="knowledge-network__viewport"><div class="knowledge-network__plane" style="--knowledge-zoom:${zoom}"><svg class="knowledge-network__connections" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${projection.lines.join("")}</svg><div class="knowledge-network__dots">${projection.dots.join("")}</div><div class="knowledge-network__core"><span>PERSONAL COMPOUND</span><strong>${items.length}</strong><small>核心节点</small></div>${visibleNodes}</div></div><div class="knowledge-network__footer"><div class="knowledge-network__legend"><span><i class="dot dot--gold"></i>已稳固</span><span><i class="dot dot--red"></i>待回望</span><span><i class="dot dot--gray"></i>初探</span></div><div class="knowledge-network__zoom"><button type="button" data-action="knowledge-zoom" data-zoom="out" aria-label="缩小网络">-</button><span>${Math.round(zoom * 100)}%</span><button type="button" data-action="knowledge-zoom" data-zoom="in" aria-label="放大网络">+</button><button type="button" data-action="knowledge-zoom" data-zoom="reset">重置</button></div></div></section>`;
}

function knowledgeCatalog(state) {
  const collections = [
    { label: "Agent 管理", detail: "书鼎与专属提示词", count: state.guide?.options?.length ?? 0, status: "已连接" },
    { label: "知识库本体", detail: "概念、技能与证据", count: state.knowledge?.length ?? 0, status: "当前" },
    { label: "外部资源归档", detail: "网页、文档与引用", count: "-", status: "待接入" },
    { label: "全局笔记", detail: "想法、片段与灵感", count: "-", status: "待接入" },
    { label: "控制配置", detail: "权限、规则与连接", count: "-", status: "系统" },
  ];
  return `<aside class="knowledge-catalog"><div class="knowledge-catalog__head"><span>知识资产</span><strong>${state.knowledge?.length ?? 0}</strong></div><div class="knowledge-catalog__groups">${collections.map((item, index) => `<div class="knowledge-catalog__item ${index === 1 ? "is-active" : ""}"><span class="knowledge-catalog__index">0${index + 1}</span><div><strong>${item.label}</strong><small>${item.detail}</small></div><b>${item.count}</b><em>${item.status}</em></div>`).join("")}</div><div class="knowledge-catalog__foot"><span>复利链路</span><strong>输入 → 关联 → 复习 → 迁移</strong></div></aside>`;
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
  return `<aside class="knowledge-inspector"><div class="knowledge-inspector__top"><span>当前节点 · ${active.gua}</span><b>${active.state}</b></div><h3>${esc(active.title)}</h3><span class="knowledge-inspector__strand">${esc(active.strand)}</span><p>${esc(active.summary)}</p><div class="knowledge-inspector__mastery"><div><span>证据覆盖</span><strong>L${active.evidenceLevel ?? 2} · ${active.mastery}%</strong></div>${progressBar(active.mastery, active.color === "cinnabar" ? "red" : active.color === "rock" ? "gray" : "amber")}</div><div class="knowledge-inspector__meta"><div><span>来自</span><strong>${esc(active.source)}</strong></div><div><span>最近更新</span><strong>${esc(active.updated)}</strong></div></div><div class="knowledge-inspector__links"><span>它连接到</span><div>${related.map((item) => `<button type="button" data-action="select-knowledge" data-knowledge-id="${item.id}">${item.gua} ${esc(item.title)}</button>`).join("") || `<small>还没有关联节点</small>`}</div></div><div class="knowledge-inspector__note"><span>我留下的理解</span><p>${esc(active.note)}</p></div>${action("沿这条脉络回望", "/review", "button button--ink")}</aside>`;
}

function pageKnowledge(state) {
  const items = state.knowledge ?? [];
  const active = items.find((item) => item.id === state.activeKnowledgeId) ?? items[0] ?? { id: "empty", title: "还没有知识节点", state: "初探", gua: "巽", strand: "新知识", summary: "从一次学习记录开始建立你的第一条连接。", evidenceLevel: 1, mastery: 0, source: "尚未收录", updated: "现在", note: "", relatedIds: [], color: "rock" };
  const related = (active.relatedIds ?? []).map((id) => items.find((item) => item.id === id)).filter(Boolean);
  const view = ["network", "directory", "recent"].includes(state.knowledgeView) ? state.knowledgeView : "network";
  const workspace = view === "directory" ? knowledgeDirectory(state) : view === "recent" ? knowledgeDirectory(state, true) : knowledgeNetwork(state, active);
  const composer = state.knowledgeComposerOpen ? knowledgeCaptureForm(state) : "";
  return `<div class="page page--knowledge" data-demo-state="true">${intro("/knowledge", state, "个人复利 Agent 知识库")}<section class="knowledge-workbench"><div class="knowledge-workbench__head"><div><span class="section-kicker">PERSONAL COMPOUND · KNOWLEDGE SYSTEM</span><h2>让每一条记录，<br><em>接上下一条。</em></h2><p>知识不是孤立的卡片，而是会被 Agent 识别、关联、复习和再次调用的个人网络。</p></div><div class="knowledge-workbench__stats">${metaLine("核心节点", `${items.length}`)}${metaLine("已知连接", `${knowledgeGraphProjection(items).relationCount}`)}${metaLine("资产层", "05")}</div></div><div class="knowledge-workbench__toolbar"><div class="knowledge-view-tabs" role="tablist" aria-label="知识库视图"><button type="button" data-action="knowledge-view" data-knowledge-view="network" role="tab" aria-selected="${view === "network"}">网络</button><button type="button" data-action="knowledge-view" data-knowledge-view="directory" role="tab" aria-selected="${view === "directory"}">目录</button><button type="button" data-action="knowledge-view" data-knowledge-view="recent" role="tab" aria-selected="${view === "recent"}">最近</button></div><label class="knowledge-search"><span class="sr-only">搜索知识节点</span>${icon("search", "搜索知识节点")}<input data-knowledge-search type="search" placeholder="搜索节点、来源或关键词" autocomplete="off"></label><button class="button button--outline knowledge-add-button" type="button" data-action="open-knowledge-composer">${icon("plus")}新增记录</button></div><div class="knowledge-workbench__body">${knowledgeCatalog(state)}<section class="knowledge-workspace" data-knowledge-view-current="${view}">${workspace}</section>${knowledgeInspector(active, related)}</div>${composer}</section></div>`;
}

function knowledgeMaterials(state) {
  const materials = state.learningArtifacts ?? [];
  const diagnosis = state.companionCycle?.diagnosisSummary ?? null;
  const observations = Array.isArray(diagnosis?.observations) ? diagnosis.observations : [];
  return `<section class="knowledge-materials"><div class="knowledge-materials__head"><div><span class="section-kicker">个人材料 RAG · 证据来源</span><h2>器灵引用了什么？</h2><p>这里展示只属于当前账号的题目、笔记和草稿。官方知识不会覆盖你的个人状态。</p></div><span class="knowledge-materials__count">${materials.length} 份材料</span></div>${materials.length ? `<div class="knowledge-materials__list">${materials.slice(0, 8).map((material) => `<article><div><span>${esc(material.kind)} · ${esc(material.subject)}</span><h3>${esc(material.source_title)}</h3></div><p>${esc(String(material.content_text ?? "").slice(0, 180))}${String(material.content_text ?? "").length > 180 ? "…" : ""}</p><small>保存于 ${esc(material.updated_at ? new Date(material.updated_at).toLocaleDateString("zh-CN") : "最近")}</small></article>`).join("")}</div>` : `<div class="knowledge-materials__empty"><strong>还没有个人材料</strong><span>回到“学习”，粘贴一道题、笔记或作答草稿，器灵才会开始引用你的真实状态。</span></div>`}${observations.length ? `<div class="knowledge-materials__citations"><span>最近一次诊断引用</span>${observations.map((observation) => `<article><strong>${esc(observation.claim)}</strong><p>“${esc(observation.evidence_excerpt)}”</p><small>${esc(observation.artifact_id)} · ${esc(observation.chunk_id)} · 置信度 ${Math.round(Number(observation.confidence ?? 0) * 100)}%</small></article>`).join("")}</div>` : ""}</section>`;
}

function pageKnowledgeWithMaterials(state) {
  const html = pageKnowledge(state);
  const close = html.lastIndexOf("</div>");
  return close === -1 ? html : `${html.slice(0, close)}${knowledgeMaterials(state)}${html.slice(close)}`;
}

function pageKnowledgeLegacyCurrent(state) {
  const active = state.knowledge.find((item) => item.id === state.activeKnowledgeId) ?? state.knowledge[0];
  const related = (active.relatedIds ?? []).map((id) => state.knowledge.find((item) => item.id === id)).filter(Boolean);
  const edges = ["northwest", "north", "northeast", "west", "east", "southwest", "south", "southeast"].map((position) => `<span class="knowledge-graph__edge knowledge-graph__edge--${position}"></span>`).join("");
  const composer = state.knowledgeComposerOpen ? knowledgeCaptureForm(state) : "";
  return `<div class="page page--knowledge" data-demo-state="true">${intro("/knowledge", state)}<div class="knowledge-atlas"><section class="knowledge-library"><div class="knowledge-library__heading"><div><span class="section-kicker">个人学习档案 · ${state.knowledge.length} 个节点</span><h2>我的证据脉络</h2><p>把学过的内容、错题、输出和自己的理解，连成一张只属于你的记录。</p><button class="button button--outline knowledge-add-button" type="button" data-action="open-knowledge-composer">${icon("plus")}新增记录</button></div><span class="knowledge-library__seal">巽<br><small>连通</small></span></div><div class="knowledge-library__toolbar"><span class="knowledge-library__count">已沉淀 <strong>${state.knowledge.length}</strong> 个节点</span><label class="knowledge-search"><span class="sr-only">搜索学习档案</span>${icon("search", "搜索学习档案")}<input data-knowledge-search type="search" placeholder="搜索知识、错题或笔记" autocomplete="off"></label></div><div class="knowledge-graph" aria-label="个人学习证据脉络图"><span class="knowledge-graph__stamp">MY / EVIDENCE / MAP</span>${edges}<div class="knowledge-graph__core"><span>我的学习档案</span><strong>${state.knowledge.length}<small> 个节点</small></strong><b>今日新增 · 02</b></div>${state.knowledge.map((item) => `<button class="knowledge-map-node knowledge-map-node--${item.position ?? "east"} ${item.id === active.id ? "is-active" : ""}" type="button" data-action="select-knowledge" data-knowledge-id="${item.id}" data-knowledge-item aria-pressed="${item.id === active.id}"><span>${item.gua}</span><strong>${item.title}</strong><small>${item.state} · L${item.evidenceLevel ?? 2}</small></button>`).join("")}<div class="knowledge-graph__legend"><span><i class="dot dot--gold"></i>证据充分</span><span><i class="dot dot--red"></i>需要回望</span><span><i class="dot dot--gray"></i>刚开始</span></div></div><div class="knowledge-trail"><div><span class="section-kicker">最近沉淀</span><small>从今天的学习记录进入档案</small></div><div class="knowledge-trail__list">${state.knowledge.slice(0, 3).map((item) => `<button class="knowledge-trail__item" type="button" data-action="select-knowledge" data-knowledge-id="${item.id}" data-knowledge-item><span>${item.source}</span><strong>${item.title}</strong><small>${item.updated}</small></button>`).join("")}</div></div>${composer}</section><aside class="knowledge-detail"><div class="knowledge-detail__top"><span>当前节点 · ${active.gua}</span><b>${active.state}</b></div><h2>${active.title}</h2><span class="knowledge-detail__strand">${active.strand}</span><p class="knowledge-detail__summary">${active.summary}</p><div class="knowledge-detail__mastery"><div><span>证据覆盖</span><strong>L${active.evidenceLevel ?? 2} · ${active.mastery}%</strong></div>${progressBar(active.mastery, active.color === "cinnabar" ? "red" : active.color === "rock" ? "gray" : "amber")}</div><div class="knowledge-detail__meta"><div><span>来自</span><strong>${active.source}</strong></div><div><span>最近更新</span><strong>${active.updated}</strong></div></div><div class="knowledge-detail__section"><span>它连接到</span><div class="knowledge-related">${related.map((item) => `<button type="button" data-action="select-knowledge" data-knowledge-id="${item.id}">${item.gua} ${item.title}</button>`).join("") || `<small class="knowledge-related__empty">还没有关联节点，先从一条新记录开始。</small>`}</div></div><div class="knowledge-detail__note"><span>我留下的理解</span><p>${active.note}</p></div>${action("沿这条脉络回望", "/review", "button button--ink")}</aside></div></div>`;
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
    ? `<span class="assistant-pending"><i></i>问题已受理，正在结合你的目标、今日任务和学习记录整理下一步……</span>`
    : state.pilot.assistantResponse
    ? esc(assistantDisplayText(state.pilot.assistantResponse)).replace(/\n/g, "<br>")
    : state.pilot.assistantError
      ? `这次回答没有完成：${esc(state.pilot.assistantError)}`
      : state.isDemo
        ? esc(selected.opening)
        : "服务正在连接。先把问题写下来，回答会在后台完成后回到这里。";
  const aiStatus = state.pilot.assistantPending
    ? "问题已受理"
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
  const lastSeen = !state.isDemo && companion.lastSeenAt ? `最近同行：${formatAccountDate(companion.lastSeenAt)}` : "只使用服务端确认过的记忆，不凭空补写过去";
  return `<div class="page page--assistant" data-demo-state="${state.isDemo}">${intro("/assistant", state)}<div class="assistant-layout"><section class="assistant-dialog"><div class="assistant-dialog__header"><span class="assistant-dialog__seal">${selected.mark}</span><div><span>专属教学人格 · 只在卡住时使用</span><strong>${selected.name}</strong></div><i class="online-dot ${aiStatusClass}" title="${aiStatus}"></i><small>${aiStatus} · 根据当前任务、目标和学习记录给出下一步</small></div><div class="assistant-dialog__body"><div class="message message--guide"><span class="message__mark">${selected.mark}</span><div class="message__body"><span class="message__eyebrow">引路人回声 · 当前山段</span><p>${response}</p><span class="message__footer">先回答问题，再给一个可验证的下一步</span></div></div><div class="suggestion-list"><button type="button" data-action="ask-guide">根据我的错题，明天先补什么？</button><button type="button" data-action="ask-guide">按我的可用时间拆一个今天的动作</button><button type="button" data-action="ask-guide">我还没有证据，最小输出是什么？</button></div></div><form class="assistant-composer" data-demo-form="assistant"><input name="prompt" value="${esc(promptValue)}" placeholder="说出你卡住的地方……" aria-label="向引路人提问" ${state.pilot.assistantPending ? "disabled" : ""}><button type="submit" class="icon-button icon-button--dark" title="${submitLabel}" ${state.pilot.assistantPending ? "disabled" : ""}>${icon("arrow", submitLabel)}</button></form></section><aside class="assistant-aside"><section class="assistant-guide-card assistant-guide-card--${selected.kind}"><div class="assistant-guide-card__art"><img src="${selectedAsset.path}" alt="${selectedAsset.alt}"></div><div class="assistant-guide-card__copy"><span class="section-kicker">教学人格 · ${selected.teachingStyle}</span><strong>${selected.name}</strong><p>${selected.detail}</p></div></section><section class="assistant-guide-picker"><div class="assistant-guide-picker__heading"><span class="section-kicker">选择你的书鼎</span><small>它会改变解释、提问和反馈方式，但不改变学习结论。</small></div><div class="guide-options">${guide.options.map((option) => `<button class="guide-option guide-option--${option.kind} ${option.assetId === selected.assetId ? "is-selected" : ""}" type="button" data-action="select-guide" data-guide="${option.assetId}" aria-pressed="${option.assetId === selected.assetId}"><span class="guide-option__art"><img src="${assetUrl(option.assetId)}" alt="${option.name}"></span><span class="guide-option__text"><strong>${option.name}</strong><small>${option.teachingStyle}</small></span><span class="guide-option__mark">${option.mark}</span></button>`).join("")}</div></section><div class="assistant-aside__note"><span class="section-kicker">同行记录</span><strong>${continuity}</strong><p>${lastSeen}</p><small>${state.isDemo ? "真实账号登录后，互动次数和记忆迭代会按账号保存。" : `当前提示词 ${esc(companion.promptVersion || "服务端版本")}`}</small></div><div class="assistant-aside__note"><span class="section-kicker">今日提示</span><p>回答会先看你的目标、当前任务和可用时间，再决定是解释、追问还是安排一个动作。</p></div></aside></div></div>`;
}

function pageGrowth(state) {
  const growthTitle = state.isDemo ? "七天不息" : state.today.streak ? `${state.today.streak}天不息` : "第一步还在等待";
  const growthMeter = state.isDemo ? "640 <small>/ 1,000 气韵</small>" : `${state.today.minutes} <small>分钟已记录</small>`;
  return `<div class="page page--growth" data-demo-state="true">${intro("/growth", state)}<div class="growth-hero"><div class="growth-hero__seal"><div class="growth-hero__ring"></div><span>行者</span><strong>07</strong><small>初见山门</small></div><div class="growth-hero__copy"><span class="section-kicker">气韵 · 正在积累</span><h2>你已经走了<br><em>${growthTitle}。</em></h2><p>这不是一条漂亮的统计线，而是七次你本可以放弃、却又回到山路上的证据。</p>${action("继续今日行旅", "/plan", "button button--ink")}</div><div class="growth-hero__meter"><div class="meter-label"><span>距下一枚印记</span><strong>${growthMeter}</strong></div>${progressBar(state.isDemo ? 64 : 0)}<span>${state.isDemo ? "云隙初光 · 已点亮" : "完成第一条真实记录后解锁"}</span></div></div><section class="achievements">${sectionTitle("登峰碑记", "已经留下的印记", action("查看山海图", "/map", "text-link", "arrow"))}<div class="achievement-grid">${state.achievements.map((item) => `<article class="achievement ${item.unlocked ? "is-unlocked" : "is-locked"}"><span class="achievement__mark">${item.unlocked ? item.mark : icon("lock", "未解锁")}</span><div><span>${item.unlocked ? "已解锁" : "尚在云后"}</span><h3>${item.title}</h3><p>${item.detail}</p></div>${item.unlocked ? icon("check", "已解锁") : ""}</article>`).join("")}</div></section><section class="summit-tease"><span class="summit-tease__cloud"></span><div><span class="section-kicker">隐藏成就 · 登临</span><h2>等你站上山顶，<br><em>回望这一路。</em></h2><p>完成当前阶段后，人生副本将开启下一座山。</p></div><span class="summit-tease__height">8,848<small>m</small></span></section></div>`;
}

function pageMap(state) {
  const scene = assetUrl("lijing-summit-climb-ink-v2");
  return `<div class="page page--map" data-demo-state="true">${intro("/map", state)}<div class="map-stage" style="--map-image:url('${scene}')"><div class="map-stage__veil"></div><div class="map-stage__title"><span>山海图 · 远方山系</span><strong>云后还有<br>新的峰顶</strong></div><div class="map-stage__route">${state.map.map((item, index) => `<button class="map-node map-node--${item.state}" type="button" data-action="map-node"><span>${index + 1}</span><strong>${item.title}</strong><small>${item.subtitle}</small><em>${item.height}</em></button>`).join("")}<span class="map-stage__path"></span></div><div class="map-stage__caption"><span class="dot dot--gold"></span> 已点亮的路会为你留下光<br><span class="dot dot--gray"></span> 还未走到的地方，先不必急着看清</div></div></div>`;
}

function pageProfile(state) {
  const account = state.auth?.user;
  const profileMilestone = state.isDemo ? "七日不息" : state.today.streak ? `${state.today.streak}日不息` : "第一步还在等待";
  const profileDays = state.isDemo ? "7 日" : `${state.today.streak ?? 0} 日`;
  const profileReviews = state.isDemo ? "12" : `${state.memory?.iterationCount ?? 0}`;
  return `<div class="page page--profile" data-demo-state="true">${intro("/profile", state)}<div class="profile-layout"><section class="profile-card"><div class="profile-card__top"><div class="profile-card__seal">行</div><div><span class="section-kicker">行者编号 · ${account ? "REAL" : "DEMO-01"}</span><h2>${esc(state.user.name)}</h2><p>${esc(state.user.title)}</p></div><a class="icon-button" href="/settings" data-route="/settings" aria-label="打开完整设置" title="打开完整设置">${icon("settings", "打开完整设置")}</a></div><div class="profile-card__path"><span>第一次入山</span><i></i><strong>${profileMilestone}</strong><i></i><span>下一枚印记</span></div><div class="profile-card__footer">${metaLine("已行进", profileDays)}${metaLine("当前高度", `${state.mountain.currentHeight.toLocaleString("zh-CN")}m`)}${metaLine("回望次数", profileReviews)}</div></section><section class="settings-list">${sectionTitle("行者设置", "管理你的账户", demoNote(state))}<a class="setting-row" href="/settings" data-route="/settings"><span>${icon("settings")}</span><div><strong>打开完整设置</strong><small>个人信息、账号切换、偏好和功能反馈</small></div>${icon("chevron")}</a><button class="setting-row" type="button" data-action="toggle-motion"><span>${icon("spark")}</span><div><strong>动效与云雾</strong><small>保留沉浸感，减少不必要的运动</small></div><i class="toggle is-on"><b></b></i></button><button class="setting-row setting-row--danger" type="button" data-action="logout"><span>${icon("arrow", "退出")}</span><div><strong>退出山门</strong><small>结束当前设备上的登录会话</small></div>${icon("chevron")}</button></section></div></div>`;
}

function formatAccountDate(value) {
  if (!value) return "尚未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "尚未记录" : date.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
}

function pageSettingsLegacy(state) {
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
  return `<div class="page page--settings" data-demo-state="${state.isDemo}">${intro("/settings", state)}<div class="settings-layout"><section class="settings-account"><div class="settings-account__heading"><span class="section-kicker">身份印记 · ${state.isDemo ? "演示" : "真实账户"}</span><h2>${esc(account.display_name || profile.name || "未命名行者")}</h2><p>${esc(account.email || "当前没有登录邮箱")}</p><span class="settings-account__status"><i></i>${state.isDemo ? "本地演示数据" : "真实账户 · 服务端保存"}</span></div><dl class="settings-facts"><div><dt>账户 ID</dt><dd>${esc(account.id || "DEMO-01")}</dd></div><div><dt>注册时间</dt><dd>${formatAccountDate(account.created_at)}</dd></div><div><dt>当前阶段</dt><dd>${esc(profile.stage || "待填写")}</dd></div><div><dt>每日投入</dt><dd>${esc(profile.dailyMinutes || "25")} 分钟</dd></div></dl><div class="settings-account__actions"><button class="button button--outline" type="button" data-action="switch-account" data-auth-mode="login">${icon("user")}切换账号</button><button class="button button--ink" type="button" data-action="switch-account" data-auth-mode="register">${icon("plus")}注册新账号</button><button class="text-link" type="button" data-action="logout">退出当前账号 ${icon("arrow")}</button></div></section><section class="settings-service"><div class="section-title"><div><span>服务状态</span><h2>真实使用边界</h2></div><span class="settings-service__pulse">${service.api === "up" ? "在线" : "检查中"}</span></div><div class="service-status-row"><span>${icon("compass")}</span><div><strong>砺境服务</strong><small>${service.api === "up" ? "账户、学习记录和反馈可以保存" : "正在确认服务是否可用"}</small></div><i class="status-dot status-dot--${service.api === "up" ? "up" : "pending"}"></i></div><div class="service-status-row"><span>${icon("spark")}</span><div><strong>AI 引路</strong><small>${aiLabel}</small></div><i class="status-dot status-dot--${aiDot}"></i></div><p class="settings-service__note">服务端只返回必要状态，不会在页面或日志中暴露 AI 密钥。</p></section><section class="settings-panel settings-panel--profile"><div class="section-title"><div><span>个人信息</span><h2>让山路更懂你</h2></div></div><form class="settings-form" data-demo-form="settings-profile"><div class="settings-form__grid"><label>行者名<input name="name" type="text" value="${esc(profile.name || "")}" maxlength="80" required></label><label>当前阶段<select name="stage"><option ${profile.stage === "高中学习" ? "selected" : ""}>高中学习</option><option ${profile.stage === "大学学习" ? "selected" : ""}>大学学习</option><option ${profile.stage === "考研备考" ? "selected" : ""}>考研备考</option><option ${profile.stage === "职业转型" ? "selected" : ""}>职业转型</option><option ${profile.stage === "兴趣探索" ? "selected" : ""}>兴趣探索</option><option ${!profile.stage || profile.stage === "待填写" ? "selected" : ""}>待填写</option></select></label><label>学校<input name="school" type="text" value="${esc(profile.school || "")}" maxlength="160" placeholder="可选"></label><label>专业<input name="major" type="text" value="${esc(profile.major || "")}" maxlength="160" placeholder="可选"></label><label>每日投入<select name="dailyMinutes"><option value="15" ${String(profile.dailyMinutes) === "15" ? "selected" : ""}>15 分钟</option><option value="25" ${String(profile.dailyMinutes || "25") === "25" ? "selected" : ""}>25 分钟</option><option value="45" ${String(profile.dailyMinutes) === "45" ? "selected" : ""}>45 分钟</option><option value="60" ${String(profile.dailyMinutes) === "60" ? "selected" : ""}>60 分钟</option></select></label></div><div class="settings-form__footer"><small>保存后会同步到当前账户，刷新和换设备仍可恢复。</small><button class="button button--ink" type="submit">保存个人信息 ${icon("check")}</button></div></form></section><section class="settings-panel settings-panel--preferences"><div class="section-title"><div><span>使用偏好</span><h2>调整你的节律</h2></div></div><button class="setting-row" type="button" data-action="toggle-motion"><span>${icon("spark")}</span><div><strong>动效与云雾</strong><small>设备本地偏好 · 当前${motionEnabled ? "开启" : "关闭"}</small></div><i class="toggle ${motionEnabled ? "is-on" : ""}"><b></b></i></button><label class="setting-row setting-row--select"><span>${icon("bell")}</span><div><strong>通知与提醒</strong><small>只影响这个浏览器，不会读取其他应用通知</small></div><select data-preference="notifications" aria-label="通知与提醒"><option value="off" ${notificationMode === "off" ? "selected" : ""}>关闭</option><option value="important" ${notificationMode === "important" ? "selected" : ""}>仅重要提醒</option><option value="daily" ${notificationMode === "daily" ? "selected" : ""}>每日摘要</option></select></label></section><section class="settings-panel settings-panel--feedback"><div class="section-title"><div><span>功能反馈</span><h2>把遇到的问题告诉我们</h2></div><span class="settings-panel__stamp">REAL INPUT</span></div><form class="settings-form" data-demo-form="feedback"><label>反馈类型<select name="category"><option value="bug">功能问题</option><option value="idea">功能建议</option><option value="account">账号与数据</option><option value="ai">AI 使用</option><option value="other">其他</option></select></label><label>标题<input name="title" type="text" maxlength="120" placeholder="例如：设置页保存后没有更新" required></label><label>详细描述<textarea name="detail" rows="6" maxlength="3000" placeholder="请描述你做了什么、看到了什么，以及你希望它怎样工作。" required></textarea></label><label>联系邮箱 <small>可选</small><input name="contact_email" type="email" maxlength="320" value="${esc(account.email || "")}" placeholder="需要回复时填写"></label><div class="settings-form__footer"><small>反馈会关联当前账号，服务端收到后进入处理队列。</small><button class="button button--primary" type="submit">提交反馈 ${icon("arrow")}</button></div></form></section></div></div>`;
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
  const weeklyHours = String(profile.weeklyHours || "8");
  const timezone = String(profile.timezone || "Asia/Shanghai");
  return `<div class="page page--settings" data-demo-state="${state.isDemo}">${intro("/settings", state)}<div class="settings-layout"><section class="settings-account"><div class="settings-account__heading"><span class="section-kicker">身份印记 · ${state.isDemo ? "演示" : "真实账户"}</span><h2>${esc(account.display_name || profile.name || "未命名行者")}</h2><p>${esc(account.email || "当前没有登录邮箱")}</p><span class="settings-account__status"><i></i>${accountStorageLabel}</span><span class="settings-account__email-status">${emailStatusLabel}</span></div><dl class="settings-facts"><div><dt>账户 ID</dt><dd>${esc(account.id || "DEMO-01")}</dd></div><div><dt>注册时间</dt><dd>${formatAccountDate(account.created_at)}</dd></div><div><dt>当前阶段</dt><dd>${esc(profile.stage || "待填写")}</dd></div><div><dt>每日投入</dt><dd>${esc(dailyMinutes)} 分钟</dd></div></dl><div class="settings-account__actions"><button class="button button--outline" type="button" data-action="switch-account" data-auth-mode="login">${icon("user")}切换账号</button><button class="button button--ink" type="button" data-action="switch-account" data-auth-mode="register">${icon("plus")}注册新账号</button><button class="text-link" type="button" data-action="logout">退出当前账号 ${icon("arrow")}</button></div></section><section class="settings-service"><div class="section-title"><div><span>服务状态</span><h2>真实使用边界</h2></div><span class="settings-service__pulse">${service.api === "up" ? "在线" : "检查中"}</span></div><div class="service-status-row"><span>${icon("compass")}</span><div><strong>砺境服务</strong><small>${service.api === "up" ? "当前服务可以处理账户、学习记录和反馈" : "正在确认服务是否可用"}</small></div><i class="status-dot status-dot--${service.api === "up" ? "up" : "pending"}"></i></div><div class="service-status-row"><span>${icon("lock")}</span><div><strong>数据保存</strong><small>${persistenceLabel}</small></div><i class="status-dot status-dot--${durablePersistence ? "up" : service.persistence === "ephemeral" ? "down" : "pending"}"></i></div><div class="service-status-row"><span>${icon("spark")}</span><div><strong>AI 引路</strong><small>${aiLabel}</small></div><i class="status-dot status-dot--${aiDot}"></i></div><p class="settings-service__note">服务端只返回必要状态，不会在页面或日志中暴露 AI 密钥。</p></section><section class="settings-panel settings-panel--profile"><div class="section-title"><div><span>个人信息</span><h2>让山路更懂你</h2></div></div><form class="settings-form" data-demo-form="settings-profile"><div class="settings-form__grid"><label>行者名<input name="name" type="text" value="${esc(profile.name || "")}" maxlength="80" required></label><label>当前阶段<select name="stage"><option ${profile.stage === "高中学习" ? "selected" : ""}>高中学习</option><option ${profile.stage === "大学学习" ? "selected" : ""}>大学学习</option><option ${profile.stage === "考研备考" ? "selected" : ""}>考研备考</option><option ${profile.stage === "兴趣探索" ? "selected" : ""}>兴趣探索</option><option ${!profile.stage || profile.stage === "待填写" ? "selected" : ""}>待填写</option></select></label><label>学校<input name="school" type="text" value="${esc(profile.school || "")}" maxlength="160" placeholder="可选"></label><label>专业<input name="major" type="text" value="${esc(profile.major || "")}" maxlength="160" placeholder="可选"></label><label>年龄<input name="age" type="number" min="13" max="100" value="${esc(profile.age || "")}" placeholder="可选"></label><label>所在地区<input name="region" type="text" value="${esc(profile.region || "")}" maxlength="120" placeholder="例如：江西"></label><label>每日投入（分钟）<input name="dailyMinutes" type="number" min="5" max="1440" step="5" value="${esc(dailyMinutes)}" required><small>按你的真实节律填写，不限制为一小时。</small></label><label>每周投入（小时）<input name="weeklyHours" type="number" min="1" max="168" step="1" value="${esc(weeklyHours)}"><small>用于核算长期路线是否可行。</small></label></div><label>补充说明<textarea name="notes" rows="4" maxlength="2000" placeholder="例如：工作日只能晚上学习，周末可以安排整块时间。">${esc(profile.notes || "")}</textarea></label><div class="settings-form__grid"><label class="setting-row setting-row--select"><span>${icon("bell")}</span><div><strong>每日提醒</strong><small>到点后提醒你查看今天的未完成计划。</small></div><input name="reminderEnabled" type="checkbox" value="on" ${profile.reminderEnabled !== false ? "checked" : ""}></label><label>提醒时间<input name="reminderTime" type="time" value="${esc(profile.reminderTime || "20:00")}" required></label><label>时区<input name="timezone" type="text" value="${esc(timezone)}" maxlength="80" placeholder="Asia/Shanghai" required></label></div><div class="settings-form__footer"><small>${profilePersistenceNote}</small><button class="button button--ink" type="submit">保存个人信息 ${icon("check")}</button></div></form></section><section class="settings-panel settings-panel--preferences"><div class="section-title"><div><span>使用偏好</span><h2>调整你的节律</h2></div></div><button class="setting-row" type="button" data-action="toggle-motion"><span>${icon("spark")}</span><div><strong>动效与云雾</strong><small>设备本地偏好 · 当前${motionEnabled ? "开启" : "关闭"}</small></div><i class="toggle ${motionEnabled ? "is-on" : ""}"><b></b></i></button><label class="setting-row setting-row--select"><span>${icon("bell")}</span><div><strong>通知与提醒</strong><small>只影响这个浏览器，不会读取其他应用通知</small></div><select data-preference="notifications" aria-label="通知与提醒"><option value="off" ${notificationMode === "off" ? "selected" : ""}>关闭</option><option value="important" ${notificationMode === "important" ? "selected" : ""}>仅重要提醒</option><option value="daily" ${notificationMode === "daily" ? "selected" : ""}>每日摘要</option></select></label></section><section class="settings-panel settings-panel--feedback"><div class="section-title"><div><span>功能反馈</span><h2>把遇到的问题告诉我们</h2></div><span class="settings-panel__stamp">REAL INPUT</span></div><form class="settings-form" data-demo-form="feedback"><label>反馈类型<select name="category"><option value="bug">功能问题</option><option value="idea">功能建议</option><option value="account">账号与数据</option><option value="ai">AI 使用</option><option value="other">其他</option></select></label><label>标题<input name="title" type="text" maxlength="120" placeholder="例如：设置页保存后没有更新" required></label><label>详细描述<textarea name="detail" rows="6" maxlength="3000" placeholder="请描述你做了什么、看到了什么，以及你希望它怎样工作。" required></textarea></label><label>联系邮箱 <small>可选</small><input name="contact_email" type="email" maxlength="320" value="${esc(account.email || "")}" placeholder="需要回复时填写"></label><div class="settings-form__footer"><small>反馈会关联当前账号，服务端收到后进入处理队列。</small><button class="button button--primary" type="submit">提交反馈 ${icon("arrow")}</button></div></form></section></div></div>`;
}

function pageState(route, state) {
  const stateMap = {
    "/state/loading": { iconName: "spark", action: "返回山脚", href: "/" },
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
  "/plan": pagePlan,
  "/study": pageStudyWithDiagnostic,
  "/review": pageReview,
  "/knowledge": pageKnowledgeWithMaterials,
  "/assistant": pageAssistant,
  "/growth": pageGrowth,
  "/map": pageMap,
  "/profile": pageProfile,
  "/settings": pageSettings,
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
