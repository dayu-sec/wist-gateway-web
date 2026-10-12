import styles from "./SubsystemRefreshRuntimeStatusAction.module.css";
import { t } from "../i18n";

interface SubsystemRefreshRuntimeStatusActionProps {
  children?: React.ReactNode;
}

export function SubsystemRefreshRuntimeStatusAction({ children }: SubsystemRefreshRuntimeStatusActionProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>{t("刷新运行状态", "Refresh runtime status")}</div>
      {children}
    </div>
  );
}
