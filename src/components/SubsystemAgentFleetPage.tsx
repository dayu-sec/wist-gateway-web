import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api";
import type { AgentListEntryView } from "../api/admin";
import { useDeleteAgent, useRegisteredAgents } from "../hooks";
import styles from "./SubsystemAgentFleetPage.module.css";

/** 读取机队列表失败时的提示。 */
function loadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击“应用”。";
    if (error.status === 429) return "认证失败次数过多，请稍后再试。";
    if (error.status === 404)
      return "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。";
    return error.detail
      ? `网关返回 HTTP ${error.status}：${error.detail}`
      : `网关返回 HTTP ${error.status}，请检查网关日志。`;
  }
  return "读取失败：响应不符合当前契约，请检查网关与前端版本。";
}

/** 删除失败时的提示。409 不是一个「故障」，是「这台现在不能删」，要照实说。 */
function deleteErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击“应用”。";
    if (error.status === 429) return "认证失败次数过多，请稍后再试。";
    if (error.status === 409)
      return "这台 Agent 在线，不能删除；等它离线后再试。";
    // 404 有两种来源，必须分开说：后端“agent 不存在”会带正文，路由根本没挂上时是空正文。
    // 混成一句会让人去查“机器是不是没了”，而真正原因是线上网关还是旧构建。
    if (error.status === 404)
      return error.detail
        ? "没删成：网关找不到这台 Agent（可能刚被删掉）。刷新列表看看。"
        : "没删成（HTTP 404）：网关没有这个删除接口 —— 线上的 gateway 很可能是旧构建，请重新构建并重启网关后重试。";
    return error.detail
      ? `删除失败（HTTP ${error.status}）：${error.detail}`
      : `网关返回 HTTP ${error.status}，请检查网关日志。`;
  }
  return "删除失败：响应不符合当前契约，请检查网关与前端版本。";
}

/**
 * 「Agent 机队」页（路由 `/fleet`）：网关**在册**的 Agent 一览（含离线）+ 删除离线机器。
 *
 * 为什么单独一页、不放「主机指标」：`/hosts` 的数据来自 VictoriaMetrics，只看得到
 * **有指标上报**的机器 —— 离线机器根本不在那份列表里，而这里要处理的正是离线机器。
 * 注册表接口（`GET /api/v1/admin/agents`）才带 `status`（online / offline）。
 *
 * 删除口径：**只允许离线**（在线后端会 409，前端也置灰），且**不可恢复** ——
 * 所以是**两次确认**：点「删除」只是打开确认框，确认框里再点一次「确认删除」才真发请求。
 * 对话框里写清「会连实例、凭据与所有派生态数据一起清掉」，而且不做乐观删除：
 * 成功就刷新列表让那台消失，失败就把原因摆出来（不做「先消失了又冒回来」的假象）。
 */
export function SubsystemAgentFleetPage() {
  const agents = useRegisteredAgents();
  const remove = useDeleteAgent();
  // 两次确认：第一次点「删除」把目标放进来（只开框），第二次点「确认删除」才发请求。
  const [target, setTarget] = useState<AgentListEntryView | null>(null);

  const rows = agents.data ?? [];

  function openConfirm(agent: AgentListEntryView) {
    remove.reset();
    setTarget(agent);
  }

  function closeConfirm() {
    // 正在删就不让关：否则请求还在飞、对话框没了，操作者以为取消了。
    if (remove.isPending) return;
    remove.reset();
    setTarget(null);
  }

  function confirmDelete() {
    if (!target) return;
    remove.mutate(target.agentId, { onSuccess: () => setTarget(null) });
  }

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>Agent 机队</h1>
          <p className={styles.pageSummary}>
            网关在册的 Agent（含离线）。离线机器可以删除 —— 删除不可恢复，会连同它的实例、凭据与所有派生态数据一起清掉，所以要两次确认。
          </p>
        </header>

        {agents.isLoading || agents.isError ? (
          <div className={styles.notices}>
            {agents.isLoading ? (
              <div className={styles.notice} role="status">
                正在读取机队…
              </div>
            ) : null}
            {agents.isError ? (
              <div className={styles.noticeDanger} role="alert">
                {loadErrorMessage(agents.error)}
              </div>
            ) : null}
          </div>
        ) : null}

        {!agents.isLoading && !agents.isError && rows.length === 0 ? (
          <div className={styles.empty}>
            <strong>机队里还没有 Agent</strong>
            <span>
              去「安装 Agent」页获取安装命令；装好并完成注册后就会出现在这里。
            </span>
          </div>
        ) : null}

        {rows.length > 0 ? (
          <section className={styles.card}>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Agent</th>
                    <th scope="col">主机名</th>
                    <th scope="col">IP</th>
                    <th scope="col">版本</th>
                    <th scope="col">状态</th>
                    <th scope="col" className={styles.thAction}>
                      <span className={styles.srOnly}>操作</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const online = row.status === "online";
                    return (
                      <tr key={row.agentId}>
                        <td className={styles.tdAgent}>
                          <Link
                            className={styles.agentLink}
                            to={`/agents/${encodeURIComponent(row.agentId)}/metrics`}
                          >
                            {row.agentId}
                          </Link>
                        </td>
                        <td className={styles.tdMuted}>{row.hostname || "—"}</td>
                        <td className={styles.tdMono}>
                          {row.ipAddresses.length > 0
                            ? row.ipAddresses.join("，")
                            : "—"}
                        </td>
                        <td className={styles.tdMono}>{row.version || "—"}</td>
                        <td>
                          <span
                            className={
                              online
                                ? `${styles.badge} ${styles.badgeOnline}`
                                : `${styles.badge} ${styles.badgeOffline}`
                            }
                          >
                            {online ? "在线" : "离线"}
                          </span>
                        </td>
                        <td className={styles.tdAction}>
                          <button
                            type="button"
                            className={styles.deleteButton}
                            disabled={online}
                            title={
                              online
                                ? "在线 Agent 不能删除 —— 它还在上报，删了下一刻可能又注册回来"
                                : "删除这台离线 Agent（不可恢复）"
                            }
                            onClick={() => openConfirm(row)}
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </main>

      {target ? (
        <div
          className={styles.backdrop}
          role="presentation"
          onClick={closeConfirm}
        >
          <div
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="fleet-delete-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="fleet-delete-title" className={styles.dialogTitle}>
              确认删除这台 Agent？
            </h2>
            <p className={styles.dialogBody}>
              将删除 <code className={styles.code}>{target.agentId}</code>
              ，并连同它的实例、凭据与所有派生态数据一起清掉。
              <strong className={styles.dialogWarn}>此操作不可恢复</strong>
              ；那台机器要重新接入必须重装（会得到一个新的 Agent ID）。
            </p>
            {remove.isError ? (
              <div className={styles.errorBanner} role="alert">
                {deleteErrorMessage(remove.error)}
              </div>
            ) : null}
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={closeConfirm}
                disabled={remove.isPending}
              >
                取消
              </button>
              <button
                type="button"
                className={styles.dangerButton}
                onClick={confirmDelete}
                disabled={remove.isPending}
              >
                {remove.isPending ? "正在删除…" : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
