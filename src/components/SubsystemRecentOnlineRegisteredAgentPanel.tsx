import { t } from "../i18n";
import styles from "./SubsystemRecentOnlineRegisteredAgentPanel.module.css";
import { SubsystemRecentOnlineRegisteredAgentCardGrid } from "./SubsystemRecentOnlineRegisteredAgentCardGrid";
import type { RecentOnlineRegisteredAgent } from "../api";

interface SubsystemRecentOnlineRegisteredAgentPanelProps {
  agents?: RecentOnlineRegisteredAgent[];
  loading?: boolean;
  children?: React.ReactNode;
}

export function SubsystemRecentOnlineRegisteredAgentPanel({
  agents = [],
  loading,
}: SubsystemRecentOnlineRegisteredAgentPanelProps) {
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
    </section>
  );
}
