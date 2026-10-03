import { useState } from "react";
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
  DRIFT_LABEL,
  DRIFT_TONE,
  STANDING_STATUS_LABEL,
  STANDING_STATUS_TONE,
  blockedFamilies,
  collectedLogFiles,
  driftingCount,
  duplicatedCollectedPaths,
  grantableFamilies,
  localExecutionLabel,
  metricIntervalSeconds,
  oneShotStatusLabel,
  oneShotStatusTone,
  platformForMachineClass,
  sourceText,
  specCounts,
  standingDrift,
  ungrantedFamilies,
  unsupportedSourceCount,
  unsupportedSourceReason,
} from "./agentWorkStatus";
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
  actionError: string | null;
  actionNotice: string | null;
  onAction: (command: WorkActionCommand) => void;
  onGrantStanding: (command: GrantStandingWorkCommand) => void;
  onGrantOneShot: (command: GrantOneShotWorkCommand) => void;
}

function formatTimestamp(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString("zh-CN", { hour12: false });
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
  actionError,
  actionNotice,
  onAction,
  onGrantStanding,
  onGrantOneShot,
}: SubsystemAgentWorkViewProps) {
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const drift = driftingCount(agentWorkView.standing);
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
      <section className={styles.summary} aria-label="工作摘要">
        <div className={`${styles.summaryItem} ${lag > 0 ? styles.summaryWarn : ""}`}>
          <span className={styles.summaryLabel}>授权序号</span>
          <span className={styles.summaryValue}>{agentWorkView.sequence}</span>
          <span className={styles.summaryHint}>
            {lag > 0
              ? `本机上报时还停在 ${agentWorkView.sequence - lag}（落后 ${lag} 版）`
              : "本机上报时已跟到这一版（它每 30 秒拉一次快照）"}
          </span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>生效中</span>
          <span className={styles.summaryValue}>{agentWorkView.standing.length}</span>
          <span className={styles.summaryHint}>个采集面在下发中</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>未了结的一次性工作</span>
          <span className={styles.summaryValue}>{agentWorkView.oneShot.length}</span>
        </div>
        <div
          className={`${styles.summaryItem} ${drift > 0 ? styles.summaryAlert : ""}`}
        >
          <span className={styles.summaryLabel}>漂移</span>
          <span className={styles.summaryValue}>{drift}</span>
          <span className={styles.summaryHint}>
            期望版本与 Agent 确认对不上的工作数
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
            常驻工作
          </h2>
          <span className={styles.sectionHint}>
            一个采集面一份，可派的面直接在这张卡上授权。已授权的卡：头两行是网关<strong>期望</strong>的样子，下面那行「本机实际」是 agentd 自报的 —— 两者对不上才是要查的事。暂停是<strong>期望状态的一部分</strong>（Agent 没在做不算漂移），撤回才是停止；要改这份采什么，撤回后重新授权（同一份工作、版本 +1，按最新事实重新派生）
          </span>
        </header>

        {agentWorkView.standing.length === 0 && ungranted.length === 0 ? (
          <p className={styles.emptyNotice}>
            这台机器当前<strong>没有</strong>生效中的常驻工作，也没有可派的采集面。
          </p>
        ) : (
          <ul className={styles.cardList}>
            {agentWorkView.standing.map((work) => (
              <StandingWorkCard
                key={work.workId}
                work={work}
                local={local}
                sharedPaths={sharedPaths}
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
                pending={pending}
                onSubmit={onGrantStanding}
              />
            ))}
          </ul>
        )}

        {/* 派活的前置与摆不到卡上的面：卡里放不下的部分，在这里说清。 */}
        {!machineClass ? (
          <p className={styles.blockedNotice}>
            派活的前置是<strong>用途判定</strong>：它决定取哪份模板、也就决定了能派哪些面。这台机器还没归档判定 ——
            <a className={styles.inlineLink} href="./purpose">
              先去用途页归档
            </a>
            （判定的依据是它上报的事实摘要；没上报过事实时网关会拒绝，不默认放行）。
          </p>
        ) : catalogUnavailable ? (
          <p className={styles.blockedNotice}>
            采集内容目录未装载（网关未配置 <span className={styles.mono}>[content]</span> 三件套）：无法展开工作参数，也就无法派活。配好内容目录并重启网关后再来。
          </p>
        ) : !catalog ? (
          <p className={styles.blockedNotice}>
            正在加载采集内容目录（可派的面来自它）。
          </p>
        ) : (
          <>
            {grantable.length === 0 ? (
              <p className={styles.blockedNotice}>
                <strong>{machineClass}</strong>（{platformForMachineClass(machineClass)}
                ）当前<strong>没有任何可采的采集面</strong>：所有面都还没有采集就绪的单元（没有{" "}
                <span className={styles.mono}>status = active</span>），因此无可授权。
              </p>
            ) : null}
            {blocked.length > 0 ? (
              <details className={styles.blockedDetails}>
                <summary className={styles.muted}>
                  另有 {blocked.length} 个面还不能派（采集未就绪 / 平台不适用）
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
            一次性工作
          </h2>
          <span className={styles.sectionHint}>
            有计划开始时间与绝对截止，有明确终态；暂停也照走截止。每张卡下面的「本机实际」是 agentd 自报的执行阶段
          </span>
        </header>

        <p className={styles.gapNotice}>
          当前 agentd 只执行 <span className={styles.mono}>upgrade</span> 这一种动作（其余动作派下去会停在「已派发」）；升级由分离进程 <span className={styles.mono}>wist-upgrader</span> 执行，进度与终态经 <span className={styles.mono}>work:result</span> 回报 —— 回滚在控制面上记为「失败」，说明里写清回到哪一版。
        </p>

        {agentWorkView.oneShot.length === 0 ? (
          <p className={styles.emptyNotice}>没有未了结的一次性工作。</p>
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
                历史留痕
              </span>
              <span className={styles.sectionHint}>
                已撤回 / 已被取代的常驻工作 {agentWorkView.retiredStanding.length} 条，已了结的一次性工作 {agentWorkView.settledOneShot.length} 条
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
                    版本 {work.planVersion} · {work.updatedBy} ·{" "}
                    {formatTimestamp(work.updatedAt)}
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
        这台 Agent 还没上报本机视图（旧版本 agentd 不上报此字段）—— 下面每张工作卡的「本机实际」都看不到。
      </p>
    );
  }

  if (local.error) {
    return (
      <p className={styles.localStripError} role="alert">
        本机工作上报无法解析（可能是网关与 agentd 版本不一致）：{local.error}
      </p>
    );
  }

  return (
    <div className={styles.localStrip} aria-label="agentd 自报">
      <span className={styles.localStripLabel}>agentd 自报</span>
      <span className={styles.localStripItem}>
        上报于{" "}
        <span className={styles.localStripValue}>
          {formatTimestamp(local.recordedAt)}
        </span>
      </span>
      <span className={styles.localStripItem}>
        指标上送周期{" "}
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
          本机多出来的
        </h2>
        <span className={styles.sectionHint}>
          本机在做、网关这边没有对应授权的东西：网关撤不回，也不在上面那些卡片里
        </span>
      </header>

      {orphanStanding.length > 0 ? (
        <div className={styles.localGroup}>
          <span className={styles.localGroupTitle}>
            本机手上还有的工作（{orphanStanding.length}）
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
                  v{work.planVersion} · {work.tasks.length} 个采集任务 · 生效自{" "}
                  {formatTimestamp(work.effectiveFrom)}
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.localNote}>
            网关这边已经没有这些工作的授权了 —— 多半是刚撤回、本机还没拉到下一版快照；若它一直不退，就是本机残留，只能在本机处理。
          </p>
        </div>
      ) : null}

      {manualInputs.length > 0 ? (
        <div className={styles.localGroup}>
          <span className={styles.localGroupTitle}>
            本机手工加的输入（{manualInputs.length}）
          </span>
          <ul className={styles.localFileList}>
            {manualInputs.map((input) => (
              <li key={input.path} className={styles.localFileRow}>
                <span className={styles.mono}>{input.path}</span>
                <span className={`${styles.badge} ${styles.toneWarn}`}>
                  本机手工加的
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.localNote}>
            它们来自本机配置（<span className={styles.mono}>[telemetry.logs] file_inputs</span>，运维逃生舱），不来自任何采集面：网关不知道、也不会撤回，该不该留只在本机判。
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
  pending,
  onAction,
  revokeTarget,
  revokeReason,
  setRevokeTarget,
  setRevokeReason,
}: StandingWorkCardProps) {
  const drift = standingDrift(work);
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
  return (
    <li
      className={styles.card}
      // 审计信息（目录版本 / 谁改的 / 本机生效自 / 采集任务数）不常看，收进 tooltip，
      // 不占正文行 —— 正文只留「现在该知道的」。
      title={[
        `目录 v${work.catalogVersion}（换版不追改）`,
        `${work.updatedBy} 改于 ${formatTimestamp(work.updatedAt)}`,
        localWork
          ? `本机生效自 ${formatTimestamp(localWork.effectiveFrom)}，${localWork.tasks.length} 个采集任务`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      <div className={styles.cardHeader}>
        <span className={styles.family}>{work.family}</span>
        <span className={`${styles.badge} ${toneClass(STANDING_STATUS_TONE[work.status])}`}>
          {STANDING_STATUS_LABEL[work.status]}
        </span>
        <span className={`${styles.badge} ${toneClass(DRIFT_TONE[drift])}`}>
          {DRIFT_LABEL[drift]}
        </span>
      </div>

      {work.spec.error ? (
        <span className={styles.critText}>
          参数无法解析：{work.spec.error}
        </span>
      ) : (
        <div className={styles.workMeta}>
          <span className={styles.workMetaMain}>
            <span className={styles.mono}>v{work.planVersion}</span>
            {/* 已确认且版本一致时，「确认」这件事没什么可说 —— 对不上的时候才值得占一行。 */}
            {drift === "in-sync" ? null : (
              <span className={styles.mono}>
                {work.ack ? `已确认 v${work.ack.planVersion}` : "从未确认"}
              </span>
            )}
            <span className={styles.mono}>
              {counts.units} 单元 · {counts.sources} 来源
              {unsupported > 0 ? ` · ${unsupported} 未接` : ""}
              {interval === null ? "" : ` · 指标 ${interval}s`}
            </span>
          </span>
        </div>
      )}

      {/* 「本机实际」只在**对不上**时才出现：一致就是没话说，不必占一行。 */}
      {local && localWork === null ? (
        <div className={styles.localRow}>
          <span className={styles.localRowLabel}>本机实际</span>
          <span className={`${styles.badge} ${styles.toneWarn}`}>
            本机未报这份工作
          </span>
          <span className={styles.muted}>
            它还没拉到这一版授权（每 30 秒拉一次快照）
          </span>
        </div>
      ) : null}

      {local &&
      localWork !== null &&
      (localWork.status !== work.status || staleLocalVersion || localAckBehind) ? (
        <div className={styles.localRow}>
          <span className={styles.localRowLabel}>本机实际</span>
          <span className={styles.mono}>
            {STANDING_STATUS_LABEL[localWork.status as StandingWorkStatus] ??
              localWork.status}
          </span>
          {localWork.status !== work.status ? (
            <span className={`${styles.badge} ${styles.toneWarn}`}>
              网关期望「{STANDING_STATUS_LABEL[work.status]}」
            </span>
          ) : null}
          {staleLocalVersion ? (
            <span className={`${styles.badge} ${styles.toneWarn}`}>
              手上还是 v{localWork.planVersion}
            </span>
          ) : null}
          {localAckBehind ? (
            <span className={`${styles.badge} ${styles.toneWarn}`}>
              只确认到 v{localWork.acknowledgedVersion}
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
            {work.status === "paused" ? "恢复后将采" : "在采"}（{files.length}）
          </span>
          {localFiles !== null && filesMismatch ? (
            // 对不上就把两份清单各写各的：只报两个数字、清单却取自期望，
            // 读者会把「本机 1」看成在采期望那一个，正好把差异读反。
            <>
              <span className={styles.mono}>
                期望 {files.length}（{files.join(" · ") || "—"}）
              </span>
              <span className={styles.mono}>
                本机 {localFiles.length}（{localFiles.join(" · ") || "—"}）
              </span>
            </>
          ) : files.length === 0 ? (
            <span className={styles.muted}>
              —（这份授权里没有今天能采的日志文件）
            </span>
          ) : (
            // 一致时不重复「期望 1 / 本机 1」：一致就是没话说，只列文件。
            <span className={styles.mono}>{files.join(" · ")}</span>
          )}
          {sharedFiles.length > 0 ? (
            <span className={`${styles.badge} ${styles.toneWarn}`}>
              {sharedFiles.join(" · ")} 另有一份工作在采
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
                    ? ` · 需 ${unit.requiresPrivilege}`
                    : ""}
                </span>
              </span>
              {unit.sources.length === 0 ? (
                <span className={styles.unitMeta}>无来源声明</span>
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
                              ? "本地采集器今天能 tail 这个来源"
                              : `${reason}：agentd 今天还采不到，已在授权里如实列出`
                          }
                        >
                          {reason === null ? "可采" : "未接"}
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
            暂停
          </button>
        ) : null}
        {work.status === "paused" ? (
          <button
            type="button"
            className={styles.actionButton}
            disabled={pending}
            onClick={() => onAction({ kind: "resume", workId: work.workId })}
          >
            恢复（沿用同一版本）
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
            撤回授权
          </button>
        ) : null}
      </div>

      {revokeTarget === work.workId ? (
        <div className={styles.revokeRow}>
          <label className={styles.fieldLabel}>
            撤回原因（留痕）
            <input
              className={styles.input}
              value={revokeReason}
              placeholder="例如：不再需要这类采集"
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
            确认撤回
          </button>
          <span className={styles.muted}>
            撤回后 Agent 不再收到这份工作；要改这份采什么，就撤回后重新授权 —— 同一份工作（id 不变）、版本 +1，并按最新事实重新派生
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
          {work.interruptible ? "可中断" : "不可中断（拒绝暂停）"}
        </span>
      </div>
      <dl className={styles.factGrid}>
        <div className={styles.factRow}>
          <dt>参数</dt>
          <dd className={styles.mono}>{work.spec}</dd>
        </div>
        <div className={styles.factRow}>
          <dt>计划开始 / 绝对截止</dt>
          <dd>
            {formatTimestamp(work.scheduledAt)} → {formatTimestamp(work.deadlineAt)}
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>执行预算 / 累计暂停</dt>
          <dd className={styles.mono}>
            {work.timeoutSeconds}s / {work.pausedTotalSeconds}s
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>派发人</dt>
          <dd>
            {work.issuedBy} · {formatTimestamp(work.issuedAt)}
          </dd>
        </div>
        {work.result ? (
          <div className={styles.factRow}>
            <dt>执行结果</dt>
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
            <dt>本机实际</dt>
            <dd>
              {localWork === null ? (
                <span className={`${styles.badge} ${styles.toneWarn}`}>
                  本机未报这件活
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
                    执行阶段 {localExecutionLabel(localWork.execution)}
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
          取消这件活
        </button>
      </div>
    </li>
  );
}

interface GrantCandidateCardProps {
  entry: GrantableFamily;
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
function GrantCandidateCard({ entry, pending, onSubmit }: GrantCandidateCardProps) {
  return (
    <li className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.family}>{entry.family}</span>
        <span className={`${styles.badge} ${styles.toneUnknown}`}>未授权</span>
        {entry.parseReady ? null : <span className={styles.muted}>原文未归类</span>}
      </div>

      <div className={styles.workMeta}>
        <span className={styles.workMetaMain}>
          <span className={styles.mono}>
            {entry.activeUnits}/{entry.totalUnits} 单元可采
          </span>
          <span className={styles.muted}>—— 授权后由网关按这台机器的事实展开</span>
        </span>
      </div>

      <div className={styles.cardActions}>
        <button
          type="button"
          className={styles.grantButton}
          disabled={pending}
          onClick={() => onSubmit({ family: entry.family })}
        >
          {pending ? "提交中…" : "授权这份工作"}
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
          动作
          <input
            className={styles.input}
            value={action}
            onChange={(event) => setAction(event.target.value)}
          />
        </label>
        <label className={styles.fieldLabel}>
          参数
          <input
            className={styles.input}
            value={spec}
            placeholder="例如目标版本 0.1.4"
            onChange={(event) => setSpec(event.target.value)}
          />
        </label>
        <label className={styles.fieldLabel}>
          绝对截止
          <input
            className={styles.input}
            type="datetime-local"
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
          />
        </label>
        <label className={styles.fieldLabel}>
          执行预算（秒）
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
          {pending ? "提交中…" : "派发这件活"}
        </button>
      </div>
    </div>
  );
}
