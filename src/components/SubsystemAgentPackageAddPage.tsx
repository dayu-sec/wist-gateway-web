import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { versionFromArtifactUrl } from "@dayu-sec/wist-web-core/artifact";
import type {
  InstallPackageView,
  ResolvedGitHubRelease,
} from "../api/admin";
import {
  useInstallPackages,
  useResolveCosPath,
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
import {
  LoadNotice,
  packageAddErrorMessage,
  resolveSourceErrorMessage,
  timestampText,
  type ResolveSource,
} from "./agentPackageUi";
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
          <span className={styles.recentDate}>{timestampText(pkg.createdAt)}</span>
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
  const githubResolve = useResolveGitHubRelease();
  const cosResolve = useResolveCosPath();
  const queryClient = useQueryClient();

  const blankRows = () =>
    PLATFORM_SLOTS.map((slot) => ({ platform: slot.id, url: "", sha256: "" }));
  const [rows, setRows] = useState(blankRows);
  // 两个框都不预填、成功后也都清空：这张卡的语义是**录入一个新包**。
  const [rowErrors, setRowErrors] = useState<(string | null)[]>(() =>
    PLATFORM_SLOTS.map(() => null),
  );
  // 解析来源与输入：可选，一键把各平台资产填进对应槽位（对齐中心录入页的两种入口）。
  const [resolveSource, setResolveSource] = useState<ResolveSource>("github");
  const [sourceInput, setSourceInput] = useState("");
  const [resolveNote, setResolveNote] = useState<string | null>(null);
  const resolve = resolveSource === "github" ? githubResolve : cosResolve;

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

  /** 把一次解析结果按 target-triple 填进三个槽位；缺哪个就点名，不静默留空。 */
  function applyResolved(result: ResolvedGitHubRelease) {
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
  }

  function handleResolve() {
    const value = sourceInput.trim();
    if (!value) return;
    resolve.mutate(value, { onSuccess: applyResolved });
  }

  function selectResolveSource(next: ResolveSource) {
    if (next === resolveSource) return;
    setResolveSource(next);
    // 两种来源的输入不可互换（页面地址 vs 桶/前缀），切换就清掉，别留一个必然失败的值。
    setSourceInput("");
    setResolveNote(null);
    githubResolve.reset();
    cosResolve.reset();
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
              "把 agentd 的三个平台制品录进网关包目录；已托管包一览见「安装包管理」。",
              "Record the three agentd platform artifacts into the gateway's package catalog. The hosted list lives under Install packages.",
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
                "Agent 服务安装包，供接入本网关的 Agent 按平台拉取。多平台：一次录入三平台。",
                "The agent service package that agents connected to this gateway download per platform. Multi-platform: enter all three at once.",
              )}
            </p>
          </header>

          <form className={styles.form} onSubmit={handlePackageSubmit}>
            {/* 多平台提示放在表单最上面（对齐中心录入页）：三平台是一组，不是三个独立表单。 */}
            <p className={styles.variantsHint}>
              {t(
                "该组件为多平台：一次必须录入 ",
                "This component is multi-platform: enter all three artifacts at once — ",
              )}
              <strong>
                {PLATFORM_SLOTS.map((slot) => slot.label).join(" / ")}
              </strong>
              {t(
                " 三个制品（同一版本）。全部校验通过才会录入成功。",
                " (same version). Nothing is recorded unless every one passes validation.",
              )}
            </p>

            {/* 解析来源：GitHub Release 页面地址 / 腾讯 COS 路径。两个接口同形，
                只有「输入什么、网关怎么找」不同；填充与缺平台提示完全共用。 */}
            <div
              className={styles.sourceTabs}
              role="tablist"
              aria-label={t("解析来源", "Resolve source")}
            >
              {(["github", "cos"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={resolveSource === value}
                  className={
                    resolveSource === value
                      ? `${styles.sourceTab} ${styles.sourceTabActive}`
                      : styles.sourceTab
                  }
                  onClick={() => selectResolveSource(value)}
                >
                  {value === "github"
                    ? "GitHub Release"
                    : t("COS 路径", "COS path")}
                </button>
              ))}
            </div>

            <div className={styles.resolveField}>
              <label className={styles.resolveLabel} htmlFor="agent-package-source">
                {resolveSource === "github"
                  ? t(
                      "GitHub Release 地址（可选，一键填充）",
                      "GitHub Release URL (optional, one-click fill)",
                    )
                  : t(
                      "COS 路径（可选，一键填充）",
                      "COS path (optional, one-click fill)",
                    )}
              </label>
              <div className={styles.resolveControls}>
                <input
                  id="agent-package-source"
                  className={styles.resolveInput}
                  type="text"
                  value={sourceInput}
                  onChange={(event) => {
                    setSourceInput(event.target.value);
                    if (resolveNote) setResolveNote(null);
                  }}
                  onKeyDown={(event) => {
                    // 回车是「解析」，别把整个三平台表单提交掉（那会立刻跳到校验错误）。
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleResolve();
                    }
                  }}
                  placeholder={
                    resolveSource === "github"
                      ? "https://github.com/<owner>/<repo>/releases/tag/<tag>"
                      : t(
                          "桶/组件/版本，如 wist-1347593047/wist-agentd/v0.4.0-alpha",
                          "bucket/component/version, e.g. wist-1347593047/wist-agentd/v0.4.0-alpha",
                        )
                  }
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className={styles.resolveButton}
                  onClick={handleResolve}
                  disabled={resolve.isPending || !sourceInput.trim()}
                >
                  {resolve.isPending
                    ? t("解析中…", "Resolving…")
                    : t("解析并填充", "Resolve and fill")}
                </button>
              </div>
              <small className={styles.resolveHint}>
                {resolveSource === "github"
                  ? t(
                      "填 release 页面地址后点「解析并填充」：网关拉该 release 的资产，按 target-triple 自动填到对应平台槽位。",
                      "Enter the release page URL and click Resolve and fill: the gateway fetches that release's assets and fills them into the matching platform slots by target-triple.",
                    )
                  : t(
                      "填 COS 路径后点「解析并填充」：网关按发布命名约定展开该前缀下的三平台制品，并读回对象元数据里的 sha256。支持 cos://桶/前缀、桶/前缀，或带 region 的 COS 下载地址；未指定 region 时会逐个探测，可能要十几秒。",
                      "Enter a COS path and click Resolve and fill: the gateway expands the three platform artifacts under that prefix and reads their sha256 from object metadata. Accepts cos://bucket/prefix, bucket/prefix, or a region-qualified COS download URL; without a region it probes them in order, which can take a while.",
                    )}
              </small>
            </div>
            {resolve.error ? (
              <div className={styles.errorBanner} role="alert">
                {t("解析失败：{detail}", "Resolve failed: {detail}", {
                  detail: resolveSourceErrorMessage(resolve.error, resolveSource),
                })}
              </div>
            ) : null}
            {resolveNote ? <p className={styles.fieldHint}>{resolveNote}</p> : null}
            {PLATFORM_SLOTS.map((slot, index) => {
              const derivedVersion = versionFromArtifactUrl(rows[index].url);
              return (
                <div key={slot.id} className={styles.variantRow}>
                  <div className={styles.variantSlot}>
                    <strong>{slot.label}</strong>
                    <code>{slot.id}</code>
                  </div>
                  <label className={styles.field}>
                    <span>{t("产物地址（artifact_url）", "Artifact URL (artifact_url)")}</span>
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
                      title={rows[index].url || undefined}
                      required
                    />
                    <small>
                      {derivedVersion
                        ? t(
                            "预计版本 {version}（以包内目录名为准）",
                            "Expected version {version} (package directory wins)",
                            { version: derivedVersion },
                          )
                        : t(
                            "版本号从包地址自动解析。",
                            "The version is parsed from the artifact URL.",
                          )}
                    </small>
                  </label>
                  <label className={styles.field}>
                    <span>
                      {t(
                        "期望摘要（sha256，必填）",
                        "Expected digest (sha256, required)",
                      )}
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
                      title={rows[index].sha256 || undefined}
                      required
                      aria-invalid={rowErrors[index] ? true : undefined}
                    />
                  </label>
                  {rowErrors[index] ? (
                    <div className={styles.variantError} role="alert">
                      {rowErrors[index]}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <p className={styles.formNote}>
              {t(
                "https:// 链接，或网关主机上的绝对路径（如 /srv/wist/agentd.tar.gz）；不支持明文 http。摘要填发布侧 *.sha256 里那串，网关先校验，不符即拒。",
                "An https:// link, or an absolute path on the gateway host (for example /srv/wist/agentd.tar.gz); plain http is not supported. Use the digest from the release's *.sha256 file: the gateway verifies it first and rejects a mismatch.",
              )}
            </p>
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
            <div className={styles.submitBar}>
              <span className={styles.submitHint}>
                {t(
                  "三平台齐备后一次提交；缺任何一个都会被拒。只影响之后新签发的安装命令，已分发的不变。",
                  "All three platforms are submitted at once; missing any one is rejected. Affects only install commands issued afterwards; already distributed packages are unchanged.",
                )}
              </span>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={!canSubmitPackage}
              >
                {setInstallPackage.isPending
                  ? t("正在录入…", "Recording…")
                  : t("录入三平台", "Record all three platforms")}
              </button>
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
