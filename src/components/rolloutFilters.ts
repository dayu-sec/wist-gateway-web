/**
 * 升级计划列表的筛选口径：按**状态**分页 + 按**时间窗**收窄。
 *
 * 列表接口一次返回全部计划（按 `created_at` 倒序），计划只增不减，页面上一次铺出来会越来越长。
 * 这里把「哪些计划算这个状态」「哪些落在这个时间窗」抽成纯判断，页面只负责把选中的筛选喂进来、
 * 把结果铺出去；口径集中在这一处，测试也钉在这里。
 */

/** 状态分页：成功 = 计划的 `completed`，进行中 = `rolling`，失败 = `failed`。 */
export type PlanStatusFilter = "all" | "rolling" | "succeeded" | "failed";

/** 时间窗：按**本地日历**切（周一为一周之始），不是「最近 N 天」。 */
export type PlanTimeRange = "all" | "this_week" | "last_week" | "this_month";

export const PLAN_STATUS_FILTERS: readonly {
  value: PlanStatusFilter;
  label: string;
}[] = [
  { value: "all", label: "全部" },
  { value: "rolling", label: "进行中" },
  { value: "succeeded", label: "成功" },
  { value: "failed", label: "失败" },
];

export const PLAN_TIME_RANGES: readonly {
  value: PlanTimeRange;
  label: string;
}[] = [
  { value: "all", label: "全部时间" },
  { value: "this_week", label: "本周" },
  { value: "last_week", label: "上周" },
  { value: "this_month", label: "本月" },
];

/**
 * 状态筛选 → 计划状态（模型 `RolloutPlan.status`）。
 *
 * 分页只列这三种「有结论」的状态：`draft` / `canceled` 不单列，只在「全部」里出现 ——
 * 把草稿混进「进行中」会让人以为它已经在跑。
 */
const STATUS_FILTER_VALUE: Record<Exclude<PlanStatusFilter, "all">, string> = {
  rolling: "rolling",
  succeeded: "completed",
  failed: "failed",
};

export function matchesPlanStatus(
  status: string,
  filter: PlanStatusFilter,
): boolean {
  if (filter === "all") return true;
  return status === STATUS_FILTER_VALUE[filter];
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** 一周之始（周一 00:00，本地时区）。 */
export function startOfWeek(date: Date): Date {
  const start = startOfDay(date);
  // 周日 getDay()=0，要退回 6 天才到上一个周一；周一本身偏移 0。
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);
  return start;
}

/**
 * 时间窗的 `[起, 止)`（本地时区）；`all` 返回 `null`（不过滤）。
 *
 * 「本周 / 上周」按**日历周**（周一起）切，不是滚动 7 天 —— 与页面上给人的直觉一致。
 */
export function timeRangeBounds(
  range: PlanTimeRange,
  now: Date,
): { start: Date; end: Date } | null {
  switch (range) {
    case "this_week": {
      const start = startOfWeek(now);
      return { start, end: addDays(start, 7) };
    }
    case "last_week": {
      const end = startOfWeek(now);
      return { start: addDays(end, -7), end };
    }
    case "this_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return {
        start,
        end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
      };
    }
    default:
      return null;
  }
}

/**
 * `createdAt`（RFC3339）是否落在时间窗内。
 *
 * 认不出的时间戳**不进任何时间窗**：宁可让它只在「全部时间」里出现，也不要凭坏数据把它塞进
 * 「本周」而误导。时间比较用绝对时刻，窗界按本地时区 —— 用户说的「本周」是本地日历周。
 */
export function matchesPlanTimeRange(
  createdAt: string,
  range: PlanTimeRange,
  now: Date,
): boolean {
  if (range === "all") return true;
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return false;
  const bounds = timeRangeBounds(range, now);
  if (!bounds) return true;
  return (
    at.getTime() >= bounds.start.getTime() &&
    at.getTime() < bounds.end.getTime()
  );
}

/** 状态 + 时间窗一起筛。泛型约束只取用得到的两个字段，便于测试直接喂普通对象。 */
export function filterRolloutPlans<
  T extends { status: string; createdAt: string },
>(
  plans: readonly T[],
  filters: { status: PlanStatusFilter; timeRange: PlanTimeRange },
  now: Date,
): T[] {
  return plans.filter(
    (plan) =>
      matchesPlanStatus(plan.status, filters.status) &&
      matchesPlanTimeRange(plan.createdAt, filters.timeRange, now),
  );
}
