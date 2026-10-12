import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { InstallPackageView } from "../api/admin";
import {
  useInstallPackages,
  useResolveGitHubRelease,
  useSetAgentInstallPackage,
} from "../hooks";
import { CopyButton } from "./CopyButton";
import { sha256Error } from "../sha256";
import { t } from "../i18n";
import { PLATFORM_SLOTS, platformLabel } from "./agentPackagePlatforms";
import {
  PACKAGE_HISTORY_DISPLAY_LIMIT,
  isEmptyPackageHistory,
  recentPackages,
} from "./agentUpgradePackages";
import { LoadNotice, packageAddErrorMessage, timestampText } from "./agentPackageUi";
import styles from "./SubsystemAgentPackages.module.css";

/**
 * 「安装包录入」页（路由 `/install-package/add`）：把 agentd 的三个平台制品录进网关包目录。
 *
 * 形态对齐中心 `/packages/add`：独立一页、左上角返回列表，卡内是「提交 <组件> 新版本」的表单，
 * 表单下面跟着「最近录入」（中心那边叫同一名字）。三平台必须一次填齐：任一拉不到或摘要不符，
 * 整次录入都不生效（既不落库也不覆盖已有缓存），所以这里不做逐平台提交。
 *
 * 录完的制品会同时成为**当前分发包**（后端 `set_agent_install_package` 一个请求写设置 + 包目录），
 * 所以列表页的「在用」标记会跟着变；成功的回执里把这一点说清楚。
 */

/** 已录入的一条：版本 · 平台 + 来源 / 下载地址 / 摘要（录入页看的是「来源」，落盘位置在列表页）。 */
function RecentPackageItem({ pkg }: { pkg: InstallPackageView }) {
  const isLink = /^https?:\/\//i.test(pkg.source);
  return (
    <div className={styles.recentItem}>
      <div className={styles.recentHead}>
        <span className={styles.recentVersion}>{pkg.version || "—"}</span>
        <span className={styles.artifactPlatform}>
          {pkg.arch ? platformLabel(pkg.arch) : "—"}
        </span>
        <span className={styles.recentMeta}>
          <span className={styles.artifactNote}>{pkg.packageSha256}</span>
          <span>{timestampText(pkg.createdAt)}</span>
        </span>
      </div>
      <div className={styles.recentArtifacts}>
        <div className={styles.recentArtifact}>
          <span className={styles.artifactNote}>{t("来源", "Source")}</span>
          {isLink ? (
            <a
              className={styles.artifactSource}
              href={pkg.source}
              target="_blank"
              rel="noreferrer"
              title={pkg.source}
            >
              {pkg.source}
            </a>
          ) : (
            <span className={styles.artifactSource} title={pkg.source}>
              {pkg.source}
            </span>
          )}
        </div>
        <div className={styles.recentArtifact}>
          <span className={styles.artifactNote}>{t("下载地址", "Download URL")}</span>
          <span className={styles.artifactSource} title={pkg.agentPackageUrl}>
            {pkg.agentPackageUrl}
          </span>
          <CopyButton
            text={pkg.agentPackageUrl}
            label={t("复制", "Copy")}
            className={styles.inlineCopyButton}
          />
        </div>
      </div>
    </div>
  );
}

