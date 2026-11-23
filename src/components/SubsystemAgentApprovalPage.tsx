import { Fragment, useMemo, useState } from "react";
import { ApiError } from "../api";
import { useActionApprovals } from "../hooks";
import { dateLocale, t } from "../i18n";
import { describeApprovalError } from "../lib/approvalError";
import {
  APPROVAL_TABS,
  approvedCount,
  matchesTab,
  shortDigest,
  type ApprovalTab,
} from "../lib/approvalState";
import styles from "./SubsystemAgentApprovalPage.module.css";
import { ApproverInstallHint } from "./ApproverInstallHint";
import { ApproverKeysSection } from "./ApproverKeysSection";

/**
 * 「响应审批」页（路由 `/approvals`）：把「这台机器上可以做什么」的**决策**摊开。
 *
 * **本页是只读的**（外部签发之后）：投票与签名都在审批人的机器上用 `wist-approve` 完成。
 * 页面存在的理由变成三个：
 *
 * 1. **看得见**：谁在申请、批的是什么（摘要 + 理由）、够不够人、签没签；
 * 2. **给得出命令**：每一行直接给出下一步该敲的命令（带真实审批单号）；
 * 3. **管得住信任锚**：登记 / 吊销审批公钥，并把指纹显示出来供人核对。
 *
 * 为什么不在页面上留「通过 / 签发」按钮：私钥在客户手上，浏览器的页面由我们运维的网关提供，
 * 留着按钮只会让人以为「点一下就等于签了」。两条审批路径必然有一条会漂。
 * 设计：`docs/design/plan-external-signing.md` §7。
 *
 * 只做决策面，不发起：构造一份 `ActionPlan` 属于「响应发起」流程，不在这一页。
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

  const [tab, setTab] = useState<ApprovalTab>("pending");

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

  const currentHint = tabCopy[tab].hint;

  /** 给这一行算出「下一步该敲什么」。签发只能由审批机发起（页面没有私钥）。 */
  function nextStepCommand(approval: {
    approvalId: string;
    status: string;
    issued: boolean;
  }): string | null {
    if (approval.issued) return null;
    if (approval.status === "pending") {
      return `wist-approve approve ${approval.approvalId}`;
    }
    if (approval.status === "approved") {
      return `wist-approve sign ${approval.approvalId} --key <审批私钥>`;
    }
    return null;
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
            "本页只读：投票与签名都在审批人的机器上用 wist-approve 完成（私钥不在网关）。每一行给出了可直接执行的命令；页面底部是「怎么装这个 CLI」和「登记/吊销审批公钥」。",
            "This page is read-only: voting and signing happen on the approver's machine with wist-approve (the gateway holds no private key). Each row shows the exact command to run; at the bottom you can install the CLI and register or revoke approver keys.",
          )}
        </p>

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
                <th scope="col">{t("下一步", "Next step")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((approval) => {
                const command = nextStepCommand(approval);
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
                        {command ? (
                          <code className={styles.command}>{command}</code>
                        ) : (
                          <span className={styles.muted}>—</span>
                        )}
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
                          {approval.status === "pending" &&
                          !approval.issued ? (
                            <span className={styles.detailItem}>
                              <span className={styles.detailKey}>
                                {t("驳回", "Reject")}
                              </span>
                              <code className={styles.command}>
                                {`wist-approve reject ${approval.approvalId}`}
                              </code>
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
        {/* 顺序就是实际流程：装 CLI → 生成钥匙 → 登记公钥（下方区块）。 */}
        <ApproverInstallHint />
        <ApproverKeysSection />
      </main>
    </div>
  );
}
