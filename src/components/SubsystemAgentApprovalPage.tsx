import { Fragment, useMemo, useState } from "react";
import { ApiError } from "../api";
import {
  useActionApprovals,
  useIssueActionApproval,
  useVoteActionApproval,
} from "../hooks";
import { dateLocale, t } from "../i18n";
import { describeApprovalError } from "../lib/approvalError";
import {
  APPROVAL_TABS,
  allowedActions,
  approvedCount,
  matchesTab,
  shortDigest,
  type ApprovalTab,
} from "../lib/approvalState";
import styles from "./SubsystemAgentApprovalPage.module.css";

/**
 * 「响应审批」页（路由 `/approvals`）：把「这台机器上可以做什么」的**决策**摊开。
 *
 * 为什么需要这一页：审批链路的后端端点（创建 / 投票 / 签发）先落地了，但只有 curl 能用 ——
 * 对最终用户来说，「功能存在」与「功能不可用」没有区别。这一页给的是最小可用的决策面：
 * 谁在申请、批的是什么（摘要 + 理由）、够不够人、批完没有。
 *
 * 三条刻意写进界面的语义：
 *
 * 1. **审批绑的是计划内容摘要**（`plan_digest`），不是 `action_id`：批的是「这一份」。
 *    所以签发时内容被改过会被网关拒（`plan_changed_since_approval`），此时只能重新走审批。
 * 2. **投票人来自登录凭据**（Admin Token 的指纹），客户端不能填别人的名字。同一人再投是
 *    **覆盖**，不是加一票 —— 界面上「票数」是人的个数。
 * 3. **`approved` 与 `issued` 是两件事**：批够了只是「可以签」，签了才会真正下发到机器。
 *    签发不可撤回，所以按钮要二次确认。
 *
 * 只做决策，不发起：构造一份 `ActionPlan` 属于「响应发起」流程，不在这一页。
 */

interface TabSpec {
  label: string;
  hint: string;
}

/**
 * tab 的文案表。
 *
 * 写成**函数**是因为 `t()` 必须在渲染期求值（切语言才会变）；用
 * `Record<ApprovalTab, …>` 是因为 tab 列表的事实来源在 `lib/approvalState` ——
 * 新增一个 tab 时 TS 会在这里强制补文案，不会出现「tab 出现了、提示是空的」。
 */
function approvalTabCopy(): Record<ApprovalTab, TabSpec> {
  return {
    pending: {
      label: t("待审批", "Pending"),
      hint: t(
        "还没批够人的计划。通过 / 驳回都在这一档处理。",
        "Plans that do not have enough approvals yet. Approve or reject them here.",
      ),
    },
    approved: {
      label: t("已批准", "Approved"),
      hint: t(
        "票够了，可以签发。签发会把计划下发到目标机器（不可撤回）。",
        "Enough votes; ready to sign. Signing dispatches the plan to the target machine (irreversible).",
      ),
    },
    all: {
      label: t("全部", "All"),
      hint: t(
        "含被驳回 / 已过期的单子 —— 它们不会再被执行，留在这里只为审计。",
        "Includes rejected / expired requests — they will never run; kept here for audit only.",
      ),
    },
  };
}

function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return t("待审批", "Pending");
    case "approved":
      return t("已批准", "Approved");
    case "rejected":
      return t("已驳回", "Rejected");
    case "expired":
      return t("已过期", "Expired");
    default:
      return status;
  }
}

function statusTone(status: string): string {
  switch (status) {
    case "pending":
      return styles.tonePending;
    case "approved":
      return styles.toneApproved;
    case "rejected":
      return styles.toneRejected;
    default:
      return styles.toneNeutral;
  }
}

/** 绝对时刻（表格里给可核对的时间，相对时长对这个页面没有决策价值）。 */
function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(dateLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

/** 把 react-query 抛出来的东西收敛成 `describeApprovalError` 的三字段输入。 */
function approvalErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return describeApprovalError({
      status: error.status,
      code: error.code,
      detail: error.detail,
    });
  }
  // 不是 HTTP 错误 = 响应结构不符合契约（或本地解析失败）。
  return describeApprovalError(null);
}

