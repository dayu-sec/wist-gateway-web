import { t } from "../i18n";
import { MetricTile } from "./MetricTile";

interface SubsystemOnlineAgentMetricProps {
  value: number;
  total?: number;
  hint?: string;
  loading?: boolean;
}

/** "在线" 的判定窗口是 5 分钟（见 overview.rs 的 ONLINE_WINDOW_SECONDS）。 */
export function SubsystemOnlineAgentMetric({
  value,
  total,
  hint,
  loading,
}: SubsystemOnlineAgentMetricProps) {
  const percent =
    total && total > 0 ? Math.round((value / total) * 100) : undefined;
  return (
    <MetricTile
      label={t("在线 Agent 数", "Online agents")}
      value={String(value)}
      hint={
        hint ??
        (percent === undefined
          ? t(
              "最近 5 分钟内有心跳的 Agent 数量",
              "Agents with a heartbeat in the last 5 minutes",
            )
          : t(
              "在线率 {percent}% · 最近 5 分钟内有心跳的 Agent",
              "{percent}% online · agents with a heartbeat in the last 5 minutes",
              { percent },
            ))
      }
      tone={percent !== undefined && percent < 100 ? "warn" : "ok"}
      loading={loading}
    />
  );
}
