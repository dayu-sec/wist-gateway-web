import { t } from "../i18n";
import styles from "./SubsystemAgentOnlineStatusBadge.module.css";

interface SubsystemAgentOnlineStatusBadgeProps {
  children?: React.ReactNode;
}

export function SubsystemAgentOnlineStatusBadge({ children }: SubsystemAgentOnlineStatusBadgeProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>{t("Agent 在线标识", "Agent online status")}</div>
      {children}
    </div>
  );
}
