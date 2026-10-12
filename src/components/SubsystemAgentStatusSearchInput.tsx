import { t } from "../i18n";
import styles from "./SubsystemAgentStatusSearchInput.module.css";

interface SubsystemAgentStatusSearchInputProps {
  children?: React.ReactNode;
}

export function SubsystemAgentStatusSearchInput({ children }: SubsystemAgentStatusSearchInputProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>{t("Agent 状态搜索", "Agent status search")}</div>
      {children}
    </div>
  );
}
