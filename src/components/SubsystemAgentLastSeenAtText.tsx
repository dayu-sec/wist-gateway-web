import { t } from "../i18n";
import styles from "./SubsystemAgentLastSeenAtText.module.css";

interface SubsystemAgentLastSeenAtTextProps {
  children?: React.ReactNode;
}

export function SubsystemAgentLastSeenAtText({ children }: SubsystemAgentLastSeenAtTextProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>{t("最后上报时间", "Last reported at")}</div>
      {children}
    </div>
  );
}
