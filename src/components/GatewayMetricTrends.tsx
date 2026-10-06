import type { GatewaySelfStateHistory, GatewaySelfStateSample } from "../api";
import { TrendChart, type TrendChartSeries } from "./TrendChart";
import styles from "./GatewayMetricTrends.module.css";

interface GatewayMetricTrendsProps {
  history?: GatewaySelfStateHistory | null;
}

/** 字节 → 人类可读（B/KB/MB/GB）；用于图例与 Y 轴。 */
function bytesText(value: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = value;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${i === 0 || n >= 100 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

function percentText(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** 抽一列成 `(unix 毫秒, 值)` 点列（`null` = 那一刻量不出，跳过 → 图上显断线）。 */
function points(
  samples: GatewaySelfStateSample[],
  pick: (sample: GatewaySelfStateSample) => number | null,
): [number, number][] {
  const out: [number, number][] = [];
  for (const sample of samples) {
    const value = pick(sample);
    if (value === null || !Number.isFinite(value)) continue;
    out.push([sample.at * 1000, value]);
  }
  return out;
}

/**
 * 网关（容器）**自身**的短期趋势（最近 1 小时）。
 *
 * 数据来自网关的周期自采（`GET /api/v1/admin/gateway/self-state/history`）—— 不是 center 的
 * `gateway_*` 时序（那是 center 的 VM），所以**中心 / gwlinkd 都不在时这页也有趋势**。
 */
export function GatewayMetricTrends({ history }: GatewayMetricTrendsProps) {
  const samples = history?.samples ?? [];

  if (samples.length === 0) {
    return (
      <div className={styles.empty}>
        <strong>最近 1 小时暂无轨迹</strong>
        <span>网关每 30 秒自采一次；刚启动或刚清空数据时会短暂为空。</span>
      </div>
    );
  }

  const cpu = points(samples, (sample) => sample.cpuPercent);
  const disk = points(samples, (sample) => sample.diskUsagePercent);
  const memory = points(samples, (sample) => sample.memoryBytes);
  const online = points(samples, (sample) => sample.onlineAgents);

  // CPU 与磁盘都是百分比，可以同轴比；内存是字节、Agent 是台数，各自一张，免得量纲互压。
  const resource: TrendChartSeries[] = [];
  if (cpu.length > 0) {
    resource.push({ name: "CPU（单核口径）", color: "var(--series-1)", points: cpu });
  }
  if (disk.length > 0) {
    resource.push({ name: "磁盘使用率", color: "var(--series-2)", points: disk });
  }

  return (
    <div className={styles.wrap}>
      {resource.length > 0 ? (
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>资源占用（最近 1 小时）</h3>
          <TrendChart
            series={resource}
            height={170}
            valueFormatter={percentText}
            axisFormatter={(value) => `${Math.round(value)}%`}
          />
        </section>
      ) : null}

      {memory.length > 0 ? (
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>内存（RSS，最近 1 小时）</h3>
          <TrendChart
            series={[
              {
                name: "内存（RSS）",
                color: "var(--series-3)",
                points: memory,
              },
            ]}
            height={150}
            filled
            valueFormatter={bytesText}
            axisFormatter={bytesText}
            axisWidth={64}
          />
        </section>
      ) : null}

      {online.length > 0 ? (
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>Agent 在线（最近 1 小时）</h3>
          <TrendChart
            series={[
              {
                name: "Agent 在线",
                color: "var(--series-4)",
                points: online,
              },
            ]}
            height={140}
            filled
            valueFormatter={(value) => `${Math.round(value)} 台`}
            axisFormatter={(value) => String(Math.round(value))}
            axisWidth={34}
          />
        </section>
      ) : null}
    </div>
  );
}
