import { useState, type ReactNode } from "react";
import type {
  AgentClassification,
  AgentFactSummary,
  AgentPurposeView,
  MachineClass,
  PurposeSignal,
  PurposeSuggestion,
} from "../types";
import {
  CONFIDENCE_HINT,
  CONFIDENCE_LABEL,
  confidenceTone,
  type ConfidenceTone,
} from "./agentPurposeConfidence";
import { factSummaryExport } from "./agentPurposeExport";
import { CopyButton } from "./CopyButton";
import { t, dateLocale } from "../i18n";
import styles from "./SubsystemAgentPurposeView.module.css";

interface SubsystemAgentPurposeViewProps {
  agentPurposeView: AgentPurposeView;
}

const EMPTY = "—";

/**
 * 机器类别中文名（模型 `Content.MachineClass`）。
 *
 * **必须是函数**：模块级常量里的 `t()` 只在导入时求值一次，切语言不会变。
 */
export function machineClassLabel(machineClass: MachineClass): string {
  switch (machineClass) {
    case "MacDaily":
      return t("macOS 日常机", "macOS daily driver");
    case "MacDev":
      return t("macOS 开发机", "macOS developer machine");
    case "LinuxHost":
      return t("Linux 通用服务器", "Linux general-purpose server");
    case "LinuxCompute":
      return t("Linux 计算服务器", "Linux compute server");
    case "LinuxData":
      return t("Linux 数据服务器", "Linux data server");
  }
}

/** 依据的信号种类（模型的 `kind` 是开放字符串，认不出来的原样展示）。 */
function signalKindLabel(kind: string): string {
  switch (kind) {
    case "process":
      return t("进程", "Process");
    case "process_path":
      return t("进程路径", "Process path");
    case "listen_port":
      return t("监听端口", "Listening port");
    case "package":
      return t("已装包", "Installed package");
    case "unit":
      return t("采集单元", "Collection unit");
    default:
      return kind;
  }
}

function methodLabel(method: string): string {
  switch (method) {
    case "rule":
      return t("规则表推断", "Rule table inference");
    case "model":
      return t("模型推断", "Model inference");
    default:
      return method;
  }
}

/**
 * 列表渲染上限。`process_executables` / `packages` / `listen_ports` 是**被管机器上报**
 * 的内容，可达数万条：全量 map 成 DOM 会把页面卡死。超出部分不静默丢弃 ——
 * 明确告知被截断，并给一个显式的「显示全部」。
 */
const LIST_RENDER_LIMIT = 200;

function badgeToneClass(tone: ConfidenceTone): string {
  return {
    baseline: styles.badgeUnknown,
    tie: styles.badgeTie,
    weak: styles.badgeWeak,
    fair: styles.badgeFair,
    strong: styles.badgeOk,
  }[tone];
}

function textToneClass(tone: ConfidenceTone): string {
  return {
    baseline: styles.textUnknown,
    tie: styles.textTie,
    weak: styles.textWeak,
    fair: styles.textFair,
    strong: styles.textOk,
  }[tone];
}

function barToneClass(tone: ConfidenceTone): string {
  return {
    baseline: styles.barUnknown,
    tie: styles.barTie,
    weak: styles.barWeak,
    fair: styles.barFair,
    strong: styles.barOk,
  }[tone];
}

/**
 * 有上限的字符串列表：超出 `LIST_RENDER_LIMIT` 时**明确告知被截断**，
 * 并给一个「显示全部」的显式控件（agent 可控的列表可达数万条）。
 *
 * `unit` 要传**已取词**的单位（`t("条", "entries")`）：它要拼进句子，不能是中文原文。
 */
