/**
 * 「期望摘要 sha256」的形态校验。
 *
 * 包的 sha256 **必填**（不是可选）：网关录入以摘要为内容身份，缺了就没有可校验的事实来源。
 * 这里只做**形态**（64 位十六进制，可带 `sha256:` 前缀）；真值由网关拿块字节核对。
 */

/** 去掉可选的 `sha256:` 前缀（大小写不敏感，两侧空白容忍）。 */
function stripSha256Prefix(value: string): string {
  return value.trim().replace(/^sha256:/i, "").trim();
}

/** 形态是否合法：64 位十六进制（可带 `sha256:` 前缀）。 */
export function isValidSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(stripSha256Prefix(value));
}

/** 不合法时给出可读原因；合法返回 `null`。表单提交前拦一道，省一次往返并能说清为什么。 */
export function sha256Error(value: string): string | null {
  if (value.trim().length === 0) {
    return "期望摘要必填：填发布侧 *.sha256 里那串 64 位十六进制（可带 sha256: 前缀）。";
  }
  return isValidSha256(value)
    ? null
    : "期望摘要必须是 64 位十六进制（可带 sha256: 前缀）。";
}
