const ENVIRONMENTS = new Set(["local", "staging", "production"]);
const LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);
const SECRET_PROVIDER_MODES = new Set(["in-memory", "reference"]);

const REQUIRED_ENVIRONMENT_VARIABLES = Object.freeze([
  "APP_ENV",
  "APP_NAME",
  "APP_VERSION",
  "LOG_LEVEL",
  "DATABASE_RESOURCE_ID",
  "DATABASE_NAME",
  "DATABASE_CREDENTIAL_REF",
  "REDIS_RESOURCE_ID",
  "REDIS_NAMESPACE",
  "REDIS_CREDENTIAL_REF",
  "OBJECT_STORAGE_RESOURCE_ID",
  "OBJECT_STORAGE_BUCKET",
  "OBJECT_STORAGE_ENDPOINT",
  "OBJECT_STORAGE_CREDENTIAL_REF",
  "OBJECT_STORAGE_PRIVATE",
  "MESSAGE_BUS_RESOURCE_ID",
  "MESSAGE_BUS_TOPIC",
  "MESSAGE_BUS_CREDENTIAL_REF",
  "AI_PROVIDER_PROJECT_ID",
  "AI_PROVIDER_CREDENTIAL_REF",
  "AI_BUDGET_ID",
  "AI_DAILY_BUDGET_CENTS",
  "AI_MONTHLY_BUDGET_CENTS",
  "AI_ENABLED",
  "SECRET_NAMESPACE",
  "SECRET_PROVIDER_MODE",
  "TELEMETRY_ENABLED",
  "TRACING_SAMPLE_RATE",
  "DATABASE_POOL_MAX",
  "CACHE_DEFAULT_TTL_SECONDS",
  "MESSAGE_MAX_ATTEMPTS",
  "MESSAGE_RETRY_BASE_DELAY_MS",
  "REQUEST_TIMEOUT_MS",
]);

const INTEGER_RULES = Object.freeze({
  AI_DAILY_BUDGET_CENTS: [0, 100000000],
  AI_MONTHLY_BUDGET_CENTS: [0, 1000000000],
  DATABASE_POOL_MAX: [1, 100],
  CACHE_DEFAULT_TTL_SECONDS: [1, 86400],
  MESSAGE_MAX_ATTEMPTS: [1, 5],
  MESSAGE_RETRY_BASE_DELAY_MS: [0, 60000],
  REQUEST_TIMEOUT_MS: [100, 120000],
});

const BOOLEAN_VARIABLES = Object.freeze([
  "OBJECT_STORAGE_PRIVATE",
  "AI_ENABLED",
  "TELEMETRY_ENABLED",
]);

class ConfigurationError extends Error {
  constructor(issues) {
    const normalizedIssues = Array.isArray(issues) ? issues : [String(issues)];
    super(`Invalid platform configuration: ${normalizedIssues.join("; ")}`);
    this.name = "ConfigurationError";
    this.issues = Object.freeze([...normalizedIssues]);
  }
}

