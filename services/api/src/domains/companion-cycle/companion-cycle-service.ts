const crypto = require("node:crypto");
const { isValidRequestId } = require("../../platform/http/correlation-id.ts");
const { PlatformError } = require("../../platform/errors/error-catalog.ts");
const { publicAction } = require("./companion-action-service.ts");

const INTENTS = new Set(["start", "complete", "stuck", "skip"]);
const ENERGIES = new Set(["low", "normal", "high"]);
const BLOCKERS = new Set(["time", "difficulty", "emotion", "environment", "unknown"]);
const SAFE_TASK_ID = /^[A-Za-z0-9._:-]{1,120}$/;

function cycleKey(actorId, date) {
  return `companion:cycle:${actorId}:${date}`;
}

function idempotencyKey(actorId, key) {
  return `idempotency:${actorId}:companion.check-ins:${key}`;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

function evidenceHash(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeIdempotencyKey(value) {
  if (typeof value !== "string" || value.length < 16 || value.length > 128 || !/^[A-Za-z0-9._~:-]+$/.test(value)) {
    throw new PlatformError("VALIDATION_ERROR", "Idempotency-Key is required and must be a safe 16-128 character value");
  }
  return value;
}

function normalizeOptional(value, label, maximum) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new PlatformError("VALIDATION_ERROR", `${label} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new PlatformError("VALIDATION_ERROR", `${label} is invalid`);
  return normalized;
}

function localDate(clock, timezone) {
  const timeZone = typeof timezone === "string" && timezone.trim() ? timezone.trim() : "Asia/Shanghai";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(clock()));
    const part = (type) => parts.find((entry) => entry.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    return new Date(clock()).toISOString().slice(0, 10);
  }
}

function activeRouteTask(route, date) {
  if (!route || route.status !== "confirmed") return null;
  const tasks = route.plan?.today?.tasks;
  if (!Array.isArray(tasks)) return null;
  return tasks.find((task) => task?.completion_status === "active" && task.date === date)
    ?? tasks.find((task) => task?.completion_status === "active")
    ?? null;
}

function taskProjection(task) {
  if (!task) return null;
  return {
    id: task.id,
    title: typeof task.action === "string" && task.action.trim() ? task.action.trim() : task.title,
    type: typeof task.type === "string" ? task.type : "学习",
    estimated_minutes: Number.isInteger(task.planned_minutes) ? task.planned_minutes : 25,
  };
}

function validateCheckIn(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlatformError("VALIDATION_ERROR", "companion check-in must be an object");
  const allowed = new Set(["request_id", "intent", "task_id", "action_version", "energy", "blocker_type", "evidence_level", "evidence"]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new PlatformError("VALIDATION_ERROR", `unknown companion check-in field: ${key}`);
  if (!isValidRequestId(input.request_id)) throw new PlatformError("VALIDATION_ERROR", "request_id must be a UUID");
  if (!INTENTS.has(input.intent)) throw new PlatformError("VALIDATION_ERROR", "intent is invalid");
  const taskId = normalizeOptional(input.task_id, "task_id", 120);
  if (taskId && !SAFE_TASK_ID.test(taskId)) throw new PlatformError("VALIDATION_ERROR", "task_id is invalid");
  const actionVersion = input.action_version === undefined || input.action_version === null ? null : input.action_version;
  if (actionVersion !== null && (!Number.isInteger(actionVersion) || actionVersion < 1)) throw new PlatformError("VALIDATION_ERROR", "action_version is invalid");
  const energy = normalizeOptional(input.energy, "energy", 20);
  if (energy && !ENERGIES.has(energy)) throw new PlatformError("VALIDATION_ERROR", "energy is invalid");
  const blockerType = normalizeOptional(input.blocker_type, "blocker_type", 20);
  if (blockerType && !BLOCKERS.has(blockerType)) throw new PlatformError("VALIDATION_ERROR", "blocker_type is invalid");
  const evidence = normalizeOptional(input.evidence, "evidence", 1200);
  const evidenceLevel = input.evidence_level === undefined || input.evidence_level === null ? null : input.evidence_level;
  if (evidenceLevel !== null && (!Number.isInteger(evidenceLevel) || evidenceLevel < 1 || evidenceLevel > 4)) {
    throw new PlatformError("VALIDATION_ERROR", "evidence_level must be an integer from 1 to 4");
  }
  if (input.intent === "complete" && (!evidence || evidenceLevel === null)) {
    throw new PlatformError("VALIDATION_ERROR", "complete check-ins require evidence and evidence_level");
  }
  if (input.intent === "stuck" && !blockerType) throw new PlatformError("VALIDATION_ERROR", "stuck check-ins require blocker_type");
  return { request_id: input.request_id, intent: input.intent, task_id: taskId, action_version: actionVersion, energy, blocker_type: blockerType, evidence_level: evidenceLevel, evidence };
}

function interventionFor(intent, task, blockerType) {
  const title = task.title;
  if (intent === "start") {
    return {
      type: "encourage",
      next_action: `先开始“${title}”。完成这一段后就回来留下证据。`,
      source: "template",
    };
  }
  if (intent === "complete") {
    return {
      type: "review",
      next_action: "证据已留下。花一分钟写下最难的一步，器灵会在下一次同行时据此调整。",
      source: "template",
    };
  }
  if (intent === "skip") {
    return {
      type: "recover",
      next_action: `今天先不强行补完。下次回来时，把“${title}”缩成一个 5 分钟起步动作。`,
      source: "template",
    };
  }
  if (blockerType === "time") {
    return { type: "reduce_scope", next_action: `时间不够时，只做“${title}”的最小 5 分钟版本，并留下开始证据。`, source: "template" };
  }
  if (blockerType === "difficulty") {
    return { type: "reduce_scope", next_action: "先写出已知条件和第一个不确定点，不要求一次做完全部内容。", source: "template" };
  }
  if (blockerType === "emotion") {
    return { type: "recover", next_action: "先离开屏幕两分钟，回来后只完成一个最小步骤；不需要把今天补成完美。", source: "template" };
  }
  if (blockerType === "environment") {
    return { type: "reschedule", next_action: "换到一个更容易开始的位置，并把任务缩成一个可在短时间内完成的产出。", source: "template" };
  }
  return { type: "recover", next_action: "先用一句话写下卡住的位置，再决定是缩小任务还是换一个开始方式。", source: "template" };
}

function initialCycle({ date, route, task, now }) {
  return {
    version: 1,
    date,
    route_id: route.id,
    task,
    status: "planned",
    check_in: null,
    intervention: null,
    created_at: now,
    updated_at: now,
  };
}

function publicCycle(cycle) {
  if (!cycle) return null;
  return {
    version: cycle.version,
    date: cycle.date,
    route_id: cycle.route_id,
    task: { ...cycle.task },
    status: cycle.status,
    check_in: cycle.check_in ? {
      intent: cycle.check_in.intent,
      energy: cycle.check_in.energy,
      blocker_type: cycle.check_in.blocker_type,
      evidence_level: cycle.check_in.evidence_level,
      submitted_at: cycle.check_in.submitted_at,
    } : null,
    intervention: cycle.intervention ? { ...cycle.intervention } : null,
    created_at: cycle.created_at,
    updated_at: cycle.updated_at,
  };
}

class CompanionCycleService {
  constructor({ database, learningRoutes, userState, actions = null, diagnosis = null, clock = () => Date.now() }) {
    this.database = database;
    this.learningRoutes = learningRoutes;
    this.userState = userState;
    this.actions = actions;
    this.diagnosis = diagnosis;
    this.clock = clock;
  }

  async currentContext(actorId, requestId) {
    const state = this.userState ? (await this.userState.getState(actorId, requestId)).state : null;
    const date = localDate(this.clock, state?.profile?.timezone);
    const latest = this.learningRoutes ? await this.learningRoutes.getLatest(actorId) : { route: null };
    const route = latest.route?.status === "confirmed" ? latest.route : null;
    const action = this.actions ? await this.actions.getCurrent(actorId, date) : null;
    let diagnosis = null;
    if (action?.diagnosis_ref && this.diagnosis) {
      try {
        diagnosis = await this.diagnosis.getDiagnosis(actorId, action.diagnosis_ref);
      } catch {
        diagnosis = null;
      }
    }
    if (action) {
      return {
        date,
        route,
        action,
        diagnosis,
        task: {
          id: action.id,
          title: action.title,
          type: "材料诊断",
          estimated_minutes: action.estimated_minutes,
          action_version: action.version,
        },
      };
    }
    const task = taskProjection(activeRouteTask(route, date));
    return { date, route, action: null, task };
  }

  response(requestId, context, cycle, replayed = false) {
    const visibleTask = context.task ?? cycle?.task ?? null;
    const hasRoute = Boolean(context.route);
    const nextAction = context.action?.reason
      ?? cycle?.intervention?.next_action
      ?? (visibleTask ? `今天先完成“${visibleTask.title}”。` : "把正在卡住的题、笔记或草稿交给器灵，先生成一条可验证行动。");
    const screenState = context.action
      ? context.action.status === "planned" ? "next_action_ready" : "action_active"
      : cycle?.status === "completed" ? "cycle_completed" : visibleTask ? "action_active" : "need_material";
    return {
      request_id: requestId,
      date: context.date,
      route_available: hasRoute,
      task: visibleTask ? { ...visibleTask } : null,
      current_action: context.action ? { ...context.action } : null,
      diagnosis_summary: context.diagnosis
        ? {
          id: context.diagnosis.id,
          status: context.diagnosis.status,
          diagnosis_ref: context.diagnosis.id,
          artifact_refs: [...context.diagnosis.artifact_refs],
          observations: context.diagnosis.observations.map((observation) => ({ ...observation })),
          unknowns: [...context.diagnosis.unknowns],
          error_tags: [...context.diagnosis.error_tags],
          reason: context.action?.reason ?? "根据你的材料生成当前行动。",
        }
        : context.action ? { reason: context.action.reason, diagnosis_ref: context.action.diagnosis_ref, artifact_refs: [...context.action.artifact_refs] } : null,
      evidence_requirements: context.action?.expected_evidence ?? null,
      screen_state: screenState,
      cycle: publicCycle(cycle),
      next_action: nextAction,
      replayed,
    };
  }

  async getToday(actorId, requestId) {
    const context = await this.currentContext(actorId, requestId);
    if (!context.route) return this.response(requestId, context, null);
    const cycle = await this.database.get(cycleKey(actorId, context.date));
    return this.response(requestId, context, cycle ?? null);
  }

  async recordCheckIn(actorId, body, rawIdempotencyKey) {
    const request = validateCheckIn(body);
    const normalizedIdempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    const context = await this.currentContext(actorId, request.request_id);
    if (context.action) {
      if (request.task_id && request.task_id !== context.action.id) throw new PlatformError("VALIDATION_ERROR", "task_id does not match the current learning action");
      if (!request.action_version) throw new PlatformError("VALIDATION_ERROR", "action_version is required for a material action");
      if (request.intent === "complete") {
        const result = await this.actions.completeEvidence(actorId, context.date, {
          request_id: request.request_id,
          action_id: context.action.id,
          action_version: request.action_version,
          evidence: request.evidence,
          evidence_level: request.evidence_level,
        }, normalizedIdempotencyKey);
        return { response: { ...this.response(request.request_id, { ...context, action: result.response.next_action, task: { id: result.response.next_action.id, title: result.response.next_action.title, type: "材料诊断", estimated_minutes: result.response.next_action.estimated_minutes, action_version: result.response.next_action.version } }, null), ...result.response, replayed: result.replayed }, replayed: result.replayed };
      }
      const result = await this.actions.transition(actorId, context.date, {
        request_id: request.request_id,
        action_id: context.action.id,
        action_version: request.action_version,
        intent: request.intent,
        blocker_type: request.blocker_type,
      }, normalizedIdempotencyKey);
      return { response: { ...this.response(request.request_id, { ...context, action: result.response.action, task: { id: result.response.action.id, title: result.response.action.title, type: "材料诊断", estimated_minutes: result.response.action.estimated_minutes, action_version: result.response.action.version } }, null), ...result.response, replayed: result.replayed }, replayed: result.replayed };
    }
    if (!context.route || !context.task) throw new PlatformError("CONFLICT", "a confirmed learning route with an active task is required");
    if (request.task_id && request.task_id !== context.task.id) throw new PlatformError("VALIDATION_ERROR", "task_id does not match the current server task");
    const requestFingerprint = fingerprint(request);
    return this.database.transaction(async (database) => {
      const replay = await database.get(idempotencyKey(actorId, normalizedIdempotencyKey));
      if (replay) {
        if (replay.fingerprint !== requestFingerprint) throw new PlatformError("CONFLICT", "idempotency key was reused with a different companion check-in");
        return { response: { ...replay.response, replayed: true }, replayed: true };
      }
      const storageKey = cycleKey(actorId, context.date);
      const now = new Date(this.clock()).toISOString();
      const current = await database.get(storageKey) ?? initialCycle({ date: context.date, route: context.route, task: context.task, now });
      if (current.status === "completed" && request.intent !== "complete") throw new PlatformError("CONFLICT", "today's companion cycle is already completed");
      const status = request.intent === "start" ? "started" : request.intent === "complete" ? "completed" : request.intent === "stuck" ? "stuck" : "skipped";
      const next = {
        ...current,
        route_id: context.route.id,
        task: context.task,
        status,
        check_in: {
          intent: request.intent,
          energy: request.energy,
          blocker_type: request.blocker_type,
          evidence_level: request.evidence_level,
          ...(request.evidence ? { evidence_hash: evidenceHash(request.evidence) } : {}),
          submitted_at: now,
        },
        intervention: interventionFor(request.intent, context.task, request.blocker_type),
        updated_at: now,
        ...(request.intent === "start" ? { started_at: current.started_at ?? now } : {}),
        ...(request.intent === "complete" ? { completed_at: now } : {}),
      };
      const response = this.response(request.request_id, context, next);
      await database.set(storageKey, next);
      await database.set(idempotencyKey(actorId, normalizedIdempotencyKey), { fingerprint: requestFingerprint, response });
      return { response, replayed: false };
    });
  }
}

module.exports = {
  CompanionCycleService,
  validateCheckIn,
};
