import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useRegisteredAgents } from "../hooks";
import styles from "./SubsystemWorkListPage.module.css";

/**
 * 采集工作**入口页**：列出机队，每台点进它自己的「采集工作」页。
 *
 * 为什么不在这里直接列出「每台在采什么」：那份事实在每台 agent 手里（它自报的
 * `state/work.json` 子集），一台一次查询 —— 入口页替机队做 N 次请求，机队一大就成了
 * 对网关的扇出。所以这里只做**索引**，清单留在单台页面（那也更符合「一次看一台」的用法）。
 *
 * 机队取的是**已注册**的 Agent（不是“有主机指标的”）：待命/新装的机器不上送指标，
 * 用指标列表会让它们从索引里消失 —— 而那正是最需要进去派活的机器。
 */
export function SubsystemWorkListPage() {
  const agents = useRegisteredAgents();
  const agentIds = useMemo(
    () => (agents.data ?? []).map((agent) => agent.agentId).sort(),
    [agents.data],
  );

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>采集工作</h1>
        <p className={styles.pageSummary}>
          每台 Agent 手上的工作由它自己上报：这一页选一台，进去看它在采哪些文件、手里有哪些常驻工作与一次性工作。授权侧（网关期望它做什么）也在同一页上，两者对照着看。
        </p>
      </header>

      <section className={styles.panel} aria-labelledby="work-fleet-title">
        <header className={styles.panelHead}>
          <h2 className={styles.panelTitle} id="work-fleet-title">
            机队
          </h2>
          <span className={styles.panelHint}>
            {agents.isLoading
              ? "正在读取机队…"
              : `共 ${agentIds.length} 台（已注册的 Agent）`}
          </span>
        </header>

        {agents.isError ? (
          <div className={styles.errorBanner} role="alert">
            读取机队失败：请确认已设置 Admin Token，且网关可用。
          </div>
        ) : null}

        {!agents.isLoading && !agents.isError && agentIds.length === 0 ? (
          <div className={styles.empty}>机队里还没有已注册的 Agent。</div>
        ) : null}

        {agentIds.length > 0 ? (
          <ul className={styles.agentList}>
            {agentIds.map((agentId) => (
              <li key={agentId} className={styles.agentItem}>
                <Link
                  className={styles.agentLink}
                  to={`/agents/${encodeURIComponent(agentId)}/work`}
                >
                  <span className={styles.agentId}>{agentId}</span>
                  <span className={styles.agentAction}>
                    工作清单<span aria-hidden="true">→</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
