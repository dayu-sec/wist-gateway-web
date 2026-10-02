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
  collectedLogFiles,
  driftingCount,
  duplicatedCollectedPaths,
  grantableFamilies,
  isExecutableSource,
  isExplicitPath,
  localExecutionLabel,
  metricIntervalSeconds,
  oneShotStatusLabel,
  parseIntervalSeconds,
  platformForMachineClass,
  specCounts,
  standingDrift,
  ungrantedFamilies,
  unsupportedSourceCount,
  unsupportedSourceReason,
} from "../src/components/agentWorkStatus";
import type { StandingWork } from "../src/types";

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

function oneShotPayload(overrides: Record<string, unknown> = {}) {
  return {
    work_id: "work-upgrade",
    agent_id: "agent-001",
    action: "upgrade",
    spec: "0.1.4",
    scheduled_at: "2026-09-23T00:00:00Z",
    deadline_at: "2026-09-24T00:00:00Z",
    timeout_seconds: 600,
    interruptible: false,
    status: "failed",
    paused_at: null,
    paused_total_seconds: 0,
    attempt: 1,
    issued_by: "admin",
    issued_at: "2026-09-23T00:00:00Z",
    ack: null,
    result: null,
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
      oneShotPayload({ status: "canceled" }),
      // 了结之后仍带结果：失败原因/回滚到哪一版正是这时才最需要看的东西。
      oneShotPayload({
        work_id: "work-upgrade-2",
        status: "failed",
        result: {
          work_id: "work-upgrade-2",
          agent_id: "agent-001",
          status: "failed",
          detail: "已回滚到 0.1.3：新版 60s 没起来",
          reported_at: "2026-09-23T00:10:00Z",
        },
      }),
    ],
  }),
);
assert(withHistory.retiredStanding[0].status === "revoked", "retired standing lost");
assert(withHistory.settledOneShot[0].status === "canceled", "settled one-shot lost");
assert(
  withHistory.settledOneShot[0].timeoutSeconds === 600,
  "one-shot timeout was not normalized",
);
assert(
  withHistory.settledOneShot[0].result === null,
  "没上报过结果必须是 null，而不是 undefined",
);
const settledResult = withHistory.settledOneShot[1].result;
assert(settledResult?.status === "failed", "settled result was not normalized");
assert(
  settledResult?.detail === "已回滚到 0.1.3：新版 60s 没起来",
  "rollback detail must survive on a settled work",
);
assert(
  settledResult?.reportedAt === "2026-09-23T00:10:00Z",
  "result.reported_at was not normalized",
);

// --- 2b. 本机工作：网关透传 agentd 自报的 `local` -------------------------------
const localPayload = {
  recorded_at: "2026-09-26T08:00:00Z",
  gateway_sequence: 4,
  standing: [
    {
      work_id: WORK_ID,
      family: "SystemLogs",
      status: "active",
      plan_version: 3,
      acknowledged_version: 3,
      effective_from: "2026-09-26T07:00:00Z",
      tasks: [
        {
          input_id: "work-SystemLogs-syslog",
          path: "/var/log/system.log",
          startup_position: "tail",
        },
      ],
    },
  ],
  one_shot: [
    {
      work_id: "work-upgrade",
      action: "upgrade",
      status: "dispatched",
      execution: "unexecuted",
      scheduled_at: "2026-09-26T08:00:00Z",
      deadline_at: "2026-09-26T08:10:00Z",
      timeout_seconds: 600,
    },
  ],
  local_inputs: [
    { input_id: "app", path: "/var/log/app.log", startup_position: "tail" },
  ],
  metrics_interval_seconds: 15,
};

