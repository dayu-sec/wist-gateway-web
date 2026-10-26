import type {
  AgentPurposeView,
  AgentWorkView,
  ContentCatalogView,
  MachineClass,
  StandingWork,
} from "../types";
import { blockedFamilies, grantableFamilies } from "./agentWorkStatus";

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
      "这台机器的类别模板不包含这个采集面（网关授权时会回 409）。",
  };
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
