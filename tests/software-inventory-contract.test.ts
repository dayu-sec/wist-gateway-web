import {
  ApiError,
  fetchAgentSoftwareInventory,
  fetchSoftwareFleetInventory,
  normalizeAgentSoftwareInventory,
  normalizeSoftwareFleetInventory,
  setAdminApiToken,
} from "../src/api/admin";
import {
  buildAgentLedger,
  groupHoldersByAgent,
  groupSoftwareEntries,
  isUnknownAgentError,
  ledgerEntryFor,
  truncationNotice,
} from "../src/components/softwareInventory";

// 契约测试：管理面「L1a 机械资产清单」（模型 `ViewAgentSoftware` / `ViewSoftwareHoldings`）。
//
// 这一层刻意只做归并、不做识别，于是最容易漂移的四件事是：
//   1. 请求形状：两个路径 + Bearer token + agent_id 编码 / limit 查询参数；
//   2. `paths` / `apps` 是**行数**，不是「软件个数」：前端必须原样透出后端算好的计数，
//      不能按 `entries` 重算（重算会把口径分歧盖掉，而页面正是靠这两个数讲清语义）；
//   3. `truncated` 必须能被表达出来（截断不能静默成「就这些」）；
//   4. 404「未知 Agent」与 200 + 空清单是两个状态，不能被压成同一个空态；
//   5. 同一个 `software_key` 的多条路径要聚成一组；`holders` 的行数不等于机器数
//      （同一台机器在同一个 `.app` 下跑几个可执行文件就是几行）——
//      所以页面用 `agent_count` 说「几台机器」，用折叠后的条数说「几条路径」。
//
// Usage: npm run test:software-inventory

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

interface Recorded {
  url: string;
  method: string;
  authorization: string;
}

let recorded: Recorded[] = [];
// 两个端点都叫 `.../software`，所以按路径前缀区分响应形状（否则会把明细形状
// 喂给机队解析器，测出来的「抛错」跟契约无关）。
let responder: (url: string) => Response = (url) =>
  url.startsWith("/api/v1/admin/software")
    ? Response.json({ truncated: false, software: [] })
    : Response.json({ agent_id: "agent-001", paths: 0, apps: 0, entries: [] });

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
const emptyInventory = await fetchAgentSoftwareInventory("agent-001");
const [call] = recorded;
assert(
  recorded.length === 1,
  `agent software must issue one request, got ${recorded.length}`,
);
assert(
  call.url === "/api/v1/admin/agents/agent-001/software",
  `unexpected agent software path: ${call.url}`,
);
assert(call.method === "GET", `agent software must be GET, got ${call.method}`);
assert(
  call.authorization === "Bearer admin-token-under-test",
  "admin credential must be sent in the Authorization Header",
);

// agent_id 必须编码：带 / 或空格的 id 不能改道到别的路由。
recorded = [];
await fetchAgentSoftwareInventory("agent/001 x");
assert(
  recorded[0].url === "/api/v1/admin/agents/agent%2F001%20x/software",
  `agent_id must be URI-encoded, got ${recorded[0].url}`,
);

// 「按软件看机器」：limit 一律显式带上（后端夹到 1..500，默认 100）。
recorded = [];
await fetchSoftwareFleetInventory();
assert(
  recorded[0].url === "/api/v1/admin/software?limit=100",
  `fleet must default to limit=100, got ${recorded[0].url}`,
);
recorded = [];
await fetchSoftwareFleetInventory(500);
assert(
  recorded[0].url === "/api/v1/admin/software?limit=500",
  `fleet limit must be passed through verbatim, got ${recorded[0].url}`,
);

// --- 2. 空清单是一个合法状态（200），不是错误 -------------------------------
assert(emptyInventory.agentId === "agent-001", "agent_id was not normalized");
assert(emptyInventory.paths === 0, "empty inventory must keep paths 0");
assert(emptyInventory.apps === 0, "empty inventory must keep apps 0");
assert(
  emptyInventory.entries.length === 0,
  "empty inventory must keep an empty entries array",
);

