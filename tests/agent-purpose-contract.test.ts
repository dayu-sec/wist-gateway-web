import {
  ApiError,
  fetchAgentPurpose,
  normalizeAgentPurposeView,
  setAdminApiToken,
} from "../src/api/admin";
import {
  CONFIDENCE_HINT,
  CONFIDENCE_LABEL,
  confidenceTone,
} from "../src/components/agentPurposeConfidence";

// 契约测试：管理面「Agent 用途」视图（模型 `AdminViewAgentPurpose` / `AgentPurposeView`）。
//
// 后端 admin_ops.rs 直接 `Json(AgentPurposeResponse)` 返回**扁平** snake_case 载荷，
// 且三个并列分项（fact_summary / suggestion / classification）可各自为 null。
// 这里锁住四件最容易漂移的事：
//   1. 请求形状：GET /api/v1/admin/agents/{agent_id}/purpose + Bearer token + agent_id 编码；
//   2. 三种数据状态必须能被区分：都为 null / 只有事实 / 事实 + 建议；
//   3. 依据逐条保留（rule_id / kind / value / weight，含**负权重**反向证据）与 confidence 原值；
//   4. 404 仍是 404（抛 ApiError），不静默成空视图 —— 页面靠它区分「未知 Agent」；
//   5. confidence 0 的两种含义（并列 / 无依据）必须能区分，且 nullable 分项「键缺失」抛错；
//   6. 发现方向的展示字段（host_id / host_name / network_addresses）如实转到视图模型，
//      空值（旧版 agentd 不带这些字段）不是缺键。
//
// Usage: npm run test:agent-purpose

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

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
    fact_summary: null,
    suggestion: null,
    classification: null,
    generated_at: "2026-09-22T00:00:02Z",
  });

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

// --- 1. 请求形状 ------------------------------------------------------------
recorded = [];
const emptyView = await fetchAgentPurpose("agent-001");
const [call] = recorded;
assert(recorded.length === 1, `purpose view must issue one request, got ${recorded.length}`);
assert(
  call.url === "/api/v1/admin/agents/agent-001/purpose",
  `unexpected purpose path: ${call.url}`,
);
assert(call.method === "GET", `purpose view must be GET, got ${call.method}`);
assert(
  call.authorization === "Bearer admin-token-under-test",
  "admin credential must be sent in the Authorization Header",
);
assert(call.body === "", "purpose view must not send a body");

// agent_id 必须编码：带 / 或空格的 id 不能改道到别的路由。
recorded = [];
await fetchAgentPurpose("agent/001 x");
assert(
  recorded[0].url === "/api/v1/admin/agents/agent%2F001%20x/purpose",
  `agent_id must be URI-encoded, got ${recorded[0].url}`,
);

// --- 2. 状态一：事实与建议都为空（尚未上报事实） -----------------------------
assert(emptyView.agentId === "agent-001", "agent_id was not normalized");
assert(emptyView.factSummary === null, "null fact_summary must stay null");
assert(emptyView.suggestion === null, "null suggestion must stay null");
assert(emptyView.classification === null, "null classification must stay null");
assert(
  emptyView.generatedAt === "2026-09-22T00:00:02Z",
  "generated_at was not normalized",
);

// --- 3. 状态二：有事实、无建议 ----------------------------------------------
const factOnly = normalizeAgentPurposeView({
  agent_id: "agent-001",
  fact_summary: {
    agent_id: "agent-001",
    content_digest: "sha256:abc",
    revision: 7,
    observed_at: "2026-09-22T00:00:00Z",
    os: "macos",
    arch: "arm64",
    process_count: 906,
    process_executables: ["/usr/bin/xcodebuild", "/opt/homebrew/bin/brew"],
    packages: [],
    listen_ports: ["5432"],
    // 发现方向的展示字段（留痕）：校验它们到得了视图模型，且不改动其它字段。
    host_id: "machine-id-abc123",
    host_name: "macbook-pro",
    network_addresses: ["en0 192.168.1.5/24", "utun3 10.8.0.2/32"],
    received_at: "2026-09-22T00:00:01Z",
  },
  suggestion: null,
  classification: null,
  generated_at: "2026-09-22T00:00:02Z",
});
assert(factOnly.suggestion === null, "fact without suggestion must stay suggestion-free");
const fact = factOnly.factSummary;
assert(fact !== null, "fact_summary was dropped");
assert(fact!.agentId === "agent-001", "fact_summary agent_id was not normalized");
assert(fact!.contentDigest === "sha256:abc", "content_digest was not normalized");
assert(fact!.revision === 7, "revision was not normalized");
assert(fact!.observedAt === "2026-09-22T00:00:00Z", "observed_at was not normalized");
assert(fact!.receivedAt === "2026-09-22T00:00:01Z", "received_at was not normalized");
assert(fact!.os === "macos", "os was not normalized");
assert(fact!.arch === "arm64", "arch was not normalized");
assert(fact!.processCount === 906, "process_count was not normalized");
assert(
  fact!.processExecutables.length === 2 &&
    fact!.processExecutables[0] === "/usr/bin/xcodebuild",
  "process_executables were not normalized",
);
assert(
  Array.isArray(fact!.packages) && fact!.packages.length === 0,
  "empty packages list must stay an empty list (not null/undefined)",
);
assert(
  fact!.listenPorts.length === 1 && fact!.listenPorts[0] === "5432",
  "listen_ports were not normalized",
);
assert(
  fact!.hostId === "machine-id-abc123" && fact!.hostName === "macbook-pro",
  "host_id / host_name were not normalized",
);
assert(
  fact!.networkAddresses.length === 2 &&
    fact!.networkAddresses[1] === "utun3 10.8.0.2/32",
  "network_addresses were not normalized",
);

