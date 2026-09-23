import {
  ApiError,
  fetchAgentWork,
  fetchContentCatalog,
  grantOneShotWork,
  grantStandingWork,
  normalizeAgentWorkView,
  normalizeContentCatalog,
  normalizeWorkReceipt,
  parseWorkSpec,
  pauseWork,
  resumeWork,
  revokeWork,
  classifyAgentPurpose,
  setAdminApiToken,
} from "../src/api/admin";
import {
  DRIFT_LABEL,
  blockedFamilies,
  driftingCount,
  grantableFamilies,
  metricIntervalSeconds,
  oneShotStatusLabel,
  parseIntervalSeconds,
  platformForMachineClass,
  specCounts,
  standingDrift,
} from "../src/components/agentWorkStatus";

// 契约测试：管理面「Agent 工作」（模型 `Control.Agent.Work` 的查看 + 授权/暂停/恢复/撤回）。
//
// 后端把工作参数 `spec` 当成**不透明字符串**返回（内容是网关物化出来的单元清单 JSON），
// 页面必须自己解析。这里锁住五件最容易漂移的事：
//   1. 请求形状：GET/POST 的路径、方法、Bearer、body 字段名（含 `work_kind` 的两种取值）；
//   2. 工作参数的解析与**失败不静默**：坏 JSON / 坏形状要能被页面说出来；
//   3. 漂移三态：从没确认 / 确认旧版本 / 已同步，三种必须区分；
//   4. 派活闸门：可派的面 = 模板覆盖 ∩ 面就绪，不可派的面要带原因；
//   5. 闭合取值与可空字段：工作类型/状态认不出来要抛错，`ack: null` 不等于缺键抛错。
//
// Usage: npm run test:agent-work

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

const WORK_ID = "work-agent-001-HostMetrics";
const SPEC = JSON.stringify({
  units: [
    {
      unit_id: "mac-host-metrics",
      capability: "collect_metrics",
      rule_ref: "agent_uplink",
      requires_privilege: "none",
      sources: [{ kind: "MetricInterval", target: "15s" }],
    },
    {
      unit_id: "mac-crash-panic",
      capability: "collect_logs",
      rule_ref: "mac-drafts/crash-panic",
      requires_privilege: "fda",
      sources: [
        { kind: "FileGlob", target: "/Library/Logs/DiagnosticReports/*.ips" },
        { kind: "Exporter", target: "sqlite-snapshot(TCC.db)" },
      ],
    },
  ],
});

function standingPayload(overrides: Record<string, unknown> = {}) {
  return {
    work_id: WORK_ID,
    agent_id: "agent-001",
    family: "HostMetrics",
    spec: SPEC,
    catalog_version: 3,
    proposal_id: null,
    plan_version: 2,
    effective_from: "2026-09-23T00:00:00Z",
    status: "active",
    updated_by: "admin",
    updated_at: "2026-09-23T00:00:00Z",
    ack: null,
    ...overrides,
  };
}

function workViewPayload(overrides: Record<string, unknown> = {}) {
  return {
    agent_id: "agent-001",
    sequence: 4,
    standing: [standingPayload()],
    one_shot: [],
    retired_standing: [],
    settled_one_shot: [],
    generated_at: "2026-09-23T00:00:01Z",
    ...overrides,
  };
}

// --- 1. 请求形状：查看 ------------------------------------------------------
recorded = [];
responder = () => Response.json(workViewPayload());
const view = await fetchAgentWork("agent-001");
assert(recorded.length === 1, `work view must issue one request, got ${recorded.length}`);
assert(
  recorded[0].url === "/api/v1/admin/agents/agent-001/work",
  `unexpected work path: ${recorded[0].url}`,
);
assert(recorded[0].method === "GET", "work view must be GET");
assert(
  recorded[0].authorization === "Bearer admin-token-under-test",
  "admin credential must be sent in the Authorization Header",
);

// agent_id 必须编码：带 / 的 id 不能改道到别的路由。
recorded = [];
await fetchAgentWork("agent/001");
assert(
  recorded[0].url === "/api/v1/admin/agents/agent%2F001/work",
  `agent_id must be URI-encoded, got ${recorded[0].url}`,
);

// --- 2. 规范化：工作参数、可空 ack、历史留痕 --------------------------------
assert(view.agentId === "agent-001", "agent_id was not normalized");
assert(view.sequence === 4, "sequence was not normalized");
assert(view.standing.length === 1, "standing work was not normalized");
const standing = view.standing[0];
assert(standing.workId === WORK_ID, "work_id was not normalized");
assert(standing.catalogVersion === 3, "catalog_version was not normalized");
assert(standing.proposalId === null, "null proposal_id must stay null");
assert(standing.ack === null, "null ack must stay null（从没确认过）");
assert(standing.spec.error === null, `spec should parse: ${standing.spec.error}`);
assert(standing.spec.units.length === 2, "spec units were not parsed");
assert(
  standing.spec.units[0].unitId === "mac-host-metrics",
  "unit_id was not normalized",
);
assert(
  standing.spec.units[1].requiresPrivilege === "fda",
  "requires_privilege was not normalized",
);
assert(
  standing.spec.units[1].sources[1].kind === "Exporter",
  "sources were not normalized",
);

