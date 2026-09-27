import { ApiError, deleteAgent, setAdminApiToken } from "../src/api/admin";

// 契约测试：删除一台**离线** Agent（`DELETE /api/v1/admin/agents/{id}`）。
//
// 为什么单测这一块：这是不可恢复的破坏性动作，而且后端把「只允许离线」做成了 409。
// 这里锁住：
//   1. 方法/路径，且 `agent_id` 进 URL 时**被编码**；
//   2. 凭据进 Authorization Header，不进查询串；
//   3. `{agent_id, deleted_at}`（snake_case）→ camelCase 的映射；
//   4. 409 如实上抛为带状态的 ApiError（调用方据此说“这台在线，不能删”），不吞成通用失败；
//   5. 响应缺字段**显式失败**，不静默成空。

interface Recorded {
  url: string;
  method: string;
  authorization: string;
  body: string;
}

let recorded: Recorded[] = [];

// agent_id 故意带空格与斜杠：它们必须被编码，不能原样拼进路径。
const DELETED = {
  agent_id: "agent node/1",
  deleted_at: "2026-09-27T10:00:00Z",
};

let responder: () => Response = () => Response.json(DELETED);

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
const result = await deleteAgent(DELETED.agent_id);
const [call] = recorded;
if (recorded.length !== 1) {
  throw new Error(`delete must issue exactly one request, got ${recorded.length}`);
}
if (call.method !== "DELETE") {
  throw new Error(`delete must be DELETE, got ${call.method}`);
}
if (call.url !== `/api/v1/admin/agents/${encodeURIComponent(DELETED.agent_id)}`) {
  throw new Error(`unexpected path: ${call.url}`);
}
if (call.url.includes(" ")) {
  throw new Error("agent_id must be url-encoded");
}
if (call.authorization !== "Bearer admin-token-under-test") {
  throw new Error("admin credential must be sent in the Authorization Header");
}
if (call.url.includes("admin-token-under-test")) {
  throw new Error("the admin credential must not leak into the query string");
}
if (call.body !== "") {
  throw new Error("delete must not send a body");
}

// --- snake_case → camelCase -------------------------------------------------
if (result.agentId !== DELETED.agent_id || result.deletedAt !== DELETED.deleted_at) {
  throw new Error(`unexpected deletion result: ${JSON.stringify(result)}`);
}

// --- 409（在线不能删）必须如实上抛，并带上服务端的原因 --------------------------
responder = () =>
  new Response("agent agent-node-a is online; only offline agents can be deleted", {
    status: 409,
  });
recorded = [];
let conflict: unknown = null;
try {
  await deleteAgent("agent-node-a");
} catch (error) {
  conflict = error;
}
if (!(conflict instanceof ApiError) || conflict.status !== 409) {
  throw new Error(`409 must surface as ApiError(409), got ${String(conflict)}`);
}
if (!(conflict.detail ?? "").includes("online")) {
  throw new Error(`the server reason must be preserved, got ${conflict.detail}`);
}

// --- 响应缺字段必须显式失败，不静默成空 ----------------------------------------
responder = () => Response.json({ agent_id: "a" });
let rejected = false;
try {
  await deleteAgent("a");
} catch {
  rejected = true;
}
if (!rejected) {
  throw new Error("a response missing deleted_at must be rejected, not silently accepted");
}

console.log("agent delete contract test passed");