// --- 3. 明细形状：同键多行不在这里聚合（分组是页面的口径） --------------------
const agentPayload = {
  agent_id: "agent-host-20affeee1df3",
  paths: 629,
  apps: 85,
  entries: [
    {
      software_key: "/Applications/Firefox.app",
      name: "Firefox",
      kind: "app",
      matched_rule: "macos-app-bundle",
      path: "/Applications/Firefox.app/Contents/MacOS/firefox",
    },
    {
      software_key: "/Applications/Firefox.app",
      name: "Firefox",
      kind: "app",
      matched_rule: "macos-app-bundle",
      path: "/Applications/Firefox.app/Contents/MacOS/plugin-container",
    },
    {
      software_key: "/usr/bin/true",
      name: "true",
      kind: "binary",
      matched_rule: "unix-path",
      path: "/usr/bin/true",
    },
  ],
};
const inventory = normalizeAgentSoftwareInventory(agentPayload);
// 计数原样透出：**不**按 entries 重算（真实响应里 629 行不可能全在测试里）。
assert(
  inventory.paths === 629 && inventory.apps === 85,
  "backend-computed paths/apps must be passed through, not recomputed from entries",
);
assert(
  inventory.entries.length === 3,
  `entries must not be pre-aggregated at the API layer, got ${inventory.entries.length}`,
);
assert(
  inventory.entries[0].softwareKey === "/Applications/Firefox.app" &&
    inventory.entries[0].name === "Firefox" &&
    inventory.entries[0].kind === "app" &&
    inventory.entries[0].matchedRule === "macos-app-bundle" &&
    inventory.entries[0].path ===
      "/Applications/Firefox.app/Contents/MacOS/firefox",
  "entry must be normalized field by field",
);
// 条目里**没有**版本 / vendor 字段：这一层只归并不识别，多出来的键也不该被凭空补上。
assert(
  !Object.prototype.hasOwnProperty.call(inventory.entries[0], "version"),
  "the L1a inventory has no version field to synthesize",
);

// --- 4. 分组算法：同一个 software_key 的多条 path 聚成一组 -------------------
const groups = groupSoftwareEntries(inventory.entries);
assert(groups.length === 2, `two keys must fold into two groups, got ${groups.length}`);
assert(
  groups[0].softwareKey === "/Applications/Firefox.app" &&
    groups[0].name === "Firefox" &&
    groups[0].kind === "app",
  "the app group must come first (backend sorts by kind)",
);
assert(
  groups[0].pathCount === 2 && groups[0].paths.length === 2,
  `the .app group must hold both paths, got ${groups[0].pathCount}`,
);
assert(
  groups[0].matchedRules.length === 1 &&
    groups[0].matchedRules[0] === "macos-app-bundle",
  "matched rules must be de-duplicated inside a group",
);
assert(
  groups[1].softwareKey === "/usr/bin/true" &&
    groups[1].kind === "binary" &&
    groups[1].pathCount === 1,
  "the binary entry must stay its own single-path group",
);
assert(
  groups.length !== inventory.paths,
  "group count and path count must stay distinguishable (行数 ≠ 组数)",
);

// 交错出现的同键仍要归到一组：分组不能依赖「同键相邻」这个前提。
const interleaved = groupSoftwareEntries([
  { softwareKey: "k", name: "n", kind: "binary", matchedRule: "r", path: "p1" },
  { softwareKey: "other", name: "o", kind: "binary", matchedRule: "r", path: "p2" },
  { softwareKey: "k", name: "n", kind: "binary", matchedRule: "r", path: "p3" },
]);
assert(
  interleaved.length === 2 && interleaved[0].paths.join(",") === "p1,p3",
  "non-adjacent rows of one key must still fold into a single group",
);

