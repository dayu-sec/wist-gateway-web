/**
 * 安装包相关的纯派生逻辑（「安装包」页与升级页共用）。
 *
 * 升级页的「新建升级计划」**按版本选**：操作者从网关**已录入**的安装包历史里选**一个版本**，
 * 每个平台的制品由**网关**在派活时按目标 agent 的平台解析 —— 与中心按网关平台派生 gops/gx
 * 制品同一思路。这一组判断都能离开 React 单独验证，所以抽到这里 —— 页面只负责把 hook 的数据
 * 喂进来、把结果显示出去。
 */

import type { InstallPackageView } from "../api/admin";

/** 一个已录入包在下拉 / 列表里的简短标识：`版本 · 架构`。 */
export function packageLabel(pkg: InstallPackageView): string {
  // 网关对非标准包（裸二进制、损坏字节）不报错，只把版本/架构留成空串。全空时若照旧拼
  // `版本 · 架构`，界面上只剩一个孤零零的「 · 」，看着像渲染坏了 —— 明说未识别；
  // 只读出一半时只报读出的一半，不留悬空的分隔符。
  const parts = [pkg.version.trim(), pkg.arch.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "未识别";
}

/**
 * 摘要在紧凑行里的显示形式：`3f9a1b2c12ab…`。
 *
 * 「当前安装包」整卡只给两行，摘要是并排在来源之后的次级值 —— 64 位十六进制铺开会把来源挤掉。
 * 前 12 位足够人眼区分两个包，完整值仍挂在 `title` 上、复制按钮给的也是全文。
 * 形状不认识的（不是十六进制、或本来就短）原样返回：把一段说不上是摘要的字符串截掉只会造成误读。
 */
export function packageShaLabel(value: string | null): string {
  if (!value) return "—";
  const hex = value.replace(/^sha256:/i, "");
  if (!/^[0-9a-f]{16,}$/i.test(hex)) return value;
  return `${hex.slice(0, 12)}…`;
}

/**
 * 「安装包历史」最多列出的条数。
 *
 * 网关侧不设上限（「Agent 升级」页要能选到任意一个录过的包），这里只是**显示**上限：
 * 记录无上限地铺开会把这一页变成流水账，而操作者真正要看的是最近几个。
 */
export const PACKAGE_HISTORY_DISPLAY_LIMIT = 5;

/** 历史里最近 `limit` 条（后端已按录入时间倒序返回，这里只截断，不重排）。 */
export function recentPackages(
  packages: readonly InstallPackageView[],
  limit: number,
): InstallPackageView[] {
  return packages.slice(0, Math.max(0, limit));
}

/**
 * 按摘要找出**当前生效**的那一份包在包目录里的记录 —— 对不上返回 `null`。
 *
 * 录入时来源地址与制品摘要由同一个请求写进设置与包目录（`set_agent_install_package`），摘要
 * 因此是两者唯一的公共键：版本 / 架构只有包目录那一侧有，要报「当前是哪个版本」就得靠它对齐。
 * 对不上不编造（设置早于包目录表、或摘要被改过都可能），页面据此只说未识别，并原样报出摘要。
 */
export function findCurrentPackage(
  packages: readonly InstallPackageView[],
  packageSha256: string | null,
): InstallPackageView | null {
  if (!packageSha256) return null;
  return packages.find((pkg) => pkg.packageSha256 === packageSha256) ?? null;
}

/**
 * 一个**版本**（升级页下拉的选项）：该版本下已录入的包覆盖了哪些平台。
 *
 * 升级按版本选，但网关要按**每个目标平台的包**才能派活 —— 所以选项要把「这个版本已有哪些
 * 平台」摆出来，让操作者一眼看到覆盖情况（缺哪个平台由网关在建计划时拒）。
 */
export interface VersionOption {
  version: string;
  /** 该版本已录入包覆盖的平台（target-triple），去重、按录入顺序。 */
  platforms: string[];
}

/**
 * 把安装包历史折叠成**按版本**的选项（去重，保持首次出现的顺序；历史已按录入时间倒序）。
 *
 * 版本读不出（空串）的包不进选项 —— 按版本选时它没有可匹配的版本，列出来只会选到必败的项。
 */
export function distinctVersionOptions(
  packages: readonly InstallPackageView[],
): VersionOption[] {
  const byVersion = new Map<string, VersionOption>();
  for (const pkg of packages) {
    const version = pkg.version.trim();
    if (version === "") continue;
    const option = byVersion.get(version) ?? { version, platforms: [] };
    const arch = pkg.arch.trim();
    if (arch !== "" && !option.platforms.includes(arch)) {
      option.platforms.push(arch);
    }
    byVersion.set(version, option);
  }
  return [...byVersion.values()];
}

/** 下拉项文字：`版本 · 平台1, 平台2`；平台读不出时只说版本。 */
export function versionOptionLabel(option: VersionOption): string {
  return option.platforms.length > 0
    ? `${option.version} · ${option.platforms.join(", ")}`
    : option.version;
}

/** 按版本值找出选中的选项；选不到（还没选 / 刷新后消失）返回 `null`。 */
export function findVersionOption(
  options: readonly VersionOption[],
  version: string,
): VersionOption | null {
  return options.find((option) => option.version === version) ?? null;
}

/**
 * 按下载地址建索引：**显式制品**的旧计划在列表里用它反查「用的是哪个已录入包」。
 *
 * 旧计划写的 `package_url` 就是所选包的 `agentPackageUrl`，所以地址能对上；对不上由调用方
 * 退回文件名。同一地址取先出现者（内容寻址下不应重复）。
 */
export function indexPackagesByUrl(
  packages: readonly InstallPackageView[],
): Map<string, InstallPackageView> {
  const byUrl = new Map<string, InstallPackageView>();
  for (const pkg of packages) {
    if (!byUrl.has(pkg.agentPackageUrl)) byUrl.set(pkg.agentPackageUrl, pkg);
  }
  return byUrl;
}

/** 包地址折成文件名（列表兜底显示；`null` 读作 `—`）。 */
function packageFileName(url: string | null): string {
  if (!url) return "—";
  const trimmed = url.trim().replace(/[/\\]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut >= 0 ? trimmed.slice(cut + 1) : trimmed;
}

/**
 * 计划列表「目标版本」列的显示文字。
 *
 * 按版本的新计划直接给版本；**显式制品**的旧计划没有 `target_version`，退回按地址反查到的
 * `版本 · 架构`（再对不上就退回文件名）。
 */
export function planVersionCellLabel(
  spec: { targetVersion: string | null; packageUrl: string | null },
  byUrl: Map<string, InstallPackageView>,
): string {
  if (spec.targetVersion) return spec.targetVersion;
  const pkg = spec.packageUrl ? byUrl.get(spec.packageUrl) : undefined;
  return pkg ? packageLabel(pkg) : packageFileName(spec.packageUrl);
}

/** 已加载、无错、且历史为空 —— 页面据此给「去安装包页添加一个包」的指引。 */
export function isEmptyPackageHistory(input: {
  isLoading: boolean;
  isError: boolean;
  count: number;
}): boolean {
  return !input.isLoading && !input.isError && input.count === 0;
}

/**
 * 「创建升级计划」按钮是否可点：正在提交 / 阶段分不出来 / 没选版本 —— 任一为真都禁用。
 *
 * 把这条口径抽成纯函数，是为了钉在测试里，而不是散在 JSX 的布尔表达式里漂移。
 */
export function canSubmitUpgrade(input: {
  isPending: boolean;
  phaseError: string | null;
  selectedVersion: string;
}): boolean {
  return (
    !input.isPending &&
    input.phaseError === null &&
    input.selectedVersion.trim() !== ""
  );
}
