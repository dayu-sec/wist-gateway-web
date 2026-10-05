import type { GatewayLinkdStatusView } from "../api";

/** gwlinkd 状态行 → 展示色调（对应各页 CSS module 里的 `linkd_*` 类）。 */
export type LinkdTone = "idle" | "ok" | "crit";

export interface LinkdSummary {
  tone: LinkdTone;
  label: string;
  detail: string;
}

/**
 * gwlinkd（宿主侧常驻）状态 → 一行摘要：未检测到 / 失联 / 运行中 / 降级。
 *
 * 纯展示映射，不碰数据获取。「链接上级」与「Gateway 信息」两页共用同一份实现，
 * 保证同一条心跳在页面各处的措辞与判定（尤其失联阈值）完全一致。
 */
export function linkdSummary(view?: GatewayLinkdStatusView): LinkdSummary {
  if (!view || !view.hasStatus) {
    return {
      tone: "idle",
      label: "未检测到 gwlinkd",
      detail: "宿主侧常驻未上报心跳（未安装 / 未启动？）",
    };
  }
  const age = `${view.ageSeconds} 秒前`;
  if (view.stale) {
    return { tone: "crit", label: "gwlinkd 失联", detail: `最后心跳 ${age}` };
  }
  const stateLabel =
    view.state === "WaitingLinkRequest"
      ? "等待接入"
      : view.state === "Linking"
        ? "接入中"
        : view.state === "Degraded"
          ? "降级"
          : "运行中";
  const parts: string[] = [];
  if (view.version) parts.push(`v${view.version}`);
  if (view.centerEndpoint) parts.push(view.centerEndpoint);
  parts.push(`最近心跳 ${age}`);
  return {
    tone: view.state === "Degraded" ? "crit" : "ok",
    label: `gwlinkd ${stateLabel}`,
    detail: parts.join(" · "),
  };
}
