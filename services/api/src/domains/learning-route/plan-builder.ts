const DAY_MS = 86400000;

function dateValue(value) {
  return Date.parse(`${value}T00:00:00.000Z`);
}

function dateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function addDays(value, amount) {
  return dateOnly(dateValue(value) + amount * DAY_MS);
}

function monthStart(value) {
  return `${value.slice(0, 7)}-01`;
}

function monthEnd(value) {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  return dateOnly(Date.UTC(year, month, 0));
}

function monthLabel(value) {
  const [year, month] = value.split("-").map(Number);
  return `${year}年${month}月`;
}

function monthKeys(startDate, endDate) {
  const result = [];
  let cursor = monthStart(startDate);
  while (cursor <= endDate) {
    result.push(cursor.slice(0, 7));
    cursor = monthStart(addDays(monthEnd(cursor), 1));
  }
  return result;
}

function milestoneFor(date, milestones) {
  return milestones.find((milestone) => date >= milestone.start_date && date <= milestone.end_date)
    ?? milestones.at(-1);
}

function weekStart(date) {
  const day = new Date(dateValue(date)).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

const PATH_TASK_MODES = Object.freeze({
  postgraduate_entrance_exam: [
    { key: "framework", type: "学习", title: "建立框架", action: "整理知识边界和判断条件", output: "一页结构图或 3 条关键判断", standard: "能不看材料说清范围、条件和一个例子" },
    { key: "practice", type: "练习", title: "针对练习", action: "完成一组与本阶段产出直接相关的题目", output: "一组独立作答和错因标记", standard: "每道题都留下选择依据，不只记录答案" },
    { key: "output", type: "产出", title: "独立产出", action: "在不照抄材料的情况下完成一个小成果", output: "一份可保存、展示或检查的成果", standard: "成果能被别人按完成标准复查" },
    { key: "repair", type: "修正", title: "错因修正", action: "对照证据找出一个错误并改写步骤", output: "一条错因记录和一版修正答案", standard: "能指出错误发生的条件，并写出下一次避免方式" },
  ],
  civil_service_exam: [
    { key: "framework", type: "学习", title: "考点梳理", action: "把本阶段考点整理成判断清单", output: "一页考点清单", standard: "清单中的每项都有定义、边界或例子" },
    { key: "practice", type: "练习", title: "真题练习", action: "完成一组限量题并记录每道题的取舍", output: "一组作答、用时和错因", standard: "能解释错题原因，不把粗心当作结论" },
    { key: "output", type: "产出", title: "限时产出", action: "按考试要求完成一段独立作答", output: "一份带用时的作答稿", standard: "作答包含观点、依据和收束检查" },
    { key: "repair", type: "修正", title: "复盘提分", action: "从本轮作答中挑一个最影响结果的问题修正", output: "一条错因和一个下次策略", standard: "策略能在下一组题中被验证" },
  ],
  employment: [
    { key: "framework", type: "学习", title: "能力拆解", action: "把目标岗位或技能要求拆成可验证能力", output: "一张能力差距清单", standard: "每项能力都有对应证据或练习方式" },
    { key: "practice", type: "练习", title: "项目练习", action: "完成一个能暴露真实问题的小练习", output: "可运行、可展示或可检查的练习结果", standard: "结果能说明你做了什么以及为什么这样做" },
    { key: "output", type: "产出", title: "作品迭代", action: "把练习整理成目标岗位能看懂的成果", output: "一段作品说明、代码或案例记录", standard: "别人能在几分钟内看懂目标、过程和结果" },
    { key: "repair", type: "修正", title: "反馈迭代", action: "根据一次自测或外部反馈修正成果", output: "一版修改记录和下一轮验证点", standard: "改动对应一个明确问题，而不是泛泛润色" },
  ],
  professional_certificate: [
    { key: "framework", type: "学习", title: "范围拆解", action: "按考试或技能范围整理核心知识边界", output: "一页范围清单和优先级", standard: "能指出先学什么、暂不处理什么以及原因" },
    { key: "practice", type: "练习", title: "题型练习", action: "完成一组代表性练习并记录判断依据", output: "一组独立作答和错因标签", standard: "每个错误都能归到一个可修正原因" },
    { key: "output", type: "产出", title: "模拟应用", action: "在接近真实要求的条件下完成一次模拟", output: "一份模拟结果和时间记录", standard: "按真实要求完成并留下可复查证据" },
    { key: "repair", type: "修正", title: "弱项回炉", action: "选择一个反复出错的点进行针对性修正", output: "一条弱项记录和一组复测题", standard: "复测结果能证明是否真的改善" },
  ],
  personal_growth: [
    { key: "framework", type: "学习", title: "理解主题", action: "围绕本阶段主题建立自己的问题清单", output: "一页问题清单和 3 个关键点", standard: "能用自己的话说明正在解决什么问题" },
    { key: "practice", type: "练习", title: "刻意练习", action: "针对一个关键点做一次不照抄的练习", output: "一份练习结果和卡点记录", standard: "留下具体结果，不只记录学习时长" },
    { key: "output", type: "产出", title: "形成作品", action: "把本阶段理解变成一个可保存的小作品", output: "一份可保存、分享或回看的作品", standard: "作品能让未来的自己看懂当时的判断" },
    { key: "repair", type: "复盘", title: "调整方法", action: "回看过程，保留有效做法并删掉无效步骤", output: "一条方法记录和下一次实验", standard: "下一次行动能明确验证这次调整" },
  ],
});

function taskModesFor(goalType) {
  return PATH_TASK_MODES[goalType] ?? PATH_TASK_MODES.personal_growth;
}

function buildDayTask(date, milestone, dailyMinutes, today, goalType) {
  const isReviewDay = new Date(dateValue(date)).getUTCDay() === 0;
  const plannedMinutes = isReviewDay ? Math.max(5, Math.round(dailyMinutes * 0.5)) : dailyMinutes;
  const phaseDayIndex = Math.max(0, Math.floor((dateValue(date) - dateValue(milestone.start_date)) / DAY_MS));
  const outcome = milestone.outcomes[phaseDayIndex % milestone.outcomes.length];
  const mode = taskModesFor(goalType)[phaseDayIndex % taskModesFor(goalType).length];
  if (isReviewDay) {
    return {
      id: `plan-day-${date}`,
      date,
      title: `${milestone.title} · 周复盘与调整`,
      type: "复盘",
      planned_minutes: plannedMinutes,
      milestone_title: milestone.title,
      milestone_outcome: outcome,
      action: `回看本周围绕“${outcome}”留下的证据，并调整下周安排`,
      expected_output: "一条复盘记录和下周的一个调整点",
      completion_standard: "能说清本周完成了什么、卡在哪里、下一周改什么",
      completion_status: date === today ? "active" : "planned",
      review_prompt: "记录本周完成证据，并调整下周安排。",
    };
  }
  return {
    id: `plan-day-${date}`,
    date,
    title: `${milestone.title} · ${mode.title}`,
    type: mode.type,
    planned_minutes: plannedMinutes,
    milestone_title: milestone.title,
    milestone_outcome: outcome,
    action: `${mode.action}，聚焦“${outcome}”`,
    expected_output: mode.output,
    completion_standard: mode.standard,
    completion_status: date === today ? "active" : "planned",
    review_prompt: `完成后记录：${mode.standard}。`,
  };
}

function buildWeeks(days) {
  const groups = new Map();
  for (const day of days) {
    const start = weekStart(day.date);
    if (!groups.has(start)) groups.set(start, []);
    groups.get(start).push(day);
  }
  return [...groups.entries()].map(([start, weekDays]) => ({
    week_start: start,
    week_end: weekDays.at(-1).date,
    focus: weekDays[0].milestone_title,
    planned_minutes: weekDays.reduce((total, day) => total + day.planned_minutes, 0),
    days: weekDays.map((day) => day.id),
  }));
}

function buildPlanHierarchy({ input, milestones, today, summary, profile = {}, clock = () => Date.now() }) {
  const profileDailyMinutes = Number(profile.daily_minutes);
  const requestedDailyMinutes = Number(input.daily_minutes ?? profileDailyMinutes);
  const dailyMinutes = Number.isInteger(requestedDailyMinutes) && requestedDailyMinutes >= 5
    ? Math.min(requestedDailyMinutes, 1440)
    : Math.max(25, Math.floor((input.weekly_hours * 60) / 7));
  const dates = [];
  for (let cursor = today; cursor <= input.target_date; cursor = addDays(cursor, 1)) {
    dates.push(cursor);
  }
  const dayTasks = dates.map((date) => buildDayTask(date, milestoneFor(date, milestones), dailyMinutes, today, input.goal_type));
  const daysByMonth = new Map();
  dayTasks.forEach((day) => {
    const key = day.date.slice(0, 7);
    if (!daysByMonth.has(key)) daysByMonth.set(key, []);
    daysByMonth.get(key).push(day);
  });
  const months = monthKeys(today, input.target_date).map((month) => {
    const days = daysByMonth.get(month) ?? [];
    const first = days[0]?.date ?? monthStart(`${month}-01`);
    const last = days.at(-1)?.date ?? monthEnd(`${month}-01`);
    const monthMilestones = milestones.filter((milestone) => milestone.end_date >= first && milestone.start_date <= last);
    const lead = monthMilestones[0] ?? milestoneFor(first, milestones);
    return {
      id: `plan-month-${month}`,
      month,
      label: monthLabel(month),
      start_date: first,
      end_date: last,
      title: lead.title,
      focus: lead.outcomes[0],
      planned_hours: Math.round(days.reduce((total, day) => total + day.planned_minutes, 0) / 60 * 10) / 10,
      weeks: buildWeeks(days),
      days,
    };
  });
  const years = [...new Set(months.map((month) => month.month.slice(0, 4)))].map((year) => {
    const yearMonths = months.filter((month) => month.month.startsWith(year));
    const yearMilestones = milestones.filter((milestone) => milestone.end_date.slice(0, 4) >= year && milestone.start_date.slice(0, 4) <= year);
    return {
      year: Number(year),
      start_date: yearMonths[0].start_date,
      end_date: yearMonths.at(-1).end_date,
      title: year === today.slice(0, 4) ? "当前年度主线" : `${year}年长期阶段`,
      objective: year === today.slice(0, 4) ? summary : yearMilestones.map((milestone) => milestone.title).join("、"),
      milestone_titles: yearMilestones.map((milestone) => milestone.title),
      planned_hours: Math.round(yearMonths.reduce((total, month) => total + month.planned_hours, 0) * 10) / 10,
    };
  });
  const currentYear = years.find((year) => year.year === Number(today.slice(0, 4))) ?? years[0];
  const todayMonth = months.find((month) => month.month === today.slice(0, 7));
  return {
    version: 1,
    generated_at: new Date(clock()).toISOString(),
    daily_minutes: dailyMinutes,
    horizon: {
      start_date: today,
      end_date: input.target_date,
      years,
    },
    current_year: currentYear ? {
      ...currentYear,
      months: months.filter((month) => month.month.startsWith(String(currentYear.year))),
    } : null,
    months,
    today: {
      date: today,
      tasks: todayMonth?.days ?? [],
    },
  };
}

module.exports = { buildPlanHierarchy, buildWeeks };
