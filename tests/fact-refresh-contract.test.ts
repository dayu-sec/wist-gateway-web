import {
  ApiError,
  fetchAgentFactRefresh,
  normalizeAgentFactRefresh,
  requestAgentFactRefresh,
  setAdminApiToken,
  type AgentFactRefreshCommand,
  type AgentFactRefreshOutcome,
} from "../src/api/admin";
import {
  factRefreshStatus,
  factRefreshStatusLabel,
  factRefreshSummaryParts,
  factRefreshTone,
  summarizeFactRefresh,
  type FactRefreshStatus,
} from "../src/components/factRefreshState";

// 契约测试：管理面「重采事实」命令 + 页面状态映射。
//
// 锁住四件事：
//   1. GET / POST 的路径、方法、URL 编码（agent_id 可能含 `/`、空格）；
//   2. 响应里 `null` 的语义（从没请求 / 等待认领 / 还没有结果）—— 缺字段是漂移、null 是状态，
//      两者不能混（否则「等待认领」会被显示成「未请求」）；
//   3. 每个终态 outcome 都有确定的页面状态与色调，`throttled` 必须说明「60s 内已采过」；
//   4. 汇总只数有效状态、按固定顺序输出。
//
// Usage: npm run test:fact-refresh

interface Recorded {
  url: string;
  method: string;
  authorization: string;
  body: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
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

function commandPayload() {
  return {
    agent_id: "agent-x",
    command_id: "cmd_agent-x_refresh_1780000000000000",
    kind: "refresh_facts",
    requested_at: "2026-10-26T05:00:00+00:00",
    acknowledged_at: null,
    outcome: null,
    detail: null,
  };
}

function command(
  overrides: Partial<AgentFactRefreshCommand> = {},
): AgentFactRefreshCommand {
  return {
    agentId: "agent-x",
    commandId: "cmd_agent-x_refresh_1780000000000000",
    kind: "refresh_facts",
    requestedAt: "2026-10-26T05:00:00+00:00",
    acknowledgedAt: null,
    outcome: null,
    detail: null,
    ...overrides,
  };
}

// ── ① GET：路径 / 方法 / snake_case 归一化 ────────────────────────────────────
recorded = [];
responder = () => Response.json(commandPayload());
const loaded = await fetchAgentFactRefresh("agent-x");
const [readCall] = recorded;
assert(recorded.length === 1, `GET 必须只发一次请求，实际 ${recorded.length}`);
assert(
  readCall.url === "/api/v1/admin/agents/agent-x/fact-refresh",
  `GET 路径不对：${readCall.url}`,
);
assert(readCall.method === "GET", `GET 必须用 GET，实际 ${readCall.method}`);
assert(
  readCall.authorization === "Bearer admin-token-under-test",
  "admin 凭据必须放在 Authorization Header",
);
assert(readCall.body === "", "GET 不能带 body");
assert(
  loaded.agentId === "agent-x" &&
    loaded.commandId === "cmd_agent-x_refresh_1780000000000000" &&
    loaded.kind === "refresh_facts" &&
    loaded.requestedAt === "2026-10-26T05:00:00+00:00",
  "GET 返回体没有被归一化",
);
assert(
  loaded.acknowledgedAt === null &&
    loaded.outcome === null &&
    loaded.detail === null,
  "null 必须保持 null（不能变成 undefined）",
);
assert(
  "acknowledgedAt" in loaded && "outcome" in loaded && "detail" in loaded,
  "可空字段必须保留在对象上",
);

// ── ② POST：路径 / 方法 / 无 body / 特殊字符编码 ────────────────────────────
recorded = [];
const requested = await requestAgentFactRefresh("agent-x");
const [writeCall] = recorded;
assert(
  writeCall.url === "/api/v1/admin/agents/agent-x/fact-refresh",
  `POST 路径不对：${writeCall.url}`,
);
assert(writeCall.method === "POST", `POST 必须用 POST，实际 ${writeCall.method}`);
assert(writeCall.body === "", "POST 不能带 body");
assert(
  requested.commandId !== null && requested.acknowledgedAt === null,
  "POST 应返回刚入队、等待认领的命令",
);

recorded = [];
await requestAgentFactRefresh("agent/with space");
assert(
  recorded[0].url ===
    "/api/v1/admin/agents/agent%2Fwith%20space/fact-refresh",
  `agent_id 必须 URL 编码：${recorded[0].url}`,
);

// ── ③ 从没请过：全 null 是合法响应 ──────────────────────────────────────────
const never = normalizeAgentFactRefresh({
  agent_id: "agent-x",
  command_id: null,
  kind: null,
  requested_at: null,
  acknowledged_at: null,
  outcome: null,
  detail: null,
});
assert(never.commandId === null, "从没请求过时 command_id 必须是 null");
assert(
  factRefreshStatus(never) === "idle",
  "从没请求过的命令必须是 idle",
);
assert(factRefreshStatus(null) === "idle", "null 命令也是 idle");
assert(factRefreshStatus(undefined) === "idle", "undefined 命令也是 idle");

// ── ④ 生命周期：等待认领 → 重采中 → 终态 ──────────────────────────────────
assert(
  factRefreshStatus(command()) === "requested",
  "已下发、acknowledged_at 为 null → 等待认领",
);
assert(
  factRefreshStatus(command({ acknowledgedAt: "2026-10-26T05:00:03+00:00" })) ===
    "acked",
  "已认领、outcome 为 null → 重采中",
);

const outcomeStatus: Record<AgentFactRefreshOutcome, FactRefreshStatus> = {
  succeeded: "succeeded",
  failed: "failed",
  no_uplink: "no_uplink",
  throttled: "throttled",
  stale: "stale",
  unsupported: "unsupported",
  superseded: "superseded",
  expired: "expired",
};
for (const [outcome, expected] of Object.entries(outcomeStatus) as Array<
  [AgentFactRefreshOutcome, FactRefreshStatus]
>) {
  assert(
    factRefreshStatus(
      command({
        acknowledgedAt: "2026-10-26T05:00:03+00:00",
        outcome,
      }),
    ) === expected,
    `outcome=${outcome} 必须映射成 ${expected}`,
  );
  assert(
    factRefreshStatus(command({ outcome })) === expected,
    `outcome=${outcome} 在没 ack 时也必须有结果（终态优先）`,
  );
}

// 终态文案：throttled 要解释清楚「不是故障」。
assert(
  factRefreshStatusLabel("throttled").includes("60s"),
  "throttled 的文案必须说明「60s 内已采过」",
);
assert(
  factRefreshStatusLabel("unsupported").includes("不支持"),
  "unsupported 的文案必须指向版本问题",
);
assert(
  factRefreshStatusLabel("no_uplink").includes("上送"),
  "no_uplink 的文案必须指向数据面上送",
);

// 色调：只表达「要不要处理」。
assert(factRefreshTone("succeeded") === "ok", "已重采是 ok");
assert(factRefreshTone("failed") === "crit", "失败是 crit");
assert(factRefreshTone("throttled") === "warn", "节流是 warn");
assert(factRefreshTone("requested") === "pending", "等待认领是 pending");
assert(factRefreshTone("acked") === "pending", "重采中是 pending");
assert(factRefreshTone("superseded") === "muted", "被取代是 muted");
assert(factRefreshTone("idle") === "muted", "未请求是 muted");

// ── ⑤ 汇总：只数实际状态、按固定顺序、不把 idle 混进来 ────────────────────
const summary = summarizeFactRefresh([
  command(), // requested
  command(), // requested
  command({ acknowledgedAt: "2026-10-26T05:00:03+00:00" }), // acked
  command({ outcome: "succeeded" }),
  command({ outcome: "throttled" }),
  command({ outcome: "failed" }),
  null, // idle
]);
assert(summary.total === 7, "汇总总数应覆盖所有传入项");
assert(summary.counts.requested === 2, "等待认领计数不对");
assert(summary.counts.acked === 1, "重采中计数不对");
assert(summary.counts.succeeded === 1, "已重采计数不对");
assert(summary.counts.throttled === 1, "节流计数不对");
assert(summary.counts.failed === 1, "失败计数不对");
assert(summary.counts.idle === 1, "未请求也应计数（但展示时会过滤掉）");

const parts = factRefreshSummaryParts(summary);
assert(
  parts.map((part) => part.status).join(",") ===
    "requested,acked,succeeded,throttled,failed",
  `汇总条顺序不对：${parts.map((part) => part.status).join(",")}`,
);
assert(
  parts.every((part) => part.count > 0),
  "汇总条不能包含计数为 0 的状态",
);

const emptySummary = summarizeFactRefresh([]);
assert(
  factRefreshSummaryParts(emptySummary).length === 0,
  "没有命令时汇总条应为空",
);

// ── ⑥ 契约漂移必须显式失败 ────────────────────────────────────────────────
const driftCases: Array<[string, Record<string, unknown>]> = [
  ["缺少 agent_id", { ...commandPayload(), agent_id: undefined }],
  [
    "缺少 command_id",
    { ...commandPayload(), command_id: undefined },
  ],
  ["缺少 outcome", { ...commandPayload(), outcome: undefined }],
  [
    "outcome 是未知值",
    { ...commandPayload(), outcome: "something_new" },
  ],
  [
    "requested_at 类型不对",
    { ...commandPayload(), requested_at: 123 },
  ],
  [
    "detail 类型不对",
    { ...commandPayload(), detail: false },
  ],
  ["缺少 kind", { ...commandPayload(), kind: undefined }],
];

for (const [name, payload] of driftCases) {
  let threw = false;
  try {
    normalizeAgentFactRefresh(payload);
  } catch {
    threw = true;
  }
  assert(threw, `${name} 必须被拒绝（不能静默成空值）`);
}

// ── ⑦ 400 / 404 走统一的 ApiError（页面据此提示）────────────────────────────
responder = () =>
  new Response("agent not found", {
    status: 404,
    headers: { "content-type": "text/plain" },
  });
let rejected: unknown;
try {
  await requestAgentFactRefresh("agent-missing");
} catch (error) {
  rejected = error;
}
assert(
  rejected instanceof ApiError && rejected.status === 404,
  "未知 Agent 必须抛 ApiError(404)",
);
assert(
  rejected.detail === "agent not found",
  "纯文本错误正文必须落到 ApiError.detail",
);

console.log("fact refresh contract test passed");
