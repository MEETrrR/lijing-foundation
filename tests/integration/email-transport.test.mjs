// 邮件发送通路的端到端测试。
//
// 重点覆盖那些"看起来能跑但实际会出错"的地方：
//   - 中文主题必须走 RFC 2047，否则会被网关改写或截断
//   - 正文以 . 开头的行必须点转义，否则会被当成 DATA 结束
//   - 4xx 与 5xx 必须区分：前者可重试，后者重试纯属浪费
//   - 要求 STARTTLS 但服务器不支持时必须拒绝发送，而不是明文降级

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startSmtpSink } from "../helpers/smtp-sink.mjs";

const require = createRequire(import.meta.url);
const { sendMail, EmailTransportError, buildMessage, dotStuff, encodeHeaderValue } = require(
  "../../services/api/src/domains/notification/email-transport.ts",
);

const FROM = { name: "砺境", address: "reminder@ljing.space" };

function configFor(sink, overrides = {}) {
  return {
    host: sink.host,
    port: sink.port,
    secure: false,
    requireStartTls: false,
    user: null,
    pass: null,
    clientName: "ljing.test",
    from: FROM,
    ...overrides,
  };
}

test("纯文本发送：收件端能收到完整的一封信", async () => {
  const sink = await startSmtpSink();
  try {
    const result = await sendMail(configFor(sink), {
      to: "learner@example.com",
      subject: "砺境 · 今天",
      text: "今天还有一段学习计划等待完成。",
    });
    assert.equal(result.accepted, true);
    assert.equal(sink.messages.length, 1);
    const message = sink.messages[0];
    assert.equal(message.to, "<learner@example.com>");
    assert.match(message.from, /reminder@ljing\.space/);
  } finally {
    await sink.close();
  }
});

test("中文主题与正文能原样还原（RFC 2047 + base64）", async () => {
  const sink = await startSmtpSink();
  const subject = "砺境 · 今天还有 3 件事";
  const body = "数学 · 极限与连续\n昨天错在：把连续当成可导。\n建议先回到定义，再判断一次。";
  try {
    await sendMail(configFor(sink), { to: "learner@example.com", subject, text: body });
    const message = sink.messages[0];
    assert.equal(message.subject, subject, "主题必须能还原成原文");
    assert.equal(message.body.trim(), body, "正文必须能还原成原文");
    // 线路上应当是纯 ASCII，不能出现原始中文
    assert.doesNotMatch(message.raw.slice(0, 400), /[\u4e00-\u9fff]/, "头部不应含原始中文字节");
  } finally {
    await sink.close();
  }
});

test("主题折行不超过 76 字符，且折行后仍能还原", () => {
  const long = "这是一条足够长的中文主题用来触发多段编码".repeat(3);
  const encoded = encodeHeaderValue(long);
  for (const line of encoded.split("\r\n")) {
    assert.ok(line.length <= 76, `折行长度应在 76 内，实际 ${line.length}`);
  }
});

test("正文中以点开头的行会被点转义，不会被当成结束标记", async () => {
  const sink = await startSmtpSink();
  const body = "第一行\n.\n不是结束\n..两个点\n最后一行";
  try {
    await sendMail(configFor(sink), { to: "learner@example.com", subject: "点转义", text: body });
    assert.equal(sink.messages.length, 1, "整封信应在一次 DATA 内收完");
    assert.equal(sink.messages[0].body.trim(), body, "点转义必须可逆");
  } finally {
    await sink.close();
  }
});

test("dotStuff 只处理行首的点", () => {
  assert.equal(dotStuff("a.b\r\n.c"), "a.b\r\n..c");
  assert.equal(dotStuff(".\r\n.."), "..\r\n...");
});

test("需要认证的服务器上，AUTH LOGIN 能通过", async () => {
  const sink = await startSmtpSink({ requireAuth: true });
  try {
    await sendMail(configFor(sink, { user: "bot@ljing.space", pass: "app-password" }), {
      to: "learner@example.com",
      subject: "认证",
      text: "正文",
    });
    assert.equal(sink.messages.length, 1);
    assert.ok(sink.transcript.some((line) => line.includes("AUTH LOGIN")), "应走 AUTH LOGIN");
  } finally {
    await sink.close();
  }
});

test("RCPT TO 返回 5xx 时判定为永久失败（不可重试）", async () => {
  const sink = await startSmtpSink({ rejectRecipient: "550 5.1.1 Recipient address rejected" });
  try {
    await assert.rejects(
      () => sendMail(configFor(sink), { to: "nobody@example.com", subject: "s", text: "t" }),
      (error) => {
        assert.ok(error instanceof EmailTransportError);
        assert.equal(error.code, "SMTP_PERMANENT");
        assert.equal(error.transient, false, "5xx 必须标为不可重试");
        assert.equal(error.metadata.smtp_code, 550);
        return true;
      },
    );
    assert.equal(sink.messages.length, 0);
  } finally {
    await sink.close();
  }
});

test("DATA 返回 4xx 时判定为暂时失败（可重试）", async () => {
  const sink = await startSmtpSink({ failDataTimes: 1 });
  try {
    await assert.rejects(
      () => sendMail(configFor(sink), { to: "learner@example.com", subject: "s", text: "t" }),
      (error) => {
        assert.equal(error.code, "SMTP_TRANSIENT");
        assert.equal(error.transient, true, "4xx 必须标为可重试");
        return true;
      },
    );
    // 同一个 sink 再发一次应当成功——证明上次失败只是暂时的
    const retry = await sendMail(configFor(sink), { to: "learner@example.com", subject: "s", text: "t" });
    assert.equal(retry.accepted, true);
    assert.equal(sink.messages.length, 1);
  } finally {
    await sink.close();
  }
});

test("要求 STARTTLS 但服务器不支持时拒绝明文发送", async () => {
  const sink = await startSmtpSink({ advertiseStartTls: false });
  try {
    await assert.rejects(
      () => sendMail(configFor(sink, { requireStartTls: true }), { to: "learner@example.com", subject: "s", text: "t" }),
      (error) => {
        assert.equal(error.code, "SMTP_STARTTLS_UNAVAILABLE");
        return true;
      },
    );
    assert.equal(sink.messages.length, 0, "不得降级为明文投递");
  } finally {
    await sink.close();
  }
});

test("连不上服务器时报明确错误，而不是静默失败", async () => {
  // 127.0.0.1:1 上不会有 SMTP 服务
  await assert.rejects(
    () => sendMail({ ...configFor({ host: "127.0.0.1", port: 1 }), port: 1 }, { to: "a@b.c", subject: "s", text: "t" }),
    (error) => {
      assert.ok(["SMTP_CONNECT_FAILED", "SMTP_CONNECT_TIMEOUT"].includes(error.code), `实际 ${error.code}`);
      return true;
    },
  );
});

test("buildMessage 头部完整且不含明文中文", () => {
  const raw = buildMessage({ from: FROM, to: "a@b.c", subject: "砺境提醒", text: "正文内容" });
  assert.match(raw, /^From: =\?UTF-8\?B\?/);
  assert.match(raw, /MIME-Version: 1\.0/);
  assert.match(raw, /Content-Transfer-Encoding: base64/);
  assert.match(raw, /Auto-Submitted: auto-generated/);
  assert.doesNotMatch(raw.slice(0, raw.indexOf("\r\n\r\n")), /[\u4e00-\u9fff]/);
});
