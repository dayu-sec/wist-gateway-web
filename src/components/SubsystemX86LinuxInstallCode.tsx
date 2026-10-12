import styles from "./SubsystemX86LinuxInstallCode.module.css";
import { ShellCode } from "./ShellCode";
import { CopyButton } from "./CopyButton";
import { t } from "../i18n";

interface SubsystemX86LinuxInstallCodeProps {
  command?: string;
  token?: string;
  loading?: boolean;
  label?: string;
  children?: React.ReactNode;
}

export function SubsystemX86LinuxInstallCode({
  command,
  token,
  loading,
  label = t("X86 Linux 安装命令", "X86 Linux install command"),
  children,
}: SubsystemX86LinuxInstallCodeProps) {
  const displayCommand = loading
    ? t("安装代码加载中...", "Loading install code...")
    : (command ?? t("暂无安装代码", "No install code"));
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
