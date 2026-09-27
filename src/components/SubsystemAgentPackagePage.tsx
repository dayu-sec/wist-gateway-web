import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, isRateLimitedError } from "../api";
import type { InstallPackageView } from "../api/admin";
import {
  useAgentInstallPackage,
  useInstallPackages,
  useSetAgentInstallPackage,
} from "../hooks";
import { CopyButton } from "./CopyButton";
import { RateLimitNotice } from "./RateLimitNotice";
import { isEmptyPackageHistory, packageLabel } from "./agentUpgradePackages";
import styles from "./SubsystemAgentPackagePage.module.css";

/** 读取当前设置失败时的提示。 */
function loadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击“应用”。";
    if (error.status === 429) return "认证失败次数过多，请稍后再试。";
    // 404 特指「路由不存在」：网关进程在应答（否则会是网络错误），只是没有这个接口，
    // 绝大多数情况是在跑旧构建的 gateway，而不是服务未启动。
    if (error.status === 404)
      return "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。";
    return error.detail
      ? `网关返回 HTTP ${error.status}：${error.detail}`
      : `网关返回 HTTP ${error.status}，请检查网关日志。`;
  }
  return "读取失败：响应不符合当前契约，请检查网关与前端版本。";
}

/** 安装包来源保存失败时的提示（400 = 地址/摘要不合规，或摘要与来源内容不符；502 = 来源拉不到）。 */
function packageSaveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击“应用”。";
    if (error.status === 429) return "认证失败次数过多，请稍后再试。";
    if (error.status === 404)
      return "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。";
    // 后端已把具体原因写在正文里，优先透出它，操作者才知道该改哪里。
    if (error.detail)
      return `保存失败（HTTP ${error.status}）：${error.detail}`;
    if (error.status === 400)
      return "地址或摘要不符合要求：地址必须是 https:// 链接或本机绝对路径；摘要必须是 64 位十六进制（可带 sha256: 前缀）。";
    return `网关返回 HTTP ${error.status}，请检查网关日志。`;
  }
  return "保存失败：响应不符合当前契约，请检查网关与前端版本。";
}

function timestampText(value: string | null): string {
  if (!value) return "—";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString();
}

/** 读取中 / 读取失败的提示条。 */
function LoadNotice({ loading, error }: { loading: boolean; error: unknown }) {
  if (loading) {
    return (
      <div className={styles.notice} role="status">
        正在读取当前设置…
      </div>
    );
  }
  if (!error) return null;
  if (isRateLimitedError(error)) return <RateLimitNotice error={error} />;
  return (
    <div className={styles.noticeDanger} role="alert">
      {loadErrorMessage(error)}
    </div>
  );
}

/** 已录入包历史的一行：版本 · 架构 + 录入时间在上，来源与摘要在下。 */
function PackageHistoryRow({ pkg }: { pkg: InstallPackageView }) {
  return (
    <li className={styles.packageRow}>
      <div className={styles.packageRowTop}>
        <span className={styles.packageLabel}>{packageLabel(pkg)}</span>
        <span className={styles.packageTime}>
          {timestampText(pkg.createdAt)}
        </span>
      </div>
      <div className={styles.packageRowMeta}>
        <span className={styles.packageSource} title={pkg.source}>
          {pkg.source}
        </span>
        <span className={styles.packageSha} title={pkg.packageSha256}>
          {pkg.packageSha256}
        </span>
      </div>
    </li>
  );
}

