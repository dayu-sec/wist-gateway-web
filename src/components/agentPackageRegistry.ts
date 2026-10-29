import type {
  AgentInstallPackagePlatform,
  CompatReport,
  InstallPackageView,
} from "../api/admin";
import { findCurrentPackage, type VersionOption } from "./agentUpgradePackages";

/**
 * 「已托管包」表的纯派生（不碰 DOM、不碰 fetch，便于单测）。
 *
 * 口径与中心 `/packages` 页的「已托管包」表对齐：**一行 = 一个版本**，平台是行内的 chips，
 * 状态与录入时间在行上。差别只在数据来源：中心读自己的托管登记表（release 记录带
 * `status: published|expired`），网关这边没有状态字段，状态由**本机当前分发的是什么**推出来：
 *
 * - 某个平台的「当前那一份」 = 该平台设置里那条记录的摘要，在包目录里反查到的记录
 *   （`findCurrentPackage`：录入时摘要同时写进设置与包目录，摘要是两者唯一的公共键）；
 * - 行的状态：该版本**所有**平台都在用 → `live`；部分在用 → `partial`；都不在用 → `archived`。
 *
 * 「在用」判定只看摘要、不看地址：当前分发的地址指向网关**本机缓存路径**，与录入时的来源地址
 * 本来就不同（来源可能是 https 镜像，也可能是 gwlinkd 交付）。
 */

/** 一行里某个平台的状态。 */
export interface ManagedPackagePlatform {
  /** target-triple；包目录里没读出来时是空串（渲染成 `—`）。 */
  platform: string;
  /** 这个平台的当前分发包就是这一份。 */
  live: boolean;
  /** 正在用的那一份在网关本机的缓存路径（不在用 / 读不出时为 `null`）。 */
  cachedPath: string | null;
  /** 该平台的录入记录（来源、摘要、下载地址、录入时间）。 */
  entry: InstallPackageView;
}

export type ManagedPackageStatus = "live" | "partial" | "archived";

export interface ManagedPackageRow {
  version: string;
  platforms: ManagedPackagePlatform[];
  status: ManagedPackageStatus;
  /** 该版本最近一次录入时间，行按它倒序（与「最近录入」的口径一致）。 */
  recordedAt: string;
  /**
   * 该版本的兼容性报告（取该版本第一个带报告的平台录入）。
   *
   * 同版本多平台的包，网关在录入时对每个平台各算一次；报告只取决于网关版本与包内
   * `compat.json`，同一版本各平台必然一致，所以取第一份就能代表整行。
   * 老网关不带这个字段 → null（页面显示“未检查”）。
   */
  compatibility: CompatReport | null;
}

function newerFirst(left: string, right: string): number {
  return right.localeCompare(left);
}

/**
 * 包目录（录入历史）+ 当前设置 → 已托管包的行。
 *
 * 历史为空时返回空数组；平台读不出（空串）的记录不丢 —— 归到同一行里当做一个无名平台，
 * 宁可显示 `—` 也不要让它从列表里消失。
 */
export function managedPackageRows(
  history: readonly InstallPackageView[],
  current: readonly AgentInstallPackagePlatform[],
): ManagedPackageRow[] {
  // 平台 → 当前那一份的 package_id / 本机缓存路径。
  const liveIdByPlatform = new Map<string, string>();
  const cachedPathByPlatform = new Map<string, string>();
  for (const setting of current) {
    const path = setting.packageUrl?.trim();
    if (path) cachedPathByPlatform.set(setting.platform, path);
    const live = findCurrentPackage(history, setting.packageSha256 ?? null);
    if (live) liveIdByPlatform.set(setting.platform, live.packageId);
  }

  const byVersion = new Map<string, ManagedPackageRow>();
  for (const entry of history) {
    const key = entry.version.trim();
    const platform = entry.arch.trim();
    const row: ManagedPackageRow = byVersion.get(key) ?? {
      version: key === "" ? "—" : key,
      platforms: [],
      status: "archived",
      recordedAt: entry.createdAt,
      compatibility: null,
    };
    if (!row.compatibility && entry.compatibility) {
      row.compatibility = entry.compatibility;
    }
    const live = liveIdByPlatform.get(platform) === entry.packageId;
    row.platforms.push({
      platform,
      live,
      cachedPath: live ? (cachedPathByPlatform.get(platform) ?? null) : null,
      entry,
    });
    if (newerFirst(row.recordedAt, entry.createdAt) > 0) {
      row.recordedAt = entry.createdAt;
    }
    byVersion.set(key, row);
  }

  const rows = [...byVersion.values()];
  for (const row of rows) {
    const liveCount = row.platforms.filter((platform) => platform.live).length;
    row.status =
      liveCount === 0
        ? "archived"
        : liveCount === row.platforms.length
          ? "live"
          : "partial";
  }
  return rows.sort((left, right) => newerFirst(left.recordedAt, right.recordedAt));
}

/** 在用（= 状态不是「已归档」）的行数，给卡头那句「在用 N 个」用。 */
export function activePackageCount(rows: readonly ManagedPackageRow[]): number {
  return rows.filter((row) => row.status !== "archived").length;
}

/**
 * 当前分发**还缺**哪些平台 —— 这些平台上新签发的安装命令会明确报错（不会默默给旧的）。
 * 传给它的平台清单用 `AGENTD_PLATFORMS`（顺序即展示顺序）。
 */
export function missingPlatforms(
  current: readonly AgentInstallPackagePlatform[],
  platforms: readonly string[],
): string[] {
  return platforms.filter((platform) => {
    const setting = current.find((item) => item.platform === platform);
    return !setting || !setting.packageUrl.trim();
  });
}

/**
 * 可作为升级目标版本的**在用**版本（新→旧）—— 给「Agent 升级」页的版本下拉用。
 *
 * 为什么不是「包目录里所有版本」：包目录是**存档**，里面积着历次录入的旧版本（页面上标「已归档」），
 * 拿它们当升级目标等于把 Agent 升到一个网关已经不再分发的版本 —— 中心那边同理，只让选**已发布**
 * 版本，过期的不列。要回退到某个旧版本，正确做法是先在「安装包录入」把它重新录成当前分发版本
 * （那一步会校验来源与摘要），再建计划。
 *
 * 判据与列表页的「在用」逐字同源（见 `managedPackageRows`）：该版本的制品种至少有一个平台就是
 * 本机当前分发的那一份。平台清单按版本内出现顺序陈列，页面另有「已覆盖平台」一行展示。
 */
export function inUseVersionOptions(
  history: readonly InstallPackageView[],
  current: readonly AgentInstallPackagePlatform[],
): VersionOption[] {
  return managedPackageRows(history, current)
    .filter((row) => row.status !== "archived")
    .map((row) => ({
      version: row.version,
      platforms: row.platforms
        .map((platform) => platform.platform)
        .filter((platform) => platform !== ""),
    }));
}
