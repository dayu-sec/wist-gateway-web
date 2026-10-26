import type {
  AgentFactRefreshCommand,
  AgentFactRefreshOutcome,
} from "../api";
import { t } from "../i18n";

/**
 * 「重采事实」命令的**展示判定**。
 *
 * 为什么单独放一处：本仓没有组件渲染环境（无 jsdom），而这些映射决定了运维如何理解
 * 一条命令 —— 「等待认领」是还没下发、`throttled` 是正常节流而不是故障、`unsupported`
 * 该去升级 agentd。抽出来就能被测试钉住，也避免同一套文案在提示条与行内徽标里写两遍。
 */

export type FactRefreshStatus =
  | "idle"
  | "requested"
  | "acked"
  | "succeeded"
  | "failed"
  | "no_uplink"
  | "throttled"
  | "stale"
  | "unsupported"
  | "superseded"
  | "expired";

/**
 * 失败/异常时给人看的**原因**（后端 `detail`）。
 *
 * 为什么单独抽出来：以前页面只把它放在 `title` 悬浮里 —— 触屏、截图、录屏都看不到，
 * 现场只会说「全都显示失败，看不到原因」。把“为什么失败”和“失败了”放在同一行才是可用的。
 *
 * 返回 `null` 表示没有可展示的细节（不用空字符串占位）。
 */
export function factRefreshDetail(
  command: AgentFactRefreshCommand | null | undefined,
): string | null {
  const detail = (command?.detail ?? "").trim();
  return detail.length > 0 ? detail : null;
}

/**
 * 一条命令 → 页面状态。优先级是**命令生命周期**决定的：
 * 没请求过 → 等待认领 → 已认领（重采中）→ 终态（outcome）。
 */
export function factRefreshStatus(
  command: AgentFactRefreshCommand | null | undefined,
): FactRefreshStatus {
  if (!command || command.commandId === null) return "idle";
  if (command.outcome !== null) {
    return outcomeStatus(command.outcome);
  }
  return command.acknowledgedAt === null ? "requested" : "acked";
}

function outcomeStatus(
  outcome: AgentFactRefreshOutcome,
): FactRefreshStatus {
  switch (outcome) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "no_uplink":
      return "no_uplink";
    case "throttled":
      return "throttled";
    case "stale":
      return "stale";
    case "unsupported":
      return "unsupported";
    case "superseded":
      return "superseded";
    case "expired":
      return "expired";
  }
}

/** 状态文案。`throttled` 要带上「60s 内已采过」——那不是故障，别让人去查。 */
export function factRefreshStatusLabel(status: FactRefreshStatus): string {
  switch (status) {
    case "idle":
      return t("未请求", "Not requested");
    case "requested":
      return t("等待认领", "Waiting for claim");
    case "acked":
      return t("重采中", "Refreshing");
    case "succeeded":
      return t("已重采", "Refreshed");
    case "failed":
      return t("失败", "Failed");
    case "no_uplink":
      return t("无上送通道", "No uplink");
    case "throttled":
      return t("被节流（60s 内已采过）", "Throttled (collected within 60s)");
    case "stale":
      return t("已过期", "Stale");
    case "unsupported":
      return t("版本不支持", "Unsupported version");
    case "superseded":
      return t("被新请求取代", "Superseded");
    case "expired":
      return t("网关已作废", "Expired at gateway");
  }
}

/** 徽标色调：只表达「要不要处理」，不与授权状态抢同一套颜色。 */
export type FactRefreshTone = "muted" | "pending" | "ok" | "warn" | "crit";

export function factRefreshTone(status: FactRefreshStatus): FactRefreshTone {
  switch (status) {
    case "idle":
      return "muted";
    case "requested":
    case "acked":
      return "pending";
    case "succeeded":
      return "ok";
    case "failed":
      return "crit";
    case "no_uplink":
    case "throttled":
    case "stale":
    case "unsupported":
      return "warn";
    case "superseded":
    case "expired":
      return "muted";
  }
}

export interface FactRefreshSummary {
  /** 按状态计数（含 `idle`；页面只展示需要看到的状态）。 */
  counts: Record<FactRefreshStatus, number>;
  total: number;
}

/** 状态汇总的展示顺序：先「在路上」，再结果，最后「被取代 / 作废」。 */
export const FACT_REFRESH_SUMMARY_ORDER: readonly FactRefreshStatus[] = [
  "requested",
  "acked",
  "succeeded",
  "throttled",
  "failed",
  "no_uplink",
  "stale",
  "unsupported",
  "superseded",
  "expired",
];

export function summarizeFactRefresh(
  commands: ReadonlyArray<AgentFactRefreshCommand | null | undefined>,
): FactRefreshSummary {
  const counts: Record<FactRefreshStatus, number> = {
    idle: 0,
    requested: 0,
    acked: 0,
    succeeded: 0,
    failed: 0,
    no_uplink: 0,
    throttled: 0,
    stale: 0,
    unsupported: 0,
    superseded: 0,
    expired: 0,
  };
  for (const command of commands) {
    counts[factRefreshStatus(command)] += 1;
  }
  return { counts, total: commands.length };
}

/**
 * 只保留计数 > 0 的状态，按 `FACT_REFRESH_SUMMARY_ORDER` 排；
 * `idle` 是「没有请求过」，不进汇总（页面对未发起的主机不显示状态）。
 */
export function factRefreshSummaryParts(
  summary: FactRefreshSummary,
): Array<{ status: FactRefreshStatus; count: number }> {
  return FACT_REFRESH_SUMMARY_ORDER.filter(
    (status) => summary.counts[status] > 0,
  ).map((status) => ({ status, count: summary.counts[status] }));
}
