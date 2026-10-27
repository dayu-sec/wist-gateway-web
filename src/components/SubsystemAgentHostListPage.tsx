import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { t } from "../i18n";
import styles from "./SubsystemAgentHostListPage.module.css";
import { useAllAgentsHostMetrics } from "../hooks";
import { adminApiErrorMessage } from "./adminApiError";
import {
  formatKiB,
  formatNumber,
  formatPercent,
  severityForLoad,
  severityForUsage,
  severityLabel,
  summarizeAddresses,
  type AddressSummary,
  type Severity,
} from "../lib/format";

interface SubsystemAgentHostListPageProps {
  children?: React.ReactNode;
}

type SortKey = "severity" | "agentId" | "cpu" | "memory" | "disk";

interface HostRow {
  agentId: string;
  nodeId: string;
  hostname: string;
  ipAddresses: string[];
  addresses: AddressSummary;
  loadAverage1m?: number;
  memoryTotalKb?: number;
  memoryAvailableKb?: number;
  diskUsagePercent?: number;
  maxFilesystemUsagePercent?: number;
  /** 旧主盘使用率与逐挂载点最大值里的较大者，列表页按它排序/分级。 */
  diskWorstUsagePercent?: number;
  /** 最紧张挂载点路径（来自逐挂载点摘要；旧网关没有）。 */
  diskWorstMount?: string;
  memoryUsedKb?: number;
  memoryUsagePercent?: number;
  severity: Severity;
}

const SEVERITY_ORDER: Record<Severity, number> = {
  crit: 0,
  warn: 1,
  unknown: 2,
  ok: 3,
};

function severityRank(left: Severity, right: Severity): number {
  return SEVERITY_ORDER[left] - SEVERITY_ORDER[right];
}

function worst(...values: Severity[]): Severity {
  return values.reduce((acc, cur) => (severityRank(cur, acc) < 0 ? cur : acc));
}

function severityClass(kind: "badge" | "text" | "bar", severity: Severity) {
  const map = {
    badge: {
      ok: styles.badge_ok,
      warn: styles.badge_warn,
      crit: styles.badge_crit,
      unknown: styles.badge_unknown,
    },
    text: {
      ok: styles.text_ok,
      warn: styles.text_warn,
      crit: styles.text_crit,
      unknown: styles.text_unknown,
    },
    bar: {
      ok: styles.bar_ok,
      warn: styles.bar_warn,
      crit: styles.bar_crit,
      unknown: styles.bar_unknown,
    },
  } as const;
  return map[kind][severity];
}

