import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { isRateLimitedError } from "../api";
import {
  useActivateKnowledgePackage,
  useContentCatalog,
  useKnowledge,
  useKnowledgeLocks,
  useKnowledgePackages,
  useRecordKnowledgePackage,
} from "../hooks";
import { ContentFamilyOverview } from "./ContentFamilyOverview";
import { CopyButton } from "./CopyButton";
import { RateLimitNotice } from "./RateLimitNotice";
import { t } from "../i18n";
import { sha256Error } from "../sha256";
import {
  findActiveKnowledgePackage,
  knowledgeActionErrorMessage,
  knowledgeLoadErrorMessage,
  knowledgePackageVersionSummary,
  knowledgeShaLabel,
  knowledgeSignatureLabel,
  knowledgeSourceKind,
  knowledgeSourceText,
  knowledgeVersionLabel,
  knowledgeVersionSummary,
  lockedWorkTotal,
  rollbackTarget,
  staleLocks,
} from "./knowledgeContent";
import styles from "./SubsystemKnowledgePage.module.css";

function timestampText(value: string | null): string {
  if (!value) return "—";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString();
}

/** 两次确认的第二跳要干什么。 */
interface PendingAction {
  kind: "activate" | "rollback";
  packageId: string;
  /** 对话框里点名的对象（人读）。 */
  label: string;
}

/**
 * 「知识库」页（路由 `/knowledge`）：网关装载的**策展内容**（采集目录 / 包 / 模板 + 用途规则 +
 * 发现策略）的管理面 —— 录入、激活、回滚，以及「谁还锁在旧版目录」。
 *
 * 为什么要有这一页：这些内容过去靠改配置文件 + 重启网关，现场连「装的是哪一版」都答不上来；
 * 现在它像 Agent 安装包一样是**可下载的制品**（`wist-knowledge` 的 Release 附件），
 * 网关侧要有一个录入与切换的入口（设计
 * `wist-gateway/docs/design/knowledge-content-management.md` §12）。
 *
 * 三条语义在页面上必须看得见：
 * 1. **录入 ≠ 生效**：录入只落盘登记，激活才切指针；所以历史表里「已录入但没生效」是正常状态。
 * 2. **空载不是错误**：未配置时给「为什么会这样 + 怎么办」，而不是一个只能靠日志猜的哑谜（§8.7）。
 * 3. **换版不追改在跑的工作**（§8.3）：旧版目录上有工作就显示出来 —— 那是合规边界，不能悄悄扩大。
 *
 * 两个动作（激活 / 回滚）都要**两次确认**（同「删除离线 Agent」的既有口径）：它们改变的是
 * 全平台事实推断与派活的输入，点错的代价是「所有 Agent 的内容一起变了」。
 */
