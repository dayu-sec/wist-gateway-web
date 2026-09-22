import { useState } from "react";
import styles from "./SubsystemAgentInstallPage.module.css";
import { SubsystemBootstrapTokenCard } from "./SubsystemBootstrapTokenCard";
import { SubsystemX86LinuxInstallCode } from "./SubsystemX86LinuxInstallCode";
import { SubsystemArmLinuxInstallCode } from "./SubsystemArmLinuxInstallCode";
import { SubsystemMacOSInstallCode } from "./SubsystemMacOSInstallCode";
import { ApiError, isRateLimitedError } from "../api";
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

  const authError = isError && error instanceof ApiError && error.status === 401;
  const token = data?.bootstrapEnrollmentToken;

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>安装 Agent</h1>
        <p className={styles.pageSummary}>
          在目标主机上装一次采集 Agent，它就会把该主机的指标与日志持续上报到本网关。
        </p>
        <ol className={styles.steps}>
          <li>复制 Bootstrap Token（一次性注册凭证）</li>
          <li>在目标主机上按架构执行对应安装命令</li>
          <li>回到「主机指标」确认该主机已开始上报</li>
        </ol>
      </header>
      {isError ? (
        isRateLimitedError(error) ? (
          <RateLimitNotice error={error} />
        ) : (
          <div className={styles.errorBanner}>
            {authError ? (
              <>
                Admin Token 缺失或无效，无法获取安装代码。请在上方输入正确的
                Admin Token 并点击"应用"。
              </>
            ) : (
              <>无法获取安装代码，请确认 warp-insight-admin 已启动。</>
            )}
          </div>
        )
      ) : null}
      <div className={styles.content}>
        <SubsystemBootstrapTokenCard token={token} loading={isLoading} />
        <section className={styles.commandsSection}>
          <div className={styles.commandsHead}>
            <h2 className={styles.sectionTitle}>
              按目标主机架构选择安装命令
            </h2>
            <div
              className={styles.archTabs}
              role="tablist"
              aria-label="目标主机架构"
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
                label="安装命令"
              />
            ) : null}
            {activeArch === "arm" ? (
              <SubsystemArmLinuxInstallCode
                command={data?.armLinuxInstallCode}
                token={token}
                loading={isLoading}
                label="安装命令"
              />
            ) : null}
            {activeArch === "macos" ? (
              <SubsystemMacOSInstallCode
                command={data?.macosInstallCode}
                token={token}
                loading={isLoading}
                label="安装命令"
              />
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
