import { useMemo, useState } from "react";
import type {
  AgentLocalOneShotWorkView,
  AgentLocalStandingWorkView,
  AgentLocalTaskView,
  AgentLocalWorkView,
  AgentWorkView,
  ContentCatalogView,
  MachineClass,
  OneShotWork,
  StandingWork,
  StandingWorkStatus,
} from "../types";
import type { GrantableFamily } from "./agentWorkStatus";
import type {
  GrantOneShotWorkCommand,
  GrantStandingWorkCommand,
} from "../api/admin";
import {
  STANDING_STATUS_LABEL,
  STANDING_STATUS_TONE,
  blockedFamilies,
  collectedLogFiles,
  ACK_STATE_LABEL,
  ACK_STATE_TONE,
  driftingCountAt,
  standingAckState,
  duplicatedCollectedPaths,
  grantableFamilies,
  localExecutionLabel,
  metricIntervalSeconds,
  oneShotStatusLabel,
  oneShotStatusTone,
  platformForMachineClass,
  sourceText,
  specCounts,
  ungrantedFamilies,
  unsupportedSourceCount,
  unsupportedSourceReason,
} from "./agentWorkStatus";
import {
  collectionFamilyName,
  collectionFamilySummary,
  indexCollectionFamilies,
  type CollectionFamilyTextIndex,
} from "./collectionFamilyText";
import { t, dateLocale } from "../i18n";
import styles from "./SubsystemAgentWorkView.module.css";

export interface WorkActionCommand {
  kind: "pause" | "resume" | "revoke";
  workId: string;
  reasonCode?: string;
}

interface SubsystemAgentWorkViewProps {
  agentWorkView: AgentWorkView;
  /** 采集内容目录；`null` = 未加载/未装载（表单会说明并禁用）。 */
  catalog: ContentCatalogView | null;
  /** 内容目录是「网关没配 `[content]`」（503），不是加载失败。 */
  catalogUnavailable: boolean;
  /** 用途判定（采集范围的前置）；`null` = 还没判过。 */
  machineClass: MachineClass | null;
  /** 有操作在提交（按钮禁用，避免重复点击）。 */
  pending: boolean;
  /** 「全部授权」正在逐面提交（与 `pending` 分开：它只用来换按钮文案）。 */
  grantAllPending: boolean;
  actionError: string | null;
  actionNotice: string | null;
  onAction: (command: WorkActionCommand) => void;
  onGrantStanding: (command: GrantStandingWorkCommand) => void;
  /** 一次授权多份还没授权的常驻工作（面名列表）。 */
  onGrantAll: (families: string[]) => void;
  onGrantOneShot: (command: GrantOneShotWorkCommand) => void;
}

function formatTimestamp(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString(dateLocale(), { hour12: false });
}

function toneClass(tone: string): string {
  switch (tone) {
    case "ok":
      return styles.toneOk;
    case "warn":
      return styles.toneWarn;
    case "crit":
      return styles.toneCrit;
    default:
      return styles.toneUnknown;
  }
}

/**
 * Agent 工作视图（模型 `WorkGrant` + 授权/撤回/暂停/恢复的入口）。
 *
 * 常驻工作那一节就是**一个采集面一格卡**，三种面在里面各就各位：
 *   · 已授权（生效中 / 已暂停）—— 卡上是「期望」与「本机实际」的对照；
 *   · 可派未授权 —— 卡上就一个「授权这份工作」，不用另开一节、再在下拉里把面挑一遍；
 *   · 不能派 —— 卡里放不下（它不是一件事），收在节末的理由里。
 *
 * 每张已授权的卡说两件事：上半是网关的**期望**（授权里写了什么、谁改的、漂移到哪一步），
 * 下半是 agentd 自报的**本机实际**（它手上是哪一版、实际从什么时候起效、真在采哪些文件）。
 * 两者对不上才是要查的事 —— 所以自报不单独占一节：同一批采集面列两遍，读者就得自己
 * 逐行对差，那正是这个视图该替他做的事。自报里「网关这边根本没有」的部分
 * （本机残留的工作、手工加的输入）无处可并，单独列一节。
 */
