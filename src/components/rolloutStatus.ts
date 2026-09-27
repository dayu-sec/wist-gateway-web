import type {
  RolloutPlanEntryView,
  RolloutPlanView,
  RolloutPhaseView,
} from "../types";

/**
 * 灰度发布计划的状态呈现口径（页面与契约测试共用一份，避免两处各写一套判断）。
 *
 * 语气沿用全局设计变量：ok / warn / crit / unknown。计划是「编排层」，
 * 条目（entry）才是逐台的事实 —— 计划的状态说「这张单子走到哪」，
 * 条目的状态说「这一台成没成」，两者不要混。
 */

/** 与全局设计变量同一套语气。 */
export type RolloutTone = "ok" | "warn" | "crit" | "unknown";

/** 计划整体状态（模型 `RolloutPlan.status`）。 */
export const PLAN_STATUS_LABEL: Record<string, string> = {
  draft: "草稿（待批准）",
  rolling: "灰度中",
  completed: "已完成",
  failed: "失败",
  canceled: "已取消",
};

export function planStatusLabel(status: string): string {
  return PLAN_STATUS_LABEL[status] ?? status;
}

export function planStatusTone(status: string): RolloutTone {
  switch (status) {
    case "rolling":
    case "completed":
      return "ok";
    case "draft":
      return "warn";
    case "failed":
      return "crit";
    default:
      return "unknown";
  }
}

/** 阶段状态（模型 `RolloutPhase.status`）。 */
export const PHASE_STATUS_LABEL: Record<string, string> = {
  pending: "待开始",
  rolling: "进行中",
  completed: "已完成",
};

export function phaseStatusLabel(status: string): string {
  return PHASE_STATUS_LABEL[status] ?? status;
}

export function phaseStatusTone(status: string): RolloutTone {
  switch (status) {
    case "rolling":
    case "completed":
      return "ok";
    default:
      return "unknown";
  }
}

/**
 * 逐目标条目状态（由 agentd 上报的结果折算）。
 *
 * 语气与「采集工作」页对一次性工作的口径一致：在飞（dispatched）= ok，
 * 还没派（pending）= unknown，成功 = ok，失败 = crit。
 */
export const ENTRY_STATUS_LABEL: Record<string, string> = {
  pending: "待派发",
  dispatched: "执行中",
  succeeded: "成功",
  failed: "失败",
};

export function entryStatusLabel(status: string): string {
  return ENTRY_STATUS_LABEL[status] ?? status;
}

export function entryStatusTone(status: string): RolloutTone {
  switch (status) {
    case "succeeded":
    case "dispatched":
      return "ok";
    case "failed":
      return "crit";
    default:
      return "unknown";
  }
}

/** 条目是否已了结（成功 / 失败）。 */
export function isEntrySettled(status: string): boolean {
  return status === "succeeded" || status === "failed";
}

/**
 * 推进闸门的可读写法（模型里的三种取值）。
 *
 * `isLastPhase` = 末阶段：闸门管的是「进入**下一阶段**」，而末阶段没有下一段 —— 推进它不派任何
 * 新活，只是把计划收尾，所以它全部了结后会**自动**收敛为 completed（不看闸门）。
 */
export function advanceRuleLabel(rule: string, isLastPhase = false): string {
  if (isLastPhase) return "末阶段：全部了结后自动收尾";
  const text = rule.trim();
  if (text === "manual") return "人工确认后推进";
  if (text === "all_succeeded") return "本阶段全部成功自动推进";
  const prefix = "success_rate:";
  if (text.startsWith(prefix)) {
    const rate = text.slice(prefix.length).trim();
    if (/^\d+$/.test(rate)) return `本阶段成功率 ≥ ${rate}% 自动推进`;
  }
  return text || "—";
}

/** 计划铺到的目标总数（阶段之间不重复，按创建规则保证）。 */
export function planTargetCount(plan: RolloutPlanView): number {
  const targets = new Set<string>();
  for (const phase of plan.phases) {
    for (const target of phase.targetIds) targets.add(target);
  }
  return targets.size;
}

/** 条目的汇总计数（详情页摘要条用）。 */
export interface RolloutCounts {
  total: number;
  pending: number;
  dispatched: number;
  succeeded: number;
  failed: number;
}

export function countEntries(entries: RolloutPlanEntryView[]): RolloutCounts {
  const counts: RolloutCounts = {
    total: entries.length,
    pending: 0,
    dispatched: 0,
    succeeded: 0,
    failed: 0,
  };
  for (const entry of entries) {
    if (entry.status === "pending") counts.pending += 1;
    else if (entry.status === "dispatched") counts.dispatched += 1;
    else if (entry.status === "succeeded") counts.succeeded += 1;
    else if (entry.status === "failed") counts.failed += 1;
  }
  return counts;
}

/**
 * 本阶段是否**全部了结**：每个阶段内 target 都到了 succeeded / failed 终态。
 *
 * 这是「能不能推进」的前提 —— 还有 target 在飞就没出结果，不能拿半截结果判成败。
 * 入口里没有条目的 target 视为未了结。
 */
export function phaseSettled(
  phase: RolloutPhaseView,
  entries: RolloutPlanEntryView[],
): boolean {
  const byTarget = new Map(entries.map((entry) => [entry.targetId, entry]));
  return phase.targetIds.every((target) => {
    const entry = byTarget.get(target);
    return entry ? isEntrySettled(entry.status) : false;
  });
}

/** 本阶段里还在飞（dispatched）或尚未派发（pending）的 target 数。 */
export function phaseIncompleteCount(
  phase: RolloutPhaseView,
  entries: RolloutPlanEntryView[],
): number {
  const byTarget = new Map(entries.map((entry) => [entry.targetId, entry]));
  return phase.targetIds.filter((target) => {
    const entry = byTarget.get(target);
    return !entry || !isEntrySettled(entry.status);
  }).length;
}

/** 当前进行中的阶段（`currentPhase` 从 1 开始；0 = 尚未开始）。 */
export function currentPhase(plan: RolloutPlanView): RolloutPhaseView | null {
  if (plan.currentPhase < 1 || plan.currentPhase > plan.phases.length) return null;
  return plan.phases[plan.currentPhase - 1] ?? null;
}
