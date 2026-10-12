import { t } from "../i18n";
import styles from "./SubsystemAdminShowAgentRuntimeStatus.module.css";

interface SubsystemAdminShowAgentRuntimeStatusProps {
  children?: React.ReactNode;
}

export function SubsystemAdminShowAgentRuntimeStatus({ children }: SubsystemAdminShowAgentRuntimeStatusProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>
        {t("管理员查看 Agent 运行状态", "Admin view of agent runtime status")}
      </div>
      {children}
    </div>
  );
}