function CappedList({
  values,
  listClassName,
  itemClassName,
  unit,
}: {
  values: string[];
  listClassName: string;
  itemClassName?: string;
  unit: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const truncated = values.length > LIST_RENDER_LIMIT;
  const visible = truncated && !showAll ? values.slice(0, LIST_RENDER_LIMIT) : values;

  return (
    <>
      <ul className={listClassName}>
        {visible.map((value) => (
          <li key={value} className={itemClassName}>
            {value}
          </li>
        ))}
      </ul>
      {truncated ? (
        <div className={styles.truncation}>
          <span role="status">
            {showAll
              ? t("已展开全部 {n} {unit}。", "Expanded all {n} {unit}.", {
                  n: values.length,
                  unit,
                })
              : t(
                  "只显示前 {limit} {unit}，还有 {rest} {unit}未显示。",
                  "Showing only the first {limit} {unit}; {rest} more not shown.",
                  {
                    limit: LIST_RENDER_LIMIT,
                    rest: values.length - LIST_RENDER_LIMIT,
                    unit,
                  },
                )}
          </span>
          <button
            type="button"
            className={styles.truncationButton}
            onClick={() => setShowAll((current) => !current)}
          >
            {showAll
              ? t("收起", "Collapse")
              : t("显示全部 {n} {unit}", "Show all {n} {unit}", {
                  n: values.length,
                  unit,
                })}
          </button>
        </div>
      ) : null}
    </>
  );
}

/** 时间戳：后端给 RFC3339（含时区）；解析不了就原样展示，不猜。 */
function formatTimestamp(value: string | null): string {
  if (!value) return EMPTY;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString(dateLocale(), { hour12: false });
}

function displayWeight(weight: number): string {
  return weight >= 0 ? `+${weight}` : String(weight);
}

/**
 * 视图状态提示条：三种**有数据**的状态要在第一眼就区分开 ——
 * 「尚未上报事实」（事实与建议都空）/「有事实、无建议」（规则未命中或平台无规则册）/
 * 「事实与结论都在」。
 *
 * 第四种状态「未知 Agent」是 HTTP 404，由页面渲染：它是「这台机器不存在」，
 * 与「它还没报过事实」是两回事，不能都当空视图。
 */
function PurposeStateNotice({
  factSummary,
  suggestion,
}: {
  factSummary: AgentFactSummary | null;
  suggestion: PurposeSuggestion | null;
}) {
  if (!factSummary) {
    return (
      <div className={`${styles.notice} ${styles.noticeUnknown}`} role="status">
        <span className={styles.noticeTitle}>
          {t("尚未上报事实", "No facts reported yet")}
        </span>
        <span className={styles.noticeText}>
          {t(
            "agentd 还没上报过这台机器的采集事实（新注册的 Agent 常见）。网关不伪造结论：事实与建议都为空，等下一次上报或人工判定。",
            "agentd has not reported collection facts for this machine yet (common for newly registered Agents). The gateway does not invent conclusions: both facts and suggestion are empty; wait for the next report or a manual decision.",
          )}
        </span>
      </div>
    );
  }

  if (!suggestion) {
    return (
      <div className={`${styles.notice} ${styles.noticeWeak}`} role="status">
        <span className={styles.noticeTitle}>
          {t("有事实，但无建议", "Facts present, but no suggestion")}
        </span>
        <span className={styles.noticeText}>
          {t(
            "事实摘要已经在，网关却没有给出用途建议：可能没有任何规则命中、且该平台规则册没有基线类别，也可能这台机器的平台还没有规则册（宁可不猜）。事实仍然完整保留。",
            "The fact summary is in, but the gateway gives no purpose suggestion: no rule may have matched and the platform rule set may have no baseline class, or this machine's platform may have no rule set yet (better to guess nothing). The facts are still kept in full.",
          )}
        </span>
      </div>
    );
  }

  return (
    <div className={`${styles.notice} ${styles.noticeOk}`} role="status">
      <span className={styles.noticeTitle}>
        {t("事实 / 推断 / 判定 并列展示", "Facts / inference / decision shown side by side")}
      </span>
      <span className={styles.noticeText}>
        {t(
          "推断由规则表算出、可变可过期；判定是人定的、留痕。两者冲突时以判定为准，但推断仍然并列展示 —— 不是谁盖掉谁。",
          "The inference is computed from the rule table and can change or expire; the decision is made by a human and leaves an audit trail. When the two conflict the decision prevails, but the inference is still shown alongside — neither overwrites the other.",
        )}
      </span>
    </div>
  );
}

function PanelHeader({
  tag,
  title,
  caption,
  titleId,
  action,
}: {
  tag: string;
  title: string;
  caption: string;
  titleId: string;
  /** 可选动作区（目前只有事实摘要的「复制 JSON」）。没有就不渲染，不影响其它分区。 */
  action?: ReactNode;
}) {
  return (
    <header className={styles.panelHeader}>
      <div className={styles.panelHeaderTop}>
        <span className={styles.panelTag}>{tag}</span>
        {action ? <div className={styles.panelAction}>{action}</div> : null}
      </div>
      <h2 className={styles.panelTitle} id={titleId}>
        {title}
      </h2>
      <p className={styles.panelCaption}>{caption}</p>
    </header>
  );
}

const FACT_TITLE_ID = "agent-purpose-fact-title";
const SUGGESTION_TITLE_ID = "agent-purpose-suggestion-title";
const CLASSIFICATION_TITLE_ID = "agent-purpose-classification-title";

export function SubsystemAgentPurposeView({
  agentPurposeView,
}: SubsystemAgentPurposeViewProps) {
  const { factSummary, suggestion, classification } = agentPurposeView;

  return (
    <div className={styles.container}>
      <PurposeStateNotice factSummary={factSummary} suggestion={suggestion} />

      <VerdictBand
        classification={classification}
        suggestion={suggestion}
        hasFact={factSummary !== null}
      />

      {classification ? (
        <ClassificationLedger classification={classification} />
      ) : null}

      <FactSection factSummary={factSummary} />
      <EvidenceSection suggestion={suggestion} hasFact={factSummary !== null} />
    </div>
  );
}

/**
 * 结论带：人工判定（以此为准）与网关推断（可变可过期）并排一格 ——
 * 冲突时在带内显式提示，但两个值都照常展示，不互相覆盖。
 */
function VerdictBand({
  classification,
  suggestion,
  hasFact,
}: {
  classification: AgentClassification | null;
  suggestion: PurposeSuggestion | null;
  hasFact: boolean;
}) {
  const conflict =
    classification && suggestion && suggestion.suggestedClass !== classification.machineClass
      ? suggestion
      : null;

  return (
    <div className={styles.verdictBand}>
      <section className={styles.verdictCell} aria-labelledby={CLASSIFICATION_TITLE_ID}>
        <div className={styles.verdictCellHead}>
          <span className={`${styles.panelTag} ${styles.tagDecision}`}>
            {t("判定", "Decision")}
          </span>
          <span className={styles.verdictCellCaption}>
            {t("人工判定 · 冲突时以此为准", "Manual decision · authoritative on conflict")}
          </span>
        </div>
        {classification ? (
          <div className={styles.verdictRow}>
            <span className={styles.verdictClass}>
              {machineClassLabel(classification.machineClass)}
            </span>
            <span className={styles.mono}>{classification.machineClass}</span>
            <span className={`${styles.badge} ${styles.badgeOk}`}>
              {t("人工判定", "Manual decision")}
            </span>
          </div>
        ) : (
          <div className={styles.verdictEmpty}>
            <strong>{t("尚未人工判定", "Not yet decided manually")}</strong>
            <span>
              {t(
                "管理面的判定写入端点还没实现，所以现在不可能有判定值 —— 旁边的推断只是建议，不代表这台机器已被归类。",
                "The admin decision write endpoint is not implemented yet, so a decision value cannot exist now — the inference next to it is only a suggestion and does not mean this machine has been classified.",
              )}
            </span>
          </div>
        )}
      </section>

      <section className={styles.verdictCell} aria-labelledby={SUGGESTION_TITLE_ID}>
        <div className={styles.verdictCellHead}>
          <span className={styles.panelTag}>{t("推断", "Inference")}</span>
          <span className={styles.verdictCellCaption}>
            {t("规则表算出 · 可变、可过期", "Computed from the rule table · mutable, can expire")}
          </span>
        </div>
        {suggestion ? (
          <VerdictInference suggestion={suggestion} />
        ) : (
          <div className={styles.verdictEmpty}>
            <strong>{t("没有建议", "No suggestion")}</strong>
            <span>
              {hasFact
                ? t(
                    "规则未命中，或这台机器的平台没有规则册 —— 网关宁可不猜，也不给没有依据的结论。",
                    "No rule matched, or this machine's platform has no rule set — the gateway would rather not guess than give a conclusion without evidence.",
                  )
                : t("还没有事实摘要，没有东西可供推断。", "No fact summary yet, so there is nothing to infer from.")}
            </span>
          </div>
        )}
      </section>

      {conflict ? (
        <div className={`${styles.notice} ${styles.noticeWeak} ${styles.bandConflict}`} role="status">
          <span className={styles.noticeTitle}>
            {t("与网关推断不一致", "Conflicts with the gateway inference")}
          </span>
          <span className={styles.noticeText}>
            {t(
              "推断为 {label}（{code}）。冲突时以人工判定为准，但推断仍然并列展示，不被盖掉。",
              "Inferred as {label} ({code}). On conflict the manual decision prevails, but the inference is still shown alongside and is not overwritten.",
              {
                label: machineClassLabel(conflict.suggestedClass),
                code: conflict.suggestedClass,
              },
            )}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** 推断半格：结论 + 紧凑置信度（逐条依据在下方全宽分区里）。 */
function VerdictInference({ suggestion }: { suggestion: PurposeSuggestion }) {
  const tone = confidenceTone(suggestion.confidence, suggestion.signals.length);

  return (
    <>
      <div className={styles.verdictRow}>
        <span className={styles.verdictClass}>
          {machineClassLabel(suggestion.suggestedClass)}
        </span>
        <span className={styles.mono}>{suggestion.suggestedClass}</span>
        <span className={`${styles.badge} ${badgeToneClass(tone)}`}>
          {CONFIDENCE_LABEL[tone]}
        </span>
      </div>
      <div className={styles.confidence}>
        <div className={styles.confidenceTop}>
          <span className={styles.confidenceLabel}>{t("置信度", "Confidence")}</span>
          <span className={`${styles.mono} ${textToneClass(tone)}`}>
            {suggestion.confidence} / 100
          </span>
        </div>
        <div className={styles.barTrack}>
          <div
            className={`${styles.barFill} ${barToneClass(tone)}`}
            style={{
              width: `${Math.min(Math.max(suggestion.confidence, 0), 100)}%`,
            }}
          />
        </div>
        <p className={styles.confidenceHint}>{CONFIDENCE_HINT[tone]}</p>
      </div>
    </>
  );
}

/**
 * 判定留痕：判定人 / 判定时间 / 采纳的建议 / 备注。
 * 判定带只放结论，留痕折成一条窄带，不再撑一个空面板。
 */
function ClassificationLedger({
  classification,
}: {
  classification: AgentClassification;
}) {
  return (
    <dl className={styles.ledger}>
      <div className={styles.ledgerItem}>
        <dt>{t("判定人", "Decided by")}</dt>
        <dd className={styles.mono}>{classification.decidedBy}</dd>
      </div>
      <div className={styles.ledgerItem}>
        <dt>{t("判定时间", "Decided at")}</dt>
        <dd className={styles.mono}>{formatTimestamp(classification.decidedAt)}</dd>
      </div>
      <div className={styles.ledgerItem}>
        <dt>{t("采纳的建议", "Adopted suggestion")}</dt>
        <dd className={styles.mono}>
          {classification.suggestionId ?? EMPTY}
          <span className={styles.ledgerMeta}>
            {classification.suggestionId
              ? t("采纳了这一次建议", "This suggestion was adopted")
              : t("人工直接判定或推翻了建议", "Decided manually, or the suggestion was overruled")}
          </span>
        </dd>
      </div>
      <div className={styles.ledgerItem}>
        <dt>{t("备注", "Note")}</dt>
        <dd className={styles.wrapText}>{classification.note ?? EMPTY}</dd>
      </div>
    </dl>
  );
}

/** 事实摘要：全宽分区。键值两列排布，长列表不再被塞进窄栏。 */
function FactSection({ factSummary }: { factSummary: AgentFactSummary | null }) {
  if (!factSummary) {
    return (
      <section className={styles.panel} aria-labelledby={FACT_TITLE_ID}>
        <PanelHeader
          tag={t("事实", "Facts")}
          title={t("Agent 事实摘要", "Agent fact summary")}
          caption={t("agentd 上报，覆盖式一台一条", "Reported by agentd, one overwritten record per machine")}
          titleId={FACT_TITLE_ID}
        />
        <div className={styles.panelEmpty}>
          <strong>{t("尚未上报事实", "No facts reported yet")}</strong>
          <span>
            {t(
              "新注册的 Agent 还没报过摘要；这里为空不是「没有用途」，而是「还不知道」。",
              "A newly registered Agent has not reported a summary yet; empty here does not mean no purpose, it means not known yet.",
            )}
          </span>
        </div>
      </section>
    );
  }

  const dedupedProcesses = factSummary.processExecutables.length;
  const droppedByDedup = Math.max(factSummary.processCount - dedupedProcesses, 0);

  return (
    <section className={styles.panel} aria-labelledby={FACT_TITLE_ID}>
      <PanelHeader
        tag={t("事实", "Facts")}
        title={t("Agent 事实摘要", "Agent fact summary")}
        caption={t("agentd 上报，覆盖式一台一条", "Reported by agentd, one overwritten record per machine")}
        titleId={FACT_TITLE_ID}
        action={
          <CopyButton
            className={styles.copyButton}
            label={t("复制 JSON", "Copy JSON")}
            text={factSummaryExport(factSummary)}
          />
        }
      />

      <dl className={styles.factGrid}>
        <div className={styles.factRow}>
          <dt>{t("平台", "Platform")}</dt>
          <dd>
            <span className={styles.mono}>
              {factSummary.os} / {factSummary.arch}
            </span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>{t("主机标识", "Host id")}</dt>
          <dd>
            <span className={styles.mono}>{factSummary.hostId || EMPTY}</span>
            <span className={styles.factMeta}>
              {t(
                "发现方向 host 的 host.id；仅留痕、不参与内容摘要，改机器名或换网不触发重报与重算。空值（{empty}）表示这台还没上报过 —— 旧版 agentd 不带这些字段",
                "host.id from the discovery direction host; for audit only and not part of the content digest: renaming the machine or changing networks triggers neither a re-report nor a recompute. An empty value ({empty}) means this machine has not reported yet — older agentd builds do not carry these fields",
                { empty: EMPTY },
              )}
            </span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>{t("主机名", "Host name")}</dt>
          <dd>
            <span className={styles.mono}>{factSummary.hostName || EMPTY}</span>
            <span className={styles.factMeta}>
              {t(
                "host.name；同样是留痕字段，同样不进内容摘要",
                "host.name; also an audit field, also excluded from the content digest",
              )}
            </span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>{t("观测时间", "Observed at")}</dt>
          <dd>
            <span className={styles.mono}>
              {formatTimestamp(factSummary.observedAt)}
            </span>
            <span className={styles.factMeta}>
              {t("agentd 采集到这份摘要的时刻", "When agentd collected this summary")}
            </span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>{t("入库时间", "Stored at")}</dt>
          <dd>
            <span className={styles.mono}>
              {formatTimestamp(factSummary.receivedAt)}
            </span>
            <span className={styles.factMeta}>
              {t("网关收到并覆盖写入的时刻", "When the gateway received and overwrote it")}
            </span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>{t("上报版本", "Reported revision")}</dt>
          <dd>
            <span className={styles.mono}>revision {factSummary.revision}</span>
            <span className={styles.factMeta}>
              {t("仅留痕，不参与判重", "For audit only, not used for dedupe")}
            </span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>{t("内容摘要", "Content digest")}</dt>
          <dd>
            <span className={styles.mono}>{factSummary.contentDigest}</span>
            <span className={styles.factMeta}>
              {t(
                "幂等键：上报按内容变化触发，不按版本前进",
                "Idempotency key: reports are triggered by content changes, not by revision increments",
              )}
            </span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>{t("进程条数", "Process count")}</dt>
          <dd>
            <span className={styles.mono}>
              {t("去重前 {before} / 去重后 {after}", "Before dedupe {before} / after dedupe {after}", {
                before: factSummary.processCount,
                after: dedupedProcesses,
              })}
            </span>
            <span className={styles.factMeta}>
              {t(
                "去重会毁掉基数，所以另存去重前的条数",
                "Dedupe destroys the cardinality, so the pre-dedupe count is stored separately",
              )}
              {droppedByDedup > 0
                ? t(
                    "（差额 {n}：重复的可执行标识被合并，或进程本来就没有可执行名）",
                    " ({n} fewer: duplicate executable identifiers were merged, or the processes never had an executable name)",
                    { n: droppedByDedup },
                  )
                : ""}
            </span>
          </dd>
        </div>
      </dl>

      <div className={styles.listBlock}>
        <div className={styles.listHead}>
          <h3 className={styles.listTitle}>
            {t("进程可执行标识", "Process executable identifiers")}
          </h3>
          <span className={styles.listCount}>
            {t("{n} 条（去重后）", "{n} entries (after dedupe)", { n: dedupedProcesses })}
          </span>
        </div>
        {dedupedProcesses === 0 ? (
          <p className={styles.listEmpty}>
            {factSummary.processCount > 0
              ? t(
                  "未取到可执行名：这台上报了进程条数，但一条可执行标识都没拿到（内核线程等进程本来就没有可执行名）。这不是「没有进程」，去重前的条数以上报为准。",
                  "No executable name obtained: this machine reported a process count but not a single executable identifier (kernel threads and the like never have one). This is not \"no processes\": the pre-dedupe count as reported is authoritative.",
                )
              : t(
                  "去重前的条数也是 0：这台机器没有采集到进程。",
                  "The pre-dedupe count is 0 as well: no processes were collected on this machine.",
                )}
          </p>
        ) : (
          <CappedList
            values={factSummary.processExecutables}
            listClassName={styles.valueList}
            itemClassName={styles.mono}
            unit={t("条", "entries")}
          />
        )}
        <p className={styles.listCaption}>
          {t(
            "macOS 侧是完整路径（ps -axo comm=），Linux 侧只是 basename（/proc/{pid}/comm）—— 路径类规则目前只在 macOS 成立。",
            "On macOS this is the full path (ps -axo comm=); on Linux it is only the basename (/proc/{pid}/comm) — path-based rules currently hold on macOS only.",
          )}
        </p>
      </div>

      <div className={styles.factGrid}>
        <div className={styles.listBlock}>
          <div className={styles.listHead}>
            <h3 className={styles.listTitle}>{t("已装包", "Installed packages")}</h3>
            <span className={styles.listCount}>
              {t("{n} 条", "{n} entries", { n: factSummary.packages.length })}
            </span>
          </div>
          {factSummary.packages.length === 0 ? (
            <p className={styles.listEmpty}>
              {t(
                "包清单探针尚未实现，此列恒空，不代表未安装。",
                "The package inventory probe is not implemented yet, so this column is always empty; it does not mean nothing is installed.",
              )}
            </p>
          ) : (
            <CappedList
              values={factSummary.packages}
              listClassName={styles.chipList}
              itemClassName={styles.chip}
              unit={t("条", "entries")}
            />
          )}
        </div>

        <div className={styles.listBlock}>
          <div className={styles.listHead}>
            <h3 className={styles.listTitle}>{t("监听端口", "Listening ports")}</h3>
            <span className={styles.listCount}>
              {t("{n} 条", "{n} entries", { n: factSummary.listenPorts.length })}
            </span>
          </div>
          {factSummary.listenPorts.length === 0 ? (
            <p className={styles.listEmpty}>
              {t("没有采集到监听端口。", "No listening ports collected.")}
            </p>
          ) : (
            <CappedList
              values={factSummary.listenPorts}
              listClassName={styles.chipList}
              itemClassName={`${styles.chip} ${styles.mono}`}
              unit={t("条", "entries")}
            />
          )}
        </div>

        <div className={styles.listBlock}>
          <div className={styles.listHead}>
            <h3 className={styles.listTitle}>{t("网卡地址", "Network addresses")}</h3>
            <span className={styles.listCount}>
              {t("{n} 条", "{n} entries", { n: factSummary.networkAddresses.length })}
            </span>
          </div>
          {factSummary.networkAddresses.length === 0 ? (
            <p className={styles.listEmpty}>
              {t(
                "这台还没上报过网卡信息 —— 旧版 agentd 不带这些字段。",
                "This machine has not reported network interface info yet — older agentd builds do not carry these fields.",
              )}
            </p>
          ) : (
            <CappedList
              values={factSummary.networkAddresses}
              listClassName={styles.chipList}
              itemClassName={`${styles.chip} ${styles.mono}`}
              unit={t("条", "entries")}
            />
          )}
          <p className={styles.listCaption}>
            {t(
              "每块网卡一条（形如 en0 192.168.1.5/24）；仅留痕、不参与内容摘要，换网（DHCP）不触发重报与重算 —— 所以这里可能是这台机器最近一次上报时的地址。",
              "One entry per network interface (for example en0 192.168.1.5/24); for audit only and not part of the content digest: changing networks (DHCP) triggers neither a re-report nor a recompute — so these may be the addresses from this machine's most recent report.",
            )}
          </p>
        </div>
      </div>
    </section>
  );
}

/** 逐条依据：全宽分区。判定方法 / 时间 / 建议 ID 折成两列键值，信号表横向铺开。 */
function EvidenceSection({
  suggestion,
  hasFact,
}: {
  suggestion: PurposeSuggestion | null;
  hasFact: boolean;
}) {
  if (!suggestion) {
    return (
      <section className={styles.panel} aria-labelledby={SUGGESTION_TITLE_ID}>
        <PanelHeader
          tag={t("推断", "Inference")}
          title={t("逐条依据", "Evidence")}
          caption={t(
            "网关凭什么给出这个建议 —— 规则表算出，可变、可过期",
            "Why the gateway made this suggestion — computed from the rule table, mutable and expirable",
          )}
          titleId={SUGGESTION_TITLE_ID}
        />
        <div className={styles.panelEmpty}>
          <strong>{t("没有依据", "No evidence")}</strong>
          <span>
            {hasFact
              ? t(
                  "规则未命中，或这台机器的平台没有规则册 —— 网关宁可不猜，也不给没有依据的结论。",
                  "No rule matched, or this machine's platform has no rule set — the gateway would rather not guess than give a conclusion without evidence.",
                )
              : t("还没有事实摘要，没有东西可供推断。", "No fact summary yet, so there is nothing to infer from.")}
          </span>
        </div>
      </section>
    );
  }

  const totalWeight = suggestion.signals.reduce(
    (sum, signal) => sum + signal.weight,
    0,
  );

  return (
    <section className={styles.panel} aria-labelledby={SUGGESTION_TITLE_ID}>
      <PanelHeader
        tag={t("推断", "Inference")}
        title={t("逐条依据", "Evidence")}
        caption={t(
          "网关凭什么给出这个建议 —— 规则表算出，可变、可过期",
          "Why the gateway made this suggestion — computed from the rule table, mutable and expirable",
        )}
        titleId={SUGGESTION_TITLE_ID}
      />

      <dl className={styles.factGrid}>
        <div className={styles.factRow}>
          <dt>{t("判定方法", "Method")}</dt>
          <dd>
            <span className={styles.mono}>{methodLabel(suggestion.method)}</span>
            <span className={styles.factMeta}>
              {suggestion.ruleSetId
                ? t("规则册 {id}", "Rule set {id}", { id: suggestion.ruleSetId })
                : t("未记录规则册", "No rule set recorded")}
            </span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>{t("依据的事实", "Facts used")}</dt>
          <dd>
            <span className={styles.mono}>
              {formatTimestamp(suggestion.observedAt)}
            </span>
            <span className={styles.factMeta}>
              {t("算这一版建议用的是哪次上报", "Which report this suggestion version was computed from")}
            </span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>{t("计算时间", "Computed at")}</dt>
          <dd>
            <span className={styles.mono}>
              {formatTimestamp(suggestion.computedAt)}
            </span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>{t("建议 ID", "Suggestion ID")}</dt>
          <dd>
            <span className={styles.mono}>{suggestion.suggestionId}</span>
          </dd>
        </div>
      </dl>

      <div className={styles.listBlock}>
        <div className={styles.listHead}>
          <h3 className={styles.listTitle}>{t("信号明细", "Signal details")}</h3>
          <span className={styles.listCount}>
            {t("{n} 条依据 · 合计权重 {weight}", "{n} evidence entries · total weight {weight}", {
              n: suggestion.signals.length,
              weight: displayWeight(totalWeight),
            })}
          </span>
        </div>
        {suggestion.signals.length === 0 ? (
          <p className={styles.listEmpty}>
            {t(
              "这次建议没有逐条依据：它来自规则册的基线类别兜底（置信度 0），需要人工判定才能定下来。",
              "This suggestion has no per-signal evidence: it comes from the rule set's baseline class fallback (confidence 0) and needs a manual decision to settle.",
            )}
          </p>
        ) : (
          <div className={styles.signalWrap}>
            <table className={styles.signalTable}>
              <thead>
                <tr>
                  <th scope="col">{t("规则", "Rule")}</th>
                  <th scope="col">{t("信号", "Signal")}</th>
                  <th scope="col">{t("命中值", "Matched value")}</th>
                  <th scope="col" className={styles.thWeight}>
                    {t("权重", "Weight")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {suggestion.signals.map((signal, index) => (
                  <SignalRow
                    key={`${signal.ruleId}:${signal.value}:${index}`}
                    signal={signal}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function SignalRow({ signal }: { signal: PurposeSignal }) {
  const supporting = signal.weight >= 0;
  return (
    <tr>
      <td className={styles.mono}>{signal.ruleId}</td>
      <td>{signalKindLabel(signal.kind)}</td>
      <td className={styles.mono}>{signal.value}</td>
      <td
        className={`${styles.mono} ${styles.tdWeight} ${
          supporting ? styles.weightPositive : styles.weightNegative
        }`}
        title={
          supporting
            ? t("支持该类别", "Supports this class")
            : t("反向证据：削弱该类别", "Counter-evidence: weakens this class")
        }
      >
        {displayWeight(signal.weight)}
      </td>
    </tr>
  );
}
