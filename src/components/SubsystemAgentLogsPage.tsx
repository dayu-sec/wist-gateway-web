import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, getAdminApiToken, isRateLimitedError } from "../api";
import {
  useAgentLogs,
  useAgentOverview,
  useContentCatalog,
} from "../hooks";
import { t, dateLocale } from "../i18n";
import { CopyButton } from "./CopyButton";
import { RateLimitNotice } from "./RateLimitNotice";
import styles from "./SubsystemAgentLogsPage.module.css";

interface SubsystemAgentLogsPageProps {
  children?: React.ReactNode;
}

/**
 * 可选条数上限：后端把 limit 夹到 1..1000，默认 200。
 * 这里只列出常读的几档，不做「自定义输入」—— 数量级够用，且和后端口径一致。
 */
const LIMITS = [100, 200, 500, 1000];
const LIMIT_DEFAULT = 200;

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
    // 走到这里说明 404 的正文对不上已知语义：更可能是网关没有这个路由。
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

/** 时间戳按本地时区展示；解析不了就原样透出，不假装成 1970。 */
function formatTimestamp(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString(dateLocale(), { hour12: false });
}

/**
 * 采集日志页（管理面 `GET /api/v1/admin/logs`）。
 *
 * 日志链路是 agentd → 数据面（warp-parse）→ 网关内部接入端点 → **网关主机上的
 * 本地 NDJSON 文件**（没有数据库表）。服务端读的是文件尾部窗口，返回最新的 N 条。
 * 页面因此要在两处特别小心：
 *   1. 两个时间不是一回事 —— 「观测时刻」（Agent 采到）与「到达网关」（网关写盘）分开标注；
 *   2. `truncated` 必须显式提示，否则操作者会把「这一窗」读成「全部」。
 *
 * 机器筛选与**采集面**筛选都走 URL 参数（`?agent=` / `?family=`），与其它页面一致：
 * 链接贴给别人打开的是同一屏。面筛尤其重要 —— 正文规则未就绪时 `category` 恒为泛化的
 * `agent.log`，几张日志面同时跑起来，只有 `family` 能说出「这条是 launchd 的、那条是 wifi 的」。
 */
