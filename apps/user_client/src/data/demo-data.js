export const DEMO_STATE = {
  isDemo: true,
  user: {
    name: "行者 01",
    title: "初见山门",
    avatarAssetId: "assistant-portrait-v1",
  },
  mountain: {
    currentHeight: 1280,
    summitHeight: 8848,
    visiblePercent: 38,
    currentChapter: "山脚 · 遥望",
    nextCamp: "听风台",
    nextCampDistance: "2.4 km",
    weather: "云海未散",
  },
  balance: {
    focus: 72,
    recovery: 48,
    energy: 64,
  },
  today: {
    completed: 2,
    total: 4,
    streak: 7,
    minutes: 26,
    tasks: [
      { id: "task-01", type: "基础", title: "晨光入山 · 复盘昨日错题", meta: "15 分钟 · 回望营地", status: "done", gua: "☵" },
      { id: "task-02", type: "攀登", title: "微积分 · 极限与连续", meta: "25 分钟 · 当前山段", status: "active", gua: "☲" },
      { id: "task-03", type: "连接", title: "把一个概念讲给引路人", meta: "10 分钟 · 知识星轨", status: "locked", gua: "☴" },
      { id: "task-04", type: "远眺", title: "夜行收束 · 写下今日一得", meta: "5 分钟 · 山脊营地", status: "locked", gua: "☶" },
    ],
  },
  goals: [
    { id: "goal-exam", title: "上岸一场重要考试", detail: "把备考变成每天可见的山路", selected: true, icon: "峰" },
    { id: "goal-skill", title: "掌握一项长期技能", detail: "让知识沉淀为可以迁移的能力", selected: false, icon: "脉" },
    { id: "goal-life", title: "建立稳定的生活节律", detail: "先照顾好脚下，再走得更远", selected: false, icon: "息" },
  ],
  knowledge: [
    { title: "极限与连续", domain: "数学 · 当前山段", mastery: 78, state: "稳固", gua: "☲", color: "gold" },
    { title: "导数的几何意义", domain: "数学 · 待巩固", mastery: 46, state: "回望", gua: "☵", color: "cinnabar" },
    { title: "函数建模", domain: "应用 · 已连通", mastery: 62, state: "连通", gua: "☴", color: "blue" },
    { title: "错题归因", domain: "方法 · 新路径", mastery: 25, state: "初探", gua: "☶", color: "rock" },
  ],
  achievements: [
    { title: "七日不息", detail: "连续七天留下有效学习记录", unlocked: true, mark: "01" },
    { title: "云隙初光", detail: "完成第一段稳定学习节律", unlocked: true, mark: "02" },
    { title: "登临", detail: "走完第一座阶段峰，回望来路", unlocked: false, mark: "03" },
  ],
  map: [
    { title: "山脚 · 遥望", subtitle: "已抵达", state: "complete", height: "1,280 m" },
    { title: "听风台", subtitle: "当前路线", state: "current", height: "2,400 m" },
    { title: "观星脊", subtitle: "完成 2 个山段后显现", state: "locked", height: "4,100 m" },
    { title: "主峰 · 人生副本", subtitle: "阶段目标", state: "locked", height: "8,848 m" },
  ],
};
