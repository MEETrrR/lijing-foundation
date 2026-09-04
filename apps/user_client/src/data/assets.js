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
    alt: "沿山路向上延伸的成长行旅",
  },
  "lijing-summit-climb-ink-v2": {
    assetId: "lijing-summit-climb-ink-v2",
    path: "/assets/generated/source/lijing-summit-climb-ink-v2.png",
    role: "chapter_background",
    alt: "通往东方天门主峰的攀登群峰",
  },
  "lijing-guide-background-ink-v1": {
    assetId: "lijing-guide-background-ink-v1",
    path: "/assets/generated/source/guides/lijing-guide-background-ink-v1.png",
    role: "chapter_background",
    alt: "云中引路殿与悬空灯火的东方水墨场景",
  },
  "lijing-guide-pagoda-v1": {
    assetId: "lijing-guide-pagoda-v1",
    path: "/assets/generated/source/guides/lijing-guide-pagoda-v1.png",
    role: "guide_relic",
    alt: "悬于云海中的东方宝塔引路灵器",
  },
  "lijing-guide-ding-v1": {
    assetId: "lijing-guide-ding-v1",
    path: "/assets/generated/source/guides/lijing-guide-ding-v1.png",
    role: "guide_relic",
    alt: "承载阴阳云火的东方重鼎引路灵器",
  },
  "lijing-guide-fan-v1": {
    assetId: "lijing-guide-fan-v1",
    path: "/assets/generated/source/guides/lijing-guide-fan-v1.png",
    role: "guide_relic",
    alt: "展开山河星轨的东方折扇引路灵器",
  },
  "lijing-guide-heavenly-book-v1": {
    assetId: "lijing-guide-heavenly-book-v1",
    path: "/assets/generated/source/guides/lijing-guide-heavenly-book-v1.png",
    role: "guide_relic",
    alt: "展开山河星轨的东方天书引路灵器",
  },
  "bagua-ink-compass-v1": {
    assetId: "bagua-ink-compass-v1",
    path: "/assets/generated/source/bagua-ink-compass-v1.png",
    role: "bagua_reference_scene",
    alt: "水墨山河与太极八卦方位图",
  },
  "bagua-yinyang-core-v1": {
    assetId: "bagua-yinyang-core-v1",
    path: "/assets/generated/source/bagua-yinyang-core-v1.png",
    role: "bagua_center_visual",
    alt: "灵兽环抱的水墨阴阳核心",
  },
  "opening-dragon-v1": {
    assetId: "opening-dragon-v1",
    path: "/assets/generated/source/opening/opening-dragon-v1.png",
    role: "opening_animation_subject",
    alt: "黑金水墨升天神龙",
  },
  "opening-phoenix-v1": {
    assetId: "opening-phoenix-v1",
    path: "/assets/generated/source/opening/opening-phoenix-v1.png",
    role: "opening_animation_subject",
    alt: "朱砂金色水墨飞凤",
  },
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
