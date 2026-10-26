import {
  ApiError,
  clearAgentDiscoverySnapshot,
  clearDiscoverySnapshotGlobal,
  fetchDiscoverySnapshot,
  normalizeDiscoverySnapshot,
  setAdminApiToken,
  setAgentDiscoverySnapshot,
  setDiscoverySnapshotGlobal,
} from "../src/api/admin";
import {
  snapshotDivergence,
  snapshotDraftFrom,
  snapshotDraftState,
  snapshotPresetOf,
} from "../src/components/discoverySnapshotForm";

// 契约测试：管理面「原文快照上送（DSNAP）」读写。
//
// 锁住四件事：
//   1. 五个端点（GET / POST 全局 / DELETE 全局 / POST 单机 / DELETE 单机）的路径与方法；
//   2. 响应里 `null` 的语义（全局未设置 / 没有单机覆盖 / 还没回传）—— 缺失与 null 必须区分，
//      否则页面会把「还没回传」显示成「没有覆盖」，这正是最容易误判的一行；
//   3. 必填字段缺失 / 类型不对必须抛错，不把契约漂移静默成空值；
//   4. 「配置与实际生效是否分叉」的判定（这一屏的核心价值）是纯函数，可被钉住。
//
// Usage: npm run test:discovery-snapshot

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

const settingPayload = {
  enabled: true,
  interval_seconds: 3600,
  updated_by: "platform-maintenance-engineer",
  updated_at: "2026-10-26T05:00:00+00:00",
};

// ── ① GET：路径 / 方法 / 整页映射（含两处 null）──────────────────────────────
recorded = [];
responder = () =>
  Response.json({
    global: settingPayload,
    agents: [
      {
        agent_id: "agent-host-1",
        override_setting: {
          enabled: true,
          interval_seconds: 300,
          updated_by: "ops-eng",
          updated_at: "2026-10-26T06:00:00+00:00",
        },
        applied: {
          enabled: true,
          interval_seconds: 300,
          source: "control_plane",
          since: "2026-10-26T06:01:00+00:00",
        },
      },
      {
        // 没有单机覆盖、也还没回传：两个 null 都是契约里的真实语义。
        agent_id: "agent-host-2",
        override_setting: null,
        applied: null,
      },
    ],
    min_interval_seconds: 60,
    generated_at: "2026-10-26T06:02:00+00:00",
  });

const view = await fetchDiscoverySnapshot();
const [readCall] = recorded;
assert(recorded.length === 1, `GET 必须只发一次请求，实际 ${recorded.length}`);
assert(
  readCall.url === "/api/v1/admin/discovery/snapshot",
  `GET 路径不对：${readCall.url}`,
);
assert(readCall.method === "GET", `必须是 GET，实际 ${readCall.method}`);
assert(
  readCall.authorization === "Bearer admin-token-under-test",
  "admin 凭据必须放在 Authorization Header",
);
assert(readCall.body === "", "GET 不能带 body");

assert(view.global !== null, "global 不该丢");
assert(
  view.global?.enabled === true && view.global?.intervalSeconds === 3600,
  "global 的开关/周期没有被归一化",
);
assert(
  view.global?.updatedBy === "platform-maintenance-engineer" &&
    view.global?.updatedAt === "2026-10-26T05:00:00+00:00",
  "global 的修改人/时间没有被归一化",
);
assert(view.minIntervalSeconds === 60, "min_interval_seconds 没有被归一化");
assert(
  view.generatedAt === "2026-10-26T06:02:00+00:00",
  "generated_at 没有被归一化",
);
assert(view.agents.length === 2, "agents 数量不对");

const [overridden, inherited] = view.agents;
assert(overridden.agentId === "agent-host-1", "agent_id 没有被归一化");
assert(
  overridden.overrideSetting?.intervalSeconds === 300,
  "单机覆盖没有被归一化",
);
assert(
  overridden.applied?.source === "control_plane" &&
    overridden.applied?.since === "2026-10-26T06:01:00+00:00",
  "applied 的 source/since 没有被归一化",
);
assert(
  inherited.overrideSetting === null && inherited.applied === null,
  "null 必须保持 null（不能变成 undefined / 空对象）",
);
assert(
  "overrideSetting" in inherited && "applied" in inherited,
  "可空字段必须保留在对象上，页面才能区分「没有」与「没取到」",
);

// ── ② 全局未设置：global 是 null，agents 仍要能列出来 ─────────────────────────
const unsetGlobal = normalizeDiscoverySnapshot({
  global: null,
  agents: [
    { agent_id: "agent-host-3", override_setting: null, applied: null },
  ],
  min_interval_seconds: 60,
  generated_at: "2026-10-26T06:03:00+00:00",
});
assert(unsetGlobal.global === null, "global: null 必须归一化成 null");
assert(unsetGlobal.agents.length === 1, "全局未设置时 agents 不能被丢掉");

