import { filterLogLines } from "../src/lib/logFilter";

// 契约测试：「采集日志」的 `tail -f | grep` 行过滤。
//
// 这一小块最容易坏在四件事：
//   1. 空串必须**不过滤**（返回原文，保留末尾换行 / 半行），不能先把流式正文改写；
//   2. 字面匹配：`.` / `*` / `[` 不能被当成正则；
//   3. 大小写：默认忽略；打开开关后必须严格按原样；
//   4. 行数口径：末尾换行不算多一行；命中数要与渲染出来的行一致。
//
// Usage: npm run test:log-filter

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const text = 'INFO boot ok\nWARN disk low\n{"msg":"disk low","level":"warn"}\n';

// --- 1. 空串 = 不过滤，原文逐字返回 ---------------------------------------
const all = filterLogLines(text, "");
assert(!all.active, "empty needle must not be active");
assert(all.text === text, "empty needle must keep the original text (newline included)");
assert(all.totalLines === 3, `expected 3 lines, got ${all.totalLines}`);

// 末尾没有换行也要算最后一行。
const noTrailing = filterLogLines("a\nb", "");
assert(noTrailing.totalLines === 2, "last line without trailing newline must count");

// --- 2. 字面匹配（不是正则） ----------------------------------------------
const dots = filterLogLines('a.b\naxb\n', ".");
assert(dots.lines.length === 1, "'.' must match literally, not any character");
assert(dots.lines[0] === "a.b", `unexpected literal match: ${dots.lines[0]}`);

const brackets = filterLogLines("[ERROR] x\nERROR x\n", "[ERROR]");
assert(brackets.lines.length === 1, "brackets must be treated literally");
assert(brackets.text === "[ERROR] x", "matched text must keep the original line");

// --- 3. 大小写：默认忽略，开关打开后严格 -----------------------------------
const ignoreCase = filterLogLines(text, "warn");
assert(ignoreCase.lines.length === 2, "default match must ignore case");
assert(
  ignoreCase.text === 'WARN disk low\n{"msg":"disk low","level":"warn"}',
  "filtered lines must keep their original spelling",
);

const exactCase = filterLogLines(text, "warn", true);
assert(exactCase.lines.length === 1, "case-sensitive 'warn' must only match lowercase");
assert(
  exactCase.text === '{"msg":"disk low","level":"warn"}',
  "case-sensitive result must only include the lowercase line",
);

// --- 4. 行数 / 命中数口径 -------------------------------------------------
assert(ignoreCase.totalLines === 3, "totalLines must describe the whole window");
assert(ignoreCase.lines.length === 2, "lines must describe the matches");
const none = filterLogLines(text, "not-there");
assert(none.lines.length === 0 && none.text === "", "no match must produce empty text");
assert(none.totalLines === 3, "no match must still report the window size");

// 空文件：总行数 0，不能凭空造一行空行。
const empty = filterLogLines("", "", false);
assert(empty.totalLines === 0 && empty.lines.length === 0, "empty file has no lines");

console.log("log filter contract: OK (空串 / 字面匹配 / 大小写 / 行数)");
