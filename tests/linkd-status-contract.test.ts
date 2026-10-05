import {
  normalizeGatewayLinkdStatusView,
  viewGatewayLinkdStatus,
} from "../src/api/admin";

// 1) 视图契约：snake_case → camelCase，含服务端算的 age_seconds / stale。
const view = normalizeGatewayLinkdStatusView({
  has_status: true,
  gateway_id: "gw-1",
  instance_id: "gw-1/inst-1",
  version: "0.4.0",
  center_endpoint: "https://center.example",
  state: "Linked",
  credential_expires_at: "2026-12-01T00:00:00+00:00",
  last_center_report_at: "2026-10-05T00:00:00+00:00",
  last_error: "",
  reported_at: "2026-10-05T00:00:00+00:00",
  received_at: "2026-10-05T00:00:00+00:00",
  age_seconds: 12,
  stale: false,
});
if (!view.hasStatus || view.state !== "Linked" || view.ageSeconds !== 12 || view.stale) {
  throw new Error("linkd status view was not normalized");
}
if (view.centerEndpoint !== "https://center.example" || view.version !== "0.4.0") {
  throw new Error("linkd status fields were not preserved");
}

// 2) 查看：GET admin 面，读回状态（页面轮询）。
let getUrl = "";
globalThis.fetch = async (input: RequestInfo | URL) => {
  getUrl = input.toString();
  return Response.json({
    has_status: true,
    gateway_id: "gw-1",
    instance_id: "gw-1/inst-1",
    version: "0.4.0",
    center_endpoint: "https://center.example",
    state: "Degraded",
    credential_expires_at: "",
    last_center_report_at: "",
    last_error: "中心不可达",
    reported_at: "2026-10-05T00:00:00+00:00",
    received_at: "2026-10-05T00:00:00+00:00",
    age_seconds: 200,
    stale: true,
  });
};
const polled = await viewGatewayLinkdStatus();
if (getUrl !== "/api/v1/admin/gateway/linkd-status") {
  throw new Error(`unexpected view path: ${getUrl}`);
}
if (!polled.stale || polled.lastError !== "中心不可达") {
  throw new Error("view response was not normalized");
}

// 3) 空态（从未上报）：has_status=false，字段全为空串 —— 前端必须能原样收敛，不得抛错，
//    否则页面在「gwlinkd 从未跑过」时反而显示报错而不是「未检测到」。
const empty = normalizeGatewayLinkdStatusView({
  has_status: false,
  gateway_id: "",
  instance_id: "",
  version: "",
  center_endpoint: "",
  state: "",
  credential_expires_at: "",
  last_center_report_at: "",
  last_error: "",
  reported_at: "",
  received_at: "",
  age_seconds: 0,
  stale: false,
});
if (empty.hasStatus || empty.ageSeconds !== 0 || empty.stale) {
  throw new Error("empty linkd status view was not normalized");
}
if (empty.centerEndpoint !== "" || empty.lastError !== "") {
  throw new Error("empty linkd status fields should stay empty strings");
}

console.log("gateway linkd-status contract test passed");
