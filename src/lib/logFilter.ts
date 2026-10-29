/**
 * 采集日志页的行过滤（等价于 `tail -f … | grep "xxx"`）。
 *
 * 约定：
 * - **按行、字面包含匹配**，不是正则 —— 日志里的 `[]`、`.`、`*` 都是普通字符，
 *   用户不需要转义；要正则时再另做入口，别把两种语义混在一个输入框里。
 * - 匹配范围是**页面已加载的窗口**（首屏尾部窗口 + 之后增量），不是整份文件。
 * - `needle` 为空 = 不过滤，正文**原样返回**（保留末尾换行与半行），避免无谓的
 *   split/join 改写流式内容。
 * - 默认忽略大小写（日志里大小写常不稳定）；`caseSensitive` 打开时按原样比较。
 */

export interface LogFilterResult {
  /** 原始行数（末尾换行不算多一行）。 */
  totalLines: number;
  /** 过滤后的行；不过滤时就是全部行。 */
  lines: string[];
  /** 过滤后的正文；不过滤时是原始 `text`。 */
  text: string;
  /** 是否真的在过滤（`needle` 非空）。 */
  active: boolean;
}

export function filterLogLines(
  text: string,
  needle: string,
  caseSensitive = false,
): LogFilterResult {
  const lines = text ? text.replace(/\n$/, "").split("\n") : [];
  if (needle === "") {
    return { totalLines: lines.length, lines, text, active: false };
  }
  const target = caseSensitive ? needle : needle.toLowerCase();
  const matched = lines.filter((line) =>
    (caseSensitive ? line : line.toLowerCase()).includes(target),
  );
  return {
    totalLines: lines.length,
    lines: matched,
    text: matched.join("\n"),
    active: true,
  };
}
