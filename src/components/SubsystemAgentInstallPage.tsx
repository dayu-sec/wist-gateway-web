import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { t } from "../i18n";
import styles from "./SubsystemAgentInstallPage.module.css";
import { SubsystemBootstrapTokenCard } from "./SubsystemBootstrapTokenCard";
import { SubsystemAgentInstallPolicyForm } from "./SubsystemAgentInstallPolicyForm";
import { SubsystemX86LinuxInstallCode } from "./SubsystemX86LinuxInstallCode";
import { SubsystemArmLinuxInstallCode } from "./SubsystemArmLinuxInstallCode";
import { SubsystemMacOSInstallCode } from "./SubsystemMacOSInstallCode";
import { isRateLimitedError, type AgentInstallCode } from "../api";
import { adminApiErrorMessage } from "./adminApiError";
import {
  useAgentInstallCode,
  useIssueAgentBatchInstallCode,
  useRevokeAgentBatchInstallCode,
} from "../hooks";
import { RateLimitNotice } from "./RateLimitNotice";
import {
  readInstallMode,
  writeInstallMode,
  type InstallMode,
} from "./installMode";

const ARCH_TABS = [
  { key: "x86", label: "X86 Linux" },
  { key: "arm", label: "Arm Linux" },
  { key: "macos", label: "macOS" },
] as const;

type ArchKey = (typeof ARCH_TABS)[number]["key"];

/** 用途：首次安装 / 重装（替换某台在网机器上的客户端证书）/ 批量安装（短时多机）。 */
const MODE_KEYS: readonly InstallMode[] = ["install", "reinstall", "batch"];

