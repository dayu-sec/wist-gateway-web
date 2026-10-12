/**
 * agentd 的三个发布平台（target-triple）：网关按平台分别托管安装包。
 *
 * `id` 与后端从包内目录名解析出的 target-triple 一致，**不要改**（改了就与网关的包目录对不上）。
 * 标签是纯技术名（没有中文），故不走 `t()`。
 *
 * 列表页（安装包管理）、录入页（安装包录入）与升级页共用这一份，避免三处各写一张表漂掉。
 */
export const PLATFORM_SLOTS = [
  { id: "x86_64-unknown-linux-musl", label: "Linux · x86_64 · musl" },
  { id: "aarch64-unknown-linux-musl", label: "Linux · ARM64 · musl" },
  { id: "aarch64-apple-darwin", label: "macOS · ARM" },
] as const;

/** agentd 的平台清单（顺序与 `PLATFORM_SLOTS` 一致）。 */
export const AGENTD_PLATFORMS: readonly string[] = PLATFORM_SLOTS.map(
  (slot) => slot.id,
);

const PLATFORM_LABELS: Record<string, string> = Object.fromEntries(
  PLATFORM_SLOTS.map((slot) => [slot.id, slot.label]),
);

/** target-triple → 人读标签；不认识的平台原样返回（宁可露出 triple，也不要编一个名字）。 */
export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}
