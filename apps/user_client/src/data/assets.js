const ASSET_CATALOG = {
  "lijing-horizon-ink-v1": {
    assetId: "lijing-horizon-ink-v1",
    path: "/assets/generated/source/lijing-horizon-ink-v1.png",
    role: "chapter_background",
    alt: "无人物的东方水墨山海与星陨天门",
  },
  "lijing-recall-ink-v1": {
    assetId: "lijing-recall-ink-v1",
    path: "/assets/generated/source/lijing-recall-ink-v1.png",
    role: "chapter_background",
    alt: "湖面涟漪与东方山门的回望场景",
  },
  "lijing-archive-ink-v2": {
    assetId: "lijing-archive-ink-v2",
    path: "/assets/generated/source/lijing-archive-ink-v2.png",
    role: "chapter_background",
    alt: "悬崖档案殿与东方星图装置",
  },
  "lijing-growth-journey-ink-v1": {
    assetId: "lijing-growth-journey-ink-v1",
    path: "/assets/generated/source/lijing-growth-journey-ink-v1.png",
    role: "chapter_background",
    alt: "沿山路向上延伸的成长历程",
  },
  "lijing-summit-climb-ink-v2": {
    assetId: "lijing-summit-climb-ink-v2",
    path: "/assets/generated/source/lijing-summit-climb-ink-v2.png",
    role: "chapter_background",
    alt: "通往东方天门主峰的学习群峰",
  },
  "lijing-guide-background-ink-v1": {
    assetId: "lijing-guide-background-ink-v1",
    path: "/assets/generated/source/guides/lijing-guide-background-ink-v1.png",
    role: "chapter_background",
    alt: "云中引路殿与悬空灯火的东方水墨场景",
  },
  "lijing-onboarding-background-v2": {
    assetId: "lijing-onboarding-background-v2",
    path: "/assets/generated/source/onboarding/onboarding-background-v2.png",
    role: "onboarding_background",
    alt: "两侧山崖与古松环抱、中央留白的国风水墨山水引导背景",
  },
  "lijing-auth-gate-v1": {
    assetId: "lijing-auth-gate-v1",
    path: "/assets/generated/source/auth/lijing-auth-gate-v1.png",
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
    path: "/assets/generated/source/bagua-ink-compass-v1.png",
    role: "bagua_reference_scene",
    alt: "水墨山河与太极八卦方位图",
  },
  "opening-longfeng-clean-v1": {
    assetId: "opening-longfeng-clean-v1",
    path: "/assets/generated/source/opening/ink_longfeng_clean_1920x1080_24fps.mp4",
    role: "opening_animation_video",
    alt: "龙凤合流形成太极的东方水墨开场动画",
  },
};

export function getAsset(assetId) {
  return ASSET_CATALOG[assetId] ?? null;
}

export function assetUrl(assetId) {
  return getAsset(assetId)?.path ?? "";
}

export { ASSET_CATALOG };
