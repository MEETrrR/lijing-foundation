import { ROUTES, getRouteMeta } from "../data/routes.js";
import { assetUrl, getAsset } from "../data/assets.js";
import { icon, mark } from "../components/icons.js";
import { renderWorldMarker } from "../components/world-stage.js";

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

function demoNote() {
  return `<span class="demo-state" aria-label="演示数据">演示数据</span>`;
}

function progressBar(value, tone = "amber") {
  return `<div class="progress-line progress-line--${tone}" aria-label="完成度 ${value}%"><span style="--value:${value}%"></span></div>`;
}

function metaLine(label, value) {
  return `<div class="meta-line"><span>${label}</span><strong>${value}</strong></div>`;
}

function taskItem(task, index) {
  const statusText = { done: "已抵达", active: "现在出发", locked: "云后显现" }[task.status];
  return `<article class="task-row task-row--${task.status}" data-task-id="${task.id}"><div class="task-row__step">${String(index + 1).padStart(2, "0")}<span></span></div><div class="task-row__gua">${task.gua}</div><div class="task-row__body"><span class="task-row__type">${task.type}</span><h3>${task.title}</h3><p>${task.meta}</p></div><div class="task-row__state">${task.status === "done" ? icon("check", "已完成") : task.status === "locked" ? icon("lock", "未解锁") : icon("play", "开始") }<span>${statusText}</span></div></article>`;
}

function pageHome(state) {
  const sceneAsset = getAsset("aaa-home-title-screen-female-v2");
  return `<div class="page page--home" data-demo-state="true">
    <section class="home-hero">
      <div class="home-hero__copy">${demoNote()}<span class="page-intro__kicker">第零章 · 山门 / ${state.mountain.weather}</span><h1>向山顶<br><em>而行</em></h1><p>山顶很远，但你的每一次自律，都在让云海退开一点。</p><div class="home-hero__actions">${action("开始今日行旅", "/plan")}<a class="text-link" href="/map" data-route="/map">遥望整座山系 ${icon("arrow")}</a></div></div>
      <div class="home-hero__summit"><div class="summit-mark">${renderWorldMarker()}<span>主峰</span><strong>${state.mountain.summitHeight.toLocaleString("zh-CN")}m</strong></div><span class="summit-mark__caption">你在 ${state.mountain.currentHeight.toLocaleString("zh-CN")}m 处<br>云隙中已经看见了下一处营地</span></div>
      <div class="home-hero__image" style="--image:url('${sceneAsset.path}')"><span>向上攀登<br><b>每一步都算数</b></span></div>
    </section>
    <section class="home-overview"><div class="home-overview__lead"><span class="section-kicker">今日 · ${state.today.completed}/${state.today.total} 段行旅</span><h2>今天不必走完全程，<br><em>只要走好下一步。</em></h2><p>连续 ${state.today.streak} 日，你已经把坚持变成了山路的一部分。</p>${action("进入当前山段", "/study", "button button--ink")}</div><div class="home-overview__stats">${metaLine("有效学习", `${state.today.minutes} 分钟`)}${metaLine("当前营地", state.mountain.nextCamp)}${metaLine("专注状态", `${state.balance.focus}%`)}<div class="home-overview__seal">${mark("☯")} <span>阴阳<br>有衡</span></div></div></section>
    <section class="home-route"><div class="home-route__intro">${sectionTitle("脚下的路", "今日行旅", action("查看完整计划", "/plan", "text-link", "arrow"))}<p>完成一件具体的小事，山路就会向上延伸。</p></div><div class="task-list">${state.today.tasks.slice(0, 3).map(taskItem).join("")}</div></section>
    <section class="home-bottom"><div class="quote-panel"><span class="quote-panel__seal">「</span><p>不要因为山高而忘记<br>脚下这一阶。</p><span>砺境 · 行者箴言</span></div><div class="home-next"><span class="section-kicker">云后 · 下一阶段</span><h2>人生副本<br><em>正在远处生成</em></h2><p>当你登上这一座峰，回望来路，新的山系会在云海尽头开启。</p>${action("查看山海图", "/map", "button button--outline")}</div></section>
  </div>`;
}

