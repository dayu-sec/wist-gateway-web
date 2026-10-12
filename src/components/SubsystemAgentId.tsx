import { t } from "../i18n";
import styles from "./SubsystemAgentId.module.css";

interface SubsystemAgentIdProps {
  children?: React.ReactNode;
}

export function SubsystemAgentId({ children }: SubsystemAgentIdProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>{t("Agent 标识", "Agent ID")}</div>
      {children}
    </div>
  );
}
