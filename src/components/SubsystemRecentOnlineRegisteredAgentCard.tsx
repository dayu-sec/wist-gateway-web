import styles from "./SubsystemRecentOnlineRegisteredAgentCard.module.css";
import { Sparkline } from "./Sparkline";
import { Link } from "react-router-dom";
import type { RecentOnlineRegisteredAgent } from "../api";
import { t, dateLocale } from "../i18n";

interface SubsystemRecentOnlineRegisteredAgentCardProps {
  agent: RecentOnlineRegisteredAgent;
  children?: React.ReactNode;
}

/** 与 crates/wist-gateway/src/api/overview.rs 的 ONLINE_WINDOW_SECONDS 保持一致。 */
const ONLINE_WINDOW_SECONDS = 300;

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(dateLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return t("{n} 秒", "{n} s", { n: seconds });
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0 && minutes > 0)
    return t("{h} 小时 {m} 分钟", "{h} h {m} min", { h: hours, m: minutes });
  if (hours > 0) return t("{h} 小时", "{h} h", { h: hours });
  return t("{m} 分钟", "{m} min", { m: minutes });
}

function formatMemory(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// CPU 有两个口径：cpuPercent 是单核口径（100% = 占满一个核，可能 > 100，只统计
// agent 进程自身）；cpuPercentOfMachine 是整机口径（0..100）。二者都不能在缺省时
// 假装成 0，所以统一显示「—」。
function formatCpu(percent?: number): string {
  return percent === undefined || percent === null ? "—" : `${percent.toFixed(1)}%`;
}

function formatLatency(ms?: number): string {
  return ms === undefined || ms === null ? "—" : `${ms} ms`;
}

export function SubsystemRecentOnlineRegisteredAgentCard({
  agent,
}: SubsystemRecentOnlineRegisteredAgentCardProps) {
  const sourceLabel = agent.source === "real" ? t("真实", "Real") : t("示例", "Sample");
  // 与网关侧判定保持一致：online_since 距今 ≤ 5 分钟才算在线
  // （见 crates/wist-gateway/src/api/overview.rs 的 ONLINE_WINDOW_SECONDS）。
  const secondsSinceOnline = Math.max(
    0,
    (Date.now() - new Date(agent.onlineSince).getTime()) / 1000,
  );
  const isOnline = secondsSinceOnline <= ONLINE_WINDOW_SECONDS;
  return (
    <article className={styles.container}>
      <div className={styles.top}>
        <div className={styles.identity}>
          <div className={styles.agentId}>{agent.agentId}</div>
          <div className={styles.instance}>{agent.instanceId}</div>
        </div>
        <div className={styles.badges}>
          <span className={isOnline ? styles.badge : styles.offlineBadge}>
            {isOnline
              ? t("在线", "Online")
              : t("离线 {duration}", "Offline {duration}", {
                  duration: formatDuration(Math.round(secondsSinceOnline)),
                })}
          </span>
          <span className={agent.source === "real" ? styles.realBadge : styles.exampleBadge}>
            {sourceLabel}
          </span>
        </div>
      </div>
      <div className={styles.durationBlock}>
        <span className={styles.durationLabel}>{t("上线时长", "Uptime")}</span>
        <strong className={styles.duration}>{formatDuration(agent.onlineDurationSeconds)}</strong>
      </div>
      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>{t("内存", "Memory")}</span>
          <span className={styles.metricValue}>{formatMemory(agent.memoryBytes)}</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>CPU</span>
          <span className={styles.metricValue}>
            {formatCpu(agent.cpuPercent)}
            <span className={styles.metricScope}>{t("单核", "per core")}</span>
          </span>
          <span className={styles.metricValue}>
            {formatCpu(agent.cpuPercentOfMachine)}
            <span className={styles.metricScope}>
              {t("整机", "whole machine")}
            </span>
          </span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>
            {t("Admin 延时", "Admin latency")}
          </span>
          <span className={styles.metricValue}>{formatLatency(agent.adminLatencyMs)}</span>
        </div>
      </div>
      <div className={styles.trend}>
        <div className={styles.trendItem}>
          <span className={styles.trendLabel}>{t("内存趋势", "Memory trend")}</span>
          <Sparkline
            values={(agent.metricsHistory ?? []).map((s) => s.memoryBytes)}
            color="var(--series-1)"
          />
        </div>
        <div className={styles.trendItem}>
          <span className={styles.trendLabel}>
            {t("CPU 趋势（单核）", "CPU trend (per core)")}
          </span>
          <Sparkline
            values={(agent.metricsHistory ?? []).map((s) => s.cpuPercent)}
            color="var(--series-5)"
          />
        </div>
        <div className={styles.trendItem}>
          <span className={styles.trendLabel}>{t("延时趋势", "Latency trend")}</span>
          <Sparkline
            values={(agent.metricsHistory ?? []).map((s) => s.adminLatencyMs)}
            color="var(--series-3)"
          />
        </div>
      </div>
      <div className={styles.details}>
        <div className={styles.item}>
          <div className={styles.label}>{t("版本", "Version")}</div>
          <div className={styles.value}>{agent.version}</div>
        </div>
        <div className={styles.item}>
          <div className={styles.label}>{t("注册时间", "Registered at")}</div>
          <div className={styles.value}>{formatDateTime(agent.registeredAt)}</div>
        </div>
        <div className={styles.item}>
          <div className={styles.label}>{t("上线时间", "Online since")}</div>
          <div className={styles.value}>{formatDateTime(agent.onlineSince)}</div>
        </div>
      </div>
      <div className={styles.footer}>
        <Link
          className={styles.metricsLink}
          to={`/agents/${encodeURIComponent(agent.agentId)}/metrics`}
        >
          {t("查看主机指标 →", "View host metrics →")}
        </Link>
        <Link
          className={styles.purposeLink}
          to={`/agents/${encodeURIComponent(agent.agentId)}/work`}
        >
          {t("查看采集工作 →", "View collection work →")}
        </Link>
        <Link
          className={styles.purposeLink}
          to={`/agents/${encodeURIComponent(agent.agentId)}/purpose`}
        >
          {t("查看用途 →", "View purpose →")}
        </Link>
      </div>
    </article>
  );
}
