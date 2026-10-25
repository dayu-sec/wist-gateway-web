import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import styles from "./SubsystemAgentHostMetricsPage.module.css";
import { TrendChart } from "./TrendChart";
import { useAgentHostMetrics, useAgentOverview } from "../hooks";
import { t, dateLocale } from "../i18n";
import {
  formatKiB,
  formatNumber,
  formatPercent,
  formatUptime,
  summarizeAddresses,
  severityForLoad,
  severityForUsage,
  SEVERITY_LABEL,
  type Severity,
} from "../lib/format";

interface SubsystemAgentHostMetricsPageProps {
  children?: React.ReactNode;
}

function severityClass(severity: Severity): string {
  return {
    ok: styles.text_ok,
    warn: styles.text_warn,
    crit: styles.text_crit,
    unknown: styles.text_unknown,
  }[severity];
}

function barClass(severity: Severity): string {
  return {
    ok: styles.bar_ok,
    warn: styles.bar_warn,
    crit: styles.bar_crit,
    unknown: styles.bar_unknown,
  }[severity];
}

/** 用真实点位跨度描述趋势时间窗，避免标题写死"近 1 小时"却只有 10 分钟数据。 */
function describeSpan(points?: [number, number][]): string {
  if (!points || points.length < 2) return t("暂无历史", "No history yet");
  const span = points[points.length - 1][0] - points[0][0];
  const minutes = Math.round(span / 60_000);
  if (minutes < 60)
    return t("近 {n} 分钟", "Last {n} min", { n: Math.max(minutes, 1) });
  const hours = minutes / 60;
  if (hours < 24)
    return t("近 {n} 小时", "Last {n} h", {
      n: hours.toFixed(hours < 10 ? 1 : 0),
    });
  return t("近 {n} 天", "Last {n} d", { n: (hours / 24).toFixed(1) });
}

