import type {
  AgentPurposeView,
  AgentWorkView,
  ContentCatalogView,
  MachineClass,
  StandingWork,
} from "../types";
import type { CollectionPreflightView } from "../api";
import {
  blockedFamilies,
  grantableFamilies,
  platformForMachineClass,
} from "./agentWorkStatus";
import { t } from "../i18n";
import {
  preflightFamily,
  preflightReason,
  preflightUndeterminedLabel,
} from "./collectionPreflightState";
import type { FamilyOverviewRow, FamilyState } from "./familyOverviewRows";

/**
 * 「按采集面授权」里，一台主机对**当前选中的采集面**的判定结果。
 *
 * 这是纯派生：输入是网关已经返回的用途、现有工作、内容目录与预检，不在这里发请求。
 * 判定顺序刻意是「先看现状，再看能不能派」：
 *   · 已经有常驻工作 → 已授权 / 已暂停（即使目录后来改了，也不把现状说成不可授权）；
 *   · 没有用途判定 → 不能派（派活的前置是机器类别）；
 *   · 模板不含此面 / 该平台采集未就绪 → 不能派，并带上 `blockedFamilies` 的理由；
 *   · 预检（**事实**）说这个面在本机选不出单元（`grantable` 之外的任何状态）→ 不能派：
 *     网关授权就是从目录 + 事实里裁单元，裁空了回 409。只按目录说「可授权」
 *     会把人推去做一次注定失败的授权；
 *   · 预检还在读 → `checking`（宁可不说话，也不先说「可授权」再翻脸）；
 *   · 其余 → 可授权。
 */
export type HostGrantKind =
  | "checking"
  | "error"
  | "unclassified"
  | "blocked"
  | "grantable"
  | "granted"
  | "paused";

export interface HostGrantState {
  kind: HostGrantKind;
  /** 用途已判定时带上机器类别（页面用来显示「Linux 通用服务器」）。 */
  machineClass?: MachineClass;
  /** blocked / unclassified 的原因；error 时是原始 error。 */
  reason?: string;
  /**
   * `blocked` 是**预检**给的（本机事实不匹配），不是目录给的。
   *
   * 页面据此不再重复展示一次预检结论：行状态里已经有同一句话了。
   */
  preflightBlocked?: boolean;
  error?: unknown;
  /** 已授权 / 已暂停时的常驻工作。 */
  work?: StandingWork;
}

export function resolveHostGrantState(input: {
  catalog: ContentCatalogView;
  family: string;
  purpose?: AgentPurposeView;
  work?: AgentWorkView;
  /** 预检结论（可选）：有值时用**事实**复核目录给的「可授权」。 */
  preflight?: CollectionPreflightView | null;
  /**
   * 预检还在读（且没有结论）。
   *
   * 只影响「目录说可派」那一支：事实没到之前不冒充「可授权」—— 否则页面先给一个
   * 能勾的绿点，几百毫秒后翻成不可授权，手快的人已经点了授权（然后接到 409）。
   */
  preflightLoading?: boolean;
  purposeLoading: boolean;
  workLoading: boolean;
  purposeError?: unknown;
  workError?: unknown;
}): HostGrantState {
  const {
    catalog,
    family,
    purpose,
    work,
    preflight,
    preflightLoading,
    purposeLoading,
    workLoading,
    purposeError,
    workError,
  } = input;

  if (purposeError || workError) {
    return {
      kind: "error",
      error: purposeError ?? workError,
    };
  }
  if (purposeLoading || workLoading) {
    return { kind: "checking" };
  }

  const machineClass = purpose?.classification?.machineClass;
  const existing = work?.standing.find((entry) => entry.family === family);
  if (existing) {
    return {
      kind: existing.status === "paused" ? "paused" : "granted",
      machineClass,
      work: existing,
    };
  }

  if (!machineClass) {
    return {
      kind: "unclassified",
      reason:
        "用途未判定：先归档 Agent 用途，网关才能决定这台机器能派哪些采集面。",
    };
  }

  const grantable = grantableFamilies(catalog, machineClass).some(
    (entry) => entry.family === family,
  );
  if (grantable) {
    // 目录只说「这个面在某类机器上能派」；**这台**机器上到底有没有可采的东西，
    // 只有事实知道。预检与网关 `expand` 用的是**同一份**事实与判据
    // （`selected_units` 为空 ⇒ 该面的单元全被排除 ⇒ `derive_spec` 拿空集回 409），
    // 所以除了 `grantable`，其余状态都不能再说「可授权」：
    //   · `absent` / `source_unresolved` / `unreadable` / `agent_too_old` / `not_ready`；
    //   · `unprobed`（事实还没到）也算 —— 网关此刻一样会回 409，只是它会顺手替我们
    //     补一条探测；页面改成「不可授权 + 预检按钮」，比让人撞一次 409 更直接。
    const entry = preflightFamily(preflight, family);
    if (entry && entry.state !== "grantable") {
      return {
        kind: "blocked",
        machineClass,
        preflightBlocked: true,
        reason: preflightReason(entry) ?? undefined,
      };
    }
    // 预检判不了（典型：这台机器还没上报过事实，`families` 为空）：网关此刻也
    // 画不出 spec（回 400 `还没有事实摘要`），不能报「可授权」。
    if (
      !entry &&
      preflight?.verdict === "undetermined" &&
      preflight.undeterminedReason
    ) {
      return {
        kind: "blocked",
        machineClass,
        preflightBlocked: true,
        reason: preflightUndeterminedLabel(preflight.undeterminedReason),
      };
    }
    if (!entry && preflightLoading) {
      // 事实还没到：不打「可授权」的包票。预检失败（非 pending）时不会走到这里。
      return { kind: "checking", machineClass };
    }
    return { kind: "grantable", machineClass };
  }

  const blocked = blockedFamilies(catalog, machineClass).find(
    (entry) => entry.family === family,
  );
  return {
    kind: "blocked",
    machineClass,
    reason:
      blocked?.reason ??
      familyNotInTemplateReason(
        catalog,
        family,
        platformForMachineClass(machineClass),
      ),
  };
}

