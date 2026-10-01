const DAY_MS = 86400000;
const { effectiveDailyMinutes } = require("./plan-validator.ts");

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
  return milestones.find((milestone) => date >= milestone.start_date && date <= milestone.end_date) ?? null;
}

function weekStart(date) {
  const day = new Date(dateValue(date)).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

function milestoneForPlanDate(date, milestones) {
  return milestoneFor(date, milestones)
    ?? milestones.filter((milestone) => milestone.end_date < date).at(-1)
    ?? milestones.find((milestone) => milestone.start_date > date)
    ?? milestones.at(-1);
}

function buildDayTask(date, milestone, today, draftTask, input) {
  const phaseDayIndex = Math.max(0, Math.floor((dateValue(date) - dateValue(milestone.start_date)) / DAY_MS));
  const outcome = milestone.outcomes[phaseDayIndex % milestone.outcomes.length];
  return {
    id: `plan-day-${date}`,
    date,
    title: draftTask.title,
    type: draftTask.type,
    topic: draftTask.topic,
    planned_minutes: draftTask.planned_minutes,
    milestone_title: milestone.title,
    milestone_outcome: outcome,
    action: draftTask.action,
    expected_output: draftTask.expected_output,
    resource: draftTask.resource,
    resource_search_url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(`${input.goal_name} ${draftTask.topic}`)}`,
    practice: draftTask.practice,
    feedback: null,
    completion_status: date === today ? "active" : "planned",
    review_prompt: "按实际完成情况自报即可，无需上传学习证明。",
  };
}

function buildWeeklyTasks({ weeklyPlan, milestones, today, input }) {
  return weeklyPlan.map((draftTask) => {
    const milestone = milestoneForPlanDate(draftTask.date, milestones);
    return buildDayTask(draftTask.date, milestone, today, draftTask, input);
  });
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

function buildPlanHierarchy({ input, milestones, weeklyPlan, today, summary, profile = {}, clock = () => Date.now() }) {
  const requestedDailyMinutes = Number(input.daily_minutes ?? profile.daily_minutes);
  const dailyMinutes = effectiveDailyMinutes(input, profile);
  const dayTasks = buildWeeklyTasks({ weeklyPlan, milestones, today, input });
  const daysByMonth = new Map();
  dayTasks.forEach((day) => {
    const key = day.date.slice(0, 7);
    if (!daysByMonth.has(key)) daysByMonth.set(key, []);
    daysByMonth.get(key).push(day);
  });
  const months = monthKeys(today, input.target_date).map((month) => {
    const days = daysByMonth.get(month) ?? [];
    const first = monthStart(`${month}-01`);
    const last = monthEnd(`${month}-01`);
    const monthMilestones = milestones.filter((milestone) => milestone.end_date >= first && milestone.start_date <= last);
    const lead = monthMilestones[0] ?? { title: "留白与复盘", outcomes: ["保留时间处理复盘、核验和现实变化"] };
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
  return {
    version: 1,
    generated_at: new Date(clock()).toISOString(),
    daily_minutes: dailyMinutes,
    requested_daily_minutes: Number.isInteger(requestedDailyMinutes) ? requestedDailyMinutes : null,
    weekly_hours: input.weekly_hours,
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
      tasks: dayTasks.filter((day) => day.date === today),
    },
    cycle_start_date: dayTasks[0]?.date ?? today,
    cycle_end_date: dayTasks.at(-1)?.date ?? today,
    weekly_tasks: dayTasks,
    upcoming_tasks: dayTasks.filter((day) => day.date > today),
  };
}

module.exports = { buildPlanHierarchy, buildWeeklyTasks, buildWeeks };
