import { t } from "../i18n";
import styles from "./SubsystemRecentOnlineRegisteredAgentCardGrid.module.css";
import { SubsystemRecentOnlineRegisteredAgentCard } from "./SubsystemRecentOnlineRegisteredAgentCard";
import type { RecentOnlineRegisteredAgent } from "../api";

interface SubsystemRecentOnlineRegisteredAgentCardGridProps {
  items?: RecentOnlineRegisteredAgent[];
  loading?: boolean;
  children?: React.ReactNode;
}

export function SubsystemRecentOnlineRegisteredAgentCardGrid({
  items = [],
  loading,
}: SubsystemRecentOnlineRegisteredAgentCardGridProps) {
  if (loading) {
    return (
      <div className={styles.empty}>
        {t("正在加载最近上线注册 Agent", "Loading recently online registered agents")}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={styles.empty}>
        {t("暂无最近上线注册 Agent", "No recently online registered agents")}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {items.map((agent) => (
        <SubsystemRecentOnlineRegisteredAgentCard key={agent.agentId} agent={agent} />
      ))}
    </div>
  );
}