export function SubsystemAgentPackageAddPage() {
  const setInstallPackage = useSetAgentInstallPackage();
  const packages = useInstallPackages();
  const resolve = useResolveGitHubRelease();
  const queryClient = useQueryClient();

  const blankRows = () =>
    PLATFORM_SLOTS.map((slot) => ({ platform: slot.id, url: "", sha256: "" }));
  const [rows, setRows] = useState(blankRows);
  // 两个框都不预填、成功后也都清空：这张卡的语义是**录入一个新包**。
  const [rowErrors, setRowErrors] = useState<(string | null)[]>(() =>
    PLATFORM_SLOTS.map(() => null),
  );
  // GitHub Release 地址：可选，一键把各平台资产填进对应槽位（对齐 gops 的录入范式）。
  const [releaseUrl, setReleaseUrl] = useState("");
  const [resolveNote, setResolveNote] = useState<string | null>(null);

  const history = packages.data ?? [];
  const recentHistory = recentPackages(history, PACKAGE_HISTORY_DISPLAY_LIMIT);
  const canSubmitPackage = !setInstallPackage.isPending;

  function updateRow(index: number, patch: Partial<{ url: string; sha256: string }>) {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function setRowError(index: number, message: string | null) {
    setRowErrors((current) =>
      current.map((value, i) => (i === index ? message : value)),
    );
  }

  function handleResolve() {
    const url = releaseUrl.trim();
    if (!url) return;
    resolve.mutate(url, {
      onSuccess: (result) => {
        const missing: string[] = [];
        setRows((current) =>
          current.map((row, index) => {
            const slot = PLATFORM_SLOTS[index];
            const asset = result.assets.find((item) => item.platform === slot.id);
            if (!asset) {
              missing.push(slot.label);
              return row;
            }
            return { ...row, url: asset.artifactUrl, sha256: asset.sha256 ?? "" };
          }),
        );
        setRowErrors(PLATFORM_SLOTS.map(() => null));
        setResolveNote(
          missing.length === 0
            ? t(
                "已按 {version} 填充 {n} 个平台。",
                "Filled {n} platforms from {version}.",
                { version: result.version, n: PLATFORM_SLOTS.length },
              )
            : t(
                "{version}：已填充 {n} 个平台，缺少 {missing}，请手动补址（或该平台本次没有资产）。",
                "{version}: filled {n} platforms; missing {missing}. Fill in the URLs manually (or this release has no asset for that platform).",
                {
                  version: result.version,
                  n: PLATFORM_SLOTS.length - missing.length,
                  missing: missing.join(" / "),
                },
              ),
        );
      },
    });
  }

  function handlePackageSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmitPackage) return;
    // 三平台都必填且摘要格式正确，否则当场拦下（省一次注定 400 的往返）。
    const nextErrors = rows.map((row) => {
      if (!row.url.trim())
        return t("请填写该平台的来源地址。", "Enter the source URL for this platform.");
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
          // 这一次的输入已经用掉了：清空表单，让「录入」复位于一个空表单。
          setRows(blankRows());
          setRowErrors(PLATFORM_SLOTS.map(() => null));
          // 录入会把制品进包目录 → 「最近录入」与列表页的「已托管包」都要跟着刷新。
          // （当前值那条查询由 useSetAgentInstallPackage 自己失效，这里只管包目录。）
          void queryClient.invalidateQueries({ queryKey: ["install-packages"] });
        },
      },
    );
  }

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>{t("安装包录入", "Install package entry")}</h1>
          <p className={styles.pageSummary}>
            {t(
              "把 agentd 的三个平台制品录进网关包目录：摘要必填、一次填齐三平台，任一不符整次不生效。已托管包一览见「安装包管理」。",
              "Record the three agentd platform artifacts into the gateway's package catalog: the digest is required and all three platforms are submitted at once; if any one fails the whole entry has no effect. The hosted list lives under Install packages.",
            )}
          </p>
        </header>

        <div className={styles.pageActions}>
          <Link className={styles.backLink} to="/install-package">
            {t("← 返回包列表", "← Back to the package list")}
          </Link>
        </div>

        <section className={styles.card} aria-labelledby="install-package-add">
          <header className={styles.cardHead}>
            <h2 id="install-package-add">
              {t("提交 WistAgentd 新版本", "Submit a new WistAgentd version")}
            </h2>
            <p>
              {t(
                "agentd 是三平台制品：一次填齐三个平台的来源；任一拉不到或摘要不符，整次录入不生效。",
                "agentd is a three-platform artifact: fill in all three platform sources at once. If any source cannot be fetched or its digest does not match, the whole entry has no effect.",
              )}
            </p>
          </header>

          <form className={styles.form} onSubmit={handlePackageSubmit}>
            <div className={styles.resolveBlock}>
              <label className={styles.field}>
                <span>
                  {t(
                    "GitHub Release 地址（可选，一键填充）",
                    "GitHub Release URL (optional, one-click fill)",
                  )}
                </span>
                <input
                  type="text"
                  value={releaseUrl}
                  onChange={(event) => {
                    setReleaseUrl(event.target.value);
                    if (resolveNote) setResolveNote(null);
                  }}
                  placeholder="https://github.com/<owner>/<repo>/releases/tag/<tag>"
                  autoComplete="off"
                  spellCheck={false}
                />
                <small>
                  {t(
                    "填 release 页面地址后点「解析并填充」：网关拉该 release 的资产，按 target-triple 自动填到对应平台槽位。",
                    "Enter the release page URL and click Resolve and fill: the gateway fetches that release's assets and fills them into the matching platform slots by target-triple.",
                  )}
                </small>
              </label>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={handleResolve}
                disabled={resolve.isPending || !releaseUrl.trim()}
              >
                {resolve.isPending
                  ? t("解析中…", "Resolving…")
                  : t("解析并填充", "Resolve and fill")}
              </button>
            </div>
            {resolve.error ? (
              <div className={styles.errorBanner} role="alert">
                {t("解析失败：{detail}", "Resolve failed: {detail}", {
                  detail: packageAddErrorMessage(resolve.error),
                })}
              </div>
            ) : null}
            {resolveNote ? <p className={styles.fieldHint}>{resolveNote}</p> : null}
            {PLATFORM_SLOTS.map((slot, index) => (
              <div key={slot.id} className={styles.variantBlock}>
                <div className={styles.variantTitle}>
                  <strong>{slot.label}</strong>
                  <code>{slot.id}</code>
                </div>
                <label className={styles.field}>
                  <span>{t("来源地址", "Source URL")}</span>
                  <input
                    type="text"
                    value={rows[index].url}
                    onChange={(event) => {
                      updateRow(index, { url: event.target.value });
                      if (rowErrors[index]) setRowError(index, null);
                    }}
                    placeholder={t(
                      "https://mirror.example.com/wist-agentd-<版本>-{platform}.tar.gz",
                      "https://mirror.example.com/wist-agentd-<version>-{platform}.tar.gz",
                      { platform: slot.id },
                    )}
                    autoComplete="off"
                    required
                  />
                </label>
                <label className={styles.field}>
                  <span>
                    {t("期望摘要 sha256（必填）", "Expected digest sha256 (required)")}
                  </span>
                  <input
                    type="text"
                    value={rows[index].sha256}
                    onChange={(event) => {
                      updateRow(index, { sha256: event.target.value });
                      if (rowErrors[index]) setRowError(index, null);
                    }}
                    placeholder={t(
                      "64 位十六进制，可带 sha256: 前缀",
                      "64 hex characters, optional sha256: prefix",
                    )}
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
              {t(
                "https:// 链接，或网关主机上的绝对路径（如 /srv/wist/agentd.tar.gz）；不支持明文 http。摘要填发布侧 *.sha256 里那串，网关先校验，不符即拒。",
                "An https:// link, or an absolute path on the gateway host (for example /srv/wist/agentd.tar.gz); plain http is not supported. Use the digest from the release's *.sha256 file: the gateway verifies it first and rejects a mismatch.",
              )}
            </small>
            {setInstallPackage.isError ? (
              <div className={styles.errorBanner} role="alert">
                {packageAddErrorMessage(setInstallPackage.error)}
              </div>
            ) : null}
            {setInstallPackage.isSuccess ? (
              <div className={styles.formNotice} role="status">
                {t(
                  "已录入：网关已从这些来源拉取到本地，并按平台设为当前分发包（共 {n} 个平台）。",
                  "Recorded: the gateway fetched these sources locally and set them as the current distribution package per platform ({n} platforms).",
                  { n: setInstallPackage.data?.packages.length ?? 0 },
                )}
              </div>
            ) : null}
            <div className={styles.formActions}>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={!canSubmitPackage}
              >
                {setInstallPackage.isPending
                  ? t("正在录入…", "Recording…")
                  : t("录入三平台", "Record all three platforms")}
              </button>
              <span className={styles.actionHint}>
                {t(
                  "只影响之后新签发的安装命令，已分发的不变。",
                  "Affects only install commands issued afterwards; already distributed packages are unchanged.",
                )}
              </span>
            </div>
          </form>
        </section>

        <section className={styles.card} aria-labelledby="install-package-recent">
          <header className={styles.cardHead}>
            <h2 id="install-package-recent">{t("最近录入", "Recently recorded")}</h2>
            <p>
              {t(
                "最多列最近 {limit} 条；「Agent 升级」页从这份存档里选包。",
                "Lists at most the latest {limit} entries; the Agent upgrade page picks packages from this archive.",
                { limit: PACKAGE_HISTORY_DISPLAY_LIMIT },
              )}
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
              <strong>{t("包目录还是空的", "The package catalog is still empty")}</strong>
              <span>
                {t(
                  "在上面填一次来源保存，网关就会把制品读进这里。",
                  "Fill in sources above and save once; the gateway will read the artifacts into this list.",
                )}
              </span>
            </div>
          ) : null}

          {!packages.isLoading && !packages.isError && history.length > 0 ? (
            <div className={styles.recent}>
              {recentHistory.map((pkg) => (
                <RecentPackageItem key={pkg.packageId} pkg={pkg} />
              ))}
            </div>
          ) : null}

          {history.length > PACKAGE_HISTORY_DISPLAY_LIMIT ? (
            <p className={styles.packageMore}>
              {t("共 {n} 条，更早的未列出。", "{n} in total; earlier entries are not listed.", {
                n: history.length,
              })}
            </p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
