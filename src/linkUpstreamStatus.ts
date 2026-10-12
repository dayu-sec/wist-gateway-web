import type { GatewayLinkdStatusView } from "./api";
import { t } from "./i18n";

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
 * 故：gwlinkd 报「已接入」时就以它为准；否则回落到待办的在途 / 失败态 —— **但** gwlinkd 心跳在跑、
 * 却报「非已接入」（`WaitingLinkRequest` / `Linking`）时，内存里那条终态 `Connected` 待办是**上一回
 * 接入的残留**，不能拿它把一条已断开的链路报成「已接入」（`unlink` 后正是这个形态）。
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
      label: t("已接入", "Enrolled"),
      hint: t(
        "已持客户端证书，此后与中心走 mTLS；链路跨网关重启仍在。",
        "Client certificate held; from now on mTLS with the center. The link survives a gateway restart.",
      ),
    };
  }
  if (live?.state === "Degraded") {
    return {
      tone: "crit",
      label: t("已接入（降级）", "Enrolled (degraded)"),
      hint: t(
        "已持客户端证书，但 gwlinkd 最近有失败 —— 见下方 gwlinkd 行。",
        "Client certificate held, but gwlinkd has recent failures — see the gwlinkd row below.",
      ),
    };
  }

  switch (requestStatus) {
    case "Pending":
      return {
        tone: "warn",
        label: t("待 wist-gwlinkd 拉取", "Waiting for wist-gwlinkd to pull"),
        hint: t(
          "接入物已交给本机网关；等宿主侧 gwlinkd 拉取后自动接入。",
          "The enrollment material has been handed to the local gateway; it enrolls automatically once the host-side gwlinkd pulls it.",
        ),
      };
    case "Connecting":
      return {
        tone: "info",
        label: t("接入中", "Enrolling"),
        hint: t(
          "gwlinkd 正在 link-upstream / register…",
          "gwlinkd is running link-upstream / register…",
        ),
      };
    case "Failed":
      return {
        tone: "crit",
        label: t("接入失败", "Enrollment failed"),
        hint: t(
          "见下方原因；修正后重新提交接入物。",
          "See the reason below; fix it and submit the enrollment material again.",
        ),
      };
    case "Connected":
      // 待办已到终态、心跳这一拍没到（或已失联）：凭这条内存待办记「已接入」。
      // **但** `live` 存在（心跳在跑）时不能信它 —— 心跳说「非已接入」而待办是 `Connected`，
      // 那是上一回接入的残留待办（内存、重启即丢），照它会把已断开的链路报成「已接入」。
      if (!live) {
        return {
          tone: "ok",
          label: t("已接入", "Enrolled"),
          hint: t(
            "已换回客户端证书，此后与中心走 mTLS。",
            "Client certificate swapped back in; from now on mTLS with the center.",
          ),
        };
      }
      break;
  }
  // 到此：没有新鲜心跳，或心跳在跑却报「非已接入」—— 逐一排除后的落地态。
  if (linkdView?.hasStatus && linkdView.stale) {
    return {
      tone: "warn",
      label: t("链路状态未知", "Link status unknown"),
      hint: t(
        "gwlinkd 心跳已失联，当前接入状态无从确认（见下方）。",
        "The gwlinkd heartbeat has been lost; the current enrollment status cannot be confirmed (see below).",
      ),
    };
  }
  return {
    tone: "idle",
    label: t("尚未接入", "Not enrolled"),
    hint: t(
      "把 Center「连接 Gateway」页生成的接入链接粘到下方提交。",
      "Paste the enrollment link generated on the Center “Connect Gateway” page below and submit it.",
    ),
  };
}
