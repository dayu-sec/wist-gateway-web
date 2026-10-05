import {
  normalizeGatewaySelfStateView,
  viewGatewaySelfState,
} from "../src/api/admin";

// 网关**自身**状态（自述面在 admin 面的读投影）：snake_case → camelCase；`last_error` 与进程资源
// （`cpu_percent`/`memory_bytes`）可为 null。与 gwlinkd 状态分开的一份契约 —— 它描述的是
// **网关容器自己**（版本/存储/机队/上送/进程资源）。

const view = normalizeGatewaySelfStateView({
  gateway_id: "gw-1",
  version: "0.1.16",
  collected_at: "2026-10-05T00:00:00+00:00",
  store_healthy: true,
  agent_count: 3,
  uplink_enabled: false,
  last_error: null,
  uptime_seconds: 3600,
  cpu_percent: 1.5,
  memory_bytes: 104857600,
  online_agents: 2,
  offline_agents: 1,
  last_seen_lag_seconds: 30,
  store_bytes: 4096,
  ingest_accepted_total: 10,
  ingest_rejected_total: 1,
  last_ingest_at: null,
  memory_total_bytes: 34359738368,
  load_1m: 0.5,
  load_5m: 0.4,
  load_15m: 0.3,
  disk_usage_percent: 50.0,
  disk_total_bytes: 1000,
  disk_available_bytes: 500,
});
if (!view.storeHealthy || view.agentCount !== 3 || view.uplinkEnabled) {
  throw new Error("gateway self-state booleans/numbers were not normalized");
}
if (
  view.uptimeSeconds !== 3600 ||
  view.onlineAgents !== 2 ||
  view.offlineAgents !== 1 ||
  view.lastSeenLagSeconds !== 30
) {
  throw new Error("gateway self-state fleet/lifecycle fields were not normalized");
}
if (view.cpuPercent !== 1.5 || view.memoryBytes !== 104857600) {
  throw new Error("gateway self-state process metrics were not normalized");
}
if (
  view.storeBytes !== 4096 ||
  view.ingestAcceptedTotal !== 10 ||
  view.ingestRejectedTotal !== 1
) {
  throw new Error("gateway self-state storage/data-plane counts were not normalized");
}
if (view.lastIngestAt !== null) {
  throw new Error("last_ingest_at null must stay null (未接收过)");
}
if (
  view.memoryTotalBytes !== 34359738368 ||
  view.load1m !== 0.5 ||
  view.diskUsagePercent !== 50
) {
  throw new Error("gateway self-state host metrics were not normalized");
}
if (view.version !== "0.1.16" || view.lastError !== null) {
  throw new Error("gateway self-state fields were not preserved");
}

// 路径 + 响应：GET admin 面 `self-state`；量不出的进程资源是 **null**（在场但为空），
// 不能当成缺失而抛错（页面要能显示「—」）。
let getUrl = "";
globalThis.fetch = async (input: RequestInfo | URL) => {
  getUrl = input.toString();
  return Response.json({
    gateway_id: "gw-1",
    version: "0.1.16",
    collected_at: "2026-10-05T00:00:00+00:00",
    store_healthy: false,
    agent_count: 0,
    uplink_enabled: true,
    last_error: "存储不可查",
    uptime_seconds: 0,
    cpu_percent: null,
    memory_bytes: null,
    online_agents: 0,
    offline_agents: 0,
    last_seen_lag_seconds: 0,
    store_bytes: 0,
    ingest_accepted_total: 0,
    ingest_rejected_total: 0,
    last_ingest_at: "2026-10-05T00:00:00+00:00",
    memory_total_bytes: null,
    load_1m: null,
    load_5m: null,
    load_15m: null,
    disk_usage_percent: null,
    disk_total_bytes: null,
    disk_available_bytes: null,
  });
};
const fetched = await viewGatewaySelfState();
if (getUrl !== "/api/v1/admin/gateway/self-state") {
  throw new Error(`unexpected self-state path: ${getUrl}`);
}
if (fetched.storeHealthy || fetched.lastError !== "存储不可查") {
  throw new Error("gateway self-state response was not normalized");
}
if (fetched.cpuPercent !== null || fetched.memoryBytes !== null) {
  throw new Error("null process metrics must stay null (量不出 ≠ 0)");
}
if (fetched.lastIngestAt !== "2026-10-05T00:00:00+00:00") {
  throw new Error("last_ingest_at timestamp was not preserved");
}
if (fetched.memoryTotalBytes !== null || fetched.load1m !== null) {
  throw new Error("null host metrics must stay null (量不出 ≠ 0)");
}

console.log("gateway self-state contract test passed");
