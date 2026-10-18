import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getAppTheme,
  initTheme,
  setAppTheme,
  toggleAppTheme,
  type AppTheme,
} from "../src/theme";

// 契约测试：主题（浅色 / 深色）。
//
// 这套东西坏起来是**静默**的：① 两套 CSS token 不同步 —— 浅色下某块区域仍是深色（或反过来），
// 肉眼要翻到那一页才发现；② 首次进入的顺序不对 —— 先按深色画一帧再跳浅色（闪一下）；③ 用户选过
// 浅色后，系统一入夜被改回深色。
//
// Usage: npm run test:theme

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

// --- ① 两套 token 必须一一对应（浅色块要覆盖深色块里每一个**字面量颜色** token）---
//
// 别在这里写死 token 名单：新增一个颜色 token 忘了给浅色值，正是这条测试要拦的事。
// 判据：`:root` 里凡是给了**字面量**值的 token（不是 `var(...)` 别名、不是尺度/字体），
// `:root[data-theme="light"]` 里都必须再给一次。
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "src", "index.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(selector);
  assert(start >= 0, `index.css 里找不到 ${selector}`);
  const open = css.indexOf("{", start);
  let depth = 1;
  let index = open + 1;
  while (index < css.length && depth > 0) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    index += 1;
  }
  return css.slice(open + 1, index - 1);
}

function tokens(source: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of source.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    found.set(match[1], match[2].trim());
  }
  return found;
}

// 第一个 `:root {` 是深色主题（后面还有一条只写 color-scheme 的 `:root`，不能误取）。
const darkAll = tokens(block(":root {"));
const lightBlock = block(':root[data-theme="light"]');
const light = tokens(lightBlock);

// 尺度 / 字体 / 布局与别名不算颜色：前者两套共用，后者指向已覆盖的 token。
// `--page-*` / `--prose-max` 是版式尺度（页边距、标题字号、正文行宽），与配色无关。
const NOT_COLOR = /^--(radius|font|sidebar-width|content-max|topbar-height|page-|prose-max)/;
const missing: string[] = [];
for (const [name, value] of darkAll) {
  if (NOT_COLOR.test(name)) continue;
  if (value.startsWith("var(")) continue; // 别名（--success 等）跟着被指向的 token 走
  if (!light.has(name)) missing.push(name);
}
assert(
  missing.length === 0,
  `浅色主题漏了这些 token（浅色下会露出深色）：${missing.join(", ")}`,
);
assert(
  lightBlock.includes("color-scheme: light"),
  "浅色主题要声明 color-scheme: light（否则原生下拉/滚动条仍是深色）",
);

