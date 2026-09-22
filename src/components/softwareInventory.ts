/**
 * 资产清单的展示口径：分组、台账映射、截断提示。
 *
 * 抽成不依赖 React / CSS 的纯模块，契约测试可以直接断言 ——
 * 这里的三件事都极易漂移成「看起来对但读错了」：
 *   1. 明细行 → 条目组（同一个 `.app` 下几条可执行文件算**一组**）；
 *   2. `holders` 行 → 持有机器（同一台机器在同一键下可能有多条路径，
 *      所以 `holders.length` 不是「机器数」，`agent_count` 才是）；
 *   3. `truncated` 的表达（截断必须说出来，不能静默只显示前 N 条）。
 */

import { ApiError, type AgentOverview } from "../api";
import type {
  AgentSoftwareEntry,
  SoftwareHolder,
  SoftwareKind,
} from "../types";

/** 条目类别的展示名（模型里是闭合 variant：app / binary）。 */
export const SOFTWARE_KIND_LABEL: Record<SoftwareKind, string> = {
  app: "app 包",
  binary: "可执行",
};

/** 「按机器看软件」里一个 `software_key` 折叠出的一组条目。 */
export interface SoftwareInventoryGroup {
  softwareKey: string;
  name: string;
  kind: SoftwareKind;
  /** 组内可执行路径条数 —— 分组头上的「N 条可执行」。 */
  pathCount: number;
  paths: string[];
  /** 组内命中过的归并规则（通常只有一条）。 */
  matchedRules: string[];
}

/**
 * 按 `software_key` 折叠明细行。
 *
 * 名字与类别是由键**机械决定**的（`app_bundle_of` 是路径的纯函数），
 * 所以组内必然一致；真出现不一致也只是说明了另一侧换了规则册，
 * 这里保留首行值并照样分组，不因为一个展示字段就把整页抛掉。
 * 顺序沿用后端给的顺序（`kind, software_key, path`），不重排。
 */
export function groupSoftwareEntries(
  entries: AgentSoftwareEntry[],
): SoftwareInventoryGroup[] {
  const groups = new Map<string, SoftwareInventoryGroup>();
  for (const entry of entries) {
    const existing = groups.get(entry.softwareKey);
    if (!existing) {
      groups.set(entry.softwareKey, {
        softwareKey: entry.softwareKey,
        name: entry.name,
        kind: entry.kind,
        pathCount: 1,
        paths: [entry.path],
        matchedRules: entry.matchedRule ? [entry.matchedRule] : [],
      });
      continue;
    }
    existing.pathCount += 1;
    existing.paths.push(entry.path);
    if (entry.matchedRule && !existing.matchedRules.includes(entry.matchedRule)) {
      existing.matchedRules.push(entry.matchedRule);
    }
  }
  return [...groups.values()];
}

/** 一台机器在某个键下持有的路径。 */
export interface SoftwareHolderGroup {
  agentId: string;
  paths: string[];
}

/**
 * 把 `holders` 行折叠成「哪些机器持有」。
 *
 * 折叠后 `group.length` 应与 `agent_count` 一致，而 `holders.length` 可能更大
 * —— 这正是页面不能把行数直接读成机器数的原因。
 */
export function groupHoldersByAgent(
  holders: SoftwareHolder[],
): SoftwareHolderGroup[] {
  const groups = new Map<string, SoftwareHolderGroup>();
  for (const holder of holders) {
    const existing = groups.get(holder.agentId);
    if (existing) {
      existing.paths.push(holder.path);
    } else {
      groups.set(holder.agentId, {
        agentId: holder.agentId,
        paths: [holder.path],
      });
    }
  }
  return [...groups.values()];
}

/**
 * 截断提示：返回 `null` 表示没被截断，页面就不该说任何「还有更多」的话。
 *
 * 后端只回 `truncated` 与条数，**不回键总数**，所以这里不去编一个「共 N 个」
 * —— 只如实说清「现在看到的是上限内的前 N 条」并给出放宽口径。
 */
export function truncationNotice(options: {
  truncated: boolean;
  returned: number;
  limit: number;
}): string | null {
  if (!options.truncated) return null;
  return (
    `已截断：清单里还有更多软件键没显示 —— 这里只是前 ${options.returned} 条` +
    `（当前上限 ${options.limit} 条，后端最多接受 500）。这不是全量清单，` +
    `请按上面的键判断，不要当成「机队里只有这些软件」。`
  );
}

/** Agent 台账（`AgentOverview`）里一台机器的状态。 */
export type AgentLedgerStatus =
  | "online"
  | "abnormal"
  | "offline"
  | "example"
  | "unknown";

export const AGENT_LEDGER_STATUS_LABEL: Record<AgentLedgerStatus, string> = {
  online: "在线",
  abnormal: "异常",
  offline: "离线",
  example: "示例数据",
  unknown: "不在当前台账",
};

export interface AgentLedgerEntry {
  agentId: string;
  status: AgentLedgerStatus;
}

/**
 * 从 Agent 概览建台账：`holders` 里只有 `agent_id`，主机名与状态得靠它补。
 *
 * 先放「最近在线」（含 `source: example` 的示例数据），再让异常列表覆盖 ——
 * 同一台机器两边都在时以异常为准（需要被看到的那个状态优先）。
 */
export function buildAgentLedger(
  overview: AgentOverview | undefined,
): Map<string, AgentLedgerEntry> {
  const ledger = new Map<string, AgentLedgerEntry>();
  if (!overview) return ledger;
  for (const agent of overview.recentOnlineAgents) {
    ledger.set(agent.agentId, {
      agentId: agent.agentId,
      status: agent.source === "example" ? "example" : "online",
    });
  }
  for (const agent of overview.abnormalAgents) {
    ledger.set(agent.agentId, {
      agentId: agent.agentId,
      status: agent.status === "offline" ? "offline" : "abnormal",
    });
  }
  return ledger;
}

/**
 * 台账里查不到的机器**照样返回一条**：页面显示 `agent_id` 原文，
 * 绝不留空白（留白会让人以为是显示坏了，而不是「这台机器不在概览里」）。
 *
 * 注意：概览只覆盖「最近在线的」与「异常的」机器，是一份**视图**而不是全量名册，
 * 所以「不在当前台账」只表示这份概览没提到它，不等于没注册。
 */
export function ledgerEntryFor(
  ledger: Map<string, AgentLedgerEntry>,
  agentId: string,
): AgentLedgerEntry {
  return ledger.get(agentId) ?? { agentId, status: "unknown" };
}

/**
 * 区分 404 的两种含义（与用途页同一口径）。
 *
 * 「未知 Agent」是网关自己回的（正文是 `unknown agent {id}`）；
 * 网关上没有这个路由（旧构建）也是 404，但正文是空的。
 * 两者处置完全不同：前者请核对 agent_id，后者要重建网关。
 */
export function isUnknownAgentError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 404 &&
    /unknown agent/i.test(error.detail ?? "")
  );
}
