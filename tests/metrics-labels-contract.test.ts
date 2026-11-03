import { strict as assert } from "node:assert";
import {
  ApiError,
  clearAgentMetricsLabels,
  fetchAgentMetricsLabels,
  isRateLimitedError,
  normalizeAgentMetricsLabels,
  setAdminApiToken,
  setAgentMetricsLabels,
} from "../src/api/admin";

/**
 * 契约测试：管理面「指标选择类 label」（`AdminMetricsLabelsView`）。
 *
 * 后端 `metrics_labels.rs` 直接把 `AgentMetricsLabelsView` 序列化成扁平 snake_case，
 * 三个 map 可为空对象、`updated_at` 在从未写过覆盖时是空串。这里锁住最容易漂移的事：
 *   1. 请求形状：路径 + 编码、Bearer、方法、PUT 报文（api_version / kind / overrides）；
 *   2. `null` 能原样出现在 overrides 里（它是「删掉这个覆盖」，不是空串）；
 *   3. 归一化保留三层（labels / sources / overrides）与版本号；
 *   4. 非字符串值被丢掉（对端坏了也不该把 undefined 塞进界面）；
 *   5. 400 的稳定原因码留在 `ApiError.code`，不被吞成裸 HTTP 400；
 *   6. 缺字段抛错（页面据此报「契约不符」，而不是渲染一张空表）。
 *
 * Usage: npm run test:metrics-labels-contract
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
    api_version: "v1",
    kind: "admin_agent_metrics_labels",
    agent_id: "agent-001",
    revision: 3,
    labels: { app: "kafka", env: "prod", cluster: "kafka-prod" },
    sources: { app: "inferred", env: "default", cluster: "manual" },
    overrides: { cluster: "kafka-prod" },
    updated_at: "2026-11-03T00:00:00Z",
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

const view = await fetchAgentMetricsLabels("agent 001");
assert.equal(
  last().url,
  "/api/v1/admin/agents/agent%20001/metrics-labels",
  "路径与 agent_id 编码",
);
assert.equal(last().method, "GET", "读用 GET");
assert.equal(last().authorization, "Bearer token-1", "管理面带 Bearer");
assert.equal(view.agentId, "agent-001", "snake_case → camelCase");
assert.equal(view.revision, 3, "版本号保留");
assert.equal(view.labels.app, "kafka", "生效值");
assert.equal(view.sources.cluster, "manual", "每键来源保留");
assert.deepEqual(view.overrides, { cluster: "kafka-prod" }, "只带手工覆盖");
assert.equal(view.updatedAt, "2026-11-03T00:00:00Z", "更新时间保留");

// 非字符串值不该进视图（对端坏了也不能把 undefined 塞进界面）。
const noisy = normalizeAgentMetricsLabels({
  agent_id: "agent-002",
  revision: 0,
  labels: { app: "kafka", broken: 42 },
  sources: { app: "inferred", broken: null },
  overrides: {},
  updated_at: "",
});
assert.deepEqual(noisy.labels, { app: "kafka" }, "非字符串 label 值被丢掉");
assert.deepEqual(noisy.sources, { app: "inferred" }, "非字符串来源被丢掉");
assert.equal(noisy.updatedAt, "", "从未写过覆盖时 updated_at 是空串");

// 逐键 PUT：`null` 必须原样过去（它是「删掉该键的覆盖」）。
await setAgentMetricsLabels("agent-001", { app: "kafka", env: null });
assert.equal(last().method, "PUT", "写用 PUT");
assert.equal(
  last().url,
  "/api/v1/admin/agents/agent-001/metrics-labels",
  "写入路径",
);
assert.deepEqual(
  JSON.parse(last().body),
  {
    api_version: "v1",
    kind: "set_agent_metrics_labels",
    overrides: { app: "kafka", env: null },
  },
  "PUT 报文形状（含 null 的删除语义）",
);

// 清空全部覆盖：DELETE，同样回显生效值。
await clearAgentMetricsLabels("agent-001");
assert.equal(last().method, "DELETE", "清空用 DELETE");
assert.equal(
  last().url,
  "/api/v1/admin/agents/agent-001/metrics-labels",
  "清空路径",
);

// 缺字段要抛错：页面据此报「契约不符」，而不是渲染一张空表。
assert.throws(
  () =>
    normalizeAgentMetricsLabels({
      agent_id: "agent-003",
      labels: {},
      sources: {},
      overrides: {},
    }),
  /revision/,
  "缺 revision 必须抛错",
);

// 400：稳定原因码留在 code 里，说明留在 detail 里。
responder = () =>
  new Response(
    JSON.stringify({
      error: {
        code: "metrics_labels_invalid",
        message: "metric_label_requires_app: `role` 需要先有 `app`",
      },
    }),
    { status: 400, headers: { "content-type": "application/json" } },
  );

let rejected: unknown;
try {
  await setAgentMetricsLabels("agent-001", { role: "broker" });
} catch (error) {
  rejected = error;
}
assert.ok(rejected instanceof ApiError, "400 应抛 ApiError");
assert.equal(rejected.status, 400, "状态码保留");
assert.equal(rejected.code, "metrics_labels_invalid", "稳定原因码保留在 code");
assert.ok(
  rejected.detail?.includes("metric_label_requires_app"),
  "具体原因（哪个键不合法）保留在 detail",
);

// 429：限流封禁的剩余秒数要能被页面读到（RateLimitNotice 靠它倒计时）。
responder = () =>
  new Response("too many failed attempts", {
    status: 429,
    headers: { "Retry-After": "42" },
  });

let limited: unknown;
try {
  await fetchAgentMetricsLabels("agent-001");
} catch (error) {
  limited = error;
}
assert.ok(isRateLimitedError(limited), "429 应被识别为限流");
assert.equal(limited.retryAfterSeconds, 42, "Retry-After 秒数保留");

console.log(
  "metrics labels contract: OK（路径/方法/报文 / 归一化 / 400 原因码 / 429 退避）",
);
