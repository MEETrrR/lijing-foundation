// 提醒邮件的发送服务。
//
// 设计前提：这是可选通道。没配 SMTP 变量时它必须完全惰性——不抛错、不阻塞启动、
// 不写进 configuration.ts 的 REQUIRED_ENVIRONMENT_VARIABLES（那会让线上服务起不来）。
// 这与仓库里 AI Provider 的做法一致：直接在 env 上探测，配了才启用。
//
// 当前范围：把"发信"这件事做扎实——配置探测、测试发信、正文生成。
// 按到期时间自动群发（调度 + 索引）是下一步，因为数据库抽象目前没有遍历 key 的能力，
// 需要先补 listKeys，那是另一件事，不该和发送通路混在一起验收。

const { sendMail, EmailTransportError } = require("./email-transport.ts");

const DEFAULT_FROM_NAME = "砺境";
const DEFAULT_PORT_SECURE = 465;
const DEFAULT_PORT_PLAIN = 587;

function readBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function readPort(value, fallback) {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return fallback;
  return parsed;
}

// 从环境变量解析出传输配置。返回 null 表示"没配置"，调用方据此保持惰性。
function resolveEmailConfig(env = {}) {
  const host = String(env.SMTP_HOST ?? "").trim();
  const fromAddress = String(env.SMTP_FROM_ADDRESS ?? "").trim();
  if (!host || !fromAddress) return null;

  // 端口决定默认是否隐式 TLS：465 是隐式，587/25 靠 STARTTLS。
  const explicitPort = readPort(env.SMTP_PORT, null);
  const secure = explicitPort === null
    ? readBoolean(env.SMTP_SECURE, true)
    : readBoolean(env.SMTP_SECURE, explicitPort === DEFAULT_PORT_SECURE);
  const port = explicitPort ?? (secure ? DEFAULT_PORT_SECURE : DEFAULT_PORT_PLAIN);

  const user = String(env.SMTP_USER ?? "").trim() || null;
  const pass = env.SMTP_PASS === undefined || env.SMTP_PASS === null || env.SMTP_PASS === ""
    ? null
    : String(env.SMTP_PASS);
  // 密码以环境变量形式给出时不带空格语义，但邮件服务商生成的授权码常含空格，
  // 而用户手工粘贴时容易带上首尾空白——这里只去首尾，不动中间。
  const normalizedPass = pass === null ? null : pass.replace(/^[\s]+|[\s]+$/g, "");

  if (user && !normalizedPass) return null; // 有用户名没密码：视为未配置，而不是发出一封注定失败的信

  return {
    host,
    port,
    secure,
    // 非隐式 TLS 时默认要求 STARTTLS，避免在明文连接上发送凭据。
    requireStartTls: readBoolean(env.SMTP_REQUIRE_STARTTLS, !secure),
    user,
    pass: normalizedPass,
    from: {
      name: String(env.SMTP_FROM_NAME ?? "").trim() || DEFAULT_FROM_NAME,
      address: fromAddress,
    },
    clientName: String(env.SMTP_CLIENT_NAME ?? "").trim() || "ljing.space",
  };
}

function formatTaskLines(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const lines = [];
  for (const task of list.slice(0, 5)) {
    const title = String(task?.title ?? "").trim();
    if (!title) continue;
    lines.push(`  · ${title}`);
  }
  return lines;
}

function buildReminderBody({ displayName, localDate, tasks }) {
  const who = String(displayName ?? "").trim();
  const greeting = who ? `${who}，你好。` : "你好。";
  const taskLines = formatTaskLines(tasks);
  const parts = [
    greeting,
    "",
    `今天是 ${localDate || "今天"}，还有计划没有完成：`,
    "",
    ...(taskLines.length > 0 ? taskLines : ["  · 今天的学习计划"]),
    "",
    "回看比多做一道题重要：先写下上次错在哪，再决定今天做什么。",
    "",
    "—— 砺境",
    "（这封邮件由系统自动发出，直接回复不会有人看到）",
  ];
  return parts.join("\n");
}

function buildTestBody({ displayName }) {
  const who = String(displayName ?? "").trim();
  return [
    who ? `${who}，你好。` : "你好。",
    "",
    "这是一封测试邮件，用来确认砺境的提醒通道已经打通。",
    "收到它说明 SMTP 配置正确；之后到点的回望提醒会走同一条通道。",
    "",
    "如果你没有主动做过这个测试，可以忽略这封邮件。",
    "",
    "—— 砺境",
  ].join("\n");
}

class ReminderNotifier {
  constructor(options = {}) {
    this.env = options.env ?? {};
    this.clock = options.clock ?? (() => Date.now());
    this.transport = options.transport ?? sendMail;
    this.config = resolveEmailConfig(this.env);
    // 显式关闭优先于配置存在：配好了但暂时不想发，也能一键停。
    this.enabled = readBoolean(this.env.REMINDER_EMAIL_ENABLED, this.config !== null);
  }

  // 客户端用它决定是否显示"邮件提醒已开启"。只暴露非敏感信息。
  describe() {
    if (!this.config) {
      return Object.freeze({ configured: false, enabled: false, reason: "smtp_not_configured" });
    }
    return Object.freeze({
      configured: true,
      enabled: this.enabled,
      from_address: this.config.from.address,
      // 不返回 host、user、密码，也不返回端口——这些对前端没用，泄露只会增加风险
    });
  }

  async sendTest({ email, displayName }) {
    if (!this.config) {
      return { status: "not_configured", sent: false };
    }
    if (!this.enabled) {
      return { status: "disabled", sent: false };
    }
    const to = String(email ?? "").trim();
    if (!to) return { status: "no_recipient", sent: false };

    try {
      await this.transport(this.config, {
        to,
        subject: "砺境 · 提醒通道测试",
        text: buildTestBody({ displayName }),
      });
      return { status: "sent", sent: true };
    } catch (error) {
      return {
        status: "failed",
        sent: false,
        // 只回错误码，不回 SMTP 原文——原文可能包含服务器地址与账号信息
        error_code: error instanceof EmailTransportError ? error.code : "EMAIL_SEND_FAILED",
        retryable: error?.transient === true,
      };
    }
  }

  async sendReminder({ email, displayName, localDate, tasks }) {
    if (!this.config || !this.enabled) return { status: "disabled", sent: false };
    const to = String(email ?? "").trim();
    if (!to) return { status: "no_recipient", sent: false };

    try {
      await this.transport(this.config, {
        to,
        subject: "砺境 · 今天还有计划没完成",
        text: buildReminderBody({ displayName, localDate, tasks }),
      });
      return { status: "sent", sent: true };
    } catch (error) {
      return {
        status: "failed",
        sent: false,
        error_code: error instanceof EmailTransportError ? error.code : "EMAIL_SEND_FAILED",
        retryable: error?.transient === true,
      };
    }
  }
}

module.exports = {
  ReminderNotifier,
  buildReminderBody,
  buildTestBody,
  resolveEmailConfig,
};