// ack 存在时按版本比较（这是漂移判定的输入）。
const acked = normalizeAgentWorkView(
  workViewPayload({
    standing: [
      standingPayload({
        ack: {
          work_id: WORK_ID,
          agent_id: "agent-001",
          work_kind: "Standing",
          plan_version: 2,
          acknowledged_at: "2026-09-23T00:00:02Z",
        },
      }),
    ],
  }),
);
assert(acked.standing[0].ack?.planVersion === 2, "ack.plan_version was not normalized");

// 历史留痕：撤回的常驻工作与了结的一次性工作都要能被读到（页面拿它做审计）。
const withHistory = normalizeAgentWorkView(
  workViewPayload({
    standing: [],
    retired_standing: [standingPayload({ status: "revoked" })],
    settled_one_shot: [
      {
        work_id: "work-upgrade",
        agent_id: "agent-001",
        action: "upgrade",
        spec: "0.1.4",
        scheduled_at: "2026-09-23T00:00:00Z",
        deadline_at: "2026-09-24T00:00:00Z",
        timeout_seconds: 600,
        interruptible: false,
        status: "canceled",
        paused_at: null,
        paused_total_seconds: 0,
        attempt: 1,
        issued_by: "admin",
        issued_at: "2026-09-23T00:00:00Z",
        ack: null,
      },
    ],
  }),
);
assert(withHistory.retiredStanding[0].status === "revoked", "retired standing lost");
assert(withHistory.settledOneShot[0].status === "canceled", "settled one-shot lost");
assert(
  withHistory.settledOneShot[0].timeoutSeconds === 600,
  "one-shot timeout was not normalized",
);

// --- 3. 工作参数：坏形状要说出来，不当成「没事可采」 ------------------------
const brokenJson = parseWorkSpec("mac-host-metrics");
assert(brokenJson.error !== null, "非 JSON 的 spec 必须报错而不是当空工作");
assert(brokenJson.raw === "mac-host-metrics", "原始串必须保留以便对账");
assert(brokenJson.units.length === 0, "解析失败时不应伪造单元");

const brokenShape = parseWorkSpec(JSON.stringify({ units: [{ unit_id: "x" }] }));
assert(brokenShape.error !== null, "缺字段的 spec 必须报错");

const emptyUnits = parseWorkSpec(JSON.stringify({ units: [] }));
assert(emptyUnits.error === null, "空单元清单本身是合法的");

// --- 4. 漂移三态 ------------------------------------------------------------
assert(
  standingDrift(view.standing[0]) === "never-acked",
  "没有 ack 就是「从未确认」",
);
assert(
  standingDrift(acked.standing[0]) === "in-sync",
  "版本一致就是已同步",
);
const stale = normalizeAgentWorkView(
  workViewPayload({
    standing: [
      standingPayload({
        plan_version: 5,
        ack: {
          work_id: WORK_ID,
          agent_id: "agent-001",
          work_kind: "Standing",
          plan_version: 4,
          acknowledged_at: "2026-09-23T00:00:02Z",
        },
      }),
    ],
  }),
);
assert(standingDrift(stale.standing[0]) === "stale-ack", "确认旧版本要单独成一态");
assert(
  DRIFT_LABEL["never-acked"].includes("从未确认"),
  "漂移文案要能让人看懂是什么状态",
);
assert(driftingCount(view.standing) === 1, "漂移计数按「未同步」算");
assert(driftingCount(acked.standing) === 0, "已同步的不算漂移");

// --- 5. 派活闸门：模板覆盖 ∩ 面就绪 ----------------------------------------
const catalog = normalizeContentCatalog({
  catalog_version: 3,
  superseded_by: null,
  templates: [
    {
      template_id: "macos-dev",
      machine_class: "MacDev",
      platform: "macos",
      status: "draft",
      family_scope: ["HostMetrics", "DevToolchain", "PrivacyTcc"],
      capability_scope: ["collect_logs", "collect_metrics"],
    },
  ],
  readiness: [
    { family: "HostMetrics", platform: "macos", active_units: 1, total_units: 1, ready: true },
    { family: "DevToolchain", platform: "macos", active_units: 0, total_units: 1, ready: false },
    // PrivacyTcc 在模板里、在目录里有单元但未就绪 → 不可派。
    { family: "PrivacyTcc", platform: "macos", active_units: 0, total_units: 1, ready: false },
  ],
});
assert(platformForMachineClass("MacDev") === "macos", "Mac* 属于 macos");
assert(platformForMachineClass("LinuxData") === "linux", "Linux* 属于 linux");

