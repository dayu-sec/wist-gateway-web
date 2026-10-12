import { t } from "../i18n";
import styles from "./SubsystemAgentRuntimeStatusView.module.css";

interface SubsystemAgentRuntimeStatusViewProps {
  children?: React.ReactNode;
}

export function SubsystemAgentRuntimeStatusView({ children }: SubsystemAgentRuntimeStatusViewProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>{t("Agent 运行状态", "Agent runtime status")}</div>
      {children}
    </div>
  );
}
