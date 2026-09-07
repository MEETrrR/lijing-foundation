const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { createRequestContext } = require("../platform/http/request-context.ts");
const { PlatformError, toHttpError } = require("../platform/errors/error-catalog.ts");
const { InMemoryDatabase } = require("../platform/persistence/database.ts");
const { createSupabaseDatabaseFromEnv } = require("../platform/persistence/supabase-database.ts");
const { InMemoryCache } = require("../platform/cache/cache.ts");
const { InMemoryMessageBus } = require("../platform/messaging/message-bus.ts");
const { PlatformHealthChecker } = require("../platform/health.ts");
const { IdentityService } = require("../domains/identity/authentication.ts");
const { LearningService } = require("../domains/learning/learning-service.ts");
const { MemoryService } = require("../domains/memory/memory-service.ts");
const { UserStateService } = require("../domains/profile/user-state-service.ts");
const { FeedbackService } = require("../domains/feedback/feedback-service.ts");
const { AiGatewayService, MockAiProvider, OpenAiCompatibleProvider } = require("../domains/ai-gateway/ai-gateway-service.ts");
const { LearningRouteService } = require("../domains/learning-route/learning-route-service.ts");
const { KnowledgeRetrievalService } = require("../domains/knowledge-retrieval/knowledge-retrieval-service.ts");
const { CompanionService } = require("../domains/companion/companion-service.ts");

const BODY_LIMIT_BYTES = 96 * 1024;

function headerValue(headers, name) {
  const value = headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT_BYTES) throw new PlatformError("VALIDATION_ERROR", "request body is too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) throw new PlatformError("VALIDATION_ERROR", "request body is required");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw new PlatformError("VALIDATION_ERROR", "request body is not valid JSON", { cause: error });
  }
}

