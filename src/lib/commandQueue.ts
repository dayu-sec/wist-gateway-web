import type {
  AgentCommandQueueFilter,
  AgentCommandQueueState,
  AgentCommandSource,
  AgentFactRefreshOutcome,
} from "../api/admin";
import { t } from "../i18n";

// 命令队列的**纯投影**：状态 / 来源 / 命令种类怎么变成界面上的说法。
//
// 为什么要单独一层：这些词表与网关（`wist-gateway` `api/queue.rs`）和 agentd
// （`wist-api::status::command_*`）是同一批常量，页面里散着写两遍必然漂。放在这里
// 也便于用 `tests/command-queue-contract.test.ts` 直接钉住（不用起组件渲染环境）。
//
// 约定：`t()` 一律在**调用期**求值（这些函数都是渲染期调用的），不要在模块顶层算好。

const QUEUE_FILTERS: readonly AgentCommandQueueFilter[] = [
  "queued",
  "claimed",
  "acked",
  "expired",
  "superseded",
  "all",
];

/** 从 URL / 下拉里读到的过滤词：不在闭集里就是「不认」，由调用方回落到缺省。 */
export function isAgentCommandQueueFilter(
  value: string | null | undefined,
): value is AgentCommandQueueFilter {
  return (
    typeof value === "string" &&
    (QUEUE_FILTERS as readonly string[]).includes(value)
  );
}

/** 队列态的界面说法。`expired` / `superseded` 不是「做完了」，所以不并进 `acked`。 */
export function queueStateLabel(state: AgentCommandQueueState): string {
  switch (state) {
    case "queued":
      return t("待执行", "Queued");
    case "claimed":
      return t("执行中", "Running");
    case "acked":
      return t("已回执", "Reported");
    case "expired":
      return t("已过期", "Expired");
    case "superseded":
      return t("被取代", "Superseded");
  }
}

/** 徽标色调：前两个是「还没结束」，`acked` 是唯一「正常结束」，其余是「没跑」。 */
export type QueueTone = "queued" | "claimed" | "acked" | "void";

export function queueStateTone(state: AgentCommandQueueState): QueueTone {
  switch (state) {
    case "queued":
      return "queued";
    case "claimed":
      return "claimed";
    case "acked":
      return "acked";
    case "expired":
    case "superseded":
      return "void";
  }
}

/** 谁排的队。中心下发是这一页最想回答的问题，所以它有自己的颜色。 */
export function commandSourceLabel(source: AgentCommandSource): string {
  switch (source) {
    case "center":
      return t("中心", "Center");
    case "admin":
      return t("页面", "Console");
    case "system":
      return t("系统", "System");
  }
}

/**
 * 命令种类的说法。
 *
 * 词表只有两种（网关 `command_kind`）；认不出来就照实显示原始 `kind` ——
 * 显示成「其它」会让人以为网关知道自己排了什么。
 */
export function commandKindLabel(kind: string): string {
  switch (kind) {
    case "investigate":
      return t("一次性调查", "One-off investigation");
    case "refresh_facts":
      return t("重采事实", "Refresh facts");
    default:
      return kind;
  }
}

/**
 * 「做完以后去哪看结果」。没有对应页面的种类返回 `null`（表格里就不渲染链接）。
 *
 * 只给**真的能看结果**的那两页：调查去调查页（报告正文在那儿），重采去采集工作页。
 */
export function commandKindRoute(kind: string, agentId: string): string | null {
  const agent = encodeURIComponent(agentId);
  switch (kind) {
    case "investigate":
      return `/agents/${agent}/investigations`;
    case "refresh_facts":
      return `/agents/${agent}/work`;
    default:
      return null;
  }
}

/** 终态结论的说法（`outcome` 是闭集；`null` = 还没到终态）。 */
export function outcomeLabel(
  outcome: AgentFactRefreshOutcome | null,
): string | null {
  switch (outcome) {
    case null:
      return null;
    case "succeeded":
      return t("成功", "Succeeded");
    case "failed":
      return t("失败", "Failed");
    case "no_uplink":
      return t("无上送通道", "No uplink");
    case "throttled":
      return t("被节流", "Throttled");
    case "stale":
      return t("太晚取到（已失效）", "Stale");
    case "unsupported":
      return t("Agent 不支持", "Unsupported");
    case "superseded":
      return t("被新命令取代", "Superseded");
    case "expired":
      return t("过期未执行", "Expired");
  }
}

/** 语气的徽标色调：成功才绿；「没跑」和「失败」都不该绿。 */
export function outcomeTone(
  outcome: AgentFactRefreshOutcome | null,
): QueueTone {
  switch (outcome) {
    case "succeeded":
      return "acked";
    case null:
      return "claimed";
    case "failed":
      return "queued";
    default:
      return "void";
  }
}

/**
 * 「等了多久」：队列页要回答的是「这条卡了多久」，不是「几时几分」。
 *
 * 粗粒度、像一句话；绝对时刻放 `title` 里（页面上仍要有可核对的时间）。
 */
export function commandAgeLabel(
  at: string | null,
  now = Date.now(),
): string | null {
  if (!at) return null;
  const parsed = Date.parse(at);
  if (!Number.isFinite(parsed)) return null;
  const seconds = Math.max(0, Math.round((now - parsed) / 1000));
  if (seconds < 10) return t("刚刚", "just now");
  if (seconds < 60) return t("{n} 秒前", "{n}s ago", { n: seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("{n} 分钟前", "{n}m ago", { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("{n} 小时前", "{n}h ago", { n: hours });
  return t("{n} 天前", "{n}d ago", { n: Math.round(hours / 24) });
}
