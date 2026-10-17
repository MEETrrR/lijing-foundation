// 砺境 · 设计规范校验
// 用法: node scripts/design-lint.mjs [styles.css 路径] [--strict]
//   --strict 时把"档位过多"这类目标项也当作失败（收敛完成后再开）
//
// 错误（阻断）:
//   1. 任何裸 px 字号        —— 字号必须走 --type-* 令牌（tokens.css）
//   2. 表单控件字号 < 16px   —— iOS 聚焦会自动放大页面
//   3. 文字色 alpha < .55    —— 深底上不足 4.5:1（装饰性选择器豁免）
// 警告（目标）:
//   4. 使用的字号令牌 > 10
//   5. 间距取值 > 12
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const file = args.find((a) => !a.startsWith("--")) ?? path.join("apps", "user_client", "src", "styles.css");

// 装饰性元素：允许低透明度（水印、印章、光环、云纹、伪元素装饰）
const DECOR_ALLOW = [
  ".page-intro__gua",
  ".world-stage__seal",
  ".world-marker__ring--inner",
  ".route-future__cloud::before",
  ".assistant-guide-card__art::after",
  ".assistant-guide-card__art::before",
  '.page[data-demo-state="true"]::before',
  ".world-stage--onboarding",
];

const raw = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function eachRule(css, fn) {
  let i = 0;
  function readUntil(stops) {
    let out = "";
    while (i < css.length && !stops.includes(css[i])) {
      if (css[i] === '"' || css[i] === "'") {
        const q = css[i]; out += css[i++];
        while (i < css.length && css[i] !== q) { if (css[i] === "\\") out += css[i++]; out += css[i++]; }
        out += css[i++]; continue;
      }
      if (css[i] === "(") {
        let d = 0;
        do { if (css[i] === "(") d++; if (css[i] === ")") d--; out += css[i++]; } while (i < css.length && d > 0);
        continue;
      }
      out += css[i++];
    }
    return out;
  }
  while (i < css.length) {
    const prelude = readUntil(["{", "}", ";"]).trim();
    if (i >= css.length) break;
    if (css[i] === ";") { i++; continue; }
    if (css[i] === "}") { i++; continue; }
    i++;
    if (prelude.startsWith("@")) {
      if (/^@(keyframes|font-face|page)/i.test(prelude)) { readUntil(["}" ]); i++; continue; }
      continue;
    }
    const body = readUntil(["}"]);
    i++;
    fn(prelude.replace(/\s+/g, " "), body);
  }
}

const errors = [];
const warnings = [];
const tokens = new Set();
const spacing = new Set();

eachRule(raw, (selector, body) => {
  const decor = DECOR_ALLOW.some((d) => selector.includes(d));
  const isControl = /(^|[\s,>+~(])(input|textarea|select)\b/.test(selector) || /::placeholder/.test(selector);

  for (const m of body.matchAll(/font-size\s*:\s*([\d.]+)px/g)) {
    const px = parseFloat(m[1]);
    if (px < 12) errors.push(`字号 ${px}px 低于 12px 地板：${selector}`);
    else errors.push(`裸 px 字号（应改用 --type-* 令牌）：font-size: ${px}px @ ${selector}`);
  }
  for (const m of body.matchAll(/font-size\s*:\s*var\((--type-[a-z-]+)\)/g)) {
    tokens.add(m[1]);
    if (isControl && m[1] !== "--type-input" && m[1] !== "--type-body") {
      errors.push(`表单控件应用 --type-input 或 --type-body：${m[1]} @ ${selector}`);
    }
  }

  if (!decor) {
    for (const m of body.matchAll(/color\s*:\s*rgba\(\s*238\s*,\s*234\s*,\s*224\s*,\s*\.(\d+)\s*\)/g)) {
      const a = Number("0." + m[1]);
      if (a < 0.55) errors.push(`文字色 alpha ${a.toFixed(2)} < .55（深底不足 4.5:1）：${selector}`);
    }
  }

  // 统计间距时排除 clamp()/calc() 内部的 px —— 那是函数参数，不属于刻度
  const spaceless = body.replace(/clamp\([^)]*\)|calc\([^)]*\)/g, "");
  for (const m of spaceless.matchAll(/(?:padding|gap|margin)(?:-[a-z]+)?\s*:\s*([^;}]+)/g)) {
    for (const v of m[1].matchAll(/\d+(?:\.\d+)?px/g)) {
      const n = parseFloat(v[0]);
      if (n <= 64) spacing.add(v[0]); // 只考核组件级间距；>64px 是页面级布局常量
    }
  }
});

if (tokens.size > 10) warnings.push(`字号令牌 ${tokens.size} 个 > 10`);
if (spacing.size > 12) warnings.push(`间距取值 ${spacing.size} 个 > 12（目标：吸附到 4/8 网格 8 档）`);

// 令牌采用率：tokens.css 里定义了却没人用的令牌。
// 这不是错误——它是"目标刻度已定义、规则尚未迁移"的进度条，必须一直可见。
const tokensPath = path.join(path.dirname(file), "tokens.css");
if (fs.existsSync(tokensPath)) {
  const tk = fs.readFileSync(tokensPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const defined = [...new Set([...tk.matchAll(/(?:[{;])\s*(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))];
  const referenced = new Set([...raw.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]));
  const unused = defined.filter((d) => !referenced.has(d));
  const pct = defined.length ? Math.round(((defined.length - unused.length) / defined.length) * 100) : 100;
  console.log(`  令牌采用率 ${pct}%（${defined.length - unused.length}/${defined.length}）`);
  if (unused.length) {
    warnings.push(`tokens.css 有 ${unused.length} 个未采用令牌：${unused.join(", ").slice(0, 150)}`);
  }
}

for (const w of warnings) console.log(`  ! ${w}`);
console.log(`  度量：字号令牌 ${tokens.size} · 间距取值 ${spacing.size}`);

for (const e of errors.slice(0, 20)) console.error(`  x ${e}`);
if (errors.length > 20) console.error(`  ... 另有 ${errors.length - 20} 条`);

const failed = errors.length > 0 || (strict && warnings.length > 0);
if (failed) {
  console.error(`\n设计规范未通过：${errors.length} 个错误${strict ? `、${warnings.length} 个警告（strict）` : ""}`);
  process.exit(1);
}
console.log("\n设计规范通过");
