import { useState } from "react";
import type {
  AgentWorkView,
  ContentCatalogView,
  MachineClass,
  OneShotWork,
  StandingWork,
} from "../types";
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
  driftingCount,
  grantableFamilies,
  metricIntervalSeconds,
  oneShotStatusLabel,
  oneShotStatusTone,
  platformForMachineClass,
  sourceLabel,
  specCounts,
  standingDrift,
  workCapabilities,
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
 * 页面要回答三件事，分节就是为了这三件事互不干扰：
 *   1. **在采什么** —— 生效中的常驻工作与它们的采集单元（`spec` 里的条目）；
 *   2. **派下去到了没有** —— 期望版本 vs Agent 确认版本（漂移）；
 *   3. **能派什么** —— 面就绪度闸门下的可选面，与派不了的面的原因。
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
  const blocked = catalog && machineClass ? blockedFamilies(catalog, machineClass) : [];

  return (
    <div className={styles.view}>
      <section className={styles.summary} aria-label="工作摘要">
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>授权序号</span>
          <span className={styles.summaryValue}>{agentWorkView.sequence}</span>
          <span className={styles.summaryHint}>
            Agent 据此判断快照有没有变（每 30 秒拉一次）
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
            生效中的常驻工作
          </h2>
          <span className={styles.sectionHint}>
            一个采集面一份；暂停是**期望状态的一部分**（Agent 没在做不算漂移），
            撤回才是停止
          </span>
        </header>

        {agentWorkView.standing.length === 0 ? (
          <p className={styles.emptyNotice}>
            这台机器当前**没有**生效中的工作：它不做采集（也不上送指标）。
            在下面选一个采集面派下去。
          </p>
        ) : (
          <ul className={styles.cardList}>
            {agentWorkView.standing.map((work) => (
              <StandingWorkCard
                key={work.workId}
                work={work}
                pending={pending}
                onAction={onAction}
                revokeTarget={revokeTarget}
                revokeReason={revokeReason}
                setRevokeTarget={setRevokeTarget}
                setRevokeReason={setRevokeReason}
              />
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="agent-work-grant-title">
        <header className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle} id="agent-work-grant-title">
            派一份常驻工作
          </h2>
          <span className={styles.sectionHint}>
            工作参数留空即由网关**按这台机器的事实**从采集目录展开；同一面再授一次是
            改这一份（版本 +1），不是多出一份
          </span>
        </header>

        {!machineClass ? (
          <p className={styles.blockedNotice}>
            派活的前置是**用途判定**：它决定取哪份模板、也就决定了能派哪些面。
            这台机器还没归档判定 ——
            <a className={styles.inlineLink} href="./purpose">
              先去用途页归档
            </a>
            （判定的依据是它上报的事实摘要；没上报过事实时网关会拒绝，不默认放行）。
          </p>
        ) : catalogUnavailable ? (
          <p className={styles.blockedNotice}>
            采集内容目录未装载（网关未配置 `[content]` 三件套）：无法展开工作参数，
            也就无法派活。配好内容目录并重启网关后再来。
          </p>
        ) : !catalog ? (
          <p className={styles.blockedNotice}>
            正在加载采集内容目录（可派的面来自它）。
          </p>
        ) : (
          <GrantStandingForm
            grantable={grantable}
            blocked={blocked}
            platform={platformForMachineClass(machineClass)}
            machineClass={machineClass}
            pending={pending}
            onSubmit={onGrantStanding}
          />
        )}
      </section>

      <section className={styles.section} aria-labelledby="agent-work-oneshot-title">
        <header className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle} id="agent-work-oneshot-title">
            一次性工作
          </h2>
          <span className={styles.sectionHint}>
            有计划开始时间与绝对截止，有明确终态；暂停也照走截止
          </span>
        </header>

        <p className={styles.gapNotice}>
          注意：agentd 侧**尚未实现一次性工作的执行** —— 派下去会停在「已派发」或
          「已接受」，不会被确认，也不会推进。当前适合用来验证派发与状态流转。
        </p>

        {agentWorkView.oneShot.length === 0 ? (
          <p className={styles.emptyNotice}>没有未了结的一次性工作。</p>
        ) : (
          <ul className={styles.cardList}>
            {agentWorkView.oneShot.map((work) => (
              <OneShotWorkCard
                key={work.workId}
                work={work}
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
                已撤回 / 已被取代的常驻工作 {agentWorkView.retiredStanding.length} 条，
                已了结的一次性工作 {agentWorkView.settledOneShot.length} 条
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

interface StandingWorkCardProps {
  work: StandingWork;
  pending: boolean;
  onAction: (command: WorkActionCommand) => void;
  revokeTarget: string | null;
  revokeReason: string;
  setRevokeTarget: (workId: string | null) => void;
  setRevokeReason: (reason: string) => void;
}

function StandingWorkCard({
  work,
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
  return (
    <li className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.family}>{work.family}</span>
        <span className={`${styles.badge} ${toneClass(STANDING_STATUS_TONE[work.status])}`}>
          {STANDING_STATUS_LABEL[work.status]}
        </span>
        <span className={`${styles.badge} ${toneClass(DRIFT_TONE[drift])}`}>
          {DRIFT_LABEL[drift]}
        </span>
      </div>

      <dl className={styles.factGrid}>
        <div className={styles.factRow}>
          <dt>期望版本</dt>
          <dd className={styles.mono}>{work.planVersion}</dd>
        </div>
        <div className={styles.factRow}>
          <dt>Agent 确认</dt>
          <dd className={styles.mono}>
            {work.ack
              ? `版本 ${work.ack.planVersion} · ${formatTimestamp(work.ack.acknowledgedAt)}`
              : "从未确认"}
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>目录版本</dt>
          <dd className={styles.mono}>
            {work.catalogVersion}
            <span className={styles.muted}>
              （目录换版不追改已授权工作）
            </span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>工作参数</dt>
          <dd>
            {work.spec.error ? (
              <span className={styles.critText}>
                参数无法解析：{work.spec.error}
              </span>
            ) : (
              <>
                <span className={styles.mono}>
                  {counts.units} 个单元 · {counts.sources} 条来源
                  {interval === null ? "" : ` · 指标 ${interval}s`}
                </span>
                <span className={styles.muted}>
                  承接：{workCapabilities(work.spec).join("、") || "—"}
                </span>
              </>
            )}
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>谁改的</dt>
          <dd>
            {work.updatedBy} · {formatTimestamp(work.updatedAt)}
          </dd>
        </div>
      </dl>

      {work.spec.error ? (
        <pre className={styles.specRaw}>{work.spec.raw}</pre>
      ) : (
        <ul className={styles.unitList}>
          {work.spec.units.map((unit) => (
            <li key={unit.unitId} className={styles.unitItem}>
              <span className={styles.mono}>{unit.unitId}</span>
              <span className={styles.unitMeta}>
                {unit.capability}
                {unit.ruleRef ? ` · 规则 ${unit.ruleRef}` : " · 未绑定规则"}
                {unit.requiresPrivilege && unit.requiresPrivilege !== "none"
                  ? ` · 需 ${unit.requiresPrivilege}`
                  : ""}
              </span>
              <span className={styles.unitMeta}>
                {unit.sources
                  .map((_, index) => sourceLabel(unit, index))
                  .join("；") || "无来源声明"}
              </span>
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
            撤回后 Agent 不再收到这份工作；从撤回恢复要走新的授权
          </span>
        </div>
      ) : null}
    </li>
  );
}

interface OneShotWorkCardProps {
  work: OneShotWork;
  pending: boolean;
  onAction: (command: WorkActionCommand) => void;
}

function OneShotWorkCard({ work, pending, onAction }: OneShotWorkCardProps) {
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

interface GrantStandingFormProps {
  grantable: { family: string; activeUnits: number; totalUnits: number }[];
  blocked: { family: string; reason: string }[];
  platform: string;
  machineClass: MachineClass;
  pending: boolean;
  onSubmit: (command: GrantStandingWorkCommand) => void;
}

function GrantStandingForm({
  grantable,
  blocked,
  platform,
  machineClass,
  pending,
  onSubmit,
}: GrantStandingFormProps) {
  const [family, setFamily] = useState("");
  const [spec, setSpec] = useState("");
  const selected = family || grantable[0]?.family || "";

  if (grantable.length === 0) {
    return (
      <div className={styles.blockedNotice}>
        <strong>{machineClass}</strong>（{platform}）当前**没有任何就绪的采集面**：
        所有面的规则都还没写好（没有 `status = active` 的采集单元），因此无可授权。
        <ul className={styles.blockedList}>
          {blocked.map((entry) => (
            <li key={entry.family}>
              <span className={styles.mono}>{entry.family}</span> —— {entry.reason}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className={styles.form}>
      <div className={styles.formRow}>
        <label className={styles.fieldLabel}>
          采集面
          <select
            className={styles.input}
            value={selected}
            onChange={(event) => setFamily(event.target.value)}
          >
            {grantable.map((entry) => (
              <option key={entry.family} value={entry.family}>
                {entry.family}（{entry.activeUnits}/{entry.totalUnits} 单元就绪）
              </option>
            ))}
          </select>
        </label>
        <label className={styles.fieldLabel}>
          工作参数（留空 = 网关按事实展开）
          <input
            className={styles.input}
            value={spec}
            placeholder="留空最稳；手写时必须是该面上的目录单元，逗号分隔"
            onChange={(event) => setSpec(event.target.value)}
          />
        </label>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={pending || !selected}
          onClick={() => {
            onSubmit({
              family: selected,
              spec: spec.trim() ? spec.trim() : undefined,
            });
            setSpec("");
          }}
        >
          {pending ? "提交中…" : "授权这份工作"}
        </button>
      </div>
      {blocked.length > 0 ? (
        <details className={styles.blockedDetails}>
          <summary className={styles.muted}>
            另有 {blocked.length} 个面还不能派（规则未就绪 / 平台不适用）
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
    </div>
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