// --- 5. 持有机器：holders 行数 ≠ agent_count -------------------------------
const fleetPayload = {
  truncated: false,
  software: [
    {
      software_key: "/Applications/Firefox.app",
      name: "Firefox",
      kind: "app",
      agent_count: 1,
      holders: [
        {
          agent_id: "agent-host-20affeee1df3",
          path: "/Applications/Firefox.app/Contents/MacOS/firefox",
        },
        {
          agent_id: "agent-host-20affeee1df3",
          path: "/Applications/Firefox.app/Contents/MacOS/plugin-container",
        },
      ],
    },
    {
      software_key: "/usr/bin/true",
      name: "true",
      kind: "binary",
      agent_count: 2,
      holders: [
        { agent_id: "agent-host-a", path: "/usr/bin/true" },
        { agent_id: "agent-host-b", path: "/usr/bin/true" },
      ],
    },
  ],
};
const fleet = normalizeSoftwareFleetInventory(fleetPayload);
assert(fleet.truncated === false, "truncated must be normalized");
assert(fleet.software.length === 2, "software keys must all be normalized");
assert(
  fleet.software[0].agentCount === 1 && fleet.software[0].holders.length === 2,
  "agent_count (machines) and holders (rows) are different quantities",
);
const holders = groupHoldersByAgent(fleet.software[0].holders);
assert(
  holders.length === 1 &&
    holders[0].agentId === "agent-host-20affeee1df3" &&
    holders[0].paths.length === 2,
  "two paths from one machine must fold into one holder group",
);
assert(
  holders.length === fleet.software[0].agentCount,
  "folded holder groups must agree with the backend agent_count",
);

// --- 6. truncated 的表达：必须能说出「这不是全量」 -------------------------
const truncated = normalizeSoftwareFleetInventory({
  ...fleetPayload,
  truncated: true,
});
assert(truncated.truncated === true, "truncated=true must survive normalization");
const notice = truncationNotice({
  truncated: truncated.truncated,
  returned: truncated.software.length,
  limit: 100,
});
assert(notice !== null, "truncated=true must produce a visible notice");
assert(
  /截断/.test(notice ?? "") && /上限 100/.test(notice ?? ""),
  `the notice must say it is truncated and name the limit, got: ${notice}`,
);
// 反向约束：没截断时不许出现任何「还有更多」的暗示。
assert(
  truncationNotice({ truncated: false, returned: 2, limit: 100 }) === null,
  "truncated=false must stay silent",
);

// --- 7. 契约漂移必须抛错，不静默成空值 -------------------------------------
const driftCases: [string, () => unknown][] = [
  ["missing agent_id", () => normalizeAgentSoftwareInventory({ paths: 0, apps: 0, entries: [] })],
  ["missing paths", () => normalizeAgentSoftwareInventory({ agent_id: "a", apps: 0, entries: [] })],
  ["missing apps", () => normalizeAgentSoftwareInventory({ agent_id: "a", paths: 0, entries: [] })],
  ["missing entries", () => normalizeAgentSoftwareInventory({ agent_id: "a", paths: 0, apps: 0 })],
  ["entries is not an array", () => normalizeAgentSoftwareInventory({ agent_id: "a", paths: 0, apps: 0, entries: null })],
  [
    "missing matched_rule",
    () =>
      normalizeAgentSoftwareInventory({
        agent_id: "a",
        paths: 1,
        apps: 0,
        entries: [{ software_key: "k", name: "n", kind: "binary", path: "p" }],
      }),
  ],
  [
    "unknown kind",
    () =>
      normalizeAgentSoftwareInventory({
        agent_id: "a",
        paths: 1,
        apps: 0,
        entries: [
          { software_key: "k", name: "n", kind: "script", matched_rule: "r", path: "p" },
        ],
      }),
  ],
  ["missing truncated", () => normalizeSoftwareFleetInventory({ software: [] })],
  ["missing software", () => normalizeSoftwareFleetInventory({ truncated: false })],
  [
    "missing holders",
    () =>
      normalizeSoftwareFleetInventory({
        truncated: false,
        software: [
          { software_key: "k", name: "n", kind: "app", agent_count: 0 },
        ],
      }),
  ],
  [
    "missing agent_count",
    () =>
      normalizeSoftwareFleetInventory({
        truncated: false,
        software: [
          { software_key: "k", name: "n", kind: "app", holders: [] },
        ],
      }),
  ],
  [
    "holder missing agent_id",
    () =>
      normalizeSoftwareFleetInventory({
        truncated: false,
        software: [
          {
            software_key: "k",
            name: "n",
            kind: "app",
            agent_count: 1,
            holders: [{ path: "p" }],
          },
        ],
      }),
  ],
];
for (const [label, run] of driftCases) {
  let threw = false;
  try {
    run();
  } catch {
    threw = true;
  }
  assert(threw, `contract drift must throw: ${label}`);
}

