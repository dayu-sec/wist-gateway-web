import type {
  AgentClassification,
  AgentFactSummary,
  AgentPurposeView,
  MachineClass,
  PurposeSignal,
  PurposeSuggestion,
} from "../types";
import styles from "./SubsystemAgentPurposeView.module.css";

interface SubsystemAgentPurposeViewProps {
  agentPurposeView: AgentPurposeView;
}

const EMPTY = "—";

/** 机器类别中文名（模型 `Content.MachineClass`）。 */
const MACHINE_CLASS_LABEL: Record<MachineClass, string> = {
  MacDaily: "macOS 日常机",
  MacDev: "macOS 开发机",
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
 * 结论强度的分档。
 *
 * `confidence = 100 ×（最高分 − 次高分）/ 最高分`，总分低于规则册的 `weak_score`
 * 再打对折；**0 表示只有规则册的基线类别兜底**（没有任何有效规则命中）。
 * 0 和 100 完全不是一回事：一个是没有依据，一个是有把握，页面必须一眼看出差别。
 */
type ConfidenceTone = "baseline" | "weak" | "fair" | "strong";

function confidenceTone(confidence: number): ConfidenceTone {
  if (!Number.isFinite(confidence) || confidence <= 0) return "baseline";
  if (confidence < 50) return "weak";
  if (confidence < 80) return "fair";
  return "strong";
}

const CONFIDENCE_LABEL: Record<ConfidenceTone, string> = {
  baseline: "无有效依据",
  weak: "弱结论",
  fair: "中等把握",
  strong: "有把握",
};

const CONFIDENCE_HINT: Record<ConfidenceTone, string> = {
  baseline:
    "只有规则册的基线类别兜底：没有任何有效规则命中（或正负证据相互抵消），不代表网关认定这台机器就是这一类。",
  weak: "弱结论：最高分只略微领先次高分，或总分低于规则册的 weak_score 被打过折。",
  fair: "中等把握：最高分对次高分有优势，但仍可能有规则未覆盖的信号。",
  strong: "有把握：最高分明显领先次高分。",
};

function badgeToneClass(tone: ConfidenceTone): string {
  return {
    baseline: styles.badgeUnknown,
    weak: styles.badgeWeak,
    fair: styles.badgeFair,
    strong: styles.badgeOk,
  }[tone];
}

function textToneClass(tone: ConfidenceTone): string {
  return {
    baseline: styles.textUnknown,
    weak: styles.textWeak,
    fair: styles.textFair,
    strong: styles.textOk,
  }[tone];
}

function barToneClass(tone: ConfidenceTone): string {
  return {
    baseline: styles.barUnknown,
    weak: styles.barWeak,
    fair: styles.barFair,
    strong: styles.barOk,
  }[tone];
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
 * 「三分并列」。
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
          agentd 还没上报过这台机器的采集事实（新注册的 Agent 常见）。网关不伪造结论：
          事实与建议都为空，等下一次上报或人工判定。
        </span>
      </div>
    );
  }

  if (!suggestion) {
    return (
      <div className={`${styles.notice} ${styles.noticeWeak}`} role="status">
        <span className={styles.noticeTitle}>有事实，但无建议</span>
        <span className={styles.noticeText}>
          事实摘要已经在，网关却没有给出用途建议：可能没有任何规则命中、且该平台规则册没有
          基线类别，也可能这台机器的平台还没有规则册（宁可不猜）。事实仍然完整保留。
        </span>
      </div>
    );
  }

  return (
    <div className={`${styles.notice} ${styles.noticeOk}`} role="status">
      <span className={styles.noticeTitle}>事实 / 推断 / 判定 三分并列</span>
      <span className={styles.noticeText}>
        推断由规则表算出、可变可过期；判定是人定的、留痕。两者冲突时以判定为准，
        但推断仍然并列展示 —— 不是谁盖掉谁。
      </span>
    </div>
  );
}

function PanelHeader({
  tag,
  title,
  caption,
  titleId,
}: {
  tag: string;
  title: string;
  caption: string;
  titleId: string;
}) {
  return (
    <header className={styles.panelHeader}>
      <span className={styles.panelTag}>{tag}</span>
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

      <div className={styles.columns}>
        <FactSummaryPanel factSummary={factSummary} />
        <SuggestionPanel
          suggestion={suggestion}
          hasFact={factSummary !== null}
        />
        <ClassificationPanel
          classification={classification}
          suggestion={suggestion}
        />
      </div>
    </div>
  );
}

