import { Link } from "react-router-dom";
import { t } from "../i18n";
import styles from "./SubsystemRecentOnlineRegisteredAgentPanel.module.css";
import { SubsystemRecentOnlineRegisteredAgentCardGrid } from "./SubsystemRecentOnlineRegisteredAgentCardGrid";
import type { RecentOnlineRegisteredAgent } from "../api";

interface SubsystemRecentOnlineRegisteredAgentPanelProps {
  agents?: RecentOnlineRegisteredAgent[];
  /** 网关登记的 Agent 总数：小于列表长度说明这里被上限截断了，页面要**说出来**。 */
  total?: number;
  loading?: boolean;
  children?: React.ReactNode;
}

export function SubsystemRecentOnlineRegisteredAgentPanel({
  agents = [],
  total,
  loading,
}: SubsystemRecentOnlineRegisteredAgentPanelProps) {
  // 只列出一部分时必须说清楚（以前截断到 6 张且一声不响，7 台的网关看起来就像少了一台）。
  const truncated = typeof total === "number" && total > agents.length;

  return (
    <section className={styles.container}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>{t("最近上线注册 Agent", "Recently online registered agents")}</h2>
          <p className={styles.summary}>
            {t(
              "查看近期完成注册并保持在线的 Agent，优先确认新接入主机状态。",
              "Review agents that recently finished enrollment and stayed online; check newly enrolled hosts first.",
            )}
          </p>
        </div>
        <span className={styles.count}>
          {loading ? t("加载中", "Loading") : t("{n} 个", "{n} items", { n: agents.length })}
        </span>
      </div>
      <SubsystemRecentOnlineRegisteredAgentCardGrid items={agents} loading={loading} />
      {!loading && truncated ? (
        <p className={styles.truncatedNote}>
          {t(
            "这里只列最近上线的 {shown} 台（共 {total} 台）：",
            "Showing the {shown} most recently online (of {total}):",
            { shown: agents.length, total },
          )}{" "}
          <Link className={styles.truncatedLink} to="/fleet">
            {t("去「Agent 机队」看全部", "see all under Agent fleet")}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
