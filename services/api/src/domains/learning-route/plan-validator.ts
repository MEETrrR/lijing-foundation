const DAY_MS = 86400000;
const STUDY_DAYS_PER_WEEK = 6.5;

function dateValue(value) {
  return Date.parse(`${value}T00:00:00.000Z`);
}

function dateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function weekStart(value) {
  const day = new Date(dateValue(value)).getUTCDay();
  return dateOnly(dateValue(value) - ((day + 6) % 7) * DAY_MS);
}

function weeklyCapacityMinutes(weeklyHours) {
  return Math.max(5, Math.floor(Number(weeklyHours) * 60));
}

function effectiveDailyMinutes(input = {}, profile = {}) {
  const weeklyHours = Number(input.weekly_hours);
  const weeklyCapacity = weeklyCapacityMinutes(weeklyHours);
  const maximumDaily = Math.max(5, Math.floor(weeklyCapacity / STUDY_DAYS_PER_WEEK));
  const requested = Number(input.daily_minutes ?? profile.daily_minutes);
  if (!Number.isInteger(requested) || requested < 5) return maximumDaily;
  return Math.max(5, Math.min(requested, maximumDaily));
}

function scheduleBudgetForDate(date, dailyMinutes) {
  return new Date(dateValue(date)).getUTCDay() === 0
    ? Math.max(5, Math.floor(dailyMinutes * 0.5))
    : dailyMinutes;
}

function flattenTasks(plan) {
  return (plan?.months ?? []).flatMap((month) => month.days ?? []);
}

function milestoneForDate(date, milestones) {
  return milestones.find((milestone) => date >= milestone.start_date && date <= milestone.end_date) ?? null;
}

function milestoneForPlanDate(date, milestones) {
  return milestoneForDate(date, milestones)
    ?? milestones.filter((milestone) => milestone.end_date < date).at(-1)
    ?? milestones.find((milestone) => milestone.start_date > date)
    ?? milestones.at(-1)
    ?? null;
}

function validationError(code, message, meta = {}) {
  return { code, message, meta };
}

