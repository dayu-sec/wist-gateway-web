import { t } from "../i18n";
import styles from "./SubsystemStatus.module.css";

interface SubsystemStatusProps {
  children?: React.ReactNode;
}

export function SubsystemStatus({ children }: SubsystemStatusProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>{t("状态", "Status")}</div>
      {children}
    </div>
  );
}