export function SubsystemAgentLogsPage({}: SubsystemAgentLogsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const agentId = searchParams.get("agent") ?? "";
  const family = searchParams.get("family") ?? "";
  const [agentDraft, setAgentDraft] = useState(agentId);
  const [familyDraft, setFamilyDraft] = useState(family);
  const [limit, setLimit] = useState(LIMIT_DEFAULT);

  // URL 是唯一真相：带 `?agent=` 的链接进来、或用浏览器后退换筛选时，
  // 输入框要跟着变，否则会显示上一次手输的内容。
  useEffect(() => setAgentDraft(agentId), [agentId]);
  useEffect(() => setFamilyDraft(family), [family]);

  const { data, error, isLoading, isError } = useAgentLogs(
    agentId || undefined,
    family || undefined,
    limit,
  );
  const { data: overview } = useAgentOverview();
  // 面名的取值集合来自内容目录（闭集，网关侧校验）：不在这里另抄一份，
  // 抄一份就会和模型各自漂移。目录没装载（503）时只是没有候选项，输入框照常可用。
  const { data: catalog } = useContentCatalog();

  const knownAgents = useMemo(() => {
    const ids: string[] = [];
    for (const agent of overview?.recentOnlineAgents ?? []) ids.push(agent.agentId);
    for (const agent of overview?.abnormalAgents ?? []) {
      if (!ids.includes(agent.agentId)) ids.push(agent.agentId);
    }
    return ids;
  }, [overview]);

  const knownFamilies = useMemo(() => {
    const names = new Set<string>();
    for (const entry of catalog?.readiness ?? []) names.add(entry.family);
    return [...names].sort();
  }, [catalog]);

  const filterActive = Boolean(agentId || family);
  const filterSummary = [
    agentId ? t("机器 {id}", "machine {id}", { id: agentId }) : null,
    family ? t("采集面 {family}", "collection family {family}", { family }) : null,
  ]
    .filter((part) => part !== null)
    .join(t("、", ", "));
  const logs = data?.logs ?? [];

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams(searchParams);
    const nextAgent = agentDraft.trim();
    const nextFamily = familyDraft.trim();
    if (nextAgent) params.set("agent", nextAgent);
    else params.delete("agent");
    if (nextFamily) params.set("family", nextFamily);
    else params.delete("family");
    setSearchParams(params);
  }

  function clearFilter() {
    const params = new URLSearchParams(searchParams);
    params.delete("agent");
    params.delete("family");
    setSearchParams(params);
  }

  /** 记录卡上的面标：点一下就只看这个面（与机器筛同一套 URL 真相，链接可直传）。 */
  function filterByFamily(next: string) {
    const params = new URLSearchParams(searchParams);
    if (next) params.set("family", next);
    else params.delete("family");
    setSearchParams(params);
  }

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t("采集日志", "Collection logs")}</h1>
        <p className={styles.pageSummary}>
          {t(
            "Agent 采集到的日志原文。链路是 agentd → 数据面（warp-parse）→ 网关内部接入端点，最终落在",
            "Raw logs collected by agents. The path is agentd → data plane (warp-parse) → the gateway's internal ingest endpoint, ending up in ",
          )}
          <strong>
            {t(
              "网关主机上的本地 NDJSON 文件",
              "a local NDJSON file on the gateway host",
            )}
          </strong>
          {t(
            "（没有数据库表）—— 这里读的是文件",
            " (no database table) — this page reads the file's ",
          )}
          <strong>{t("尾部窗口", "tail window")}</strong>
          {t("，返回最新的 N 条。", " and returns the newest N entries.")}
        </p>
        <p className={styles.pageThresholds}>
          {t(
            "每条的两个时间不同：",
            "Each record carries two different timestamps: ",
          )}
          <strong>{t("观测时刻", "observed at")}</strong>
          {t("是 Agent 自己采到它的时刻，", " is when the agent collected it, ")}
          <strong>{t("到达网关", "arrived at gateway")}</strong>
          {t(
            "是网关把它写入磁盘的时刻，中间隔着上行链路与数据面处理。一条多行日志在文件里仍是一行（换行被转义），这里按原文保留换行展示。",
            " is when the gateway wrote it to disk — the uplink and data plane processing happen in between. A multi-line log stays one line in the file (newlines are escaped); this page shows the original line breaks. ",
          )}
          <code className={styles.code}>family</code>
          {t(" 是这条来自哪个", " says which ")}
          <strong>{t("采集面", "collection family")}</strong>
          {t(
            "（点它即可只看该面），",
            " the record came from (click it to filter by that family). ",
          )}
          <code className={styles.code}>category</code>
          {t(
            " 是日志类别，正文规则未就绪时恒为",
            " is the log category; until the body rules are ready it is always ",
          )}
          <code className={styles.code}>agent.log</code>
          {t(
            " —— 几张日志面一起跑时，只有前一个字段能把它们分开。",
            " — when several log families run at once, only the former field can tell them apart.",
          )}
        </p>
      </header>

      <section className={styles.section}>
        <div className={styles.toolbar}>
          <form className={styles.picker} onSubmit={handleSubmit}>
            <label className={styles.pickerLabel} htmlFor="agent-logs-filter">
              {t("机器", "Machine")}
            </label>
            <input
              id="agent-logs-filter"
              className={styles.pickerInput}
              list="agent-logs-agent-options"
              placeholder={t("agent_id，留空 = 所有 Agent", "agent_id; empty = all agents")}
              value={agentDraft}
              onChange={(event) => setAgentDraft(event.target.value)}
              autoComplete="off"
            />
            <datalist id="agent-logs-agent-options">
              {knownAgents.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
            <label className={styles.pickerLabel} htmlFor="agent-logs-family-filter">
              {t("采集面", "Collection family")}
            </label>
            <input
              id="agent-logs-family-filter"
              className={styles.pickerInput}
              list="agent-logs-family-options"
              placeholder={t(
                "family，如 ServiceLifecycle；留空 = 所有面",
                "family, e.g. ServiceLifecycle; empty = all families",
              )}
              value={familyDraft}
              onChange={(event) => setFamilyDraft(event.target.value)}
              autoComplete="off"
            />
            <datalist id="agent-logs-family-options">
              {knownFamilies.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <button type="submit" className={styles.pickerButton}>
              {t("筛选", "Filter")}
            </button>
            {filterActive ? (
              <button
                type="button"
                className={styles.pickerGhost}
                onClick={clearFilter}
              >
                {t("清除", "Clear")}
              </button>
            ) : null}
          </form>

          <div className={styles.limitPicker}>
            <span className={styles.limitLabel}>{t("条数", "Limit")}</span>
            <div
              className={styles.limitOptions}
              role="group"
              aria-label={t("返回条数上限", "Result limit")}
            >
              {LIMITS.map((value) => {
                const active = value === limit;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    className={
                      active
                        ? `${styles.limitOption} ${styles.limitOptionActive}`
                        : styles.limitOption
                    }
                    onClick={() => setLimit(value)}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </div>
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

        {isLoading ? <SkeletonRows count={3} /> : null}

        {!isLoading && !isError && !data ? (
          <div className={styles.idleNotice} role="status">
            {getAdminApiToken()
              ? t(
                  "尚未取到日志，用右上角「刷新」重试。",
                  "No logs loaded yet. Use “Refresh” in the top right to retry.",
                )
              : t(
                  "未设置 Admin Token：在右上角钥匙按钮里填入后才向管理面请求，这里不会显示数据。",
                  "No Admin Token set: data is requested from the admin API only after you fill it in via the key button in the top bar, so nothing is shown here.",
                )}
          </div>
        ) : null}

        {data ? (
          <>
            {data.truncated ? (
              // 不是错误，但必须醒目：它改变「这是不是全部日志」的判断。
              <div className={styles.truncatedNotice} role="status">
                <span>
                  {t(
                    "只返回了最近 {returned} 条（本次上限 {limit}）：",
                    "Only the newest {returned} entries were returned (limit {limit}): ",
                    { returned: logs.length, limit: data.limit },
                  )}
                  <strong>
                    {t("更早的日志没有返回", "older logs were not returned")}
                  </strong>
                  {t(
                    "。想看更早的记录，把「条数」调大，或直接到下面的日志文件里",
                    ". To see older records, raise the limit or go straight to the log file below and use ",
                  )}{" "}
                  <code className={styles.code}>tail</code> /{" "}
                  <code className={styles.code}>grep</code>
                  {t("。", ".")}
                </span>
              </div>
            ) : null}

            <div className={styles.fileBar}>
              <span className={styles.fileLabel}>{t("日志文件", "Log file")}</span>
              <code className={styles.filePath}>{data.file}</code>
              <CopyButton
                className={styles.copyButton}
                text={data.file}
                label={t("复制路径", "Copy path")}
              />
            </div>

            {logs.length === 0 ? (
              filterActive ? (
                // 请求成功、只是这一窗里没有这台机器 —— 与「从来没上报过」是两回事。
                <div className={styles.empty} role="status">
                  <strong className={styles.emptyTitle}>
                    {t("筛选没有匹配到记录", "No records match the filter")}
                  </strong>
                  <span className={styles.emptyText}>
                    {t(
                      "返回的最新 {limit} 条里没有符合当前筛选（{summary}）的记录。这不等于这台机器从来没上报过 —— 只是文件尾部窗口内没有它。可以清除筛选看全部，或把「条数」调大。",
                      "None of the newest {limit} returned entries match the current filter ({summary}). This does not mean the machine has never reported — it is just absent from the file's tail window. Clear the filter to see everything, or raise the limit.",
                      { limit: data.limit, summary: filterSummary },
                    )}
                  </span>
                </div>
              ) : (
                <div className={styles.empty} role="status">
                  <strong className={styles.emptyTitle}>
                    {t("还没有采集到日志", "No logs collected yet")}
                  </strong>
                  <span className={styles.emptyText}>
                    {t(
                      "网关的日志文件里暂时是空的。这与「读不到」不同：请求成功了，只是还没有 Agent 通过数据面上报过日志。确认 Agent 已启动、已配置数据面上送地址、且数据面（warp-parse）在运行；上报后用右上角「刷新」重取。",
                      "The gateway's log file is empty for now. That is different from “cannot read”: the request succeeded, agents simply have not reported any logs through the data plane yet. Make sure the agent is running, a data plane uplink address is configured, and the data plane (warp-parse) is running; after it reports, use “Refresh” in the top right to reload.",
                    )}
                  </span>
                </div>
              )
            ) : (
              <>
                <div className={styles.resultCount}>
                  {t("按写入顺序（旧 → 新）显示最近", "Showing the newest")}{" "}
                  <strong>{logs.length}</strong>{" "}
                  {t("条", "entries in write order (old → new)")}
                  {agentId ? (
                    <>
                      {" "}
                      · {t("仅机器", "machine")} <strong>{agentId}</strong>
                    </>
                  ) : null}
                  {family ? (
                    <>
                      {" "}
                      · {t("仅面", "family")} <strong>{family}</strong>
                    </>
                  ) : null}
                  {filterActive
                    ? null
                    : t(" · 所有 Agent / 所有面", " · all agents / all families")}
                </div>

                <div className={styles.recordList}>
                  {logs.map((record, index) => (
                    <article
                      key={`${record.agentId}#${record.seq}@${record.receivedAt}-${index}`}
                      className={styles.recordCard}
                    >
                      <header className={styles.recordHead}>
                        <span className={styles.recordAgent}>{record.agentId}</span>
                        {record.family ? (
                          <button
                            type="button"
                            className={styles.recordFamily}
                            title={t(
                              "只看这个采集面的记录",
                              "Show only records from this collection family",
                            )}
                            onClick={() => filterByFamily(record.family)}
                          >
                            {record.family}
                          </button>
                        ) : (
                          // 空面是**有语义**的：它不是平台派活来的（本机手工配置的输入），
                          // 留白会让人当成字段丢了。
                          <span
                            className={styles.recordFamilyNone}
                            title={t(
                              "帧里没有采集面：不是平台派活来的（本机手工配置的输入）",
                              "The frame has no collection family: it does not come from platform-assigned work (locally configured input)",
                            )}
                          >
                            {t("无面", "No family")}
                          </span>
                        )}
                        {record.unit ? (
                          <span className={styles.recordUnit}>{record.unit}</span>
                        ) : null}
                        <span
                          className={styles.recordCategory}
                          title={t(
                            "日志类别：正文规则未就绪时恒为 agent.log",
                            "Log category: always agent.log until the body rules are ready",
                          )}
                        >
                          {record.category}
                        </span>
                        <span className={styles.recordSeq}>seq {record.seq}</span>
                        <span className={styles.recordTime}>
                          <span className={styles.recordTimeLabel}>
                            {t("观测时刻", "Observed at")}
                          </span>
                          {formatTimestamp(record.observedAt)}
                        </span>
                        <span className={styles.recordTime}>
                          <span className={styles.recordTimeLabel}>
                            {t("到达网关", "Arrived at gateway")}
                          </span>
                          {formatTimestamp(record.receivedAt)}
                        </span>
                      </header>
                      <pre className={styles.recordRaw}>{record.raw}</pre>
                      <p className={styles.recordDesc}>
                        {t("来源 · {desc}", "Source · {desc}", {
                          desc: record.logDesc,
                        })}
                      </p>
                    </article>
                  ))}
                </div>
              </>
            )}
          </>
        ) : null}
      </section>
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