export function SubsystemAgentHostMetricsPage(
  {}: SubsystemAgentHostMetricsPageProps,
) {
  const { agentId = "" } = useParams<{ agentId: string }>();
  const { data, isLoading, isError } = useAgentHostMetrics(agentId);
  const { data: overview } = useAgentOverview();

  const agent = useMemo(
    () => overview?.recentOnlineAgents.find((item) => item.agentId === agentId),
    [agentId, overview],
  );

  const memoryUsedKb =
    data?.memoryTotalKb !== undefined && data?.memoryAvailableKb !== undefined
      ? data.memoryTotalKb - data.memoryAvailableKb
      : undefined;
  const memoryUsagePercent =
    data?.memoryTotalKb !== undefined && data.memoryTotalKb > 0
      ? ((data.memoryTotalKb - (data.memoryAvailableKb ?? 0)) /
          data.memoryTotalKb) *
        100
      : undefined;

  const currentLoad = data?.loadAverage1m;
  const memorySeverity = severityForUsage(memoryUsagePercent);
  const loadSeverity = severityForLoad(currentLoad);
  const span = describeSpan(data?.history?.loadAverage1m);
  // 多网卡主机一次能报十几条 IP（链路本地 + 虚拟网卡），这里只挑主地址，全量进 tooltip。
  const addresses = summarizeAddresses(data?.ipAddresses ?? []);
  // 最紧张的挂载点排前面；旧网关没有 filesystems 时为空。
  const filesystems = useMemo(
    () =>
      [...(data?.filesystems ?? [])].sort(
        (left, right) =>
          (right.usagePercent ?? -1) - (left.usagePercent ?? -1),
      ),
    [data?.filesystems],
  );
  // 磁贴展示“最紧张挂载点”；macOS 上 `/` 是只读系统卷，存在 Data 卷时不参与“最紧张”。
  const worstFilesystem = useMemo(() => {
    if (filesystems.length === 0) return undefined;
    const hasDataVolume = filesystems.some(
      (filesystem) => filesystem.mount === "/System/Volumes/Data",
    );
    const candidates = hasDataVolume
      ? filesystems.filter((filesystem) => filesystem.mount !== "/")
      : filesystems;
    return (candidates.length > 0 ? candidates : filesystems)[0];
  }, [filesystems]);
  const diskUsagePercent =
    worstFilesystem?.usagePercent ?? data?.diskUsagePercent;
  const diskTotalKb = worstFilesystem?.totalKb ?? data?.diskTotalKb;
  const diskAvailableKb =
    worstFilesystem?.availableKb ?? data?.diskAvailableKb;
  const diskSeverity = severityForUsage(diskUsagePercent);

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <Link className={styles.back} to="/hosts">
          <span aria-hidden="true">←</span> {t("返回机队视图", "Back to fleet view")}
        </Link>
        <div className={styles.titleRow}>
          <h1 className={styles.pageTitle}>
            {data?.hostname || agentId || t("未指定主机", "Unspecified host")}
          </h1>
          <span className={styles.liveBadge}>
            <span className={styles.liveDot} aria-hidden="true" />
            {t("5 秒自动刷新", "Auto refresh every 5 s")}
          </span>
          {/* 三张 per-Agent 页面（主机指标 / 采集工作 / 用途）互为入口：
              这一页是「机器怎么样」，下一步常是「它在采什么」，所以采集在前、用途在后。
              标签与机队列表、Agent 卡片保持同一套短词（不再加「查看」前缀）。 */}
          <Link
            className={styles.crossLink}
            to={`/agents/${encodeURIComponent(agentId)}/work`}
          >
            {t("采集工作", "Collection work")}{" "}
            <span aria-hidden="true">→</span>
          </Link>
          {/* 两个入口各带一个箭头，挨着放会被读成一条链（采集 → 用途）；
              一根竖线把「两个独立去处」这件事说清楚。 */}
          <span className={styles.crossDivider} aria-hidden="true" />
          <Link
            className={styles.crossLink}
            to={`/agents/${encodeURIComponent(agentId)}/purpose`}
          >
            {t("用途", "Purpose")}{" "}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className={styles.metaRow}>
          <span className={styles.metaItem}>
            {t("主机", "Host")} <strong>{data?.hostname || "—"}</strong>
          </span>
          <span className={styles.metaItem}>
            IP{" "}
            <strong title={addresses.full || undefined}>
              {addresses.primary ?? "—"}
              {addresses.others > 0
                ? t(" 等 {n} 个", " ({n} total)", {
                    n: addresses.others + 1,
                  })
                : ""}
            </strong>
          </span>
          {data?.nodeId ? (
            <span className={styles.metaItem}>
              {t("节点", "Node")} <strong>{data.nodeId}</strong>
            </span>
          ) : null}
          {agent ? (
            <>
              <span className={styles.metaItem}>
                {t("版本", "Version")} <strong>{agent.version}</strong>
              </span>
              <span className={styles.metaItem}>
                {t("实例", "Instance")} <strong>{agent.instanceId}</strong>
              </span>
              <span className={styles.metaItem}>
                {t("Agent 在线时长", "Agent uptime")}{" "}
                <strong>{formatUptime(agent.onlineDurationSeconds)}</strong>
              </span>
              <span className={styles.metaItem}>
                {t("Admin 延迟", "Admin latency")}{" "}
                <strong>{formatNumber(agent.adminLatencyMs, 0)} ms</strong>
              </span>
            </>
          ) : (
            <span className={styles.metaItemMuted}>
              {t(
                "该主机不在最近上线列表中，仅展示指标数据。",
                "This host is not in the recent online list; showing metrics only.",
              )}
            </span>
          )}
        </div>
      </header>

      {isError ? (
        <div className={styles.errorBanner}>
          {t(
            "无法加载主机指标，请确认该 Agent 已接入且数据面 VictoriaMetrics 可用。",
            "Cannot load host metrics. Make sure the agent is enrolled and the VictoriaMetrics data plane is available.",
          )}
        </div>
      ) : null}

      {isLoading ? (
        <div className={styles.skeletonWrap}>
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className={styles.skeletonTile} />
          ))}
        </div>
      ) : (
        <section className={styles.tiles}>
          <article className={styles.tile}>
            <h2 className={styles.tileTitle}>{t("CPU 负载", "CPU load")}</h2>
            <p className={`${styles.tileValue} ${severityClass(loadSeverity)}`}>
              {formatNumber(currentLoad)}
            </p>
            <span className={styles.tileCaption}>
              {t("当前分级：{level}（1 分钟）", "Current level: {level} (1 min)", {
                level: SEVERITY_LABEL[loadSeverity],
              })}
            </span>
            <dl className={styles.subList}>
              <div className={styles.subRow}>
                <dt>{t("5 分钟", "5 min")}</dt>
                <dd>{formatNumber(data?.loadAverage5m)}</dd>
              </div>
              <div className={styles.subRow}>
                <dt>{t("15 分钟", "15 min")}</dt>
                <dd>{formatNumber(data?.loadAverage15m)}</dd>
              </div>
            </dl>
          </article>

          <article className={styles.tile}>
            <h2 className={styles.tileTitle}>{t("内存", "Memory")}</h2>
            <p className={`${styles.tileValue} ${severityClass(memorySeverity)}`}>
              {formatPercent(memoryUsagePercent)}
            </p>
            <span className={styles.tileCaption}>
              {formatKiB(memoryUsedKb)} / {formatKiB(data?.memoryTotalKb)}
            </span>
            <div className={styles.barTrack}>
              <div
                className={`${styles.barFill} ${barClass(memorySeverity)}`}
                style={{
                  width: `${Math.min(Math.max(memoryUsagePercent ?? 0, 0), 100)}%`,
                }}
              />
            </div>
            <dl className={styles.subList}>
              <div className={styles.subRow}>
                <dt>{t("总量", "Total")}</dt>
                <dd>{formatKiB(data?.memoryTotalKb)}</dd>
              </div>
              <div className={styles.subRow}>
                <dt>{t("可用", "Available")}</dt>
                <dd>{formatKiB(data?.memoryAvailableKb)}</dd>
              </div>
            </dl>
          </article>

          <article className={styles.tile}>
            <h2 className={styles.tileTitle}>
              {worstFilesystem
                ? t("磁盘（最紧张）", "Disk (worst mount)")
                : t("磁盘（主盘）", "Disk (primary)")}
            </h2>
            <p className={`${styles.tileValue} ${severityClass(diskSeverity)}`}>
              {formatPercent(diskUsagePercent)}
            </p>
            <span className={styles.tileCaption}>
              {t("当前分级：{level}", "Current level: {level}", {
                level: SEVERITY_LABEL[diskSeverity],
              })}
            </span>
            {filesystems.length > 0 ? (
              <span className={styles.tileCaption}>
                {t(
                  "逐挂载点容量见下方",
                  "Per-mount capacity below",
                )}
              </span>
            ) : null}
            <div className={styles.barTrack}>
              <div
                className={`${styles.barFill} ${barClass(diskSeverity)}`}
                style={{
                  width: `${Math.min(Math.max(diskUsagePercent ?? 0, 0), 100)}%`,
                }}
              />
            </div>
            <dl className={styles.subList}>
              {worstFilesystem ? (
                <div className={styles.subRow}>
                  <dt>{t("挂载点", "Mount")}</dt>
                  <dd>{worstFilesystem.mount}</dd>
                </div>
              ) : null}
              <div className={styles.subRow}>
                <dt>{t("总量", "Total")}</dt>
                <dd>{formatKiB(diskTotalKb)}</dd>
              </div>
              <div className={styles.subRow}>
                <dt>{t("可用", "Available")}</dt>
                <dd>{formatKiB(diskAvailableKb)}</dd>
              </div>
            </dl>
          </article>

          <article className={styles.tile}>
            <h2 className={styles.tileTitle}>
              {t("主机开机时长", "Host uptime")}
            </h2>
            <p className={styles.tileValue}>{formatUptime(data?.uptimeSeconds)}</p>
            <span className={styles.tileCaption}>
              {t(
                "操作系统开机至今，与 Agent 在线时长不同",
                "Since the OS booted, unlike agent uptime",
              )}
            </span>
            <dl className={styles.subList}>
              <div className={styles.subRow}>
                <dt>{t("指标采集窗口", "Metric window")}</dt>
                <dd>{span}</dd>
              </div>
              {agent ? (
                <div className={styles.subRow}>
                  <dt>{t("注册时间", "Registered at")}</dt>
                  <dd>
                    {new Intl.DateTimeFormat(dateLocale(), {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    }).format(new Date(agent.registeredAt))}
                  </dd>
                </div>
              ) : null}
            </dl>
          </article>
        </section>
      )}

      {filesystems.length > 0 ? (
        <section className={styles.filesystems}>
          <div className={styles.filesystemsHead}>
            <h2 className={styles.trendsTitle}>
              {t("文件系统容量", "Filesystem capacity")}
            </h2>
            <span className={styles.trendsHint}>
              {t(
                "按挂载点独立统计；告警按挂载点触发，不会被其他挂载点的空闲稀释",
                "Measured per mount; alerts fire per mount and are not diluted by free space elsewhere",
              )}
            </span>
          </div>
          <div className={styles.fsTableWrap}>
            <table className={styles.fsTable}>
              <thead>
                <tr>
                  <th>{t("挂载点", "Mount")}</th>
                  <th>{t("文件系统", "Filesystem")}</th>
                  <th>{t("使用率", "Usage")}</th>
                  <th>{t("可用", "Available")}</th>
                  <th>{t("总量", "Total")}</th>
                  <th>{t("状态", "Status")}</th>
                </tr>
              </thead>
              <tbody>
                {filesystems.map((filesystem) => {
                  const severity = severityForUsage(filesystem.usagePercent);
                  return (
                    <tr key={filesystem.mount}>
                      <td className={styles.fsMount}>{filesystem.mount}</td>
                      <td>{filesystem.fstype ?? "—"}</td>
                      <td className={severityClass(severity)}>
                        {formatPercent(filesystem.usagePercent)}
                      </td>
                      <td>{formatKiB(filesystem.availableKb)}</td>
                      <td>{formatKiB(filesystem.totalKb)}</td>
                      <td className={severityClass(severity)}>
                        {SEVERITY_LABEL[severity]}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data?.history ? (
        <section className={styles.trends}>
          <div className={styles.trendsHead}>
            <h2 className={styles.trendsTitle}>{t("指标趋势", "Metric trends")}</h2>
            <span className={styles.trendsHint}>
              {t(
                "{span} · 悬停折线可查看任意时刻取值",
                "{span} · Hover the line to see the value at any point",
                { span },
              )}
            </span>
          </div>

          <article className={styles.trendCard}>
            <h3 className={styles.trendCardTitle}>
              {t("CPU 负载", "CPU load")}
            </h3>
            <TrendChart
              series={[
                {
                  name: t("1 分钟", "1 min"),
                  color: "var(--series-1)",
                  points: data.history.loadAverage1m,
                },
                {
                  name: t("5 分钟", "5 min"),
                  color: "var(--series-2)",
                  points: data.history.loadAverage5m,
                },
                {
                  name: t("15 分钟", "15 min"),
                  color: "var(--series-3)",
                  points: data.history.loadAverage15m,
                },
              ]}
              valueFormatter={(value) => value.toFixed(2)}
            />
          </article>

          <div className={styles.trendGrid}>
            <article className={styles.trendCard}>
              <h3 className={styles.trendCardTitle}>
                {t("内存可用量", "Memory available")}
              </h3>
              <TrendChart
                height={168}
                series={[
                  {
                    name: t("可用", "Available"),
                    color: "var(--series-1)",
                    points: data.history.memoryAvailableKb,
                  },
                ]}
                valueFormatter={(value) => formatKiB(value)}
              />
            </article>

            <article className={styles.trendCard}>
              <h3 className={styles.trendCardTitle}>
                {t("磁盘使用率", "Disk usage")}
              </h3>
              <TrendChart
                height={168}
                series={[
                  {
                    name: t("使用率", "Usage"),
                    color: "var(--series-5)",
                    points: data.history.diskUsagePercent,
                  },
                ]}
                valueFormatter={(value) => `${value.toFixed(1)}%`}
              />
            </article>
          </div>
        </section>
      ) : null}
    </div>
  );
}
