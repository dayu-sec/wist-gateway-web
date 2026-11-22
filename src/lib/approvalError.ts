import { t } from "../i18n";

/**
 * 审批页的错误 → 用户可执行的话。
 *
 * 与 `approvalState.ts` 同样的理由抽在这里：组件里的 if-链只能靠人读，而这里能用现有
 * `tsx` 脚本逐码断言（`tests/approval-error.test.ts`）。刻意**不** import `../api`：
 * 只需要 `{status, code, detail}` 三个字段，调方把 `ApiError` 传进来即可 —— 这样测试
 * 不用把 `createAdminAuth`（碰 `localStorage`）拖进 Node 环境。
 */
export interface ApprovalErrorInput {
  /** HTTP 状态码。`0` 表示「不是 HTTP 错误」（响应不符合契约）。 */
  status: number;
  /** 网关错误信封里的稳定原因码。 */
  code?: string;
  /** 网关错误信封里的可展示短文案。 */
  detail?: string;
}

/**
 * 审批链路的稳定原因码（网关 `src/api/codes.rs`）。
 *
 * 为什么要逐码写文案：这些码在页面上是**用户可见的决策依据**。「再点一次就好」和
 * 「计划已经被改过、必须重提审批」是完全不同的事，直接抛网关那句英文 `detail` 会让
 * 运维在错误的方向上重试。
 */
export function approvalCodeMessage(code: string): string | null {
  switch (code) {
    case "plan_changed_since_approval":
      return t(
        "计划内容在审批之后被改过，这份审批已作废。需要按新内容重新提交计划、重新走审批 —— 直接再点签发不会通过。",
        "The plan changed after it was approved, so this approval is void. Submit the plan again with the new content and re-approve it; clicking sign again will not work.",
      );
    case "approval_closed":
      return t(
        "这张单子已经结束（批够了 / 被驳回 / 过期），不能再投票。刷新后它会在「已批准」或「全部」里。",
        "This request is already closed (fully approved / rejected / expired) and can no longer be voted on. After refreshing it will be under Approved or All.",
      );
    case "approval_already_issued":
      return t(
        "这张单子已经签发过了，不会重复下发。到「任务队列」看实际执行结果即可。",
        "This request has already been signed, so nothing is dispatched again. Check the command queue for the actual result.",
      );
    case "approval_expired":
      return t(
        "这张单子已过期，不能再执行。需要重新提交计划走一遍审批。",
        "This request has expired and cannot be executed. Submit the plan again to go through approval.",
      );
    case "approval_incomplete":
      return t(
        "票数还没凑够，不能签发。先到「待审批」把这张单子批完。",
        "It does not have enough votes to be signed yet. Approve this request under Pending first.",
      );
    case "approval_not_found":
      return t(
        "找不到这张审批单（可能已被清理）。刷新列表看看最新状态。",
        "This approval request no longer exists (it may have been cleaned up). Refresh the list to see the current state.",
      );
    case "approval_policy_unsupported":
      // 单票制后本网关不再返回它；保留是为了对**旧版网关**（仍按多票策略）给出准确指引。
      return t(
        "这张计划要求多名审批人，而当前策略是单次审批。通常是网关还是旧版本（仍按多票策略），升级网关后重试即可。",
        "This plan requires multiple approvers, but the current policy is single approval. The gateway is likely still on the older multi-approval policy — upgrade it and retry.",
      );
    case "approval_not_required":
      return t(
        "该计划的风险等级不需要审批，可以直接执行。",
        "This plan's risk level does not require approval, so it can be executed directly.",
      );
    case "approval_load_failed":
    case "approval_store_failed":
      return t(
        "网关读写审批存储失败（可能是磁盘或权限问题）。检查网关日志与数据目录后再重试。",
        "The gateway failed to read or write the approval store (likely a disk or permission issue). Check the gateway logs and data directory, then retry.",
      );
    case "plan_signing_unavailable":
      return t(
        "网关没有配置签发私钥，签发不可用：在网关配置里加 [plan_signing] key_file 并重启。",
        "The gateway has no signing key configured, so signing is unavailable: add [plan_signing] key_file to the gateway config and restart.",
      );
    default:
      return null;
  }
}

/** 审批页所有能被识别的原因码（测试据此保证「每个码都有专门文案」）。 */
export const KNOWN_APPROVAL_ERROR_CODES = [
  "plan_changed_since_approval",
  "approval_closed",
  "approval_already_issued",
  "approval_expired",
  "approval_incomplete",
  "approval_not_found",
  "approval_policy_unsupported",
  "approval_not_required",
  "approval_load_failed",
  "approval_store_failed",
  "plan_signing_unavailable",
] as const;

/**
 * 把一次失败翻译成一句能照着做的话。
 *
 * `null` = 没有拿到结构化错误（响应不符合契约）—— 这种情况才是真正的「前端/网关版本不匹配」。
 */
export function describeApprovalError(
  error: ApprovalErrorInput | null,
): string {
  if (!error) {
    return t(
      "请求失败：响应不符合当前契约，请检查网关与前端版本。",
      "Request failed: the response does not match the current contract. Check the gateway and front-end versions.",
    );
  }
  if (error.status === 401) {
    return t(
      "Admin Token 缺失或无效：请在右上角点钥匙按钮，粘贴 Admin Token 后点击“应用”。",
      "Admin Token missing or invalid: click the key button in the top bar, paste the Admin Token and click “Apply”.",
    );
  }
  if (error.status === 429) {
    return t(
      "认证失败次数过多，请稍后再试。",
      "Too many failed authentication attempts. Try again later.",
    );
  }
  if (error.code) {
    const known = approvalCodeMessage(error.code);
    if (known) return known;
  }
  if (error.detail) {
    return t(
      "网关返回 HTTP {status}：{detail}",
      "The gateway returned HTTP {status}: {detail}",
      { status: error.status, detail: error.detail },
    );
  }
  return t(
    "网关返回 HTTP {status}，请检查网关日志。",
    "The gateway returned HTTP {status}; check the gateway logs.",
    { status: error.status },
  );
}
