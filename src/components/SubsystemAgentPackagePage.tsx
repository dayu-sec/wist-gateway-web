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
import { sha256Error } from "../sha256";
import {
  PACKAGE_HISTORY_DISPLAY_LIMIT,
  isEmptyPackageHistory,
  packageLabel,
  packageShaLabel,
  recentPackages,
} from "./agentUpgradePackages";
import styles from "./SubsystemAgentPackagePage.module.css";

/**
 * agentd 的三个发布平台（target-triple）：网关按平台分别托管安装包。
 * `id` 与后端包内目录名解析出的 target-triple 一致。
 */
const PLATFORM_SLOTS = [
  { id: "x86_64-unknown-linux-musl", label: "Linux · x86_64 · musl" },
  { id: "aarch64-unknown-linux-musl", label: "Linux · ARM64 · musl" },
  { id: "aarch64-apple-darwin", label: "macOS · ARM" },
] as const;

const PLATFORM_LABELS: Record<string, string> = Object.fromEntries(
  PLATFORM_SLOTS.map((slot) => [slot.id, slot.label]),
);

function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}

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
 * **按平台**管理（agentd 是平台专用制品）：macOS-ARM + Linux x86_64/ARM64 各一份。
 * 三张卡按「现在是什么 → 有过什么 → 怎么加」排：
 * ① 当前安装包 —— 只读，逐平台列出当前生效的那一份（没添加过的平台即缺件，对应平台的新装会明确报错）。
 * ② 安装包历史 —— 网关包目录里添加过的制品，最多列最近 5 条；「Agent 升级」页从这份存档里选包。
 * ③ 添加安装包 —— 每个平台填来源地址（本机绝对路径或 https）后**一次提交三平台**：任一拉不到
 *    或摘要不符，整次添加都不生效（既不落库也不覆盖已有缓存）。
 *
 * 文案分工：页头只交代这一页管什么，卡头一行说明讲该卡的状态语义，影响面归按钮旁的 hint，
 * 细节归字段自己的小字 —— 同一机制在一屏里最多出现两次。
 */
