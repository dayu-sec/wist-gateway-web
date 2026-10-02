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
import styles from "./SubsystemAgentPurposeView.module.css";

interface SubsystemAgentPurposeViewProps {
  agentPurposeView: AgentPurposeView;
}

const EMPTY = "—";

/** 机器类别中文名（模型 `Content.MachineClass`）。 */
const MACHINE_CLASS_LABEL: Record<MachineClass, string> = {
  MacDaily: "macOS 日常机",
  MacDev: "macOS 开发机",
  LinuxHost: "Linux 通用服务器",
  LinuxCompute: "Linux 计算服务器",
  LinuxData: "Linux 数据服务器",
};

/** 依据的信号种类（模型的 `kind` 是开放字符串，认不出来的原样展示）。 */
const SIGNAL_KIND_LABEL: Record<string, string> = {
  process: "进程",
  process_path: "进程路径",
  listen_port: "监听端口",
  package: "已装包",
  unit: "采集单元",
};

const METHOD_LABEL: Record<string, string> = {
  rule: "规则表推断",
  model: "模型推断",
};

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
              ? `已展开全部 ${values.length} ${unit}。`
              : `只显示前 ${LIST_RENDER_LIMIT} ${unit}，还有 ${values.length - LIST_RENDER_LIMIT} ${unit}未显示。`}
          </span>
          <button
            type="button"
            className={styles.truncationButton}
            onClick={() => setShowAll((current) => !current)}
          >
            {showAll ? "收起" : `显示全部 ${values.length} ${unit}`}
          </button>
        </div>
      ) : null}
    </>
  );
}

function signalKindLabel(kind: string): string {
  return SIGNAL_KIND_LABEL[kind] ?? kind;
}

function methodLabel(method: string): string {
  return METHOD_LABEL[method] ?? method;
}