const withLocal = normalizeAgentWorkView(workViewPayload({ local: localPayload }));
assert(withLocal.local !== null, "local 存在时必须解析出来");
assert(withLocal.local?.error === null, `local 应解析成功：${withLocal.local?.error}`);
assert(
  withLocal.local?.recordedAt === "2026-09-26T08:00:00Z",
  "local.recorded_at was not normalized",
);
assert(withLocal.local?.gatewaySequence === 4, "local.gateway_sequence was not normalized");
assert(withLocal.local?.standing.length === 1, "local.standing was not normalized");
assert(
  withLocal.local?.standing[0].acknowledgedVersion === 3,
  "local.standing[].acknowledged_version was not normalized",
);
assert(
  withLocal.local?.standing[0].tasks[0].path === "/var/log/system.log",
  "local.standing[].tasks[] was not normalized",
);
assert(
  withLocal.local?.standing[0].tasks[0].startupPosition === "tail",
  "local task startup_position was not normalized",
);
assert(
  withLocal.local?.oneShot[0].execution === "unexecuted",
  "local.one_shot[] was not normalized",
);
assert(
  withLocal.local?.oneShot[0].timeoutSeconds === 600,
  "local.one_shot[].timeout_seconds was not normalized",
);
assert(
  withLocal.local?.localInputs[0].path === "/var/log/app.log",
  "local.local_inputs[] was not normalized",
);
assert(
  withLocal.local?.metricsIntervalSeconds === 15,
  "local.metrics_interval_seconds was not normalized",
);

// 缺键 / null 都得到 null 且**不抛错**：旧网关/旧 agent 没这个字段是正常的。
const noLocal = normalizeAgentWorkView(workViewPayload());
assert(noLocal.local === null, "local 缺键必须得到 null，不能抛错");
const nullLocal = normalizeAgentWorkView(workViewPayload({ local: null }));
assert(nullLocal.local === null, "local: null 必须得到 null，不能抛错");

// local 存在但形状不对：不抛错，`error` 带原因 —— 与「缺失 = null」区分开。
const brokenLocal = normalizeAgentWorkView(
  workViewPayload({ local: { recorded_at: "t", gateway_sequence: "四十二" } }),
);
assert(brokenLocal.local !== null, "坏 local 不应被当成「没上报」");
assert(brokenLocal.local?.error !== null, "坏 local 要带出原因，不能静默");

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
// 载荷形状照**网关实际返回的**：就绪度按平台分组（曾经在这里写成扁平的 mock，
// 结果线上载荷过不了 normalizer —— mock 必须与真实形状一致，否则白测）。
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
    {
      platform: "macos",
      families: [
        {
          family: "HostMetrics",
          active_units: 1,
          parse_ready_units: 1,
          total_units: 1,
          ready: true,
          parse_ready: true,
        },
        {
          family: "DevToolchain",
          active_units: 0,
          parse_ready_units: 0,
          total_units: 1,
          ready: false,
          parse_ready: false,
        },
        // PrivacyTcc：**采集就绪但解析未就绪** —— 正是“两个轴分开”要覆盖的那种面：
        // 能派下去把原文拿回来，但记录只会以未归类的原文落地。
        {
          family: "PrivacyTcc",
          active_units: 1,
          parse_ready_units: 0,
          total_units: 1,
          ready: true,
          parse_ready: false,
        },
      ],
    },
    { platform: "linux", families: [] },
  ],
});
assert(
  catalog.readiness.length === 3,
  `按平台分组的就绪度要摊平成一面一条，得到 ${catalog.readiness.length}`,
);
assert(
  catalog.readiness.every((entry) => entry.platform !== ""),
  "摊平后每条都要带上所属平台",
);
assert(platformForMachineClass("MacDev") === "macos", "Mac* 属于 macos");
assert(platformForMachineClass("LinuxData") === "linux", "Linux* 属于 linux");
// 类别→平台是**闭合关系**：Mac* → macos，其余 Linux 类别 → linux。`LinuxHost` 是
// 无专有面的通用服务器（`wist-knowledge/templates.toml` 的 `linux-host`），也不能漏。
for (const klass of ["MacDaily", "MacDev"] as const) {
  assert(platformForMachineClass(klass) === "macos", `${klass} 应当属于 macos`);
}
for (const klass of ["LinuxHost", "LinuxCompute", "LinuxData"] as const) {
  assert(platformForMachineClass(klass) === "linux", `${klass} 应当属于 linux`);
}

