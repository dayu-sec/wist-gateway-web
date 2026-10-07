/**
 * 「Agent 升级」页的目标选择口径（本页专用）。
 *
 * 灰度阶梯 / 阶段切分与状态呈现等**通用**口径已收到共享包 `@dayu-sec/wist-web-core`
 * （`planPhases` / `planStatusLabel` / `filterRolloutPlans` 等，中心与网关共用同一份）；
 * 本模块只保留这一页独有的「从机队挑升级目标」。
 */

/** 挑选升级目标只需要这两列。 */
export interface UpgradeFleetAgent {
  agentId: string;
  status: string;
}

export interface UpgradeTargetSelection {
  /** 可升级的 agent_id（排除明确离线的机器，按 id 排序）。 */
  agentIds: string[];
  /** 机队总台数（含离线）。 */
  fleetSize: number;
  /** 被排除的离线台数。 */
  offlineCount: number;
}

/**
 * 从机队里挑出**升级目标**：把明确离线的机器排掉。
 *
 * 为什么要排：离线的机器拿不到派发（要等它回来或过期），把它排进金丝雀 / 批次只会把
 * 整段卡住。在线判据由**网关**给（`AgentListEntry.status`，与总览同一处 `agent_is_online`）
 * —— 页面不自己重新定义一次“多久算掉线”。
 *
 * 为什么只排 `offline`、而不是“只留 online”：与仓库既有口径一致（**未知 ≠ 离线**）——
 * 一台我们还没判定的机器不能当成离线扔掉，否则一次状态字段异常就会把整队目标筛空。
 */
export function selectUpgradeTargets(
  agents: UpgradeFleetAgent[],
): UpgradeTargetSelection {
  const agentIds = agents
    .filter((agent) => agent.status !== "offline")
    .map((agent) => agent.agentId)
    .sort();
  return {
    agentIds,
    fleetSize: agents.length,
    offlineCount: agents.length - agentIds.length,
  };
}
