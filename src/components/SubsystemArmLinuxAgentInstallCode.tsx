import styles from "./SubsystemArmLinuxAgentInstallCode.module.css";
import { t } from "../i18n";

interface SubsystemArmLinuxAgentInstallCodeProps {
  children?: React.ReactNode;
}

export function SubsystemArmLinuxAgentInstallCode({ children }: SubsystemArmLinuxAgentInstallCodeProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>{t("Arm Linux 安装代码", "Arm Linux install code")}</div>
      {children}
    </div>
  );
}