export function SubsystemAgentInstallPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = readInstallMode(searchParams);
  const [activeArch, setActiveArch] = useState<ArchKey>("x86");

  // 用途走 URL（`?mode=reinstall`）：这样身份面板那条深链能直接把人送到重装模式，
  // 而且刷新 / 转发给同事都还是同一个模式。
  const reinstall = mode === "reinstall";
  const batch = mode === "batch";

  // 批量码的有效期很短（默认 60 秒），**不能**像一次性码那样页面一打开就签发：
  // 那样等用户复制完命令，一半寿命已经烧掉了。批量码只由下面的按钮显式生成。
  const oneTime = useAgentInstallCode(!batch);
  const batchIssue = useIssueAgentBatchInstallCode();
  const revokeBatch = useRevokeAgentBatchInstallCode();
  const [batchCode, setBatchCode] = useState<AgentInstallCode>();
  const [revokeNotice, setRevokeNotice] = useState(false);

  const data = batch ? batchCode : oneTime.data;
  const token = data?.bootstrapEnrollmentToken;
  const isLoading = batch ? batchIssue.isPending : oneTime.isLoading;
  const isError =
    (batch ? batchIssue.isError : oneTime.isError) || revokeBatch.isError;
  const error = (batch ? batchIssue.error : oneTime.error) ?? revokeBatch.error;

  // 文案在**渲染期**求值：模块顶层的表只在导入时取一次词，切语言不会跟着变。
  const modeLabels: Record<InstallMode, string> = {
    install: t("首次安装", "First install"),
    reinstall: t("重装（替换证书）", "Reinstall (replace certificate)"),
    batch: t("批量安装", "Batch install"),
  };
  const commandLabel = reinstall
    ? t("重装命令", "Reinstall command")
    : t("安装命令", "Install command");

  const generateBatchCode = () => {
    setRevokeNotice(false);
    batchIssue.mutate(undefined, {
      onSuccess: (code) => setBatchCode(code),
    });
  };

  // 作废成功后把本地那张码也清掉：它已经死了，留着只会让人误复制。
  const revokeCurrentBatchCode = () => {
    revokeBatch.mutate(undefined, {
      onSuccess: () => {
        setBatchCode(undefined);
        setRevokeNotice(true);
      },
    });
  };

  const summary = reinstall
    ? t(
        "给某台已经在网的主机重装一次，换掉它的客户端证书；其它一概不变。",
        "Reinstall a host that is already in the fleet to swap in a fresh client certificate; nothing else changes.",
      )
    : batch
      ? t(
          "在一小段时间内（默认 60 秒）给多台新主机装 Agent：生成一张短时 Token，再用同一份命令在多台机器上执行。",
          "Install the agent on many new hosts within a short window (60 seconds by default): generate one short-lived token, then run the same command on each machine.",
        )
      : t(
          "在目标主机上装一次采集 Agent，它就会把该主机的指标与日志持续上报到本网关。",
          "Install the collection agent once on a target host, and it keeps reporting that host's metrics and logs to this gateway.",
        );

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t("安装 Agent", "Install agent")}</h1>
        <p className={styles.pageSummary}>{summary}</p>
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
              onClick={() =>
                setSearchParams(writeInstallMode(searchParams, key))
              }
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
          ) : batch ? (
            <>
              <li>
                {t(
                  "生成批量 Token（短时有效，默认 60 秒）",
                  "Generate a batch token (short-lived, 60 seconds by default)",
                )}
              </li>
              <li>
                {t(
                  "在有效期内，按架构在多台目标主机上执行同一份命令",
                  "During the window, run the same command for the architecture on each target host",
                )}
              </li>
              <li>
                {t(
                  "回到「主机指标」确认这些主机开始上报；没装完就重新生成一张",
                  "Return to Host metrics to confirm they start reporting; regenerate a token if you run out of time",
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
          <p className={styles.modeNoticeLead}>
            {t(
              "重装只影响这一台，但有几件事要先知道：",
              "A reinstall only affects this host, but a few things are worth knowing first:",
            )}
          </p>
          <ul className={styles.modeNoticeList}>
            <li>
              {t(
                "会替换这台主机的客户端证书 —— 它在网关上的身份不变，不会多出一台新机器；",
                "It replaces this host's client certificate — its identity on the gateway stays the same, so it will not show up as a new machine;",
              )}
            </li>
            <li>
              {t(
                "过程中这台主机的采集与上报会短暂中断，别挑关键窗口做；",
                "Collection and reporting from this host pause briefly, so avoid doing it in a critical window;",
              )}
            </li>
            <li>
              {t(
                "需要在那台主机上有管理员权限（安装是系统级的）；",
                "Administrator rights are required on that host (the install is system-wide);",
              )}
            </li>
            <li>
              {t(
                "命令里的一次性 Token 只能给一台主机用一次，用掉后回到本页重取。",
                "The one-time token in the command covers exactly one host; come back to this page for a new one after it is used.",
              )}
            </li>
          </ul>
          <p className={styles.modeNoticeFoot}>
            {t(
              "仅用于：证书已过期、换过网关、本机身份异常。证书正常的机器不需要重装。",
              "Use it only when the certificate has expired, the host moved to another gateway, or its local identity is broken. Hosts with a healthy certificate do not need it.",
            )}
          </p>
        </div>
      ) : batch ? (
        <div className={styles.modeNotice}>
          <p className={styles.modeNoticeLead}>
            {t(
              "批量 Token 是短时共享凭据，用之前先知道这几件事：",
              "A batch token is a short-lived shared credential — know these before using it:",
            )}
          </p>
          <ul className={styles.modeNoticeList}>
            <li>
              {t(
                "有效期内谁拿到它都能让一台新主机加入本环境 —— 只在受控终端/内网传递，别贴群、别写进镜像；",
                "While valid, anyone holding it can enroll a new host into this environment — pass it only over controlled terminals or the intranet, never in chat or images;",
              )}
            </li>
            <li>
              {t(
                "到点或到台数上限即不可再用（上限见下方 Token 卡）；重新生成会立即作废当前这张（也可点「作废本批 Token」）—— 没装完的主机要用新 Token 重试；",
                "It stops working at the deadline or once the host cap is reached (the cap is shown on the token card below); regenerating revokes the current one immediately (or use the “Revoke this token” button) — unfinished hosts must retry with a new token;",
              )}
            </li>
            <li>
              {t(
                "每台机器仍然只注册一次身份，不会因为共用 Token 而混成同一台；",
                "Each host still registers its own identity — sharing the token does not merge machines;",
              )}
            </li>
            <li>
              {t(
                "建议先在一台上跑通命令，再并发下发到其余主机。",
                "Run it on one host first, then roll it out to the rest in parallel.",
              )}
            </li>
          </ul>
        </div>
      ) : null}
      {isError ? (
        isRateLimitedError(error) ? (
          <RateLimitNotice error={error} />
        ) : (
          // 不再自己编一句话：服务端的 500 正文（如“没有可用的 agent 安装包…”）比任何通用提示都准。
          <div className={styles.errorBanner}>
            {adminApiErrorMessage(error)}
          </div>
        )
      ) : null}
      {batch ? (
        <>
          <SubsystemAgentInstallPolicyForm />
          <section className={styles.batchPanel}>
            <div className={styles.batchPanelText}>
              <h2 className={styles.sectionTitle}>
                {t("生成批量 Token", "Generate a batch token")}
              </h2>
              <p className={styles.batchPanelHint}>
                {batchCode?.maxUses
                  ? t(
                      `本张最多可注册 ${batchCode.maxUses} 台；有效期见下方倒计时。重新生成或作废会立即切断旧码。`,
                      `This token enrolls up to ${batchCode.maxUses} hosts; see the countdown below. Regenerating or revoking cuts it off immediately.`,
                    )
                  : t(
                      "有效期与最多可注册台数由上方「批量安装策略」决定。生成后立刻复制命令，别让时间白流。",
                      "Validity and host cap come from the batch install policy above. Copy the command right away so the window is not wasted.",
                    )}
              </p>
              {revokeNotice ? (
                <p className={styles.revokedNotice}>
                  {t(
                    "已作废当前批量 Token：未完成的主机需要用新 Token 重试。",
                    "The current batch token is revoked: unfinished hosts must retry with a new one.",
                  )}
                </p>
              ) : null}
            </div>
            <div className={styles.batchActions}>
              <button
                type="button"
                className={styles.batchButton}
                onClick={generateBatchCode}
                disabled={batchIssue.isPending}
              >
                {batchIssue.isPending
                  ? t("生成中...", "Generating...")
                  : batchCode
                    ? t("重新生成", "Regenerate")
                    : t("生成批量 Token", "Generate batch token")}
              </button>
              {batchCode ? (
                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={revokeCurrentBatchCode}
                  disabled={revokeBatch.isPending}
                >
                  {revokeBatch.isPending
                    ? t("作废中...", "Revoking...")
                    : t("作废本批 Token", "Revoke this token")}
                </button>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
      {batch && !batchCode ? null : (
        <div className={styles.content}>
          <SubsystemBootstrapTokenCard
            token={token}
            loading={isLoading}
            reinstall={reinstall}
            batch={batch}
            expiresAt={batch ? data?.expiresAt : undefined}
            maxUses={batch ? data?.maxUses : undefined}
          />
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
            <p className={styles.platformNote}>
              {t(
                "命令要按「目标主机」的架构选：平台不符会在动手之前就被拒绝，不会改动那台机器。",
                "Pick the command for the target host's architecture: a platform mismatch is refused before anything on that host is changed.",
              )}
            </p>
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
      )}
    </div>
  );
}