// ── ③ POST 全局：body 必须是扁平 snake_case，返回体复用同一映射 ───────────────
recorded = [];
responder = () => Response.json(settingPayload);
const savedGlobal = await setDiscoverySnapshotGlobal({
  enabled: true,
  intervalSeconds: 3600,
  requestedBy: "ops-eng",
});
const [globalWrite] = recorded;
assert(
  globalWrite.url === "/api/v1/admin/discovery/snapshot",
  `POST 全局路径不对：${globalWrite.url}`,
);
assert(globalWrite.method === "POST", `POST 全局必须用 POST，实际 ${globalWrite.method}`);
const globalBody = JSON.parse(globalWrite.body) as Record<string, unknown>;
assert(
  globalBody.enabled === true &&
    globalBody.interval_seconds === 3600 &&
    globalBody.requested_by === "ops-eng",
  `POST 全局 body 不符合后端契约：${globalWrite.body}`,
);
assert(
  typeof globalBody.interval_seconds === "number" &&
    typeof globalBody.enabled === "boolean" &&
    !("intervalSeconds" in globalBody) &&
    !("requestedBy" in globalBody),
  `POST body 必须是 number/boolean 与 snake_case：${globalWrite.body}`,
);
assert(
  savedGlobal.enabled === true && savedGlobal.intervalSeconds === 3600,
  "POST 全局的返回体没有被归一化",
);

// 可选字段省略时不发送空键。
recorded = [];
await setDiscoverySnapshotGlobal({ enabled: false, intervalSeconds: 60 });
const minimalBody = JSON.parse(recorded[0].body) as Record<string, unknown>;
assert(
  !("requested_by" in minimalBody),
  "省略 requestedBy 时不能发送空键",
);

// ── ④ POST 单机：agent_id 进路径（并做 URL 编码）─────────────────────────────
recorded = [];
responder = () =>
  Response.json({
    enabled: true,
    interval_seconds: 300,
    updated_by: "ops-eng",
    updated_at: "2026-10-26T07:00:00+00:00",
  });
const savedOverride = await setAgentDiscoverySnapshot("agent-host-1", {
  enabled: true,
  intervalSeconds: 300,
});
const [agentWrite] = recorded;
assert(
  agentWrite.url === "/api/v1/admin/agents/agent-host-1/discovery/snapshot",
  `POST 单机路径不对：${agentWrite.url}`,
);
assert(agentWrite.method === "POST", "POST 单机必须用 POST");
const agentBody = JSON.parse(agentWrite.body) as Record<string, unknown>;
assert(
  agentBody.enabled === true && agentBody.interval_seconds === 300,
  `POST 单机 body 不符合契约：${agentWrite.body}`,
);
assert(savedOverride.intervalSeconds === 300, "POST 单机的返回体没有被归一化");

// 特殊字符必须编码，不能把路径拼坏。
recorded = [];
await setAgentDiscoverySnapshot("agent/with space", {
  enabled: false,
  intervalSeconds: 900,
});
assert(
  recorded[0].url ===
    "/api/v1/admin/agents/agent%2Fwith%20space/discovery/snapshot",
  `agent_id 必须 URL 编码：${recorded[0].url}`,
);

// ── ⑤ DELETE：204 无 body 不能当成解析失败 ───────────────────────────────────
recorded = [];
responder = () => new Response(null, { status: 204 });
await clearDiscoverySnapshotGlobal();
assert(recorded.length === 1, "DELETE 全局必须只发一次请求");
assert(
  recorded[0].url === "/api/v1/admin/discovery/snapshot",
  `DELETE 全局路径不对：${recorded[0].url}`,
);
assert(recorded[0].method === "DELETE", "清除全局必须用 DELETE");

recorded = [];
await clearAgentDiscoverySnapshot("agent-host-1");
assert(
  recorded[0].url === "/api/v1/admin/agents/agent-host-1/discovery/snapshot",
  `DELETE 单机路径不对：${recorded[0].url}`,
);
assert(recorded[0].method === "DELETE", "清除单机覆盖必须用 DELETE");

// ── ⑥ 400 纯文本错误要透出正文 ──────────────────────────────────────────────
responder = () =>
  new Response("interval_seconds must be >= 60", {
    status: 400,
    headers: { "content-type": "text/plain" },
  });
let rejected: unknown;
try {
  await setDiscoverySnapshotGlobal({ enabled: true, intervalSeconds: 30 });
} catch (error) {
  rejected = error;
}
assert(
  rejected instanceof ApiError && rejected.status === 400,
  "周期过短必须抛 ApiError(400)",
);
assert(
  rejected.detail === "interval_seconds must be >= 60",
  `400 的纯文本正文必须落到 ApiError.detail，实际 ${JSON.stringify(
    rejected.detail,
  )}`,
);

// ── ⑦ 契约漂移必须显式失败 ──────────────────────────────────────────────────
const validRow = {
  agent_id: "agent-host-1",
  override_setting: null,
  applied: null,
};
const validPayload = {
  global: null,
  agents: [validRow],
  min_interval_seconds: 60,
  generated_at: "2026-10-26T06:00:00+00:00",
};