// --- 3b. 旧版 agentd：不提这三个字段，网关落空值 ----------------------------
// 网关侧三列是 NOT NULL DEFAULT（'' / '[]'），所以「没上报」是以**空值而不是缺键**
// 到达页面的。空值必须原样留下（不是 null/undefined）：组件靠它决定显示 EMPTY（"—"）。
const legacyAgent = normalizeAgentPurposeView({
  agent_id: "agent-legacy",
  fact_summary: {
    agent_id: "agent-legacy",
    content_digest: "sha256:legacy",
    revision: 1,
    observed_at: "2026-09-22T00:00:00Z",
    os: "macos",
    arch: "arm64",
    process_count: 3,
    process_executables: ["launchd"],
    packages: [],
    listen_ports: [],
    host_id: "",
    host_name: "",
    network_addresses: [],
    received_at: "2026-09-22T00:00:01Z",
  },
  suggestion: null,
  classification: null,
  generated_at: "2026-09-22T00:00:02Z",
});
assert(
  legacyAgent.factSummary!.hostId === "" &&
    legacyAgent.factSummary!.hostName === "",
  "an old agent's empty host fields must stay empty strings, not null/undefined",
);
assert(
  Array.isArray(legacyAgent.factSummary!.networkAddresses) &&
    legacyAgent.factSummary!.networkAddresses.length === 0,
  "an old agent's empty network list must stay an empty list (not null/undefined)",
);

// --- 4. 状态三：事实 + 建议（依据逐条保留） ---------------------------------
const both = normalizeAgentPurposeView({
  agent_id: "agent-001",
  fact_summary: {
    agent_id: "agent-001",
    content_digest: "sha256:abc",
    revision: 7,
    observed_at: "2026-09-22T00:00:00Z",
    os: "macos",
    arch: "arm64",
    process_count: 906,
    process_executables: ["/usr/bin/xcodebuild"],
    packages: [],
    listen_ports: ["5432"],
    host_id: "machine-id-abc123",
    host_name: "macbook-pro",
    network_addresses: ["en0 192.168.1.5/24"],
    received_at: "2026-09-22T00:00:01Z",
  },
  suggestion: {
    agent_id: "agent-001",
    suggestion_id: "sug_xxx",
    suggested_class: "MacDev",
    confidence: 100,
    method: "rule",
    rule_set_id: "macos-v1",
    signals: [
      {
        rule_id: "mac-dev-xcodebuild",
        kind: "process",
        value: "/usr/bin/xcodebuild",
        weight: 40,
      },
      // 反向证据：负权重必须原样保留（页面按「削弱该类别」呈现）。
      {
        rule_id: "mac-dev-not-server",
        kind: "listen_port",
        value: "5432",
        weight: -10,
      },
    ],
    observed_at: "2026-09-22T00:00:00Z",
    computed_at: "2026-09-22T00:00:02Z",
  },
  classification: null,
  generated_at: "2026-09-22T00:00:02Z",
});
const suggestion = both.suggestion;
assert(suggestion !== null, "suggestion was dropped");
assert(suggestion!.suggestionId === "sug_xxx", "suggestion_id was not normalized");
assert(suggestion!.suggestedClass === "MacDev", "suggested_class was not normalized");
assert(suggestion!.confidence === 100, "confidence was not normalized");
assert(suggestion!.method === "rule", "method was not normalized");
assert(suggestion!.ruleSetId === "macos-v1", "rule_set_id was not normalized");
assert(suggestion!.signals.length === 2, "signals were not preserved");
assert(
  suggestion!.signals[0].ruleId === "mac-dev-xcodebuild" &&
    suggestion!.signals[0].kind === "process" &&
    suggestion!.signals[0].value === "/usr/bin/xcodebuild" &&
    suggestion!.signals[0].weight === 40,
  "the first signal basis was not normalized",
);
assert(
  suggestion!.signals[1].weight === -10,
  "negative (contrary-evidence) weight must be preserved verbatim",
);
assert(
  suggestion!.computedAt === "2026-09-22T00:00:02Z" &&
    suggestion!.observedAt === "2026-09-22T00:00:00Z",
  "suggestion observed_at / computed_at were not normalized",
);

