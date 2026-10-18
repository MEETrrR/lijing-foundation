// 零依赖的最小 SMTP 客户端。
//
// 为什么自己写：仓库的唯一运行时依赖是 pg，而这个邮件通道只在配置了 SMTP 变量时才启用。
// 为了一个可选的、可能长期不启用的通道引入 nodemailer 及其依赖树，不划算。
// Node 自带 node:net / node:tls，协议本身足够简单。
//
// 支持范围（够用即止，不过度设计）：
//   - 隐式 TLS（465）与 STARTTLS（587 / 25）
//   - AUTH LOGIN 与 AUTH PLAIN
//   - 单收件人
//   - 中文主题与正文（RFC 2047 编码主题，正文走 base64，避免 8bit 被网关改写）
//
// 明确不支持：附件、多收件人、DKIM 签名、SMTP 连接池。
// 这些都不是「提醒邮件」需要的；真要用了再换成熟库，而不是把这里堆成半个实现。

const net = require("node:net");
const tls = require("node:tls");
const { randomUUID } = require("node:crypto");

// 一封提醒邮件不需要等两分钟。给每一步都设上限，避免连接悬挂把调度器拖住。
const CONNECT_TIMEOUT_MS = 10000;
const COMMAND_TIMEOUT_MS = 15000;
const IDLE_TIMEOUT_MS = 20000;

class EmailTransportError extends Error {
  constructor(code, message, metadata) {
    super(message);
    this.name = "EmailTransportError";
    this.code = code;
    this.metadata = metadata ?? {};
  }
}

function encodeHeaderValue(value) {
  // 纯 ASCII 直接放行；含非 ASCII 时用 RFC 2047 的 base64 形式，
  // 并强制折行在 76 字符内，避免超长主题被某些 MTA 截断。
  const text = String(value ?? "");
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  const encoded = Buffer.from(text, "utf8").toString("base64");
  const chunks = encoded.match(/.{1,60}/g) ?? [encoded];
  return chunks.map((chunk) => `=?UTF-8?B?${chunk}?=`).join("\r\n ");
}

function foldBase64(text) {
  const encoded = Buffer.from(text, "utf8").toString("base64");
  return (encoded.match(/.{1,76}/g) ?? []).join("\r\n");
}

