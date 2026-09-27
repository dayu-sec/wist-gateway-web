import {
  ApiError,
  fetchRegisteredAgents,
  setAdminApiToken,
} from "../src/api/admin";

// 契约测试：**已注册** Agent 清单（`GET /api/v1/admin/agents`）。
//
// 为什么单测这一块：机队索引页（升级 / 采集工作）原来拿「有主机指标的 Agent」当机队，
// 待命 / 新装的机器不上送指标 → 从页面上彻底消失（也就无法被升级 / 派活）。这里锁住
// 新口径的取数与解析：
//   1. GET 路径（含 limit）与方法、凭据（token 不进查询串）；
//   2. `agents[]` 的 snake_case → camelCase 映射；
//   3. **形状漂移必须显式失败**（缺 `agents` 数组 / 某条缺 `agent_id`），
//      不静默成「机队空」—— 那会让页面说“一台都没有”，比报错更难查。

interface Recorded {
  url: string;
  method: string;
  authorization: string;
  body: string;
}

let recorded: Recorded[] = [];

function payload(agents: unknown[]): Record<string, unknown> {
  return { agents, total: agents.length, limit: 500, offset: 0 };
}

const REGISTERED = {
  agent_id: "agent-1",
  instance_id: "inst-1",
  hostname: "host-a",
  version: "0.1.8",
  status: "online",
  health: "healthy",
};

let responder: () => Response = () => Response.json(payload([REGISTERED]));

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
const agents = await fetchRegisteredAgents();
const [call] = recorded;
if (recorded.length !== 1) {
  throw new Error(
    `registered agents must issue exactly one request, got ${recorded.length}`,
  );
}
if (call.url !== "/api/v1/admin/agents?limit=500") {
  throw new Error(`unexpected path: ${call.url}`);
}
if (call.method !== "GET") {
  throw new Error(`registered agents must be GET, got ${call.method}`);
}
if (call.authorization !== "Bearer admin-token-under-test") {
  throw new Error("admin credential must be sent in the Authorization Header");
}
if (call.url.includes("admin-token-under-test")) {
  throw new Error("the admin credential must not leak into the query string");
}

// --- snake_case → camelCase -------------------------------------------------
if (agents.length !== 1) {
  throw new Error(`expected one agent, got ${agents.length}`);
}
const first = agents[0];
if (
  first.agentId !== "agent-1" ||
  first.instanceId !== "inst-1" ||
  first.hostname !== "host-a" ||
  first.version !== "0.1.8" ||
  first.status !== "online" ||
  first.health !== "healthy"
) {
  throw new Error("flat snake_case agent entry was not normalized");
}

// --- 待命 / 新装机器也算（没有 metrics 字段照样进列表）；离线状态要原样透出 -------
responder = () =>
  Response.json(
    payload([
      REGISTERED,
      {
        agent_id: "agent-standby",
        instance_id: "inst-2",
        hostname: "host-b",
        version: "0.1.8",
        status: "online",
        health: "healthy",
      },
      {
        agent_id: "agent-offline",
        instance_id: "inst-3",
        hostname: "host-c",
        version: "0.1.8",
        status: "offline",
        health: "healthy",
      },
    ]),
  );
const fleet = await fetchRegisteredAgents();
const ids = fleet.map((agent) => agent.agentId);
if (ids.length !== 3 || !ids.includes("agent-standby")) {
  throw new Error(`registry entries must all be listed: ${JSON.stringify(ids)}`);
}
// `status` 必须原样透出：升级页靠它把离线机器排除在目标之外。
const offline = fleet.find((agent) => agent.agentId === "agent-offline");
if (offline?.status !== "offline") {
  throw new Error(
    "offline status must be carried through so the page can exclude it",
  );
}

// --- 空机队是合法结果（不是错误）-------------------------------------------
responder = () => Response.json(payload([]));
const empty = await fetchRegisteredAgents();
if (empty.length !== 0) {
  throw new Error("an empty registry must map to an empty list");
}

// --- 形状漂移必须显式失败 ---------------------------------------------------
responder = () => Response.json({ total: 0, limit: 500, offset: 0 });
let rejectedMissingArray = false;
try {
  await fetchRegisteredAgents();
} catch {
  rejectedMissingArray = true;
}
if (!rejectedMissingArray) {
  throw new Error(
    "missing agents array must be rejected instead of silently empty",
  );
}

responder = () => Response.json(payload([{ instance_id: "inst-1" }]));
let rejectedMissingId = false;
try {
  await fetchRegisteredAgents();
} catch {
  rejectedMissingId = true;
}
if (!rejectedMissingId) {
  throw new Error("an entry without agent_id must be rejected");
}

// --- 401 透出状态 -----------------------------------------------------------
responder = () =>
  new Response("missing bearer", {
    status: 401,
    headers: { "content-type": "text/plain" },
  });
let unauthorized: unknown;
try {
  await fetchRegisteredAgents();
} catch (error) {
  unauthorized = error;
}
if (!(unauthorized instanceof ApiError) || unauthorized.status !== 401) {
  throw new Error("a rejected call must surface an ApiError with status 401");
}

console.log("registered agents contract test passed");
