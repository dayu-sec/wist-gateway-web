import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, getAdminApiToken, isRateLimitedError } from "../api";
import {
  useAgentOverview,
  useAgentSoftwareInventory,
  useSoftwareFleetInventory,
} from "../hooks";
import {
  AGENT_LEDGER_STATUS_LABEL,
  SOFTWARE_KIND_LABEL,
  buildAgentLedger,
  groupHoldersByAgent,
  groupSoftwareEntries,
  isUnknownAgentError,
  ledgerEntryFor,
  truncationNotice,
  type AgentLedgerEntry,
} from "./softwareInventory";
import { RateLimitNotice } from "./RateLimitNotice";
import styles from "./SubsystemSoftwareInventoryPage.module.css";

interface SubsystemSoftwareInventoryPageProps {
  children?: React.ReactNode;
}

/**
 * 「按机器看软件」/「按软件看机器」。
 *
 * 两个视图都用 URL 参数表达：`?view=` 与 `?agent=` —— 运维把链接贴给别人时，
 * 应该打开的是同一屏，而不是回到默认视图。
 */
type InventoryView = "by-software" | "by-agent";

const VIEW_LABEL: Record<InventoryView, string> = {
  "by-software": "按软件看机器",
  "by-agent": "按机器看软件",
};

/** 「按软件看机器」的可选上限：后端把 limit 夹到 1..500，默认 100。 */
const FLEET_LIMIT_DEFAULT = 100;
const FLEET_LIMIT_MAX = 500;

/**
 * 渲染上限：一台机器的清单可达数百条可执行路径（实测 629 条 / 85 条 app），
 * 一次性全量 map 成 DOM 会卡页面。超出不静默丢弃 —— 给出「显示全部」。
 */
const ENTRY_RENDER_LIMIT = 200;
/** 一个键可能被机队里很多机器持有，同样先折叠渲染、超额明示。 */
const HOLDER_RENDER_LIMIT = 20;

function readView(params: URLSearchParams): InventoryView {
  const raw = params.get("view");
  if (raw === "by-software" || raw === "by-agent") return raw;
  // 带 agent 参数的链接默认落在「按机器看软件」：链接意图就是看那台机器。
  return params.get("agent") ? "by-agent" : "by-software";
}

/** 读取失败时的提示（与其它管理面页面同一口径）。 */
function loadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击「应用」。";
    if (error.status === 429) return "认证失败次数过多，请稍后再试。";
    // 走到这里说明 404 的正文对不上「未知 Agent」：更可能是网关没有这个路由。
    if (error.status === 404)
      return "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。";
    return error.detail
      ? `网关返回 HTTP ${error.status}：${error.detail}`
      : `网关返回 HTTP ${error.status}，请检查网关日志。`;
  }
  return "读取失败：响应不符合当前契约，请检查网关与前端版本。";
}

/**
 * 资产清单页（L1a 机械资产清单，管理面条目 `ViewSoftwareInventory`）。
 *
 * 这一层刻意**只归并、不识别**，页面必须把这一点写在明处，否则很容易被读成
 * 「网关连版本都没采到」：条目名来自路径归并，没有版本、没有 vendor，
 * 因为识别要在被管机器上读 `Info.plist` / 包管理器（L1b，未做）；
 * 清单是摘要的投影，随每次上报覆盖式重建，不保留历史。
 */
