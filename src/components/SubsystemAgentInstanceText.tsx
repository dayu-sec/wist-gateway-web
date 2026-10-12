import styles from "./SubsystemAgentInstanceText.module.css";
import { t } from "../i18n";

interface SubsystemAgentInstanceTextProps {
  children?: React.ReactNode;
}

export function SubsystemAgentInstanceText({ children }: SubsystemAgentInstanceTextProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>{t("Agent 实例", "Agent instance")}</div>
      {children}
    </div>
  );
}
