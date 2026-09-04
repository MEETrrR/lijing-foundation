const ASSET_CATALOG = {
  "starforged-frontier-scene-v1": {
    assetId: "starforged-frontier-scene-v1",
    path: "/assets/generated/source/starforged-frontier-scene-v1.png",
    role: "mountain_scene",
    alt: "云海之上的山门与星轨",
  },
  "aaa-home-title-screen-female-v2": {
    assetId: "aaa-home-title-screen-female-v2",
    path: "/assets/generated/source/aaa-home-title-screen-female-v2.png",
    role: "mountain_approach",
    alt: "行者站在山路前遥望云海山门",
  },
  "aaa-hero-character-female-v2": {
    assetId: "aaa-hero-character-female-v2",
    path: "/assets/generated/source/aaa-hero-character-female-v2.png",
    role: "guide_portrait",
    alt: "砺境引路人的肖像",
  },
  "assistant-portrait-v1": {
    assetId: "assistant-portrait-v1",
    path: "/assets/generated/source/assistant-portrait-v1.png",
    role: "assistant_avatar",
    alt: "砺境引路人头像",
  },
};

export function getAsset(assetId) {
  return ASSET_CATALOG[assetId] ?? null;
}

export function assetUrl(assetId) {
  return getAsset(assetId)?.path ?? "";
}

export { ASSET_CATALOG };
