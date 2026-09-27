import {
  ApiError,
  fetchAgentRuntimeStatus,
  setAdminApiToken,
} from "../src/api/admin";

// 契约测试：单台 Agent 运行态里的**实际生效**数据面上送状态（`uplink_state`）。
//
// 为什么单测这一块：**待命与故障在别处长得一样**（两种情况都没数据），页面完全靠
// `uplink_state` 区分。这里锁住：
//   1. GET 路径 / 方法 / 凭据（agent_id 与 token 都不进查询串）；
//   2. `uplink_state` 的 snake_case → camelCase 映射（含 `output_write_failing`）；
//   3. `uplink_state` 为 null 或整个缺失都映射成 null，且字段**存在** ——
//      页面用它判定「未上报」，undefined 会让这个哨兵失效；
//   4. tcp 无目标时 `target` 是 null（而不是空串）；
//   5. 形状漂移（缺 enabled / kind / source）必须显式失败，不静默成假状态。

interface Recorded {
  url: string;
  method: string;
  authorization: string;
  body: string;
}

let recorded: Recorded[] = [];

function basePayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    agent_id: "agent-1",
    instance_id: "inst-1",
    version: "0.2.0",
    status: "online",
    health: "healthy",
    last_seen_at: "2026-09-26T00:00:00+00:00",
    uplink_state: {
      enabled: true,
      kind: "tcp",
      target: "10.0.1.9:9000",
      source: "grant",
      output_write_failing: false,
    },
    ...overrides,
  };
}

let responder: () => Response = () => Response.json(basePayload());

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

// --- 路径 / 方法 / 凭据 -----------------------------------------------------
recorded = [];
const status = await fetchAgentRuntimeStatus("agent-1");
const [call] = recorded;
if (recorded.length !== 1) {
  throw new Error(
    `runtime-status view must issue exactly one request, got ${recorded.length}`,
  );
}
if (call.url !== "/api/v1/admin/agents/agent-1/runtime-status") {
  throw new Error(`unexpected runtime-status path: ${call.url}`);
}
if (call.method !== "GET") {
  throw new Error(`runtime-status view must be GET, got ${call.method}`);
}
if (call.authorization !== "Bearer admin-token-under-test") {
  throw new Error("admin credential must be sent in the Authorization Header");
}
if (call.body !== "") {
  throw new Error("runtime-status view must not send a body");
}
if (call.url.includes("token") || call.url.includes("admin-token-under-test")) {
  throw new Error("the admin credential must not leak into the query string");
}

// --- snake_case → camelCase（含 output_write_failing）------------------------
if (!status.uplinkState) {
  throw new Error("uplink_state must be normalized, not dropped");
}
if (
  status.uplinkState.enabled !== true ||
  status.uplinkState.kind !== "tcp" ||
  status.uplinkState.target !== "10.0.1.9:9000" ||
  status.uplinkState.source !== "grant" ||
  status.uplinkState.outputWriteFailing !== false
) {
  throw new Error("flat snake_case uplink_state was not normalized");
}

// --- tcp 无目标：target 必须是 null，不能拼成空串 --------------------------
responder = () =>
  Response.json(
    basePayload({
      uplink_state: {
        enabled: true,
        kind: "tcp",
        source: "grant",
        output_write_failing: false,
      },
    }),
  );
const noTarget = await fetchAgentRuntimeStatus("agent-1");
if (noTarget.uplinkState?.target !== null) {
  throw new Error(
    `absent target must map to null, not ${JSON.stringify(
      noTarget.uplinkState?.target,
    )}`,
  );
}

// --- 待命（grant，enabled=false）：如实映射，不当成错误 ---------------------
responder = () =>
  Response.json(
    basePayload({
      uplink_state: {
        enabled: false,
        kind: "file",
        source: "grant",
        output_write_failing: false,
      },
    }),
  );
const standby = await fetchAgentRuntimeStatus("agent-1");
if (
  standby.uplinkState?.enabled !== false ||
  standby.uplinkState.source !== "grant"
) {
  throw new Error("standby grant must be normalized as-is");
}

// --- 出口失败标志：只能通过 output_write_failing 进来 -----------------------
responder = () =>
  Response.json(
    basePayload({
      uplink_state: {
        enabled: true,
        kind: "tcp",
        target: "10.0.1.9:9000",
        source: "grant",
        output_write_failing: true,
      },
    }),
  );
const failing = await fetchAgentRuntimeStatus("agent-1");
if (failing.uplinkState?.outputWriteFailing !== true) {
  throw new Error("output_write_failing=true was not carried through");
}

// --- uplink_state 为 null：映射成 null 且字段必须存在 -----------------------
responder = () => Response.json(basePayload({ uplink_state: null }));
const nullState = await fetchAgentRuntimeStatus("agent-1");
if (nullState.uplinkState !== null) {
  throw new Error("null uplink_state must map to null");
}
if (!("uplinkState" in nullState)) {
  throw new Error("nullable uplinkState must not be dropped by the normalizer");
}

// --- uplink_state 整个缺失（旧网关）：同样是 null，不抛错 -------------------
const withoutUplink = basePayload();
delete withoutUplink.uplink_state;
responder = () => Response.json(withoutUplink);
const missingState = await fetchAgentRuntimeStatus("agent-1");
if (missingState.uplinkState !== null) {
  throw new Error("missing uplink_state must map to null, not throw");
}

// --- 形状漂移必须显式失败 ---------------------------------------------------
responder = () =>
  Response.json(
    basePayload({
      uplink_state: {
        kind: "tcp",
        source: "grant",
        output_write_failing: false,
      },
    }),
  );
let rejectedMissingEnabled = false;
try {
  await fetchAgentRuntimeStatus("agent-1");
} catch {
  rejectedMissingEnabled = true;
}
if (!rejectedMissingEnabled) {
  throw new Error(
    "uplink_state missing enabled must be rejected instead of silently blanked",
  );
}

// --- 404 未知 Agent：正文要落到 ApiError.detail -----------------------------
responder = () =>
  new Response("unknown agent agent-1", {
    status: 404,
    headers: { "content-type": "text/plain" },
  });
let notFound: unknown;
try {
  await fetchAgentRuntimeStatus("agent-1");
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

console.log("agent runtime status contract test passed");