function nonEmptyString(values, name, issues, maximumLength = 256) {
  const value = values[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${name} must be a non-empty string`);
    return "";
  }
  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    issues.push(`${name} exceeds ${maximumLength} characters`);
  }
  return normalized;
}

function parseBoundedInteger(values, name, issues) {
  const raw = values[name];
  const [minimum, maximum] = INTEGER_RULES[name];
  if (typeof raw !== "string" || !/^-?\d+$/.test(raw.trim())) {
    issues.push(`${name} must be an integer between ${minimum} and ${maximum}`);
    return minimum;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    issues.push(`${name} must be an integer between ${minimum} and ${maximum}`);
    return minimum;
  }
  return value;
}

function parseBoundedRate(values, name, issues) {
  const raw = values[name];
  if (typeof raw !== "string" || !/^(?:0|0?\.\d+|1(?:\.0+)?)$/.test(raw.trim())) {
    issues.push(`${name} must be a number between 0 and 1`);
    return 0;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    issues.push(`${name} must be a number between 0 and 1`);
    return 0;
  }
  return value;
}

function parseBoolean(values, name, issues) {
  const raw = values[name];
  if (raw === "true") return true;
  if (raw === "false") return false;
  issues.push(`${name} must be exactly true or false`);
  return false;
}

function containsForeignEnvironmentIdentity(value, environment) {
  if (typeof value !== "string") return false;
  return ["local", "staging", "production"].some((candidate) =>
    candidate !== environment && new RegExp(`(?:^|[-/.])${candidate}(?:$|[-/.])`, "i").test(value),
  );
}

function validateEnvironmentIdentity(values, environment, issues) {
  const resourceFields = [
    "DATABASE_RESOURCE_ID",
    "REDIS_RESOURCE_ID",
    "OBJECT_STORAGE_RESOURCE_ID",
    "MESSAGE_BUS_RESOURCE_ID",
  ];
  for (const field of resourceFields) {
    const expectedPrefix = `lijing-${environment}-`;
    if (!values[field].startsWith(expectedPrefix)) {
      issues.push(`${field} must start with ${expectedPrefix}`);
    }
  }

  const exactIdentities = {
    REDIS_NAMESPACE: `lijing-${environment}`,
    MESSAGE_BUS_TOPIC: `lijing-${environment}-events`,
    AI_PROVIDER_PROJECT_ID: `lijing-${environment}-ai`,
    AI_BUDGET_ID: `budget.lijing.${environment}`,
    SECRET_NAMESPACE: `lijing/${environment}`,
  };
  for (const [field, expected] of Object.entries(exactIdentities)) {
    if (values[field] !== expected) {
      issues.push(`${field} must equal ${expected}`);
    }
  }

  const credentialFields = [
    "DATABASE_CREDENTIAL_REF",
    "REDIS_CREDENTIAL_REF",
    "OBJECT_STORAGE_CREDENTIAL_REF",
    "MESSAGE_BUS_CREDENTIAL_REF",
    "AI_PROVIDER_CREDENTIAL_REF",
  ];
  const expectedCredentialPrefix = `secret://lijing/${environment}/`;
  for (const field of credentialFields) {
    if (!values[field].startsWith(expectedCredentialPrefix)) {
      issues.push(`${field} must use the ${environment} secret namespace`);
    }
  }

  const identityFields = [
    ...resourceFields,
    ...Object.keys(exactIdentities),
    ...credentialFields,
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_ENDPOINT",
  ];
  for (const field of identityFields) {
    if (containsForeignEnvironmentIdentity(values[field], environment)) {
      if (environment !== "production" && /(?:^|[-/.])production(?:$|[-/.])/i.test(values[field])) {
        issues.push(`${field} must not reference production identity outside production`);
      } else {
        issues.push(`${field} contains a foreign environment identity`);
      }
    }
  }

  if (!/^https?:\/\/[^/?#]+$/.test(values.OBJECT_STORAGE_ENDPOINT)) {
    issues.push("OBJECT_STORAGE_ENDPOINT must be an origin without a path, query, or fragment");
  }
  if (environment !== "local" && !values.OBJECT_STORAGE_ENDPOINT.startsWith("https://")) {
    issues.push("OBJECT_STORAGE_ENDPOINT must use HTTPS outside local");
  }
  if (values.OBJECT_STORAGE_PRIVATE !== "true") {
    issues.push("OBJECT_STORAGE_PRIVATE must be true for every environment");
  }
}

function loadConfiguration(input = process.env) {
  const values = Object.fromEntries(
    Object.entries(input ?? {}).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]),
  );
  const issues = [];
  for (const name of REQUIRED_ENVIRONMENT_VARIABLES) {
    if (typeof values[name] !== "string" || values[name].trim().length === 0) {
      issues.push(`${name} is required`);
    }
  }
  if (issues.length > 0) throw new ConfigurationError(issues);

  const environment = values.APP_ENV;
  if (!ENVIRONMENTS.has(environment)) {
    issues.push(`APP_ENV must be one of local, staging, production`);
  }
  if (!issues.length && !LOG_LEVELS.has(values.LOG_LEVEL)) {
    issues.push("LOG_LEVEL must be one of debug, info, warn, error");
  }
  if (!issues.length && !SECRET_PROVIDER_MODES.has(values.SECRET_PROVIDER_MODE)) {
    issues.push("SECRET_PROVIDER_MODE must be in-memory or reference");
  }

  const parsed = {
    appName: nonEmptyString(values, "APP_NAME", issues, 64),
    appVersion: nonEmptyString(values, "APP_VERSION", issues, 64),
    logLevel: values.LOG_LEVEL,
    aiDailyBudgetCents: parseBoundedInteger(values, "AI_DAILY_BUDGET_CENTS", issues),
    aiMonthlyBudgetCents: parseBoundedInteger(values, "AI_MONTHLY_BUDGET_CENTS", issues),
    databasePoolMax: parseBoundedInteger(values, "DATABASE_POOL_MAX", issues),
    cacheDefaultTtlSeconds: parseBoundedInteger(values, "CACHE_DEFAULT_TTL_SECONDS", issues),
    messageMaxAttempts: parseBoundedInteger(values, "MESSAGE_MAX_ATTEMPTS", issues),
    messageRetryBaseDelayMs: parseBoundedInteger(values, "MESSAGE_RETRY_BASE_DELAY_MS", issues),
    requestTimeoutMs: parseBoundedInteger(values, "REQUEST_TIMEOUT_MS", issues),
    tracingSampleRate: parseBoundedRate(values, "TRACING_SAMPLE_RATE", issues),
    objectStoragePrivate: parseBoolean(values, "OBJECT_STORAGE_PRIVATE", issues),
    aiEnabled: parseBoolean(values, "AI_ENABLED", issues),
    telemetryEnabled: parseBoolean(values, "TELEMETRY_ENABLED", issues),
  };

  if (ENVIRONMENTS.has(environment)) {
    validateEnvironmentIdentity(values, environment, issues);
    if (environment === "production") {
      if (values.SECRET_PROVIDER_MODE !== "reference") {
        issues.push("production requires SECRET_PROVIDER_MODE=reference");
      }
      if (!parsed.aiEnabled) issues.push("production requires AI_ENABLED=true");
      if (parsed.aiDailyBudgetCents <= 0 || parsed.aiMonthlyBudgetCents <= 0) {
        issues.push("production requires positive AI budgets");
      }
    }
    if (parsed.aiMonthlyBudgetCents < parsed.aiDailyBudgetCents) {
      issues.push("AI_MONTHLY_BUDGET_CENTS must be at least the daily budget");
    }
    if (!parsed.aiEnabled && (parsed.aiDailyBudgetCents !== 0 || parsed.aiMonthlyBudgetCents !== 0)) {
      issues.push("disabled AI must have zero daily and monthly budgets");
    }
  }
  if (issues.length > 0) throw new ConfigurationError(issues);

  return Object.freeze({
    environment,
    app: Object.freeze({ name: parsed.appName, version: parsed.appVersion, logLevel: parsed.logLevel }),
    resources: Object.freeze({
      databaseResourceId: values.DATABASE_RESOURCE_ID,
      databaseName: values.DATABASE_NAME,
      redisResourceId: values.REDIS_RESOURCE_ID,
      redisNamespace: values.REDIS_NAMESPACE,
      objectStorageResourceId: values.OBJECT_STORAGE_RESOURCE_ID,
      objectStorageBucket: values.OBJECT_STORAGE_BUCKET,
      objectStorageEndpoint: values.OBJECT_STORAGE_ENDPOINT,
      messageBusResourceId: values.MESSAGE_BUS_RESOURCE_ID,
      messageBusTopic: values.MESSAGE_BUS_TOPIC,
    }),
    ai: Object.freeze({
      providerProjectId: values.AI_PROVIDER_PROJECT_ID,
      providerCredentialRef: values.AI_PROVIDER_CREDENTIAL_REF,
      budgetId: values.AI_BUDGET_ID,
      dailyBudgetCents: parsed.aiDailyBudgetCents,
      monthlyBudgetCents: parsed.aiMonthlyBudgetCents,
      enabled: parsed.aiEnabled,
    }),
    security: Object.freeze({
      secretNamespace: values.SECRET_NAMESPACE,
      secretProviderMode: values.SECRET_PROVIDER_MODE,
      objectStoragePrivate: parsed.objectStoragePrivate,
      databaseCredentialRef: values.DATABASE_CREDENTIAL_REF,
      redisCredentialRef: values.REDIS_CREDENTIAL_REF,
      objectStorageCredentialRef: values.OBJECT_STORAGE_CREDENTIAL_REF,
      messageBusCredentialRef: values.MESSAGE_BUS_CREDENTIAL_REF,
    }),
    platform: Object.freeze({
      telemetryEnabled: parsed.telemetryEnabled,
      tracingSampleRate: parsed.tracingSampleRate,
      databasePoolMax: parsed.databasePoolMax,
      cacheDefaultTtlSeconds: parsed.cacheDefaultTtlSeconds,
      messageMaxAttempts: parsed.messageMaxAttempts,
      messageRetryBaseDelayMs: parsed.messageRetryBaseDelayMs,
      requestTimeoutMs: parsed.requestTimeoutMs,
    }),
  });
}

module.exports = {
  ConfigurationError,
  REQUIRED_ENVIRONMENT_VARIABLES,
  loadConfiguration,
};
