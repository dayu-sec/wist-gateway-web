import { useState } from "react";
import { ApiError, type AgentCertificateStatusView } from "../api";
import { useLiftAgentRevocation, useRevokeAgent } from "../hooks";
import { t, dateLocale } from "../i18n";
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
      pill: t("已吊销", "Revoked"),
      title: t(
        "这台 Agent 在拒绝名单里 —— 已被立即切断",
        "This agent is on the revocation list — it has been cut off immediately",
      ),
      detail: t(
        "按 agent_id 拒绝：它续签、重签都还是同一个 id，所以过不来。条目留到被吊销证书自然过期为止；确认要恢复就点「解除吊销」，之后它下次请求即可重新接入。",
        "Rejection is by agent_id: renewal and reissue keep the same id, so it cannot get through. The entry stays until the revoked certificate expires naturally; to restore access, click Lift revocation and it can re-enroll on its next request.",
      ),
    };
  }

  if (!status) {
    return {
      tone: "unknown",
      pill: t("未上报", "Not reported"),
      title: t(
        "这台 Agent 还没上报证书状态",
        "This agent has not reported its certificate status yet",
      ),
      detail: t(
        "agentd 是旧版本（不发这个字段）、没配 agent CA，或它还没成功上报过。先确认它在机队视图里「在线」。",
        "agentd may be an older version (it does not send this field), the agent CA may be unconfigured, or it has never reported successfully. First confirm it shows as online in the fleet view.",
      ),
    };
  }

  switch (status.state) {
    case "expired":
      return {
        tone: "crit",
        pill: t("已过期", "Expired"),
        title: t(
          "客户端证书已过期 —— 需带 token 重装",
          "Client certificate expired — reinstall with a token",
        ),
        detail: t(
          "过期由 agent 本地读 notAfter 判定（服务端在握手期就拒，给不出 401）。无宽限：到这台机器上带一次注册 token 重装即可，agent_id 不变。",
          "Expiry is decided locally by the agent reading notAfter (the server rejects during the handshake and cannot return a 401). No grace period: reinstall on this machine once with an enrollment token; agent_id stays the same.",
        ),
      };
    case "renew_due":
      return {
        tone: "warn",
        pill: t("临近到期", "Renewal due"),
        title: t(
          "证书已进入续期窗（剩余 ≤ 30 天）",
          "Certificate entered the renewal window (≤ 30 days left)",
        ),
        detail: t(
          "agentd 应已自己发起续签并留痕。若长期停在这个状态，去这台机器的 agentd 日志看续签结果。",
          "agentd should have started the renewal itself and left a record. If it stays in this state, check the agentd log on this machine for the renewal outcome.",
        ),
      };
    default:
      return {
        tone: "ok",
        pill: t("有效", "Valid"),
        title: t("客户端证书有效", "Client certificate is valid"),
        detail: t(
          "剩余时间充足；续签会在进入 30 天窗口时自动进行。",
          "Plenty of time remains; renewal runs automatically once the 30-day window starts.",
        ),
      };
  }
}

function formatTimestamp(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString(dateLocale(), { hour12: false });
}

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return t("已过期", "Expired");
  const days = Math.floor(seconds / 86_400);
  if (days >= 1) return t("约 {days} 天", "~{days} days", { days });
  const hours = Math.floor(seconds / 3_600);
  if (hours >= 1) return t("约 {hours} 小时", "~{hours} hours", { hours });
  return t("约 {minutes} 分钟", "~{minutes} minutes", {
    minutes: Math.max(1, Math.floor(seconds / 60)),
  });
}

/** 续签结果（与 agentd 本地台账的 `outcome` 同口径）翻成人话。 */
function renewalLabel(outcome: string): string {
  switch (outcome) {
    case "not_due":
      return t("未到续期", "Not due");
    case "renewed":
      return t("已续签", "Renewed");
    case "failed":
      return t("续签失败", "Renewal failed");
    case "needs_reinstall":
      return t("需重装", "Reinstall required");
    case "revoked":
      return t("已吊销", "Revoked");
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
      aria-label={t("Agent 身份与证书", "Agent identity and certificate")}
    >
      <div className={styles.header}>
        <h2 className={styles.title}>{t("身份与证书", "Identity and certificate")}</h2>
        <span className={styles.pill}>{headline.pill}</span>
      </div>

      {loadError ? (
        <p className={styles.error}>{loadError}</p>
      ) : loading ? (
        <p className={styles.muted}>{t("正在读取…", "Loading…")}</p>
      ) : (
        <>
          <p className={styles.headline}>{headline.title}</p>
          <p className={styles.detail}>{headline.detail}</p>

          {certificateStatus ? (
            <dl className={styles.facts}>
              <div className={styles.fact}>
                <dt>{t("状态", "Status")}</dt>
                <dd>{certificateStatus.state}</dd>
              </div>
              <div className={styles.fact}>
                <dt>{t("到期", "Expires")}</dt>
                <dd>{formatTimestamp(certificateStatus.notAfter)}</dd>
              </div>
              <div className={styles.fact}>
                <dt>{t("剩余", "Remaining")}</dt>
                <dd>{formatRemaining(certificateStatus.remainingSeconds)}</dd>
              </div>
              {certificateStatus.lastRenewal ? (
                <div className={styles.fact}>
                  <dt>{t("上次续签", "Last renewal")}</dt>
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
              {t("上次续签：{detail}", "Last renewal: {detail}", {
                detail: certificateStatus.lastRenewal.detail,
              })}
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
                {lift.isPending
                  ? t("解除中…", "Lifting…")
                  : t("解除吊销", "Lift revocation")}
              </button>
            ) : confirmingRevoke ? (
              <>
                <input
                  className={styles.input}
                  value={reason}
                  placeholder={t(
                    "吊销原因（留痕，可空）",
                    "Revocation reason (logged, optional)",
                  )}
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
                  {revoke.isPending
                    ? t("吊销中…", "Revoking…")
                    : t("确认吊销", "Confirm revocation")}
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
                  {t("取消", "Cancel")}
                </button>
              </>
            ) : (
              <button
                type="button"
                className={styles.dangerButton}
                disabled={pending || !agentId}
                onClick={() => setConfirmingRevoke(true)}
              >
                {t("吊销", "Revoke")}
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
      return t(
        "操作与当前状态冲突（HTTP 409）：{detail}",
        "Conflicts with the current state (HTTP 409): {detail}",
        {
          detail:
            error.detail ??
            t("请刷新后按当前状态重试。", "Refresh and retry based on the current state."),
        },
      );
    if (error.status === 404)
      return error.detail
        ? t("目标不存在（HTTP 404）：{detail}", "Target not found (HTTP 404): {detail}", {
            detail: error.detail,
          })
        : t(
            "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。",
            "The gateway has no such endpoint (HTTP 404): the running gateway is likely an old build. Rebuild and restart the gateway, then retry.",
          );
    return error.detail
      ? t("操作失败（HTTP {status}）：{detail}", "Operation failed (HTTP {status}): {detail}", {
          status: error.status,
          detail: error.detail,
        })
      : t(
          "操作失败（HTTP {status}），请检查网关日志。",
          "Operation failed (HTTP {status}); check the gateway logs.",
          { status: error.status },
        );
  }
  return t(
    "操作失败：响应不符合当前契约，请检查网关与前端版本。",
    "Operation failed: the response does not match the current contract. Check the gateway and frontend versions.",
  );
}