/** 平台的人读名（`macos` / `linux` 是模型里的值，页面上要写 macOS / Linux）。 */
const PLATFORM_TEXT: Record<string, string> = {
  macos: "macOS",
  linux: "Linux",
};

function platformText(platform: string): string {
  return PLATFORM_TEXT[platform] ?? platform;
}

/**
 * 「这个面为什么不在本机的模板里」。
 *
 * 最常见的原因是**这个平台还没有采集单元** —— 不是机器上没有这东西。
 * 典型例：`ContainerWorkload` 目前只有 Linux 单元（macOS 的容器跑在虚拟机里，
 * 容器 stdout 不在宿主文件系统上，得走运行时 API）；`DatabaseService` /
 * `StorageHealth` 的 macOS 单元也还没写。
 *
 * 所以文案必须说「**还没接入**」，**不能**让人读成「这台机器没有数据库 / 没有容器」——
 * 那会把运维带去查“是不是没装”，方向完全相反。
 */
function familyNotInTemplateReason(
  catalog: ContentCatalogView,
  family: string,
  platform: string,
): string {
  const meta = catalog.families.find((entry) => entry.id === family);
  const platforms = meta?.platforms ?? [];
  if (platforms.length > 0 && !platforms.includes(platform)) {
    return t(
      "该面目前只有 {platforms} 采集单元（这台机器是 {platform}）—— 是该平台还没接入，不是机器上没有",
      "This family has {platforms} units only (this host is {platform}) — coverage for this platform is not implemented yet, not a missing capability on the host",
      {
        platforms: platforms.map(platformText).join(" / "),
        platform: platformText(platform),
      },
    );
  }
  return t(
    "这台机器的类别模板不包含这个采集面（网关授权时会回 409）",
    "This machine class's template does not include this family (the gateway returns HTTP 409 on grant)",
  );
}

export interface HostGrantCounts {
  checking: number;
  unclassified: number;
  blocked: number;
  grantable: number;
  granted: number;
  paused: number;
  error: number;
}

export function countHostGrantStates(
  states: readonly HostGrantState[],
): HostGrantCounts {
  const counts: HostGrantCounts = {
    checking: 0,
    unclassified: 0,
    blocked: 0,
    grantable: 0,
    granted: 0,
    paused: 0,
    error: 0,
  };
  for (const state of states) {
    counts[state.kind] += 1;
  }
  return counts;
}

/** 面级徽标：聚合状态之外，多一个「部分平台就绪」。 */
export type FamilyBadgeState = FamilyState | "partial";

/**
 * 这个面是否**声明支持**某平台。
 *
 * `ContentFamilyView.platforms` 的契约是：非空 = 只在这些平台可用；空 = 全平台。
 * 因此空数组不能当成「不支持」，否则旧网关/全平台面会从所有 tab 里消失。
 */
export function familySupportsPlatform(
  row: FamilyOverviewRow,
  platform: string,
): boolean {
  if (row.family.platforms.length > 0) {
    return row.family.platforms.includes(platform);
  }
  return true;
}

/**
 * 面级徽标。传 `"all"` 时是跨平台聚合（可能 partial）；传具体平台时只看该平台：
 * 有 active 单元 → ready；有单元但没 active → draft；该平台没有单元 → unconfigured。
 */
export function familyBadgeState(
  row: FamilyOverviewRow,
  platform: "all" | string,
): FamilyBadgeState {
  if (platform !== "all") {
    const entry = row.perPlatform.find(
      (candidate) => candidate.platform === platform,
    );
    if (!entry) return "unconfigured";
    return entry.activeUnits > 0 ? "ready" : "draft";
  }
  if (row.state !== "ready") return row.state;
  const readyPlatforms = new Set(
    row.perPlatform
      .filter((entry) => entry.activeUnits > 0)
      .map((entry) => entry.platform),
  );
  const expected =
    row.family.platforms.length > 0
      ? row.family.platforms
      : row.perPlatform.map((entry) => entry.platform);
  return expected.some((entry) => !readyPlatforms.has(entry))
    ? "partial"
    : "ready";
}
