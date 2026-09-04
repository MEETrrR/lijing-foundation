const { normalizeRequestId } = require("../http/correlation-id.ts");

const ERROR_CATALOG = Object.freeze({
  INVALID_REQUEST: Object.freeze({ publicCode: "invalid_request", publicMessage: "The request is invalid.", retryable: false, httpStatus: 400 }),
  UNAUTHENTICATED: Object.freeze({ publicCode: "unauthenticated", publicMessage: "Authentication is required.", retryable: false, httpStatus: 401 }),
  FORBIDDEN: Object.freeze({ publicCode: "forbidden", publicMessage: "This action is not allowed.", retryable: false, httpStatus: 403 }),
  NOT_FOUND: Object.freeze({ publicCode: "not_found", publicMessage: "The requested resource was not found.", retryable: false, httpStatus: 404 }),
  CONFLICT: Object.freeze({ publicCode: "conflict", publicMessage: "The request conflicts with current state.", retryable: false, httpStatus: 409 }),
  RATE_LIMITED: Object.freeze({ publicCode: "rate_limited", publicMessage: "Too many requests. Please try again later.", retryable: true, httpStatus: 429 }),
  DEPENDENCY_UNAVAILABLE: Object.freeze({ publicCode: "dependency_unavailable", publicMessage: "A required service is temporarily unavailable.", retryable: true, httpStatus: 503 }),
  TIMEOUT: Object.freeze({ publicCode: "timeout", publicMessage: "The operation timed out. Please try again.", retryable: true, httpStatus: 504 }),
  MESSAGE_DELIVERY_FAILED: Object.freeze({ publicCode: "message_delivery_failed", publicMessage: "The operation could not be completed yet.", retryable: true, httpStatus: 503 }),
  INTERNAL_ERROR: Object.freeze({ publicCode: "internal_error", publicMessage: "Something went wrong.", retryable: true, httpStatus: 500 }),
  CONFIGURATION_ERROR: Object.freeze({ publicCode: "internal_error", publicMessage: "Something went wrong.", retryable: false, httpStatus: 500 }),
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
