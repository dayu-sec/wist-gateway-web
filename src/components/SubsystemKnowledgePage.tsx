import { useState, type FormEvent } from "react";
import { isRateLimitedError } from "../api";
import {
  useActivateKnowledgePackage,
  useKnowledge,
  useKnowledgeLocks,
  useKnowledgePackages,
  useRecordKnowledgePackage,
} from "../hooks";
import { CopyButton } from "./CopyButton";
import { RateLimitNotice } from "./RateLimitNotice";
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
  const record = useRecordKnowledgePackage();
  const activate = useActivateKnowledgePackage();

  const [source, setSource] = useState("");
  const [sha256, setSha256] = useState("");
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
    record.mutate(
      {
        source: source.trim(),
        sha256: sha256.trim() || undefined,
        activate: activateNow,
      },
      {
        onSuccess: () => {
          // 这一次的输入已经用掉了：清空输入，让「录入」复位于一个空表单（同安装包页）。
          // 摘要框本来就只描述**这一次**的期望值，留着必被拿去校验下一份内容而误报。
          setSource("");
          setSha256("");
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
          <h1 className={styles.pageTitle}>知识库</h1>
          <p className={styles.pageSummary}>
            网关装载的策展内容（采集目录 / 包 / 模板 + 用途规则 + 发现策略）。
            内容以包为单位发布（来自 wist-knowledge 的 Release
            附件），在这里录入并切换生效版本 —— 切换不重启网关。
          </p>
        </header>

        {/* ① 当前生效 */}
        <section className={styles.card} aria-labelledby="knowledge-current">
          <header className={styles.cardHead}>
            <h2 id="knowledge-current">当前生效</h2>
            <p>
              事实入库用的目录 /
              模板、用途推断用的规则、发现方向策略，都以这一版为准。
            </p>
          </header>

          {knowledge.isLoading || knowledge.isError ? (
            <div className={styles.noticeBlock}>
              {knowledge.isLoading ? (
                <div className={styles.notice} role="status">
                  正在读取当前生效的知识库…
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
              <strong>知识库未配置（空载）</strong>
              <span>
                {current.hint ??
                  "网关没有装载任何策展内容：不产「系统类型」建议与用途建议，发现策略用 agentd 内建默认值。录入一个包并激活即可。"}
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
                      未识别（录入历史里没有这一版）
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
                  <span className={styles.metaLabel}>包</span>
                  <span
                    className={styles.metaValue}
                    title={activePackageId ?? ""}
                  >
                    {activePackageId ?? "—"}
                  </span>
                  {activePackageId ? (
                    <CopyButton
                      text={activePackageId}
                      label="复制"
                      className={styles.inlineCopyButton}
                    />
                  ) : null}
                </span>
                <span
                  className={`${styles.metaGroup} ${styles.metaGroupVersions}`}
                >
                  <span className={styles.metaLabel}>内容版本</span>
                  <span className={styles.metaValue}>
                    {knowledgeVersionSummary(current) || "—"}
                  </span>
                </span>
                <span
                  className={`${styles.metaGroup} ${styles.metaGroupGeneration}`}
                >
                  <span className={styles.metaLabel}>世代</span>
                  <span
                    className={styles.metaSha}
                    title="每次激活 +1；派生结果「算自哪一版」的表级锚"
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
                    回滚到上一版
                    {rollback.pkg
                      ? `（${knowledgeVersionLabel(rollback.pkg)}）`
                      : ""}
                  </button>
                  <span className={styles.actionHint}>
                    {rollback.blockedReason ??
                      "把生效指针指回上一版；已经派出去的工作不跟着改。"}
                  </span>
                </div>
              ) : null}

              {current.activations.length > 0 ? (
                <div className={styles.switchLog}>
                  <span className={styles.metaLabel}>最近切换</span>
                  <ul className={styles.switchLogList}>
                    {current.activations.slice(0, 3).map((entry) => (
                      <li
                        key={`${entry.generation}-${entry.toPackage}`}
                        className={styles.switchLogRow}
                      >
                        <span className={styles.switchLogText}>
                          {entry.fromPackage
                            ? `${entry.fromPackage} → ${entry.toPackage}`
                            : `（首次）→ ${entry.toPackage}`}
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
              <h2 id="knowledge-locks">锁在旧版目录的工作</h2>
              <p>换版不追改在跑的工作 —— 采集范围是合规边界，不能因为换了内容就悄悄扩大。这些工作会一直按它们派出去时那一版目录跑。</p>
            </header>
            <div className={styles.lockBody}>
              <div className={styles.lockTotal}>
                {`共 ${lockedWorkTotal(locks.data)} 件常驻工作锁在旧版目录上`}
                {locks.data.activeCatalogVersion !== null
                  ? `（当前生效目录版本：${locks.data.activeCatalogVersion}）`
                  : ""}
              </div>
              <ul className={styles.lockList}>
                {staleLocks(locks.data).length > 0 ? (
                  staleLocks(locks.data).map((entry) => (
                    <li key={entry.catalogVersion} className={styles.lockRow}>
                      <span className={styles.lockVersion}>
                        {`目录 ${entry.catalogVersion}`}
                      </span>
                      <span className={styles.lockWorks}>
                        {`${entry.works} 件`}
                      </span>
                    </li>
                  ))
                ) : (
                  <li className={styles.lockRow}>
                    <span className={styles.lockWorks}>
                      全部工作都已经在生效目录版本上。
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
            <h2 id="knowledge-history">录入历史</h2>
            <p>
              「设为生效」切的是全平台；已经派出去的工作不跟着改（见上一张卡）。
            </p>
          </header>

          {packages.isLoading || packages.isError ? (
            <div className={styles.noticeBlock}>
              {packages.isLoading ? (
                <div className={styles.notice} role="status">
                  正在读取录入历史…
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
              <strong>还没有录入过任何包</strong>
              <span>
                在下面「录入知识库包」填一个来源保存一次。包来自 wist-knowledge
                的 Release 附件（<code className={styles.code}>.tar.gz</code>{" "}
                与其
                <code className={styles.code}>.sha256</code>）；离线环境用 stack
                的{" "}
                <code className={styles.code}>scripts/import-knowledge.sh</code>{" "}
                投放后再录。
              </span>
            </div>
          ) : null}

          {history.length > 0 ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">版本</th>
                    <th scope="col">内容版本</th>
                    <th scope="col">摘要 / 验签</th>
                    <th scope="col">录入</th>
                    <th scope="col">状态</th>
                    <th scope="col" className={styles.thAction}>
                      <span className={styles.srOnly}>操作</span>
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
                              生效中
                            </span>
                          ) : !pkg.available ? (
                            <span
                              className={`${styles.badge} ${styles.badgeGone}`}
                            >
                              副本缺失
                            </span>
                          ) : (
                            <span
                              className={`${styles.badge} ${styles.badgeStored}`}
                            >
                              已录入
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
                                ? "这一版已经在生效"
                                : !pkg.available
                                  ? "副本已不在网关（包目录被手工清过，或备份还原不完整）"
                                  : "切到这一版（两次确认）"
                            }
                            onClick={() =>
                              openConfirm({
                                kind: "activate",
                                packageId: pkg.packageId,
                                label: knowledgeVersionLabel(pkg),
                              })
                            }
                          >
                            设为生效
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
            <h2 id="knowledge-record">录入知识库包</h2>
            <p>录入只落盘登记；除非勾上「立即激活」，否则不改变现状。</p>
          </header>

          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.field}>
              <span>来源地址</span>
              <input
                type="text"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="https://github.com/dayu-sec/wist-knowledge/releases/download/v0.1.1/wist-knowledge-0.1.1.tar.gz"
                autoComplete="off"
                required
              />
              <small>
                https:// 链接，或「网关容器内」的绝对路径（宿主路径容器里看不见；离线投放见 stack 的 import-knowledge.sh）。不支持明文 http。
              </small>
            </label>
            <label className={styles.field}>
              <span>期望摘要 sha256（可选）</span>
              <input
                type="text"
                value={sha256}
                onChange={(event) => setSha256(event.target.value)}
                placeholder="64 位十六进制，可带 sha256: 前缀"
                autoComplete="off"
                spellCheck={false}
              />
              <small>
                填发布侧 *.sha256 里那串（算的是来源 tarball
                的字节）；留空则按实际内容计算并落库。
              </small>
            </label>
            <label className={styles.checkboxField}>
              <input
                type="checkbox"
                checked={activateNow}
                onChange={(event) => setActivateNow(event.target.checked)}
              />
              <span>
                立即激活
                <small>
                  录入成功后马上切到这一版；不勾则先登记，之后在历史里点「设为生效」。
                </small>
              </span>
            </label>

            {record.isError ? (
              <div className={styles.errorBanner} role="alert">
                {knowledgeActionErrorMessage(record.error, "录入")}
              </div>
            ) : null}
            {record.isSuccess ? (
              <div className={styles.formNotice} role="status">
                {`已录入 ${knowledgeVersionLabel(record.data)}（${record.data.packageId}）${
                  record.data.active ? "，并已切换为生效版本" : "，尚未生效"
                }。`}
              </div>
            ) : null}

            <div className={styles.formActions}>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={!canSubmit}
              >
                {record.isPending ? "正在录入…" : "录入"}
              </button>
              <span className={styles.actionHint}>
                网关会先取包、跑完整校验链（摘要 → manifest → 装载器 →
                签名），任一不过整次录入都不生效。
              </span>
            </div>
          </form>
        </section>
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
                ? "确认回滚到上一版？"
                : "确认切换生效版本？"}
            </h2>
            <p className={styles.dialogBody}>
              将把全平台生效的知识库切到{" "}
              <code className={styles.code}>{pending.label}</code>
              {pending.kind === "rollback" ? "（上一版）" : ""}。
              <strong className={styles.dialogNote}>
                已经派出去的工作不跟着改
              </strong>
              ；新的事实入库与用途推断按新一版内容走。切换前网关会重新装载并校验，校验不过则完全不动现状。
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
                取消
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={confirmAction}
                disabled={activate.isPending}
              >
                {activate.isPending ? "正在切换…" : "确认切换"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
