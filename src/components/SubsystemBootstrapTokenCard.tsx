import { t } from "../i18n";
import styles from "./SubsystemBootstrapTokenCard.module.css";
import { CopyButton } from "./CopyButton";

interface SubsystemBootstrapTokenCardProps {
  token?: string;
  loading?: boolean;
}

export function SubsystemBootstrapTokenCard({
  token,
  loading,
}: SubsystemBootstrapTokenCardProps) {
  const display = loading
    ? t("加载中...", "Loading...")
    : (token ?? t("暂无（请先在上方输入 Admin Token）", "None yet (enter an Admin Token above first)"));

  return (
    <section className={styles.container}>
      <div className={styles.heading}>
        <h2 className={styles.title}>{t("Bootstrap Token（新 Agent 注册凭证）", "Bootstrap Token (enrollment credential for new agents)")}</h2>
        <p className={styles.desc}>
          {t(
            "一次性凭证，让目标主机上的 agent 加入集群；安装完成后即作废。在目标主机上运行安装命令时，通过环境变量注入，或按提示粘贴。",
            "A one-shot credential that lets the agent on the target host join the cluster; it is void once installation finishes. When running the install command on the target host, inject it through an environment variable or paste it at the prompt.",
          )}
        </p>
      </div>
      <div className={styles.tokenRow}>
        <code className={styles.token}>{display}</code>
        <CopyButton text={token} label={t("复制 Token", "Copy token")} className={styles.copyButton} />
      </div>
      <div className={styles.usage}>
        <div className={styles.usageTitle}>
          {t("目标主机上运行安装命令，二选一提供 Token：", "Run the install command on the target host; supply the token either way:")}
        </div>
        <div className={styles.option}>
          <span className={styles.optionTag}>{t("方式 A", "Option A")}</span>
          <span>{t("环境变量注入：", "Environment variable:")}</span>
          <code className={styles.inlineCode}>
            {t(
              "WARP_INSIGHT_ENROLLMENT_TOKEN=<Token> <安装命令>",
              "WARP_INSIGHT_ENROLLMENT_TOKEN=<Token> <install command>",
            )}
          </code>
        </div>
        <div className={styles.option}>
          <span className={styles.optionTag}>{t("方式 B", "Option B")}</span>
          <span>{t("直接运行安装命令，在提示", "Run the install command directly and paste it at the")}</span>
          <code className={styles.inlineCode}>Enrollment token:</code>
          <span>{t("时粘贴。", "prompt.")}</span>
        </div>
      </div>
    </section>
  );
}
