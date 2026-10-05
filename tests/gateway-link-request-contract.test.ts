import {
  normalizeGatewayLinkRequestView,
  setGatewayLinkRequest,
  viewGatewayLinkRequest,
} from "../src/api/admin";

// 1) 视图契约：snake_case → camelCase，且 admin 视图**不含**接入券明文与 CA。
const view = normalizeGatewayLinkRequestView({
  has_request: true,
  gateway_id: "gw-demo",
  center_endpoint: "https://center.example",
  status: "Pending",
  result_detail: "",
  requested_by: "admin",
  requested_at: "2026-10-05T00:00:00+00:00",
});
if (!view.hasRequest || view.status !== "Pending") {
  throw new Error("link request view was not normalized");
}
if (view.centerEndpoint !== "https://center.example") {
  throw new Error("center endpoint was not preserved");
}
if ("linkToken" in view || "trustBundlePem" in view) {
  throw new Error("admin view must not expose the link token or CA");
}

// 2) 提交：POST 本机网关 admin 面，body 为 snake_case 的接入物。
let postedUrl = "";
let postedBody: Record<string, unknown> = {};
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  postedUrl = input.toString();
  postedBody = JSON.parse(String(init?.body));
  return Response.json({
    has_request: true,
    gateway_id: "gw-demo",
    center_endpoint: "https://center.example",
    status: "Pending",
    result_detail: "",
    requested_by: "operator",
    requested_at: "2026-10-05T00:00:00+00:00",
  });
};

const submitted = await setGatewayLinkRequest({
  centerEndpoint: "https://center.example",
  linkToken: "link_abc",
  trustBundlePem: "-----BEGIN CERTIFICATE-----\nCA\n",
});
if (postedUrl !== "/api/v1/admin/gateway/link-request") {
  throw new Error(`unexpected submit path: ${postedUrl}`);
}
if (
  postedBody.center_endpoint !== "https://center.example" ||
  postedBody.link_token !== "link_abc" ||
  !String(postedBody.trust_bundle_pem).includes("BEGIN CERTIFICATE")
) {
  throw new Error("submit body must carry center/link_token/trust_bundle_pem");
}
if (submitted.status !== "Pending") {
  throw new Error("submit response was not normalized");
}

// 3) 查看：GET 同一路径，读取状态（页面轮询）。
let getUrl = "";
globalThis.fetch = async (input: RequestInfo | URL) => {
  getUrl = input.toString();
  return Response.json({
    has_request: true,
    gateway_id: "gw-demo",
    center_endpoint: "https://center.example",
    status: "Connected",
    result_detail: "",
    requested_by: "operator",
    requested_at: "2026-10-05T00:00:00+00:00",
  });
};
const polled = await viewGatewayLinkRequest();
if (getUrl !== "/api/v1/admin/gateway/link-request") {
  throw new Error(`unexpected view path: ${getUrl}`);
}
if (polled.status !== "Connected") {
  throw new Error("view response was not normalized");
}

console.log("gateway link-request contract test passed");
