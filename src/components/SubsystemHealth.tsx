import { t } from "../i18n";
import styles from "./SubsystemHealth.module.css";

interface SubsystemHealthProps {
  children?: React.ReactNode;
}

export function SubsystemHealth({ children }: SubsystemHealthProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>{t("健康状态", "Health")}</div>
      {children}
    </div>
  );
}
