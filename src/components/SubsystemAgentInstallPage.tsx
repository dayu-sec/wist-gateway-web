import { useState } from "react";
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

const ARCH_TABS = [
  { key: "x86", label: "X86 Linux" },
  { key: "arm", label: "Arm Linux" },
  { key: "macos", label: "macOS" },
] as const;

type ArchKey = (typeof ARCH_TABS)[number]["key"];

export function SubsystemAgentInstallPage() {
  const { data, isLoading, isError, error } = useAgentInstallCode();
  const [activeArch, setActiveArch] = useState<ArchKey>("x86");

  const token = data?.bootstrapEnrollmentToken;

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t("安装 Agent", "Install agent")}</h1>
        <p className={styles.pageSummary}>
          {t(
            "在目标主机上装一次采集 Agent，它就会把该主机的指标与日志持续上报到本网关。",
            "Install the collection agent once on a target host, and it keeps reporting that host's metrics and logs to this gateway.",
          )}
        </p>
        <ol className={styles.steps}>
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
        </ol>
      </header>
      {isError ? (
        isRateLimitedError(error) ? (
          <RateLimitNotice error={error} />
        ) : (
          // 不再自己编一句话：服务端的 500 正文（如“没有可用的 agent 安装包…”）比任何通用提示都准。
          <div className={styles.errorBanner}>{adminApiErrorMessage(error)}</div>
        )
      ) : null}
      <div className={styles.content}>
        <SubsystemBootstrapTokenCard token={token} loading={isLoading} />
        <section className={styles.commandsSection}>
          <div className={styles.commandsHead}>
            <h2 className={styles.sectionTitle}>
              {t("按目标主机架构选择安装命令", "Choose the install command for the target host architecture")}
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
                label={t("安装命令", "Install command")}
              />
            ) : null}
            {activeArch === "arm" ? (
              <SubsystemArmLinuxInstallCode
                command={data?.armLinuxInstallCode}
                token={token}
                loading={isLoading}
                label={t("安装命令", "Install command")}
              />
            ) : null}
            {activeArch === "macos" ? (
              <SubsystemMacOSInstallCode
                command={data?.macosInstallCode}
                token={token}
                loading={isLoading}
                label={t("安装命令", "Install command")}
              />
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