function sendJson(response, status, body, context, extraHeaders = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Request-Id": context.requestId,
    "X-Trace-Id": context.traceId,
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

function routeError(error, context) {
  if (error?.metadata?.aiResponse) {
    return {
      status: error.code === "RATE_LIMITED" ? 429 : 422,
      body: error.metadata.aiResponse,
      headers: error.metadata.retryAfterSeconds ? { "Retry-After": String(error.metadata.retryAfterSeconds) } : {},
    };
  }
  const mapped = toHttpError(error instanceof PlatformError ? error : new PlatformError("INTERNAL_ERROR", "Unhandled request failure", { cause: error }), context.requestId);
  return { status: mapped.status, body: mapped.response, headers: {} };
}

function idempotencyKey(request) {
  return headerValue(request.headers, "idempotency-key");
}

function sessionCookie(sessionToken, expiresAt, env) {
  const maxAge = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  const secure = env.APP_ENV === "production" || env.NODE_ENV === "production" ? "; Secure" : "";
  return `lijing_session=${encodeURIComponent(sessionToken)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function clearSessionCookie(env) {
  const secure = env.APP_ENV === "production" || env.NODE_ENV === "production" ? "; Secure" : "";
  return `lijing_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function createDefaultServices(options = {}) {
  const env = options.env ?? process.env;
  const clock = options.clock ?? (() => Date.now());
  const isProduction = env.APP_ENV === "production" || env.NODE_ENV === "production";
  const registrationInviteCode = typeof env.PILOT_INVITE_CODE === "string" ? env.PILOT_INVITE_CODE.trim() : "";
  const configuredDatabase = options.database ?? createSupabaseDatabaseFromEnv(env, options.supabaseDatabase);
  if (isProduction && !configuredDatabase) throw new Error("SUPABASE_DATABASE_URL is required in production");
  const database = configuredDatabase ?? new InMemoryDatabase();
  const cache = options.cache ?? new InMemoryCache();
  const queue = options.queue ?? new InMemoryMessageBus();
  const objectStorage = options.objectStorage ?? { async healthCheck() { return { dependency: "object_storage", status: "up", latency_ms: 0, reason_code: "ok" }; } };
  const identity = options.identity ?? new IdentityService({
    database,
    tokens: options.tokens,
    allowDevTokens: options.allowDevTokens ?? !isProduction,
    registrationInviteCode: options.registrationInviteCode ?? registrationInviteCode,
    clock,
    sessionTtlMs: options.sessionTtlMs,
  });
  const learning = options.learning ?? new LearningService({ database, questions: options.questions, clock });
  const memory = options.memory ?? new MemoryService({ database, clock });
  const userState = options.userState ?? new UserStateService({ database, clock });
  const feedback = options.feedback ?? new FeedbackService({ database, clock });
  const companion = options.companion ?? new CompanionService({ database, clock });
  const knowledge = options.knowledge ?? new KnowledgeRetrievalService({ database, clock });
  const providerConfigured = Boolean(env.AI_PROVIDER_BASE_URL && env.AI_PROVIDER_API_KEY && env.AI_MODEL);
  if (isProduction && env.AI_ENABLED === "true" && !providerConfigured) throw new Error("AI provider configuration is required when AI_ENABLED=true in production");
  const configuredTimeout = Number(env.AI_REQUEST_TIMEOUT_MS ?? 75000);
  const providerTimeoutMs = Number.isInteger(configuredTimeout) && configuredTimeout >= 1000 && configuredTimeout <= 120000 ? configuredTimeout : 75000;
  const configuredProvider = options.provider ?? (providerConfigured
    ? new OpenAiCompatibleProvider({
      baseUrl: env.AI_PROVIDER_BASE_URL,
      apiKey: env.AI_PROVIDER_API_KEY,
      model: env.AI_MODEL,
      timeoutMs: providerTimeoutMs,
      maxResponseBytes: options.policy?.maxProviderResponseBytes,
    })
    : new MockAiProvider());
  const aiEnabled = options.aiEnabled ?? (env.AI_ENABLED === "true" && providerConfigured);
  if (isProduction && !registrationInviteCode) throw new Error("PILOT_INVITE_CODE is required in production");
  const ai = options.ai ?? new AiGatewayService({ database, provider: configuredProvider, enabled: aiEnabled, policy: options.policy, clock, companion, memory, knowledge });
  const learningRoutes = options.learningRoutes ?? new LearningRouteService({ database, ai, knowledge, memory, userState, clock });
  const health = options.health ?? new PlatformHealthChecker({ database, cache, queue, objectStorage });
  return { env, clock, database, cache, queue, objectStorage, identity, learning, memory, userState, feedback, companion, ai, knowledge, learningRoutes, health };
}

function createBackendHandler(services) {
  return async function handle(request, response) {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const context = createRequestContext({
      requestId: headerValue(request.headers, "x-request-id"),
      traceId: headerValue(request.headers, "x-trace-id"),
      clientVersion: headerValue(request.headers, "x-client-version"),
    });
    try {
      if (request.method === "OPTIONS") {
        response.writeHead(204, { "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization,Idempotency-Key,X-Request-Id,X-Trace-Id", "Access-Control-Max-Age": "600" });
        response.end();
        return;
      }
      if (url.pathname === "/api/v1/health" && request.method === "GET") {
        const health = await services.health.check();
        sendJson(response, 200, { status: health.status === "up" ? "ok" : "degraded", ai_configured: services.ai.enabled === true, request_id: context.requestId }, context);
        return;
      }

      if ((url.pathname === "/api/v1/auth/register" || url.pathname === "/api/v1/auth/login") && request.method === "POST") {
        if (!/^application\/json(?:;|$)/i.test(String(headerValue(request.headers, "content-type") ?? ""))) throw new PlatformError("VALIDATION_ERROR", "Content-Type must be application/json");
        const result = url.pathname.endsWith("/register")
          ? await services.identity.register(await readJson(request))
          : await services.identity.login(await readJson(request));
        const status = url.pathname.endsWith("/register") ? 201 : 200;
        sendJson(response, status, { user: result.user, request_id: context.requestId }, context, { "Set-Cookie": sessionCookie(result.sessionToken, result.expiresAt, services.env ?? process.env) });
        return;
      }

      const actor = await services.identity.authenticate(request.headers);
      const actorContext = createRequestContext({ requestId: context.requestId, traceId: context.traceId, clientVersion: context.clientVersion, actorId: actor.actorId });

      if (url.pathname === "/api/v1/auth/me" && request.method === "GET") {
        sendJson(response, 200, { user: actor.user ?? await services.identity.getUser(actor.actorId), request_id: actorContext.requestId }, actorContext);
        return;
      }

      if (url.pathname === "/api/v1/auth/logout" && request.method === "POST") {
        await services.identity.logout(request.headers);
        sendJson(response, 200, { ok: true, request_id: actorContext.requestId }, actorContext, { "Set-Cookie": clearSessionCookie(services.env ?? process.env) });
        return;
      }

      if (url.pathname === "/api/v1/me/progress" && request.method === "GET") {
        sendJson(response, 200, await services.learning.getProgress(actor.actorId, actorContext.requestId), actorContext);
        return;
      }

      if (url.pathname === "/api/v1/me/memories" && request.method === "GET") {
        sendJson(response, 200, await services.memory.getMemories(actor.actorId, actorContext.requestId, url.searchParams.get("scope") ?? undefined), actorContext);
        return;
      }

      if (url.pathname === "/api/v1/me/companion" && request.method === "GET") {
        sendJson(response, 200, await services.companion.getProfile(actor.actorId, actorContext.requestId), actorContext);
        return;
      }

      if (url.pathname === "/api/v1/knowledge/sources" && request.method === "GET") {
        const goalType = url.searchParams.get("goal_type") ?? undefined;
        sendJson(response, 200, { request_id: actorContext.requestId, knowledge_index_version: (await services.knowledge.loadIndex()).version, sources: await services.knowledge.getSources(goalType) }, actorContext);
        return;
      }

      if (url.pathname === "/api/v1/knowledge/search" && request.method === "GET") {
        sendJson(response, 200, { request_id: actorContext.requestId, ...(await services.knowledge.search({
          goal_type: url.searchParams.get("goal_type"),
          query: url.searchParams.get("q") ?? "",
          region: url.searchParams.get("region") ?? "",
          limit: Number(url.searchParams.get("limit") ?? 6),
        })) }, actorContext);
        return;
      }

      if (url.pathname === "/api/v1/me/state" && request.method === "GET") {
        sendJson(response, 200, await services.userState.getState(actor.actorId, actorContext.requestId), actorContext);
        return;
      }

      if (url.pathname === "/api/v1/me/state" && request.method === "PUT") {
        if (!/^application\/json(?:;|$)/i.test(String(headerValue(request.headers, "content-type") ?? ""))) throw new PlatformError("VALIDATION_ERROR", "Content-Type must be application/json");
        const result = await services.userState.saveState(actor.actorId, await readJson(request), idempotencyKey(request));
        sendJson(response, 200, result.response, actorContext);
        return;
      }

      if (url.pathname === "/api/v1/me/reminders" && request.method === "GET") {
        const state = (await services.userState.getState(actor.actorId, actorContext.requestId)).state;
        const route = (await services.learningRoutes.getLatest(actor.actorId)).route;
        const profile = state?.profile ?? {};
        let timezone = profile.timezone || "Asia/Shanghai";
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
        } catch {
          timezone = "Asia/Shanghai";
        }
        const now = new Date(services.clock ? services.clock() : Date.now());
        const localParts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
        const localHour = localParts.find((part) => part.type === "hour")?.value ?? "00";
        const localMinute = localParts.find((part) => part.type === "minute")?.value ?? "00";
        const localTime = `${localHour}:${localMinute}`;
        const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
        const tasks = route?.plan?.today?.tasks ?? state?.today?.tasks ?? [];
        const hasOpenTask = tasks.some((task) => task.completion_status !== "done" && task.status !== "done");
        const enabled = profile.reminder_enabled !== false;
        const reminderTime = profile.reminder_time || "20:00";
        sendJson(response, 200, {
          request_id: actorContext.requestId,
          enabled,
          timezone,
          local_date: localDate,
          local_time: localTime,
          reminder_time: reminderTime,
          due: enabled && localTime >= reminderTime && hasOpenTask,
          reminder_key: `${localDate}:${reminderTime}`,
          tasks: tasks.slice(0, 8),
        }, actorContext);
        return;
      }

      if (url.pathname === "/api/v1/feedback" && request.method === "POST") {
        if (!/^application\/json(?:;|$)/i.test(String(headerValue(request.headers, "content-type") ?? ""))) throw new PlatformError("VALIDATION_ERROR", "Content-Type must be application/json");
        const result = await services.feedback.submit(actor.actorId, await readJson(request), idempotencyKey(request));
        sendJson(response, 201, result.response, actorContext);
        return;
      }

      if (url.pathname === "/api/v1/learning/attempts" && request.method === "POST") {
        if (!/^application\/json(?:;|$)/i.test(String(headerValue(request.headers, "content-type") ?? ""))) throw new PlatformError("VALIDATION_ERROR", "Content-Type must be application/json");
        const result = await services.learning.recordAttempt(actor.actorId, await readJson(request), idempotencyKey(request));
        sendJson(response, 201, result.response, actorContext);
        return;
      }

      if (url.pathname === "/api/v1/memory/iterations" && request.method === "POST") {
        if (!/^application\/json(?:;|$)/i.test(String(headerValue(request.headers, "content-type") ?? ""))) throw new PlatformError("VALIDATION_ERROR", "Content-Type must be application/json");
        const result = await services.memory.recordIteration(actor.actorId, await readJson(request), idempotencyKey(request));
        sendJson(response, 201, result.response, actorContext);
        return;
      }

      const memoryMatch = /^\/api\/v1\/me\/memories\/([^/]+)$/.exec(url.pathname);
      if (memoryMatch && request.method === "POST") {
        if (!/^application\/json(?:;|$)/i.test(String(headerValue(request.headers, "content-type") ?? ""))) throw new PlatformError("VALIDATION_ERROR", "Content-Type must be application/json");
        const result = await services.memory.updateMemory(actor.actorId, decodeURIComponent(memoryMatch[1]), await readJson(request), idempotencyKey(request));
        sendJson(response, 200, result.response, actorContext);
        return;
      }

      if (url.pathname === "/api/v1/ai/requests" && request.method === "POST") {
        if (!/^application\/json(?:;|$)/i.test(String(headerValue(request.headers, "content-type") ?? ""))) throw new PlatformError("VALIDATION_ERROR", "Content-Type must be application/json");
        sendJson(response, 202, await services.ai.accept(actor.actorId, await readJson(request), idempotencyKey(request)), actorContext);
        return;
      }

      if (url.pathname === "/api/v1/learning-routes/sources" && request.method === "GET") {
        sendJson(response, 200, { ...services.learningRoutes.getSources(url.searchParams.get("goal_type") ?? undefined), request_id: actorContext.requestId }, actorContext);
        return;
      }

      if (url.pathname === "/api/v1/learning-routes" && request.method === "GET") {
        sendJson(response, 200, { ...await services.learningRoutes.getLatest(actor.actorId), request_id: actorContext.requestId }, actorContext);
        return;
      }

      if (url.pathname === "/api/v1/learning-routes" && request.method === "POST") {
        if (!/^application\/json(?:;|$)/i.test(String(headerValue(request.headers, "content-type") ?? ""))) throw new PlatformError("VALIDATION_ERROR", "Content-Type must be application/json");
        sendJson(response, 200, await services.learningRoutes.generateDraft(actor.actorId, await readJson(request), idempotencyKey(request)), actorContext);
        return;
      }

      const learningRouteConfirmation = /^\/api\/v1\/learning-routes\/(route-[0-9a-f-]{36})\/confirm$/i.exec(url.pathname);
      if (learningRouteConfirmation && request.method === "POST") {
        if (!/^application\/json(?:;|$)/i.test(String(headerValue(request.headers, "content-type") ?? ""))) throw new PlatformError("VALIDATION_ERROR", "Content-Type must be application/json");
        sendJson(response, 200, await services.learningRoutes.confirmDraft(actor.actorId, learningRouteConfirmation[1], await readJson(request), idempotencyKey(request)), actorContext);
        return;
      }

      const learningRouteRefresh = /^\/api\/v1\/learning-routes\/(route-[0-9a-f-]{36})\/refresh$/i.exec(url.pathname);
      if (learningRouteRefresh && request.method === "POST") {
        if (!/^application\/json(?:;|$)/i.test(String(headerValue(request.headers, "content-type") ?? ""))) throw new PlatformError("VALIDATION_ERROR", "Content-Type must be application/json");
        sendJson(response, 200, await services.learningRoutes.refreshPlan(actor.actorId, learningRouteRefresh[1], await readJson(request), idempotencyKey(request)), actorContext);
        return;
      }

      const aiRequestMatch = /^\/api\/v1\/ai\/requests\/([^/]+)$/.exec(url.pathname);
      if (aiRequestMatch && request.method === "GET") {
        sendJson(response, 200, await services.ai.getRequest(actor.actorId, decodeURIComponent(aiRequestMatch[1])), actorContext);
        return;
      }

      throw new PlatformError("NOT_FOUND", "route not found");
    } catch (error) {
      const mapped = routeError(error, context);
      sendJson(response, mapped.status, mapped.body, context, mapped.headers);
    }
  };
}

function createBackendServer(options = {}) {
  const services = options.services ?? createDefaultServices(options);
  const handler = createBackendHandler(services);
  const server = http.createServer((request, response) => {
    handler(request, response).catch((error) => {
      const context = createRequestContext({ requestId: randomUUID(), traceId: randomUUID() });
      const mapped = routeError(error, context);
      if (!response.headersSent) sendJson(response, mapped.status, mapped.body, context, mapped.headers);
      else response.destroy();
    });
  });
  return { server, services };
}

module.exports = {
  BODY_LIMIT_BYTES,
  createBackendHandler,
  createBackendServer,
  createDefaultServices,
  readJson,
};
