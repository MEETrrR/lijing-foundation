import { mark } from "./icons.js";

export function renderStatusAxis(state) {
  const { currentHeight, summitHeight, visiblePercent, nextCamp } = state.mountain;
  const { focus, recovery, energy } = state.balance;
  return `<section class="status-axis" aria-label="登山状态">
    <div class="status-axis__topline"><span>行者状态</span><span class="status-axis__demo">演示数据</span></div>
    <div class="status-axis__height"><strong>${currentHeight.toLocaleString("zh-CN")}m</strong><span>当前高度</span></div>
    <div class="status-axis__track"><span class="status-axis__fill" style="--progress: ${visiblePercent}%"></span><i class="status-axis__pin"></i></div>
    <div class="status-axis__legend"><span>山脚</span><span>${nextCamp}</span><span>主峰 ${summitHeight.toLocaleString("zh-CN")}m</span></div>
    <div class="status-axis__balance">
      <div class="balance-wheel"><span class="balance-wheel__half"></span><b>☯</b></div>
      <div class="balance-copy"><span>阴阳平衡</span><strong>${focus} <small>/ ${recovery}</small></strong><em>专注 · 回息</em></div>
    </div>
    <div class="status-axis__lines">
      <span>${mark("☰")}专注线 <i style="--value:${focus}%"></i></span>
      <span>${mark("☷")}回息线 <i style="--value:${energy}%"></i></span>
    </div>
  </section>`;
}
