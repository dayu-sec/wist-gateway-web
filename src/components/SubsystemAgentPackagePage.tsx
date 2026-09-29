import { useState, type FormEvent } from "react";
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
import {
  PACKAGE_HISTORY_DISPLAY_LIMIT,
  findCurrentPackage,
  isEmptyPackageHistory,
  packageLabel,
  packageShaLabel,
  recentPackages,
} from "./agentUpgradePackages";
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

/** 添加安装包失败时的提示（400 = 地址/摘要不合规，或摘要与来源内容不符；502 = 来源拉不到）。 */
function packageAddErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击“应用”。";
    if (error.status === 429) return "认证失败次数过多，请稍后再试。";
    if (error.status === 404)
      return "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。";
    // 后端已把具体原因写在正文里，优先透出它，操作者才知道该改哪里。
    if (error.detail) return `添加失败（HTTP ${error.status}）：${error.detail}`;
    if (error.status === 400)
      return "地址或摘要不符合要求：地址必须是 https:// 链接或本机绝对路径；摘要必须是 64 位十六进制（可带 sha256: 前缀）。";
    return `网关返回 HTTP ${error.status}，请检查网关日志。`;
  }
  return "添加失败：响应不符合当前契约，请检查网关与前端版本。";
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

/** 历史里的一行：版本 · 架构 + 添加时间在上，来源与摘要在下。 */
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
 * 「安装包」页（路由 `/install-package`）：网关分发给 Agent 的安装包。
 *
 * 三张卡按「现在是什么 → 有过什么 → 怎么加」排：
 * ① 当前安装包 —— 只读。新签发的安装命令与 install.sh 用的就是这一份；版本 / 架构只有在包目录里
 *    按**摘要**对齐到记录才报得出来（录入时来源与摘要同一次写进设置与包目录，摘要是唯一的公共键，
 *    见 `findCurrentPackage`）。没添加过 = **没有可用包**（网关没有内置包这条退路），安装命令会明确报错。
 * ② 安装包历史 —— 网关包目录里添加过的制品，最多列最近 5 条；「Agent 升级」页从这份存档里选包，
 *    那一页不受这一屏的显示上限影响。
 * ③ 添加安装包 —— 填来源地址（本机绝对路径或 https）后保存：网关先拉到本地，成功才落库并成为
 *    当前分发包；拉不到或摘要不符整次添加都不生效，既不落库也不覆盖已有缓存。
 *
 * 文案分工：页头只交代这一页管什么，卡头一行说明讲该卡的状态语义，影响面归按钮旁的 hint，
 * 细节归字段自己的小字 —— 同一机制在一屏里最多出现两次。
 */
