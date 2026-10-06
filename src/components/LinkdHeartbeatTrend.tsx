import type { GatewayLinkdHistory } from "../api";
import { Sparkline } from "./Sparkline";
import styles from "./LinkdHeartbeatTrend.module.css";

interface LinkdHeartbeatTrendProps {
  history?: GatewayLinkdHistory | null;
  loading?: boolean;
}

/** 窗口内每分钟一格，最多 120 格（更密的窗口也不至于糊成色块）。 */
const MAX_BUCKETS = 120;

type SegmentTone = "ok" | "warn" | "crit" | "gap";

const SEGMENT_LABEL: Record<SegmentTone, string> = {
  ok: "在线",
  warn: "未接入 / 接入中",
  crit: "降级",
  gap: "无心跳",
};

/**
 * gwlinkd 自报状态 → 状态条色调。
 *
 * 语义与 `linkdSummary` 一致：只有 `Linked` 才算「好」；`Degraded` 是**有心跳但在报错**，
 * 与「无心跳」（那一格压根没上报）是两回事，所以分开着色。
 */
function toneOf(state: string): SegmentTone {
  switch (state) {
    case "Linked":
      return "ok";
    case "Degraded":
      return "crit";
    case "WaitingLinkRequest":
    case "Linking":
      return "warn";
    default:
      return "warn";
  }
}

function clockText(seconds: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(seconds * 1000));
}

/** 秒 → 「N 秒 / N 分」。 */
function intervalText(seconds: number): string {
  if (seconds < 1) return "<1 秒";
  if (seconds < 90) return `${Math.round(seconds)} 秒`;
  return `${(seconds / 60).toFixed(1)} 分`;
}

/**
 * gwlinkd **心跳轨迹**：最近一小时的「有没有在跑」一眼看清。
 *
 * 两条信息：① 状态条 —— 每格一分钟，缺格 = 那段 gwlinkd 没上报心跳（掉线）；
 * ② 心跳间隔 sparkline —— 间隔突然拉长通常就是掉线/卡住的前兆。
 *
 * 数据来自网关侧的环形记录（`GET /api/v1/admin/gateway/linkd-status/history`）；
 * gwlinkd 纯出站、页面拉不到它，这份轨迹是**网关按收到时刻**替它记的。
 */
export function LinkdHeartbeatTrend({
  history,
  loading,
}: LinkdHeartbeatTrendProps) {
  const windowSeconds = history?.windowSeconds ?? 3600;
  const samples = history?.samples ?? [];

  if (samples.length === 0) {
    return (
      <div className={styles.state}>
        <strong>
          {loading ? "正在读取心跳轨迹…" : "最近 1 小时无心跳记录"}
        </strong>
        {loading ? null : (
          <span>gwlinkd 一直没上报心跳（未安装 / 未启动？）。</span>
        )}
      </div>
    );
  }

  // 窗口按「现在」右对齐：缺格永远出现在左侧（那段确实没跑），不会被挤到右边看不见。
  const endSeconds = Math.floor(Date.now() / 1000);
  const startSeconds = endSeconds - windowSeconds;
  const bucketCount = Math.max(
    12,
    Math.min(MAX_BUCKETS, Math.round(windowSeconds / 60)),
  );
  const step = windowSeconds / bucketCount;
  const buckets: SegmentTone[] = new Array<SegmentTone>(bucketCount).fill("gap");
  for (const sample of samples) {
    const index = Math.floor((sample.at - startSeconds) / step);
    // samples 升序 → 同格后到的覆盖先到的（取该分钟内**最后**一个状态）。
    if (index >= 0 && index < bucketCount) buckets[index] = toneOf(sample.state);
  }

  const intervals: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    intervals.push(samples[index].at - samples[index - 1].at);
  }
  const latestInterval =
    intervals.length > 0 ? intervals[intervals.length - 1] : null;
  const gaps = buckets.filter((tone) => tone === "gap").length;
  const coverage = Math.round(((bucketCount - gaps) / bucketCount) * 100);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.title}>最近 1 小时心跳</div>
          <div className={styles.timeRange}>
            {clockText(startSeconds)}–{clockText(endSeconds)}
          </div>
        </div>
        <div className={styles.meta}>
          <span>覆盖 {coverage}%</span>
          <span>{samples.length} 拍</span>
        </div>
      </div>

      <div className={styles.strip} aria-label="最近 1 小时心跳状态">
        {buckets.map((tone, index) => (
          <span
            key={index}
            className={`${styles.segment} ${styles[`seg_${tone}`]}`}
            title={`${clockText(startSeconds + index * step)} ${SEGMENT_LABEL[tone]}`}
          />
        ))}
      </div>

      <div className={styles.intervalRow}>
        <span className={styles.intervalLabel}>心跳间隔</span>
        <Sparkline
          values={intervals}
          height={22}
          maxBuckets={48}
          color="var(--accent)"
        />
        <strong className={styles.intervalValue}>
          {latestInterval === null ? "仅 1 拍" : intervalText(latestInterval)}
        </strong>
      </div>
    </div>
  );
}