// confidence 0 不是「只有基线兜底」这一种情况：最高分与次高分**并列**时
// `100 × (s1 − s2) / s1 = 0`，而 signals 非空（下面面板正列着这些依据）。
// 所以 0 时必须再看有没有逐条依据，不能一律当「无有效依据」。
const baseline = normalizeAgentPurposeView({
  agent_id: "agent-002",
  fact_summary: null,
  suggestion: {
    agent_id: "agent-002",
    suggestion_id: "sug_baseline",
    suggested_class: "MacDaily",
    confidence: 0,
    method: "rule",
    rule_set_id: "macos-v1",
    signals: [],
    observed_at: "2026-09-22T00:00:00Z",
    computed_at: "2026-09-22T00:00:02Z",
  },
  classification: null,
  generated_at: "2026-09-22T00:00:02Z",
});
assert(
  baseline.suggestion!.confidence === 0 && baseline.suggestion!.signals.length === 0,
  "baseline suggestion (confidence 0, no signals) must survive normalization",
);

// 并列（confidence 0 但 signals 非空）：归一化必须把依据逐条保留下来，
// 否则组件就再也分不清「并列」与「无依据」——正是本条修的那个 bug。
const tie = normalizeAgentPurposeView({
  agent_id: "agent-004",
  fact_summary: null,
  suggestion: {
    agent_id: "agent-004",
    suggestion_id: "sug_tie",
    suggested_class: "MacDev",
    confidence: 0,
    method: "rule",
    rule_set_id: "macos-v1",
    signals: [
      {
        rule_id: "mac-dev-safari",
        kind: "process_path",
        value: "/Applications/Safari.app",
        weight: 10,
      },
      {
        rule_id: "mac-dev-node-modules",
        kind: "process_path",
        value: "/srv/app/node_modules",
        weight: 10,
      },
    ],
    observed_at: "2026-09-22T00:00:00Z",
    computed_at: "2026-09-22T00:00:02Z",
  },
  classification: null,
  generated_at: "2026-09-22T00:00:02Z",
});
assert(
  tie.suggestion!.confidence === 0 && tie.suggestion!.signals.length === 2,
  "tied suggestion (confidence 0 with signals) must keep all signals",
);

// 分档本身：confidence 0 时用「有无逐条依据」区分并列与兜底。
assert(
  confidenceTone(0, baseline.suggestion!.signals.length) === "baseline",
  "0 with no signals must be the baseline tone",
);
assert(
  confidenceTone(0, tie.suggestion!.signals.length) === "tie",
  "0 with signals must be the tie tone, not the baseline tone",
);
assert(
  confidenceTone(0, 0) !== confidenceTone(0, 3),
  "tie and baseline must be distinguishable tones",
);
assert(
  CONFIDENCE_LABEL[confidenceTone(0, 3)] !==
    CONFIDENCE_LABEL[confidenceTone(0, 0)] &&
    CONFIDENCE_HINT[confidenceTone(0, 3)] !== CONFIDENCE_HINT[confidenceTone(0, 0)],
  "tie and baseline need different labels and hints",
);
// confidence 完全没被压成一档：正常数值仍旧分弱/中/强。
assert(
  confidenceTone(30, 1) === "weak" &&
    confidenceTone(60, 1) === "fair" &&
    confidenceTone(100, 1) === "strong",
  "non-zero confidence bands must keep working",
);

// 人工判定按模型如实解析（写入端点落地后页面无需改结构）。
const decided = normalizeAgentPurposeView({
  agent_id: "agent-003",
  fact_summary: null,
  suggestion: null,
  classification: {
    agent_id: "agent-003",
    machine_class: "LinuxData",
    suggestion_id: null,
    decided_by: "admin@example.com",
    decided_at: "2026-09-22T00:00:00Z",
    note: null,
  },
  generated_at: "2026-09-22T00:00:02Z",
});
assert(
  decided.classification!.machineClass === "LinuxData" &&
    decided.classification!.suggestionId === null &&
    decided.classification!.note === null,
  "classification must be normalized with its null fields intact",
);

