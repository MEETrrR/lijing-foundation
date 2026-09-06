const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { randomUUID, randomBytes, scrypt, timingSafeEqual } = crypto;
const scryptAsync = promisify(scrypt);
const { PlatformError } = require("../../platform/errors/error-catalog.ts");
const { InMemoryDatabase } = require("../../platform/persistence/database.ts");

const TOKEN_PATTERN = /^[A-Za-z0-9._~:+-]{16,256}$/;
const ACTOR_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SCRYPT_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1, keylen: 64, maxmem: 32 * 1024 * 1024 });

function headerValue(headers, name) {
  const value = headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function normalizeTokens(tokens) {
  const source = tokens instanceof Map ? tokens : new Map(Object.entries(tokens ?? {}));
  const normalized = new Map();
  for (const [token, actorId] of source.entries()) {
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) continue;
    if (typeof actorId !== "string" || !ACTOR_PATTERN.test(actorId)) continue;
    normalized.set(token, actorId);
  }
  return normalized;
}

function normalizeEmail(value) {
  if (typeof value !== "string") throw new PlatformError("VALIDATION_ERROR", "email is invalid");
  const email = value.normalize("NFKC").trim().toLowerCase();
  if (email.length > 320 || !EMAIL_PATTERN.test(email)) throw new PlatformError("VALIDATION_ERROR", "email is invalid");
  return email;
}

function validatePassword(value) {
  if (typeof value !== "string" || value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) {
    throw new PlatformError("VALIDATION_ERROR", `password must contain ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters`);
  }
  return value;
}

function normalizeDisplayName(value, email) {
  if (value === undefined) return email.slice(0, email.indexOf("@"));
  if (typeof value !== "string") throw new PlatformError("VALIDATION_ERROR", "display_name is invalid");
  const name = value.normalize("NFKC").trim();
  if (!name || name.length > 80) throw new PlatformError("VALIDATION_ERROR", "display_name is invalid");
  return name;
}

function userEmailKey(email) { return `identity:user:email:${email}`; }
function userIdKey(userId) { return `identity:user:${userId}`; }
function sessionKey(tokenHash) { return `identity:session:${tokenHash}`; }
function tokenHash(token) { return crypto.createHash("sha256").update(token, "utf8").digest("hex"); }

