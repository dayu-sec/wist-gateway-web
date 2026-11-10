import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError } from "../api";
import type {
  AgentCommandQueueFilter,
  AgentCommandQueueItem,
  AgentCommandSource,
} from "../api/admin";
import { useAgentCommandQueue, useRegisteredAgents } from "../hooks";
import { dateLocale, t } from "../i18n";
import {
  commandAgeLabel,
  commandKindLabel,
  commandKindRoute,
  commandSourceLabel,
  isAgentCommandQueueFilter,
  outcomeLabel,
  outcomeTone,
  queueStateLabel,
  queueStateTone,
  type QueueTone,
} from "../lib/commandQueue";
import styles from "./SubsystemAgentCommandQueuePage.module.css";

/**
 * 「任务队列」页（路由 `/commands`）：agentd 要执行的**一次性命令**排到哪儿了。
 *
 * 为什么需要这一页：命令散在各功能入口（调查 / 重采 / 刷新 / 指标标签），
 * 而「中心刚下发的那条调查，机器到底收到没有」以前没有任何地方能看 ——
 * 中心侧只知道「已投递给网关」，网关侧只知道「已入队」。这里把网关这一队摊开：
 * 谁排的（中心 / 页面 / 系统）、给哪台机器、排了多久、认领没有、回执说了什么。
 *
 * 只读：这一页不发命令、不改状态。要发起请去对应功能页 —— 队列页的职责是观测。
 */

interface QueueTab {
  filter: AgentCommandQueueFilter;
  label: string;
  hint: string;
}

/** 四个 tab：前两个是「还没结束」，`acked` 只算真正执行过的。 */
function queueTabs(): QueueTab[] {
  return [
    {
      filter: "queued",
      label: t("待执行", "Queued"),
      hint: t(
        "还没被 agentd 取走。排太久说明那台机器没在跑（或 agentd 没在报状态）。",
        "Not picked up by agentd yet. A long wait means the machine (or agentd) is not reporting.",
      ),
    },
    {
      filter: "claimed",
      label: t("执行中", "Running"),
      hint: t(
        "已经被取走、还在跑。调查最长 120 秒，超过就该怀疑机器侧卡住了。",
        "Claimed and still running. Investigations take up to 120s; longer means the machine side is likely stuck.",
      ),
    },
    {
      filter: "acked",
      label: t("已回执", "Reported"),
      hint: t(
        "真正执行过并回了结论。过期 / 被取代的命令不在这里（它们没跑），请看「全部」。",
        "Executed and reported. Expired / superseded commands are not here (they never ran) — see All.",
      ),
    },
    {
      filter: "all",
      label: t("全部", "All"),
      hint: t(
        "最近 100 条，新 → 旧。含过期与被取代 —— 这两种写了回执时刻，但**没有执行过**。",
        "The latest 100, newest first. Includes expired and superseded — those carry a receipt time but never ran.",
      ),
    },
  ];
}

function sourceTone(source: AgentCommandSource): string {
  switch (source) {
    case "center":
      return styles.toneInfo;
    case "admin":
      return styles.toneAccent;
    default:
      return styles.toneNeutral;
  }
}

function toneClass(tone: QueueTone): string {
  switch (tone) {
    case "queued":
      return styles.toneWarn;
    case "claimed":
      return styles.toneInfo;
    case "acked":
      return styles.toneOk;
    default:
      return styles.toneNeutral;
  }
}

/** 绝对时刻（`title` 里给可核对的时间；表格上显示的是相对时长）。 */
function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(dateLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(parsed);
}

/** 读取队列失败时的提示。404 单独说：这一页需要网关 ≥ 0.44。 */
function queueErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return t(
        "Admin Token 缺失或无效：请在右上角点钥匙按钮，粘贴 Admin Token 后点击“应用”。",
        "Admin Token missing or invalid: click the key button in the top bar, paste the Admin Token and click “Apply”.",
      );
    if (error.status === 429)
      return t(
        "认证失败次数过多，请稍后再试。",
        "Too many failed authentication attempts. Try again later.",
      );
    if (error.status === 404)
      return t(
        "网关没有命令队列接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，需要 0.44 及以上。",
        "The gateway has no command-queue endpoint (HTTP 404): the running gateway is probably an older build; 0.44 or newer is required.",
      );
    return error.detail
      ? t(
          "网关返回 HTTP {status}：{detail}",
          "The gateway returned HTTP {status}: {detail}",
          { status: error.status, detail: error.detail },
        )
      : t(
          "网关返回 HTTP {status}，请检查网关日志。",
          "The gateway returned HTTP {status}; check the gateway logs.",
          { status: error.status },
        );
  }
  return t(
    "读取失败：响应不符合当前契约，请检查网关与前端版本。",
    "Load failed: the response does not match the current contract. Check the gateway and front-end versions.",
  );
}

