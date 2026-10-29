import { MetricTile } from "./MetricTile";
import { t } from "../i18n";

interface SubsystemTotalAgentMetricProps {
  value: number;
  loading?: boolean;
}

/**
 * 指标口径：网关的 `totalAgents` 是对**全部**已登记 Agent 统计的（含离线），
 * 与下方卡片列表的条数无关 —— 卡片列表另有上限（`OVERVIEW_RECENT_AGENT_LIMIT`，见
 * `wist-gateway/src/api/overview.rs`），到上限时由卡片面板自己说明。
 *
 * 这里以前写的是「取自最近上线列表并截断到 6 条」：那是旧实现的说法，指标改成对全集统计后
 * 文案没跟着改，于是 7 台的网关会在「已接入 7」底下说「上限 6 条」，自相矛盾。
 */
export function SubsystemTotalAgentMetric({
  value,
  loading,
}: SubsystemTotalAgentMetricProps) {
  return (
    <MetricTile
      label={t("已接入 Agent", "Enrolled agents")}
      value={String(value)}
      tone="accent"
      loading={loading}
    />
  );
}
