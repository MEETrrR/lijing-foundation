const ASSET_CATALOG = {
  "lijing-horizon-ink-v1": {
    assetId: "lijing-horizon-ink-v1",
    path: "/assets/generated/source/lijing-horizon-ink-v1.9ae90710b4bb.webp",
    role: "chapter_background",
    alt: "无人物的东方水墨山海与星陨天门",
  },
  "lijing-recall-ink-v1": {
    assetId: "lijing-recall-ink-v1",
    path: "/assets/generated/source/lijing-recall-ink-v1.c87ff09f0ecc.webp",
    role: "chapter_background",
    alt: "湖面涟漪与东方山门的回望场景",
  },
  "lijing-archive-ink-v2": {
    assetId: "lijing-archive-ink-v2",
    path: "/assets/generated/source/lijing-archive-ink-v2.b60a537519bc.webp",
    role: "chapter_background",
    alt: "悬崖档案殿与东方星图装置",
  },
  "lijing-growth-journey-ink-v1": {
    assetId: "lijing-growth-journey-ink-v1",
    path: "/assets/generated/source/lijing-growth-journey-ink-v1.1efcfebe37dc.webp",
    role: "chapter_background",
    alt: "沿山路向上延伸的成长历程",
  },
  "lijing-summit-climb-ink-v2": {
    assetId: "lijing-summit-climb-ink-v2",
    path: "/assets/generated/source/lijing-summit-climb-ink-v2.70d2d55c7a8a.webp",
    role: "chapter_background",
    alt: "通往东方天门主峰的学习群峰",
  },
  "lijing-guide-background-ink-v1": {
    assetId: "lijing-guide-background-ink-v1",
    path: "/assets/generated/source/guides/lijing-guide-background-ink-v1.91af800a6c54.webp",
    role: "chapter_background",
    alt: "云中引路殿与悬空灯火的东方水墨场景",
  },
  "lijing-onboarding-background-v2": {
    assetId: "lijing-onboarding-background-v2",
    path: "/assets/generated/source/onboarding/onboarding-background-v2.38f3c1adef81.webp",
    role: "onboarding_background",
    alt: "两侧山崖与古松环抱、中央留白的国风水墨山水引导背景",
  },
  "lijing-auth-gate-v1": {
    assetId: "lijing-auth-gate-v1",
    path: "/assets/generated/source/auth/lijing-auth-gate-v1.c44ade6c283e.webp",
    role: "auth_background",
    alt: "古典山门、石阶与云海组成的入山身份背景",
  },
  "lijing-guide-heavenly-book-v2": {
    assetId: "lijing-guide-heavenly-book-v2",
    path: "/assets/generated/source/guides/lijing-guide-heavenly-book-v2.071d0ea40dc3.webp",
    role: "guide_relic",
    alt: "展开山河星轨的砺境引路",
  },
  "bagua-ink-compass-v1": {
    assetId: "bagua-ink-compass-v1",
    path: "/assets/generated/source/bagua-ink-compass-v1.d0aab454dc70.webp",
    role: "bagua_reference_scene",
    alt: "水墨山河与太极八卦方位图",
  },
  "opening-longfeng-clean-v1": {
    assetId: "opening-longfeng-clean-v1",
    path: "/assets/generated/source/opening/ink_longfeng_clean_1920x1080_24fps.mp4",
    role: "opening_animation_video",
    alt: "龙凤合流形成太极的东方水墨开场动画",
  },
  "starforged-frontier-scene-v1": {
    assetId: "starforged-frontier-scene-v1",
    path: "/assets/generated/source/starforged-frontier-scene-v1.b48c8a6e4363.webp",
    role: "mountain_scene",
    alt: "云海之上的山门与星轨",
  },
  "assistant-portrait-v1": {
    assetId: "assistant-portrait-v1",
    path: "/assets/generated/source/assistant-portrait-v1.png",
    role: "assistant_avatar",
    alt: "砺境引路头像",
  },
};

export function getAsset(assetId) {
  return ASSET_CATALOG[assetId] ?? null;
}

export function assetUrl(assetId) {
  return getAsset(assetId)?.path ?? "";
}

export { ASSET_CATALOG };