export function SubsystemSoftwareInventoryPage({}: SubsystemSoftwareInventoryPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = readView(searchParams);
  const agentId = searchParams.get("agent") ?? "";
  const [limit, setLimit] = useState(FLEET_LIMIT_DEFAULT);

  function updateParams(next: { view?: InventoryView; agent?: string | null }) {
    const params = new URLSearchParams(searchParams);
    if (next.view) params.set("view", next.view);
    if (next.agent !== undefined) {
      if (next.agent) params.set("agent", next.agent);
      else params.delete("agent");
    }
    setSearchParams(params);
  }

  function openAgent(nextAgentId: string) {
    const trimmed = nextAgentId.trim();
    if (!trimmed) return;
    updateParams({ view: "by-agent", agent: trimmed });
  }

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>资产清单</h1>
        <p className={styles.pageSummary}>
          网关把每台机器上报的事实摘要<strong>机械归并</strong>成「这台机器上有什么」。条目只有名字，而名字来自路径归并（<code className={styles.code}>.app</code> 取包名、其余取路径末段）：
          <strong>没有版本、没有 vendor</strong> —— 识别需要在被管机器上读 <code className={styles.code}>Info.plist</code> / 包管理器，属下一层（L1b）尚未实现，所以「没版本」不等于「采集失败」。
        </p>
        <p className={styles.pageThresholds}>
          清单是<strong>当前快照</strong>：它是事实摘要的投影，随每次上报覆盖式重建，
          <strong>不保留历史</strong>，也翻不到「上周还有哪些软件」。
        </p>

        {/* 两个视图不是「筛选」而是两种读法：用分段控件表达，并且同样是按下的状态。 */}
        <div className={styles.viewSwitch} role="group" aria-label="清单视图">
          {(["by-software", "by-agent"] as InventoryView[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              className={
                view === key
                  ? `${styles.viewTab} ${styles.viewTabActive}`
                  : styles.viewTab
              }
              onClick={() => updateParams({ view: key })}
            >
              {VIEW_LABEL[key]}
            </button>
          ))}
        </div>
      </header>

      {view === "by-software" ? (
        <FleetInventory
          limit={limit}
          onWidenLimit={() => setLimit(FLEET_LIMIT_MAX)}
          onOpenAgent={openAgent}
        />
      ) : (
        <AgentInventory
          agentId={agentId}
          onOpenAgent={openAgent}
          onClearAgent={() => updateParams({ agent: null })}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 视图一：按软件看机器
// ─────────────────────────────────────────────────────────────────────────────

function FleetInventory({
  limit,
  onWidenLimit,
  onOpenAgent,
}: {
  limit: number;
  onWidenLimit: () => void;
  onOpenAgent: (agentId: string) => void;
}) {
  const { data, error, isLoading, isError } = useSoftwareFleetInventory(limit);
  // 台账（主机名 / 状态）来自概览：holders 只有 agent_id，页面负责把它翻译成人看得懂的名字。
  const { data: overview } = useAgentOverview();
  const ledger = useMemo(() => buildAgentLedger(overview), [overview]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  const notice = data
    ? truncationNotice({
        truncated: data.truncated,
        returned: data.software.length,
        limit,
      })
    : null;

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>按软件看机器</h2>
        <span className={styles.sectionHint}>
          按<strong>持有机器数</strong>降序；同一个键下会列出持有它的每台机器，以及那台机器上的具体路径（一台机器可以有多条）。机器状态取自 Agent 概览 —— 那份概览只覆盖「最近在线」与「异常」的机器，所以「不在当前台账」不等于这台机器没注册。
        </span>
      </div>

      {isError ? (
        isRateLimitedError(error) ? (
          <RateLimitNotice error={error} />
        ) : (
          <div className={styles.errorBanner} role="alert">
            {loadErrorMessage(error)}
          </div>
        )
      ) : null}

      {isLoading ? <SkeletonRows count={4} /> : null}

      {!isLoading && !isError && !data ? (
        <div className={styles.idleNotice} role="status">
          {getAdminApiToken()
            ? "尚未取到软件清单，用右上角「刷新」重试。"
            : "未设置 Admin Token：在左侧填入后才向管理面请求，这里不会显示数据。"}
        </div>
      ) : null}

      {data && data.software.length === 0 ? (
        <div className={styles.empty} role="status">
          <strong className={styles.emptyTitle}>还没有任何机器上报过清单</strong>
          <span className={styles.emptyText}>
            网关里暂时没有任何软件键。这与「接口读不到」不同：请求成功了，只是还没有机器上报过带可执行路径的事实摘要。确认 Agent 已启动并完成上报后，用右上角「刷新」重取。
          </span>
        </div>
      ) : null}

      {notice ? (
        <div className={styles.truncatedNotice} role="status">
          <span>{notice}</span>
          {limit < FLEET_LIMIT_MAX ? (
            <button
              type="button"
              className={styles.widenButton}
              onClick={onWidenLimit}
            >
              取回 500 条
            </button>
          ) : null}
        </div>
      ) : null}

      {data && data.software.length > 0 ? (
        <div className={styles.cardList}>
          {data.software.map((summary) => {
            const holderGroups = groupHoldersByAgent(summary.holders);
            const expanded = expandedKeys.includes(summary.softwareKey);
            const visibleHolders = expanded
              ? holderGroups
              : holderGroups.slice(0, HOLDER_RENDER_LIMIT);
            return (
              <article key={summary.softwareKey} className={styles.card}>
                <header className={styles.cardHead}>
                  <div className={styles.cardTitleWrap}>
                    <span className={styles.cardTitle}>{summary.name}</span>
                    <span
                      className={
                        summary.kind === "app"
                          ? `${styles.kindBadge} ${styles.kindApp}`
                          : styles.kindBadge
                      }
                    >
                      {SOFTWARE_KIND_LABEL[summary.kind]}
                    </span>
                  </div>
                  <span className={styles.cardCount}>
                    持有 <strong>{summary.agentCount}</strong> 台机器
                  </span>
                </header>
                <p className={styles.cardKey}>{summary.softwareKey}</p>

                <ul className={styles.holderList}>
                  {visibleHolders.map((holder) => {
                    const entry = ledgerEntryFor(ledger, holder.agentId);
                    return (
                      <li key={holder.agentId} className={styles.holderRow}>
                        <button
                          type="button"
                          className={styles.holderLink}
                          onClick={() => onOpenAgent(holder.agentId)}
                          title="在这台机器上查看完整清单"
                        >
                          {entry.agentId}
                        </button>
                        <StatusBadge entry={entry} />
                        <span className={styles.holderPaths}>
                          {holder.paths.length > 1 ? (
                            <>
                              {holder.paths.length} 条路径：
                              <span className={styles.pathText}>
                                {holder.paths.join("、")}
                              </span>
                            </>
                          ) : (
                            <span className={styles.pathText}>
                              {holder.paths[0]}
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                {holderGroups.length > HOLDER_RENDER_LIMIT ? (
                  <button
                    type="button"
                    className={styles.moreButton}
                    onClick={() =>
                      setExpandedKeys((keys) =>
                        expanded
                          ? keys.filter((key) => key !== summary.softwareKey)
                          : [...keys, summary.softwareKey],
                      )
                    }
                  >
                    {expanded
                      ? "收起"
                      : `显示全部 ${holderGroups.length} 台机器`}
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 视图二：按机器看软件
// ─────────────────────────────────────────────────────────────────────────────

function AgentInventory({
  agentId,
  onOpenAgent,
  onClearAgent,
}: {
  agentId: string;
  onOpenAgent: (agentId: string) => void;
  onClearAgent: () => void;
}) {
  const [draft, setDraft] = useState(agentId);
  const { data: overview } = useAgentOverview();
  const ledger = useMemo(() => buildAgentLedger(overview), [overview]);
  const { data, error, isLoading, isError } = useAgentSoftwareInventory(agentId);
  const [showAllEntries, setShowAllEntries] = useState(false);

  // URL 是唯一真相：从「按软件看机器」点进来、或用浏览器后退换机器时，
  // 输入框要跟着变，否则会显示上一次手输的内容。
  useEffect(() => setDraft(agentId), [agentId]);
  // 换了机器就收起「显示全部」：那是上一条清单的展开状态。
  useEffect(() => setShowAllEntries(false), [agentId]);

  const knownAgents = useMemo(() => {
    const ids: string[] = [];
    for (const agent of overview?.recentOnlineAgents ?? []) ids.push(agent.agentId);
    for (const agent of overview?.abnormalAgents ?? []) {
      if (!ids.includes(agent.agentId)) ids.push(agent.agentId);
    }
    return ids;
  }, [overview]);

  const groups = useMemo(
    () => (data ? groupSoftwareEntries(data.entries) : []),
    [data],
  );
  const visibleGroups = showAllEntries
    ? groups
    : groups.slice(0, ENTRY_RENDER_LIMIT);

  const unknownAgent = isError && isUnknownAgentError(error);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onOpenAgent(draft);
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>按机器看软件</h2>
        <span className={styles.sectionHint}>
          选择一台机器，看它上报的清单按条目分组后的结果。
        </span>
      </div>

      <form className={styles.picker} onSubmit={handleSubmit}>
        <label className={styles.pickerLabel} htmlFor="software-inventory-agent">
          机器
        </label>
        <input
          id="software-inventory-agent"
          className={styles.pickerInput}
          list="software-inventory-agent-options"
          placeholder="agent_id，例如 agent-host-20affeee1df3"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          autoComplete="off"
        />
        <datalist id="software-inventory-agent-options">
          {knownAgents.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
        <button
          type="submit"
          className={styles.pickerButton}
          disabled={!draft.trim()}
        >
          查看清单
        </button>
        {agentId ? (
          <button
            type="button"
            className={styles.pickerGhost}
            onClick={onClearAgent}
          >
            清除
          </button>
        ) : null}
      </form>

      {knownAgents.length > 0 ? (
        <div className={styles.suggestions}>
          <span className={styles.suggestionsLabel}>
            概览里的机器（点击直接进入；不在这个列表里的 agent_id 也可以直接输入）：
          </span>
          <div className={styles.suggestionChips}>
            {knownAgents.slice(0, 24).map((id) => (
              <button
                key={id}
                type="button"
                className={
                  id === agentId
                    ? `${styles.chip} ${styles.chipActive}`
                    : styles.chip
                }
                onClick={() => onOpenAgent(id)}
              >
                {ledgerEntryFor(ledger, id).agentId}
                <span className={styles.chipStatus}>
                  {AGENT_LEDGER_STATUS_LABEL[ledgerEntryFor(ledger, id).status]}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* 未选机器：与「这台机器没有数据」是两回事，先要人给一个 agent_id。 */}
      {!agentId ? (
        <div className={styles.empty} role="status">
          <strong className={styles.emptyTitle}>未选择机器</strong>
          <span className={styles.emptyText}>
            上面填入 agent_id 后点「查看清单」，或用带{" "}
            <code className={styles.code}>?agent=&lt;agent_id&gt;</code> 的链接直接进入。清单是按机器上报的事实摘要归并出来的，「按软件看机器」则不需要先选机器。
          </span>
        </div>
      ) : null}

      {agentId && isLoading ? <SkeletonRows count={3} /> : null}

      {agentId && unknownAgent ? (
        // 「这台机器不存在」（404）与「它存在但还没上报过清单」（200 + 空清单）必须分开呈现。
        <section className={styles.unknownAgent} role="alert">
          <h2 className={styles.unknownTitle}>未知 Agent</h2>
          <p className={styles.unknownText}>
            网关里没有 <strong>{agentId}</strong> 这台 Agent 的注册记录（HTTP 404）。这与「还没上报过清单」是两回事：后者是已知的 Agent 还没报过带可执行路径的摘要，网关会返回空清单与 0 计数，而不是 404。
          </p>
          <p className={styles.unknownHint}>
            请确认 agent_id 拼写是否正确；已注册的机器可以在
            <Link className={styles.unknownLink} to="/hosts">
              主机指标
            </Link>
            页核对。
          </p>
        </section>
      ) : null}

      {agentId && isError && !unknownAgent ? (
        isRateLimitedError(error) ? (
          <RateLimitNotice error={error} />
        ) : (
          <div className={styles.errorBanner} role="alert">
            {loadErrorMessage(error)}
          </div>
        )
      ) : null}

      {agentId && !isLoading && !isError && !data ? (
        <div className={styles.idleNotice} role="status">
          {getAdminApiToken()
            ? "尚未取到这台机器的清单，用右上角「刷新」重试。"
            : "未设置 Admin Token：在左侧填入后才向管理面请求，这里不会显示数据。"}
        </div>
      ) : null}

      {data ? (
        <>
          <div className={styles.summaryCard}>
            <div className={styles.summaryMetrics}>
              <Metric label="条目行数" value={data.paths} />
              <Metric label="其中 app 包行" value={data.apps} />
              <Metric label="条目组（按键）" value={groups.length} />
            </div>
            <p className={styles.summaryNote}>
              前两列是<strong>行数</strong>，<strong>都不是「软件个数」</strong>：同一个 <code className={styles.code}>.app</code> 包里跑了几个可执行文件就是几行，所以「行数」总是远大于「组数」。组数才是「这台机器上有多少个条目」。
            </p>
          </div>

          {data.entries.length === 0 ? (
            <div className={styles.empty} role="status">
              <strong className={styles.emptyTitle}>这台机器还没有上报过清单</strong>
              <span className={styles.emptyText}>
                网关里存在这台 Agent（不是 404），但它的事实摘要里还没有可执行路径：返回的是 0 条清单，而不是错误。清单随每次上报覆盖式重建，等它上报一次就会出现在这里。
              </span>
            </div>
          ) : (
            <div className={styles.cardList}>
              {visibleGroups.map((group) => (
                <article key={group.softwareKey} className={styles.card}>
                  <header className={styles.cardHead}>
                    <div className={styles.cardTitleWrap}>
                      <span className={styles.cardTitle}>{group.name}</span>
                      <span
                        className={
                          group.kind === "app"
                            ? `${styles.kindBadge} ${styles.kindApp}`
                            : styles.kindBadge
                        }
                      >
                        {SOFTWARE_KIND_LABEL[group.kind]}
                      </span>
                    </div>
                    <span className={styles.cardCount}>
                      <strong>{group.pathCount}</strong> 条可执行
                    </span>
                  </header>
                  <p className={styles.cardKey}>{group.softwareKey}</p>
                  <ul className={styles.pathList}>
                    {group.paths.map((path) => (
                      <li key={path} className={styles.pathRow}>
                        {path}
                      </li>
                    ))}
                  </ul>
                  {group.matchedRules.length > 0 ? (
                    <p className={styles.cardMeta}>
                      命中规则：{group.matchedRules.join("、")}
                      <span className={styles.cardMetaHint}>
                        （规则只按路径形状归并，不读包元数据）
                      </span>
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          )}

          {groups.length > ENTRY_RENDER_LIMIT ? (
            <div className={styles.moreRow}>
              <span className={styles.moreHint}>
                已折叠：共 {groups.length} 组，先显示前 {ENTRY_RENDER_LIMIT} 组。
              </span>
              <button
                type="button"
                className={styles.moreButton}
                onClick={() => setShowAllEntries((prev) => !prev)}
              >
                {showAllEntries ? "收起" : `显示全部 ${groups.length} 组`}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 小组件
// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({ entry }: { entry: AgentLedgerEntry }) {
  const tone = {
    online: styles.ledgerOnline,
    abnormal: styles.ledgerAbnormal,
    offline: styles.ledgerAbnormal,
    example: styles.ledgerExample,
    unknown: styles.ledgerUnknown,
  }[entry.status];
  return (
    <span
      className={`${styles.ledgerBadge} ${tone}`}
      title={
        entry.status === "unknown"
          ? "Agent 概览只覆盖「最近在线」与「异常」的机器：这里仅表示那份视图没提到它，不等于它没注册。"
          : undefined
      }
    >
      {AGENT_LEDGER_STATUS_LABEL[entry.status]}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricValue}>{value}</span>
      <span className={styles.metricLabel}>{label}</span>
    </div>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className={styles.skeletonWrap}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={styles.skeletonRow} />
      ))}
    </div>
  );
}