function emptyHint(filter: AgentCommandQueueFilter): {
  title: string;
  body: string;
} {
  switch (filter) {
    case "queued":
      return {
        title: t("队列是空的", "The queue is empty"),
        body: t(
          "现在没有等 agentd 执行的命令。中心下发的调查会先出现在这里，等机器认领后转到「执行中」。",
          "No command is waiting for agentd right now. An investigation dispatched from the center shows up here first, then moves to Running once the machine claims it.",
        ),
      };
    case "claimed":
      return {
        title: t("没有正在执行的命令", "Nothing is running"),
        body: t(
          "agentd 取走命令后会在这里短暂出现（调查最长 120 秒），执行完就落到「已回执」。",
          "Commands appear here briefly after agentd claims them (investigations take up to 120s), then move to Reported.",
        ),
      };
    case "acked":
      return {
        title: t("还没有执行完的命令", "No command has reported yet"),
        body: t(
          "这里只统计真正执行过的命令；过期与被取代的命令在「全部」里。",
          "Only commands that actually ran are counted here; expired and superseded ones are under All.",
        ),
      };
    default:
      return {
        title: t("没有任何命令记录", "No commands at all"),
        body: t(
          "这一队由功能页的发起动作填充：发起调查、重采事实、刷新指标标签，或由中心下发。",
          "This queue fills up from actions started on feature pages (investigations, fact refresh, metric labels) or dispatched by the center.",
        ),
      };
  }
}

function CommandRow({
  command,
  hostname,
  now,
}: {
  command: AgentCommandQueueItem;
  hostname: string;
  now: number;
}) {
  const route = commandKindRoute(command.kind, command.agentId);
  const stateLabel = queueStateLabel(command.state);
  const outcome = outcomeLabel(command.outcome);
  const requestedAtText = command.requestedAt
    ? formatTimestamp(command.requestedAt)
    : null;
  const acknowledgedAtText = command.acknowledgedAt
    ? formatTimestamp(command.acknowledgedAt)
    : null;

  return (
    <tr>
      <td>
        <span
          className={`${styles.badge} ${toneClass(queueStateTone(command.state))}`}
        >
          {stateLabel}
        </span>
      </td>
      <td className={styles.tdCommand}>
        <div className={styles.commandHead}>
          <span className={styles.commandKind}>
            {commandKindLabel(command.kind)}
          </span>
          {command.summary ? (
            <code className={styles.commandSummary}>{command.summary}</code>
          ) : null}
        </div>
        <div className={styles.commandId} title={command.commandId}>
          {route ? (
            <Link to={route}>{command.commandId}</Link>
          ) : (
            command.commandId
          )}
        </div>
      </td>
      <td className={styles.tdAgent}>
        <Link
          className={styles.agentLink}
          to={`/agents/${encodeURIComponent(command.agentId)}/metrics`}
          title={command.agentId}
        >
          {hostname || command.agentId}
        </Link>
        {hostname ? (
          <div className={styles.agentId} title={command.agentId}>
            {command.agentId}
          </div>
        ) : null}
      </td>
      <td>
        <span
          className={`${styles.badge} ${sourceTone(command.source)}`}
          title={command.requestedBy}
        >
          {commandSourceLabel(command.source)}
        </span>
      </td>
      <td className={styles.tdTime}>
        <span title={requestedAtText ?? undefined}>
          {commandAgeLabel(command.requestedAt, now) ?? "—"}
        </span>
      </td>
      <td className={styles.tdResult}>
        {command.outcome !== null ? (
          <>
            <span
              className={`${styles.badge} ${toneClass(outcomeTone(command.outcome))}`}
            >
              {outcome}
            </span>
            <div
              className={styles.resultMeta}
              title={acknowledgedAtText ?? undefined}
            >
              {commandAgeLabel(command.acknowledgedAt, now) ?? ""}
            </div>
          </>
        ) : command.claimedAt !== null ? (
          <span className={styles.resultMeta}>
            {t("已认领 {age}", "Claimed {age}", {
              age: commandAgeLabel(command.claimedAt, now) ?? "",
            })}
          </span>
        ) : (
          <span className={styles.resultMeta}>—</span>
        )}
        {command.detail ? (
          <div className={styles.resultDetail} title={command.detail}>
            {command.detail}
          </div>
        ) : null}
      </td>
    </tr>
  );
}

export function SubsystemAgentCommandQueuePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const stateParam = searchParams.get("state");
  const tab: AgentCommandQueueFilter = isAgentCommandQueueFilter(stateParam)
    ? stateParam
    : "queued";
  // `?agent=` 是深链接用的窄化（例如从某台机器的页面跳过来）；空 = 全机队。
  const agentFilter = (searchParams.get("agent") ?? "").trim();

  const queue = useAgentCommandQueue({
    state: tab,
    agentId: agentFilter || undefined,
    limit: 100,
  });
  const agents = useRegisteredAgents();

  // agent_id → 主机名：队列里只有 id，而「这是哪台机器」要主机名才答得上。
  const hostnames = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents.data ?? []) {
      const hostname = agent.hostname.trim();
      if (hostname) map.set(agent.agentId, hostname);
    }
    return map;
  }, [agents.data]);

  const tabs = queueTabs();
  const commands = queue.data?.commands ?? [];
  const counts = queue.data?.counts;
  const now = Date.now();
  const empty = emptyHint(tab);

  function selectTab(filter: AgentCommandQueueFilter) {
    const next = new URLSearchParams(searchParams);
    // `queued` 是缺省档：不写进 URL，短链接更干净。
    if (filter === "queued") next.delete("state");
    else next.set("state", filter);
    setSearchParams(next, { replace: true });
  }

  function clearAgentFilter() {
    const next = new URLSearchParams(searchParams);
    next.delete("agent");
    setSearchParams(next, { replace: true });
  }

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>{t("任务队列", "Command queue")}</h1>
          <p className={styles.pageSummary}>
            {t(
              "网关给 agentd 排的一次性命令：调查、重采事实、刷新指标标签。命令不是推送的 —— 机器在下一个状态上报里认领（≤3s），执行完再回一条回执。中心下发的命令也走这一队，来源标在每一行上。",
              "One-shot commands the gateway queues for agentd: investigations, fact refreshes, metric-label updates. Commands are not pushed — a machine claims them on its next status report (≤3s) and reports back when done. Commands dispatched by the center run through the same queue; each row shows its source.",
            )}
          </p>
          <div className={styles.headerLinks}>
            <Link className={styles.crossLink} to="/fleet">
              {t("Agent 列表", "Agent fleet")} <span aria-hidden="true">→</span>
            </Link>
            <Link className={styles.crossLink} to="/work">
              {t("采集工作", "Collection work")}{" "}
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </header>

        {agentFilter ? (
          <div className={styles.filterChip}>
            <span className={styles.filterChipText}>
              {t("只看这台机器：", "Only this machine: ")}
              <code className={styles.code}>{agentFilter}</code>
            </span>
            <button
              type="button"
              className={styles.chipButton}
              onClick={clearAgentFilter}
            >
              {t("看全部机器", "Show all machines")}
            </button>
          </div>
        ) : null}

        <nav className={styles.tabs} aria-label={t("队列状态", "Queue state")}>
          {tabs.map((item) => {
            const active = item.filter === tab;
            const count =
              item.filter === "queued"
                ? counts?.queued
                : item.filter === "claimed"
                  ? counts?.claimed
                  : undefined;
            return (
              <button
                key={item.filter}
                type="button"
                className={
                  active ? `${styles.tab} ${styles.tabActive}` : styles.tab
                }
                aria-current={active ? "page" : undefined}
                onClick={() => selectTab(item.filter)}
              >
                {item.label}
                {count !== undefined ? (
                  <span
                    className={
                      count > 0
                        ? `${styles.tabCount} ${styles.tabCountActive}`
                        : styles.tabCount
                    }
                  >
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
          <span className={styles.tabHint}>
            {tabs.find((item) => item.filter === tab)?.hint}
          </span>
        </nav>

        {queue.isError ? (
          <div className={styles.errorBanner} role="alert">
            {queueErrorMessage(queue.error)}
          </div>
        ) : null}

        {queue.isLoading ? (
          <div className={styles.notice} role="status">
            {t("正在读取命令队列…", "Reading the command queue…")}
          </div>
        ) : null}

        {!queue.isLoading && !queue.isError && commands.length === 0 ? (
          <div className={styles.empty}>
            <strong>{empty.title}</strong>
            <span>{empty.body}</span>
          </div>
        ) : null}

        {commands.length > 0 ? (
          <section className={styles.card}>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{t("状态", "State")}</th>
                    <th scope="col">{t("命令", "Command")}</th>
                    <th scope="col">Agent</th>
                    <th scope="col">{t("来源", "Source")}</th>
                    <th scope="col">{t("排队", "Queued")}</th>
                    <th scope="col">{t("回执", "Receipt")}</th>
                  </tr>
                </thead>
                <tbody>
                  {commands.map((command) => (
                    <CommandRow
                      key={`${command.agentId}:${command.commandId}`}
                      command={command}
                      hostname={hostnames.get(command.agentId) ?? ""}
                      now={now}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <footer className={styles.cardFoot}>
              {t(
                "共 {n} 条（最多 100 条，新 → 旧）。点命令 ID 去对应功能页看结果。",
                "{n} command(s), up to 100, newest first. Click a command ID to see its result on the feature page.",
                { n: commands.length },
              )}
            </footer>
          </section>
        ) : null}
      </main>
    </div>
  );
}
