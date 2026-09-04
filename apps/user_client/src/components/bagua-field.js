import { assetUrl } from "../data/assets.js";

const DIRECTIONS = [
  { key: "north", label: "北", gua: "坎", symbol: "☵", element: "水", meaning: "险中求通" },
  { key: "northeast", label: "东北", gua: "艮", symbol: "☶", element: "山", meaning: "止而不止" },
  { key: "east", label: "东", gua: "震", symbol: "☳", element: "雷", meaning: "动而生阳" },
  { key: "southeast", label: "东南", gua: "巽", symbol: "☴", element: "风", meaning: "入而顺行" },
  { key: "south", label: "南", gua: "离", symbol: "☲", element: "火", meaning: "明而不昧" },
  { key: "southwest", label: "西南", gua: "坤", symbol: "☷", element: "地", meaning: "厚德载物" },
  { key: "west", label: "西", gua: "兑", symbol: "☱", element: "泽", meaning: "悦而和合" },
  { key: "northwest", label: "西北", gua: "乾", symbol: "☰", element: "天", meaning: "自强不息" },
];

export function renderBaguaField({ active = "坎", compact = false, label = "八方方位", directoryItems = null } = {}) {
  const nodes = DIRECTIONS.map((direction) => {
    const selected = direction.gua === active;
    const item = directoryItems?.find((entry) => entry.gua === direction.gua);
    const copy = item
      ? `<b>${direction.label}</b><strong>${item.label}</strong><small>${item.detail}</small>`
      : `<b>${direction.label}</b><strong>${direction.gua}${direction.element}</strong><small>${direction.meaning}</small>`;
    if (item) {
      return `<a class="bagua-node bagua-node--${direction.key} bagua-node--directory ${selected ? "is-active" : ""}" href="${item.href}" data-route="${item.href}" title="进入${item.label} · ${item.detail}">
        <span class="bagua-node__symbol">${direction.symbol}</span><span class="bagua-node__copy">${copy}</span>
      </a>`;
    }
    return `<button class="bagua-node bagua-node--${direction.key} ${selected ? "is-active" : ""}" type="button" data-action="bagua-node" data-bagua="${direction.gua}" aria-pressed="${selected}" title="${direction.label} · ${direction.gua}${direction.element}">
      <span class="bagua-node__symbol">${direction.symbol}</span><span class="bagua-node__copy">${copy}</span>
    </button>`;
  }).join("");
  return `<section class="bagua-field ${compact ? "bagua-field--compact" : ""}" aria-label="${label}">
    <div class="bagua-field__paper" style="--bagua-image:url('${assetUrl("bagua-ink-compass-v1")}')">
      <div class="bagua-field__image"></div><div class="bagua-field__wash"></div>
      <div class="bagua-field__ring bagua-field__ring--outer"></div><div class="bagua-field__ring bagua-field__ring--middle"></div><div class="bagua-field__ring bagua-field__ring--inner"></div>
      <div class="bagua-field__axis bagua-field__axis--horizontal"></div><div class="bagua-field__axis bagua-field__axis--vertical"></div>
      <div class="bagua-field__center"><span>☯</span><b>砺境</b><small>阴阳 · 互生</small></div>
      ${nodes}
      <div class="bagua-field__caption">${label}<span>八方皆可入山，今日所行自有方位</span></div>
    </div>
  </section>`;
}

export { DIRECTIONS };
