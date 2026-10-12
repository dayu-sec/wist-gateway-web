import { t } from "../i18n";
import styles from "./SubsystemDispatchId.module.css";

interface SubsystemDispatchIdProps {
  children?: React.ReactNode;
}

export function SubsystemDispatchId({ children }: SubsystemDispatchIdProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>{t("派发 ID", "Dispatch ID")}</div>
      {children}
    </div>
  );
}
