import type { GatewayLinkdStatusView } from "../api";
import { t } from "../i18n";

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
 *
 * 文案在调用那一刻取（`t()`）：两页都在渲染期调它，切语言会重新求值。
 */
export function linkdSummary(view?: GatewayLinkdStatusView): LinkdSummary {
  if (!view || !view.hasStatus) {
    return {
      tone: "idle",
      label: t("未检测到 gwlinkd", "gwlinkd not detected"),
      detail: t(
        "宿主侧常驻未上报心跳（未安装 / 未启动？）",
        "The host-side daemon has not reported a heartbeat (not installed / not running?)",
      ),
    };
  }
  const age = t("{n} 秒前", "{n}s ago", { n: view.ageSeconds });
  if (view.stale) {
    return {
      tone: "crit",
      label: t("gwlinkd 失联", "gwlinkd unreachable"),
      detail: t("最后心跳 {age}", "last heartbeat {age}", { age }),
    };
  }
  const stateLabel =
    view.state === "WaitingLinkRequest"
      ? t("等待接入", "waiting for link request")
      : view.state === "Linking"
        ? t("接入中", "linking")
        : view.state === "Degraded"
          ? t("降级", "degraded")
          : t("运行中", "running");
  const parts: string[] = [];
  if (view.version) parts.push(`v${view.version}`);
  if (view.centerEndpoint) parts.push(view.centerEndpoint);
  parts.push(t("最近心跳 {age}", "last heartbeat {age}", { age }));
  return {
    tone: view.state === "Degraded" ? "crit" : "ok",
    label: t("gwlinkd {state}", "gwlinkd {state}", { state: stateLabel }),
    detail: parts.join(" · "),
  };
}