function FactSummaryPanel({
  factSummary,
}: {
  factSummary: AgentFactSummary | null;
}) {
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
      />

      <dl className={styles.factList}>
        <div className={styles.factRow}>
          <dt>平台</dt>
          <dd>
            <span className={styles.mono}>
              {factSummary.os} / {factSummary.arch}
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
              {droppedByDedup > 0 ? `（合并了 ${droppedByDedup} 条）` : ""}
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
          <p className={styles.listEmpty}>没有采集到进程。</p>
        ) : (
          <ul className={styles.valueList}>
            {factSummary.processExecutables.map((executable) => (
              <li key={executable} className={styles.mono}>
                {executable}
              </li>
            ))}
          </ul>
        )}
        <p className={styles.listCaption}>
          macOS 侧是完整路径（ps -axo comm=），Linux 侧只是 basename
          （/proc/&#123;pid&#125;/comm）—— 路径类规则目前只在 macOS 成立。
        </p>
      </div>

      <div className={styles.listBlock}>
        <div className={styles.listHead}>
          <h3 className={styles.listTitle}>已装包</h3>
          <span className={styles.listCount}>{factSummary.packages.length} 条</span>
        </div>
        {factSummary.packages.length === 0 ? (
          <p className={styles.listEmpty}>未采集到包清单（当前只采集 Linux 侧）。</p>
        ) : (
          <ul className={styles.chipList}>
            {factSummary.packages.map((name) => (
              <li key={name} className={styles.chip}>
                {name}
              </li>
            ))}
          </ul>
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
          <ul className={styles.chipList}>
            {factSummary.listenPorts.map((port) => (
              <li key={port} className={`${styles.chip} ${styles.mono}`}>
                {port}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function SuggestionPanel({
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
          title="网关用途建议"
          caption="规则表算出，可变、可过期"
          titleId={SUGGESTION_TITLE_ID}
        />
        <div className={styles.panelEmpty}>
          <strong>没有建议</strong>
          <span>
            {hasFact
              ? "规则未命中，或这台机器的平台没有规则册 —— 网关宁可不猜，也不给没有依据的结论。"
              : "还没有事实摘要，没有东西可供推断。"}
          </span>
        </div>
      </section>
    );
  }

  const tone = confidenceTone(suggestion.confidence);
  const totalWeight = suggestion.signals.reduce(
    (sum, signal) => sum + signal.weight,
    0,
  );

  return (
    <section className={styles.panel} aria-labelledby={SUGGESTION_TITLE_ID}>
      <PanelHeader
        tag="推断"
        title="网关用途建议"
        caption="规则表算出，可变、可过期"
        titleId={SUGGESTION_TITLE_ID}
      />

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

      <dl className={styles.factList}>
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
          <h3 className={styles.listTitle}>凭什么这么判</h3>
          <span className={styles.listCount}>
            {suggestion.signals.length} 条依据 · 合计权重{" "}
            {displayWeight(totalWeight)}
          </span>
        </div>
        {suggestion.signals.length === 0 ? (
          <p className={styles.listEmpty}>
            这次建议没有逐条依据：它来自规则册的基线类别兜底（置信度 0），
            需要人工判定才能定下来。
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

function ClassificationPanel({
  classification,
  suggestion,
}: {
  classification: AgentClassification | null;
  suggestion: PurposeSuggestion | null;
}) {
  if (!classification) {
    return (
      <section
        className={styles.panel}
        aria-labelledby={CLASSIFICATION_TITLE_ID}
      >
        <PanelHeader
          tag="判定"
          title="人工判定"
          caption="人定的类别：一台一条，改判留痕"
          titleId={CLASSIFICATION_TITLE_ID}
        />
        <div className={styles.panelEmpty}>
          <strong>尚未人工判定</strong>
          <span>
            管理面的判定写入端点还没实现，所以现在不可能有判定值 ——
            中间的推断只是建议，不代表这台机器已被归类。
          </span>
        </div>
      </section>
    );
  }

  // 冲突时以判定为准，但推断照旧并列展示（不覆盖、不隐藏）。
  const suggestionInConflict =
    suggestion && suggestion.suggestedClass !== classification.machineClass
      ? suggestion
      : null;

  return (
    <section className={styles.panel} aria-labelledby={CLASSIFICATION_TITLE_ID}>
      <PanelHeader
        tag="判定"
        title="人工判定"
        caption="人定的类别：一台一条，改判留痕"
        titleId={CLASSIFICATION_TITLE_ID}
      />

      <div className={styles.verdictRow}>
        <span className={styles.verdictClass}>
          {MACHINE_CLASS_LABEL[classification.machineClass]}
        </span>
        <span className={styles.mono}>{classification.machineClass}</span>
        <span className={`${styles.badge} ${styles.badgeOk}`}>人工判定</span>
      </div>

      {suggestionInConflict ? (
        <div className={`${styles.notice} ${styles.noticeWeak}`} role="status">
          <span className={styles.noticeTitle}>与网关推断不一致</span>
          <span className={styles.noticeText}>
            推断为 {MACHINE_CLASS_LABEL[suggestionInConflict.suggestedClass]}
            （{suggestionInConflict.suggestedClass}）。冲突时以人工判定为准，
            但推断仍然并列展示，不被盖掉。
          </span>
        </div>
      ) : null}

      <dl className={styles.factList}>
        <div className={styles.factRow}>
          <dt>判定人</dt>
          <dd>
            <span className={styles.mono}>{classification.decidedBy}</span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>判定时间</dt>
          <dd>
            <span className={styles.mono}>
              {formatTimestamp(classification.decidedAt)}
            </span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>采纳的建议</dt>
          <dd>
            <span className={styles.mono}>
              {classification.suggestionId ?? EMPTY}
            </span>
            <span className={styles.factMeta}>
              {classification.suggestionId
                ? "采纳了这一次建议"
                : "人工直接判定或推翻了建议"}
            </span>
          </dd>
        </div>
        <div className={styles.factRow}>
          <dt>备注</dt>
          <dd>
            <span className={styles.wrapText}>{classification.note ?? EMPTY}</span>
          </dd>
        </div>
      </dl>
    </section>
  );
}
