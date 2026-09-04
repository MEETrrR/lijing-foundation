import { assetUrl } from "../data/assets.js";

export function renderWorldStage(route, { compact = false } = {}) {
  const scene = assetUrl(route === "/" ? "aaa-home-title-screen-female-v2" : "starforged-frontier-scene-v1");
  return `<div class="world-stage ${compact ? "world-stage--compact" : ""}" aria-hidden="true">
    <div class="world-stage__wash"></div>
    <div class="world-stage__image" style="--scene-image: url('${scene}')"></div>
    <div class="world-stage__mountain"></div>
    <div class="mist-layer mist-layer--far"></div>
    <div class="mist-layer mist-layer--middle"></div>
    <div class="mist-layer mist-layer--near"></div>
    <div class="star-orbit star-orbit--one"></div>
    <div class="star-orbit star-orbit--two"></div>
    <div class="world-stage__seal">砺<br><span>境</span></div>
  </div>`;
}

export function renderWorldMarker() {
  return `<div class="world-marker" aria-hidden="true">
    <span class="world-marker__ring world-marker__ring--outer"></span>
    <span class="world-marker__ring world-marker__ring--inner"></span>
    <span class="world-marker__yin">◐</span>
  </div>`;
}
