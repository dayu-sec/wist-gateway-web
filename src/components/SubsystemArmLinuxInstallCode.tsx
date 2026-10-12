import { t } from "../i18n";
import styles from "./SubsystemArmLinuxInstallCode.module.css";
import { ShellCode } from "./ShellCode";
import { CopyButton } from "./CopyButton";

interface SubsystemArmLinuxInstallCodeProps {
  command?: string;
  token?: string;
  loading?: boolean;
  label?: string;
  children?: React.ReactNode;
}

export function SubsystemArmLinuxInstallCode({
  command,
  token,
  loading,
  label = t("Arm Linux 安装命令", "Arm Linux install command"),
  children,
}: SubsystemArmLinuxInstallCodeProps) {
  const displayCommand = loading
    ? t("安装代码加载中...", "Loading install code…")
    : (command ?? t("暂无安装代码", "No install code yet"));
  const fullCommand =
    command && token
      ? `export WARP_INSIGHT_ENROLLMENT_TOKEN=${token}\n${command}`
      : command;

  return (
    <div className={styles.container}>
      <div className={styles.label}>{label}</div>
      <code className={styles.code}>
        <ShellCode code={displayCommand} />
      </code>
      <div className={styles.actions}>
        <CopyButton
          text={command}
          label={t("复制命令", "Copy command")}
          className={styles.copyButton}
        />
        <CopyButton
          text={fullCommand}
          label={t("复制完整命令（含 Token）", "Copy full command (with token)")}
          copiedLabel={t("已复制完整命令", "Full command copied")}
          className={styles.copyButton}
        />
      </div>
      {children}
    </div>
  );
}