function buildMessage({ from, to, subject, text }) {
  // 正文用 base64：中文正文若以 8bit 直传，部分网关会替换或拒收；
  // base64 让整封信都是 ASCII，代价只是体积 +33%。
  const headers = [
    `From: ${encodeHeaderValue(from.name)} <${from.address}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeaderValue(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${from.address.split("@")[1] ?? "localhost"}>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "Auto-Submitted: auto-generated",
  ];
  return `${headers.join("\r\n")}\r\n\r\n${foldBase64(text)}\r\n`;
}

// SMTP 规定：正文中以 . 开头的行要写成 ..，否则会被当成结束标记。
function dotStuff(payload) {
  return payload.replace(/\r\n\./g, "\r\n..").replace(/^\./, "..");
}

function createLineReader(socket) {
  let buffer = "";
  const waiters = [];
  let failure = null;

  const settleAll = (error) => {
    failure = error;
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  };

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    // SMTP 允许一个 TCP 段里带多条应答；逐条交付，不多不少。
    for (;;) {
      const match = /^([0-9]{3})([ -])([\s\S]*?)\r\n/.exec(buffer);
      if (!match) break;
      buffer = buffer.slice(match[0].length);
      if (match[2] === "-") continue; // 多行应答的中间行
      const waiter = waiters.shift();
      if (!waiter) continue;
      clearTimeout(waiter.timer);
      waiter.resolve({ code: Number(match[1]), text: match[3] });
    }
  });

  socket.on("error", (error) => settleAll(error instanceof Error ? error : new Error(String(error))));
  socket.on("close", () => settleAll(new EmailTransportError("SMTP_CONNECTION_CLOSED", "SMTP connection closed before a reply arrived")));

  return function readReply() {
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.findIndex((item) => item.timer === timer);
        if (index >= 0) waiters.splice(index, 1);
        reject(new EmailTransportError("SMTP_TIMEOUT", "SMTP server did not reply in time"));
      }, COMMAND_TIMEOUT_MS);
      waiters.push({ resolve, reject, timer });
    });
  };
}

function connect({ host, port, secure, servername }) {
  return new Promise((resolve, reject) => {
    const options = { host, port, servername: servername ?? host };
    const socket = secure
      ? tls.connect({ ...options, rejectUnauthorized: true })
      : net.connect(options);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new EmailTransportError("SMTP_CONNECT_TIMEOUT", `Timed out connecting to ${host}:${port}`));
    }, CONNECT_TIMEOUT_MS);
    socket.once(secure ? "secureConnect" : "connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(new EmailTransportError("SMTP_CONNECT_FAILED", `Could not connect to ${host}:${port}: ${error.message}`));
    });
  });
}

function upgradeToTls(socket, host) {
  return new Promise((resolve, reject) => {
    const upgraded = tls.connect({ socket, servername: host, rejectUnauthorized: true });
    const timer = setTimeout(() => {
      upgraded.destroy();
      reject(new EmailTransportError("SMTP_STARTTLS_TIMEOUT", "STARTTLS handshake timed out"));
    }, CONNECT_TIMEOUT_MS);
    upgraded.once("secureConnect", () => {
      clearTimeout(timer);
      resolve(upgraded);
    });
    upgraded.once("error", (error) => {
      clearTimeout(timer);
      reject(new EmailTransportError("SMTP_STARTTLS_FAILED", `STARTTLS failed: ${error.message}`));
    });
  });
}

function isTransient(smtpCode) {
  // 4xx 是暂时性失败（可重试），5xx 是永久性失败（重试无意义）。
  return smtpCode >= 400 && smtpCode < 500;
}

async function sendMail(config, message) {
  const { host, port, secure, requireStartTls, user, pass } = config;
  let socket = await connect({ host, port, secure });
  let readReply = createLineReader(socket);

  const write = (line) => new Promise((resolve, reject) => {
    socket.write(`${line}\r\n`, "utf8", (error) => (error ? reject(error) : resolve()));
  });

  const expect = async (acceptedCodes, stage) => {
    const reply = await readReply();
    if (!acceptedCodes.includes(reply.code)) {
      const error = new EmailTransportError(
        isTransient(reply.code) ? "SMTP_TRANSIENT" : "SMTP_PERMANENT",
        `SMTP ${stage} rejected with ${reply.code}: ${reply.text}`,
        { smtp_code: reply.code, stage, transient: isTransient(reply.code) },
      );
      error.transient = isTransient(reply.code);
      throw error;
    }
    return reply;
  };

  try {
    socket.setTimeout(IDLE_TIMEOUT_MS, () => socket.destroy());
    await expect([220], "greeting");
    await write(`EHLO ${config.clientName}`);
    let ehlo = await expect([250], "EHLO");
    let capabilities = ehlo.text;

    if (!secure) {
      if (capabilities.toUpperCase().includes("STARTTLS")) {
        await write("STARTTLS");
        await expect([220], "STARTTLS");
        socket = await upgradeToTls(socket, host);
        readReply = createLineReader(socket);
        socket.setTimeout(IDLE_TIMEOUT_MS, () => socket.destroy());
        await write(`EHLO ${config.clientName}`);
        ehlo = await expect([250], "EHLO after STARTTLS");
        capabilities = ehlo.text;
      } else if (requireStartTls) {
        throw new EmailTransportError("SMTP_STARTTLS_UNAVAILABLE", "Server does not advertise STARTTLS but it is required");
      }
    }

    if (user && pass) {
      const upper = capabilities.toUpperCase();
      if (upper.includes("AUTH") && upper.includes("PLAIN")) {
        const token = Buffer.from(`\0${user}\0${pass}`, "utf8").toString("base64");
        await write(`AUTH PLAIN ${token}`);
        await expect([235], "AUTH PLAIN");
      } else {
        // LOGIN 是兼容性最好的方式，很多国内邮件服务只稳定支持它。
        await write("AUTH LOGIN");
        await expect([334], "AUTH LOGIN");
        await write(Buffer.from(user, "utf8").toString("base64"));
        await expect([334], "AUTH LOGIN user");
        await write(Buffer.from(pass, "utf8").toString("base64"));
        await expect([235], "AUTH LOGIN password");
      }
    }

    await write(`MAIL FROM:<${config.from.address}>`);
    await expect([250], "MAIL FROM");
    await write(`RCPT TO:<${message.to}>`);
    await expect([250, 251], "RCPT TO");
    await write("DATA");
    await expect([354], "DATA");

    const payload = dotStuff(buildMessage({ from: config.from, to: message.to, subject: message.subject, text: message.text }));
    await new Promise((resolve, reject) => {
      socket.write(`${payload}\r\n.\r\n`, "utf8", (error) => (error ? reject(error) : resolve()));
    });
    await expect([250], "message body");

    // QUIT 失败不该让已投递的邮件被判定为失败。
    try {
      await write("QUIT");
      await expect([221], "QUIT");
    } catch {
      // 忽略
    }
    return { accepted: true };
  } finally {
    socket.destroy();
  }
}

module.exports = {
  EmailTransportError,
  buildMessage,
  dotStuff,
  encodeHeaderValue,
  sendMail,
};
