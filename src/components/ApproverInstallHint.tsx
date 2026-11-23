import { useState } from "react";
import { useAgentAdvertiseUrl } from "../hooks";
import { t } from "../i18n";
import {
  approverInstallCommand,
  approverPlatforms,
  detectApproverPlatform,
  type ApproverTriple,
} from "../lib/approverInstall";
import { CopyButton } from "./CopyButton";
import { ShellCode } from "./ShellCode";
import styles from "./ApproverInstallHint.module.css";

/**
 * 「怎么装审批终端」—— 页面给得出每一行的命令，前提是审批人的机器上**已经有** CLI。
 * 这一段补上「CLI 从哪来」：从**本网关**装（客户/隔离站点连不上 GitHub），
 * 二进制不含任何凭据，私钥由审批人自己在本机生成。
 *
 * 基址取管理面的「Agent 对外地址」（`useAgentAdvertiseUrl`：设置值优先，没设就用配置文件
 * 里的 `public_base_url`）。**不能**用页面自己的 `location`：页面在 `:8443`（nginx 终止
 * TLS），而 agent 与审批终端连的是网关的 `443`，两个入口是分开的。
 */
export function ApproverInstallHint() {
  const advertise = useAgentAdvertiseUrl();
  const base = (advertise.data?.url ?? "") || (advertise.data?.fallbackUrl ?? "");

  const [triple, setTriple] = useState<ApproverTriple>(() =>
    detectApproverPlatform(
      typeof navigator === "undefined" ? "" : navigator.userAgent,
    ),
  );

  const platforms = approverPlatforms();
  const command = base ? approverInstallCommand(base, triple) : "";

  return (
    <section className={styles.section}>
      <h2 className={styles.title}>
        {t("安装审批终端", "Install the approval CLI")}
      </h2>
      <p className={styles.hint}>
        {t(
          "第一次用？这台审批机上还没有 wist-approve 的话，用下面这条命令装（装到 ~/bin，不需要 sudo；该目录通常已在 PATH 上，脚本会告诉你下一步）。二进制从本网关下载、不含任何凭据；私钥由你自己在这台机器上生成，不会离开本机。",
          "First time here? If wist-approve is not on this approval machine yet, install it with the command below (into ~/bin, no sudo; that directory is usually already on PATH, and the script tells you the next step). The binary is downloaded from this gateway and carries no credentials; the private key is generated on this machine and never leaves it.",
        )}
      </p>

      <div
        className={styles.platforms}
        role="group"
        aria-label={t("选择平台", "Choose platform")}
      >
        {platforms.map((platform) => {
          const active = platform.triple === triple;
          return (
            <button
              key={platform.triple}
              type="button"
              aria-pressed={active}
              className={
                active ? `${styles.platform} ${styles.platformActive}` : styles.platform
              }
              onClick={() => {
                setTriple(platform.triple);
              }}
            >
              {platform.label}
            </button>
          );
        })}
      </div>

      {advertise.isLoading ? (
        <p className={styles.hint}>
          {t("正在读取网关对外地址…", "Reading the gateway public address…")}
        </p>
      ) : advertise.isError ? (
        <p className={styles.warning} role="alert">
          {t(
            "读不到网关对外地址，给不出可执行的安装命令。请确认管理面可用后刷新本页。",
            "Cannot read the gateway public address, so no runnable install command can be shown. Make sure the admin API is reachable and refresh this page.",
          )}
        </p>
      ) : !base ? (
        <p className={styles.warning} role="alert">
          {t(
            "网关还没有「对外地址」：先到系统设置里设置 Agent 对外地址（就是 agent 连的那个入口），否则安装命令里的地址是错的。",
            "The gateway has no public address yet: set the Agent public address in settings (the entry agents connect to) first, otherwise the address in the install command is wrong.",
          )}
        </p>
      ) : (
        <div className={styles.commandRow}>
          <code className={styles.code}>
            <ShellCode code={command} />
          </code>
          <CopyButton text={command} label={t("复制命令", "Copy command")} />
        </div>
      )}

      <ol className={styles.steps}>
        <li>
          {t("生成审批钥匙（私钥只留在本机，权限 0600）：", "Generate the approval key (private key stays here, mode 0600):")}{" "}
          <code>wist-approve key generate --out ~/.wist/approver.key</code>
        </li>
        <li>
          {t(
            "打印 key_id 与指纹，交给管理员登记到下方「审批公钥」：",
            "Print the key_id and fingerprint, then have the admin register them under “Approver keys” below:",
          )}{" "}
          <code>wist-approve key show --key ~/.wist/approver.key</code>
        </li>
        <li>
          {t(
            "之后每一条审批单，直接跑表格「下一步」列里那条命令（投票 + 签名一步完成）。",
            "After that, run the command in each row's “Next step” column (vote and sign in one go).",
          )}
        </li>
      </ol>
    </section>
  );
}
