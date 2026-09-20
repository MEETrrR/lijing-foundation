const { normalizeRequestId } = require("../http/correlation-id.ts");

const ERROR_CATALOG = Object.freeze({
  INVALID_REQUEST: Object.freeze({ publicCode: "invalid_request", publicMessage: "请求无效，请检查填写内容。", retryable: false, httpStatus: 400 }),
  VALIDATION_ERROR: Object.freeze({ publicCode: "invalid_request", publicMessage: "请求内容不完整或格式不正确。", retryable: false, httpStatus: 422 }),
  POLICY_REJECTED: Object.freeze({ publicCode: "policy_rejected", publicMessage: "这项操作不符合当前服务规则。", retryable: false, httpStatus: 422 }),
  UNAUTHENTICATED: Object.freeze({ publicCode: "unauthenticated", publicMessage: "请先登录后再继续。", retryable: false, httpStatus: 401 }),
  INVALID_CREDENTIALS: Object.freeze({ publicCode: "invalid_credentials", publicMessage: "账号或密码不正确", retryable: false, httpStatus: 401 }),
  INVITE_REQUIRED: Object.freeze({ publicCode: "invite_required", publicMessage: "本轮试点需要有效的邀请码。", retryable: false, httpStatus: 403 }),
  INVITE_INVALID: Object.freeze({ publicCode: "invite_invalid", publicMessage: "邀请码无效或已被使用。", retryable: false, httpStatus: 403 }),
  FORBIDDEN: Object.freeze({ publicCode: "forbidden", publicMessage: "你没有权限执行这项操作。", retryable: false, httpStatus: 403 }),
  NOT_FOUND: Object.freeze({ publicCode: "not_found", publicMessage: "没有找到这项内容。", retryable: false, httpStatus: 404 }),
  CONFLICT: Object.freeze({ publicCode: "conflict", publicMessage: "内容已经发生变化，请刷新后再试。", retryable: false, httpStatus: 409 }),
  ACTION_VERSION_CONFLICT: Object.freeze({ publicCode: "action_version_conflict", publicMessage: "这条学习行动已经更新，请刷新后继续。", retryable: false, httpStatus: 409 }),
  RATE_LIMITED: Object.freeze({ publicCode: "rate_limited", publicMessage: "操作太频繁，请稍后再试。", retryable: true, httpStatus: 429 }),
  DEPENDENCY_UNAVAILABLE: Object.freeze({ publicCode: "dependency_unavailable", publicMessage: "AI 服务暂时不可用，请稍后再试。", retryable: true, httpStatus: 503 }),
  PERSISTENCE_UNAVAILABLE: Object.freeze({ publicCode: "persistence_unavailable", publicMessage: "数据服务暂时不可用，本次操作没有保存，请稍后重试。", retryable: true, httpStatus: 503 }),
  TIMEOUT: Object.freeze({ publicCode: "timeout", publicMessage: "AI 响应超时，请稍后再试。", retryable: true, httpStatus: 504 }),
  MESSAGE_DELIVERY_FAILED: Object.freeze({ publicCode: "message_delivery_failed", publicMessage: "这次操作还没有完成，请稍后再试。", retryable: true, httpStatus: 503 }),
  INTERNAL_ERROR: Object.freeze({ publicCode: "internal_error", publicMessage: "服务暂时遇到问题，请稍后再试。", retryable: true, httpStatus: 500 }),
  CONFIGURATION_ERROR: Object.freeze({ publicCode: "internal_error", publicMessage: "服务配置暂时不可用，请稍后再试。", retryable: false, httpStatus: 500 }),
});

class PlatformError extends Error {
  constructor(code, internalMessage = "", options = {}) {
    const normalizedCode = Object.hasOwn(ERROR_CATALOG, code) ? code : "INTERNAL_ERROR";
    super(internalMessage || normalizedCode, options.cause ? { cause: options.cause } : undefined);
    this.name = "PlatformError";
    this.code = normalizedCode;
    this.internalMessage = internalMessage || normalizedCode;
    this.metadata = options.metadata;
  }
}

function catalogEntryFor(error) {
  if (error instanceof PlatformError && ERROR_CATALOG[error.code]) return ERROR_CATALOG[error.code];
  return ERROR_CATALOG.INTERNAL_ERROR;
}

function toPublicErrorResponse(error, requestId) {
  const definition = catalogEntryFor(error);
  return {
    request_id: normalizeRequestId(requestId),
    code: definition.publicCode,
    message: definition.publicMessage,
    retryable: definition.retryable,
  };
}

function toHttpError(error, requestId) {
  const definition = catalogEntryFor(error);
  return { status: definition.httpStatus, response: toPublicErrorResponse(error, requestId) };
}

module.exports = {
  ERROR_CATALOG,
  PlatformError,
  toHttpError,
  toPublicErrorResponse,
};