/** 时间戳：后端给 RFC3339（含时区）；解析不了就原样展示，不猜。 */
function formatTimestamp(value: string | null): string {
  if (!value) return EMPTY;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString("zh-CN", { hour12: false });
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
        <span className={styles.noticeTitle}>尚未上报事实</span>
        <span className={styles.noticeText}>
          agentd 还没上报过这台机器的采集事实（新注册的 Agent 常见）。网关不伪造结论：事实与建议都为空，等下一次上报或人工判定。
        </span>
      </div>
    );
  }

  if (!suggestion) {
    return (
      <div className={`${styles.notice} ${styles.noticeWeak}`} role="status">
        <span className={styles.noticeTitle}>有事实，但无建议</span>
        <span className={styles.noticeText}>
          事实摘要已经在，网关却没有给出用途建议：可能没有任何规则命中、且该平台规则册没有基线类别，也可能这台机器的平台还没有规则册（宁可不猜）。事实仍然完整保留。
        </span>
      </div>
    );
  }

  return (
    <div className={`${styles.notice} ${styles.noticeOk}`} role="status">
      <span className={styles.noticeTitle}>事实 / 推断 / 判定 并列展示</span>
      <span className={styles.noticeText}>
        推断由规则表算出、可变可过期；判定是人定的、留痕。两者冲突时以判定为准，但推断仍然并列展示 —— 不是谁盖掉谁。
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
          <span className={`${styles.panelTag} ${styles.tagDecision}`}>判定</span>
          <span className={styles.verdictCellCaption}>人工判定 · 冲突时以此为准</span>
        </div>
        {classification ? (
          <div className={styles.verdictRow}>
            <span className={styles.verdictClass}>
              {MACHINE_CLASS_LABEL[classification.machineClass]}
            </span>
            <span className={styles.mono}>{classification.machineClass}</span>
            <span className={`${styles.badge} ${styles.badgeOk}`}>人工判定</span>
          </div>
        ) : (
          <div className={styles.verdictEmpty}>
            <strong>尚未人工判定</strong>
            <span>
              管理面的判定写入端点还没实现，所以现在不可能有判定值 —— 旁边的推断只是建议，不代表这台机器已被归类。
            </span>
          </div>
        )}
      </section>

      <section className={styles.verdictCell} aria-labelledby={SUGGESTION_TITLE_ID}>
        <div className={styles.verdictCellHead}>
          <span className={styles.panelTag}>推断</span>
          <span className={styles.verdictCellCaption}>规则表算出 · 可变、可过期</span>
        </div>
        {suggestion ? (
          <VerdictInference suggestion={suggestion} />
        ) : (
          <div className={styles.verdictEmpty}>
            <strong>没有建议</strong>
            <span>
              {hasFact
                ? "规则未命中，或这台机器的平台没有规则册 —— 网关宁可不猜，也不给没有依据的结论。"
                : "还没有事实摘要，没有东西可供推断。"}
            </span>
          </div>
        )}
      </section>

      {conflict ? (
        <div className={`${styles.notice} ${styles.noticeWeak} ${styles.bandConflict}`} role="status">
          <span className={styles.noticeTitle}>与网关推断不一致</span>
          <span className={styles.noticeText}>
            推断为 {MACHINE_CLASS_LABEL[conflict.suggestedClass]}（{conflict.suggestedClass}）。冲突时以人工判定为准，但推断仍然并列展示，不被盖掉。
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
          {MACHINE_CLASS_LABEL[suggestion.suggestedClass]}
        </span>
        <span className={styles.mono}>{suggestion.suggestedClass}</span>
        <span className={`${styles.badge} ${badgeToneClass(tone)}`}>
          {CONFIDENCE_LABEL[tone]}
        </span>
      </div>
      <div className={styles.confidence}>
        <div className={styles.confidenceTop}>
          <span className={styles.confidenceLabel}>置信度</span>
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
        <dt>判定人</dt>
        <dd className={styles.mono}>{classification.decidedBy}</dd>
      </div>
      <div className={styles.ledgerItem}>
        <dt>判定时间</dt>
        <dd className={styles.mono}>{formatTimestamp(classification.decidedAt)}</dd>
      </div>
      <div className={styles.ledgerItem}>
        <dt>采纳的建议</dt>
        <dd className={styles.mono}>
          {classification.suggestionId ?? EMPTY}
          <span className={styles.ledgerMeta}>
            {classification.suggestionId ? "采纳了这一次建议" : "人工直接判定或推翻了建议"}
          </span>
        </dd>
      </div>
      <div className={styles.ledgerItem}>
        <dt>备注</dt>
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
          tag="事实"
          title="Agent 事实摘要"
          caption="agentd 上报，覆盖式一台一条"
          titleId={FACT_TITLE_ID}
        />
        <div className={styles.panelEmpty}>
          <strong>尚未上报事实</strong>
          <span>
            新注册的 Agent 还没报过摘要；这里为空不是「没有用途」，而是「还不知道」。
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
        tag="事实"
        title="Agent 事实摘要"
        caption="agentd 上报，覆盖式一台一条"
        titleId={FACT_TITLE_ID}
        action={
          <CopyButton
            className={styles.copyButton}
            label="复制 JSON"
            text={factSummaryExport(factSummary)}
          />
        }
      />

      <dl className={styles.factGrid}>
        <div className={styles.factRow}>
          <dt>平台</dt>
          <dd>
            <span className={styles.mono}>
              {factSummary.os} / {factSummary.arch}
            </span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>主机标识</dt>
          <dd>
            <span className={styles.mono}>{factSummary.hostId || EMPTY}</span>
            <span className={styles.factMeta}>
              发现方向 host 的 host.id；仅留痕、不参与内容摘要，改机器名或换网不触发重报与重算。空值（{EMPTY}）表示这台还没上报过 —— 旧版 agentd 不带这些字段
            </span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>主机名</dt>
          <dd>
            <span className={styles.mono}>{factSummary.hostName || EMPTY}</span>
            <span className={styles.factMeta}>
              host.name；同样是留痕字段，同样不进内容摘要
            </span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>观测时间</dt>
          <dd>
            <span className={styles.mono}>
              {formatTimestamp(factSummary.observedAt)}
            </span>
            <span className={styles.factMeta}>agentd 采集到这份摘要的时刻</span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>入库时间</dt>
          <dd>
            <span className={styles.mono}>
              {formatTimestamp(factSummary.receivedAt)}
            </span>
            <span className={styles.factMeta}>网关收到并覆盖写入的时刻</span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>上报版本</dt>
          <dd>
            <span className={styles.mono}>revision {factSummary.revision}</span>
            <span className={styles.factMeta}>仅留痕，不参与判重</span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>内容摘要</dt>
          <dd>
            <span className={styles.mono}>{factSummary.contentDigest}</span>
            <span className={styles.factMeta}>
              幂等键：上报按内容变化触发，不按版本前进
            </span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>进程条数</dt>
          <dd>
            <span className={styles.mono}>
              去重前 {factSummary.processCount} / 去重后 {dedupedProcesses}
            </span>
            <span className={styles.factMeta}>
              去重会毁掉基数，所以另存去重前的条数
              {droppedByDedup > 0
                ? `（差额 ${droppedByDedup}：重复的可执行标识被合并，或进程本来就没有可执行名）`
                : ""}
            </span>
          </dd>
        </div>
      </dl>

      <div className={styles.listBlock}>
        <div className={styles.listHead}>
          <h3 className={styles.listTitle}>进程可执行标识</h3>
          <span className={styles.listCount}>{dedupedProcesses} 条（去重后）</span>
        </div>
        {dedupedProcesses === 0 ? (
          <p className={styles.listEmpty}>
            {factSummary.processCount > 0
              ? "未取到可执行名：这台上报了进程条数，但一条可执行标识都没拿到（内核线程等进程本来就没有可执行名）。这不是「没有进程」，去重前的条数以上报为准。"
              : "去重前的条数也是 0：这台机器没有采集到进程。"}
          </p>
        ) : (
          <CappedList
            values={factSummary.processExecutables}
            listClassName={styles.valueList}
            itemClassName={styles.mono}
            unit="条"
          />
        )}
        <p className={styles.listCaption}>
          macOS 侧是完整路径（ps -axo comm=），Linux 侧只是 basename
          （/proc/&#123;pid&#125;/comm）—— 路径类规则目前只在 macOS 成立。
        </p>
      </div>

      <div className={styles.factGrid}>
        <div className={styles.listBlock}>
          <div className={styles.listHead}>
            <h3 className={styles.listTitle}>已装包</h3>
            <span className={styles.listCount}>{factSummary.packages.length} 条</span>
          </div>
          {factSummary.packages.length === 0 ? (
            <p className={styles.listEmpty}>
              包清单探针尚未实现，此列恒空，不代表未安装。
            </p>
          ) : (
            <CappedList
              values={factSummary.packages}
              listClassName={styles.chipList}
              itemClassName={styles.chip}
              unit="条"
            />
          )}
        </div>

        <div className={styles.listBlock}>
          <div className={styles.listHead}>
            <h3 className={styles.listTitle}>监听端口</h3>
            <span className={styles.listCount}>
              {factSummary.listenPorts.length} 条
            </span>
          </div>
          {factSummary.listenPorts.length === 0 ? (
            <p className={styles.listEmpty}>没有采集到监听端口。</p>
          ) : (
            <CappedList
              values={factSummary.listenPorts}
              listClassName={styles.chipList}
              itemClassName={`${styles.chip} ${styles.mono}`}
              unit="条"
            />
          )}
        </div>

        <div className={styles.listBlock}>
          <div className={styles.listHead}>
            <h3 className={styles.listTitle}>网卡地址</h3>
            <span className={styles.listCount}>
              {factSummary.networkAddresses.length} 条
            </span>
          </div>
          {factSummary.networkAddresses.length === 0 ? (
            <p className={styles.listEmpty}>
              这台还没上报过网卡信息 —— 旧版 agentd 不带这些字段。
            </p>
          ) : (
            <CappedList
              values={factSummary.networkAddresses}
              listClassName={styles.chipList}
              itemClassName={`${styles.chip} ${styles.mono}`}
              unit="条"
            />
          )}
          <p className={styles.listCaption}>
            每块网卡一条（形如 en0 192.168.1.5/24）；仅留痕、不参与内容摘要，换网（DHCP）不触发重报与重算 —— 所以这里可能是这台机器最近一次上报时的地址。
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
          tag="推断"
          title="逐条依据"
          caption="网关凭什么给出这个建议 —— 规则表算出，可变、可过期"
          titleId={SUGGESTION_TITLE_ID}
        />
        <div className={styles.panelEmpty}>
          <strong>没有依据</strong>
          <span>
            {hasFact
              ? "规则未命中，或这台机器的平台没有规则册 —— 网关宁可不猜，也不给没有依据的结论。"
              : "还没有事实摘要，没有东西可供推断。"}
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
        tag="推断"
        title="逐条依据"
        caption="网关凭什么给出这个建议 —— 规则表算出，可变、可过期"
        titleId={SUGGESTION_TITLE_ID}
      />

      <dl className={styles.factGrid}>
        <div className={styles.factRow}>
          <dt>判定方法</dt>
          <dd>
            <span className={styles.mono}>{methodLabel(suggestion.method)}</span>
            <span className={styles.factMeta}>
              {suggestion.ruleSetId
                ? `规则册 ${suggestion.ruleSetId}`
                : "未记录规则册"}
            </span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>依据的事实</dt>
          <dd>
            <span className={styles.mono}>
              {formatTimestamp(suggestion.observedAt)}
            </span>
            <span className={styles.factMeta}>算这一版建议用的是哪次上报</span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>计算时间</dt>
          <dd>
            <span className={styles.mono}>
              {formatTimestamp(suggestion.computedAt)}
            </span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>建议 ID</dt>
          <dd>
            <span className={styles.mono}>{suggestion.suggestionId}</span>
          </dd>
        </div>
      </dl>

      <div className={styles.listBlock}>
        <div className={styles.listHead}>
          <h3 className={styles.listTitle}>信号明细</h3>
          <span className={styles.listCount}>
            {suggestion.signals.length} 条依据 · 合计权重{" "}
            {displayWeight(totalWeight)}
          </span>
        </div>
        {suggestion.signals.length === 0 ? (
          <p className={styles.listEmpty}>
            这次建议没有逐条依据：它来自规则册的基线类别兜底（置信度 0），需要人工判定才能定下来。
          </p>
        ) : (
          <div className={styles.signalWrap}>
            <table className={styles.signalTable}>
              <thead>
                <tr>
                  <th scope="col">规则</th>
                  <th scope="col">信号</th>
                  <th scope="col">命中值</th>
                  <th scope="col" className={styles.thWeight}>
                    权重
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
        title={supporting ? "支持该类别" : "反向证据：削弱该类别"}
      >
        {displayWeight(signal.weight)}
      </td>
    </tr>
  );
}