export function SubsystemAgentPackagePage() {
  const installPackage = useAgentInstallPackage();
  const setInstallPackage = useSetAgentInstallPackage();
  const packages = useInstallPackages();
  const queryClient = useQueryClient();

  const blankRows = () =>
    PLATFORM_SLOTS.map((slot) => ({ platform: slot.id, url: "", sha256: "" }));
  const [rows, setRows] = useState(blankRows);
  // 两个框都不预填、成功后也都清空：这张卡的语义是**添加一个新包**。
  const [rowErrors, setRowErrors] = useState<(string | null)[]>(() =>
    PLATFORM_SLOTS.map(() => null),
  );

  const setting = installPackage.data ?? null;
  const current = setting?.packages ?? [];
  // 后端用「packages 为空」报「从未添加过」。
  const currentIsUnset = setting !== null && current.length === 0;
  const history = packages.data ?? [];
  const recentHistory = recentPackages(history, PACKAGE_HISTORY_DISPLAY_LIMIT);

  const canSubmitPackage = !setInstallPackage.isPending;

  function updateRow(
    index: number,
    patch: Partial<{ url: string; sha256: string }>,
  ) {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function setRowError(index: number, message: string | null) {
    setRowErrors((current) =>
      current.map((value, i) => (i === index ? message : value)),
    );
  }

  function handlePackageSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmitPackage) return;
    // 三平台都必填且摘要格式正确，否则当场拦下（省一次注定 400 的往返）。
    const nextErrors = rows.map((row) => {
      if (!row.url.trim()) return "请填写该平台的来源地址。";
      return sha256Error(row.sha256.trim());
    });
    if (nextErrors.some((message) => message)) {
      setRowErrors(nextErrors);
      return;
    }
    setRowErrors(PLATFORM_SLOTS.map(() => null));
    setInstallPackage.mutate(
      {
        artifacts: rows.map((row) => ({
          platform: row.platform,
          packageUrl: row.url.trim(),
          packageSha256: row.sha256.trim(),
        })),
      },
      {
        onSuccess: () => {
          // 这一次的输入已经用掉了：清空表单，让「添加」复位于一个空表单。
          setRows(blankRows());
          setRowErrors(PLATFORM_SLOTS.map(() => null));
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
            网关分发给 Agent 的安装包，按平台各托管一份（macOS-ARM + Linux
            x86_64/ARM64）。
          </p>
        </header>

        <section
          className={styles.card}
          aria-labelledby="install-package-current"
        >
          <header className={styles.cardHead}>
            <h2 id="install-package-current">当前安装包</h2>
            <p>新签发的安装命令与 install.sh 按目标平台取对应这一份。</p>
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
                网关没添加过安装包，新签发的安装命令与 install.sh
                这时候会明确报错（不会默默用一个旧包）。在下面按平台添加即可。
              </span>
            </div>
          ) : (
            <ul className={styles.packageList}>
              {current.map((entry) => (
                <li key={entry.platform} className={styles.packageRow}>
                  <div className={styles.packageRowTop}>
                    <span className={styles.packageLabel}>
                      {platformLabel(entry.platform)}
                    </span>
                    <span className={styles.packageTime}>
                      {timestampText(entry.updatedAt)}
                      {entry.updatedBy ? ` · ${entry.updatedBy}` : ""}
                    </span>
                  </div>
                  <div className={styles.packageRowMeta}>
                    <span
                      className={styles.packageSource}
                      title={entry.packageUrl}
                    >
                      {entry.packageUrl || "—"}
                    </span>
                    {entry.packageUrl ? (
                      <CopyButton
                        text={entry.packageUrl}
                        label="复制"
                        className={styles.inlineCopyButton}
                      />
                    ) : null}
                    <span className={styles.packageSha}>
                      {packageShaLabel(entry.packageSha256)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
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
            <p>
              agentd 是三平台制品：一次填齐三个平台的来源；任一拉不到或摘要不符，整次添加不生效。
            </p>
          </header>

          <form className={styles.form} onSubmit={handlePackageSubmit}>
            {PLATFORM_SLOTS.map((slot, index) => (
              <div key={slot.id} className={styles.variantBlock}>
                <div className={styles.variantTitle}>
                  <strong>{slot.label}</strong>
                  <code>{slot.id}</code>
                </div>
                <label className={styles.field}>
                  <span>来源地址</span>
                  <input
                    type="text"
                    value={rows[index].url}
                    onChange={(event) => {
                      updateRow(index, { url: event.target.value });
                      if (rowErrors[index]) setRowError(index, null);
                    }}
                    placeholder={`https://mirror.example.com/wist-agentd-<版本>-${slot.id}.tar.gz`}
                    autoComplete="off"
                    required
                  />
                </label>
                <label className={styles.field}>
                  <span>期望摘要 sha256（必填）</span>
                  <input
                    type="text"
                    value={rows[index].sha256}
                    onChange={(event) => {
                      updateRow(index, { sha256: event.target.value });
                      if (rowErrors[index]) setRowError(index, null);
                    }}
                    placeholder="64 位十六进制，可带 sha256: 前缀"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    aria-invalid={rowErrors[index] ? true : undefined}
                  />
                </label>
                {rowErrors[index] ? (
                  <div className={styles.errorBanner} role="alert">
                    {rowErrors[index]}
                  </div>
                ) : null}
              </div>
            ))}
            <small className={styles.fieldHint}>
              https:// 链接，或网关主机上的绝对路径（如
              /srv/wist/agentd.tar.gz）；不支持明文 http。摘要填发布侧 *.sha256
              里那串，网关先校验，不符即拒。
            </small>
            {setInstallPackage.isError ? (
              <div className={styles.errorBanner} role="alert">
                {packageAddErrorMessage(setInstallPackage.error)}
              </div>
            ) : null}
            {setInstallPackage.isSuccess ? (
              <div className={styles.formNotice} role="status">
                {`已添加：网关已从这些来源拉取到本地，并按平台设为当前分发包（共 ${setInstallPackage.data?.packages.length ?? 0} 个平台）。`}
              </div>
            ) : null}
            <div className={styles.formActions}>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={!canSubmitPackage}
              >
                {setInstallPackage.isPending ? "正在添加…" : "添加三平台"}
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
