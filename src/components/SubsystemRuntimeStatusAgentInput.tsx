import { t } from "../i18n";
import styles from "./SubsystemRuntimeStatusAgentInput.module.css";

interface SubsystemRuntimeStatusAgentInputProps {
  children?: React.ReactNode;
}

export function SubsystemRuntimeStatusAgentInput({ children }: SubsystemRuntimeStatusAgentInputProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>
        {t("运行状态 Agent 输入", "Runtime status Agent input")}
      </div>
      {children}
    </div>
  );
}
