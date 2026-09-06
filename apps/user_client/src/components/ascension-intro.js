import { assetUrl } from "../data/assets.js";

export function renderAscensionIntro() {
  return `<div class="ascension-intro" id="ascension-intro" role="status" aria-live="polite" aria-label="正在开启八方行旅" aria-hidden="true" hidden>
    <video class="ascension-intro__video" src="${assetUrl("opening-longfeng-clean-v1")}" autoplay muted playsinline preload="auto" tabindex="-1" aria-hidden="true"></video>
  </div>`;
}