const grantable = grantableFamilies(catalog, "MacDev");
assert(grantable.length === 1, `只有就绪的面可派，得到 ${grantable.length}`);
assert(grantable[0].family === "HostMetrics", "可派的面应是 HostMetrics");
assert(grantable[0].activeUnits === 1, "可派面的就绪单元数要带出来");

const blocked = blockedFamilies(catalog, "MacDev");
assert(blocked.length === 2, `不可派的面要列出来，得到 ${blocked.length}`);
assert(
  blocked.every((entry) => entry.reason.includes("active")),
  "不可派原因要说清是规则未就绪",
);
// 没有模板的机器类别：不是「无可派面」而是「取不到模板」，原因要不一样。
const noTemplate = blockedFamilies(catalog, "LinuxData");
assert(
  noTemplate[0].reason.includes("模板"),
  `缺模板的原因要说清：${noTemplate[0].reason}`,
);

// superseded_by 是「键必须存在、值可为 null」：缺失要抛错，不能静默成 null。
let missingSuperseded: unknown;
try {
  normalizeContentCatalog({ catalog_version: 1, templates: [], readiness: [] });
} catch (error) {
  missingSuperseded = error;
}
assert(missingSuperseded instanceof Error, "缺 superseded_by 必须抛错");

// --- 6. 周期与单元计数 ------------------------------------------------------
const metricsOnly = parseWorkSpec(
  JSON.stringify({
    units: [
      {
        unit_id: "a",
        capability: "collect_metrics",
        rule_ref: "r",
        requires_privilege: "none",
        sources: [{ kind: "MetricInterval", target: "60s" }],
      },
      {
        unit_id: "b",
        capability: "collect_metrics",
        rule_ref: "r",
        requires_privilege: "none",
        sources: [
          { kind: "MetricInterval", target: "15s" },
          { kind: "FileGlob", target: "/x/*" },
        ],
      },
    ],
  }),
);
assert(
  metricIntervalSeconds(metricsOnly) === 15,
  "指标周期取最密的那一条（要得最急的是下界）",
);
assert(parseIntervalSeconds("5m") === 300, "分钟写法要能解析");
assert(parseIntervalSeconds("15") === null, "没有单位的周期不猜");
assert(parseIntervalSeconds("0s") === null, "非正周期不算有效值");
const counts = specCounts(metricsOnly);
assert(counts.units === 2 && counts.sources === 3, "单元与来源计数要分别给出");

// --- 7. 授权/暂停/恢复/撤回的请求形状 --------------------------------------
recorded = [];
responder = () =>
  Response.json({
    work_id: WORK_ID,
    agent_id: "agent-001",
    work_kind: "Standing",
    status: "accepted",
    plan_version: 3,
    created_at: "2026-09-23T00:00:03Z",
  });

const receipt = await grantStandingWork("agent-001", { family: "HostMetrics" });
assert(receipt.planVersion === 3, "receipt.plan_version was not normalized");
assert(recorded[0].url === "/api/v1/admin/agents/agent-001/work", "grant path");
assert(recorded[0].method === "POST", "grant must be POST");
const grantBody = JSON.parse(recorded[0].body);
assert(grantBody.work_kind === "Standing", "grant must declare work_kind");
assert(grantBody.family === "HostMetrics", "grant must carry the family");
assert(grantBody.spec === "", "留空的 spec 用空串（由网关按事实展开）");
assert(
  grantBody.plan_version === undefined,
  "不给版本时不能塞一个 null 上去（网关按「不指定」处理）",
);

recorded = [];
await grantStandingWork("agent-001", { family: "HostMetrics", spec: "mac-host-metrics", planVersion: 4 });
const explicitBody = JSON.parse(recorded[0].body);
assert(explicitBody.spec === "mac-host-metrics", "手写 spec 要原样发出");
assert(explicitBody.plan_version === 4, "指定版本要发过去");

recorded = [];
await grantOneShotWork("agent-001", {
  action: "upgrade",
  spec: "0.1.4",
  deadlineAt: "2026-09-24T00:00:00Z",
  timeoutSeconds: 600,
});
const oneShotBody = JSON.parse(recorded[0].body);
assert(oneShotBody.work_kind === "OneShot", "one-shot must declare its kind");
assert(oneShotBody.action === "upgrade", "one-shot must carry the action");
assert(oneShotBody.deadline_at === "2026-09-24T00:00:00Z", "one-shot must carry the deadline");
assert(oneShotBody.timeout_seconds === 600, "one-shot must carry the budget");
assert(
  oneShotBody.scheduled_at === undefined,
  "不给计划开始时间时不要发这个字段（网关按「立即」处理）",
);