const grantable = grantableFamilies(catalog, "MacDev");
assert(grantable.length === 2, `只有可采的面可派，得到 ${grantable.length}`);
assert(grantable[0].family === "HostMetrics", "可派的面按面名排序");
assert(grantable[0].activeUnits === 1, "可派面的可采单元数要带出来");
assert(grantable[0].parseReady, "解析就绪要随行带出来");
// 关键：解析不就绪**不**阻止派活 —— 它只是随行携带的一个提示。
assert(
  grantable[1].family === "PrivacyTcc" && !grantable[1].parseReady,
  "采集就绪但解析未就绪的面照样可派，且要标明原文未归类",
);

// 可派的面里，已经有常驻工作的那些不当「待授权」摆 —— 同一面会摆成两张卡。
const ungranted = ungrantedFamilies(grantable, [standing]);
assert(
  ungranted.length === 1 && ungranted[0].family === "PrivacyTcc",
  `已授权的面要从待授权清单里去掉，得到 ${ungranted.map((entry) => entry.family).join(",")}`,
);
assert(
  ungrantedFamilies(grantable, []).length === 2,
  "一件工作都没有时，可派的面全是待授权",
);
assert(
  ungrantedFamilies(grantable, [{ ...standing, status: "revoked" }]).length === 1,
  "传进来的就是当前生效的那一批；已撤回的面不在其中，自然回到待授权",
);

