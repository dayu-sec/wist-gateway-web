import { MetricTile } from "./MetricTile";
import { formatRelativeSeconds } from "../lib/format";
import { t } from "../i18n";

interface SubsystemLastSeenLagMetricProps {
  seconds?: number;
  loading?: boolean;
}

/**
 * 语义来自 crates/wist-gateway/src/api/overview.rs:107——
 * 该值是「所有 Agent 中 online_since 距当前最久的一个」，不是在线上报延迟，
 * 也不是"数据陈旧度"：一台持续在线的 Agent 会让它单调增长。
 * 因此这里不做危急着色，避免把正常的长在线时长渲染成故障。
 */
export function SubsystemLastSeenLagMetric({
  seconds,
  loading,
}: SubsystemLastSeenLagMetricProps) {
  const { text } = formatRelativeSeconds(seconds);

  return (
    <MetricTile
      label={t("最久未重新上线", "Longest since last online")}
      value={text}
      tone="unknown"
      loading={loading}
    />
  );
}
