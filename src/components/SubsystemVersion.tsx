import { t } from "../i18n";
import styles from "./SubsystemVersion.module.css";

interface SubsystemVersionProps {
  children?: React.ReactNode;
}

export function SubsystemVersion({ children }: SubsystemVersionProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>{t("版本", "Version")}</div>
      {children}
    </div>
  );
}
