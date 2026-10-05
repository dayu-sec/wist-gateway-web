import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { GatewayLinkdStatusView } from "../src/api";
import { linkdSummary } from "../src/components/linkdStatus";

// gwlinkd 状态行的**判定测试**。
//
// 为什么单独有这一份：本仓没有组件渲染环境（无 jsdom），而 `linkdSummary` 是「链接上级」与
// 「Gateway 信息」两页共用的展示判定 —— 失联阈值、降级口径、等待接入的措辞若散在两处就会各自漂移。
// 抽成纯函数后这里逐条钉住每种状态映射，并用源码守卫防止有人再在页面里长出第二份实现。
// 参考范式：`tests/uplink-form.test.ts`（`tsx` 跑的纯 node 脚本，失败即非零退出）。

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

function check(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

/** 一条「运行中」的心跳（最常态的形状），各用例按需覆盖。 */
function status(overrides: Partial<GatewayLinkdStatusView> = {}): GatewayLinkdStatusView {
  return {
    hasStatus: true,
    gatewayId: "GX01",
    instanceId: "GX01/inst-1",
    version: "0.4.0",
    centerEndpoint: "https://127.0.0.1:3100",
    state: "Linked",
    credentialExpiresAt: "2026-11-04T08:36:57Z",
    lastCenterReportAt: "2026-10-05T09:20:32Z",
    lastError: "",
    reportedAt: "2026-10-05T09:20:32Z",
    receivedAt: "2026-10-05T09:20:32Z",
    ageSeconds: 8,
    stale: false,
    ...overrides,
  };
}

// ── ① 没有状态（未安装 / 未启动 / 拉取失败）────────────────────────────────
{
  for (const view of [undefined, status({ hasStatus: false })]) {
    const summary = linkdSummary(view);
    check(summary.tone === "idle", "没有心跳必须是 idle 色");
    check(summary.label === "未检测到 gwlinkd", `没有心跳的文案不对：${summary.label}`);
    check(summary.detail.length > 0, "没有心跳也要给出原因提示");
  }
}

// ── ② 失联（服务端判 stale）：不论 state 是什么都压过它 ──────────────────────
{
  const summary = linkdSummary(status({ stale: true, ageSeconds: 95, state: "Linked" }));
  check(summary.tone === "crit", "失联必须是 crit 色");
  check(summary.label === "gwlinkd 失联", `失联文案不对：${summary.label}`);
  check(summary.detail === "最后心跳 95 秒前", `失联详情不对：${summary.detail}`);
  // 失联优先于 state：落后于阈值就不再显示「运行中」，否则页面会自相矛盾。
  check(
    !summary.label.includes("运行中"),
    "失联时不能还挂着「运行中」——否则与「失联」自相矛盾",
  );
}

// ── ③ 等待接入 / 降级 / 运行中三态 ─────────────────────────────────────────
// ── ③ 等待接入 / 接入中 / 降级 / 运行中四态 ──────────────────────────────
{
  const waiting = linkdSummary(status({ state: "WaitingLinkRequest" }));
  check(waiting.tone === "ok", "等待接入只是没活，不是故障");
  check(waiting.label === "gwlinkd 等待接入", `等待接入文案不对：${waiting.label}`);

  // `Linking` 是 store / 设计文档里真实存在的第四态（正在 link-upstream / register）——
  // 漏了它就会被兜底成「运行中」，把「正在接入」误报成「已就绪」。
  const linking = linkdSummary(status({ state: "Linking" }));
  check(linking.tone === "ok", "接入中不是故障");
  check(linking.label === "gwlinkd 接入中", `接入中文案不对：${linking.label}`);

  const degraded = linkdSummary(status({ state: "Degraded" }));
  check(degraded.tone === "crit", "降级必须是 crit 色");
  check(degraded.label === "gwlinkd 降级", `降级文案不对：${degraded.label}`);

  const linked = linkdSummary(status({ state: "Linked" }));
  check(linked.tone === "ok", "运行中必须是 ok 色");
  check(linked.label === "gwlinkd 运行中", `运行中文案不对：${linked.label}`);
  check(
    linked.detail === "v0.4.0 · https://127.0.0.1:3100 · 最近心跳 8 秒前",
    `运行中详情不对：${linked.detail}`,
  );

  // 未知/空 state：心跳是新鲜的（stale=false）本就在跑，兜底成「运行中」——
  // 钉住这个兜底，免得日后有人改成抛错或显示原始枚举值。
  for (const raw of ["", "SomeFutureState"]) {
    const unknown = linkdSummary(status({ state: raw }));
    check(
      unknown.label === "gwlinkd 运行中",
      `未知 state（${JSON.stringify(raw)}）应兜底为运行中，实际 ${unknown.label}`,
    );
  }
}

// ── ④ 详情为空字段时不留悬空分隔符 ─────────────────────────────────────────
{
  const summary = linkdSummary(status({ version: "", centerEndpoint: "" }));
  check(summary.detail === "最近心跳 8 秒前", `空字段详情不对：${summary.detail}`);
  check(!summary.detail.includes(" ·  · "), "空字段不能留下悬空分隔符");
}

// ── ⑤ 源码守卫：各页必须共用同一份 linkdSummary，不得各长一份 ──────────
{
  for (const page of [
    "src/components/SubsystemLinkUpstreamPage.tsx",
    "src/components/SubsystemGatewayInfoPage.tsx",
    "src/components/SubsystemGatewayStatusPage.tsx",
  ]) {
    const source = read(page).replace(/\s+/g, " ");
    check(
      source.includes('from "./linkdStatus"') && source.includes("linkdSummary"),
      `${page} 没有复用共享的 linkdSummary`,
    );
    // 反向守卫：页面里若重新出现函数定义，说明又长出了第二份实现。
    check(
      !source.includes("function linkdSummary"),
      `${page} 里又定义了一份 linkdSummary —— 该用 ./linkdStatus 的共享实现`,
    );
  }
}

// ── ⑥ 源码守卫：gwlinkd 的落脚点（独立页是「家」，其余只留一行 + 链） ──────
{
  // 独立页 `/gwlinkd`（网关状态）：完整明细（含证书到期 / 最近上报 / 最近错误 / 实例）集中在这里。
  const page = read("src/components/SubsystemGatewayStatusPage.tsx").replace(/\s+/g, " ");
  for (const field of [
    "credentialExpiresAt",
    "lastCenterReportAt",
    "lastError",
    "instanceId",
  ]) {
    check(
      page.includes(field),
      `「网关状态」独立页缺 ${field}（gwlinkd 明细应集中在此）`,
    );
  }
  // 该页同屏还展示**网关（容器）自己**的状态（自述面）—— 与 gwlinkd 版本不是一回事。
  for (const field of [
    "useGatewaySelfState",
    "storeHealthy",
    "agentCount",
    "uplinkEnabled",
    "uptimeSeconds",
    "cpuPercent",
    "memoryBytes",
    "onlineAgents",
    "offlineAgents",
    "lastSeenLagSeconds",
    "storeBytes",
    "ingestAcceptedTotal",
    "ingestRejectedTotal",
    "lastIngestAt",
    "memoryTotalBytes",
    "load1m",
    "load5m",
    "load15m",
    "diskUsagePercent",
    "diskTotalBytes",
    "diskAvailableBytes",
  ]) {
    check(
      page.includes(field),
      `「网关状态」页缺网关自身状态（${field}）—— 应同时展示「网关容器」与「接入代理」`,
    );
  }

  // 路由 + 侧边栏入口必须在（否则独立页进不去）。
  check(
    read("src/App.tsx").includes('path="/gwlinkd"'),
    "App 未注册 /gwlinkd 路由",
  );
  check(
    read("src/components/SubsystemAdminTopNavigation.tsx").includes('to: "/gwlinkd"'),
    "侧边栏缺 /gwlinkd 入口",
  );

  // 「Gateway 信息」页只留一行状态 + 链，不再重复明细。
  const info = read("src/components/SubsystemGatewayInfoPage.tsx").replace(/\s+/g, " ");
  check(
    info.includes('id="gateway-info-linkd"'),
    "「Gateway 信息」页缺 gwlinkd 摘要行（gateway-info-linkd）",
  );
  check(
    info.includes('to="/gwlinkd"'),
    "「Gateway 信息」页的 gwlinkd 行应链到独立页 /gwlinkd",
  );
  // 该页的既有纪律：数据没取到就不下结论（状态行要有门）。
  check(
    info.includes("linkdReady"),
    "「Gateway 信息」的 gwlinkd 行缺“取到才下结论”的门",
  );
  check(
    !info.includes("credentialExpiresAt") && !info.includes("lastCenterReportAt"),
    "明细（证书到期 / 最近上报）应集中在独立页，不在 Gateway 信息重复",
  );

  // 「链接上级」的一行摘要也链到独立页。
  check(
    read("src/components/SubsystemLinkUpstreamPage.tsx").includes('to="/gwlinkd"'),
    "「链接上级」的 gwlinkd 行应链到独立页 /gwlinkd",
  );
}

console.log("gateway linkd summary test passed");