const driftCases: Array<[string, Record<string, unknown>]> = [
  ["缺少 global 键", { ...validPayload, global: undefined }],
  ["缺少 agents", { ...validPayload, agents: undefined }],
  [
    "agents 里的 override_setting 缺失",
    {
      ...validPayload,
      agents: [{ agent_id: "a", applied: null }],
    },
  ],
  [
    "agents 里的 applied 缺失",
    {
      ...validPayload,
      agents: [{ agent_id: "a", override_setting: null }],
    },
  ],
  ["缺少 min_interval_seconds", { ...validPayload, min_interval_seconds: undefined }],
  ["缺少 generated_at", { ...validPayload, generated_at: undefined }],
  [
    "interval_seconds 是字符串",
    {
      ...validPayload,
      global: { ...settingPayload, interval_seconds: "3600" },
    },
  ],
  [
    "enabled 是字符串",
    {
      ...validPayload,
      global: { ...settingPayload, enabled: "true" },
    },
  ],
  [
    "applied 缺 source",
    {
      ...validPayload,
      agents: [
        {
          ...validRow,
          applied: {
            enabled: true,
            interval_seconds: 300,
            since: "2026-10-26T06:00:00+00:00",
          },
        },
      ],
    },
  ],
  [
    "override_setting 缺 updated_at",
    {
      ...validPayload,
      agents: [
        {
          ...validRow,
          override_setting: {
            enabled: true,
            interval_seconds: 300,
            updated_by: "ops",
          },
        },
      ],
    },
  ],
];

for (const [name, payload] of driftCases) {
  let threw = false;
  try {
    normalizeDiscoverySnapshot(payload);
  } catch {
    threw = true;
  }
  assert(threw, `${name} 必须被拒绝（不能静默成空值）`);
}

// ── ⑧ 分叉判定（这一屏的核心）──────────────────────────────────────────────
const expected = {
  enabled: true,
  intervalSeconds: 3600,
  updatedBy: "ops",
  updatedAt: "2026-10-26T05:00:00+00:00",
};
const applied = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  intervalSeconds: 3600,
  source: "control_plane",
  since: "2026-10-26T06:00:00+00:00",
  ...overrides,
});

assert(
  snapshotDivergence(expected, applied()) === false,
  "配置与实际一致时不能报分叉",
);
assert(
  snapshotDivergence(expected, applied({ intervalSeconds: 300 })) === true,
  "配了 3600 实际 300 必须报分叉",
);
assert(
  snapshotDivergence(expected, applied({ enabled: false })) === true,
  "开关不一致必须报分叉",
);
assert(
  snapshotDivergence(expected, applied({ source: "local_config" })) === true,
  "控制面有设置、机器却还在用本机配置，必须报分叉",
);
assert(
  snapshotDivergence(expected, null) === false,
  "还没回传不是分叉（不能因为数据没到就标红）",
);
assert(
  snapshotDivergence(null, applied()) === false,
  "控制面没有任何设置时没有可比对象，不能报分叉",
);

// ── ⑨ 周期预设 / 表单判定 ──────────────────────────────────────────────────
assert(snapshotPresetOf(300) === 300, "300 秒应命中预设");
assert(snapshotPresetOf(3600) === 3600, "3600 秒应命中预设");
assert(snapshotPresetOf(420) === null, "420 秒不在预设里，应进自定义态");
assert(snapshotPresetOf(60) === null, "60 秒不在预设里，应进自定义态");

const base = snapshotDraftFrom(expected);
const untouched = snapshotDraftState(base, base, 60, false);
assert(!untouched.dirty, "没改动不该算 dirty");
assert(!untouched.canSubmit, "没改动必须不能提交");
assert(untouched.validationError === null, "合法值不该报校验错");

const changed = snapshotDraftState(base, { ...base, interval: "300" }, 60, false);
assert(changed.dirty && changed.canSubmit, "改了合法周期应可提交");

const tooShort = snapshotDraftState(
  base,
  { ...base, interval: "30" },
  60,
  false,
);
assert(!tooShort.canSubmit, "低于下限不能提交");
assert(tooShort.validationError !== null, "低于下限必须有可见原因");

const notInteger = snapshotDraftState(
  base,
  { ...base, interval: "60.5" },
  60,
  false,
);
assert(!notInteger.canSubmit, "非整数不能提交");

const pending = snapshotDraftState(
  base,
  { ...base, interval: "300" },
  60,
  true,
);
assert(!pending.canSubmit, "保存中不能再提交");

const unsetDraft = snapshotDraftFrom(null);
assert(
  unsetDraft.enabled === false && unsetDraft.interval === "3600",
  "没有设置时的初值必须是「未启用 + 默认周期」",
);

// 全局从未设置过时，草稿等于初值也必须可保存 —— 否则无法落一条
// 「全局关闭 + 默认周期」的设置（它恰好等于空表单的初值）。
const createGlobal = snapshotDraftState(unsetDraft, unsetDraft, 60, false, false);
assert(
  createGlobal.dirty && createGlobal.canSubmit,
  "服务端没有全局值时，应当允许直接保存表单里的值",
);
// 服务端已有值时仍然要求真改动（避免空写一次 updated_at）。
const noopSave = snapshotDraftState(unsetDraft, unsetDraft, 60, false, true);
assert(!noopSave.canSubmit, "服务端已有相同值时不能空写");

console.log("discovery snapshot contract test passed");
