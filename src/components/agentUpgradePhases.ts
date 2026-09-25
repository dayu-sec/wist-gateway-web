/**
 * 灰度阶段的分法（本页固定「Agent 升级」口径）。
 *
 * 模型里**一个 Agent 只能属于一个阶段**（网关建计划时对重复目标直接 400），所以阶段之间必须
 * 是**互不重叠**的切片。这里用「累计覆盖」的阶梯表达灰度：每个阶段声明「覆盖到机队的多少」，
 * 相邻阶段的**新增** = 本次覆盖 − 上次覆盖 —— 运维不用填任何 agent_id。
 *
 * 阶梯（按用户口径）固定为：1 台（金丝雀）→ 10% → 30% → 70% → 全量（剩余）。选 K 个阶段时，
 * 取阶梯的前 K-1 级作为中间切点，最后一级永远是「剩余全部」，保证一把铺满机队。
 */

/** 一个切点的覆盖口径：固定台数，或占机队的百分比。 */
type CoverageCut =
  | { kind: "count"; value: number }
  | { kind: "percent"; value: number };

/** 中间切点阶梯（「全量」由阶段数隐含，不在表里）。 */
const LADDER: CoverageCut[] = [
  { kind: "count", value: 1 }, // 金丝雀：1 台
  { kind: "percent", value: 10 },
  { kind: "percent", value: 30 },
  { kind: "percent", value: 70 },
];

/** 可选的阶段数：阶梯最多 4 个中间切点 + 一级「剩余」= 5 阶段。 */
export const PHASE_COUNTS = [2, 3, 4, 5] as const;

/**
 * 机队台数**能支持**的阶段数。
 *
 * 每段至少要 1 台，所以阶段数不能大于台数 —— 机队小的时候就不该再多轮。
 * 只保留 ≤ 台数的预设；一台机器时退化为 `[1]`（不分批，一把到位）。
 */
export function availablePhaseCounts(total: number): number[] {
  if (total <= 0) return [];
  const feasible = PHASE_COUNTS.filter((count) => count <= total);
  return feasible.length > 0 ? [...feasible] : [1];
}

export interface AssignedPhase {
  /** 从 1 开始。 */
  index: number;
  /** 本阶段的 agent_id（互不重叠，取自排序后的机队）。 */
  targetIds: string[];
  /**
   * 目标覆盖比例（**阶梯口径**，0..1）；金丝雀段为 `null`。
   *
   * 展示的是阶梯上的那一级（如 10%），而不是 `切点/台数` 的实现值 —— 小机队上后者会被
   * 向上取整放大（10% 可能落成 17%），读起来反而像选错了。实际台数看 `targetIds.length`。
   */
  coverage: number | null;
  /** 金丝雀段（首段且恰好 1 台）。 */
  isCanary: boolean;
  /** 收尾段（覆盖到全量）。 */
  isFinal: boolean;
}

/** 阶梯第 i 级的**目标**覆盖比例；这一级是台数（金丝雀）时返回 `null`。 */
function ladderCoverage(i: number): number | null {
  const cut = LADDER[Math.min(i, LADDER.length - 1)];
  return cut.kind === "percent" ? cut.value / 100 : null;
}

export interface PhasePlan {
  phases: AssignedPhase[];
  /** 分不出来时的原因（空机队 / 分段数大于台数）；`null` = 可分。 */
  error: string | null;
}

/** 一个切点折算成「覆盖几台」。 */
function cutSize(cut: CoverageCut, total: number): number {
  if (cut.kind === "count") return Math.min(cut.value, total);
  return Math.ceil((cut.value / 100) * total);
}

/**
 * 把机队切成 `phaseCount` 个互不重叠的阶段。
 *
 * 顺序取**排序后的 agent_id**（确定、可复现）。累计覆盖保证切点单调不减，再夹到
 * `[上一切点 + 1, 台数 - 后面阶段数]`，确保每段**非空**；机队太小（分段数 > 台数）
 * 直接报错，而不是悄悄给出空阶段。
 */
export function planPhases(agentIds: string[], phaseCount: number): PhasePlan {
  const total = agentIds.length;
  const order = [...agentIds].sort();
  if (total === 0) {
    return { phases: [], error: "机队里还没有已注册的 Agent，无法分配阶段。" };
  }
  if (phaseCount > total) {
    return {
      phases: [],
      error: `机队只有 ${total} 台，分不出 ${phaseCount} 个非空阶段。`,
    };
  }

  const cuts: number[] = [];
  let previous = 0;
  for (let i = 0; i < phaseCount - 1; i += 1) {
    const cut = LADDER[Math.min(i, LADDER.length - 1)];
    // 给后面每个阶段留至少 1 台。
    const upper = total - (phaseCount - i - 1);
    const size = Math.max(previous + 1, Math.min(cutSize(cut, total), upper));
    cuts.push(size);
    previous = size;
  }
  cuts.push(total);

  const phases: AssignedPhase[] = [];
  let start = 0;
  for (let i = 0; i < cuts.length; i += 1) {
    const end = cuts[i];
    const targetIds = order.slice(start, end);
    phases.push({
      index: i + 1,
      targetIds,
      coverage: end === total ? 1 : ladderCoverage(i),
      // 金丝雀 = 首批且恰好 1 台；但若这一批就是全部（单台机队），不算金丝雀。
      isCanary: i === 0 && targetIds.length === 1 && end !== total,
      isFinal: end === total,
    });
    start = end;
  }
  return { phases, error: null };
}

/** 阶段的规模文字：金丝雀读「1 台」，其余读「覆盖 ~X%」（X 是阶梯上的那一级）。 */
export function phaseScaleLabel(phase: AssignedPhase): string {
  if (phase.isCanary) return "1 台（金丝雀）";
  return `覆盖 ~${Math.round((phase.coverage ?? 0) * 100)}%`;
}
