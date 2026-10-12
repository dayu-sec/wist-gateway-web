import styles from "./SubsystemLastSeenAt.module.css";
import { t } from "../i18n";

interface SubsystemLastSeenAtProps {
  children?: React.ReactNode;
}

export function SubsystemLastSeenAt({ children }: SubsystemLastSeenAtProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>{t("最后上报时间", "Last reported at")}</div>
      {children}
    </div>
  );
}