export function SubsystemAgentApprovalPage() {
  const query = useActionApprovals();
  const vote = useVoteActionApproval();
  const issue = useIssueActionApproval();

  const [tab, setTab] = useState<ApprovalTab>("pending");
  // 二次确认只给**不可撤回**的动作：通过（approved 之后不能再改票）与签发（会下发到机器）。
  //
  // 只留一个槽位是**刻意**的：任何时刻全局最多一行处于「等你确认」的状态。这样
  // 不会出现两行同时亮着红色确认按钮、点错行的机会；确认后立刻 dismiss。
  const [confirming, setConfirming] = useState<{
    id: string;
    action: "approve" | "issue";
  } | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const tabCopy = approvalTabCopy();
  const approvals = query.data ?? [];

  // 计数从 `APPROVAL_TABS` 生成：与 tab 列表同一来源，加 tab 时不会漏掉计数。
  const counts = useMemo(() => {
    const result = {} as Record<ApprovalTab, number>;
    for (const key of APPROVAL_TABS) {
      result[key] = approvals.filter((item) => matchesTab(item, key)).length;
    }
    return result;
  }, [approvals]);

  const visible = useMemo(
    () => approvals.filter((item) => matchesTab(item, tab)),
    [approvals, tab],
  );

  const actionError = vote.error ?? issue.error;
  // 全局串行：一次只能有一个动作在飞。审批是低频、单管理员场景，串行换来的是
  // 「点了哪个、哪条在跑」永远清晰，也让 `actionError` 不会同时挂着两个错误。
  const busy = vote.isPending || issue.isPending;
  const currentHint = tabCopy[tab].hint;

  function isConfirming(id: string, action: "approve" | "issue"): boolean {
    return confirming?.id === id && confirming.action === action;
  }

  /**
   * 发起一次动作前清掉**另一个** mutation 的错误。
   *
   * `actionError` 取 `vote.error ?? issue.error`，而两个 mutation 的 `error` 会一直留到
   * 下一次同类 mutate / reset 才清。不在这里互清，就会出现「刚才投票 409 → 接着签发成功 →
   * 顶部红条还在讲投票」的串台。
   */
  function startVote(
    id: string,
    decision: "approve" | "reject",
    comment?: string,
    onSuccess?: () => void,
  ) {
    if (busy) return;
    issue.reset();
    vote.mutate({ approvalId: id, decision, comment }, { onSuccess });
  }

  function submitApprove(id: string) {
    if (busy) return;
    setConfirming(null);
    startVote(id, "approve");
  }

  function submitReject(id: string) {
    // 表单与理由**成功后才收起**：失败（409 单子刚被别人处理 / 网络断）时保留草稿，
    // 否则用户写完的理由被清空，得凭记忆重打一遍。
    startVote(id, "reject", rejectReason, () => {
      setRejecting(null);
      setRejectReason("");
    });
  }

  function submitIssue(id: string) {
    if (busy) return;
    setConfirming(null);
    vote.reset();
    issue.mutate(id);
  }

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>
            {t("响应审批", "Action approvals")}
          </h1>
          <p className={styles.pageSummary}>
            {t(
              "一次「响应」的控制面链路：提交计划 → 审批 → 签发 → 下发。审批绑的是计划内容摘要，批的是这一份；签发之后计划才会真正到达机器，并可由机器本地验签。",
              "The control-plane path of one response: submit plan → approve → sign → dispatch. Approval is bound to the plan digest (this exact content); only after signing does the plan reach the machine, where it is verified locally.",
            )}
          </p>
        </header>

        <p className={styles.note}>
          {t(
            "投票人身份由 Admin Token 决定，不能代填；同一人再投是覆盖，不是加一票。当前网关只有单一 Admin Token，因此需要两名审批人的 R3 计划无法在这里走完（会提示不支持）。",
            "The approver identity comes from the Admin Token and cannot be typed in; re-voting by the same person overwrites, it does not add a vote. This gateway has a single Admin Token, so R3 plans that need two approvers cannot be completed here (you will see an unsupported error).",
          )}
        </p>

        {actionError ? (
          <p className={styles.errorBanner} role="alert">
            {approvalErrorMessage(actionError)}
          </p>
        ) : null}

        <div className={styles.tabs}>
          {APPROVAL_TABS.map((tabKey) => {
            const active = tabKey === tab;
            return (
              <button
                key={tabKey}
                type="button"
                aria-pressed={active}
                className={
                  active ? `${styles.tab} ${styles.tabActive}` : styles.tab
                }
                onClick={() => {
                  setTab(tabKey);
                  // 上一档的操作错误不跟着跑：否则切过来先看到一条与自己无关的红条。
                  vote.reset();
                  issue.reset();
                }}
              >
                {tabCopy[tabKey].label}
                <span className={styles.tabCount}>{counts[tabKey]}</span>
              </button>
            );
          })}
        </div>
        <p className={styles.tabHint}>{currentHint}</p>

        {query.isError ? (
          // 读取失败时不再往下渲染空态：“加载失败”与“这里没有审批单”同时出现，
          // 会让人以为“真的没有待批”。
          <p className={styles.errorBanner} role="alert">
            {approvalErrorMessage(query.error)}
          </p>
        ) : query.isLoading ? (
          <p className={styles.empty}>
            {t("正在读取审批单…", "Loading approvals…")}
          </p>
        ) : visible.length === 0 ? (
          <div className={styles.empty}>
            <strong>{t("这里没有审批单", "No approvals here")}</strong>
            <span>
              {tab === "pending"
                ? t(
                    "没有等着批的计划。需要处置机器时，由响应发起流程提交计划后才会出现在这里。",
                    "No plan is waiting for approval. Plans appear here only after the response flow submits them.",
                  )
                : t(
                    "这一档暂时为空。切换上面的标签看看其它状态。",
                    "Nothing in this tab. Switch to another tab to see other states.",
                  )}
            </span>
          </div>
        ) : (
          <table
            className={styles.table}
            aria-label={t("审批单列表", "Approval requests")}
            // 轮询刷新时告诉读屏器“内容在变”，而不是静默替换掉正在读的行。
            aria-busy={query.isFetching}
          >
            <thead>
              <tr>
                <th scope="col">{t("机器", "Agent")}</th>
                <th scope="col">{t("风险", "Risk")}</th>
                <th scope="col">{t("状态", "Status")}</th>
                <th scope="col">{t("票数", "Votes")}</th>
                <th scope="col">{t("申请时间", "Requested")}</th>
                <th scope="col">{t("过期时间", "Expires")}</th>
                <th scope="col">{t("理由", "Reason")}</th>
                <th scope="col">{t("操作", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((approval) => {
                const actions = allowedActions(approval);
                // 读屏器在「操作」列里听不到是哪一行；把机器名拼进按钮名，悬停/朗读才能
                // 区分“通过哪一台”。视觉上不变（表格行本来就在同一行）。
                const rowLabel = (label: string) =>
                  `${label} · ${approval.agentId}`;
                return (
                  <Fragment key={approval.approvalId}>
                    <tr>
                      <td className={styles.mono}>{approval.agentId}</td>
                      <td>
                        <span className={styles.riskBadge}>
                          {approval.riskLevel}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`${styles.badge} ${statusTone(approval.status)}`}
                        >
                          {statusLabel(approval.status)}
                        </span>
                        {approval.issued ? (
                          <span
                            className={`${styles.badge} ${styles.toneIssued}`}
                          >
                            {t("已签发", "Signed")}
                          </span>
                        ) : null}
                      </td>
                      <td className={styles.mono}>
                        {approvedCount(approval.votes)}/
                        {approval.requiredApprovers}
                      </td>
                      <td title={approval.requestedAt}>
                        {formatTimestamp(approval.requestedAt)}
                      </td>
                      <td title={approval.expiresAt}>
                        {formatTimestamp(approval.expiresAt)}
                      </td>
                      <td
                        className={styles.reason}
                        title={approval.reason ?? ""}
                        // 列宽有限会截断长理由；可聚焦 + 全值标签，让键盘/读屏也能拿到全文。
                        tabIndex={approval.reason ? 0 : undefined}
                        aria-label={approval.reason ?? undefined}
                      >
                        {approval.reason ?? "—"}
                      </td>
                      <td className={styles.actions}>
                        {actions.canApprove ? (
                          isConfirming(approval.approvalId, "approve") ? (
                            <>
                              <button
                                type="button"
                                className={styles.primary}
                                disabled={busy}
                                aria-label={rowLabel(
                                  t("确认通过", "Confirm approve"),
                                )}
                                onClick={() =>
                                  submitApprove(approval.approvalId)
                                }
                              >
                                {t("确认通过", "Confirm approve")}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setConfirming(null)}
                              >
                                {t("取消", "Cancel")}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className={styles.primary}
                              disabled={busy}
                              aria-label={rowLabel(t("通过", "Approve"))}
                              onClick={() =>
                                setConfirming({
                                  id: approval.approvalId,
                                  action: "approve",
                                })
                              }
                            >
                              {t("通过", "Approve")}
                            </button>
                          )
                        ) : null}
                        {actions.canReject ? (
                          <button
                            type="button"
                            className={styles.danger}
                            disabled={busy}
                            aria-label={rowLabel(t("驳回", "Reject"))}
                            onClick={() => {
                              setRejecting(approval.approvalId);
                              setRejectReason("");
                            }}
                          >
                            {t("驳回", "Reject")}
                          </button>
                        ) : null}
                        {actions.canIssue ? (
                          isConfirming(approval.approvalId, "issue") ? (
                            <>
                              <button
                                type="button"
                                className={styles.primary}
                                disabled={busy}
                                aria-label={rowLabel(
                                  t(
                                    "确认签发并下发",
                                    "Confirm sign & dispatch",
                                  ),
                                )}
                                onClick={() => submitIssue(approval.approvalId)}
                              >
                                {t("确认签发并下发", "Confirm sign & dispatch")}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setConfirming(null)}
                              >
                                {t("取消", "Cancel")}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className={styles.primary}
                              disabled={busy}
                              aria-label={rowLabel(
                                t("签发并下发", "Sign & dispatch"),
                              )}
                              onClick={() =>
                                setConfirming({
                                  id: approval.approvalId,
                                  action: "issue",
                                })
                              }
                            >
                              {t("签发并下发", "Sign & dispatch")}
                            </button>
                          )
                        ) : null}
                        {!actions.canApprove &&
                        !actions.canReject &&
                        !actions.canIssue ? (
                          <span className={styles.muted}>—</span>
                        ) : null}
                      </td>
                    </tr>
                    <tr className={styles.detailRow}>
                      <td colSpan={8}>
                        <div className={styles.detail}>
                          <span className={styles.detailItem}>
                            <span className={styles.detailKey}>
                              {t("审批单", "Approval")}
                            </span>
                            <span className={styles.mono}>
                              {approval.approvalId}
                            </span>
                          </span>
                          <span className={styles.detailItem}>
                            <span className={styles.detailKey}>
                              {t("计划摘要", "Plan digest")}
                            </span>
                            {/*
                              行内只露短摘要：完整值是 64 位 hex，摆在这行虽有空间，但会把
                              其余几项挤到换行。`title` 只对鼠标有效，键盘用户得不到，
                              所以补上 `tabIndex`（可聚焦）+ `aria-label`（读屏器念全值）。
                            */}
                            <span
                              className={styles.mono}
                              title={approval.planDigest}
                              tabIndex={0}
                              aria-label={t(
                                "计划摘要 {digest}",
                                "Plan digest {digest}",
                                { digest: approval.planDigest },
                              )}
                            >
                              {shortDigest(approval.planDigest)}
                            </span>
                          </span>
                          <span className={styles.detailItem}>
                            <span className={styles.detailKey}>
                              {t("申请人", "Requested by")}
                            </span>
                            <span className={styles.mono}>
                              {approval.requestedBy}
                            </span>
                          </span>
                          {approval.votes.length > 0 ? (
                            <span className={styles.detailItem}>
                              <span className={styles.detailKey}>
                                {t("投票", "Votes")}
                              </span>
                              <span>
                                {approval.votes
                                  .map(
                                    (vote) =>
                                      `${vote.approver} ${
                                        vote.decision === "approve"
                                          ? t("通过", "approve")
                                          : t("驳回", "reject")
                                      }`,
                                  )
                                  .join(" · ")}
                              </span>
                            </span>
                          ) : null}
                        </div>
                        {rejecting === approval.approvalId ? (
                          <div className={styles.rejectForm}>
                            <label htmlFor={`reject-${approval.approvalId}`}>
                              {t(
                                "驳回理由（可选）",
                                "Rejection reason (optional)",
                              )}
                            </label>
                            <textarea
                              id={`reject-${approval.approvalId}`}
                              className={styles.textarea}
                              rows={2}
                              value={rejectReason}
                              maxLength={500}
                              // 表单是用户刚点出来的，焦点落到理由框：键盘用户不用再 Tab 一次。
                              autoFocus
                              onChange={(event) =>
                                setRejectReason(event.target.value)
                              }
                            />
                            <div className={styles.rejectActions}>
                              <button
                                type="button"
                                className={styles.danger}
                                disabled={busy}
                                onClick={() =>
                                  submitReject(approval.approvalId)
                                }
                              >
                                {t("确认驳回", "Confirm reject")}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setRejecting(null);
                                  setRejectReason("");
                                }}
                              >
                                {t("取消", "Cancel")}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
