import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, getAdminApiToken, isRateLimitedError } from "../api";
import {
  useAgentOverview,
  useAgentSoftwareInventory,
  useSoftwareFleetInventory,
} from "../hooks";
import { t } from "../i18n";
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

/**
 * 视图名。**必须是函数**：写成模块级常量的话 `t()` 只在导入时求值一次，切语言不会变 ——
 * 它只在渲染期（分段控件里）被调用。
 */
function viewLabel(view: InventoryView): string {
  return view === "by-software"
    ? t("按软件看机器", "By software")
    : t("按机器看软件", "By machine");
}

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
      return t(
        "Admin Token 缺失或无效：请在右上角点钥匙按钮，粘贴 Admin Token 后点击「应用」。",
        "Admin Token missing or invalid: click the key button in the top bar, paste the Admin Token and click “Apply”.",
      );
    if (error.status === 429)
      return t(
        "认证失败次数过多，请稍后再试。",
        "Too many failed authentication attempts. Try again later.",
      );
    // 走到这里说明 404 的正文对不上「未知 Agent」：更可能是网关没有这个路由。
    if (error.status === 404)
      return t(
        "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。",
        "The gateway has no such endpoint (HTTP 404): the running gateway is most likely an old build. Rebuild and restart it, then retry.",
      );
    return error.detail
      ? t("网关返回 HTTP {status}：{detail}", "Gateway returned HTTP {status}: {detail}", {
          status: error.status,
          detail: error.detail,
        })
      : t(
          "网关返回 HTTP {status}，请检查网关日志。",
          "Gateway returned HTTP {status}. Check the gateway logs.",
          { status: error.status },
        );
  }
  return t(
    "读取失败：响应不符合当前契约，请检查网关与前端版本。",
    "Load failed: the response does not match the current contract. Check the gateway and frontend versions.",
  );
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
        <h1 className={styles.pageTitle}>{t("资产清单", "Software inventory")}</h1>
        <p className={styles.pageSummary}>
          {t(
            "网关把每台机器上报的事实摘要",
            "The gateway ",
          )}
          <strong>{t("机械归并", "mechanically merges")}</strong>
          {t(
            "成「这台机器上有什么」。条目只有名字，而名字来自路径归并（",
            " each machine's reported fact digest into “what is on this machine”. Entries carry a name only, and that name comes from path merging (",
          )}
          <code className={styles.code}>.app</code>
          {t(
            " 取包名、其余取路径末段）：",
            " uses the bundle name, everything else uses the last path segment): ",
          )}
          <strong>{t("没有版本、没有 vendor", "no version, no vendor")}</strong>
          {t(
            " —— 识别需要在被管机器上读 ",
            " — identification requires reading ",
          )}
          <code className={styles.code}>Info.plist</code>
          {t(
            " / 包管理器，属下一层（L1b）尚未实现，所以「没版本」不等于「采集失败」。",
            " / the package manager on the managed machine, which belongs to the next layer (L1b) and is not implemented yet, so “no version” does not mean “collection failed”.",
          )}
        </p>
        <p className={styles.pageThresholds}>
          {t("清单是", "The inventory is a ")}
          <strong>{t("当前快照", "current snapshot")}</strong>
          {t(
            "：它是事实摘要的投影，随每次上报覆盖式重建，",
            ": a projection of the fact digest, rebuilt from scratch on every report. ",
          )}
          <strong>{t("不保留历史", "No history is kept")}</strong>
          {t(
            "，也翻不到「上周还有哪些软件」。",
            ", so there is no way to look back at “what software was installed last week”.",
          )}
        </p>

        {/* 两个视图不是「筛选」而是两种读法：用分段控件表达，并且同样是按下的状态。 */}
        <div
          className={styles.viewSwitch}
          role="group"
          aria-label={t("清单视图", "Inventory view")}
        >
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
              {viewLabel(key)}
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
        <h2 className={styles.sectionTitle}>{t("按软件看机器", "By software")}</h2>
        <span className={styles.sectionHint}>
          {t("按", "Sorted by ")}
          <strong>{t("持有机器数", "number of holding machines")}</strong>
          {t(
            "降序；同一个键下会列出持有它的每台机器，以及那台机器上的具体路径（一台机器可以有多条）。机器状态取自 Agent 概览 —— 那份概览只覆盖「最近在线」与「异常」的机器，所以「不在当前台账」不等于这台机器没注册。",
            ", descending; under each key every machine that holds it is listed along with the exact paths on that machine (one machine may have several). Machine status comes from the agent overview — that overview covers only recently online and abnormal machines, so “not in the current ledger” does not mean the machine is unregistered.",
          )}
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
            ? t(
                "尚未取到软件清单，用右上角「刷新」重试。",
                "No software inventory loaded yet. Use “Refresh” in the top right to retry.",
              )
            : t(
                "未设置 Admin Token：在右上角钥匙按钮里填入后才向管理面请求，这里不会显示数据。",
                "No Admin Token set: data is requested from the admin API only after you fill it in via the key button in the top bar, so nothing is shown here.",
              )}
        </div>
      ) : null}

      {data && data.software.length === 0 ? (
        <div className={styles.empty} role="status">
          <strong className={styles.emptyTitle}>
            {t("还没有任何机器上报过清单", "No machine has reported an inventory yet")}
          </strong>
          <span className={styles.emptyText}>
            {t(
              "网关里暂时没有任何软件键。这与「接口读不到」不同：请求成功了，只是还没有机器上报过带可执行路径的事实摘要。确认 Agent 已启动并完成上报后，用右上角「刷新」重取。",
              "The gateway holds no software keys yet. That is different from “cannot read the endpoint”: the request succeeded, machines simply have not reported a fact digest with executable paths yet. Make sure the agent is running and has reported, then use “Refresh” in the top right to reload.",
            )}
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
              {t("取回 500 条", "Fetch 500")}
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
                    {t("持有", "Held by")}{" "}
                    <strong>{summary.agentCount}</strong>{" "}
                    {t("台机器", "machines")}
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
                          title={t(
                            "在这台机器上查看完整清单",
                            "View the full inventory on this machine",
                          )}
                        >
                          {entry.agentId}
                        </button>
                        <StatusBadge entry={entry} />
                        <span className={styles.holderPaths}>
                          {holder.paths.length > 1 ? (
                            <>
                              {t("{n} 条路径：", "{n} paths: ", {
                                n: holder.paths.length,
                              })}
                              <span className={styles.pathText}>
                                {holder.paths.join(t("、", ", "))}
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
                      ? t("收起", "Collapse")
                      : t(
                          "显示全部 {n} 台机器",
                          "Show all {n} machines",
                          { n: holderGroups.length },
                        )}
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
        <h2 className={styles.sectionTitle}>{t("按机器看软件", "By machine")}</h2>
        <span className={styles.sectionHint}>
          {t(
            "选择一台机器，看它上报的清单按条目分组后的结果。",
            "Pick a machine to see its reported inventory grouped by entry.",
          )}
        </span>
      </div>

      <form className={styles.picker} onSubmit={handleSubmit}>
        <label className={styles.pickerLabel} htmlFor="software-inventory-agent">
          {t("机器", "Machine")}
        </label>
        <input
          id="software-inventory-agent"
          className={styles.pickerInput}
          list="software-inventory-agent-options"
          placeholder={t(
            "agent_id，例如 agent-host-20affeee1df3",
            "agent_id, e.g. agent-host-20affeee1df3",
          )}
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
          {t("查看清单", "View inventory")}
        </button>
        {agentId ? (
          <button
            type="button"
            className={styles.pickerGhost}
            onClick={onClearAgent}
          >
            {t("清除", "Clear")}
          </button>
        ) : null}
      </form>

      {knownAgents.length > 0 ? (
        <div className={styles.suggestions}>
          <span className={styles.suggestionsLabel}>
            {t(
              "概览里的机器（点击直接进入；不在这个列表里的 agent_id 也可以直接输入）：",
              "Machines from the overview (click to open directly; you can also type any agent_id not in this list):",
            )}
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
          <strong className={styles.emptyTitle}>
            {t("未选择机器", "No machine selected")}
          </strong>
          <span className={styles.emptyText}>
            {t(
              "上面填入 agent_id 后点「查看清单」，或用带",
              "Enter an agent_id above and click “View inventory”, or open a link with ",
            )}{" "}
            <code className={styles.code}>?agent=&lt;agent_id&gt;</code>{" "}
            {t(
              "的链接直接进入。清单是按机器上报的事实摘要归并出来的，「按软件看机器」则不需要先选机器。",
              "to go straight in. The inventory is merged from the fact digest each machine reports; “By software” needs no machine selected first.",
            )}
          </span>
        </div>
      ) : null}

      {agentId && isLoading ? <SkeletonRows count={3} /> : null}

      {agentId && unknownAgent ? (
        // 「这台机器不存在」（404）与「它存在但还没上报过清单」（200 + 空清单）必须分开呈现。
        <section className={styles.unknownAgent} role="alert">
          <h2 className={styles.unknownTitle}>{t("未知 Agent", "Unknown agent")}</h2>
          <p className={styles.unknownText}>
            {t("网关里没有 ", "The gateway has no registration record for agent ")}
            <strong>{agentId}</strong>
            {t(
              " 这台 Agent 的注册记录（HTTP 404）。这与「还没上报过清单」是两回事：后者是已知的 Agent 还没报过带可执行路径的摘要，网关会返回空清单与 0 计数，而不是 404。",
              " (HTTP 404). That is different from “has not reported an inventory yet”: in the latter case the agent is known but has not reported a digest with executable paths, and the gateway returns an empty inventory with a zero count instead of 404.",
            )}
          </p>
          <p className={styles.unknownHint}>
            {t(
              "请确认 agent_id 拼写是否正确；已注册的机器可以在",
              "Check that the agent_id is spelled correctly; registered machines can be verified on the ",
            )}
            <Link className={styles.unknownLink} to="/hosts">
              {t("主机指标", "Host metrics")}
            </Link>
            {t("页核对。", " page.")}
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
            ? t(
                "尚未取到这台机器的清单，用右上角「刷新」重试。",
                "This machine's inventory has not loaded yet. Use “Refresh” in the top right to retry.",
              )
            : t(
                "未设置 Admin Token：在右上角钥匙按钮里填入后才向管理面请求，这里不会显示数据。",
                "No Admin Token set: data is requested from the admin API only after you fill it in via the key button in the top bar, so nothing is shown here.",
              )}
        </div>
      ) : null}

      {data ? (
        <>
          <div className={styles.summaryCard}>
            <div className={styles.summaryMetrics}>
              <Metric label={t("条目行数", "Entry rows")} value={data.paths} />
              <Metric
                label={t("其中 app 包行", "of which .app bundle rows")}
                value={data.apps}
              />
              <Metric
                label={t("条目组（按键）", "Entry groups (by key)")}
                value={groups.length}
              />
            </div>
            <p className={styles.summaryNote}>
              {t("前两列是", "The first two columns are ")}
              <strong>{t("行数", "row counts")}</strong>
              {t("，", ", and ")}
              <strong>
                {t("都不是「软件个数」", "neither is a “software count”")}
              </strong>
              {t("：同一个 ", ": an executable that runs inside the same ")}
              <code className={styles.code}>.app</code>
              {t(
                " 包里跑了几个可执行文件就是几行，所以「行数」总是远大于「组数」。组数才是「这台机器上有多少个条目」。",
                " bundle is another row, so the row count is always far larger than the group count. The group count is what tells you how many entries this machine has.",
              )}
            </p>
          </div>

          {data.entries.length === 0 ? (
            <div className={styles.empty} role="status">
              <strong className={styles.emptyTitle}>
                {t(
                  "这台机器还没有上报过清单",
                  "This machine has not reported an inventory yet",
                )}
              </strong>
              <span className={styles.emptyText}>
                {t(
                  "网关里存在这台 Agent（不是 404），但它的事实摘要里还没有可执行路径：返回的是 0 条清单，而不是错误。清单随每次上报覆盖式重建，等它上报一次就会出现在这里。",
                  "This agent exists in the gateway (it is not a 404), but its fact digest has no executable paths yet: the gateway returns an inventory of 0 entries, not an error. The inventory is rebuilt from scratch on every report, so it will show up here once the agent reports.",
                )}
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
                      <strong>{group.pathCount}</strong>{" "}
                      {t("条可执行", "executables")}
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
                      {t("命中规则：{rules}", "Matched rules: {rules}", {
                        rules: group.matchedRules.join(t("、", ", ")),
                      })}
                      <span className={styles.cardMetaHint}>
                        {t(
                          "（规则只按路径形状归并，不读包元数据）",
                          " (rules merge by path shape only; bundle metadata is not read)",
                        )}
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
                {t(
                  "已折叠：共 {total} 组，先显示前 {shown} 组。",
                  "Collapsed: {total} groups in total, showing the first {shown}.",
                  { total: groups.length, shown: ENTRY_RENDER_LIMIT },
                )}
              </span>
              <button
                type="button"
                className={styles.moreButton}
                onClick={() => setShowAllEntries((prev) => !prev)}
              >
                {showAllEntries
                  ? t("收起", "Collapse")
                  : t("显示全部 {n} 组", "Show all {n} groups", {
                      n: groups.length,
                    })}
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
          ? t(
              "Agent 概览只覆盖「最近在线」与「异常」的机器：这里仅表示那份视图没提到它，不等于它没注册。",
              "The agent overview covers only recently online and abnormal machines: this means the view did not mention it, not that it is unregistered.",
            )
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
