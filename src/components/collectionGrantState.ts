import type {
  AgentPurposeView,
  AgentWorkView,
  ContentCatalogView,
  MachineClass,
  StandingWork,
} from "../types";
import {
  blockedFamilies,
  grantableFamilies,
  platformForMachineClass,
} from "./agentWorkStatus";
import { t } from "../i18n";
import type { FamilyOverviewRow, FamilyState } from "./familyOverviewRows";

/**
 * 「按采集面授权」里，一台主机对**当前选中的采集面**的判定结果。
 *
 * 这是纯派生：输入是网关已经返回的用途、现有工作与内容目录，不在这里发请求。
 * 判定顺序刻意是「先看现状，再看能不能派」：
 *   · 已经有常驻工作 → 已授权 / 已暂停（即使目录后来改了，也不把现状说成不可授权）；
 *   · 没有用途判定 → 不能派（派活的前置是机器类别）；
 *   · 模板不含此面 / 该平台采集未就绪 → 不能派，并带上 `blockedFamilies` 的理由；
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
  error?: unknown;
  /** 已授权 / 已暂停时的常驻工作。 */
  work?: StandingWork;
}

export function resolveHostGrantState(input: {
  catalog: ContentCatalogView;
  family: string;
  purpose?: AgentPurposeView;
  work?: AgentWorkView;
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
 * 最常见的原因是**平台不支持**：例如 `ContainerWorkload` 目前只有 Linux 单元——
 * macOS 的容器跑在虚拟机里，日志不在宿主文件系统上（OrbStack / Docker Desktop 都是一个盘镜像），
 * 没法用 `FileGlob` 采。笼统写一句「模板不包含这个采集面」会把
 * 「这台机器就是采不到」说成「目录配错了」，方向完全相反。
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
      "该采集面目前只在 {platforms} 上提供（这台机器是 {platform}）",
      "This family is available on {platforms} only (this host is {platform})",
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
