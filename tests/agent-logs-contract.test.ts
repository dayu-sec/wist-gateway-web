import {
  normalizeAgentLogs,
  setAdminApiToken,
  viewAgentLogs,
} from "../src/api/admin";

// 契约测试：管理面「采集日志」（`GET /api/v1/admin/logs`）。
//
// 这一页最容易漂移的五件事是：
//   1. 请求形状：`agent_id` / `family` 可选 + URI 编码、`limit` 可选且**原样透传**（后端夹到 1..1000）；
//   2. `raw` 是**原文**，可能含换行（多行日志在 NDJSON 里是一行）—— 不能被截断/改写；
//   3. `observed_at`（Agent 观测）与 `received_at`（网关写盘）是两个**不同**的时刻，不能混成一个；
//   4. `truncated` / `file` 必须能被表达出来（截断不能静默成「就这些」；文件路径要能露出来）；
//   5. `family` / `unit`（**采集面** / 采集单元）：请求侧面名**逐字透传**（闭集，大小写敏感）；
//      响应侧它们是字段本身（缺了就抛错），而**空串是一个值** ——「非派活来源」，不是缺字段。
//      为什么必须钉住：正文规则未就绪时 `category` 恒为泛化的 `agent.log`，
//      几张日志面一起跑时，只有 `family` 能分开它们。
//
// Usage: npm run test:agent-logs

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

interface Recorded {
  url: string;
  method: string;
  authorization: string;
}

let recorded: Recorded[] = [];
let responder: (url: string) => Response = () =>
  Response.json({
    logs: [],
    limit: 200,
    truncated: false,
    file: "/var/lib/wist/agent-logs.ndjson",
  });

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  const url = input.toString();
  recorded.push({
    url,
    method: (init?.method ?? "GET").toUpperCase(),
    authorization: headers.get("authorization") ?? "",
  });
  return responder(url);
};

setAdminApiToken("admin-token-under-test");

// --- 1. 请求形状 ------------------------------------------------------------
recorded = [];
await viewAgentLogs();
const [call] = recorded;
assert(
  recorded.length === 1,
  `agent logs must issue one request, got ${recorded.length}`,
);
assert(call.url === "/api/v1/admin/logs", `unexpected logs path: ${call.url}`);
assert(call.method === "GET", `agent logs must be GET, got ${call.method}`);
assert(
  call.authorization === "Bearer admin-token-under-test",
  "admin credential must be sent in the Authorization Header",
);

// agent_id 可选：省略时**不**带查询参数（不能拼出 `?agent_id=`）。
assert(
  !call.url.includes("?"),
  `empty query must not add a '?', got ${call.url}`,
);

// agent_id 必须编码：带 / 或空格的 id 不能改道到别的路由。
recorded = [];
await viewAgentLogs({ agentId: "agent/001 x" });
assert(
  recorded[0].url === "/api/v1/admin/logs?agent_id=agent%2F001+x",
  `agent_id must be URI-encoded, got ${recorded[0].url}`,
);

// limit 一律显式透传（后端夹到 1..1000，默认 200）；agent_id + limit 同时存在时都带上。
recorded = [];
await viewAgentLogs({ limit: 500 });
assert(
  recorded[0].url === "/api/v1/admin/logs?limit=500",
  `limit must be passed through verbatim, got ${recorded[0].url}`,
);
recorded = [];
await viewAgentLogs({ agentId: "agent-mbp-p0-collector", limit: 1000 });
assert(
  recorded[0].url ===
    "/api/v1/admin/logs?agent_id=agent-mbp-p0-collector&limit=1000",
  `agent_id + limit must both be present, got ${recorded[0].url}`,
);

// family（采集面）同理：面名是闭集值，必须**逐字**透传 —— 改写大小写就会筛不到任何东西。
recorded = [];
await viewAgentLogs({ family: "NetworkFirewall" });
assert(
  recorded[0].url === "/api/v1/admin/logs?family=NetworkFirewall",
  `family must be passed through verbatim, got ${recorded[0].url}`,
);
recorded = [];
await viewAgentLogs({
  agentId: "agent-host-1",
  family: "ServiceLifecycle",
  limit: 500,
});
assert(
  recorded[0].url ===
    "/api/v1/admin/logs?agent_id=agent-host-1&family=ServiceLifecycle&limit=500",
  `agent_id + family + limit must all be present, got ${recorded[0].url}`,
);

// --- 2. 空日志是一个合法状态（200），不是错误 -------------------------------
const empty = await viewAgentLogs();
assert(empty.logs.length === 0, "empty logs must keep an empty logs array");
assert(empty.limit === 200, "empty logs must keep the server limit");
assert(empty.truncated === false, "empty logs must keep truncated=false");
assert(
  empty.file === "/var/lib/wist/agent-logs.ndjson",
  "file must be normalized through",
);