async function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scryptAsync(password, salt, SCRYPT_PARAMS.keylen, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt}$${Buffer.from(derived).toString("base64url")}`;
}

async function verifyPassword(password, encoded) {
  const parts = typeof encoded === "string" ? encoded.split("$") : [];
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, rawN, rawR, rawP, salt, expectedEncoded] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  const expected = Buffer.from(expectedEncoded, "base64url");
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p) || expected.length !== SCRYPT_PARAMS.keylen) return false;
  const derived = await scryptAsync(password, salt, expected.length, { N, r, p, maxmem: SCRYPT_PARAMS.maxmem });
  const actual = Buffer.from(derived);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseCookieHeader(value) {
  const cookies = new Map();
  if (typeof value !== "string") return cookies;
  for (const part of value.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    try { cookies.set(key, decodeURIComponent(rawValue)); } catch { /* Ignore malformed non-auth cookies. */ }
  }
  return cookies;
}

function extractToken(headers) {
  const authorization = headerValue(headers, "authorization");
  const bearer = typeof authorization === "string" ? /^Bearer\s+([^\s]+)$/.exec(authorization.trim())?.[1] : undefined;
  if (bearer && TOKEN_PATTERN.test(bearer)) return bearer;
  const cookieToken = parseCookieHeader(headerValue(headers, "cookie")).get("lijing_session");
  return typeof cookieToken === "string" && TOKEN_PATTERN.test(cookieToken) ? cookieToken : undefined;
}

function publicUser(user) {
  return { id: user.id, email: user.email, display_name: user.display_name, created_at: user.created_at };
}

function validateBody(input, allowed) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlatformError("VALIDATION_ERROR", "request body must be an object");
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new PlatformError("VALIDATION_ERROR", `unknown field: ${key}`);
}

class IdentityService {
  constructor(options = {}) {
    this.database = options.database ?? new InMemoryDatabase();
    this.clock = options.clock ?? (() => Date.now());
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.tokens = normalizeTokens(options.tokens ?? {
      "dev-user-001-token": "account-001",
      "dev-user-002-token": "account-002",
    });
    this.allowDevTokens = options.allowDevTokens ?? true;
  }

  async register(input) {
    validateBody(input, new Set(["email", "password", "display_name"]));
    const email = normalizeEmail(input.email);
    const password = validatePassword(input.password);
    const displayName = normalizeDisplayName(input.display_name, email);
    const passwordHash = await hashPassword(password);
    const now = new Date(this.clock()).toISOString();
    const user = { id: `user-${randomUUID()}`, email, display_name: displayName, password_hash: passwordHash, status: "active", created_at: now };
    const created = await this.database.transaction(async (database) => {
      if (typeof database.setIfAbsent !== "function") throw new PlatformError("DEPENDENCY_UNAVAILABLE", "identity persistence does not support unique account creation");
      if (!(await database.setIfAbsent(userEmailKey(email), user.id))) return false;
      await database.set(userIdKey(user.id), user);
      return true;
    });
    if (!created) throw new PlatformError("CONFLICT", "an account with this email already exists");
    return this.issueSession(user);
  }

  async login(input) {
    validateBody(input, new Set(["email", "password"]));
    const email = normalizeEmail(input.email);
    const password = validatePassword(input.password);
    const userId = await this.database.get(userEmailKey(email));
    const user = typeof userId === "string" ? await this.database.get(userIdKey(userId)) : undefined;
    const valid = user && user.status === "active" && await verifyPassword(password, user.password_hash);
    if (!valid) throw new PlatformError("UNAUTHENTICATED", "email or password is invalid");
    return this.issueSession(user);
  }

  async issueSession(user) {
    const sessionToken = randomBytes(32).toString("base64url");
    const expiresAt = this.clock() + this.sessionTtlMs;
    await this.database.set(sessionKey(tokenHash(sessionToken)), { user_id: user.id, created_at: new Date(this.clock()).toISOString(), expires_at: expiresAt, revoked_at: null });
    return { user: publicUser(user), sessionToken, expiresAt };
  }

  async authenticate(headers) {
    const token = extractToken(headers);
    if (!token) throw new PlatformError("UNAUTHENTICATED", "Bearer token or session cookie is missing");
    const devActorId = this.allowDevTokens ? this.tokens.get(token) : undefined;
    if (devActorId) return Object.freeze({ actorId: devActorId, subjectType: "learner", sessionToken: token, user: { id: devActorId, email: `${devActorId}@local.invalid`, display_name: devActorId, created_at: null } });
    const session = await this.database.get(sessionKey(tokenHash(token)));
    if (!session || session.revoked_at || !Number.isFinite(session.expires_at) || session.expires_at <= this.clock()) {
      throw new PlatformError("UNAUTHENTICATED", "session is missing, expired, or revoked");
    }
    const user = await this.database.get(userIdKey(session.user_id));
    if (!user || user.status !== "active") throw new PlatformError("UNAUTHENTICATED", "account is unavailable");
    return Object.freeze({ actorId: user.id, subjectType: "learner", sessionToken: token, user: publicUser(user) });
  }

  async logout(headers) {
    const token = extractToken(headers);
    if (!token || (this.allowDevTokens && this.tokens.has(token))) return;
    const key = sessionKey(tokenHash(token));
    const session = await this.database.get(key);
    if (session && !session.revoked_at) await this.database.set(key, { ...session, revoked_at: this.clock() });
  }

  async getUser(actorId) {
    const user = await this.database.get(userIdKey(actorId));
    return user ? publicUser(user) : { id: actorId, email: `${actorId}@local.invalid`, display_name: actorId, created_at: null };
  }
}

class InMemoryIdentityProvider extends IdentityService {
  constructor(options = {}) {
    super({ ...options, database: options.database ?? new InMemoryDatabase(), allowDevTokens: options.allowDevTokens ?? true });
  }
}

module.exports = {
  DEFAULT_SESSION_TTL_MS,
  IdentityService,
  InMemoryIdentityProvider,
  extractToken,
  hashPassword,
  normalizeEmail,
  parseCookieHeader,
  publicUser,
  verifyPassword,
};
