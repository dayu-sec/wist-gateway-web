import { t } from "../i18n";
import styles from "./SubsystemBootstrapTokenCard.module.css";

interface SubsystemBootstrapTokenCardProps {
  token?: string;
  loading?: boolean;
  /** 重装模式：这张 token 的用途是「给某台机器换一张新证书」，而不是「新机器加入集群」。 */
  reinstall?: boolean;
}

/**
 * Bootstrap Token 只用来**看一眼**：它已经拼在下面的命令里（复制那一个「复制命令（含 Token）」
 * 就够了），所以这里不另外给复制，也不写「怎么手工注入 Token」—— 那些只在照着命令手敲时才有用。
 */
export function SubsystemBootstrapTokenCard({
  token,
  loading,
  reinstall = false,
}: SubsystemBootstrapTokenCardProps) {
  const display = loading
    ? t("加载中...", "Loading...")
    : (token ?? t("暂无（请先设置 Admin Token）", "None yet (set an Admin Token first)"));

  return (
    <section className={styles.container}>
      <h2 className={styles.title}>{t("Bootstrap Token", "Bootstrap Token")}</h2>
      <p className={styles.desc}>
        {reinstall
          ? t(
              "一次性凭证，已包含在下面的重装命令里；用完即作废（刷新本页可重取）。",
              "A one-shot credential, already included in the reinstall command below; void once used (reload this page for a new one).",
            )
          : t(
              "一次性凭证，已包含在下面的安装命令里；用完即作废（刷新本页可重取）。",
              "A one-shot credential, already included in the install command below; void once used (reload this page for a new one).",
            )}
      </p>
      <code className={styles.token}>{display}</code>
    </section>
  );
}