// --- 3. 形状：原文保留换行；两个时间分开 -------------------------------------
const multiLineRaw = "REC-A start\n\tcontinuation A1\n\tcontinuation A2";
const payload = {
  logs: [
    {
      agent_id: "agent-mbp-p0-collector",
      family: "NetworkFirewall",
      unit: "mac-network-wifi",
      observed_at: "2026-09-23T12:24:27.734612Z",
      seq: 292,
      category: "agent.log",
      log_desc: "Agent 日志-原文",
      raw: multiLineRaw,
      received_at: "2026-09-23T12:24:28.001Z",
    },
  ],
  limit: 200,
  truncated: true,
  file: "/Users/zuowenjian/.wist-gateway/state/logs/agent-logs.ndjson",
};
const view = normalizeAgentLogs(payload);
const [record] = view.logs;
assert(record.agentId === "agent-mbp-p0-collector", "agent_id was not normalized");
assert(record.seq === 292, "seq was not normalized");
assert(record.category === "agent.log", "category was not normalized");
assert(record.logDesc === "Agent 日志-原文", "log_desc was not normalized");
assert(
  record.raw === multiLineRaw,
  "raw must be preserved verbatim (newlines included)",
);
assert(
  record.observedAt === "2026-09-23T12:24:27.734612Z" &&
    record.receivedAt === "2026-09-23T12:24:28.001Z",
  "observed_at / received_at must stay two distinct fields",
);
assert(
  record.receivedAt !== record.observedAt,
  "observed_at and received_at must not collapse into one timestamp",
);
assert(view.truncated === true, "truncated must be expressed, not swallowed");
assert(
  view.file === "/Users/zuowenjian/.wist-gateway/state/logs/agent-logs.ndjson",
  "file path must be passed through for the operator to tail/grep",
);

// --- 3b. 采集面（family / unit）：值透传，空串是「非派活来源」 ---------------------
assert(
  record.family === "NetworkFirewall" && record.unit === "mac-network-wifi",
  "family/unit must be passed through verbatim (closed-set names are case-sensitive)",
);
const withEmptyFamily = normalizeAgentLogs({
  logs: [
    {
      agent_id: "agent-host-1",
      family: "",
      unit: "",
      observed_at: "2026-09-24T04:02:51Z",
      seq: 991003,
      category: "agent.log",
      log_desc: "Agent 日志-原文",
      raw: "no family",
      received_at: "2026-09-24T04:02:52Z",
    },
  ],
  limit: 200,
  truncated: false,
  file: "/x",
});
assert(
  withEmptyFamily.logs[0].family === "" && withEmptyFamily.logs[0].unit === "",
  "an empty family is a VALUE (not platform-dispatched), not a missing field",
);

// --- 4. 缺字段 / 类型不符要抛错，不静默成空值 --------------------------------
function throws(fn: () => unknown, label: string): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, `${label} must throw instead of silently defaulting`);
}

// `logs` 键缺失（不是空数组）—— 与「暂时没有日志」是两回事。
throws(
  () => normalizeAgentLogs({ limit: 200, truncated: false, file: "/x" }),
  "missing logs array",
);
// 记录的 `observed_at` 缺失。
throws(
  () =>
    normalizeAgentLogs({
      logs: [
        {
          agent_id: "a",
          family: "ServiceLifecycle",
          unit: "mac-launchd-service",
          seq: 1,
          category: "agent.log",
          log_desc: "d",
          raw: "r",
          received_at: "2026-09-23T12:24:28Z",
        },
      ],
      limit: 200,
      truncated: false,
      file: "/x",
    }),
  "missing observed_at",
);
// `family` 键缺失（老网关的响应）—— 不能默认成空串：「空串 = 非派活来源」是一个值，
// 与「构件根本不产这个字段」是两回事，后者说明对面不是当前契约。
throws(
  () =>
    normalizeAgentLogs({
      logs: [
        {
          agent_id: "a",
          unit: "mac-launchd-service",
          observed_at: "2026-09-23T12:24:27Z",
          seq: 1,
          category: "agent.log",
          log_desc: "d",
          raw: "r",
          received_at: "2026-09-23T12:24:28Z",
        },
      ],
      limit: 200,
      truncated: false,
      file: "/x",
    }),
  "missing family",
);
// `truncated` 类型不符（字符串）—— 不能被当成真值。
throws(
  () => normalizeAgentLogs({ logs: [], limit: 200, truncated: "false", file: "/x" }),
  "non-boolean truncated",
);
// `seq` 类型不符（字符串）。
throws(
  () =>
    normalizeAgentLogs({
      logs: [
        {
          agent_id: "a",
          family: "ServiceLifecycle",
          unit: "mac-launchd-service",
          observed_at: "2026-09-23T12:24:27Z",
          seq: "292",
          category: "agent.log",
          log_desc: "d",
          raw: "r",
          received_at: "2026-09-23T12:24:28Z",
        },
      ],
      limit: 200,
      truncated: false,
      file: "/x",
    }),
  "non-number seq",
);

console.log("agent logs contract ok");
