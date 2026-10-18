// 提醒邮件端到端测试：从 HTTP 接口一路打到本地 SMTP 收信服务。
//
// 为什么要端到端而不是只测服务类：这条通道最危险的失败模式是"看起来配好了、
// 实际上信发不出去"，而只有真的让一封信走完 SMTP 才能证明不是这样。

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startSmtpSink } from "../helpers/smtp-sink.mjs";

const require = createRequire(import.meta.url);
const { createBackendServer } = require("../../services/api/src/bootstrap/http-api.ts");

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}

async function jsonRequest(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { response, body };
}

// 用一个固定邮箱注册，返回可用于后续请求的 Cookie。
async function registerUser(baseUrl, email) {
  const result = await jsonRequest(baseUrl, "/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password: "correct horse battery", display_name: "试点行者" }),
  });
  assert.equal(result.response.status, 201, `注册应成功，实际 ${result.response.status}`);
  const cookie = (result.response.headers.get("set-cookie") ?? "").split(";", 1)[0];
  assert.ok(cookie.startsWith("lijing_session="), "应拿到会话 Cookie");
  return cookie;
}

function smtpEnv(sink, overrides = {}) {
  return {
    SMTP_HOST: sink.host,
    SMTP_PORT: String(sink.port),
    SMTP_SECURE: "false",
    SMTP_REQUIRE_STARTTLS: "false",
    SMTP_FROM_ADDRESS: "reminder@ljing.space",
    SMTP_FROM_NAME: "砺境",
    ...overrides,
  };
}

test("配置正确时，测试发信能真的把一封信投递出去", async () => {
  const sink = await startSmtpSink();
  const { server } = createBackendServer({ allowDevTokens: false, env: smtpEnv(sink) });
  const baseUrl = await listen(server);
  try {
    const cookie = await registerUser(baseUrl, "learner@example.com");
    const result = await jsonRequest(baseUrl, "/api/v1/me/reminders/test", {
      method: "POST",
      headers: { Cookie: cookie },
    });

    assert.equal(result.response.status, 200);
    assert.equal(result.body.sent, true);
    assert.equal(result.body.status, "sent");
    assert.equal(result.body.channel, "email");

    assert.equal(sink.messages.length, 1, "收信端应收到恰好一封");
    const message = sink.messages[0];
    assert.equal(message.to, "<learner@example.com>", "收件人应是注册邮箱");
    assert.match(message.subject, /提醒通道测试/);
    assert.match(message.body, /试点行者/, "正文应带称呼");
    assert.match(message.body, /砺境/);
  } finally {
    await close(server);
    await sink.close();
  }
});

test("GET /me/reminders 会如实告知邮箱通道是否可用", async () => {
  const sink = await startSmtpSink();
  const { server } = createBackendServer({ allowDevTokens: false, env: smtpEnv(sink) });
  const baseUrl = await listen(server);
  try {
    const cookie = await registerUser(baseUrl, "learner@example.com");
    const result = await jsonRequest(baseUrl, "/api/v1/me/reminders", { headers: { Cookie: cookie } });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.email.configured, true);
    assert.equal(result.body.email.enabled, true);
    assert.equal(result.body.email.from_address, "reminder@ljing.space");
    // 不得泄露 SMTP 主机、端口或账号
    const serialized = JSON.stringify(result.body.email);
    assert.doesNotMatch(serialized, /127\.0\.0\.1|smtp|password/i, "不应泄露连接细节");
  } finally {
    await close(server);
    await sink.close();
  }
});

test("未配置 SMTP 时接口明确回 not_configured，而不是假装成功", async () => {
  const { server } = createBackendServer({ allowDevTokens: false, env: {} });
  const baseUrl = await listen(server);
  try {
    const cookie = await registerUser(baseUrl, "learner@example.com");

    const reminders = await jsonRequest(baseUrl, "/api/v1/me/reminders", { headers: { Cookie: cookie } });
    assert.equal(reminders.body.email.configured, false);
    assert.equal(reminders.body.email.reason, "smtp_not_configured");

    const result = await jsonRequest(baseUrl, "/api/v1/me/reminders/test", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.sent, false);
    assert.equal(result.body.status, "not_configured");
  } finally {
    await close(server);
  }
});

test("REMINDER_EMAIL_ENABLED=false 时即便配好了也不发信", async () => {
  const sink = await startSmtpSink();
  const { server } = createBackendServer({
    allowDevTokens: false,
    env: smtpEnv(sink, { REMINDER_EMAIL_ENABLED: "false" }),
  });
  const baseUrl = await listen(server);
  try {
    const cookie = await registerUser(baseUrl, "learner@example.com");
    const result = await jsonRequest(baseUrl, "/api/v1/me/reminders/test", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    assert.equal(result.body.sent, false);
    assert.equal(result.body.status, "disabled");
    assert.equal(sink.messages.length, 0, "关闭时不应有任何投递");
  } finally {
    await close(server);
    await sink.close();
  }
});

test("投递被服务器永久拒绝时返回 502，而不是 200", async () => {
  const sink = await startSmtpSink({ rejectRecipient: "550 5.1.1 Recipient address rejected" });
  const { server } = createBackendServer({ allowDevTokens: false, env: smtpEnv(sink) });
  const baseUrl = await listen(server);
  try {
    const cookie = await registerUser(baseUrl, "learner@example.com");
    const result = await jsonRequest(baseUrl, "/api/v1/me/reminders/test", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    assert.equal(result.response.status, 502, "发信失败不能返回 200");
    assert.equal(result.body.sent, false);
    assert.equal(result.body.status, "failed");
    assert.equal(result.body.error_code, "SMTP_PERMANENT");
    assert.equal(result.body.retryable, false);
  } finally {
    await close(server);
    await sink.close();
  }
});

test("未认证的请求拿不到发信能力", async () => {
  const sink = await startSmtpSink();
  const { server } = createBackendServer({ allowDevTokens: false, env: smtpEnv(sink) });
  const baseUrl = await listen(server);
  try {
    const result = await jsonRequest(baseUrl, "/api/v1/me/reminders/test", { method: "POST" });
    assert.equal(result.response.status, 401);
    assert.equal(sink.messages.length, 0);
  } finally {
    await close(server);
    await sink.close();
  }
});