recorded = [];
await pauseWork("agent-001", WORK_ID);
assert(
  recorded[0].url === `/api/v1/admin/agents/agent-001/work/${WORK_ID}/pause`,
  `pause path: ${recorded[0].url}`,
);
assert(recorded[0].method === "POST", "pause must be POST");

recorded = [];
await resumeWork("agent-001", WORK_ID);
assert(recorded[0].url.endsWith("/resume"), "resume path");

recorded = [];
await revokeWork("agent-001", "work/weird id", "不再需要");
assert(
  recorded[0].url === "/api/v1/admin/agents/agent-001/work/work%2Fweird%20id/revoke",
  `work_id must be URI-encoded: ${recorded[0].url}`,
);
assert(
  JSON.parse(recorded[0].body).reason_code === "不再需要",
  "撤回原因要带上",
);

recorded = [];
// 归档判定的响应是 `AgentClassification`（注意 `suggestion_id` / `note` 这两个可空字段
// 在网关响应里**总是存在**，值可为 null —— 与「键缺失」是两回事）。
responder = () =>
  Response.json({
    agent_id: "agent-001",
    machine_class: "MacDev",
    suggestion_id: null,
    note: null,
    decided_by: "admin",
    decided_at: "2026-09-23T00:00:04Z",
  });
const classification = await classifyAgentPurpose("agent-001", {
  machineClass: "MacDev",
});
assert(
  classification.machineClass === "MacDev",
  "classification was not normalized",
);
assert(classification.note === null, "null note must stay null");
assert(
  recorded[0].url === "/api/v1/admin/agents/agent-001/classification",
  "classification path",
);
const classifyBody = JSON.parse(recorded[0].body);
assert(classifyBody.machine_class === "MacDev", "classification must carry the class");
assert(
  classifyBody.suggestion_id === undefined && classifyBody.note === undefined,
  "可选项留空时不要发空字段",
);

// 采纳建议时要带上 suggestion_id（网关据此记「哪一次建议被采纳了」）。
recorded = [];
await classifyAgentPurpose("agent-001", {
  machineClass: "MacDev",
  suggestionId: "sug-1",
  note: "采纳建议",
});
const adoptedBody = JSON.parse(recorded[0].body);
assert(adoptedBody.suggestion_id === "sug-1", "采纳建议要带 suggestion_id");
assert(adoptedBody.note === "采纳建议", "备注要带上");

// --- 8. 错误与闭合取值 ------------------------------------------------------
assert(oneShotStatusLabel("dispatched") === "已派发", "一次性工作状态要有中文口径");
assert(oneShotStatusLabel("wat") === "wat", "认不出的状态原样露出，不编造");

responder = () => new Response("one-shot work is not interruptible", { status: 409 });
let conflict: unknown;
try {
  await pauseWork("agent-001", WORK_ID);
} catch (error) {
  conflict = error;
}
assert(conflict instanceof ApiError, "409 must surface as ApiError");
assert((conflict as ApiError).status === 409, "409 status must be preserved");
assert(
  /not interruptible/.test((conflict as ApiError).detail ?? ""),
  "409 正文要保留（页面靠它说清为什么不能暂停）",
);

responder = () =>
  Response.json(workViewPayload({ standing: [standingPayload({ status: "冻结" })] }));
let badStatus: unknown;
try {
  await fetchAgentWork("agent-001");
} catch (error) {
  badStatus = error;
}
assert(badStatus instanceof Error, "未知的常驻工作状态必须抛错");

responder = () =>
  Response.json({
    work_id: "w",
    agent_id: "a",
    work_kind: "Whatever",
    status: "accepted",
    plan_version: 1,
    created_at: "t",
  });
let badKind: unknown;
try {
  normalizeWorkReceipt({
    work_id: "w",
    agent_id: "a",
    work_kind: "Whatever",
    status: "accepted",
    plan_version: 1,
    created_at: "t",
  });
} catch (error) {
  badKind = error;
}
assert(badKind instanceof Error, "未知的工作类型必须抛错");

// 内容目录：未装载时网关回 503，页面靠它区分「未装载」与「加载失败」。
responder = () => new Response("content not loaded", { status: 503 });
let unavailable: unknown;
try {
  await fetchContentCatalog();
} catch (error) {
  unavailable = error;
}
assert(unavailable instanceof ApiError, "503 must surface as ApiError");
assert((unavailable as ApiError).status === 503, "503 status must be preserved");

console.log(
  "agent work contract ok: request shapes + spec parsing (fail loud) + drift三态 + grant gate + closed sets + 503/409",
);
