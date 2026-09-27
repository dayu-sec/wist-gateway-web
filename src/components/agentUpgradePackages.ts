/**
 * 升级页「选安装包」的纯派生逻辑。
 *
 * 升级页不再让操作者手输包地址 + 摘要，而是从网关**已录入**的安装包历史里选一个。这一组判断
 * 都能离开 React 单独验证，所以抽到这里 —— 页面只负责把 hook 的数据喂进来、把结果显示出去。
 */

import type { InstallPackageView } from "../api/admin";

/** 一个已录入包在下拉 / 列表里的简短标识：`版本 · 架构`。 */
export function packageLabel(pkg: InstallPackageView): string {
  return `${pkg.version} · ${pkg.arch}`;
}

/** 下拉项文字：`版本 · 架构 · 来源`（来源用来区分「同一个包从哪儿录入」）。 */
export function packageOptionLabel(pkg: InstallPackageView): string {
  return `${packageLabel(pkg)} · ${pkg.source}`;
}

/**
 * 按 `package_id` 找出选中的包。
 *
 * 选不到（还没选 / 已选的那项在刷新后从历史里消失）返回 `null`：页面据此禁用提交，
 * 不让「选了一个不存在的包」被当成可选。
 */
export function findSelectedPackage(
  packages: readonly InstallPackageView[],
  packageId: string,
): InstallPackageView | null {
  return packages.find((pkg) => pkg.packageId === packageId) ?? null;
}

/**
 * 按下载地址建索引：升级计划列表用它反查「这份计划用的是哪个已录入包」。
 *
 * 新建计划写的 `package_url` 就是所选包的 `agentPackageUrl`，所以地址能对上；对不上
 * （旧计划写的是原始路径）由调用方退回文件名。同一地址取先出现者（内容寻址下不应重复）。
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
 * 计划列表「安装包」列的显示文字。
 *
 * 能在已录入历史里按地址反查到就显示 `版本 · 架构`（升级到哪个版本由包决定，所以列表要
 * 认得的是**哪个包**）；反查不到（旧计划写的是原始路径）退回文件名。
 */
export function packageCellLabel(
  url: string | null,
  byUrl: Map<string, InstallPackageView>,
): string {
  const pkg = url ? byUrl.get(url) : undefined;
  return pkg ? packageLabel(pkg) : packageFileName(url);
}

/** 已加载、无错、且历史为空 —— 页面据此给「去 Gateway 初始化页录入」的指引。 */
export function isEmptyPackageHistory(input: {
  isLoading: boolean;
  isError: boolean;
  count: number;
}): boolean {
  return !input.isLoading && !input.isError && input.count === 0;
}

/**
 * 「创建升级计划」按钮是否可点：正在提交 / 阶段分不出来 / 没选包 —— 任一为真都禁用。
 *
 * 把这条口径抽成纯函数，是为了钉在测试里，而不是散在 JSX 的布尔表达式里漂移。
 */
export function canSubmitUpgrade(input: {
  isPending: boolean;
  phaseError: string | null;
  selectedPackage: InstallPackageView | null;
}): boolean {
  return (
    !input.isPending &&
    input.phaseError === null &&
    input.selectedPackage !== null
  );
}
