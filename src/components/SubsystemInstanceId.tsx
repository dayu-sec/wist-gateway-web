import { t } from "../i18n";
import styles from "./SubsystemInstanceId.module.css";

interface SubsystemInstanceIdProps {
  children?: React.ReactNode;
}

export function SubsystemInstanceId({ children }: SubsystemInstanceIdProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>{t("实例 ID", "Instance ID")}</div>
      {children}
    </div>
  );
}
