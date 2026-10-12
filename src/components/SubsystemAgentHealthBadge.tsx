import { t } from "../i18n";
import styles from "./SubsystemAgentHealthBadge.module.css";

interface SubsystemAgentHealthBadgeProps {
  children?: React.ReactNode;
}

export function SubsystemAgentHealthBadge({ children }: SubsystemAgentHealthBadgeProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>{t("Agent 健康标识", "Agent health badge")}</div>
      {children}
    </div>
  );
}
