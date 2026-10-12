import { t } from "../i18n";
import styles from "./SubsystemGetAgentInstallCode.module.css";

interface SubsystemGetAgentInstallCodeProps {
  children?: React.ReactNode;
}

export function SubsystemGetAgentInstallCode({ children }: SubsystemGetAgentInstallCodeProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>{t("获取安装代码", "Get install code")}</div>
      {children}
    </div>
  );
}
