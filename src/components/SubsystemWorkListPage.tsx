import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useRegisteredAgents } from "../hooks";
import { t } from "../i18n";
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
        <h1 className={styles.pageTitle}>{t("采集工作", "Collection work")}</h1>
        <p className={styles.pageSummary}>
          {t(
            "每台 Agent 手上的工作由它自己上报：这一页选一台，进去看它在采哪些文件、手里有哪些常驻工作与一次性工作。授权侧（网关期望它做什么）也在同一页上，两者对照着看。",
            "Each Agent reports the work it holds itself: pick one on this page to see which files it collects and which standing and one-shot work it holds. The grant side (what the gateway expects it to do) is on the same page, so the two can be compared.",
          )}
        </p>
      </header>

      <section className={styles.panel} aria-labelledby="work-fleet-title">
        <header className={styles.panelHead}>
          <h2 className={styles.panelTitle} id="work-fleet-title">
            {t("机队", "Fleet")}
          </h2>
          <span className={styles.panelHint}>
            {agents.isLoading
              ? t("正在读取机队…", "Reading fleet…")
              : t("共 {n} 台（已注册的 Agent）", "{n} machines (registered Agents)", {
                  n: agentIds.length,
                })}
          </span>
        </header>

        {agents.isError ? (
          <div className={styles.errorBanner} role="alert">
            {t(
              "读取机队失败：请确认已设置 Admin Token，且网关可用。",
              "Reading the fleet failed: make sure the Admin Token is set and the gateway is reachable.",
            )}
          </div>
        ) : null}

        {!agents.isLoading && !agents.isError && agentIds.length === 0 ? (
          <div className={styles.empty}>
            {t("机队里还没有已注册的 Agent。", "There are no registered Agents in the fleet yet.")}
          </div>
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
                    {t("工作清单", "Work list")}
                    <span aria-hidden="true">→</span>
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
