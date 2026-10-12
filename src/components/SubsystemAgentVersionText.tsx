import { t } from "../i18n";
import styles from "./SubsystemAgentVersionText.module.css";

interface SubsystemAgentVersionTextProps {
  children?: React.ReactNode;
}

export function SubsystemAgentVersionText({ children }: SubsystemAgentVersionTextProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>{t("Agent 版本", "Agent version")}</div>
      {children}
    </div>
  );
}