// --- ①b 对比度：两套主题的正文/语法/状态色都要过 WCAG AA ---
//
// 这一条正是为了拦住「加了浅色主题，但某个色是照深色挑的」——`--text-4` 与 shell 语法色在浅色下
// 都曾掉到 3.3:1 / 1.3:1（几乎看不见）。只查**不透明**的 hex：半透明（--*-soft）是叠在背景上的
// 装饰，不参与正文可读性。非文字的图表色按 3:1（WCAG 1.4.11 图形对比）放行。
function relativeLuminance(hex: string): number {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const channel = (value: number) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(full.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const AA_TEXT = 4.5;
const AA_GRAPHIC = 3;

function checkContrast(
  themeName: string,
  tokens: Map<string, string>,
  pairs: readonly [string, string, number][],
): void {
  for (const [foreground, background, minimum] of pairs) {
    const fg = tokens.get(foreground);
    const bg = tokens.get(background);
    if (!fg?.startsWith("#") || !bg?.startsWith("#")) continue; // 非 hex（半透明/别名）不在此查
    const value = contrast(fg, bg);
    assert(
      value >= minimum,
      `${themeName}：${foreground} 在 ${background} 上只有 ${value.toFixed(2)}:1，低于 ${minimum}:1`,
    );
  }
}

// 深色的 `:root` 里混着尺度等非颜色 token，对比度只看颜色那几对，所以显式列出来。
const TEXT_SURFACES: readonly [string, string, number][] = [
  ["--text", "--bg", AA_TEXT],
  ["--text", "--bg-elevated", AA_TEXT],
  ["--text-2", "--bg-elevated", AA_TEXT],
  ["--text-3", "--bg-elevated", AA_TEXT],
  ["--text-4", "--bg-elevated", AA_TEXT],
  ["--text-4", "--bg", AA_TEXT],
  ["--syntax-comment", "--code-bg", AA_TEXT],
  ["--syntax-string", "--code-bg", AA_TEXT],
  ["--syntax-variable", "--code-bg", AA_TEXT],
  ["--syntax-keyword", "--code-bg", AA_TEXT],
  ["--syntax-operator", "--code-bg", AA_TEXT],
  ["--ok", "--bg-elevated", AA_TEXT],
  ["--warn", "--bg-elevated", AA_TEXT],
  ["--crit", "--bg-elevated", AA_TEXT],
  ["--info", "--bg-elevated", AA_TEXT],
  // 三层的主色（来源/解析/输出）现在也当数字的正文色用（见 SubsystemPipelinePage 的 .rate），
  // 所以要按正文标准查，而不是按图表图形标准。
  ["--series-1", "--bg-elevated", AA_TEXT],
  ["--series-1", "--surface", AA_TEXT],
  ["--series-2", "--surface", AA_TEXT],
  ["--series-3", "--surface", AA_TEXT],
  ["--series-2", "--bg-elevated", AA_GRAPHIC],
  ["--series-3", "--bg-elevated", AA_GRAPHIC],
  ["--series-4", "--bg-elevated", AA_GRAPHIC],
  ["--series-5", "--bg-elevated", AA_GRAPHIC],
];

checkContrast("深色主题", darkAll, TEXT_SURFACES);
checkContrast("浅色主题", light, TEXT_SURFACES);

// --- ② 行为：跟随系统 → 用户选择优先 → 双向切换 ---

const store = new Map<string, string>();
let systemPrefersLight = true;
const dataset: Record<string, string> = {};

(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  },
  matchMedia: (query: string) => ({
    matches: systemPrefersLight && query.includes("prefers-color-scheme: light"),
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
};
(globalThis as unknown as { document: unknown }).document = {
  documentElement: { dataset },
  querySelector: () => null,
};

// 没存过 → 跟随系统（系统浅色 → 浅色，并且真的落到 <html data-theme>）
initTheme();
assert(getAppTheme() === "light", "首次进入应跟随系统偏好");
assert(dataset.theme === "light", "浅色要落到 <html data-theme=\"light\"> 上");

// 切深色：写存储 + 删掉 data-theme（深色是默认态，不写属性）
setAppTheme("dark");
assert(getAppTheme() === "dark", "setAppTheme 立即生效");
assert(store.get("wistGatewayWeb.theme") === "dark", "主题要写进 localStorage");
assert(dataset.theme === undefined, "深色是默认态：应删掉 data-theme 而不是写 dark");

// 切回浅色 + 反转
setAppTheme("light");
assert(dataset.theme === "light", "setAppTheme 要改 <html>");
toggleAppTheme();
assert(getAppTheme() === "dark", "toggle 从浅色切到深色");
toggleAppTheme();
assert(getAppTheme() === "light", "toggle 再切回浅色");

// 存过的值优先于系统：系统偏好变了也不能覆盖用户的选择。
systemPrefersLight = false;
assert(getAppTheme() === "light", "用户选过之后不再跟随系统");
const themes: AppTheme[] = ["light", "dark"];
for (const theme of themes) {
  setAppTheme(theme);
  assert(getAppTheme() === theme, `setAppTheme(${theme}) 要生效`);
}

console.log(
  "theme contract: OK (两套 token 对齐 / 对比度过 AA / 跟随系统 / 用户选择优先 / 双向切换 / color-scheme)",
);