export function SubsystemAgentPackagePage() {
  const installPackage = useAgentInstallPackage();
  const setInstallPackage = useSetAgentInstallPackage();
  const packages = useInstallPackages();
  const queryClient = useQueryClient();

  const [packageUrl, setPackageUrl] = useState("");
  // 两个框都不预填、成功后也都清空：这张卡的语义是**添加一个新包**，框里应该只有「这次要录入什么」。
  // 预填当前来源会让「添加」读起来像「把当前这份再存一次」；留上一次的输入则会让它看起来像个现值。
  // 摘要框本来就只描述**这一次**的期望值，留着旧值下次必被拿去校验新内容而误报。
  const [packageSha256, setPackageSha256] = useState("");

  const setting = installPackage.data ?? null;
  const currentSha256 = setting?.packageSha256 ?? null;
  // 后端用 `updatedAt === null` 报「从未添加过」（此时 url 为空串、摘要为 null），
  // 与「设置了一个空值」区分开。
  const currentIsUnset = setting !== null && setting.updatedAt === null;
  const history = packages.data ?? [];
  // 当前生效的那一份在包目录里的记录：只有它能补出版本 / 架构。
  const currentPackage = findCurrentPackage(history, currentSha256);
  const recentHistory = recentPackages(history, PACKAGE_HISTORY_DISPLAY_LIMIT);

  const canSubmitPackage =
    packageUrl.trim().length > 0 && !setInstallPackage.isPending;

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
          // 这一次的输入已经用掉了：清空两个框，让「添加」复位于一个空表单。
          setPackageUrl("");
          setPackageSha256("");
          // 添加会把制品录进包目录 → 历史列表与「当前安装包」都要跟着刷新。
          // （当前值那条查询由 useSetAgentInstallPackage 自己失效，这里只管包目录。）
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
            网关分发给 Agent 的安装包：当前生效的一份，与包目录里的存档。
          </p>
        </header>

        <section
          className={styles.card}
          aria-labelledby="install-package-current"
        >
          <header className={styles.cardHead}>
            <h2 id="install-package-current">当前安装包</h2>
            <p>新签发的安装命令与 install.sh 用的就是这一份。</p>
          </header>

          {installPackage.isLoading || installPackage.isError ? (
            <div className={styles.noticeBlock}>
              <LoadNotice
                loading={installPackage.isLoading}
                error={installPackage.isError ? installPackage.error : null}
              />
            </div>
          ) : currentIsUnset ? (
            <div className={styles.packageEmpty}>
              <strong>还没有可用的安装包</strong>
              <span>
                网关没添加过安装包，新签发的安装命令与 install.sh 这时候会明确报错（不会默默用一个旧包）。在下面填来源添加一份即可。
              </span>
            </div>
          ) : (
            /* 两行：上行「是哪一份」（版本 · 架构 + 生效时间），下行「从哪来」（来源 + 摘要）。
               四行 dt/dd 会把一张纯只读的卡铺得比下面的录入表单还高，而它要回答的只有这两问。 */
            <div className={styles.currentBody}>
              <div className={styles.currentLine}>
                {currentPackage ? (
                  <span className={styles.currentLabel}>
                    {packageLabel(currentPackage)}
                  </span>
                ) : (
                  <span className={styles.currentUnknown}>
                    未识别（包目录里没有对应记录）
                  </span>
                )}
                <span className={styles.currentTime}>
                  {timestampText(setting?.updatedAt ?? null)}
                  {setting?.updatedBy ? ` · ${setting.updatedBy}` : ""}
                </span>
              </div>
              <div className={styles.currentMeta}>
                {/* 来源与摘要各成一组：两组之间的间距要明显大于组内标签与值的间距，
                    否则四个成对的词会连成一串读不出配对关系。来源可长可短，由它让位。 */}
                <span className={`${styles.metaGroup} ${styles.metaGroupSource}`}>
                  <span className={styles.metaLabel}>来源</span>
                  <span
                    className={styles.metaValue}
                    title={setting?.packageUrl ?? ""}
                  >
                    {setting?.packageUrl || "—"}
                  </span>
                  {setting?.packageUrl ? (
                    <CopyButton
                      text={setting.packageUrl}
                      label="复制"
                      className={styles.inlineCopyButton}
                    />
                  ) : null}
                </span>
                <span className={`${styles.metaGroup} ${styles.metaGroupSha}`}>
                  <span className={styles.metaLabel}>摘要</span>
                  <span className={styles.metaSha} title={currentSha256 ?? ""}>
                    {packageShaLabel(currentSha256)}
                  </span>
                  {currentSha256 ? (
                    <CopyButton
                      text={currentSha256}
                      label="复制"
                      className={styles.inlineCopyButton}
                    />
                  ) : null}
                </span>
              </div>
            </div>
          )}
        </section>

        <section
          className={styles.card}
          aria-labelledby="install-package-history"
        >
          <header className={styles.cardHead}>
            <h2 id="install-package-history">安装包历史</h2>
            <p>
              {`最多列最近 ${PACKAGE_HISTORY_DISPLAY_LIMIT} 条；「Agent 升级」页从这份存档里选包。`}
            </p>
          </header>

          {packages.isLoading || packages.isError ? (
            <div className={styles.noticeBlock}>
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
              <strong>包目录还是空的</strong>
              <span>
                在下面「添加安装包」填一个来源保存一次，网关就会把制品读进这里。
              </span>
            </div>
          ) : null}

          {!packages.isLoading && !packages.isError && history.length > 0 ? (
            <ul className={styles.packageList}>
              {recentHistory.map((pkg) => (
                <PackageHistoryRow key={pkg.packageId} pkg={pkg} />
              ))}
            </ul>
          ) : null}

          {history.length > PACKAGE_HISTORY_DISPLAY_LIMIT ? (
            <p className={styles.packageMore}>
              {`共 ${history.length} 条，更早的未列出。`}
            </p>
          ) : null}
        </section>

        <section className={styles.card} aria-labelledby="install-package-add">
          <header className={styles.cardHead}>
            <h2 id="install-package-add">添加安装包</h2>
            <p>保存即从该地址拉取；拉不到或摘要不符，整次添加不生效。</p>
          </header>

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
                https:// 链接，或网关主机上的绝对路径（如 /srv/wist/agentd.tar.gz）；不支持明文 http。
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
                留空即按实际内容计算并落库；填写则先校验，不符即拒绝。
              </small>
            </label>
            {setInstallPackage.isError ? (
              <div className={styles.errorBanner} role="alert">
                {packageAddErrorMessage(setInstallPackage.error)}
              </div>
            ) : null}
            {setInstallPackage.isSuccess ? (
              <div className={styles.formNotice} role="status">
                {`已添加：网关已从该来源拉取到本地，并设为当前分发包${setInstallPackage.data.packageSha256 ? `（制品摘要 ${setInstallPackage.data.packageSha256}）` : ""}。`}
              </div>
            ) : null}
            <div className={styles.formActions}>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={!canSubmitPackage}
              >
                {setInstallPackage.isPending ? "正在添加…" : "添加"}
              </button>
              <span className={styles.actionHint}>
                只影响之后新签发的安装命令，已分发的不变。
              </span>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