function pageAuth(state) {
  return `<div class="page page--auth" data-demo-state="true"><div class="auth-wrap"><div class="auth-visual"><span class="auth-visual__seal">☷</span><span class="page-intro__kicker">入山 · 身份印记</span><h1>先为自己<br><em>立一座山门</em></h1><p>不需要准备好一生，只需要决定今天从哪里开始。</p><div class="auth-visual__line"></div><span>砺境 · 云海登山系统</span></div><div class="paper-panel auth-panel"><div class="panel-heading"><span class="section-kicker">行者登记</span><h2>欢迎回来</h2><p>你的山路会从这里继续。</p></div><form class="auth-form" data-demo-form="auth"><label>邮箱或行者名<input name="identity" type="text" placeholder="输入你的行者名" autocomplete="username"></label><label>通行密语<input name="password" type="password" placeholder="输入通行密语" autocomplete="current-password"></label><button class="button button--primary" type="submit">进入山门 ${icon("arrow")}</button></form><div class="auth-divider"><span>或</span></div><button class="button button--paper" type="button" data-action="demo-signin">以演示行者进入 ${icon("spark")}</button><p class="form-footnote">首次来此？<a href="/goals" data-route="/goals">先选择你的登山方向</a></p></div></div></div>`;
}

function pageGoals(state) {
  return `<div class="page page--goals" data-demo-state="true">${intro("/goals", state, "第一章 · 八方定向")}<div class="goals-layout"><section class="goal-selection"><div class="section-title"><div><span>选择一个主方向</span><h2>方向一旦确定，<br><em>每一步都会有回声。</em></h2></div>${demoNote()}</div><div class="goal-options">${state.goals.map((goal) => `<button class="goal-option ${goal.selected ? "is-selected" : ""}" type="button" data-goal="${goal.id}" aria-pressed="${goal.selected}"><span class="goal-option__icon">${goal.icon}</span><span><strong>${goal.title}</strong><small>${goal.detail}</small></span><i>${goal.selected ? icon("check", "已选择") : icon("arrow", "选择")}</i></button>`).join("")}</div><div class="goal-foot">${action("确认登山方向", "/plan")}<span>之后仍可调整，世界不会把你锁在一条路上。</span></div></section><aside class="orientation-panel"><div class="orientation-panel__compass">${renderWorldMarker()}<span class="orientation-panel__needle"></span><div class="orientation-panel__labels"><b>北</b><b>东</b><b>南</b><b>西</b></div></div><span class="section-kicker">当前方位 · 乾位</span><h3>把愿望落在<br>可行的时间里</h3><p>砺境会根据你的方向、时间与节律，生成一条属于你的初始山路。</p></aside></div></div>`;
}

function pagePlan(state) {
  return `<div class="page page--plan" data-demo-state="true">${intro("/plan", state)}<div class="plan-head"><div class="plan-head__progress"><span>本阶段行进</span><strong>${state.mountain.currentHeight.toLocaleString("zh-CN")} <small>/ ${state.mountain.summitHeight.toLocaleString("zh-CN")}m</small></strong>${progressBar(state.mountain.visiblePercent)}<div><span>山脚</span><span>云中山脊</span><span>主峰</span></div></div><div class="plan-head__balance"><div class="balance-wheel balance-wheel--large"><span></span><b>☯</b></div><div><span>今日阴阳</span><strong>${state.today.completed} / ${state.today.total}</strong><p>该收束时，就好好收束。</p></div></div></div><div class="plan-route"><div class="plan-route__label"><span>DAY 07</span><strong>九月 · 第四日</strong><small>一条完整的日行路线</small></div><div class="plan-route__list">${state.today.tasks.map(taskItem).join("")}<div class="route-future"><span class="route-future__line"></span><span class="route-future__cloud">云后还有一处营地</span></div></div></div></div>`;
}

