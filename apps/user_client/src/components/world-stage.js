import { assetUrl } from "../data/assets.js";

const ROUTE_SCENES = {
  "/features": { assetId: "lijing-horizon-ink-v1", key: "directory" },
  "/": { assetId: "lijing-horizon-ink-v1", key: "horizon" },
  "/plan": { assetId: "lijing-growth-journey-ink-v1", key: "growth-journey" },
  "/growth": { assetId: "lijing-growth-journey-ink-v1", key: "growth-journey" },
  "/study": { assetId: "lijing-summit-climb-ink-v2", key: "summit-climb" },
  "/knowledge": { assetId: "lijing-summit-climb-ink-v2", key: "summit-climb" },
  "/map": { assetId: "lijing-summit-climb-ink-v2", key: "summit-climb" },
  "/review": { assetId: "lijing-recall-ink-v1", key: "recall" },
  "/profile": { assetId: "lijing-archive-ink-v2", key: "archive" },
  "/assistant": { assetId: "lijing-guide-background-ink-v1", key: "guide" },
  "/onboarding": { assetId: "lijing-onboarding-background-v2", key: "onboarding" },
};

export function renderWorldStage(route, { compact = false } = {}) {
  const fallbackScene = ["/auth", "/goals"].includes(route)
    ? { assetId: "bagua-ink-compass-v1", key: "bagua" }
    : { assetId: "starforged-frontier-scene-v1", key: "frontier" };
  const sceneConfig = ROUTE_SCENES[route] ?? fallbackScene;
  const scene = assetUrl(sceneConfig.assetId);
  const isInk = sceneConfig.key === "bagua";
  return `<div class="world-stage ${compact ? "world-stage--compact" : ""} world-stage--${sceneConfig.key} ${isInk ? "world-stage--ink" : ""}" data-scene="${sceneConfig.key}" aria-hidden="true">
    <div class="world-stage__image" style="--scene-image: url('${scene}')"></div>
    <div class="world-stage__wash"></div>
    <div class="world-stage__contours world-stage__contours--far"></div>
    <div class="world-stage__contours world-stage__contours--near"></div>
    <div class="world-stage__meridian world-stage__meridian--one"></div>
    <div class="world-stage__meridian world-stage__meridian--two"></div>
    <div class="mist-layer mist-layer--far"></div>
    <div class="mist-layer mist-layer--middle"></div>
    <div class="mist-layer mist-layer--near"></div>
    <div class="star-orbit star-orbit--one"></div>
    <div class="star-orbit star-orbit--two"></div>
    <div class="world-stage__sun"></div>
    <div class="world-stage__seal">砺<br><span>境</span></div>
    <div class="world-stage__coordinates">东陆 · 星陨航线<br><span>STUDY / RPG SYSTEM</span></div>
  </div>`;
}

export function renderWorldMarker() {
  return `<div class="world-marker" aria-hidden="true">
    <span class="world-marker__ring world-marker__ring--outer"></span>
    <span class="world-marker__ring world-marker__ring--inner"></span>
    <span class="world-marker__yin">☯</span>
  </div>`;
}
