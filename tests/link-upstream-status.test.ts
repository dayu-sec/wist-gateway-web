// 「链接上级」页顶部**接入状态**卡的派生契约。
//
// 核心不变量：**以持久者为准** —— gwlinkd 心跳（存网关库、跨重启仍在）说「已接入」时，
// 绝不能因为**内存**待办（重启即丢）查不到就报「尚未接入」。这条曾把一条已建立的 GX02
// 链路显示成「尚未接入」。
import type { GatewayLinkdStatusView } from "../src/api";
import { linkUpstreamStatus } from "../src/linkUpstreamStatus";

function check(ok: boolean, message: string) {
  if (!ok) throw new Error(`FAIL: ${message}`);
}

/** gwlinkd 心跳视图工厂（默认新鲜、Linked）。 */
function linkd(
  overrides: Partial<GatewayLinkdStatusView> = {},
): GatewayLinkdStatusView {
  return {
    hasStatus: true,
    gatewayId: "GX02",
    instanceId: "gw-local/inst-1",
    version: "0.6.1",
    centerEndpoint: "https://127.0.0.1:3100",
    state: "Linked",
    credentialExpiresAt: "2026-11-07T16:05:24+00:00",
    lastCenterReportAt: "2026-10-08T16:29:32Z",
    lastError: "",
    reportedAt: "2026-10-08T16:29:32Z",
    receivedAt: "2026-10-08T16:29:32+00:00",
    ageSeconds: 2,
    stale: false,
    ...overrides,
  };
}

// ── ① 无待办（重启后内存清空）+ gwlinkd 持久状态 ────────────────────────────
{
  // 核心回归：链路已建立、待办早已消费/重启即丢 → 必须是「已接入」，不是「尚未接入」。
  const linked = linkUpstreamStatus(undefined, linkd());
  check(linked.tone === "ok", `Linked 应 ok，实际 ${linked.tone}`);
  check(linked.label === "已接入", `Linked 文案不对：${linked.label}`);

  const degraded = linkUpstreamStatus(undefined, linkd({ state: "Degraded" }));
  check(degraded.tone === "crit", `Degraded 应 crit，实际 ${degraded.tone}`);
  check(
    degraded.label === "已接入（降级）",
    `Degraded 文案不对：${degraded.label}`,
  );

  // gwlinkd 在跑但还没接入（首跑等接入物）→ 未接入。
  const waiting = linkUpstreamStatus(
    undefined,
    linkd({ state: "WaitingLinkRequest" }),
  );
  check(waiting.tone === "idle", `Waiting 应 idle，实际 ${waiting.tone}`);
  check(waiting.label === "尚未接入", `Waiting 文案不对：${waiting.label}`);

  // 从未上报心跳 → 未接入。
  const none = linkUpstreamStatus(undefined, undefined);
  check(none.tone === "idle", "无心跳应 idle");
  check(none.label === "尚未接入", `无心跳文案不对：${none.label}`);
}

// ── ② 心跳失联（stale）：最后一次 state 不作数 ──────────────────────────────
{
  const stale = linkd({ stale: true });
  const view = linkUpstreamStatus(undefined, stale);
  check(view.tone === "warn", `失联应 warn，实际 ${view.tone}`);
  check(view.label === "链路状态未知", `失联文案不对：${view.label}`);
}

// ── ③ 在途 / 失败待办（尚未建立持久链路时） ─────────────────────────────────
{
  const waiting = linkd({ state: "WaitingLinkRequest" });

  const pending = linkUpstreamStatus("Pending", waiting);
  check(pending.tone === "warn", `Pending 应 warn，实际 ${pending.tone}`);
  check(
    pending.label === "待 wist-gwlinkd 拉取",
    `Pending 文案不对：${pending.label}`,
  );

  const connecting = linkUpstreamStatus("Connecting", waiting);
  check(connecting.tone === "info", `Connecting 应 info`);
  check(connecting.label === "接入中", `Connecting 文案不对：${connecting.label}`);

  const failed = linkUpstreamStatus("Failed", waiting);
  check(failed.tone === "crit", `Failed 应 crit`);
  check(failed.label === "接入失败", `Failed 文案不对：${failed.label}`);

  // 待办已 Connected 但心跳这一拍没到 → 仍算已接入。
  const connected = linkUpstreamStatus("Connected", undefined);
  check(connected.tone === "ok", "Connected 应 ok");
  check(connected.label === "已接入", `Connected 文案不对：${connected.label}`);
}

// ── ④ 持久链路优先于内存待办 ────────────────────────────────────────────────
{
  // gwlinkd 已 Linked：即便此刻内存里有一条 Pending 待办（gwlinkd 已注册不会再拉），
  // 也不该把「已接入」的链路显示成「待拉取」。
  const view = linkUpstreamStatus("Pending", linkd());
  check(view.tone === "ok", `Linked 应压过待办，实际 ${view.tone}`);
  check(view.label === "已接入", `持久链路优先文案不对：${view.label}`);
}

console.log("link upstream status test passed");
