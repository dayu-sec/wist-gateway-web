import styles from "./SubsystemAdminHomePage.module.css";
import { SubsystemAgentStatusOverviewMetrics } from "./SubsystemAgentStatusOverviewMetrics";
import { SubsystemRecentOnlineRegisteredAgentPanel } from "./SubsystemRecentOnlineRegisteredAgentPanel";
import { SubsystemAbnormalAgentPanel } from "./SubsystemAbnormalAgentPanel";
import { RateLimitNotice } from "./RateLimitNotice";
import { isRateLimitedError } from "../api";
import { adminApiErrorMessage } from "./adminApiError";
import { useAgentOverview } from "../hooks";

interface SubsystemAdminHomePageProps {
  children?: React.ReactNode;
}

export function SubsystemAdminHomePage({}: SubsystemAdminHomePageProps) {
  const { data, isLoading, isError, error } = useAgentOverview();

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Agent 总览</h1>
        <p className={styles.pageSummary}>
          查看已接入 Agent 的在线状态、健康状态和需要处理的异常节点。
        </p>
      </header>
      {isError ? (
        isRateLimitedError(error) ? (
          <RateLimitNotice error={error} />
        ) : (
          // 不再自己编一句话：服务端正文（若给了）比任何通用提示都准。
          <div className={styles.errorBanner}>{adminApiErrorMessage(error)}</div>
        )
      ) : null}
      <SubsystemAgentStatusOverviewMetrics
        metrics={data?.metrics}
        loading={isLoading}
      />
      <SubsystemRecentOnlineRegisteredAgentPanel
        agents={data?.recentOnlineAgents ?? []}
        loading={isLoading}
      />
      <SubsystemAbnormalAgentPanel
        agents={data?.abnormalAgents ?? []}
        loading={isLoading}
      />
    </div>
  );
}
