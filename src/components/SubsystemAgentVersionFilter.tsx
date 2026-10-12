import styles from "./SubsystemAgentVersionFilter.module.css";
import { t } from "../i18n";

interface SubsystemAgentVersionFilterProps {
  children?: React.ReactNode;
}

export function SubsystemAgentVersionFilter({ children }: SubsystemAgentVersionFilterProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>{t("Agent 版本筛选", "Agent version filter")}</div>
      {children}
    </div>
  );
}