export function SubsystemAgentHostListPage({}: SubsystemAgentHostListPageProps) {
  const { data, isLoading, isError, error } = useAllAgentsHostMetrics();
  const [query, setQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("severity");
  const [sortAsc, setSortAsc] = useState(true);

  const rows: HostRow[] = useMemo(() => {
    return (data ?? []).map((host) => {
      const memoryUsagePercent =
        host.memoryTotalKb && host.memoryTotalKb > 0
          ? ((host.memoryTotalKb - (host.memoryAvailableKb ?? 0)) /
              host.memoryTotalKb) *
            100
          : undefined;
      // 逐挂载点最大值优先（同分时也优先，因为它能带上具体挂载点）；
      // 老网关没有逐挂载点数据时回退旧主盘值。
      const useFilesystem =
        host.maxFilesystemUsagePercent !== undefined &&
        (host.diskUsagePercent === undefined ||
          host.maxFilesystemUsagePercent >= host.diskUsagePercent);
      const diskWorstUsagePercent = useFilesystem
        ? host.maxFilesystemUsagePercent
        : host.diskUsagePercent;
      const diskWorstMount = useFilesystem
        ? host.maxFilesystemUsageMount
        : undefined;
      return {
        ...host,
        addresses: summarizeAddresses(host.ipAddresses),
        memoryUsagePercent,
        diskWorstUsagePercent,
        diskWorstMount,
        memoryUsedKb:
          host.memoryTotalKb !== undefined &&
          host.memoryAvailableKb !== undefined
            ? host.memoryTotalKb - host.memoryAvailableKb
            : undefined,
        severity: worst(
          severityForUsage(memoryUsagePercent),
          severityForUsage(diskWorstUsagePercent),
          severityForLoad(host.loadAverage1m),
        ),
      };
    });
  }, [data]);

  const counts = useMemo(() => {
    const base: Record<Severity, number> = {
      ok: 0,
      warn: 0,
      crit: 0,
      unknown: 0,
    };
    for (const row of rows) base[row.severity] += 1;
    return base;
  }, [rows]);

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (severityFilter !== "all" && row.severity !== severityFilter) {
        return false;
      }
      if (keyword) {
        const haystack = [
          row.agentId,
          row.hostname,
          row.nodeId,
          ...row.ipAddresses,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      // 默认视图按严重度排序：需要处理的主机永远排在前面，
      // 同级再按磁盘使用率从高到低。
      if (sortKey === "severity") {
        const bySeverity = severityRank(a.severity, b.severity);
        if (bySeverity !== 0) return bySeverity;
        return (
          (b.diskWorstUsagePercent ?? -1) - (a.diskWorstUsagePercent ?? -1)
        );
      }

      const pick = (row: HostRow): number | string => {
        switch (sortKey) {
          case "cpu":
            return row.loadAverage1m ?? -1;
          case "memory":
            return row.memoryUsagePercent ?? -1;
          case "disk":
            return row.diskWorstUsagePercent ?? -1;
          default:
            return row.hostname || row.agentId;
        }
      };

      const left = pick(a);
      const right = pick(b);
      const result =
        typeof left === "string" && typeof right === "string"
          ? left.localeCompare(right)
          : Number(left) - Number(right);
      return sortAsc ? result : -result;
    });
  }, [query, rows, severityFilter, sortAsc, sortKey]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(key === "agentId" || key === "severity");
    }
  }

  // 严重度标签取 `lib/format` 的**同一份**口径（`severityLabel()`：渲染期取词、随语言变）。
  // 别在这里另抄一张表 —— 两处迟早会漂（本页曾为了避开别人的改动抄过一份，已合并回去）。
  const filters: { key: Severity | "all"; label: string; count: number }[] = [
    { key: "all", label: t("全部", "All"), count: rows.length },
    { key: "crit", label: severityLabel("crit"), count: counts.crit },
    { key: "warn", label: severityLabel("warn"), count: counts.warn },
    { key: "ok", label: severityLabel("ok"), count: counts.ok },
    { key: "unknown", label: severityLabel("unknown"), count: counts.unknown },
  ];

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t("主机指标", "Host metrics")}</h1>
        <p className={styles.pageSummary}>
          {t(
            "机队实时负载视图：一行一台已接入主机，按严重度排序，优先暴露需要处理的主机。数据每 5 秒刷新。",
            "Live load view of the fleet: one row per enrolled host, sorted by severity, surfacing the hosts that need attention first. Refreshes every 5 seconds.",
          )}
        </p>
        <p className={styles.pageThresholds}>
          {t(
            "分级口径：内存 / 磁盘使用率 ≥90% 为危急、≥75% 为偏高；1 分钟负载按 8 核基准折算。",
            "Thresholds: memory / disk usage ≥90% is critical, ≥75% is elevated; 1-minute load is normalized to 8 cores.",
          )}
        </p>
      </header>

      {isError ? (
        // 不再自己编一句话：服务端正文（若给了）比任何通用提示都准。
        <div className={styles.errorBanner}>{adminApiErrorMessage(error)}</div>
      ) : null}

      {isLoading ? (
        <div className={styles.skeletonWrap}>
          {[0, 1, 2].map((index) => (
            <div key={index} className={styles.skeletonRow} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className={styles.empty}>
          <strong className={styles.emptyTitle}>
            {t("暂无主机数据", "No host data")}
          </strong>
          <span className={styles.emptyText}>
            {t(
              "确认 Agent 已启动并完成注册；也可以在「安装 Agent」页获取安装命令。",
              "Make sure the agent is running and enrolled; you can also get the install command on the Install agent page.",
            )}
          </span>
        </div>
      ) : (
        <section className={styles.fleet}>
          <div className={styles.toolbar}>
            <div className={styles.search}>
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                aria-hidden="true"
              >
                <circle
                  cx="7"
                  cy="7"
                  r="4.6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M10.6 10.6 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <input
                type="search"
                className={styles.searchInput}
                placeholder={t(
                  "搜索主机名 / ID / IP",
                  "Search hostname / ID / IP",
                )}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={t(
                  "搜索主机名、Agent ID 或 IP",
                  "Search hostname, Agent ID, or IP",
                )}
              />
            </div>

            <div
              className={styles.filters}
              role="group"
              aria-label={t("按状态筛选", "Filter by status")}
            >
              {filters.map((filter) => {
                const active = filter.key === severityFilter;
                const tone =
                  filter.key === "all"
                    ? undefined
                    : severityClass("badge", filter.key);
                return (
                  <button
                    key={filter.key}
                    type="button"
                    className={
                      active
                        ? `${styles.chip} ${styles.chipActive}`
                        : styles.chip
                    }
                    onClick={() => setSeverityFilter(filter.key)}
                    aria-pressed={active}
                  >
                    {tone ? (
                      <span
                        className={`${styles.chipDot} ${tone}`}
                        aria-hidden="true"
                      />
                    ) : null}
                    {filter.label}
                    <span className={styles.chipCount}>{filter.count}</span>
                  </button>
                );
              })}
            </div>

            <span className={styles.resultCount}>
              {t("显示", "Showing")} <strong>{visible.length}</strong> /{" "}
              {rows.length} {t("台", "hosts")}
            </span>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col" className={styles.thHost}>
                    <button
                      type="button"
                      className={styles.sortHead}
                      onClick={() => toggleSort("agentId")}
                    >
                      {t("主机", "Host")}
                      <SortMark active={sortKey === "agentId"} asc={sortAsc} />
                    </button>
                  </th>
                  <th scope="col">
                    <button
                      type="button"
                      className={styles.sortHead}
                      onClick={() => toggleSort("severity")}
                    >
                      {t("状态", "Status")}
                      <SortMark active={sortKey === "severity"} asc={sortAsc} />
                    </button>
                  </th>
                  <th scope="col">
                    <button
                      type="button"
                      className={styles.sortHead}
                      onClick={() => toggleSort("cpu")}
                    >
                      {t("CPU 负载 1m", "CPU load 1m")}
                      <SortMark active={sortKey === "cpu"} asc={sortAsc} />
                    </button>
                  </th>
                  <th scope="col">
                    <button
                      type="button"
                      className={styles.sortHead}
                      onClick={() => toggleSort("memory")}
                    >
                      {t("内存", "Memory")}
                      <SortMark active={sortKey === "memory"} asc={sortAsc} />
                    </button>
                  </th>
                  <th scope="col">
                    <button
                      type="button"
                      className={styles.sortHead}
                      onClick={() => toggleSort("disk")}
                    >
                      {t("磁盘（最紧张）", "Disk (worst)")}
                      <SortMark active={sortKey === "disk"} asc={sortAsc} />
                    </button>
                  </th>
                  <th scope="col" className={styles.thAction}>
                    <span className={styles.srOnly}>
                      {t("操作", "Actions")}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.agentId}>
                    <td className={styles.tdHost}>
                      <div className={styles.hostCell}>
                        <Link
                          className={styles.hostLink}
                          to={`/agents/${encodeURIComponent(row.agentId)}/metrics`}
                        >
                          {row.hostname || row.agentId}
                        </Link>
                        {row.hostname ? (
                          <span className={styles.hostSub}>{row.agentId}</span>
                        ) : null}
                        {row.addresses.primary ? (
                          <span
                            className={styles.hostSub}
                            title={row.addresses.full}
                          >
                            {row.addresses.primary}
                            {row.addresses.others > 0
                              ? ` +${row.addresses.others}`
                              : ""}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <span
                        className={`${styles.badge} ${severityClass("badge", row.severity)}`}
                      >
                        {severityLabel(row.severity)}
                      </span>
                    </td>
                    <td className={styles.tdMetric}>
                      <MetricBar
                        percent={undefined}
                        value={formatNumber(row.loadAverage1m)}
                        severity={severityForLoad(row.loadAverage1m)}
                      />
                    </td>
                    <td className={styles.tdMetric}>
                      <MetricBar
                        percent={row.memoryUsagePercent}
                        value={formatPercent(row.memoryUsagePercent)}
                        detail={`${formatKiB(row.memoryUsedKb)} / ${formatKiB(row.memoryTotalKb)}`}
                        severity={severityForUsage(row.memoryUsagePercent)}
                      />
                    </td>
                    <td className={styles.tdMetric}>
                      <MetricBar
                        percent={row.diskWorstUsagePercent}
                        value={formatPercent(row.diskWorstUsagePercent)}
                        detail={row.diskWorstMount}
                        severity={severityForUsage(row.diskWorstUsagePercent)}
                      />
                    </td>
                    <td className={styles.tdAction}>
                      <div className={styles.actionLinks}>
                        <Link
                          className={styles.detailLink}
                          to={`/agents/${encodeURIComponent(row.agentId)}/work`}
                        >
                          {t("采集工作", "Collection work")}
                        </Link>
                        <Link
                          className={styles.detailLink}
                          to={`/agents/${encodeURIComponent(row.agentId)}/purpose`}
                        >
                          {t("用途", "Purpose")}
                        </Link>
                        <Link
                          className={styles.detailLink}
                          to={`/agents/${encodeURIComponent(row.agentId)}/metrics`}
                        >
                          {t("详情", "Details")}
                          <span aria-hidden="true">→</span>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 ? (
                  <tr>
                    <td className={styles.tdEmpty} colSpan={6}>
                      {t(
                        "没有符合条件的主机，试试换个关键词或状态筛选。",
                        "No hosts match. Try another keyword or status filter.",
                      )}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function SortMark({ active, asc }: { active: boolean; asc: boolean }) {
  return (
    <span
      className={active ? styles.sortMarkActive : styles.sortMark}
      aria-hidden="true"
    >
      {active ? (asc ? "↑" : "↓") : "↕"}
    </span>
  );
}

function MetricBar({
  percent,
  value,
  detail,
  severity,
}: {
  percent?: number;
  value: string;
  detail?: string;
  severity: Severity;
}) {
  return (
    <div className={styles.metricCell}>
      <div className={styles.metricTop}>
        <span
          className={`${styles.metricValue} ${severityClass("text", severity)}`}
        >
          {value}
        </span>
        {detail ? <span className={styles.metricDetail}>{detail}</span> : null}
      </div>
      {percent !== undefined ? (
        <div className={styles.barTrack}>
          <div
            className={`${styles.barFill} ${severityClass("bar", severity)}`}
            style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
