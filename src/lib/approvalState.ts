import type { ActionApprovalView, ActionApprovalVoteView } from "../api/admin";

/**
 * 审批页的**纯逻辑**：状态 → 界面该显示什么。
 *
 * 为什么单独一个文件：仓库没有 DOM 测试环境（见 README），组件里的 `if (status === …)`
 * 只能靠人读。把这些判断抽出来之后，`tests/approval-state.test.ts` 用现有 `tsx` 脚本
 * 就能锁住它们 —— 不引入任何新依赖。
 *
 * 放在这里的只有**不依赖 React / i18n / 样式**的判断；文案（`t()`）与样式类名仍留在组件里。
 */

/** 审批页的三个 tab。`all` 含被驳回 / 已过期（它们不会再执行，只留审计）。 */
export type ApprovalTab = "pending" | "approved" | "all";

export const APPROVAL_TABS: readonly ApprovalTab[] = [
  "pending",
  "approved",
  "all",
];

/**
 * 页面的全部视图：三个**过滤档** + 一个**设置**视图。
 *
 * 为什么要分开：`setup` 不是审批单的过滤条件（它不筛 `status`）。把它塞进 `ApprovalTab`
 * 就会让 `matchesTab` 多出一个分支、`counts` 多出一个永远为 0 的键 —— 那类“类型上对、语义上错”
 * 的东西迟早会被当真用。
 *
 * `setup` 也不在 tab 条里：它是页面**顶部**的独立入口（与标题同一行），因为装 CLI / 登记公钥
 * 是开工前的一次性设置，混进过滤 tab 会被当成「第五种审批单状态」。
 */
export type ApprovalView = ApprovalTab | "setup";

export const APPROVAL_VIEWS: readonly ApprovalView[] = [
  ...APPROVAL_TABS,
  "setup",
];

/** 这个 view 是不是一个审批单过滤档（即：要不要渲染表格 / 算票数）。 */
export function isApprovalTab(view: ApprovalView): view is ApprovalTab {
  return view !== "setup";
}

/** 这张审批单是否属于这个 tab。 */
export function matchesTab(
  approval: Pick<ActionApprovalView, "status">,
  tab: ApprovalTab,
): boolean {
  if (tab === "all") return true;
  return approval.status === tab;
}

/**
 * 通过票数。数的是**人**，不是次数 —— 网关侧 `(approval_id, approver)` 唯一，
 * 同一个人再投是覆盖，所以列表里天然不会重复。
 */
export function approvedCount(
  votes: ReadonlyArray<Pick<ActionApprovalVoteView, "decision">>,
): number {
  return votes.filter((vote) => vote.decision === "approve").length;
}

/** 摘要行内只露前 12 位 hex；完整值放 `title`，供核对。 */
export function shortDigest(digest: string): string {
  const marker = digest.lastIndexOf(":");
  const hex = marker >= 0 ? digest.slice(marker + 1) : digest;
  return hex.slice(0, 12);
}

export interface ApprovalActions {
  canApprove: boolean;
  canReject: boolean;
  canIssue: boolean;
}

/**
 * 一行上允许哪些动作。**唯一来源**：组件按它渲染，测试按它断言。
 *
 * 两处各写一遍条件，迟早会出现「按钮显示出来、点了却被网关拒」——而审批的按钮点下去
 * 是有后果的（通过不可撤回、签发会下发）。
 *
 * 规则对应网关的状态机：
 * - `pending`：可投通过 / 驳回；不能签发（还没批够）。
 * - `approved` 且**未**签发：只能签发（再投票会被拒：`approval_closed`）。
 * - `approved` 且**已**签发：什么都不做（重复签回 `approval_already_issued`）。
 * - `rejected` / `expired`：终态，什么都不做。
 */
export function allowedActions(
  approval: Pick<ActionApprovalView, "status" | "issued">,
): ApprovalActions {
  if (approval.status === "pending") {
    return { canApprove: true, canReject: true, canIssue: false };
  }
  if (approval.status === "approved" && !approval.issued) {
    return { canApprove: false, canReject: false, canIssue: true };
  }
  return { canApprove: false, canReject: false, canIssue: false };
}
