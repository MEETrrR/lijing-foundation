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
    if (task.date < today || task.date > input.target_date) {
      errors.push(validationError("PLAN_TASK_OUT_OF_RANGE", "计划任务超出了目标日期范围。", { date: task.date }));
    }
    if (!Number.isInteger(task.planned_minutes) || task.planned_minutes < 5 || task.planned_minutes > 1440) {
      errors.push(validationError("PLAN_TASK_DURATION_INVALID", "计划任务时长无效。", { id: task.id ?? null, planned_minutes: task.planned_minutes ?? null }));
    }
    for (const field of ["title", "action", "expected_output", "completion_standard"]) {
      if (typeof task[field] !== "string" || !task[field].trim()) {
        errors.push(validationError("PLAN_TASK_NOT_ACTIONABLE", "计划任务缺少可以直接执行或验收的内容。", { id: task.id ?? null, field }));
      }
    }
    const milestone = milestoneForDate(task.date, milestones);
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
    if (scheduled < requested) {
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
