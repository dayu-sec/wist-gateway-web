import { MetricTile } from "./MetricTile";
import { t } from "../i18n";

interface SubsystemTotalAgentMetricProps {
  value: number;
  hint?: string;
  loading?: boolean;
}

/**
 * 注意：网关返回的 totalAgents 取自最近上线列表并截断到 6 条
 * （见 crates/wist-gateway/src/api/overview.rs:97 truncate(6)），
 * 因此它不是集群真实主机总数——文案按实际口径描述。
 */
export function SubsystemTotalAgentMetric({
  value,
  hint,
  loading,
}: SubsystemTotalAgentMetricProps) {
  return (
    <MetricTile
      label={t("已接入 Agent", "Enrolled agents")}
      value={String(value)}
      hint={
        hint ??
        t(
          "网关最近上线列表中的 Agent 数量（网关侧上限 6 条）",
          "Number of agents in the gateway's recent online list (the gateway caps it at 6)",
        )
      }
      tone="accent"
      loading={loading}
    />
  );
}