function validatePlan({ plan, milestones, input, profile = {}, today }) {
  const errors = [];
  const warnings = [];
  const tasks = flattenTasks(plan);
  const ids = new Set();
  const dates = new Set();
  const dayTotals = new Map();
  const weekTotals = new Map();
  const phaseTotals = new Map();
  const effectiveDaily = effectiveDailyMinutes(input, profile);
  const weeklyCapacity = weeklyCapacityMinutes(input.weekly_hours);

  if (!plan || typeof plan !== "object") {
    return { ok: false, errors: [validationError("PLAN_MISSING", "服务器没有生成可执行计划。")], warnings, metrics: {} };
  }
  if (plan.today?.date !== today) {
    errors.push(validationError("PLAN_TODAY_DATE_MISMATCH", "计划的今日日期与服务器日期不一致。", { expected: today, actual: plan.today?.date ?? null }));
  }
  if (plan.daily_minutes !== effectiveDaily) {
    errors.push(validationError("PLAN_DAILY_MINUTES_MISMATCH", "计划展示的每日时长没有遵守统一时间规则。", { expected: effectiveDaily, actual: plan.daily_minutes }));
  }
  if (plan.weekly_hours !== input.weekly_hours) {
    errors.push(validationError("PLAN_WEEKLY_HOURS_MISMATCH", "计划没有保留用户声明的每周时间约束。", { expected: input.weekly_hours, actual: plan.weekly_hours }));
  }

  for (const task of tasks) {
    if (!task || typeof task !== "object") {
      errors.push(validationError("PLAN_TASK_INVALID", "计划包含无法执行的任务。"));
      continue;
    }
    if (typeof task.id !== "string" || ids.has(task.id)) {
      errors.push(validationError("PLAN_DUPLICATE_TASK", "计划包含重复任务。", { id: task.id ?? null }));
    } else {
      ids.add(task.id);
    }
    if (typeof task.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(task.date)) {
      errors.push(validationError("PLAN_TASK_DATE_INVALID", "计划任务日期无效。", { id: task.id ?? null }));
      continue;
    }
    if (dates.has(task.date)) {
      errors.push(validationError("PLAN_DUPLICATE_DATE", "同一天被安排了多个主任务，计划无法按日执行。", { date: task.date }));
    } else {
      dates.add(task.date);
    }
    if (task.date > input.target_date || task.date < plan.horizon?.start_date) {
      errors.push(validationError("PLAN_TASK_OUT_OF_RANGE", "计划任务超出了目标日期范围。", { date: task.date }));
    }
    if (!Number.isInteger(task.planned_minutes) || task.planned_minutes < 5 || task.planned_minutes > 1440) {
      errors.push(validationError("PLAN_TASK_DURATION_INVALID", "计划任务时长无效。", { id: task.id ?? null, planned_minutes: task.planned_minutes ?? null }));
    }
    for (const field of ["title", "topic", "action", "expected_output"]) {
      if (typeof task[field] !== "string" || !task[field].trim()) {
        errors.push(validationError("PLAN_TASK_NOT_ACTIONABLE", "计划任务缺少可以直接执行或验收的内容。", { id: task.id ?? null, field }));
      }
    }
    if (!Number.isInteger(task.practice?.count) || task.practice.count < 0 || task.practice.count > 100) {
      errors.push(validationError("PLAN_PRACTICE_COUNT_INVALID", "计划练习数量无效。", { id: task.id ?? null }));
    }
    if (task.practice?.count > 0 && (!task.practice.source || !task.practice.scope?.trim())) {
      errors.push(validationError("PLAN_PRACTICE_SOURCE_MISSING", "计划练习必须指向现成题库和范围。", { id: task.id ?? null }));
    }
    if (task.resource && (task.resource.verification_status !== "catalogued" || !/^https:\/\//i.test(task.resource.url))) {
      errors.push(validationError("PLAN_RESOURCE_UNVERIFIED", "计划资源必须来自已收录的安全链接。", { id: task.id ?? null }));
    }
    const milestone = milestoneForPlanDate(task.date, milestones);
    if (!milestone) {
      errors.push(validationError("PLAN_PHASE_DATE_MISMATCH", "任务日期不属于任何阶段，无法判断它服务于哪个目标。", { date: task.date, id: task.id ?? null }));
    } else if (task.milestone_title !== milestone.title) {
      errors.push(validationError("PLAN_PHASE_LABEL_MISMATCH", "任务标记的阶段与日期对应的阶段不一致。", { date: task.date, expected: milestone.title, actual: task.milestone_title ?? null }));
    } else {
      phaseTotals.set(milestone.title, (phaseTotals.get(milestone.title) ?? 0) + (Number(task.planned_minutes) || 0));
    }
    dayTotals.set(task.date, (dayTotals.get(task.date) ?? 0) + (Number(task.planned_minutes) || 0));
    const start = weekStart(task.date);
    weekTotals.set(start, (weekTotals.get(start) ?? 0) + (Number(task.planned_minutes) || 0));
  }

  for (const [date, minutes] of dayTotals) {
    const budget = scheduleBudgetForDate(date, effectiveDaily);
    if (minutes > budget) {
      errors.push(validationError("PLAN_DAILY_CAPACITY_EXCEEDED", "计划超过了这一天的可用学习时长。", { date, minutes, budget }));
    }
  }
  for (const [start, minutes] of weekTotals) {
    if (minutes > weeklyCapacity) {
      errors.push(validationError("PLAN_WEEKLY_CAPACITY_EXCEEDED", "计划超过了用户声明的每周可投入时间。", { week_start: start, minutes, budget: weeklyCapacity }));
    }
  }

  const cycleTasks = plan.weekly_tasks ?? [];
  const expectedCycleDays = Math.min(7, Math.floor((Date.parse(`${input.target_date}T00:00:00.000Z`) - dateValue(today)) / DAY_MS) + 1);
  if (cycleTasks.length !== expectedCycleDays) {
    errors.push(validationError("PLAN_WEEKLY_TASK_COUNT_INVALID", "七日计划没有覆盖当前可安排的连续日期。", { expected: expectedCycleDays, actual: cycleTasks.length }));
  }
  for (let index = 0; index < cycleTasks.length; index += 1) {
    const task = cycleTasks[index];
    const expectedDate = dateOnly(dateValue(today) + index * DAY_MS);
    if (task.date !== expectedDate) {
      errors.push(validationError("PLAN_WEEKLY_DATES_NOT_CONTIGUOUS", "七日计划日期必须从今天开始连续排列。", { expected: expectedDate, actual: task.date ?? null }));
    }
    if (!tasks.some((stored) => stored.id === task.id && stored.date === task.date)) {
      errors.push(validationError("PLAN_WEEKLY_TASK_NOT_STORED", "七日计划任务没有保存在计划明细中。", { id: task.id ?? null }));
    }
  }
  const cycleMinutes = cycleTasks.reduce((total, task) => total + (Number(task.planned_minutes) || 0), 0);
  const cycleBudget = Math.floor(weeklyCapacity * 0.8);
  if (cycleMinutes > cycleBudget) {
    errors.push(validationError("PLAN_CYCLE_BUFFER_EXCEEDED", "七日计划必须为复盘和现实变化保留至少 20% 时间。", { minutes: cycleMinutes, budget: cycleBudget }));
  }

  const todayIds = new Set((plan.today?.tasks ?? []).map((task) => task?.id).filter(Boolean));
  const actualTodayIds = new Set(tasks.filter((task) => task.date === today).map((task) => task.id));
  if (todayIds.size !== actualTodayIds.size || [...todayIds].some((id) => !actualTodayIds.has(id))) {
    errors.push(validationError("PLAN_TODAY_TASKS_MISMATCH", "计划首页的今日任务与任务明细不一致。", { expected: [...actualTodayIds], actual: [...todayIds] }));
  }
  for (const task of plan.today?.tasks ?? []) {
    if (task?.date !== today) {
      errors.push(validationError("PLAN_TODAY_CONTAINS_FUTURE_TASK", "今日任务区域包含了未来日期的任务。", { date: task?.date ?? null }));
    }
  }

  for (const milestone of milestones) {
    const scheduled = phaseTotals.get(milestone.title) ?? 0;
    const requested = milestone.planned_hours * 60;
    if (!Array.isArray(plan.weekly_tasks) && scheduled < requested) {
      warnings.push({
        code: "PLAN_PHASE_UNSCHEDULED_CAPACITY",
        message: `${milestone.title}还有${Math.round((requested - scheduled) / 60 * 10) / 10}小时没有被排入当前可用时段。`,
        meta: { title: milestone.title, requested_minutes: requested, scheduled_minutes: scheduled },
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics: {
      task_count: tasks.length,
      scheduled_minutes: tasks.reduce((total, task) => total + (Number(task.planned_minutes) || 0), 0),
      cycle_minutes: cycleMinutes,
      effective_daily_minutes: effectiveDaily,
      weekly_capacity_minutes: weeklyCapacity,
    },
  };
}

module.exports = {
  STUDY_DAYS_PER_WEEK,
  effectiveDailyMinutes,
  flattenTasks,
  scheduleBudgetForDate,
  validatePlan,
  weeklyCapacityMinutes,
};
