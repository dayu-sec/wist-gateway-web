import { useEffect, useState } from "react";
import { t } from "../i18n";
import styles from "./SubsystemBootstrapTokenCard.module.css";
import { remainingSeconds } from "./installCodeExpiry";

interface SubsystemBootstrapTokenCardProps {
  token?: string;
  loading?: boolean;
  /** 重装模式：这张 token 的用途是「给某台机器换一张新证书」，而不是「新机器加入集群」。 */
  reinstall?: boolean;
  /** 批量安装模式：同一张 token 在短窗口内可给多台主机用（不是一次性）。 */
  batch?: boolean;
  /** 引导包到期时间（RFC3339，来自网关）；批量模式据此显示倒计时。 */
  expiresAt?: string;
  /** 批量码最多可注册的台数（网关配置）；取不到时不编数字。 */
  maxUses?: number;
}

/** 每秒重算一次剩余秒数；`active=false`（非批量模式）时不启动计时器。 */
function useRemainingSeconds(expiresAt?: string, active = false) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !expiresAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, expiresAt]);
  return remainingSeconds(expiresAt, now);
}

/**
 * Bootstrap Token 只用来**看一眼**：它已经拼在下面的命令里（复制那一个「复制命令（含 Token）」
 * 就够了），所以这里不另外给复制，也不写「怎么手工注入 Token」—— 那些只在照着命令手敲时才有用。
 */
export function SubsystemBootstrapTokenCard({
  token,
  loading,
  reinstall = false,
  batch = false,
  expiresAt,
  maxUses,
}: SubsystemBootstrapTokenCardProps) {
  const remainingSeconds = useRemainingSeconds(
    expiresAt,
    batch && Boolean(token),
  );
  const display = loading
    ? t("加载中...", "Loading...")
    : (token ??
      t("暂无（请先设置 Admin Token）", "None yet (set an Admin Token first)"));

  const title = batch
    ? t("批量安装 Token（短时）", "Batch install token (short-lived)")
    : t("Bootstrap Token", "Bootstrap Token");

  const desc = batch
    ? maxUses
      ? t(
          `短时凭证：有效期内最多 ${maxUses} 台新主机可用同一张 Token；到点、到上限或作废后需重新生成。`,
          `A short-lived credential: at most ${maxUses} new hosts can use this token; it dies at the deadline, the cap, or when revoked — regenerate then.`,
        )
      : t(
          "短时凭证：有效期内同一张 Token 可给多台新主机用；到点、到上限或作废后需重新生成。",
          "A short-lived credential: the same token can enroll multiple new hosts; it dies at the deadline, the cap, or when revoked — regenerate then.",
        )
    : reinstall
      ? t(
          "一次性凭证，已包含在下面的重装命令里；用完即作废（刷新本页可重取）。",
          "A one-shot credential, already included in the reinstall command below; void once used (reload this page for a new one).",
        )
      : t(
          "一次性凭证，已包含在下面的安装命令里；用完即作废（刷新本页可重取）。",
          "A one-shot credential, already included in the install command below; void once used (reload this page for a new one).",
        );

  return (
    <section className={styles.container}>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.desc}>{desc}</p>
      <code className={styles.token}>{display}</code>
      {batch && token ? (
        <p className={styles.countdown}>
          {remainingSeconds === undefined
            ? t(
                "有效期以网关为准（默认 60 秒）",
                "Validity is enforced by the gateway (60 seconds by default)",
              )
            : remainingSeconds > 0
              ? t(
                  `剩余 ${remainingSeconds} 秒`,
                  `${remainingSeconds}s remaining`,
                )
              : t("已过期，请重新生成一张", "Expired — generate a new one")}
        </p>
      ) : null}
    </section>
  );
}
