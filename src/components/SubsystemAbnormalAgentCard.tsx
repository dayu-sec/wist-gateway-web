import { t, dateLocale } from "../i18n";
import styles from "./SubsystemAbnormalAgentCard.module.css";
import type { AgentRuntimeStatusView } from "../api";

interface SubsystemAbnormalAgentCardProps {
  agent: AgentRuntimeStatusView;
  children?: React.ReactNode;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(dateLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusText(status: AgentRuntimeStatusView["status"]): string {
  const labels: Record<AgentRuntimeStatusView["status"], string> = {
    online: t("在线", "Online"),
    offline: t("离线", "Offline"),
  };
  return labels[status] ?? status;
}

function healthText(health: AgentRuntimeStatusView["health"]): string {
  const labels: Record<AgentRuntimeStatusView["health"], string> = {
    healthy: t("健康", "Healthy"),
    degraded: t("降级", "Degraded"),
    unhealthy: t("不健康", "Unhealthy"),
  };
  return labels[health] ?? health;
}

export function SubsystemAbnormalAgentCard({ agent }: SubsystemAbnormalAgentCardProps) {
  const badgeClassName =
    agent.health === "unhealthy"
      ? `${styles.badge} ${styles.badgeDanger}`
      : `${styles.badge} ${styles.badgeWarn}`;

  return (
    <div className={styles.container}>
      <div className={styles.top}>
        <div>
          <div className={styles.agentId}>{agent.agentId}</div>
          <div className={styles.instance}>{agent.instanceId}</div>
        </div>
        <span className={badgeClassName}>{healthText(agent.health)}</span>
      </div>
      <div className={styles.details}>
        <div className={styles.item}>
          <div className={styles.label}>{t("状态", "Status")}</div>
          <div className={styles.value}>{statusText(agent.status)}</div>
        </div>
        <div className={styles.item}>
          <div className={styles.label}>{t("版本", "Version")}</div>
          <div className={styles.value}>{agent.version}</div>
        </div>
        <div className={styles.item}>
          <div className={styles.label}>{t("最后上报", "Last report")}</div>
          <div className={styles.value}>{formatDateTime(agent.lastSeenAt)}</div>
        </div>
      </div>
    </div>
  );
}
