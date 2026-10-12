import { t } from "../i18n";
import styles from "./SubsystemAgentOnlineStatusFilter.module.css";

interface SubsystemAgentOnlineStatusFilterProps {
  children?: React.ReactNode;
}

export function SubsystemAgentOnlineStatusFilter({ children }: SubsystemAgentOnlineStatusFilterProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>{t("在线状态筛选", "Online status filter")}</div>
      {children}
    </div>
  );
}
