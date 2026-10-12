import styles from "./SubsystemAgentHealthStatusFilter.module.css";
import { t } from "../i18n";

interface SubsystemAgentHealthStatusFilterProps {
  children?: React.ReactNode;
}

export function SubsystemAgentHealthStatusFilter({ children }: SubsystemAgentHealthStatusFilterProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>{t("健康状态筛选", "Health status filter")}</div>
      {children}
    </div>
  );
}