/**
 * 「安装包」页（路由 `/install-package`）：网关从哪取安装包，以及它**已录入**了哪些包。
 *
 * 这一页此前并进了「Gateway 初始化」，现按模型拆回独立页。主体是**网关的包目录**，不是某台 Agent：
 * ① 取包来源 —— 安装端始终从网关自身的分发端点取包，这里配的是**网关的取包来源**：保存时网关
 *    立即把制品拉到本地包目录，新签发的安装命令、install.sh，以及之后的 Agent 升级都用这份缓存。
 *    未设置时使用网关内置的安装包。
 * ② 已录入的安装包 —— 包目录里现存的历史，每项含版本 / 架构 / 来源 / 摘要 / 录入时间；
 *    「Agent 升级」页从这里选包。
 *
 * 来源可以是本机绝对路径（包就在网关机上时）或 https 链接：落库后网关按自己的域名分发，
 * 所以本地路径不会漂到别的机器。
 *
 * 文案分工：页头只交代这一页管什么，卡头一行说明讲该项的状态语义，影响面归按钮旁的 hint，
 * 细节归字段自己的小字 —— 同一机制在一屏里最多出现两次。
 */
export function SubsystemAgentPackagePage() {
  const installPackage = useAgentInstallPackage();
  const setInstallPackage = useSetAgentInstallPackage();
  const packages = useInstallPackages();
  const queryClient = useQueryClient();

  const [packageUrl, setPackageUrl] = useState("");
  // 摘要框恒为「可选的期望值」，默认留空；当前实测摘要只在当前值区只读展示。
  // 不预填实测值是刻意的：把结果值当期望值提交，会在「同一 URL 内容更新」时必然报 400。
  const [packageSha256, setPackageSha256] = useState("");

  // 读到当前来源地址后回填：改摘要不改地址、或在现有地址上微调时不必重新粘贴。
  // 未设置来源地址时服务端返回空串，表单也留空（不要填分发端点 —— 那不是可用的来源）。
  useEffect(() => {
    if (!installPackage.data) return;
    setPackageUrl(installPackage.data.packageUrl);
  }, [installPackage.data]);

  const currentPackageUrl = installPackage.data?.packageUrl ?? "";
  const canSubmitPackage =
    packageUrl.trim().length > 0 && !setInstallPackage.isPending;
  const history = packages.data ?? [];

  function handlePackageSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmitPackage) return;
    setInstallPackage.mutate(
      {
        packageUrl: packageUrl.trim(),
        packageSha256: packageSha256.trim() || undefined,
      },
      {
        onSuccess: () => {
          // 期望值是「这一次保存」的输入：成功后即已用掉，清空以免下次保存又拿旧摘要去校验新内容。
          setPackageSha256("");
          // 保存会把制品录进包目录 → 历史列表要跟着刷新，否则刚保存的包不出现。
          void queryClient.invalidateQueries({
            queryKey: ["install-packages"],
          });
        },
      },
    );
  }

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>安装包</h1>
          <p className={styles.pageSummary}>
            安装包来源可以是本机绝对路径（包就在网关机上时）或 https 链接；保存时网关把制品读进自己的包目录，之后安装与升级都从网关按自己的域名分发 —— 本地路径因此不会漂到别的机器。
          </p>
        </header>

        <section
          className={styles.card}
          aria-labelledby="install-package-source"
        >
          <header className={styles.cardHead}>
            <span className={styles.cardTag}>网关取包来源</span>
            <h2 id="install-package-source">安装包来源</h2>
            <p>
              未设置时，网关分发它内置的安装包；设置后，保存时网关立即从该地址拉取制品，失败或摘要不符则整体拒绝。
            </p>
          </header>

          <dl className={styles.summaryList}>
            <div className={`${styles.summaryRow} ${styles.summaryRowPrimary}`}>
              <dt>当前来源</dt>
              <dd>
                {currentPackageUrl ? (
                  <>
                    <span className={styles.summaryValuePrimary}>
                      {currentPackageUrl}
                    </span>
                    <CopyButton
                      text={currentPackageUrl}
                      label="复制"
                      className={styles.inlineCopyButton}
                    />
                  </>
                ) : (
                  <span className={styles.summaryValueEmpty}>
                    未设置（使用网关内置包）
                  </span>
                )}
              </dd>
            </div>
            <div className={styles.summaryRow}>
              <dt>制品摘要</dt>
              <dd>
                <span className={styles.summaryValueMono}>
                  {installPackage.data?.packageSha256 ?? "—"}
                </span>
              </dd>
            </div>
            <div className={styles.summaryRow}>
              <dt>最后修改</dt>
              <dd>
                {/* dt 问的是「什么时候改的」，时间才是这个值；修改人是附带的元信息。 */}
                <span className={styles.summaryValueMono}>
                  {timestampText(installPackage.data?.updatedAt ?? null)}
                </span>
                {installPackage.data?.updatedBy ? (
                  <span className={styles.summaryMeta}>
                    {installPackage.data.updatedBy}
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>

          {installPackage.isLoading || installPackage.isError ? (
            <div className={styles.summaryNotices}>
              <LoadNotice
                loading={installPackage.isLoading}
                error={installPackage.isError ? installPackage.error : null}
              />
            </div>
          ) : null}

          <form className={styles.form} onSubmit={handlePackageSubmit}>
            <label className={styles.field}>
              <span>来源地址</span>
              <input
                type="text"
                value={packageUrl}
                onChange={(event) => setPackageUrl(event.target.value)}
                placeholder="https://mirror.example.com/wist/wist-agentd-<版本>-<arch>.tar.gz"
                autoComplete="off"
                required
              />
              <small>
                https:// 链接，或网关主机上的绝对路径（如 /srv/wist/agentd.tar.gz）；网关拒绝明文 http。发布产物是 tarball（内含 wist-agentd 与 wist-exec），install.sh 会自动解包安装。
              </small>
            </label>
            <label className={styles.field}>
              <span>期望摘要 sha256（可选）</span>
              <input
                type="text"
                value={packageSha256}
                onChange={(event) => setPackageSha256(event.target.value)}
                placeholder="64 位十六进制，可带 sha256: 前缀"
                autoComplete="off"
                spellCheck={false}
              />
              <small>
                留空即由网关按拉取到的内容计算并落库；填写则先按此值校验，不符直接拒绝保存。
              </small>
            </label>
            {setInstallPackage.isError ? (
              <div className={styles.errorBanner} role="alert">
                {packageSaveErrorMessage(setInstallPackage.error)}
              </div>
            ) : null}
            {setInstallPackage.isSuccess ? (
              <div className={styles.formNotice} role="status">
                已保存：网关已从该来源拉取到本地
                {setInstallPackage.data.packageSha256
                  ? `，制品摘要 ${setInstallPackage.data.packageSha256}。`
                  : "。"}
              </div>
            ) : null}
            <div className={styles.formActions}>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={!canSubmitPackage}
              >
                {setInstallPackage.isPending ? "正在保存…" : "保存"}
              </button>
              <span className={styles.actionHint}>
                只影响之后新签发的安装命令；已分发的不会改变。
              </span>
            </div>
          </form>
        </section>

        <section
          className={styles.card}
          aria-labelledby="install-package-history"
        >
          <header className={styles.cardHead}>
            <span className={styles.cardTag}>网关包目录</span>
            <h2 id="install-package-history">已录入的安装包</h2>
            <p>
              保存过一次来源后，网关就把制品存进自己的包目录并在这里存档；「Agent 升级」页从这份历史里选包。
            </p>
          </header>

          {packages.isLoading || packages.isError ? (
            <div className={styles.summaryNotices}>
              <LoadNotice
                loading={packages.isLoading}
                error={packages.isError ? packages.error : null}
              />
            </div>
          ) : null}

          {isEmptyPackageHistory({
            isLoading: packages.isLoading,
            isError: packages.isError,
            count: history.length,
          }) ? (
            <div className={styles.packageEmpty}>
              <strong>还没有录入过安装包</strong>
              <span>
                在上面填一个来源保存一次，网关会把它读进自己的包目录并存档；之后在「Agent 升级」页就能选它。
              </span>
            </div>
          ) : null}

          {!packages.isLoading && !packages.isError && history.length > 0 ? (
            <ul className={styles.packageList}>
              {history.map((pkg) => (
                <PackageHistoryRow key={pkg.packageId} pkg={pkg} />
              ))}
            </ul>
          ) : null}
        </section>
      </main>
    </div>
  );
}
