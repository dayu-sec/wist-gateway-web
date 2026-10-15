import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { t } from "../i18n";
import styles from "./SubsystemAgentInstallPage.module.css";
import { SubsystemBootstrapTokenCard } from "./SubsystemBootstrapTokenCard";
import { SubsystemX86LinuxInstallCode } from "./SubsystemX86LinuxInstallCode";
import { SubsystemArmLinuxInstallCode } from "./SubsystemArmLinuxInstallCode";
import { SubsystemMacOSInstallCode } from "./SubsystemMacOSInstallCode";
import { isRateLimitedError } from "../api";
import { adminApiErrorMessage } from "./adminApiError";
import { useAgentInstallCode } from "../hooks";
import { RateLimitNotice } from "./RateLimitNotice";
import { readInstallMode, writeInstallMode, type InstallMode } from "./installMode";

const ARCH_TABS = [
  { key: "x86", label: "X86 Linux" },
  { key: "arm", label: "Arm Linux" },
  { key: "macos", label: "macOS" },
] as const;

type ArchKey = (typeof ARCH_TABS)[number]["key"];

/** 用途：首次安装（让新机器加入集群）/ 重装（替换某台在网机器上的客户端证书）。 */
const MODE_KEYS: readonly InstallMode[] = ["install", "reinstall"];

export function SubsystemAgentInstallPage() {
  const { data, isLoading, isError, error } = useAgentInstallCode();
  const [activeArch, setActiveArch] = useState<ArchKey>("x86");
  // 用途走 URL（`?mode=reinstall`）：这样身份面板那条深链能直接把人送到重装模式，
  // 而且刷新 / 转发给同事都还是同一个模式。
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = readInstallMode(searchParams);

  const token = data?.bootstrapEnrollmentToken;
  const reinstall = mode === "reinstall";

  // 文案在**渲染期**求值：模块顶层的表只在导入时取一次词，切语言不会跟着变。
  const modeLabels: Record<InstallMode, string> = {
    install: t("首次安装", "First install"),
    reinstall: t("重装（替换证书）", "Reinstall (replace certificate)"),
  };
  const commandLabel = reinstall
    ? t("重装命令", "Reinstall command")
    : t("安装命令", "Install command");

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t("安装 Agent", "Install agent")}</h1>
        <p className={styles.pageSummary}>
          {reinstall
            ? t(
                "给某台已经在网的主机「换一张新证书」：重装一遍并重新注册。换的只是那台机器的客户端证书，agent_id 不变，也不影响其它机器。",
                "Swap in a fresh certificate for a host that is already in the fleet: reinstall it and re-enroll. Only that machine's client certificate changes; its agent_id stays the same and no other host is affected.",
              )
            : t(
                "在目标主机上装一次采集 Agent，它就会把该主机的指标与日志持续上报到本网关。",
                "Install the collection agent once on a target host, and it keeps reporting that host's metrics and logs to this gateway.",
              )}
        </p>
        <div
          className={styles.modeSwitch}
          role="group"
          aria-label={t("用途", "Purpose")}
        >
          {MODE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={mode === key}
              className={
                mode === key
                  ? `${styles.modeTab} ${styles.modeTabActive}`
                  : styles.modeTab
              }
              onClick={() => setSearchParams(writeInstallMode(searchParams, key))}
            >
              {modeLabels[key]}
            </button>
          ))}
        </div>
        <ol className={styles.steps}>
          {reinstall ? (
            <>
              <li>
                {t(
                  "复制 Bootstrap Token（一次性注册凭证）",
                  "Copy the Bootstrap Token (one-time enrollment credential)",
                )}
              </li>
              <li>
                {t(
                  "在要重装的那台主机上按架构执行重装命令（它会替换这台机器的客户端证书）",
                  "Run the reinstall command for its architecture on the host being reinstalled (it replaces that host's client certificate)",
                )}
              </li>
              <li>
                {t(
                  "回到机队视图确认它重新上线，且证书状态回到「有效」",
                  "Return to the fleet view to confirm it is back online with the certificate state back to Valid",
                )}
              </li>
            </>
          ) : (
            <>
              <li>
                {t(
                  "复制 Bootstrap Token（一次性注册凭证）",
                  "Copy the Bootstrap Token (one-time enrollment credential)",
                )}
              </li>
              <li>
                {t(
                  "在目标主机上按架构执行对应安装命令",
                  "Run the matching install command for the architecture on the target host",
                )}
              </li>
              <li>
                {t(
                  "回到「主机指标」确认该主机已开始上报",
                  "Return to Host metrics to confirm the host has started reporting",
                )}
              </li>
            </>
          )}
        </ol>
      </header>
      {reinstall ? (
        <div className={styles.modeNotice}>
          {t(
            "重装会替换该主机上的客户端证书：命令先停掉在跑的 agentd，再凭 token 强制重新注册（enroll --force）换一张新证书，然后重建服务。agent_id 是机器标识的稳定哈希，不会变；只影响这一台。仅用于证书已过期 / 换过网关 / 本机身份错乱 —— 证书正常的机器不需要重装。",
            "Reinstalling replaces the client certificate on that host: the command stops the running agentd, force re-enrolls with the token (enroll --force) to obtain a fresh certificate, then rebuilds the service. agent_id is a stable hash of the machine identity, so it does not change, and only this host is affected. Use it only when the certificate has expired, the machine moved to another gateway, or the local identity is inconsistent — hosts with a healthy certificate do not need it.",
          )}
        </div>
      ) : null}
      {isError ? (
        isRateLimitedError(error) ? (
          <RateLimitNotice error={error} />
        ) : (
          // 不再自己编一句话：服务端的 500 正文（如“没有可用的 agent 安装包…”）比任何通用提示都准。
          <div className={styles.errorBanner}>{adminApiErrorMessage(error)}</div>
        )
      ) : null}
      <div className={styles.content}>
        <SubsystemBootstrapTokenCard token={token} loading={isLoading} reinstall={reinstall} />
        <section className={styles.commandsSection}>
          <div className={styles.commandsHead}>
            <h2 className={styles.sectionTitle}>
              {reinstall
                ? t(
                    "按目标主机架构选择重装命令",
                    "Choose the reinstall command for the target host architecture",
                  )
                : t(
                    "按目标主机架构选择安装命令",
                    "Choose the install command for the target host architecture",
                  )}
            </h2>
            <div
              className={styles.archTabs}
              role="tablist"
              aria-label={t("目标主机架构", "Target host architecture")}
            >
              {ARCH_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={activeArch === tab.key}
                  className={
                    activeArch === tab.key
                      ? `${styles.archTab} ${styles.archTabActive}`
                      : styles.archTab
                  }
                  onClick={() => setActiveArch(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          {/* 三份命令来自同一次请求，切换是纯本地状态，无重新取数。 */}
          <div role="tabpanel" className={styles.archPanel}>
            {activeArch === "x86" ? (
              <SubsystemX86LinuxInstallCode
                command={data?.x86LinuxInstallCode}
                token={token}
                loading={isLoading}
                reinstall={reinstall}
                label={commandLabel}
              />
            ) : null}
            {activeArch === "arm" ? (
              <SubsystemArmLinuxInstallCode
                command={data?.armLinuxInstallCode}
                token={token}
                loading={isLoading}
                reinstall={reinstall}
                label={commandLabel}
              />
            ) : null}
            {activeArch === "macos" ? (
              <SubsystemMacOSInstallCode
                command={data?.macosInstallCode}
                token={token}
                loading={isLoading}
                reinstall={reinstall}
                label={commandLabel}
              />
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
