import {
  ApiError,
  fetchAgentHostMetrics,
  fetchAllAgentsHostMetrics,
  setAdminApiToken,
} from "../src/api/admin";

// 契约测试：主机指标端点把**注册表机器画像**（主机名 / node_id / IP）join 到数据面指标上。
//
// 为什么单测这一块：指标只有 `agent` 标签，主机身份不在其中 —— 页面「这是哪台机器」完全靠归一化
// 读到的 `hostname` / `ipAddresses`。这里锁住：
//   1. GET 路径 / 方法 / 凭据（agent_id 与 token 都不进查询串）；
//   2. 详情与列表的 snake_case → camelCase 映射（含新加的 node_id / hostname / ip_addresses）；
//   3. 旧网关**缺这些键** → 空串 / 空数组，不是形状错误（页面据此回退显示）；
//   4. 404 未知 agent：正文要落到 ApiError.detail。

interface Recorded {
  url: string;
  method: string;
  authorization: string;
  body: string;
}

let recorded: Recorded[] = [];

let responder: () => Response = () => Response.json({});

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  recorded.push({
    url: input.toString(),
    method: (init?.method ?? "GET").toUpperCase(),
    authorization: headers.get("authorization") ?? "",
    body: typeof init?.body === "string" ? init.body : "",
  });
  return responder();
};

setAdminApiToken("admin-token-under-test");

const IDENTITY = {
  node_id: "node-1",
  hostname: "host-1",
  ip_addresses: ["en0 10.0.0.5/24"],
};

function detailPayload(overrides: Record<string, unknown> = {}) {
  return {
    agent_id: "agent-1",
    ...IDENTITY,
    load_average_1m: 1.5,
    memory_total_kb: 1024,
    memory_available_kb: 512,
    ...overrides,
  };
}

function summaryPayload(overrides: Record<string, unknown> = {}) {
  return {
    agent_id: "agent-1",
    ...IDENTITY,
    load_average_1m: 1.5,
    memory_total_kb: 1024,
    memory_available_kb: 512,
    disk_usage_percent: 42,
    ...overrides,
  };
}

const ips = JSON.stringify(["en0 10.0.0.5/24"]);

// --- 详情：路径 / 方法 / 凭据 -------------------------------------------------
recorded = [];
responder = () => Response.json(detailPayload());
const detail = await fetchAgentHostMetrics("agent-1");
if (recorded.length !== 1) {
  throw new Error(`host metrics detail must issue one request, got ${recorded.length}`);
}
const [detailCall] = recorded;
if (detailCall.url !== "/api/v1/admin/agents/agent-1/host-metrics") {
  throw new Error(`unexpected host metrics path: ${detailCall.url}`);
}
if (detailCall.method !== "GET") {
  throw new Error(`host metrics detail must be GET, got ${detailCall.method}`);
}
if (detailCall.authorization !== "Bearer admin-token-under-test") {
  throw new Error("admin credential must be sent in the Authorization Header");
}
if (detailCall.body !== "") {
  throw new Error("host metrics detail must not send a body");
}
if (detailCall.url.includes("token") || detailCall.url.includes("admin-token-under-test")) {
  throw new Error("the admin credential must not leak into the query string");
}

// --- 详情：身份 snake_case → camelCase ---------------------------------------
if (detail.nodeId !== "node-1" || detail.hostname !== "host-1") {
  throw new Error("registry identity (node_id / hostname) was not normalized");
}
if (JSON.stringify(detail.ipAddresses) !== ips) {
  throw new Error("ip_addresses was not normalized to ipAddresses");
}
if (detail.loadAverage1m !== 1.5 || detail.memoryTotalKb !== 1024) {
  throw new Error("metric readings must survive normalization");
}

// --- 列表：路径 / 方法 / 凭据 + 身份映射 -------------------------------------
recorded = [];
responder = () =>
  Response.json([summaryPayload(), summaryPayload({ agent_id: "agent-2" })]);
const rows = await fetchAllAgentsHostMetrics();
if (recorded.length !== 1 || recorded[0].url !== "/api/v1/admin/agents/host-metrics") {
  throw new Error("host metrics list path/method drifted");
}
if (recorded[0].authorization !== "Bearer admin-token-under-test") {
  throw new Error("host metrics list must send the admin credential");
}
if (rows.length !== 2) {
  throw new Error(`host metrics list must keep every row, got ${rows.length}`);
}
if (rows[0].hostname !== "host-1" || rows[0].nodeId !== "node-1") {
  throw new Error("list row identity was not normalized");
}
if (JSON.stringify(rows[1].ipAddresses) !== ips) {
  throw new Error("list row ip_addresses was not normalized");
}

// --- 旧网关缺身份键 → 空串 / 空数组，不抛错（页面回退显示） -------------------
responder = () => Response.json({ agent_id: "agent-1", load_average_1m: 1.5 });
const legacy = await fetchAgentHostMetrics("agent-1");
if (legacy.hostname !== "" || legacy.nodeId !== "") {
  throw new Error("absent identity keys must normalize to empty strings, not throw");
}
if (!Array.isArray(legacy.ipAddresses) || legacy.ipAddresses.length !== 0) {
  throw new Error("absent ip_addresses must normalize to an empty array");
}

responder = () => Response.json([{ agent_id: "agent-1", load_average_1m: 1.5 }]);
const legacyRows = await fetchAllAgentsHostMetrics();
if (legacyRows[0].hostname !== "" || legacyRows[0].ipAddresses.length !== 0) {
  throw new Error("absent identity keys on a list row must normalize to empty values");
}

// --- 404 未知 Agent：正文要落到 ApiError.detail -----------------------------
responder = () =>
  new Response("unknown agent agent-1", {
    status: 404,
    headers: { "content-type": "text/plain" },
  });
let notFound: unknown;
try {
  await fetchAgentHostMetrics("agent-1");
} catch (error) {
  notFound = error;
}
if (!(notFound instanceof ApiError) || notFound.status !== 404) {
  throw new Error("unknown agent must surface an ApiError with status 404");
}
if (notFound.detail !== "unknown agent agent-1") {
  throw new Error(
    `plain-text 404 body must reach ApiError.detail, got ${JSON.stringify(
      notFound.detail,
    )}`,
  );
}

console.log("agent host metrics contract test passed");
