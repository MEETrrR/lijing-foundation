// 砺境 · 设计规范校验
// 用法: node scripts/design-lint.mjs [styles.css 路径] [--strict]
//   --strict 时把"档位过多"这类目标项也当作失败（收敛完成后再开）
//
// 错误（阻断）:
//   1. 正文/标签字号 < 12px      —— 中文在这个尺寸下不可读
//   2. 表单控件字号 < 16px       —— iOS 聚焦会自动放大页面
//   3. 文字色 alpha < .55        —— 深底上不足 4.5:1（装饰性选择器豁免）
// 警告（目标）:
//   4. 字号档位 > 8
//   5. 间距取值 > 12
import fs from "node:fs";
import path from "node:path";

const file = process.argv[2] ?? path.join("apps", "user_client", "src", "styles.css");
const strict = process.argv.includes("--strict");

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

// 逐条规则解析（保留选择器），以便豁免装饰性元素
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
      continue; // 继续深入 @media 内部
    }
    const body = readUntil(["}"]);
    i++;
    fn(prelude.replace(/\s+/g, " "), body);
  }
}

const errors = [];
const warnings = [];
const sizes = new Set();
const spacing = new Set();

eachRule(raw, (selector, body) => {
  const decor = DECOR_ALLOW.some((d) => selector.includes(d));
  const isControl = /(^|[\s,>+~(])(input|textarea|select)\b/.test(selector) || /::placeholder/.test(selector);

  for (const m of body.matchAll(/font-size\s*:\s*([\d.]+)px/g)) {
    const px = parseFloat(m[1]);
    sizes.add(px);
    if (isControl && px < 16) errors.push(`表单控件字号 ${px}px < 16px：${selector}`);
    else if (!isControl && px < 12) errors.push(`字号 ${px}px < 12px：${selector}`);
  }

  if (!decor) {
    for (const m of body.matchAll(/color\s*:\s*rgba\(\s*238\s*,\s*234\s*,\s*224\s*,\s*\.(\d+)\s*\)/g)) {
      const a = Number("0." + m[1]);
      if (a < 0.55) errors.push(`文字色 alpha ${a.toFixed(2)} < .55（深底不足 4.5:1）：${selector}`);
    }
  }

  for (const m of body.matchAll(/(?:padding|gap|margin)(?:-[a-z]+)?\s*:\s*([^;}]+)/g)) {
    for (const v of m[1].matchAll(/\d+(?:\.\d+)?px/g)) spacing.add(v[0]);
  }
});

if (sizes.size > 8) warnings.push(`字号档位 ${sizes.size} 档 > 8（目标：收敛到 7 档，见 tokens.css）`);
if (spacing.size > 12) warnings.push(`间距取值 ${spacing.size} 个 > 12（目标：吸附到 4/8 网格 8 档）`);

for (const w of warnings) console.log(`  ! ${w}`);
console.log(`  度量：字号档位 ${sizes.size} · 间距取值 ${spacing.size}`);

for (const e of errors.slice(0, 20)) console.error(`  x ${e}`);
if (errors.length > 20) console.error(`  ... 另有 ${errors.length - 20} 条`);

const failed = errors.length > 0 || (strict && warnings.length > 0);
if (failed) {
  console.error(`\n设计规范未通过：${errors.length} 个错误${strict ? `、${warnings.length} 个警告（strict）` : ""}`);
  process.exit(1);
}
console.log("\n设计规范通过");
