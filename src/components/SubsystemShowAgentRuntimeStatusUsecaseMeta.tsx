import { t } from "../i18n";
import styles from "./SubsystemShowAgentRuntimeStatusUsecaseMeta.module.css";

interface SubsystemShowAgentRuntimeStatusUsecaseMetaProps {
  children?: React.ReactNode;
}

export function SubsystemShowAgentRuntimeStatusUsecaseMeta({ children }: SubsystemShowAgentRuntimeStatusUsecaseMetaProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>
        {t("查看运行状态用例信息", "Runtime status usecase info")}
      </div>
      {children}
    </div>
  );
}
