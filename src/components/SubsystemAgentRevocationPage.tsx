import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api";
import { useAgentRevocations, useLiftAgentRevocation } from "../hooks";
import { t, dateLocale } from "../i18n";
import styles from "./SubsystemAgentRevocationPage.module.css";

/**
 * 吊销名单（拒绝名单）列表页。
 *
 * 单台页面上的「吊销 / 解除吊销」是**点上的控制**；这一页回答**面上的问题** ——
 * 「我给哪些机器下过封锁、为什么、什么时候到期自动清」。两者看的是同一份状态
 * （`GET /api/v1/admin/agent-revocations` ↔ 运行态的 `revoked` 布尔）。
 */
export function SubsystemAgentRevocationPage() {
  const revocations = useAgentRevocations();
  const lift = useLiftAgentRevocation();
  const [notice, setNotice] = useState<string | null>(null);

  const entries = revocations.data ?? [];

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t("吊销名单", "Revocations")}</h1>
        <p className={styles.pageSummary}>
          {t("按 ", "Revocations by ")}
          <span className={styles.mono}>agent_id</span>
          {t(
            " 拒绝的名单：被吊销的 Agent 续签、重签都还是同一个 id，所以过不来 —— 这是「停止续签」拦不住私钥泄露的补口。条目留到被吊销证书自然过期为止，届时自动清理；要提前恢复就点「解除吊销」，它下一次请求即可重新接入。",
            ": a revoked Agent keeps the same id when it renews or re-enrolls, so it cannot get through — this covers the case where \"stop renewing\" cannot stop a leaked private key. Entries stay until the revoked certificate expires naturally and are cleaned up automatically then; to restore earlier, click Lift revocation and it can enroll again on its next request.",
          )}
        </p>
      </header>

      <section className={styles.panel} aria-labelledby="revocation-list-title">
        <header className={styles.panelHead}>
          <h2 className={styles.panelTitle} id="revocation-list-title">
            {t("在册吊销", "Revocations on record")}
          </h2>
          <span className={styles.panelHint}>
            {revocations.isLoading
              ? t("正在读取…", "Reading…")
              : t("共 {n} 条", "{n} in total", { n: entries.length })}
          </span>
        </header>

        {revocations.isError ? (
          <div className={styles.errorBanner} role="alert">
            {loadErrorMessage(revocations.error)}
          </div>
        ) : null}
        {lift.error ? (
          <div className={styles.errorBanner} role="alert">
            {actionErrorMessage(lift.error)}
          </div>
        ) : null}
        {notice ? (
          <div className={styles.noticeBanner} role="status">
            {notice}
          </div>
        ) : null}

        {!revocations.isLoading && !revocations.isError && entries.length === 0 ? (
          <div className={styles.empty}>
            {t("名单为空：当前没有 Agent 被吊销。", "The list is empty: no Agent is currently revoked.")}
          </div>
        ) : null}

        {entries.length > 0 ? (
          <ul className={styles.list}>
            {entries.map((entry) => {
              const lifting = lift.isPending && lift.variables === entry.agentId;
              return (
                <li key={entry.entryId} className={styles.item}>
                  <div className={styles.itemMain}>
                    <Link
                      className={styles.agentId}
                      to={`/agents/${encodeURIComponent(entry.agentId)}/work`}
                    >
                      {entry.agentId}
                    </Link>
                    <dl className={styles.facts}>
                      <div className={styles.fact}>
                        <dt>{t("原因", "Reason")}</dt>
                        <dd>{entry.reasonCode || "—"}</dd>
                      </div>
                      <div className={styles.fact}>
                        <dt>{t("吊销人", "Revoked by")}</dt>
                        <dd>{entry.deniedBy || "—"}</dd>
                      </div>
                      <div className={styles.fact}>
                        <dt>{t("吊销于", "Revoked at")}</dt>
                        <dd>{formatTimestamp(entry.deniedAt)}</dd>
                      </div>
                      <div className={styles.fact}>
                        <dt>{t("自动清理于", "Auto-cleaned at")}</dt>
                        <dd>{formatTimestamp(entry.retainUntil)}</dd>
                      </div>
                    </dl>
                  </div>
                  <button
                    type="button"
                    className={styles.liftButton}
                    disabled={lift.isPending}
                    onClick={() =>
                      lift.mutate(entry.agentId, {
                        onSuccess: () =>
                          setNotice(
                            t(
                              "已解除 {agentId} 的吊销：它下一次请求即可重新接入。",
                              "Lifted the revocation of {agentId}: it can enroll again on its next request.",
                              { agentId: entry.agentId },
                            ),
                          ),
                      })
                    }
                  >
                    {lifting
                      ? t("解除中…", "Lifting…")
                      : t("解除吊销", "Lift revocation")}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

function formatTimestamp(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString(dateLocale(), { hour12: false });
}

function loadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return t(
        "Admin Token 缺失或无效：请在右上角点钥匙按钮，粘贴 Admin Token 后点击「应用」。",
        "Admin Token missing or invalid: click the key button in the top bar, paste the Admin Token and click \"Apply\".",
      );
    if (error.status === 429)
      return t("认证失败次数过多，请稍后再试。", "Too many failed authentication attempts. Try again later.");
    if (error.status === 404)
      return t(
        "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。",
        "The gateway has no such endpoint (HTTP 404): the running gateway is most likely an old build. Rebuild and restart the gateway, then retry.",
      );
    return error.detail
      ? t("网关返回 HTTP {status}：{detail}", "The gateway returned HTTP {status}: {detail}", {
          status: error.status,
          detail: error.detail,
        })
      : t("网关返回 HTTP {status}，请检查网关日志。", "The gateway returned HTTP {status}. Check the gateway logs.", {
          status: error.status,
        });
  }
  return t(
    "读取吊销名单失败：响应不符合当前契约，请检查网关与前端版本。",
    "Reading the revocation list failed: the response does not match the current contract. Check the gateway and frontend versions.",
  );
}

function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404)
      return t(
        "这台 Agent 已经不在吊销名单里（HTTP 404）：刷新后再看。",
        "This Agent is no longer on the revocation list (HTTP 404). Refresh and check again.",
      );
    return error.detail
      ? t(
          "解除吊销失败（HTTP {status}）：{detail}",
          "Lifting the revocation failed (HTTP {status}): {detail}",
          { status: error.status, detail: error.detail },
        )
      : t(
          "解除吊销失败（HTTP {status}），请检查网关日志。",
          "Lifting the revocation failed (HTTP {status}). Check the gateway logs.",
          { status: error.status },
        );
  }
  return t(
    "解除吊销失败：响应不符合当前契约，请检查网关与前端版本。",
    "Lifting the revocation failed: the response does not match the current contract. Check the gateway and frontend versions.",
  );
}