const blocked = blockedFamilies(catalog, "MacDev");
assert(blocked.length === 1, `不可派的面要列出来，得到 ${blocked.length}`);
assert(
  blocked.every((entry) => entry.reason.includes("active")),
  "不可派原因要说清是没有采集就绪的单元",
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

// 就绪度那一组的 platform 是必填：缺了就没法把面归属到某个平台（会静默派错面）。
let missingPlatform: unknown;
try {
  normalizeContentCatalog({
    catalog_version: 1,
    superseded_by: null,
    templates: [],
    readiness: [
      {
        families: [
          {
            family: "HostMetrics",
            active_units: 1,
            parse_ready_units: 1,
            total_units: 1,
            ready: true,
            parse_ready: true,
          },
        ],
      },
    ],
  });
} catch (error) {
  missingPlatform = error;
}
assert(missingPlatform instanceof Error, "缺就绪度组的 platform 必须抛错");

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

// --- 6b. 来源「可采 / 未接」判据（与 agentd 的 `is_executable_source` 同口径）--
//
// 页面要是把这个判据写歪，就会出现「页面说可采、agent 拿到后报 unsupported」这种
// 没人能发现的矛盾；下面把两侧共同认的几条边界锁住。
assert(isExecutableSource("FileGlob", "/var/log/app.log"), "显式绝对路径可采");
assert(!isExecutableSource("FileGlob", "/var/log/app*"), "通配路径不算可采");
assert(!isExecutableSource("FileGlob", "~/Library/Logs/a.log"), "~ 不展开，不算可采");
assert(isExecutableSource("MetricInterval", "15s"), "指标周期可采");
assert(!isExecutableSource("Exporter", "last,lastb"), "导出器还没接");
assert(!isExecutableSource("UnifiedLogPredicate", "syspolicyd"), "统一日志谓词还没接");
assert(isExplicitPath("/var/log/app.log"), "绝对路径无通配 = 显式路径");
assert(!isExplicitPath("/var/log/app?.log"), "? 也是通配元字符");
assert(!isExplicitPath("/var/log/app[12].log"), "[ 也是通配元字符");
assert(unsupportedSourceReason("FileGlob", "/var/log/app.log") === null, "可采来源不该报原因");
assert(
  (unsupportedSourceReason("FileGlob", "/var/log/app*") ?? "").includes("通配"),
  "通配要说清原因",
);
assert(
  (unsupportedSourceReason("Exporter", "last") ?? "").includes("导出器"),
  "导出器要说清原因",
);
assert(
  unsupportedSourceCount(metricsOnly) === 1,
  "上面那份 spec 里只有 FileGlob /x/* 未接（两条 MetricInterval 都可采）",
);

// --- 6c. 「在采的日志文件」= work.json tasks 的来源 --------------------------
//
// 只有可采的 FileGlob 会变成采集文件；指标不是文件，通配/谓词今天采不到。
const mixed = parseWorkSpec(
  JSON.stringify({
    units: [
      {
        unit_id: "a",
        capability: "collect_logs",
        rule_ref: "r",
        requires_privilege: "none",
        sources: [
          { kind: "FileGlob", target: "/var/log/system.log" },
          { kind: "FileGlob", target: "/var/log/system.log.*" },
          { kind: "UnifiedLogPredicate", target: "syspolicyd" },
        ],
      },
      {
        unit_id: "b",
        capability: "collect_metrics",
        rule_ref: "r",
        requires_privilege: "none",
        sources: [{ kind: "MetricInterval", target: "15s" }],
      },
    ],
  }),
);
const collectedFiles = collectedLogFiles(mixed);
assert(
  collectedFiles.length === 1 && collectedFiles[0] === "/var/log/system.log",
  "只有可采的 FileGlob 会变成采集文件",
);
assert(
  collectedLogFiles(metricsOnly).length === 0,
  "纯通配/指标的工作不产生日志文件",
);

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

// --- 9. 本机自报并进工作卡之后留下的两条判据 --------------------------------
// 同一路径被两份工作声明 = agentd 会把它 tail 两遍。原先这件事靠一张汇总表看出来，
// 汇总表并进各卡的「在采文件」行之后就只剩这个判据，所以它必须准。
const fileSource = (target: string) => ({
  kind: "FileGlob",
  target,
  multiline: "none",
});
const sharedSpec = JSON.stringify({
  units: [
    {
      unit_id: "u1",
      capability: "collect_logs",
      rule_ref: "",
      requires_privilege: "none",
      sources: [fileSource("/var/log/shared.log"), fileSource("/var/log/only-a.log")],
    },
  ],
});
const singleSpec = JSON.stringify({
  units: [
    {
      unit_id: "u2",
      capability: "collect_logs",
      rule_ref: "",
      requires_privilege: "none",
      sources: [fileSource("/var/log/shared.log")],
    },
  ],
});
const asWork = (family: string, raw: string) =>
  ({
    workId: `work-${family}`,
    family,
    spec: parseWorkSpec(raw),
  }) as unknown as StandingWork;

const sharedPaths = duplicatedCollectedPaths([
  asWork("A", sharedSpec),
  asWork("B", singleSpec),
]);
assert(
  sharedPaths.get("/var/log/shared.log")?.join(",") === "A,B",
  `两份工作采同一路径必须报出来：${JSON.stringify([...sharedPaths])}`,
);
assert(!sharedPaths.has("/var/log/only-a.log"), "只被一份工作采的路径不算重复");
assert(
  duplicatedCollectedPaths([asWork("A", sharedSpec)]).size === 0,
  "只有一份工作时没有重复",
);
assert(
  duplicatedCollectedPaths([
    asWork("A", sharedSpec),
    asWork("A", sharedSpec),
  ]).size === 0,
  "同一个面不把自己算成两遍（否则每张卡都会自称重复采集）",
);

// 本机执行阶段：网关只知道「已派发/已接受」，阶段是 agent 侧才有的词，要给出中文口径。
assert(localExecutionLabel("unexecuted") === "未开始", "本机执行阶段要有中文口径");
assert(localExecutionLabel("executed") === "已执行", "本机执行阶段要有中文口径");
assert(localExecutionLabel("wat") === "wat", "认不出的阶段原样露出，不编造");

console.log(
  "agent work contract ok: request shapes + spec parsing (fail loud) + drift三态 + grant gate + closed sets + 503/409 + 本机工作 local",
);
