import { MetricTile } from "./MetricTile";
import { t } from "../i18n";

interface SubsystemUnhealthyAgentMetricProps {
  value: number;
  loading?: boolean;
}

/**
 * 注意：网关当前固定返回 unhealthyAgents = 0
 * （见 crates/wist-gateway/src/api/overview.rs:110），异常判定尚未实现，
 * 所以这里不会因为 0 就断言"系统健康"。
 */
export function SubsystemUnhealthyAgentMetric({
  value,
  loading,
}: SubsystemUnhealthyAgentMetricProps) {
  return (
    <MetricTile
      label={t("异常 Agent 数", "Unhealthy agents")}
      value={String(value)}
      tone={value > 0 ? "crit" : "unknown"}
      loading={loading}
    />
  );
}