// 反向约束：`entries: []` / `holders: []` 是合法空态，绝不能因此抛错。
const emptyHolders = normalizeSoftwareFleetInventory({
  truncated: false,
  software: [
    { software_key: "k", name: "n", kind: "binary", agent_count: 0, holders: [] },
  ],
});
assert(
  emptyHolders.software[0].holders.length === 0 &&
    emptyHolders.software[0].agentCount === 0,
  "an empty holders array is a valid state and must not throw",
);

// --- 8. 404「未知 Agent」与「空清单」必须被区分 ------------------------------
responder = () => new Response("unknown agent agent-404", { status: 404 });
let notFound: unknown;
try {
  await fetchAgentSoftwareInventory("agent-404");
} catch (error) {
  notFound = error;
}
assert(notFound instanceof ApiError, "404 must surface as ApiError");
assert((notFound as ApiError).status === 404, "404 status must be preserved");
assert(
  isUnknownAgentError(notFound),
  "the 404 body must carry the unknown-agent marker the page keys on",
);
// 空清单走的是 200：它不能被当成「未知 Agent」，也不能被当成错误。
assert(
  !isUnknownAgentError(null) && !isUnknownAgentError(emptyInventory),
  "an empty inventory is not an unknown-agent error",
);
// 网关没有这个路由（旧构建）也是 404，但正文为空 —— 处置完全不同，不能混为一谈。
assert(
  !isUnknownAgentError(new ApiError(404, "/api/v1/admin/software")),
  "a 404 without the unknown-agent marker is a different failure",
);

// --- 9. holders 的 agent_id → 台账（主机名 / 状态） --------------------------
const ledger = buildAgentLedger({
  metrics: {
    totalAgents: 4,
    onlineAgents: 2,
    unhealthyAgents: 1,
    lastSeenLagSeconds: 3,
  },
  recentOnlineAgents: [
    {
      agentId: "agent-host-online",
      instanceId: "i-1",
      version: "1.0.0",
      registeredAt: "t",
      onlineSince: "t",
      onlineDurationSeconds: 10,
      source: "real",
    },
    {
      agentId: "agent-host-example",
      instanceId: "i-2",
      version: "1.0.0",
      registeredAt: "t",
      onlineSince: "t",
      onlineDurationSeconds: 10,
      source: "example",
    },
  ],
  abnormalAgents: [
    {
      agentId: "agent-host-offline",
      instanceId: "i-3",
      version: "1.0.0",
      status: "offline",
      health: "unhealthy",
      lastSeenAt: "t",
    },
    {
      agentId: "agent-host-online",
      instanceId: "i-1",
      version: "1.0.0",
      status: "online",
      health: "degraded",
      lastSeenAt: "t",
    },
  ],
});
assert(
  ledgerEntryFor(ledger, "agent-host-online").status === "abnormal",
  "an agent in the abnormal list must not be reported as merely online",
);
assert(
  ledgerEntryFor(ledger, "agent-host-offline").status === "offline",
  "offline must be distinguished from degraded/unhealthy",
);
assert(
  ledgerEntryFor(ledger, "agent-host-example").status === "example",
  "example-data agents must be flagged as such",
);
// 映射不到的机器显示 agent_id 原文，绝不留空白。
const missing = ledgerEntryFor(ledger, "agent-host-not-in-overview");
assert(
  missing.status === "unknown" && missing.agentId === "agent-host-not-in-overview",
  "an unmapped holder must keep its raw agent_id",
);
assert(
  ledgerEntryFor(buildAgentLedger(undefined), "agent-host-x").agentId ===
    "agent-host-x",
  "no overview yet must still render the raw agent_id",
);

// 401 同样不能被吞掉：空清单与「没带 token」是两回事。
responder = () => new Response("unauthorized", { status: 401 });
let unauthorized: unknown;
try {
  await fetchSoftwareFleetInventory();
} catch (error) {
  unauthorized = error;
}
assert(unauthorized instanceof ApiError, "401 must surface as ApiError");
assert((unauthorized as ApiError).status === 401, "401 status must be preserved");

console.log(
  "software inventory contract ok: 2 request shapes + row/group counts kept apart + truncation expressed + 404 vs empty distinguished + holders folded by agent",
);