function pageStudy(state) {
  const active = state.today.tasks.find((task) => task.status === "active");
  return `<div class="page page--study" data-demo-state="true">${intro("/study", state)}<div class="study-layout"><section class="study-focus"><div class="study-focus__top"><span class="section-kicker">当前山段 · ${active.type}</span>${demoNote()}<span class="study-focus__timer">25:00</span></div><div class="study-focus__title"><span class="study-focus__gua">${active.gua}</span><h2>${active.title}</h2><p>今天的任务不是证明你已经会了，而是让一个概念在心里站稳。</p></div><div class="study-question"><span class="question-label">今日引石 · 01</span><h3>如果函数在某点连续，它一定在该点可导吗？</h3><div class="answer-lines"><button type="button" data-action="answer" class="answer-line"><span>A</span><span>是，连续性已经包含了可导性</span></button><button type="button" data-action="answer" class="answer-line"><span>B</span><span>不一定，可导性还需要更强的局部条件</span></button><button type="button" data-action="answer" class="answer-line"><span>C</span><span>只有函数值大于零时才可以</span></button></div><button class="button button--ink study-submit" type="button" data-action="submit-answer">确认这一阶 ${icon("arrow")}</button></div></section><aside class="study-aside"><div class="study-aside__route"><span class="section-kicker">山路视野</span><div class="mini-mountain"><span class="mini-mountain__path"></span><i class="mini-mountain__dot mini-mountain__dot--one"></i><i class="mini-mountain__dot mini-mountain__dot--two"></i><i class="mini-mountain__dot mini-mountain__dot--three"></i></div><div class="study-aside__legend"><span><i class="dot dot--gold"></i>当前所在</span><span><i class="dot dot--gray"></i>下一处营地</span></div></div><div class="study-aside__tip"><span class="study-aside__tip-mark">灯</span><p>卡住并不意味着退步。<br>把问题说出来，我可以陪你把它拆小。</p><a href="/assistant" data-route="/assistant">问引路人 ${icon("arrow")}</a></div></aside></div></div>`;
}

function pageReview(state) {
  return `<div class="page page--review" data-demo-state="true">${intro("/review", state)}<div class="review-top"><div class="review-orbit"><span class="review-orbit__path review-orbit__path--one"></span><span class="review-orbit__path review-orbit__path--two"></span>${renderWorldMarker()}<strong>12</strong><small>待巩固</small></div><div class="review-top__copy"><span class="section-kicker">今日回望</span><h2>让走过的路<br><em>变成你的路。</em></h2><p>短暂回到旧营地，不是因为你走错了，而是为了让下一次攀登更稳。</p>${action("开始回环复习", "/study", "button button--ink")}</div><div class="review-top__stats">${metaLine("预计用时", "18 分钟")}${metaLine("上次正确率", "64%")}${metaLine("记忆窗口", "今天")}</div></div><section class="review-list">${sectionTitle("需要你回望的山脊", "四个知识节点", action("查看全部", "/knowledge", "text-link", "arrow"))}<div class="knowledge-rows">${state.knowledge.slice(0, 3).map((item) => `<article class="knowledge-row"><span class="knowledge-row__gua">${item.gua}</span><div><span>${item.domain}</span><h3>${item.title}</h3></div><div class="knowledge-row__mastery">${progressBar(item.mastery, item.color === "cinnabar" ? "red" : "amber")}<strong>${item.mastery}%</strong></div><a href="/study" data-route="/study" aria-label="复习 ${item.title}">${icon("arrow", "复习")}</a></article>`).join("")}</div></section></div>`;
}

function pageKnowledge(state) {
  return `<div class="page page--knowledge" data-demo-state="true">${intro("/knowledge", state)}<div class="knowledge-head"><div class="knowledge-head__map"><span class="knowledge-head__orbit knowledge-head__orbit--one"></span><span class="knowledge-head__orbit knowledge-head__orbit--two"></span><span class="knowledge-head__center">☯</span>${["☰", "☲", "☴", "☵", "☶", "☷"].map((gua, i) => `<i class="knowledge-node knowledge-node--${i + 1}">${gua}</i>`).join("")}</div><div class="knowledge-head__copy"><span class="section-kicker">知识星轨 · 06 个维度</span><h2>你不是在记忆<br><em>一堆孤立的答案。</em></h2><p>每个知识点都会在群峰中找到位置。掌握它，就点亮一条通往更远山脊的路。</p><div class="knowledge-head__legend"><span><i class="dot dot--gold"></i>已稳固</span><span><i class="dot dot--red"></i>待回望</span><span><i class="dot dot--gray"></i>初探</span></div></div></div><section class="knowledge-grid">${sectionTitle("你的群峰", "掌握度总览", `${demoNote()} ${action("进入复习", "/review", "text-link", "arrow")}`)}<div class="knowledge-cards">${state.knowledge.map((item) => `<article class="knowledge-card knowledge-card--${item.color}"><div class="knowledge-card__head"><span>${item.gua}</span><small>${item.state}</small></div><h3>${item.title}</h3><p>${item.domain}</p>${progressBar(item.mastery, item.color === "cinnabar" ? "red" : item.color === "rock" ? "gray" : "amber")}<div><strong>${item.mastery}%</strong><span>掌握度</span></div></article>`).join("")}</div></section></div>`;
}

