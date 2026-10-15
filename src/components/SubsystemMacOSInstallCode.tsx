import { t } from "../i18n";
import styles from "./SubsystemMacOSInstallCode.module.css";
import { ShellCode } from "./ShellCode";
import { CopyButton } from "./CopyButton";
import { copyableInstallCommand, displayInstallCommand } from "./installCommand";

interface SubsystemMacOSInstallCodeProps {
  command?: string;
  token?: string;
  loading?: boolean;
  label?: string;
  /** 重装模式：命令前多一行 `WIST_AGENTD_REINSTALL=1`，让 install.sh 替换本机客户端证书。 */
  reinstall?: boolean;
  children?: React.ReactNode;
}

export function SubsystemMacOSInstallCode({
  command,
  token,
  loading,
  // 默认值在**调用期**（渲染期）求值，可以放 `t()`。
  label = t("macOS 安装命令", "macOS install command"),
  reinstall = false,
  children,
}: SubsystemMacOSInstallCodeProps) {
  const displayCommand = loading
    ? t("安装代码加载中...", "Loading install code…")
    : (displayInstallCommand(command, reinstall) ?? t("暂无安装代码", "No install command available"));
  const fullCommand = copyableInstallCommand(command, token, reinstall);

  return (
    <div className={styles.container}>
      <div className={styles.label}>{label}</div>
      <code className={styles.code}>
        <ShellCode code={displayCommand} />
      </code>
      <div className={styles.actions}>
        <CopyButton
          text={fullCommand}
          label={t("复制命令", "Copy command")}
          className={styles.copyButton}
        />
      </div>
      {children}
    </div>
  );
}
