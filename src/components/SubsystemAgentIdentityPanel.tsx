import { useState } from "react";
import { ApiError, type AgentCertificateStatusView } from "../api";
import { useLiftAgentRevocation, useRevokeAgent } from "../hooks";
import styles from "./SubsystemAgentIdentityPanel.module.css";

interface SubsystemAgentIdentityPanelProps {
  agentId: string;
  certificateStatus: AgentCertificateStatusView | null;
  revoked: boolean;
  loading?: boolean;
  loadError?: string | null;
}

type Tone = "ok" | "warn" | "crit" | "unknown";

interface Headline {
  tone: Tone;
  pill: string;
  title: string;
  detail: string;
}

/**
 * 把「证书状态 + 是否被吊销」翻成一句人话。
 *
 * 为什么要在页面上说清楚（§5.5 / §5.6）：
 *   * 未上报 —— 旧版本 agentd，或还没成功上报过；
 *   * 有效 —— 一切正常；
 *   * 临近到期（`renew_due`）—— 已进入 30 天续期窗，agentd 应**自己续签**；
 *   * 已过期 —— rustls 握手期就拒，只能**带 token 重装**；
 *   * 被吊销 —— 在拒绝名单里，任何凭据路径都被 401 `certificate_revoked`，**续签也过不来**。
 */
function describe(
  status: AgentCertificateStatusView | null,
  revoked: boolean,
): Headline {
  if (revoked) {
    return {
      tone: "crit",
      pill: "已吊销",
      title: "这台 Agent 在拒绝名单里 —— 已被立即切断",
      detail:
        "按 agent_id 拒绝：它续签、重签都还是同一个 id，所以过不来。条目留到被吊销证书自然过期为止；确认要恢复就点「解除吊销」，之后它下次请求即可重新接入。",
    };
  }

  if (!status) {
    return {
      tone: "unknown",
      pill: "未上报",
      title: "这台 Agent 还没上报证书状态",
      detail:
        "agentd 是旧版本（不发这个字段）、没配 agent CA，或它还没成功上报过。先确认它在机队视图里「在线」。",
    };
  }

  switch (status.state) {
    case "expired":
      return {
        tone: "crit",
        pill: "已过期",
        title: "客户端证书已过期 —— 需带 token 重装",
        detail:
          "过期由 agent 本地读 notAfter 判定（服务端在握手期就拒，给不出 401）。无宽限：到这台机器上带一次注册 token 重装即可，agent_id 不变。",
      };
    case "renew_due":
      return {
        tone: "warn",
        pill: "临近到期",
        title: "证书已进入续期窗（剩余 ≤ 30 天）",
        detail:
          "agentd 应已自己发起续签并留痕。若长期停在这个状态，去这台机器的 agentd 日志看续签结果。",
      };
    default:
      return {
        tone: "ok",
        pill: "有效",
        title: "客户端证书有效",
        detail: "剩余时间充足；续签会在进入 30 天窗口时自动进行。",
      };
  }
}

function formatTimestamp(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString("zh-CN", { hour12: false });
}

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return "已过期";
  const days = Math.floor(seconds / 86_400);
  if (days >= 1) return `约 ${days} 天`;
  const hours = Math.floor(seconds / 3_600);
  if (hours >= 1) return `约 ${hours} 小时`;
  return `约 ${Math.max(1, Math.floor(seconds / 60))} 分钟`;
}

/** 续签结果（与 agentd 本地台账的 `outcome` 同口径）翻成人话。 */
function renewalLabel(outcome: string): string {
  switch (outcome) {
    case "not_due":
      return "未到续期";
    case "renewed":
      return "已续签";
    case "failed":
      return "续签失败";
    case "needs_reinstall":
      return "需重装";
    case "revoked":
      return "已吊销";
    default:
      return outcome;
  }
}

/**
 * Agent 身份面板（工作页顶部，与数据面上送面板并列）。
 *
 * 取 `GET /api/v1/admin/agents/{agent_id}/runtime-status` 的 `certificate_status` /
 * `revoked`，并在这里直接提供**吊销 / 解除吊销**入口（§5.6）—— 「看得到才能控制」。
 */
