import { strict as assert } from "node:assert";
import {
  ApiError,
  dispatchAgentRefresh,
  isRateLimitedError,
  normalizeAgentRefresh,
  setAdminApiToken,
} from "../src/api/admin";

/**
 * 契约测试：管理面「手工重新下发」（`POST /api/v1/admin/agents/{id}/refresh`）。
 *
 * 这个端点的要害是**别让人以为自己发出去了**，所以锁四件事：
 *   1. 请求形状：路径 + agent_id 编码、Bearer、POST、报文只有 `{"what":[…]}`；
 *   2. `what` 与 agentd CLI `refresh --only …` 是同一套词（这里是 `metrics-labels`）；
 *   3. 回执缺 `command_id` 就抛错 —— 没有它就无法在命令台账里对上这一条；
 *   4. 400 的稳定原因码（`empty_refresh_what` / `unknown_refresh_source`）与 429 的退避秒数
 *      都要能被页面读到。
 *
 * Usage: npm run test:agent-refresh
 */

interface Recorded {
  url: string;
  method: string;
  authorization: string;
  body: string;
}

let recorded: Recorded[] = [];
let responder: () => Response = () =>
  Response.json({
    agent_id: "agent-001",
    command_id: "cmd_agent-001_refresh_1762000000000000",
    kind: "refresh",
    requested_at: "2026-11-03T00:00:00Z",
    acknowledged_at: null,
    outcome: null,
    detail: null,
  });

setAdminApiToken("token-1");

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  recorded.push({
    url: String(input),
    method: init?.method ?? "GET",
    authorization: headers.get("authorization") ?? "",
    body: typeof init?.body === "string" ? init.body : "",
  });
  return responder();
};

function last(): Recorded {
  const entry = recorded[recorded.length - 1];
  assert.ok(entry, "没有记录到请求");
  return entry;
}

const command = await dispatchAgentRefresh("agent 001", ["metrics-labels"]);
assert.equal(
  last().url,
  "/api/v1/admin/agents/agent%20001/refresh",
  "路径与 agent_id 编码",
);
assert.equal(last().method, "POST", "下发用 POST");
assert.equal(last().authorization, "Bearer token-1", "管理面带 Bearer");
assert.deepEqual(
  JSON.parse(last().body),
  { what: ["metrics-labels"] },
  "报文只有 what（与 CLI --only 同一套词）",
);
assert.equal(command.agentId, "agent-001", "snake_case → camelCase");
assert.equal(
  command.commandId,
  "cmd_agent-001_refresh_1762000000000000",
  "命令 id 原样带回（台账靠它对账）",
);
assert.equal(command.kind, "refresh", "kind 是通用 refresh，不是第二套词");
assert.equal(command.requestedAt, "2026-11-03T00:00:00Z", "请求时刻保留");

// 连点两次 = 两次请求（网关侧是追加语义；页面不做去抖，避免“点了没反应”）。
await dispatchAgentRefresh("agent-001", ["metrics-labels"]);
assert.equal(recorded.length, 2, "两次下发不能合并成一个请求");

// 缺 `command_id` → 抛错：否则页面会把“根本没排队”渲染成“已下发”。
assert.throws(
  () =>
    normalizeAgentRefresh({
      agent_id: "agent-001",
      kind: "refresh",
      requested_at: "2026-11-03T00:00:00Z",
    }),
  /commandId/,
  "缺 command_id 必须抛错",
);

// 400：稳定原因码留在 code 里（页面直接显示它）。
for (const code of ["empty_refresh_what", "unknown_refresh_source"]) {
  responder = () =>
    new Response(JSON.stringify({ error: { code, message: `rejected: ${code}` } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  let rejected: unknown;
  try {
    await dispatchAgentRefresh("agent-001", ["metrics-labels"]);
  } catch (error) {
    rejected = error;
  }
  assert.ok(rejected instanceof ApiError, `${code} 应抛 ApiError`);
  assert.equal(rejected.status, 400, "状态码保留");
  assert.equal(rejected.code, code, "稳定原因码保留在 code");
}

// 429：剩余秒数要能被 `RateLimitNotice` 读到（与读取路径同一处置）。
responder = () =>
  new Response("too many requests", {
    status: 429,
    headers: { "Retry-After": "17" },
  });
let limited: unknown;
try {
  await dispatchAgentRefresh("agent-001", ["metrics-labels"]);
} catch (error) {
  limited = error;
}
assert.ok(isRateLimitedError(limited), "429 应被识别为限流");
assert.equal(limited.retryAfterSeconds, 17, "Retry-After 秒数保留");

console.log(
  "agent refresh contract: OK（路径/方法/报文 / 缺 command_id 抛错 / 400 原因码 / 429 退避）",
);
