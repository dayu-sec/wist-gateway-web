import { t } from "../i18n";
import { MetricTile } from "./MetricTile";

interface SubsystemOnlineAgentMetricProps {
  value: number;
  total?: number;
  loading?: boolean;
}

/** "在线" 的判定窗口是 5 分钟（见 overview.rs 的 ONLINE_WINDOW_SECONDS）。 */
export function SubsystemOnlineAgentMetric({
  value,
  total,
  loading,
}: SubsystemOnlineAgentMetricProps) {
  const percent =
    total && total > 0 ? Math.round((value / total) * 100) : undefined;
  return (
    <MetricTile
      label={t("在线 Agent 数", "Online agents")}
      value={String(value)}
      tone={percent !== undefined && percent < 100 ? "warn" : "ok"}
      loading={loading}
    />
  );
}