function pageAssistant(state) {
  const portrait = assetUrl(state.user.avatarAssetId);
  return `<div class="page page--assistant" data-demo-state="true">${intro("/assistant", state)}<div class="assistant-layout"><section class="assistant-dialog"><div class="assistant-dialog__header"><img src="${portrait}" alt="砺境引路人头像"><div><span>云中引路人</span><strong>知知</strong></div><i class="online-dot"></i><small>在线 · 会记住你的学习上下文</small></div><div class="assistant-dialog__body"><div class="message message--guide"><span class="message__mark">知</span><p>今天的云雾很厚。<br>你想从哪一处山脊开始问？</p></div><div class="suggestion-list"><button type="button" data-action="ask-guide">把极限与连续讲得更直白</button><button type="button" data-action="ask-guide">帮我拆一段 25 分钟的学习</button><button type="button" data-action="ask-guide">我今天状态不好，还要坚持吗？</button></div></div><form class="assistant-composer" data-demo-form="assistant"><input name="prompt" placeholder="说出你卡住的地方……" aria-label="向引路人提问"><button type="submit" class="icon-button icon-button--dark" title="发送问题">${icon("arrow", "发送问题")}</button></form></section><aside class="assistant-aside"><div class="assistant-aside__portrait" style="--image:url('${assetUrl("aaa-hero-character-female-v2")}')"><span>引路人<br><b>不替你走路</b></span></div><div class="assistant-aside__note"><span class="section-kicker">今日提示</span><p>“你不需要先变得自律，才配开始。每次回来，都是自律正在发生。”</p></div></aside></div></div>`;
}

function pageGrowth(state) {
  return `<div class="page page--growth" data-demo-state="true">${intro("/growth", state)}<div class="growth-hero"><div class="growth-hero__seal"><div class="growth-hero__ring"></div><span>行者</span><strong>07</strong><small>初见山门</small></div><div class="growth-hero__copy"><span class="section-kicker">气韵 · 正在积累</span><h2>你已经走了<br><em>七天不息。</em></h2><p>这不是一条漂亮的统计线，而是七次你本可以放弃、却又回到山路上的证据。</p>${action("继续今日行旅", "/plan", "button button--ink")}</div><div class="growth-hero__meter"><div class="meter-label"><span>距下一枚印记</span><strong>640 <small>/ 1,000 气韵</small></strong></div>${progressBar(64)}<span>云隙初光 · 已点亮</span></div></div><section class="achievements">${sectionTitle("登峰碑记", "已经留下的印记", action("查看山海图", "/map", "text-link", "arrow"))}<div class="achievement-grid">${state.achievements.map((item) => `<article class="achievement ${item.unlocked ? "is-unlocked" : "is-locked"}"><span class="achievement__mark">${item.unlocked ? item.mark : icon("lock", "未解锁")}</span><div><span>${item.unlocked ? "已解锁" : "尚在云后"}</span><h3>${item.title}</h3><p>${item.detail}</p></div>${item.unlocked ? icon("check", "已解锁") : ""}</article>`).join("")}</div></section><section class="summit-tease"><span class="summit-tease__cloud"></span><div><span class="section-kicker">隐藏成就 · 登临</span><h2>等你站上山顶，<br><em>回望这一路。</em></h2><p>完成当前阶段后，人生副本将开启下一座山。</p></div><span class="summit-tease__height">8,848<small>m</small></span></section></div>`;
}

