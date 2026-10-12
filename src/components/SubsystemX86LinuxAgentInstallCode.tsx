import styles from "./SubsystemX86LinuxAgentInstallCode.module.css";
import { t } from "../i18n";

interface SubsystemX86LinuxAgentInstallCodeProps {
  children?: React.ReactNode;
}

export function SubsystemX86LinuxAgentInstallCode({ children }: SubsystemX86LinuxAgentInstallCodeProps) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>
        {t("X86 Linux 安装代码", "X86 Linux install code")}
      </div>
      {children}
    </div>
  );
}
