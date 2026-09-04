import { assetUrl } from "../data/assets.js";

export function renderAscensionIntro() {
  return `<div class="ascension-intro" id="ascension-intro" role="status" aria-live="polite" aria-label="正在开启八方行旅" aria-hidden="true" hidden style="--ascension-bagua-image:url('${assetUrl("bagua-ink-compass-v1")}')">
    <div class="ascension-intro__wash"></div>
    <div class="ascension-intro__grain"></div>
    <div class="ascension-intro__orbit ascension-intro__orbit--outer"></div>
    <div class="ascension-intro__orbit ascension-intro__orbit--inner"></div>
    <img class="ascension-intro__dragon" src="${assetUrl("opening-dragon-v1")}" alt="">
    <img class="ascension-intro__phoenix" src="${assetUrl("opening-phoenix-v1")}" alt="">
    <div class="ascension-intro__core"><span>☯</span><small>八方行旅</small></div>
  </div>`;
}