// --- 5. 契约漂移必须抛错，不静默成空值 --------------------------------------
const driftCases: [string, unknown][] = [
  ["missing agent_id", { suggestion: null, generated_at: "t" }],
  ["missing generated_at", { agent_id: "a", suggestion: null }],
  [
    "missing signals",
    {
      agent_id: "a",
      suggestion: {
        agent_id: "a",
        suggestion_id: "s",
        suggested_class: "MacDev",
        confidence: 1,
        method: "rule",
        rule_set_id: null,
        observed_at: "t",
        computed_at: "t",
      },
      generated_at: "t",
    },
  ],
  // 三个并列分项整键缺失：不能当成「都为 null」的空视图静默渲染。
  [
    "missing fact_summary/suggestion/classification keys",
    { agent_id: "a", generated_at: "t" },
  ],
  // nullable 字段也要求键存在（改名/删键是契约漂移，不是「未设置」）。
  [
    "missing rule_set_id",
    {
      agent_id: "a",
      fact_summary: null,
      suggestion: {
        agent_id: "a",
        suggestion_id: "s",
        suggested_class: "MacDev",
        confidence: 0,
        method: "rule",
        signals: [],
        observed_at: "t",
        computed_at: "t",
      },
      classification: null,
      generated_at: "t",
    },
  ],
  [
    "missing classification suggestion_id",
    {
      agent_id: "a",
      fact_summary: null,
      suggestion: null,
      classification: {
        agent_id: "a",
        machine_class: "LinuxData",
        decided_by: "admin@example.com",
        decided_at: "t",
        note: null,
      },
      generated_at: "t",
    },
  ],
  [
    "unknown machine class",
    {
      agent_id: "a",
      suggestion: {
        agent_id: "a",
        suggestion_id: "s",
        suggested_class: "WindowsGame",
        confidence: 1,
        method: "rule",
        rule_set_id: null,
        signals: [],
        observed_at: "t",
        computed_at: "t",
      },
      generated_at: "t",
    },
  ],
  ["fact_summary is not an object", { agent_id: "a", fact_summary: "none", generated_at: "t" }],
  // 展示字段缺键 ≠ 旧版 agentd：网关侧三列是 NOT NULL DEFAULT，旧 agent 到页面是**空值**
  // （见 §3b）。真的少了键只能是两侧版本对不上，按契约漂移抛错。
  [
    "missing host_id",
    {
      agent_id: "a",
      fact_summary: {
        agent_id: "a",
        content_digest: "sha256:abc",
        revision: 1,
        observed_at: "t",
        os: "macos",
        arch: "arm64",
        process_count: 0,
        process_executables: [],
        packages: [],
        listen_ports: [],
        host_name: "",
        network_addresses: [],
        received_at: "t",
      },
      suggestion: null,
      classification: null,
      generated_at: "t",
    },
  ],
];
for (const [label, payload] of driftCases) {
  let threw = false;
  try {
    normalizeAgentPurposeView(payload);
  } catch {
    threw = true;
  }
  assert(threw, `contract drift must throw: ${label}`);
}

// 反向约束：三个分项**显式为 null** 是合法空态，绝不能因此抛错。
const allNullView = normalizeAgentPurposeView({
  agent_id: "a",
  fact_summary: null,
  suggestion: null,
  classification: null,
  generated_at: "t",
});
assert(
  allNullView.factSummary === null &&
    allNullView.suggestion === null &&
    allNullView.classification === null,
  "explicit null sub-items are a valid empty view and must not throw",
);

// --- 6. 未知 Agent：404 不能被静默成空视图 ---------------------------------
responder = () => new Response("unknown agent agent-404", { status: 404 });
let notFound: unknown;
try {
  await fetchAgentPurpose("agent-404");
} catch (error) {
  notFound = error;
}
assert(notFound instanceof ApiError, "404 must surface as ApiError");
assert((notFound as ApiError).status === 404, "404 status must be preserved");
assert(
  /unknown agent/i.test((notFound as ApiError).detail ?? ""),
  "404 detail must carry the unknown-agent marker the page keys on",
);

// 401 同样不能被吞掉：空视图与「没带 token」是两回事。
responder = () => new Response("unauthorized", { status: 401 });
let unauthorized: unknown;
try {
  await fetchAgentPurpose("agent-001");
} catch (error) {
  unauthorized = error;
}
assert(unauthorized instanceof ApiError, "401 must surface as ApiError");
assert((unauthorized as ApiError).status === 401, "401 status must be preserved");

console.log(
  "agent purpose contract ok: 3 data states + baseline/tie split + display fields + drift throws + 404 distinguished",
);
