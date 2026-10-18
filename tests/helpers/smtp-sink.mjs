// 本地 SMTP 收信服务（测试替身）。
//
// 存在的意义：邮件通道没法靠"看起来写对了"来验收。有了它，整套发送流程
// ——包括中文主题编码、base64 正文、点转义、错误分级——都能在没有真实邮箱
// 凭据的情况下端到端跑通，并且能主动制造 4xx/5xx 来验证失败路径。
//
// 只实现客户端会用到的那部分协议，不做通用 SMTP 服务器。

import net from "node:net";

function decodeHeaderValue(raw) {
  // 把 RFC 2047 的 =?UTF-8?B?...?= 还原成可读文本
  return String(raw).replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b64) => {
    try {
      return Buffer.from(b64, "base64").toString("utf8");
    } catch {
      return _;
    }
  });
}

function parseMessage(raw) {
  const split = raw.indexOf("\r\n\r\n");
  const headerBlock = split >= 0 ? raw.slice(0, split) : raw;
  const bodyBlock = split >= 0 ? raw.slice(split + 4) : "";

  // 头可能折行：续行以空格起始
  const unfolded = headerBlock.replace(/\r\n[ \t]+/g, " ");
  const headers = {};
  for (const line of unfolded.split("\r\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }

  const encoding = (headers["content-transfer-encoding"] ?? "").toLowerCase();
  const body = encoding === "base64"
    ? Buffer.from(bodyBlock.replace(/\r\n/g, ""), "base64").toString("utf8")
    : bodyBlock;

  return {
    headers,
    raw,
    subject: decodeHeaderValue(headers.subject ?? ""),
    body,
    from: headers.from ?? "",
    to: headers.to ?? "",
    messageId: headers["message-id"] ?? "",
  };
}

export async function startSmtpSink(options = {}) {
  const {
    // 用来验证"要求 STARTTLS 但服务器不支持"这条路径
    advertiseStartTls = false,
    // 用来验证永久性失败（5xx）不重试
    rejectRecipient = null,
    // 用来验证暂时性失败（4xx）可重试
    failDataTimes = 0,
    requireAuth = false,
  } = options;

  const messages = [];
  const transcript = [];
  let dataFailuresRemaining = failDataTimes;

  const server = net.createServer((socket) => {
    let buffer = "";
    let inData = false;
    let dataLines = [];
    let authed = !requireAuth;
    let expectingUser = false;
    let expectingPass = false;
    let greeted = false;

    const send = (line) => {
      transcript.push(`S: ${line}`);
      socket.write(`${line}\r\n`);
    };

    const handleLine = (line) => {
      transcript.push(`C: ${line}`);

      if (inData) {
        if (line === ".") {
          inData = false;
          if (dataFailuresRemaining > 0) {
            dataFailuresRemaining -= 1;
            send("451 4.3.0 Temporary system failure, try again later");
          } else {
            messages.push(parseMessage(dataLines.join("\r\n")));
            send("250 2.0.0 Ok: queued");
          }
          dataLines = [];
          return;
        }
        // 反向点转义：以 .. 开头的行还原为 .
        dataLines.push(line.startsWith("..") ? line.slice(1) : line);
        return;
      }

      const upper = line.toUpperCase();

      if (expectingUser) {
        expectingUser = false;
        expectingPass = true;
        send("334 UGFzc3dvcmQ6");
        return;
      }
      if (expectingPass) {
        expectingPass = false;
        authed = true;
        send("235 2.7.0 Authentication successful");
        return;
      }

      if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
        greeted = true;
        const lines = ["250-smtp-sink greets you", "250-8BITMIME", "250-SIZE 10485760"];
        if (advertiseStartTls) lines.push("250-STARTTLS");
        if (requireAuth) lines.push("250-AUTH LOGIN PLAIN");
        lines.push("250 SMTPUTF8");
        // 多行应答：除最后一行外都用 250-
        socket.write(`${lines.join("\r\n")}\r\n`);
        transcript.push(`S: ${lines.join(" | ")}`);
        return;
      }
      if (upper.startsWith("STARTTLS")) {
        send("454 4.7.0 TLS not available on this sink");
        return;
      }
      if (upper.startsWith("AUTH LOGIN")) {
        expectingUser = true;
        send("334 VXNlcm5hbWU6");
        return;
      }
      if (upper.startsWith("AUTH PLAIN")) {
        authed = true;
        send("235 2.7.0 Authentication successful");
        return;
      }
      if (upper.startsWith("MAIL FROM")) {
        if (!authed) {
          send("530 5.7.0 Authentication required");
          return;
        }
        send("250 2.1.0 Sender ok");
        return;
      }
      if (upper.startsWith("RCPT TO")) {
        if (rejectRecipient) {
          send(String(rejectRecipient));
          return;
        }
        send("250 2.1.5 Recipient ok");
        return;
      }
      if (upper === "DATA") {
        inData = true;
        send("354 Start mail input; end with <CRLF>.<CRLF>");
        return;
      }
      if (upper.startsWith("QUIT")) {
        send("221 2.0.0 Bye");
        socket.end();
        return;
      }
      if (!greeted) {
        send("554 5.5.1 Send EHLO first");
        return;
      }
      send("502 5.5.2 Command not implemented");
    };

    send("220 smtp-sink ready");

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const idx = buffer.indexOf("\r\n");
        if (idx < 0) break;
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        handleLine(line);
      }
    });
    socket.on("error", () => {});
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  return {
    port,
    messages,
    transcript,
    host: "127.0.0.1",
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