function pageMap(state) {
  const scene = assetUrl("starforged-frontier-scene-v1");
  return `<div class="page page--map" data-demo-state="true">${intro("/map", state)}<div class="map-stage" style="--map-image:url('${scene}')"><div class="map-stage__veil"></div><div class="map-stage__title"><span>山海图 · 远方山系</span><strong>云后还有<br>新的峰顶</strong></div><div class="map-stage__route">${state.map.map((item, index) => `<button class="map-node map-node--${item.state}" type="button" data-action="map-node"><span>${index + 1}</span><strong>${item.title}</strong><small>${item.subtitle}</small><em>${item.height}</em></button>`).join("")}<span class="map-stage__path"></span></div><div class="map-stage__caption"><span class="dot dot--gold"></span> 已点亮的路会为你留下光<br><span class="dot dot--gray"></span> 还未走到的地方，先不必急着看清</div></div></div>`;
}

function pageProfile(state) {
  return `<div class="page page--profile" data-demo-state="true">${intro("/profile", state)}<div class="profile-layout"><section class="profile-card"><div class="profile-card__top"><div class="profile-card__seal">行</div><div><span class="section-kicker">行者编号 · DEMO-01</span><h2>${state.user.name}</h2><p>${state.user.title}</p></div><button class="icon-button" type="button" title="编辑个人资料">${icon("settings", "编辑个人资料")}</button></div><div class="profile-card__path"><span>第一次入山</span><i></i><strong>七日不息</strong><i></i><span>下一枚印记</span></div><div class="profile-card__footer">${metaLine("已行进", "7 日")}${metaLine("当前高度", `${state.mountain.currentHeight.toLocaleString("zh-CN")}m`)}${metaLine("回望次数", "12")}</div></section><section class="settings-list">${sectionTitle("行者设置", "让这幅长卷适合你", demoNote())}<button class="setting-row" type="button" data-action="toggle-motion"><span>${icon("spark")}</span><div><strong>动效与云雾</strong><small>保留沉浸感，减少不必要的运动</small></div><i class="toggle is-on"><b></b></i></button><button class="setting-row" type="button"><span>${icon("bell")}</span><div><strong>通知与提醒</strong><small>决定什么时候收到下一处营地的消息</small></div>${icon("chevron")}</button><button class="setting-row" type="button"><span>${icon("user")}</span><div><strong>隐私与账号</strong><small>管理你的身份印记和数据边界</small></div>${icon("chevron")}</button></section></div></div>`;
}

function pageState(route, state) {
  const stateMap = {
    "/state/loading": { iconName: "spark", action: "返回山脚", href: "/" },
    "/state/empty": { iconName: "mountain", action: "去选择方向", href: "/goals" },
    "/state/error": { iconName: "arrow", action: "再次尝试", href: "/plan" },
    "/state/review": { iconName: "compass", action: "回到山脚", href: "/" },
    "/state/permission": { iconName: "lock", action: "返回可用路线", href: "/" },
  }[route];
  return `<div class="page page--state page--state-${route.split("/").pop()}" data-demo-state="true"><div class="state-scene"><div class="state-scene__symbol">${icon(stateMap.iconName)}</div><span class="page-intro__kicker">${getRouteMeta(route).eyebrow}</span><h1>${getRouteMeta(route).title}</h1><p>${getRouteMeta(route).description}</p>${action(stateMap.action, stateMap.href)}<small>状态内容 · ${demoNote()}</small></div></div>`;
}

export const PAGE_RENDERERS = {
  "/": pageHome,
  "/auth": pageAuth,
  "/goals": pageGoals,
  "/plan": pagePlan,
  "/study": pageStudy,
  "/review": pageReview,
  "/knowledge": pageKnowledge,
  "/assistant": pageAssistant,
  "/growth": pageGrowth,
  "/map": pageMap,
  "/profile": pageProfile,
  "/state/loading": (state) => pageState("/state/loading", state),
  "/state/empty": (state) => pageState("/state/empty", state),
  "/state/error": (state) => pageState("/state/error", state),
  "/state/review": (state) => pageState("/state/review", state),
  "/state/permission": (state) => pageState("/state/permission", state),
};

export function renderPage(route, state) {
  const normalized = Object.hasOwn(ROUTES, route) ? route : "/";
  return PAGE_RENDERERS[normalized](state);
}