export function SubsystemAgentIdentityPanel({
  agentId,
  certificateStatus,
  revoked,
  loading = false,
  loadError = null,
}: SubsystemAgentIdentityPanelProps) {
  const headline = describe(certificateStatus, revoked);
  const revoke = useRevokeAgent();
  const lift = useLiftAgentRevocation();
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [reason, setReason] = useState("");

  const pending = revoke.isPending || lift.isPending;
  const actionError = revoke.error ?? lift.error ?? null;

  return (
    <section
      className={`${styles.container} ${styles[headline.tone]}`}
      aria-label="Agent 身份与证书"
    >
      <div className={styles.header}>
        <h2 className={styles.title}>身份与证书</h2>
        <span className={styles.pill}>{headline.pill}</span>
      </div>

      {loadError ? (
        <p className={styles.error}>{loadError}</p>
      ) : loading ? (
        <p className={styles.muted}>正在读取…</p>
      ) : (
        <>
          <p className={styles.headline}>{headline.title}</p>
          <p className={styles.detail}>{headline.detail}</p>

          {certificateStatus ? (
            <dl className={styles.facts}>
              <div className={styles.fact}>
                <dt>状态</dt>
                <dd>{certificateStatus.state}</dd>
              </div>
              <div className={styles.fact}>
                <dt>到期</dt>
                <dd>{formatTimestamp(certificateStatus.notAfter)}</dd>
              </div>
              <div className={styles.fact}>
                <dt>剩余</dt>
                <dd>{formatRemaining(certificateStatus.remainingSeconds)}</dd>
              </div>
              {certificateStatus.lastRenewal ? (
                <div className={styles.fact}>
                  <dt>上次续签</dt>
                  <dd>
                    {renewalLabel(certificateStatus.lastRenewal.outcome)} ·{" "}
                    {formatTimestamp(certificateStatus.lastRenewal.checkedAt)}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          {certificateStatus?.lastRenewal?.detail ? (
            <p className={styles.detail}>
              上次续签：{certificateStatus.lastRenewal.detail}
            </p>
          ) : null}

          {actionError ? (
            <p className={styles.error}>{actionErrorMessage(actionError)}</p>
          ) : null}

          <div className={styles.actions}>
            {revoked ? (
              <button
                type="button"
                className={styles.primaryButton}
                disabled={pending || !agentId}
                onClick={() => lift.mutate(agentId)}
              >
                {lift.isPending ? "解除中…" : "解除吊销"}
              </button>
            ) : confirmingRevoke ? (
              <>
                <input
                  className={styles.input}
                  value={reason}
                  placeholder="吊销原因（留痕，可空）"
                  disabled={pending}
                  onChange={(event) => setReason(event.target.value)}
                />
                <button
                  type="button"
                  className={styles.dangerButton}
                  disabled={pending || !agentId}
                  onClick={() =>
                    revoke.mutate(
                      { agentId, reasonCode: reason.trim() },
                      {
                        onSuccess: () => {
                          setConfirmingRevoke(false);
                          setReason("");
                        },
                      },
                    )
                  }
                >
                  {revoke.isPending ? "吊销中…" : "确认吊销"}
                </button>
                <button
                  type="button"
                  className={styles.ghostButton}
                  disabled={pending}
                  onClick={() => {
                    setConfirmingRevoke(false);
                    setReason("");
                  }}
                >
                  取消
                </button>
              </>
            ) : (
              <button
                type="button"
                className={styles.dangerButton}
                disabled={pending || !agentId}
                onClick={() => setConfirmingRevoke(true)}
              >
                吊销
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409)
      return `操作与当前状态冲突（HTTP 409）：${error.detail ?? "请刷新后按当前状态重试。"}`;
    if (error.status === 404)
      return error.detail
        ? `目标不存在（HTTP 404）：${error.detail}`
        : "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。";
    return error.detail
      ? `操作失败（HTTP ${error.status}）：${error.detail}`
      : `操作失败（HTTP ${error.status}），请检查网关日志。`;
  }
  return "操作失败：响应不符合当前契约，请检查网关与前端版本。";
}
