import { t } from "../i18n";
import styles from "./SubsystemCreatedAt.module.css";

interface SubsystemCreatedAtProps {
  children?: React.ReactNode;
}

export function SubsystemCreatedAt({ children }: SubsystemCreatedAtProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>{t("创建时间", "Created at")}</div>
      {children}
    </div>
  );
}
