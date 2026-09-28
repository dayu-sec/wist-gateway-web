import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api";
import { useAgentRevocations, useLiftAgentRevocation } from "../hooks";
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
        <h1 className={styles.pageTitle}>吊销名单</h1>
        <p className={styles.pageSummary}>
          按 <span className={styles.mono}>agent_id</span> 拒绝的名单：被吊销的 Agent
          续签、重签都还是同一个 id，所以过不来 —— 这是「停止续签」拦不住私钥泄露的补口。
          条目留到被吊销证书自然过期为止，届时自动清理；要提前恢复就点「解除吊销」，它下一次请求即可重新接入。
        </p>
      </header>

      <section className={styles.panel} aria-labelledby="revocation-list-title">
        <header className={styles.panelHead}>
          <h2 className={styles.panelTitle} id="revocation-list-title">
            在册吊销
          </h2>
          <span className={styles.panelHint}>
            {revocations.isLoading ? "正在读取…" : `共 ${entries.length} 条`}
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
          <div className={styles.empty}>名单为空：当前没有 Agent 被吊销。</div>
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
                        <dt>原因</dt>
                        <dd>{entry.reasonCode || "—"}</dd>
                      </div>
                      <div className={styles.fact}>
                        <dt>吊销人</dt>
                        <dd>{entry.deniedBy || "—"}</dd>
                      </div>
                      <div className={styles.fact}>
                        <dt>吊销于</dt>
                        <dd>{formatTimestamp(entry.deniedAt)}</dd>
                      </div>
                      <div className={styles.fact}>
                        <dt>自动清理于</dt>
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
                            `已解除 ${entry.agentId} 的吊销：它下一次请求即可重新接入。`,
                          ),
                      })
                    }
                  >
                    {lifting ? "解除中…" : "解除吊销"}
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
  return at.toLocaleString("zh-CN", { hour12: false });
}

function loadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击「应用」。";
    if (error.status === 429) return "认证失败次数过多，请稍后再试。";
    if (error.status === 404)
      return "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。";
    return error.detail
      ? `网关返回 HTTP ${error.status}：${error.detail}`
      : `网关返回 HTTP ${error.status}，请检查网关日志。`;
  }
  return "读取吊销名单失败：响应不符合当前契约，请检查网关与前端版本。";
}

function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404)
      return "这台 Agent 已经不在吊销名单里（HTTP 404）：刷新后再看。";
    return error.detail
      ? `解除吊销失败（HTTP ${error.status}）：${error.detail}`
      : `解除吊销失败（HTTP ${error.status}），请检查网关日志。`;
  }
  return "解除吊销失败：响应不符合当前契约，请检查网关与前端版本。";
}