export function SubsystemAgentWorkView({
  agentWorkView,
  catalog,
  catalogUnavailable,
  machineClass,
  pending,
  grantAllPending,
  actionError,
  actionNotice,
  onAction,
  onGrantStanding,
  onGrantAll,
  onGrantOneShot,
}: SubsystemAgentWorkViewProps) {
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  // 面名与说明来自知识库（网关随内容目录返回），不是前端硬编码：新增面不用发前端。
  // 旧网关不返回词表时这里是空索引，卡片回落成面 ID。
  const familyText = useMemo(
    () => indexCollectionFamilies(catalog?.families),
    [catalog],
  );
  // 带时间的漂移计数：「等待首次确认」（刚授权 90 秒内）不算漂移，免得刚授权就报「漂移 N」。
  // 页面每 5 秒轮询重渲染一次，所以宽限期一到，徽标/计数会自己转过来。
  const drift = driftingCountAt(agentWorkView.standing, Date.now());
  const grantable =
    catalog && machineClass ? grantableFamilies(catalog, machineClass) : [];
  // 能派但还没授权的面：它们也占一格卡（授权按钮就在卡上），不再另开一节挑面。
  const ungranted = ungrantedFamilies(grantable, agentWorkView.standing);
  const blocked = catalog && machineClass ? blockedFamilies(catalog, machineClass) : [];
  // 自报存在且解析成功时才有「本机实际」可言：`null` 是没上报（旧 agentd），
  // `error` 是有上报但读不了 —— 两种都不该把卡片标成「本机没在做」。
  const local = agentWorkView.local && !agentWorkView.local.error
    ? agentWorkView.local
    : null;
  const lag = local ? agentWorkView.sequence - local.gatewaySequence : 0;
  // 本机报了、网关这边没有的工作：撤回刚发生而 Agent 还没跟到下一版快照，或本机残留。
  const orphanStanding = local
    ? local.standing.filter(
        (work) =>
          !agentWorkView.standing.some((entry) => entry.workId === work.workId),
      )
    : [];
  const manualInputs = local ? local.localInputs : [];
  const sharedPaths = duplicatedCollectedPaths(agentWorkView.standing);

  return (
    <div className={styles.view}>
      <section className={styles.summary} aria-label={t("工作摘要", "Work summary")}>
        <div className={`${styles.summaryItem} ${lag > 0 ? styles.summaryWarn : ""}`}>
          <span className={styles.summaryLabel}>{t("授权序号", "Grant sequence")}</span>
          <span className={styles.summaryValue}>{agentWorkView.sequence}</span>
          <span className={styles.summaryHint}>
            {lag > 0
              ? t(
                  "本机上报时还停在 {at}（落后 {lag} 版）",
                  "The agent was still on {at} at its last report ({lag} version(s) behind)",
                  { at: agentWorkView.sequence - lag, lag },
                )
              : t(
                  "本机上报时已跟到这一版（它每 30 秒拉一次快照）",
                  "The agent had already caught up with this version at its last report (it pulls a snapshot every 30 seconds)",
                )}
          </span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>{t("生效中", "Active")}</span>
          <span className={styles.summaryValue}>{agentWorkView.standing.length}</span>
          <span className={styles.summaryHint}>
            {t("个采集面在下发中", "collection families being delivered")}
          </span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>
            {t("未了结的一次性工作", "Unsettled one-shot work")}
          </span>
          <span className={styles.summaryValue}>{agentWorkView.oneShot.length}</span>
        </div>
        <div
          className={`${styles.summaryItem} ${drift > 0 ? styles.summaryAlert : ""}`}
        >
          <span className={styles.summaryLabel}>{t("漂移", "Drift")}</span>
          <span className={styles.summaryValue}>{drift}</span>
          <span className={styles.summaryHint}>
            {t(
              "期望版本与 Agent 确认对不上的工作数",
              "Work items whose expected version does not match what the agent acknowledged",
            )}
          </span>
        </div>
      </section>

      <LocalReportStrip local={agentWorkView.local} />

      {actionError ? (
        <div className={styles.errorBanner} role="alert">
          {actionError}
        </div>
      ) : null}
      {actionNotice ? (
        <div className={styles.noticeBanner} role="status">
          {actionNotice}
        </div>
      ) : null}

      <section className={styles.section} aria-labelledby="agent-work-standing-title">
        <header className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle} id="agent-work-standing-title">
            {t("常驻工作", "Standing work")}
          </h2>
          <span className={styles.sectionHint}>
            {t(
              "一个采集面一份，可派的面直接在这张卡上授权。已授权的卡：头两行是网关",
              "One card per collection family; a grantable family is granted right on its card. On a granted card the first two lines show what the gateway ",
            )}
            <strong>{t("期望", "expects")}</strong>
            {t(
              "的样子，下面那行「本机实际」是 agentd 自报的 —— 两者对不上才是要查的事。暂停是",
              ". The “Local actual” line below is what agentd reports about itself — only a mismatch is worth looking into. Pausing is ",
            )}
            <strong>{t("期望状态的一部分", "part of the expected state")}</strong>
            {t(
              "（Agent 没在做不算漂移），撤回才是停止；要改这份采什么，撤回后重新授权（同一份工作、版本 +1，按最新事实重新派生）",
              " (the agent not doing the work is not drift); only revocation stops it. To change what this work collects, revoke and grant again (same work, version +1, re-derived from the latest facts)",
            )}
          </span>
          {/* 多于一格待授权卡时才给「全部授权」：一格时卡上那个按钮就是全部。 */}
          {ungranted.length > 1 ? (
            <button
              type="button"
              className={`${styles.grantButton} ${styles.grantAllButton}`}
              disabled={pending}
              onClick={() => onGrantAll(ungranted.map((entry) => entry.family))}
              title={t("逐面授权：{families}", "Grant per family: {families}", {
                families: ungranted.map((entry) => entry.family).join(" / "),
              })}
            >
              {grantAllPending
                ? t("授权中…", "Granting…")
                : t("全部授权（{n}）", "Grant all ({n})", { n: ungranted.length })}
            </button>
          ) : null}
        </header>

        {agentWorkView.standing.length === 0 && ungranted.length === 0 ? (
          <p className={styles.emptyNotice}>
            {t("这台机器当前", "This machine currently has ")}
            <strong>{t("没有", "no")}</strong>
            {t(
              "生效中的常驻工作，也没有可派的采集面。",
              " standing work in effect and no grantable collection families.",
            )}
          </p>
        ) : (
          <ul className={styles.cardList}>
            {agentWorkView.standing.map((work) => (
              <StandingWorkCard
                key={work.workId}
                work={work}
                local={local}
                sharedPaths={sharedPaths}
                familyText={familyText}
                pending={pending}
                onAction={onAction}
                revokeTarget={revokeTarget}
                revokeReason={revokeReason}
                setRevokeTarget={setRevokeTarget}
                setRevokeReason={setRevokeReason}
              />
            ))}
            {ungranted.map((entry) => (
              <GrantCandidateCard
                key={entry.family}
                entry={entry}
                familyText={familyText}
                pending={pending}
                onSubmit={onGrantStanding}
              />
            ))}
          </ul>
        )}

        {/* 派活的前置与摆不到卡上的面：卡里放不下的部分，在这里说清。 */}
        {!machineClass ? (
          <p className={styles.blockedNotice}>
            {t("派活的前置是", "Granting work requires ")}
            <strong>{t("用途判定", "a purpose classification")}</strong>
            {t(
              "：它决定取哪份模板、也就决定了能派哪些面。这台机器还没归档判定 ——",
              " first: it selects the template, which in turn decides which families can be granted. This machine has no archived classification yet — ",
            )}
            <a className={styles.inlineLink} href="./purpose">
              {t("先去用途页归档", "archive it on the purpose page")}
            </a>
            {t(
              "（判定的依据是它上报的事实摘要；没上报过事实时网关会拒绝，不默认放行）。",
              " (the classification is based on the fact summary it reported; when no facts have been reported the gateway refuses instead of allowing by default).",
            )}
          </p>
        ) : catalogUnavailable ? (
          <p className={styles.blockedNotice}>
            {t(
              "采集内容目录未装载（网关未配置",
              "The content catalog is not loaded (the gateway has no ",
            )}
            <span className={styles.mono}>[content]</span>
            {t(
              " 三件套）：无法展开工作参数，也就无法派活。配好内容目录并重启网关后再来。",
              " triple configured): work parameters cannot be expanded, so work cannot be granted. Configure the content catalog, restart the gateway, then come back.",
            )}
          </p>
        ) : !catalog ? (
          <p className={styles.blockedNotice}>
            {t(
              "正在加载采集内容目录（可派的面来自它）。",
              "Loading the content catalog (grantable families come from it).",
            )}
          </p>
        ) : (
          <>
            {grantable.length === 0 ? (
              <p className={styles.blockedNotice}>
                <strong>{machineClass}</strong>
                {t("（{platform}）当前", " ({platform}) currently has ", {
                  platform: platformForMachineClass(machineClass),
                })}
                <strong>{t("没有任何可采的采集面", "no grantable collection family")}</strong>
                {t(
                  "：所有面都还没有采集就绪的单元（没有 ",
                  ": every family still has no collection-ready unit (no ",
                )}
                <span className={styles.mono}>status = active</span>
                {t("），因此无可授权。", "), so nothing can be granted.")}
              </p>
            ) : null}
            {blocked.length > 0 ? (
              <details className={styles.blockedDetails}>
                <summary className={styles.muted}>
                  {t(
                    "另有 {n} 个面还不能派（采集未就绪 / 平台不适用）",
                    "{n} more families cannot be granted yet (collection not ready / platform not applicable)",
                    { n: blocked.length },
                  )}
                </summary>
                <ul className={styles.blockedList}>
                  {blocked.map((entry) => (
                    <li key={entry.family}>
                      <span className={styles.mono}>{entry.family}</span> —— {entry.reason}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </section>

      {orphanStanding.length > 0 || manualInputs.length > 0 ? (
        <LocalOnlySection
          orphanStanding={orphanStanding}
          manualInputs={manualInputs}
        />
      ) : null}

      <section className={styles.section} aria-labelledby="agent-work-oneshot-title">
        <header className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle} id="agent-work-oneshot-title">
            {t("一次性工作", "One-shot work")}
          </h2>
          <span className={styles.sectionHint}>
            {t(
              "有计划开始时间与绝对截止，有明确终态；暂停也照走截止。每张卡下面的「本机实际」是 agentd 自报的执行阶段",
              "It has a planned start time, an absolute deadline, and a definite terminal state; the deadline keeps running while paused. The “Local actual” line under each card is the execution stage agentd reports about itself",
            )}
          </span>
        </header>

        <p className={styles.gapNotice}>
          {t("当前 agentd 只执行 ", "Today agentd only executes ")}
          <span className={styles.mono}>upgrade</span>
          {t(
            " 这一种动作（其余动作派下去会停在「已派发」）；升级由分离进程 ",
            " (any other action stops at “dispatched”); upgrades are performed by the separate process ",
          )}
          <span className={styles.mono}>wist-upgrader</span>
          {t(" 执行，进度与终态经 ", ", and progress and the terminal state are reported through ")}
          <span className={styles.mono}>work:result</span>
          {t(
            " 回报 —— 回滚在控制面上记为「失败」，说明里写清回到哪一版。",
            " — a rollback is recorded as “failed” on the control plane, with the version rolled back to stated in the detail.",
          )}
        </p>

        {agentWorkView.oneShot.length === 0 ? (
          <p className={styles.emptyNotice}>
            {t("没有未了结的一次性工作。", "No unsettled one-shot work.")}
          </p>
        ) : (
          <ul className={styles.cardList}>
            {agentWorkView.oneShot.map((work) => (
              <OneShotWorkCard
                key={work.workId}
                work={work}
                local={local}
                pending={pending}
                onAction={onAction}
              />
            ))}
          </ul>
        )}

        <GrantOneShotForm pending={pending} onSubmit={onGrantOneShot} />
      </section>

      {agentWorkView.retiredStanding.length > 0 ||
      agentWorkView.settledOneShot.length > 0 ? (
        <section className={styles.section} aria-labelledby="agent-work-history-title">
          <details className={styles.history}>
            <summary className={styles.historySummary}>
              <span className={styles.sectionTitle} id="agent-work-history-title">
                {t("历史留痕", "Audit history")}
              </span>
              <span className={styles.sectionHint}>
                {t(
                  "已撤回 / 已被取代的常驻工作 {standing} 条，已了结的一次性工作 {oneShot} 条",
                  "{standing} revoked / superseded standing work items, {oneShot} settled one-shot work items",
                  {
                    standing: agentWorkView.retiredStanding.length,
                    oneShot: agentWorkView.settledOneShot.length,
                  },
                )}
              </span>
            </summary>
            <ul className={styles.historyList}>
              {agentWorkView.retiredStanding.map((work) => (
                <li key={work.workId} className={styles.historyItem}>
                  <span className={styles.mono}>{work.family}</span>
                  <span className={`${styles.badge} ${toneClass(STANDING_STATUS_TONE[work.status])}`}>
                    {STANDING_STATUS_LABEL[work.status]}
                  </span>
                  <span className={styles.historyMeta}>
                    {t("版本 {version}", "Version {version}", {
                      version: work.planVersion,
                    })}{" "}
                    · {work.updatedBy} · {formatTimestamp(work.updatedAt)}
                  </span>
                </li>
              ))}
              {agentWorkView.settledOneShot.map((work) => (
                <li key={work.workId} className={styles.historyItem}>
                  <span className={styles.mono}>{work.action}</span>
                  <span className={`${styles.badge} ${toneClass(oneShotStatusTone(work.status))}`}>
                    {oneShotStatusLabel(work.status)}
                  </span>
                  <span className={styles.historyMeta}>
                    {work.issuedBy} · {formatTimestamp(work.issuedAt)}
                    {work.result?.detail ? ` · ${work.result.detail}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}
    </div>
  );
}

/**
 * agentd 自报的元信息：一行说清这份自报有多新、覆盖到哪。
 *
 * 自报的**内容**都并进了各工作卡（每张卡的「本机实际」），这里只留那些「没有归属」
 * 的事实：它什么时候报的、指标多久上送一次。不摆成独立一节 —— 独立一节就得把
 * 五个采集面再列一遍，与下面的卡片逐行重复。
 *
 * 三种状态分开呈现，因为处置不同：
 *   · `null`：旧版 agentd 不上报 ——「没数据」，卡片上的「本机实际」整行都不显示；
 *   · `error`：报了但读不了（多半是网关与 agentd 版本不一致）——「有数据但读不了」，要修版本。
 */
function LocalReportStrip({ local }: { local: AgentLocalWorkView | null }) {
  if (!local) {
    return (
      <p className={styles.localStripEmpty}>
        {t(
          "这台 Agent 还没上报本机视图（旧版本 agentd 不上报此字段）—— 下面每张工作卡的「本机实际」都看不到。",
          "This agent has not reported its local view yet (older agentd versions do not report this field) — the “Local actual” line on every work card below is unavailable.",
        )}
      </p>
    );
  }

  if (local.error) {
    return (
      <p className={styles.localStripError} role="alert">
        {t(
          "本机工作上报无法解析（可能是网关与 agentd 版本不一致）：{detail}",
          "The local work report cannot be parsed (possibly a gateway/agentd version mismatch): {detail}",
          { detail: local.error },
        )}
      </p>
    );
  }

  return (
    <div
      className={styles.localStrip}
      aria-label={t("agentd 自报", "agentd self-report")}
    >
      <span className={styles.localStripLabel}>
        {t("agentd 自报", "agentd self-report")}
      </span>
      <span className={styles.localStripItem}>
        {t("上报于", "Reported at")}{" "}
        <span className={styles.localStripValue}>
          {formatTimestamp(local.recordedAt)}
        </span>
      </span>
      <span className={styles.localStripItem}>
        {t("指标上送周期", "Metrics push interval")}{" "}
        <span className={styles.localStripValue}>
          {local.metricsIntervalSeconds === null
            ? "—"
            : `${local.metricsIntervalSeconds}s`}
        </span>
      </span>
    </div>
  );
}

/**
 * 「本机多出来的」：agentd 报的、而网关这边没有对应授权的东西。
 *
 * 这一类**无处可并**，所以要单独列：上面每张卡都是「网关期望一份、本机对着它回话」，
 * 而这两样东西在网关侧根本没有对象 —— 网关撤不回它们，也不该假装它们不存在。
 *
 * 两类成因不同，文案要分开说，否则运维会去网关找一个不存在的开关：
 *   · 本机手上还有的工作：多半是刚撤回、Agent 还没跟到下一版快照；也可能是本机残留；
 *   · 本机手工加的输入：本机配置里的运维逃生舱，网关从来不知道它。
 */
function LocalOnlySection({
  orphanStanding,
  manualInputs,
}: {
  orphanStanding: AgentLocalStandingWorkView[];
  manualInputs: AgentLocalTaskView[];
}) {
  return (
    <section className={styles.section} aria-labelledby="agent-work-localonly-title">
      <header className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle} id="agent-work-localonly-title">
          {t("本机多出来的", "Extra on this machine")}
        </h2>
        <span className={styles.sectionHint}>
          {t(
            "本机在做、网关这边没有对应授权的东西：网关撤不回，也不在上面那些卡片里",
            "Things this machine is doing that have no matching grant on the gateway: the gateway cannot revoke them, and they are not in the cards above",
          )}
        </span>
      </header>

      {orphanStanding.length > 0 ? (
        <div className={styles.localGroup}>
          <span className={styles.localGroupTitle}>
            {t("本机手上还有的工作（{n}）", "Work the agent still holds ({n})", {
              n: orphanStanding.length,
            })}
          </span>
          <ul className={styles.localList}>
            {orphanStanding.map((work) => (
              <li key={work.workId} className={styles.localItem}>
                <span className={styles.mono}>{work.family}</span>
                <span
                  className={`${styles.badge} ${toneClass(
                    STANDING_STATUS_TONE[work.status as StandingWorkStatus] ??
                      "unknown",
                  )}`}
                >
                  {STANDING_STATUS_LABEL[work.status as StandingWorkStatus] ??
                    work.status}
                </span>
                <span className={styles.localItemMeta}>
                  v{work.planVersion} ·{" "}
                  {t("{n} 个采集任务", "{n} collection tasks", {
                    n: work.tasks.length,
                  })}{" "}
                  ·{" "}
                  {t("生效自 {at}", "effective from {at}", {
                    at: formatTimestamp(work.effectiveFrom),
                  })}
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.localNote}>
            {t(
              "网关这边已经没有这些工作的授权了 —— 多半是刚撤回、本机还没拉到下一版快照；若它一直不退，就是本机残留，只能在本机处理。",
              "The gateway no longer has grants for this work — usually a recent revocation that the machine has not pulled the next snapshot for yet; if it never goes away it is a local leftover and can only be handled on the machine itself.",
            )}
          </p>
        </div>
      ) : null}

      {manualInputs.length > 0 ? (
        <div className={styles.localGroup}>
          <span className={styles.localGroupTitle}>
            {t("本机手工加的输入（{n}）", "Manually added inputs on this machine ({n})", {
              n: manualInputs.length,
            })}
          </span>
          <ul className={styles.localFileList}>
            {manualInputs.map((input) => (
              <li key={input.path} className={styles.localFileRow}>
                <span className={styles.mono}>{input.path}</span>
                <span className={`${styles.badge} ${styles.toneWarn}`}>
                  {t("本机手工加的", "Manually added locally")}
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.localNote}>
            {t("它们来自本机配置（", "They come from the local configuration (")}
            <span className={styles.mono}>[telemetry.logs] file_inputs</span>
            {t(
              "，运维逃生舱），不来自任何采集面：网关不知道、也不会撤回，该不该留只在本机判。",
              ", the operations escape hatch), not from any collection family: the gateway neither knows about them nor revokes them, so whether to keep them is a local decision.",
            )}
          </p>
        </div>
      ) : null}
    </section>
  );
}

interface StandingWorkCardProps {
  work: StandingWork;
  /** agentd 自报（解析成功才是非 null）；`null` = 这份自报看不到，卡片不出现「本机实际」行。 */
  local: AgentLocalWorkView | null;
  /** 被两份以上工作声明的路径 → 声明它的采集面（重复采集要标出来）。 */
  sharedPaths: Map<string, string[]>;
  /** 面名与说明（来自知识库；缺项回落成面 ID）。 */
  familyText: CollectionFamilyTextIndex;
  pending: boolean;
  onAction: (command: WorkActionCommand) => void;
  revokeTarget: string | null;
  revokeReason: string;
  setRevokeTarget: (workId: string | null) => void;
  setRevokeReason: (reason: string) => void;
}

function StandingWorkCard({
  work,
  local,
  sharedPaths,
  familyText,
  pending,
  onAction,
  revokeTarget,
  revokeReason,
  setRevokeTarget,
  setRevokeReason,
}: StandingWorkCardProps) {
  const ackState = standingAckState(work, Date.now());
  const counts = specCounts(work.spec);
  const interval = metricIntervalSeconds(work.spec);
  // 「今天真会去 tail 的文件」：与 agentd `state/work.json` 的 tasks 同口径。
  const files = collectedLogFiles(work.spec);
  // 「今天采不到」的来源条数：授权里可能有 agentd 还不承接的 kind（通配 / 导出器 / 谓词），
  // 页面要把它标出来，否则看起来和真采上的一样。
  const unsupported = unsupportedSourceCount(work.spec);
  // 本机对这份工作的自报：`null` = 网关这边有、agent 没报（它还没拉到这一版授权）。
  const localWork = local
    ? local.standing.find((entry) => entry.workId === work.workId) ?? null
    : null;
  // 本机自报「实际在采」的文件：与上面的 `files`（期望折算）配对，两者不同就要说清差在哪。
  const localFiles = localWork ? localWork.tasks.map((task) => task.path) : null;
  const filesMismatch =
    localFiles !== null &&
    (localFiles.some((path) => !files.includes(path)) ||
      files.some((path) => !localFiles.includes(path)));
  // 同一路径还有别的工作在采 = agentd 会把它 tail 两遍，藏在两张卡里谁也看不见。
  const sharedFiles = files.filter((path) => {
    const owners = sharedPaths.get(path);
    return owners ? owners.some((family) => family !== work.family) : false;
  });
  // 本机手上还不是当前版本：比「漂移」更靠前一步 —— 漂移说的是确认回执，这是它手里那一份。
  const staleLocalVersion = localWork ? localWork.planVersion < work.planVersion : false;
  const localAckBehind = localWork
    ? localWork.acknowledgedVersion !== localWork.planVersion
    : false;
  const familySummary = collectionFamilySummary(work.family, familyText);
  return (
    <li
      className={styles.card}
      // 审计信息（目录版本 / 谁改的 / 本机生效自 / 采集任务数）不常看，收进 tooltip，
      // 不占正文行 —— 正文只留「现在该知道的」。
      title={[
        t("目录 v{v}（换版不追改）", "Catalog v{v} (not retrofitted on version change)", {
          v: work.catalogVersion,
        }),
        t("{by} 改于 {at}", "changed by {by} at {at}", {
          by: work.updatedBy,
          at: formatTimestamp(work.updatedAt),
        }),
        localWork
          ? t(
              "本机生效自 {at}，{n} 个采集任务",
              "effective locally from {at}, {n} collection tasks",
              {
                at: formatTimestamp(localWork.effectiveFrom),
                n: localWork.tasks.length,
              },
            )
          : null,
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      <div className={styles.cardHeader}>
        <span className={styles.workName}>{collectionFamilyName(work.family, familyText)}</span>
        <span className={styles.workNameCode}>{work.family}</span>
        <span className={`${styles.badge} ${toneClass(STANDING_STATUS_TONE[work.status])}`}>
          {STANDING_STATUS_LABEL[work.status]}
        </span>
        <span className={`${styles.badge} ${toneClass(ACK_STATE_TONE[ackState])}`}>
          {ACK_STATE_LABEL[ackState]}
        </span>
      </div>

      {familySummary ? (
        <p className={styles.workSummary}>{familySummary}</p>
      ) : null}

      {work.spec.error ? (
        <span className={styles.critText}>
          {t("参数无法解析：{detail}", "Parameters cannot be parsed: {detail}", {
            detail: work.spec.error,
          })}
        </span>
      ) : (
        <div className={styles.workMeta}>
          <span className={styles.workMetaMain}>
            <span className={styles.mono}>v{work.planVersion}</span>
            {/* 已确认且版本一致时，「确认」这件事没什么可说 —— 对不上的时候才值得占一行。 */}
            {ackState === "in-sync" ? null : (
              <span className={styles.mono}>
                {work.ack
                  ? t("已确认 v{v}", "Acknowledged v{v}", { v: work.ack.planVersion })
                  : ackState === "awaiting-ack"
                    ? t("等 Agent 首次快照", "Awaiting the Agent's first snapshot")
                    : t("尚未确认", "Not acknowledged yet")}
              </span>
            )}
            <span className={styles.mono}>
              {t("{units} 单元 · {sources} 来源", "{units} units · {sources} sources", {
                units: counts.units,
                sources: counts.sources,
              })}
              {unsupported > 0
                ? t(" · {n} 未接", " · {n} not supported", { n: unsupported })
                : ""}
              {interval === null
                ? ""
                : t(" · 指标 {seconds}s", " · metrics {seconds}s", { seconds: interval })}
            </span>
          </span>
        </div>
      )}

      {/* 「本机实际」只在**对不上**时才出现：一致就是没话说，不必占一行。 */}
      {local && localWork === null ? (
        <div className={styles.localRow}>
          <span className={styles.localRowLabel}>{t("本机实际", "Local actual")}</span>
          <span className={`${styles.badge} ${styles.toneWarn}`}>
            {t("本机未报这份工作", "The machine has not reported this work")}
          </span>
          <span className={styles.muted}>
            {t(
              "它还没拉到这一版授权（每 30 秒拉一次快照）",
              "It has not pulled this version of the grant yet (it pulls a snapshot every 30 seconds)",
            )}
          </span>
        </div>
      ) : null}

      {local &&
      localWork !== null &&
      (localWork.status !== work.status || staleLocalVersion || localAckBehind) ? (
        <div className={styles.localRow}>
          <span className={styles.localRowLabel}>{t("本机实际", "Local actual")}</span>
          <span className={styles.mono}>
            {STANDING_STATUS_LABEL[localWork.status as StandingWorkStatus] ??
              localWork.status}
          </span>
          {localWork.status !== work.status ? (
            <span className={`${styles.badge} ${styles.toneWarn}`}>
              {t("网关期望「{status}」", "Gateway expects “{status}”", {
                status: STANDING_STATUS_LABEL[work.status],
              })}
            </span>
          ) : null}
          {staleLocalVersion ? (
            <span className={`${styles.badge} ${styles.toneWarn}`}>
              {t("手上还是 v{v}", "Still holds v{v}", { v: localWork.planVersion })}
            </span>
          ) : null}
          {localAckBehind ? (
            <span className={`${styles.badge} ${styles.toneWarn}`}>
              {t("只确认到 v{v}", "Acknowledged only up to v{v}", {
                v: localWork.acknowledgedVersion,
              })}
            </span>
          ) : null}
        </div>
      ) : null}

      {!work.spec.error ? (
        <div
          className={`${styles.collectedInline} ${
            filesMismatch ? styles.collectedAlert : ""
          }`}
        >
          <span className={styles.collectedLabel}>
            {work.status === "paused"
              ? t("恢复后将采（{n}）", "Will collect after resume ({n})", {
                  n: files.length,
                })
              : t("在采（{n}）", "Collecting ({n})", { n: files.length })}
          </span>
          {localFiles !== null && filesMismatch ? (
            // 对不上就把两份清单各写各的：只报两个数字、清单却取自期望，
            // 读者会把「本机 1」看成在采期望那一个，正好把差异读反。
            <>
              <span className={styles.mono}>
                {t("期望 {n}（{list}）", "Expected {n} ({list})", {
                  n: files.length,
                  list: files.join(" · ") || "—",
                })}
              </span>
              <span className={styles.mono}>
                {t("本机 {n}（{list}）", "Local {n} ({list})", {
                  n: localFiles.length,
                  list: localFiles.join(" · ") || "—",
                })}
              </span>
            </>
          ) : files.length === 0 ? (
            <span className={styles.muted}>
              {t(
                "—（这份授权里没有今天能采的日志文件）",
                "— (this grant has no log files collectable today)",
              )}
            </span>
          ) : (
            // 一致时不重复「期望 1 / 本机 1」：一致就是没话说，只列文件。
            <span className={styles.mono}>{files.join(" · ")}</span>
          )}
          {sharedFiles.length > 0 ? (
            <span className={`${styles.badge} ${styles.toneWarn}`}>
              {t("{files} 另有一份工作在采", "{files} is also collected by another work item", {
                files: sharedFiles.join(" · "),
              })}
            </span>
          ) : null}
        </div>
      ) : null}

      {work.spec.error ? (
        <pre className={styles.specRaw}>{work.spec.raw}</pre>
      ) : (
        <ul className={styles.unitList}>
          {work.spec.units.map((unit) => (
            <li key={unit.unitId} className={styles.unitItem}>
              <span className={styles.unitHead}>
                <span className={styles.unitId}>{unit.unitId}</span>
                <span className={styles.unitMeta}>
                  {unit.capability}
                  {unit.ruleRef ? ` · ${unit.ruleRef}` : ""}
                  {unit.requiresPrivilege && unit.requiresPrivilege !== "none"
                    ? t(" · 需 {privilege}", " · requires {privilege}", {
                        privilege: unit.requiresPrivilege,
                      })
                    : ""}
                </span>
              </span>
              {unit.sources.length === 0 ? (
                <span className={styles.unitMeta}>
                  {t("无来源声明", "No source declared")}
                </span>
              ) : (
                <ul className={styles.sourceList}>
                  {unit.sources.map((source, index) => {
                    const reason = unsupportedSourceReason(
                      source.kind,
                      source.target,
                    );
                    return (
                      <li
                        key={`${index}-${source.kind}-${source.target}`}
                        className={styles.sourceRow}
                      >
                        <span className={styles.mono}>
                          {sourceText(source)}
                        </span>
                        <span
                          className={`${styles.badge} ${
                            reason === null ? styles.toneOk : styles.toneWarn
                          }`}
                          // 完整解释放 hover：「未接」的含义一句话就能记住，不必每张卡重复一长句。
                          title={
                            reason === null
                              ? t(
                                  "本地采集器今天能 tail 这个来源",
                                  "The local collector can tail this source today",
                                )
                              : t(
                                  "{reason}：agentd 今天还采不到，已在授权里如实列出",
                                  "{reason}: agentd cannot collect this yet; it is listed as-is in the grant",
                                  { reason },
                                )
                          }
                        >
                          {reason === null
                            ? t("可采", "Collectable")
                            : t("未接", "Not supported")}
                        </span>
                        {reason === null ? null : (
                          <span className={styles.muted}>{reason}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className={styles.cardActions}>
        {work.status === "active" ? (
          <button
            type="button"
            className={styles.actionButton}
            disabled={pending}
            onClick={() => onAction({ kind: "pause", workId: work.workId })}
          >
            {t("暂停", "Pause")}
          </button>
        ) : null}
        {work.status === "paused" ? (
          <button
            type="button"
            className={styles.actionButton}
            disabled={pending}
            onClick={() => onAction({ kind: "resume", workId: work.workId })}
          >
            {t("恢复（沿用同一版本）", "Resume (same version)")}
          </button>
        ) : null}
        {work.status !== "revoked" ? (
          <button
            type="button"
            className={styles.dangerButton}
            disabled={pending}
            onClick={() =>
              setRevokeTarget(revokeTarget === work.workId ? null : work.workId)
            }
          >
            {t("撤回授权", "Revoke grant")}
          </button>
        ) : null}
      </div>

      {revokeTarget === work.workId ? (
        <div className={styles.revokeRow}>
          <label className={styles.fieldLabel}>
            {t("撤回原因（留痕）", "Revocation reason (audit trail)")}
            <input
              className={styles.input}
              value={revokeReason}
              placeholder={t(
                "例如：不再需要这类采集",
                "For example: this kind of collection is no longer needed",
              )}
              onChange={(event) => setRevokeReason(event.target.value)}
            />
          </label>
          <button
            type="button"
            className={styles.dangerButton}
            disabled={pending}
            onClick={() => {
              onAction({
                kind: "revoke",
                workId: work.workId,
                reasonCode: revokeReason.trim(),
              });
              setRevokeTarget(null);
              setRevokeReason("");
            }}
          >
            {t("确认撤回", "Confirm revocation")}
          </button>
          <span className={styles.muted}>
            {t(
              "撤回后 Agent 不再收到这份工作；要改这份采什么，就撤回后重新授权 —— 同一份工作（id 不变）、版本 +1，并按最新事实重新派生",
              "After revocation the agent no longer receives this work; to change what it collects, revoke and grant again — the same work (same id), version +1, re-derived from the latest facts",
            )}
          </span>
        </div>
      ) : null}
    </li>
  );
}

interface OneShotWorkCardProps {
  work: OneShotWork;
  /** agentd 自报（解析成功才是非 null）；`null` = 这份自报看不到，卡片不出现「本机实际」行。 */
  local: AgentLocalWorkView | null;
  pending: boolean;
  onAction: (command: WorkActionCommand) => void;
}

function OneShotWorkCard({ work, local, pending, onAction }: OneShotWorkCardProps) {
  // 本机侧的执行阶段：网关只知道「已派发/已接受」，它知道的是「开始执行了没有」。
  const localWork: AgentLocalOneShotWorkView | null = local
    ? local.oneShot.find((entry) => entry.workId === work.workId) ?? null
    : null;
  return (
    <li className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.family}>{work.action}</span>
        <span className={`${styles.badge} ${toneClass(oneShotStatusTone(work.status))}`}>
          {oneShotStatusLabel(work.status)}
        </span>
        <span className={`${styles.badge} ${toneClass(work.interruptible ? "ok" : "unknown")}`}>
          {work.interruptible
            ? t("可中断", "Interruptible")
            : t("不可中断（拒绝暂停）", "Not interruptible (rejects pause)")}
        </span>
      </div>
      <dl className={styles.factGrid}>
        <div className={styles.factRow}>
          <dt>{t("参数", "Parameters")}</dt>
          <dd className={styles.mono}>{work.spec}</dd>
        </div>
        <div className={styles.factRow}>
          <dt>{t("计划开始 / 绝对截止", "Planned start / absolute deadline")}</dt>
          <dd>
            {formatTimestamp(work.scheduledAt)} → {formatTimestamp(work.deadlineAt)}
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>{t("执行预算 / 累计暂停", "Execution budget / total paused")}</dt>
          <dd className={styles.mono}>
            {work.timeoutSeconds}s / {work.pausedTotalSeconds}s
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>{t("派发人", "Dispatched by")}</dt>
          <dd>
            {work.issuedBy} · {formatTimestamp(work.issuedAt)}
          </dd>
        </div>
        {work.result ? (
          <div className={styles.factRow}>
            <dt>{t("执行结果", "Execution result")}</dt>
            <dd>
              <span
                className={`${styles.badge} ${toneClass(oneShotStatusTone(work.result.status))}`}
              >
                {oneShotStatusLabel(work.result.status)}
              </span>{" "}
              {work.result.detail ? `${work.result.detail} · ` : ""}
              {formatTimestamp(work.result.reportedAt)}
            </dd>
          </div>
        ) : null}
        {local ? (
          <div className={styles.factRow}>
            <dt>{t("本机实际", "Local actual")}</dt>
            <dd>
              {localWork === null ? (
                <span className={`${styles.badge} ${styles.toneWarn}`}>
                  {t("本机未报这件活", "The machine has not reported this work item")}
                </span>
              ) : (
                <>
                  <span
                    className={`${styles.badge} ${toneClass(
                      oneShotStatusTone(localWork.status),
                    )}`}
                  >
                    {oneShotStatusLabel(localWork.status)}
                  </span>{" "}
                  <span className={styles.mono}>
                    {t("执行阶段 {stage}", "Execution stage {stage}", {
                      stage: localExecutionLabel(localWork.execution),
                    })}
                  </span>
                </>
              )}
            </dd>
          </div>
        ) : null}
      </dl>
      <div className={styles.cardActions}>
        <button
          type="button"
          className={styles.dangerButton}
          disabled={pending}
          onClick={() => onAction({ kind: "revoke", workId: work.workId })}
        >
          {t("取消这件活", "Cancel this work item")}
        </button>
      </div>
    </li>
  );
}

interface GrantCandidateCardProps {
  entry: GrantableFamily;
  /** 面名与说明（来自知识库；缺项回落成面 ID）。 */
  familyText: CollectionFamilyTextIndex;
  pending: boolean;
  onSubmit: (command: GrantStandingWorkCommand) => void;
}

/**
 * 一个**还没授权**的采集面，就摆成一格卡 —— 授权按钮在卡上，与旁边的已授权卡同一片网格。
 *
 * 「哪些面在采」与「哪些面还能派」于是是同一屏里的一件事：不需要另开一节、再在下拉里
 * 把这台机器的面挑一遍（同一批面列两遍，读者还得自己对着看）。面名就是卡头，所以
 * 也没有「选错面」这一步。
 *
 * 卡上**不**给「手写采集单元」的口子：派什么都由网关按这台机器的事实从采集目录展开
 * （`derive_spec` —— 逐单元求目录里的 `match`），手写就是绕过它，而且这个页面上
 * 根本看不到该面的目录单元 id。要让某台机器多采/少采一个单元，改的是目录，不是这张卡。
 */
function GrantCandidateCard({ entry, familyText, pending, onSubmit }: GrantCandidateCardProps) {
  const familySummary = collectionFamilySummary(entry.family, familyText);
  return (
    <li className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.workName}>{collectionFamilyName(entry.family, familyText)}</span>
        <span className={styles.workNameCode}>{entry.family}</span>
        <span className={`${styles.badge} ${styles.toneUnknown}`}>
          {t("未授权", "Not granted")}
        </span>
        {entry.parseReady ? null : (
          <span className={styles.muted}>
            {t("原文未归类", "Raw text not classified")}
          </span>
        )}
      </div>

      {familySummary ? (
        <p className={styles.workSummary}>{familySummary}</p>
      ) : null}

      <div className={styles.workMeta}>
        <span className={styles.workMetaMain}>
          <span className={styles.mono}>
            {t("{active}/{total} 单元可采", "{active}/{total} units collectable", {
              active: entry.activeUnits,
              total: entry.totalUnits,
            })}
          </span>
          <span className={styles.muted}>
            {t(
              "—— 授权后由网关按这台机器的事实展开",
              "— expanded by the gateway from this machine's facts after granting",
            )}
          </span>
        </span>
      </div>

      <div className={styles.cardActions}>
        <button
          type="button"
          className={styles.grantButton}
          disabled={pending}
          onClick={() => onSubmit({ family: entry.family })}
        >
          {pending ? t("提交中…", "Submitting…") : t("授权这份工作", "Grant this work")}
        </button>
      </div>
    </li>
  );
}

interface GrantOneShotFormProps {
  pending: boolean;
  onSubmit: (command: GrantOneShotWorkCommand) => void;
}

/** 默认截止：24 小时后。留空会被网关拒（没有截止的一次性工作与常驻工作无从分辨）。 */
function defaultDeadline(): string {
  const at = new Date(Date.now() + 24 * 60 * 60 * 1000);
  at.setSeconds(0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function GrantOneShotForm({ pending, onSubmit }: GrantOneShotFormProps) {
  const [action, setAction] = useState("upgrade");
  const [spec, setSpec] = useState("");
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [timeoutSeconds, setTimeoutSeconds] = useState("600");

  return (
    <div className={styles.form}>
      <div className={styles.formRow}>
        <label className={styles.fieldLabel}>
          {t("动作", "Action")}
          <input
            className={styles.input}
            value={action}
            onChange={(event) => setAction(event.target.value)}
          />
        </label>
        <label className={styles.fieldLabel}>
          {t("参数", "Parameters")}
          <input
            className={styles.input}
            value={spec}
            placeholder={t("例如目标版本 0.1.4", "For example: target version 0.1.4")}
            onChange={(event) => setSpec(event.target.value)}
          />
        </label>
        <label className={styles.fieldLabel}>
          {t("绝对截止", "Absolute deadline")}
          <input
            className={styles.input}
            type="datetime-local"
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
          />
        </label>
        <label className={styles.fieldLabel}>
          {t("执行预算（秒）", "Execution budget (seconds)")}
          <input
            className={styles.input}
            value={timeoutSeconds}
            onChange={(event) => setTimeoutSeconds(event.target.value)}
          />
        </label>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={pending || !action.trim() || !spec.trim()}
          onClick={() => {
            // `datetime-local` 是本地时间且没有时区：转成带时区的 RFC3339，
            // 否则网关按 UTC 解析，截止时间会整体偏移。
            const deadlineAt = new Date(deadline).toISOString();
            onSubmit({
              action: action.trim(),
              spec: spec.trim(),
              deadlineAt,
              timeoutSeconds: Number.parseInt(timeoutSeconds, 10) || 0,
            });
            setSpec("");
          }}
        >
          {pending ? t("提交中…", "Submitting…") : t("派发这件活", "Dispatch this work item")}
        </button>
      </div>
    </div>
  );
}
