import { t } from "../i18n";
import styles from "./SubsystemNoAbnormalAgentPlaceholder.module.css";

interface SubsystemNoAbnormalAgentPlaceholderProps {
  children?: React.ReactNode;
}

export function SubsystemNoAbnormalAgentPlaceholder({ children }: SubsystemNoAbnormalAgentPlaceholderProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>
        {t("当前没有异常 Agent", "No abnormal agents at present")}
      </div>
      {children}
    </div>
  );
}
