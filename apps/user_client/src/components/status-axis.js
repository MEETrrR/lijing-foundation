import { mark, icon } from "./icons.js";

export function renderStatusAxis(state) {
  const { currentHeight, summitHeight, visiblePercent, nextCamp } = state.mountain;
  const { focus, recovery, energy } = state.balance;
  const recordLabel = state.isDemo
    ? "演示数据"
    : state.service?.persistence === "durable"
      ? "可恢复记录"
      : state.service?.persistence === "ephemeral"
        ? "临时会话记录"
        : "保存方式待确认";

  // 还没有任何进度时不展示读数。
  // 原先新用户在首屏看到的是「0m / 阴阳平衡 0 / 0 / 专注线 0% / 回息线 0% /
  // 下一处营地 · 待建立」—— 十个零铺成一面墙，传达的是"你什么都没有"，
  // 而不是"这里会记录你的进展"。零不是信息，是打击。
  const hasProgress = currentHeight > 0 || focus > 0 || recovery > 0 || energy > 0;

  if (!hasProgress) {
    return `<section class="status-axis status-axis--empty" data-tour-target="status-axis" aria-label="登山状态">
    <div class="status-axis__topline"><span>行者状态</span><span class="status-axis__demo">${recordLabel}</span></div>
    <p class="status-axis__empty-copy">还没有登山记录。留下第一条证据后，这里开始记你的高度与回息节奏。</p>
    <a class="status-axis__empty-link" href="/" data-route="/">从今天这一条开始 ${icon("arrow")}</a>
  </section>`;
  }

  return `<section class="status-axis" data-tour-target="status-axis" aria-label="登山状态">
    <div class="status-axis__topline"><span>行者状态</span><span class="status-axis__demo">${recordLabel} · ${state.mountain.weather}</span></div>
    <div class="status-axis__height"><strong>${currentHeight.toLocaleString("zh-CN")}m</strong><span>当前高度</span></div>
    <div class="status-axis__track"><span class="status-axis__fill" style="--progress: ${visiblePercent}%"></span><i class="status-axis__pin"></i></div>
    <div class="status-axis__legend"><span>山脚</span><span>${nextCamp}</span><span>主峰 ${summitHeight.toLocaleString("zh-CN")}m</span></div>
    <div class="status-axis__balance">
      <div class="balance-wheel"><span class="balance-wheel__half"></span><b>☯</b></div>
      <div class="balance-copy"><span>阴阳平衡</span><strong>${focus} <small>/ ${recovery}</small></strong><em>专注 · 回息</em></div>
    </div>
    <div class="status-axis__lines">
      <span>${mark("☰")}专注线 <i style="--value:${focus}%"></i><b>${focus}%</b></span>
      <span>${mark("☷")}回息线 <i style="--value:${energy}%"></i><b>${energy}%</b></span>
    </div>
    <span class="status-axis__next">下一处营地 · ${state.mountain.nextCampDistance}</span>
  </section>`;
}