export function SubsystemKnowledgePage() {
  const knowledge = useKnowledge();
  const packages = useKnowledgePackages();
  const locks = useKnowledgeLocks();
  const catalog = useContentCatalog();
  const record = useRecordKnowledgePackage();
  const activate = useActivateKnowledgePackage();

  // 两个 tab 答的是两个问题：「哪一版内容在生效」与「这一版里有哪些面」。
  // tab 落在 URL 上（`?view=families`）：可直接分享 / 收藏到全景页，刷新也不会跳回去。
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: "packages" | "families" =
    searchParams.get("view") === "families" ? "families" : "packages";
  function selectTab(next: "packages" | "families") {
    const params = new URLSearchParams(searchParams);
    // 默认视图不写进 URL：`/knowledge` 就是「知识包」，链接保持短。
    if (next === "families") params.set("view", "families");
    else params.delete("view");
    // replace：切 tab 是换视图，不是导航，不该堆历史记录。
    setSearchParams(params, { replace: true });
  }

  const [source, setSource] = useState("");
  const [sha256, setSha256] = useState("");
  const [shaFormError, setShaFormError] = useState<string | null>(null);
  const [activateNow, setActivateNow] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const current = knowledge.data ?? null;
  const history = packages.data ?? [];
  const activePackageId = current?.packageId ?? null;
  const activePkg = findActiveKnowledgePackage(history, activePackageId);
  const rollback = current ? rollbackTarget(current, history) : null;
  // 「已录入但没生效」是可以的，所以历史表要能一眼分出「生效」与「只是存着」。
  // 来源态：`package` 才走「生效包」那套（有 id、可回滚）；`dir` 是出厂初始包（有内容但不走
  // 管理面）；两者都不是才算过渡态。以前只认 `package`，于是初始包被说成「从配置文件装载（过渡态）」。
  const sourceKind = current ? knowledgeSourceKind(current.source) : "none";
  const isPackageMode = sourceKind === "package";

  const canSubmit = source.trim().length > 0 && !record.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const digest = sha256.trim();
    // 摘要是**必填**：提交前先拦一道，省一次注定 400 的往返，并当场说清哪里不对。
    const error = sha256Error(digest);
    if (error) {
      setShaFormError(error);
      return;
    }
    setShaFormError(null);
    record.mutate(
      {
        source: source.trim(),
        sha256: digest,
        activate: activateNow,
      },
      {
        onSuccess: () => {
          // 这一次的输入已经用掉了：清空输入，让「录入」复位于一个空表单（同安装包页）。
          // 摘要框本来就只描述**这一次**的期望值，留着必被拿去校验下一份内容而误报。
          setSource("");
          setSha256("");
          setShaFormError(null);
          setActivateNow(false);
        },
      },
    );
  }

  function openConfirm(action: PendingAction) {
    activate.reset();
    setPending(action);
  }

  function closeConfirm() {
    if (activate.isPending) return;
    activate.reset();
    setPending(null);
  }

  function confirmAction() {
    if (!pending) return;
    activate.mutate(
      {
        packageId: pending.packageId,
        command: {
          reason: pending.kind === "rollback" ? "rollback" : "activate",
        },
      },
      { onSuccess: () => setPending(null) },
    );
  }

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>{t("知识库", "Knowledge base")}</h1>
          <p className={styles.pageSummary}>
            {t(
              "网关装载的策展内容（采集目录 / 包 / 模板 + 用途规则 + 发现策略）。 内容以包为单位发布（来自 wist-knowledge 的 Release 附件），在这里录入并切换生效版本 —— 切换不重启网关。",
              "Curated content loaded by the gateway (collection catalog / packages / templates + purpose rules + discovery policy). Content is published in packages (Release assets from wist-knowledge); record them here and switch the active version — switching does not restart the gateway.",
            )}
          </p>
        </header>

        <div className={styles.tabs} role="tablist" aria-label={t("知识库视图", "Knowledge views")}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "packages"}
            className={`${styles.tab} ${tab === "packages" ? styles.tabActive : ""}`}
            onClick={() => selectTab("packages")}
          >
            {t("知识包", "Packages")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "families"}
            className={`${styles.tab} ${tab === "families" ? styles.tabActive : ""}`}
            onClick={() => selectTab("families")}
          >
            {t("采集面", "Collection families")}
          </button>
        </div>

        {tab === "families" ? (
          <ContentFamilyOverview
            catalog={catalog.data ?? null}
            loading={catalog.isLoading}
            error={catalog.isError ? catalog.error : null}
          />
        ) : (
          <>
        {/* ① 当前生效 */}
        <section className={styles.card} aria-labelledby="knowledge-current">
          <header className={styles.cardHead}>
            <h2 id="knowledge-current">{t("当前生效", "Currently active")}</h2>
            <p>
              {t(
                "事实入库用的目录 / 模板、用途推断用的规则、发现方向策略，都以这一版为准。",
                "The catalog / templates used for fact ingestion, the rules used for purpose inference and the discovery policy all follow this version.",
              )}
            </p>
          </header>

          {knowledge.isLoading || knowledge.isError ? (
            <div className={styles.noticeBlock}>
              {knowledge.isLoading ? (
                <div className={styles.notice} role="status">
                  {t("正在读取当前生效的知识库…", "Loading the active knowledge base…")}
                </div>
              ) : null}
              {knowledge.isError ? (
                isRateLimitedError(knowledge.error) ? (
                  <RateLimitNotice error={knowledge.error} />
                ) : (
                  <div className={styles.noticeDanger} role="alert">
                    {knowledgeLoadErrorMessage(knowledge.error)}
                  </div>
                )
              ) : null}
            </div>
          ) : null}

          {current && !current.configured ? (
            <div className={styles.empty}>
              <strong>{t("知识库未配置（空载）", "Knowledge base not configured (empty)")}</strong>
              <span>
                {current.hint ??
                  t(
                    "网关没有装载任何策展内容：不产「系统类型」建议与用途建议，发现策略用 agentd 内建默认值。录入一个包并激活即可。",
                    "The gateway has no curated content loaded: it produces no “system type” or purpose suggestions, and the discovery policy falls back to agentd built-in defaults. Record a package and activate it to fix this.",
                  )}
              </span>
            </div>
          ) : null}

          {current && current.configured ? (
            <div className={styles.currentBody}>
              <div className={styles.currentLine}>
                {isPackageMode ? (
                  activePkg ? (
                    <span className={styles.currentLabel}>
                      {knowledgeVersionLabel(activePkg)}
                    </span>
                  ) : (
                    // 生效态与录入历史是两个来源：对齐不上就如实说未识别，别装作有值。
                    <span className={styles.currentUnknown}>
                      {t("未识别（录入历史里没有这一版）", "Unrecognized (this version is not in the record history)")}
                    </span>
                  )
                ) : (
                  <span
                    className={
                      sourceKind === "initial"
                        ? styles.currentLabel
                        : styles.currentUnknown
                    }
                  >
                    {knowledgeSourceText(sourceKind)}
                  </span>
                )}
                <span className={styles.currentTime}>
                  {current.active
                    ? `${timestampText(current.active.activatedAt)} · ${current.active.activatedBy}`
                    : "—"}
                </span>
              </div>

              <div className={styles.currentMeta}>
                <span className={`${styles.metaGroup} ${styles.metaGroupPkg}`}>
                  <span className={styles.metaLabel}>{t("包", "Package")}</span>
                  <span
                    className={styles.metaValue}
                    title={activePackageId ?? ""}
                  >
                    {activePackageId ?? "—"}
                  </span>
                  {activePackageId ? (
                    <CopyButton
                      text={activePackageId}
                      label={t("复制", "Copy")}
                      className={styles.inlineCopyButton}
                    />
                  ) : null}
                </span>
                <span
                  className={`${styles.metaGroup} ${styles.metaGroupVersions}`}
                >
                  <span className={styles.metaLabel}>{t("内容版本", "Content version")}</span>
                  <span className={styles.metaValue}>
                    {knowledgeVersionSummary(current) || "—"}
                  </span>
                </span>
                <span
                  className={`${styles.metaGroup} ${styles.metaGroupGeneration}`}
                >
                  <span className={styles.metaLabel}>{t("世代", "Generation")}</span>
                  <span
                    className={styles.metaSha}
                    title={t(
                      "每次激活 +1；派生结果「算自哪一版」的表级锚",
                      "Increments by 1 on every activation; the table-level anchor for which version a derived result was computed from",
                    )}
                  >
                    {current.generation}
                  </span>
                </span>
              </div>

              {rollback ? (
                <div className={styles.rollbackRow}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={rollback.blockedReason !== null}
                    title={rollback.blockedReason ?? undefined}
                    onClick={() =>
                      openConfirm({
                        kind: "rollback",
                        packageId: rollback.packageId,
                        label: rollback.pkg
                          ? knowledgeVersionLabel(rollback.pkg)
                          : rollback.packageId,
                      })
                    }
                  >
                    {rollback.pkg
                      ? t(
                          "回滚到上一版（{version}）",
                          "Roll back to previous version ({version})",
                          { version: knowledgeVersionLabel(rollback.pkg) },
                        )
                      : t("回滚到上一版", "Roll back to previous version")}
                  </button>
                  <span className={styles.actionHint}>
                    {rollback.blockedReason ??
                      t(
                        "把生效指针指回上一版；已经派出去的工作不跟着改。",
                        "Points the active pointer back to the previous version; already-dispatched work does not follow.",
                      )}
                  </span>
                </div>
              ) : null}

              {current.activations.length > 0 ? (
                <div className={styles.switchLog}>
                  <span className={styles.metaLabel}>{t("最近切换", "Recent switches")}</span>
                  <ul className={styles.switchLogList}>
                    {current.activations.slice(0, 3).map((entry) => (
                      <li
                        key={`${entry.generation}-${entry.toPackage}`}
                        className={styles.switchLogRow}
                      >
                        <span className={styles.switchLogText}>
                          {entry.fromPackage
                            ? `${entry.fromPackage} → ${entry.toPackage}`
                            : t("（首次）→ {pkg}", "(first) → {pkg}", {
                                pkg: entry.toPackage,
                              })}
                        </span>
                        <span className={styles.switchLogMeta}>
                          {`#${entry.generation} ${entry.reason} · ${timestampText(entry.createdAt)} · ${entry.requestedBy}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* ② 锁在旧版目录的工作（§8.3）：换版不追改在跑的工作，所以要看得见 */}
        {locks.data && lockedWorkTotal(locks.data) > 0 ? (
          <section className={styles.card} aria-labelledby="knowledge-locks">
            <header className={styles.cardHead}>
              <h2 id="knowledge-locks">{t("锁在旧版目录的工作", "Work locked to an older catalog")}</h2>
              <p>
                {t(
                  "换版不追改在跑的工作 —— 采集范围是合规边界，不能因为换了内容就悄悄扩大。这些工作会一直按它们派出去时那一版目录跑。",
                  "Switching versions does not rewrite running work — the collection scope is a compliance boundary and must not silently widen because the content changed. This work keeps running against the catalog it was dispatched with.",
                )}
              </p>
            </header>
            <div className={styles.lockBody}>
              <div className={styles.lockTotal}>
                {locks.data.activeCatalogVersion !== null
                  ? t(
                      "共 {n} 件常驻工作锁在旧版目录上（当前生效目录版本：{version}）",
                      "{n} standing work items are locked to an older catalog (active catalog version: {version})",
                      {
                        n: lockedWorkTotal(locks.data),
                        version: locks.data.activeCatalogVersion,
                      },
                    )
                  : t(
                      "共 {n} 件常驻工作锁在旧版目录上",
                      "{n} standing work items are locked to an older catalog",
                      { n: lockedWorkTotal(locks.data) },
                    )}
              </div>
              <ul className={styles.lockList}>
                {staleLocks(locks.data).length > 0 ? (
                  staleLocks(locks.data).map((entry) => (
                    <li key={entry.catalogVersion} className={styles.lockRow}>
                      <span className={styles.lockVersion}>
                        {t("目录 {version}", "Catalog {version}", {
                          version: entry.catalogVersion,
                        })}
                      </span>
                      <span className={styles.lockWorks}>
                        {t("{n} 件", "{n} items", { n: entry.works })}
                      </span>
                    </li>
                  ))
                ) : (
                  <li className={styles.lockRow}>
                    <span className={styles.lockWorks}>
                      {t(
                        "全部工作都已经在生效目录版本上。",
                        "All work is already on the active catalog version.",
                      )}
                    </span>
                  </li>
                )}
              </ul>
            </div>
          </section>
        ) : null}

        {/* ③ 录入历史 */}
        <section className={styles.card} aria-labelledby="knowledge-history">
          <header className={styles.cardHead}>
            <h2 id="knowledge-history">{t("录入历史", "Record history")}</h2>
            <p>
              {t(
                "「设为生效」切的是全平台；已经派出去的工作不跟着改（见上一张卡）。",
                "“Set active” switches the whole platform; already-dispatched work does not follow (see the card above).",
              )}
            </p>
          </header>

          {packages.isLoading || packages.isError ? (
            <div className={styles.noticeBlock}>
              {packages.isLoading ? (
                <div className={styles.notice} role="status">
                  {t("正在读取录入历史…", "Loading record history…")}
                </div>
              ) : null}
              {packages.isError ? (
                isRateLimitedError(packages.error) ? (
                  <RateLimitNotice error={packages.error} />
                ) : (
                  <div className={styles.noticeDanger} role="alert">
                    {knowledgeLoadErrorMessage(packages.error)}
                  </div>
                )
              ) : null}
            </div>
          ) : null}

          {!packages.isLoading && !packages.isError && history.length === 0 ? (
            <div className={styles.empty}>
              <strong>{t("还没有录入过任何包", "No packages recorded yet")}</strong>
              <span>
                {t(
                  "在下面「录入知识库包」填一个来源保存一次。包来自 wist-knowledge 的 Release 附件（",
                  "Fill in a source under “Record knowledge package” below and save once. Packages come from wist-knowledge Release assets (",
                )}
                <code className={styles.code}>.tar.gz</code>{" "}
                {t("与其", "and the matching ")}
                <code className={styles.code}>.sha256</code>
                {t(
                  "）；离线环境用 stack 的 ",
                  "); in offline environments, deploy them with the stack's ",
                )}
                <code className={styles.code}>scripts/import-knowledge.sh</code>{" "}
                {t("投放后再录。", "and then record them.")}
              </span>
            </div>
          ) : null}

          {history.length > 0 ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{t("版本", "Version")}</th>
                    <th scope="col">{t("内容版本", "Content version")}</th>
                    <th scope="col">{t("摘要 / 验签", "Digest / signature")}</th>
                    <th scope="col">{t("录入", "Recorded")}</th>
                    <th scope="col">{t("状态", "Status")}</th>
                    <th scope="col" className={styles.thAction}>
                      <span className={styles.srOnly}>{t("操作", "Actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((pkg) => {
                    const isActive = pkg.packageId === activePackageId;
                    return (
                      <tr key={pkg.packageId}>
                        <td className={styles.tdVersion}>
                          <span className={styles.versionLabel}>
                            {knowledgeVersionLabel(pkg)}
                          </span>
                          <span
                            className={styles.versionMeta}
                            title={pkg.packageId}
                          >
                            {pkg.packageId}
                          </span>
                        </td>
                        <td className={styles.tdMuted}>
                          {knowledgePackageVersionSummary(pkg) || "—"}
                        </td>
                        <td className={styles.tdMuted}>
                          <span
                            className={styles.shaValue}
                            title={pkg.packageSha256}
                          >
                            {knowledgeShaLabel(pkg.packageSha256)}
                          </span>
                          <span
                            className={styles.signature}
                            title={pkg.signedBy || undefined}
                          >
                            {knowledgeSignatureLabel(pkg)}
                          </span>
                        </td>
                        <td className={styles.tdMuted}>
                          <span className={styles.createdBy}>
                            {pkg.createdBy || "—"}
                          </span>
                          <span className={styles.createdAt}>
                            {timestampText(pkg.createdAt)}
                          </span>
                        </td>
                        <td>
                          {isActive ? (
                            <span
                              className={`${styles.badge} ${styles.badgeActive}`}
                            >
                              {t("生效中", "Active")}
                            </span>
                          ) : !pkg.available ? (
                            <span
                              className={`${styles.badge} ${styles.badgeGone}`}
                            >
                              {t("副本缺失", "Copy missing")}
                            </span>
                          ) : (
                            <span
                              className={`${styles.badge} ${styles.badgeStored}`}
                            >
                              {t("已录入", "Recorded")}
                            </span>
                          )}
                        </td>
                        <td className={styles.tdAction}>
                          <button
                            type="button"
                            className={styles.activateButton}
                            disabled={isActive || !pkg.available}
                            title={
                              isActive
                                ? t("这一版已经在生效", "This version is already active")
                                : !pkg.available
                                  ? t(
                                      "副本已不在网关（包目录被手工清过，或备份还原不完整）",
                                      "The copy is no longer on the gateway (the package directory was cleaned up by hand, or a restore was incomplete)",
                                    )
                                  : t("切到这一版（两次确认）", "Switch to this version (double confirmation)")
                            }
                            onClick={() =>
                              openConfirm({
                                kind: "activate",
                                packageId: pkg.packageId,
                                label: knowledgeVersionLabel(pkg),
                              })
                            }
                          >
                            {t("设为生效", "Set active")}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        {/* ④ 录入 */}
        <section className={styles.card} aria-labelledby="knowledge-record">
          <header className={styles.cardHead}>
            <h2 id="knowledge-record">{t("录入知识库包", "Record knowledge package")}</h2>
            <p>
              {t(
                "录入只落盘登记；除非勾上「立即激活」，否则不改变现状。",
                "Recording only writes a registration; unless “Activate immediately” is checked, nothing changes.",
              )}
            </p>
          </header>

          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.field}>
              <span>{t("来源地址", "Source URL")}</span>
              <input
                type="text"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="https://github.com/dayu-sec/wist-knowledge/releases/download/v0.1.1/wist-knowledge-0.1.1.tar.gz"
                autoComplete="off"
                required
              />
              <small>
                {t(
                  "https:// 链接，或「网关容器内」的绝对路径（宿主路径容器里看不见；离线投放见 stack 的 import-knowledge.sh）。不支持明文 http。",
                  "An https:// link, or an absolute path inside the gateway container (host paths are invisible in the container; for offline deployment see the stack's import-knowledge.sh). Plain http is not supported.",
                )}
              </small>
            </label>
            <label className={styles.field}>
              <span>{t("期望摘要 sha256（必填）", "Expected digest sha256 (required)")}</span>
              <input
                type="text"
                value={sha256}
                onChange={(event) => {
                  setSha256(event.target.value);
                  if (shaFormError) setShaFormError(null);
                }}
                placeholder={t("64 位十六进制，可带 sha256: 前缀", "64 hex characters, optionally prefixed with sha256:")}
                autoComplete="off"
                spellCheck={false}
                required
                aria-invalid={shaFormError ? true : undefined}
              />
              <small>
                {t(
                  "必填：填发布侧 *.sha256 里那串（算的是来源 tarball 的字节）；网关先校验，不符即拒绝。",
                  "Required: paste the value from the published *.sha256 (it covers the source tarball bytes); the gateway verifies it first and rejects a mismatch.",
                )}
              </small>
            </label>
            <label className={styles.checkboxField}>
              <input
                type="checkbox"
                checked={activateNow}
                onChange={(event) => setActivateNow(event.target.checked)}
              />
              <span>
                {t("立即激活", "Activate immediately")}
                <small>
                  {t(
                    "录入成功后马上切到这一版；不勾则先登记，之后在历史里点「设为生效」。",
                    "Switch to this version as soon as recording succeeds; if unchecked, it is only registered and you can click “Set active” in the history later.",
                  )}
                </small>
              </span>
            </label>

            {shaFormError ? (
              <div className={styles.errorBanner} role="alert">
                {shaFormError}
              </div>
            ) : null}
            {record.isError ? (
              <div className={styles.errorBanner} role="alert">
                {knowledgeActionErrorMessage(record.error, "录入")}
              </div>
            ) : null}
            {record.isSuccess ? (
              <div className={styles.formNotice} role="status">
                {record.data.active
                  ? t(
                      "已录入 {version}（{id}），并已切换为生效版本。",
                      "Recorded {version} ({id}) and switched to it as the active version.",
                      {
                        version: knowledgeVersionLabel(record.data),
                        id: record.data.packageId,
                      },
                    )
                  : t(
                      "已录入 {version}（{id}），尚未生效。",
                      "Recorded {version} ({id}); not active yet.",
                      {
                        version: knowledgeVersionLabel(record.data),
                        id: record.data.packageId,
                      },
                    )}
              </div>
            ) : null}

            <div className={styles.formActions}>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={!canSubmit}
              >
                {record.isPending ? t("正在录入…", "Recording…") : t("录入", "Record")}
              </button>
              <span className={styles.actionHint}>
                {t(
                  "网关会先取包、跑完整校验链（摘要 → manifest → 装载器 → 签名），任一不过整次录入都不生效。",
                  "The gateway fetches the package first and runs the full verification chain (digest → manifest → loader → signature); if any step fails the whole recording has no effect.",
                )}
              </span>
            </div>
          </form>
        </section>
          </>
        )}
      </main>

      {pending ? (
        <div
          className={styles.backdrop}
          role="presentation"
          onClick={closeConfirm}
        >
          <div
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="knowledge-confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="knowledge-confirm-title" className={styles.dialogTitle}>
              {pending.kind === "rollback"
                ? t("确认回滚到上一版？", "Roll back to the previous version?")
                : t("确认切换生效版本？", "Switch the active version?")}
            </h2>
            <p className={styles.dialogBody}>
              {t(
                "将把全平台生效的知识库切到 ",
                "This switches the platform-wide active knowledge base to ",
              )}
              <code className={styles.code}>{pending.label}</code>
              {pending.kind === "rollback" ? t("（上一版）", " (previous version)") : ""}
              {t("。", ". ")}
              <strong className={styles.dialogNote}>
                {t("已经派出去的工作不跟着改", "Already-dispatched work does not follow")}
              </strong>
              {t(
                "；新的事实入库与用途推断按新一版内容走。切换前网关会重新装载并校验，校验不过则完全不动现状。",
                "; new fact ingestion and purpose inference use the new version's content. The gateway reloads and verifies before switching; if verification fails, nothing changes.",
              )}
            </p>
            {activate.isError ? (
              <div className={styles.errorBanner} role="alert">
                {knowledgeActionErrorMessage(activate.error, "切换")}
              </div>
            ) : null}
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={closeConfirm}
                disabled={activate.isPending}
              >
                {t("取消", "Cancel")}
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={confirmAction}
                disabled={activate.isPending}
              >
                {activate.isPending ? t("正在切换…", "Switching…") : t("确认切换", "Confirm switch")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
