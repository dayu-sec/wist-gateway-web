import type { GatewayLinkdStatusView } from "./api";

/** 顶部接入状态卡的色调（对应 `SubsystemLinkUpstreamPage.module.css` 的 `status_*`）。 */
export type LinkUpstreamTone = "idle" | "warn" | "info" | "ok" | "crit";

export interface LinkUpstreamStatus {
  tone: LinkUpstreamTone;
  label: string;
  hint: string;
}

/**
 * 「链接上级」页顶部**接入状态**卡 → 色调 + 文案。
 *
 * 状态有两个来源，**以持久者为准**：
 *  - `linkdView`（gwlinkd 心跳，**持久**）：`Linked` / `Degraded` = **已接入**，跨网关重启仍在
 *    （客户端证书与链接关系由 gwlinkd 落盘，心跳由网关落库）。
 *  - `requestStatus`（网关**内存**待办，一次性）：只在**在途**（`Pending` / `Connecting`）与
 *    `Failed` 时有意义；网关重启即丢 —— 不能因为「查不到待办」就把一条已建立的链路报成「尚未接入」。
 *
 * 故：gwlinkd 报「已接入」时就以它为准；否则回落到待办的在途 / 失败态。
 */
export function linkUpstreamStatus(
  requestStatus: string | undefined,
  linkdView: GatewayLinkdStatusView | undefined,
): LinkUpstreamStatus {
  // 只信**新鲜**的心跳：失联时最后一次 state 不作数（否则会把已掉的链路当「已接入」）。
  const live = linkdView?.hasStatus && !linkdView.stale ? linkdView : undefined;
  if (live?.state === "Linked") {
    return {
      tone: "ok",
      label: "已接入",
      hint: "已持客户端证书，此后与中心走 mTLS；链路跨网关重启仍在。",
    };
  }
  if (live?.state === "Degraded") {
    return {
      tone: "crit",
      label: "已接入（降级）",
      hint: "已持客户端证书，但 gwlinkd 最近有失败 —— 见下方 gwlinkd 行。",
    };
  }

  switch (requestStatus) {
    case "Pending":
      return {
        tone: "warn",
        label: "待 wist-gwlinkd 拉取",
        hint: "接入物已交给本机网关；等宿主侧 gwlinkd 拉取后自动接入。",
      };
    case "Connecting":
      return {
        tone: "info",
        label: "接入中",
        hint: "gwlinkd 正在 link-upstream / register…",
      };
    case "Failed":
      return {
        tone: "crit",
        label: "接入失败",
        hint: "见下方原因；修正后重新提交接入物。",
      };
    case "Connected":
      // 待办已到终态但心跳这一拍没到：仍算已接入。
      return {
        tone: "ok",
        label: "已接入",
        hint: "已换回客户端证书，此后与中心走 mTLS。",
      };
    default:
      if (linkdView?.hasStatus && linkdView.stale) {
        return {
          tone: "warn",
          label: "链路状态未知",
          hint: "gwlinkd 心跳已失联，当前接入状态无从确认（见下方）。",
        };
      }
      return {
        tone: "idle",
        label: "尚未接入",
        hint: "把 Center「连接 Gateway」页生成的接入链接粘到下方提交。",
      };
  }
}
