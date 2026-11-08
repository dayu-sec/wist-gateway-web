import { strict as assert } from "node:assert";
import type {
  AgentPurposeView,
  AgentWorkView,
  ContentCatalogView,
  StandingWork,
} from "../src/types";
import type {
  CollectionPreflightFamilyState,
  CollectionPreflightView,
} from "../src/api";
import {
  countHostGrantStates,
  familyBadgeState,
  familySupportsPlatform,
  resolveHostGrantState,
} from "../src/components/collectionGrantState";
import { buildFamilyOverview } from "../src/components/familyOverviewRows";

/**
 * 「按采集面授权」的纯判定契约。
 *
 * 页面本身没有 jsdom 测试环境；把「这台主机对当前面是什么状态」抽成纯函数，
 * 在这里钉住：现有授权优先、未判定用途、模板不含此面、以及批量统计。
 */

const catalog: ContentCatalogView = {
  catalogVersion: 3,
  supersededBy: null,
  families: [
    {
      id: "HostMetrics",
      platforms: ["linux"],
      semanticsVersion: 1,
      nameZh: "主机指标",
      nameEn: "Host metrics",
      summaryZh: "CPU / 内存",
      summaryEn: "CPU / memory",
    },
  ],
  units: [],
  templates: [
    {
      templateId: "linux-host",
      machineClass: "LinuxHost",
      platform: "linux",
      status: "active",
      familyScope: ["HostMetrics", "LoginSession"],
      capabilityScope: ["collect_metrics"],
    },
  ],
  readiness: [
    {
      family: "HostMetrics",
      platform: "linux",
      activeUnits: 2,
      parseReadyUnits: 1,
      totalUnits: 2,
      ready: true,
      parseReady: true,
    },
  ],
};

const purpose = (machineClass: "LinuxHost" | "MacDaily"): AgentPurposeView => ({
  agentId: "agent-a",
  factSummary: null,
  suggestion: null,
  classification: {
    agentId: "agent-a",
    machineClass,
    suggestionId: null,
    decidedBy: "ops",
    decidedAt: "2026-10-26T00:00:00Z",
    note: null,
  },
  generatedAt: "2026-10-26T00:00:00Z",
});

const standing = (status: StandingWork["status"]): StandingWork => ({
  workId: "work-1",
  agentId: "agent-a",
  family: "HostMetrics",
  spec: { units: [] },
  catalogVersion: 3,
  proposalId: null,
  planVersion: 2,
  effectiveFrom: "2026-10-26T00:00:00Z",
  status,
  updatedBy: "ops",
  updatedAt: "2026-10-26T00:00:00Z",
  ack: null,
});

const work = (entries: StandingWork[]): AgentWorkView => ({
  agentId: "agent-a",
  sequence: 2,
  standing: entries,
  oneShot: [],
  retiredStanding: [],
  settledOneShot: [],
  local: null,
  generatedAt: "2026-10-26T00:00:00Z",
});

const base = {
  catalog,
  family: "HostMetrics",
  purposeLoading: false,
  workLoading: false,
};

assert.equal(
  resolveHostGrantState({
    ...base,
    purpose: purpose("LinuxHost"),
    work: work([]),
  }).kind,
  "grantable",
  "LinuxHost + 就绪面 + 无现有工作 → 可授权",
);

assert.equal(
  resolveHostGrantState({
    ...base,
    purpose: purpose("LinuxHost"),
    work: work([standing("active")]),
  }).kind,
  "granted",
  "现有 active 工作优先于可授权",
);

assert.equal(
  resolveHostGrantState({
    ...base,
    purpose: purpose("LinuxHost"),
    work: work([standing("paused")]),
  }).kind,
  "paused",
  "现有 paused 工作 → 已暂停",
);

const unclassified: AgentPurposeView = {
  ...purpose("LinuxHost"),
  classification: null,
};
assert.equal(
  resolveHostGrantState({ ...base, purpose: unclassified, work: work([]) })
    .kind,
  "unclassified",
  "没有用途判定 → 不能派活",
);

const blocked = resolveHostGrantState({
  ...base,
  purpose: purpose("MacDaily"),
  work: work([]),
});
assert.equal(blocked.kind, "blocked", "机器类别模板不含此面 → 不可授权");
assert.ok(blocked.reason && blocked.reason.length > 0, "不可授权要带原因");

// ── 预检（事实）复核：目录说「可派」不等于这台机器上真有东西可采 ──────────────
const preflightView = (
  state: CollectionPreflightFamilyState,
  reason: string | null,
): CollectionPreflightView => ({
  agentId: "agent-a",
  machineClass: "LinuxHost",
  platform: "linux",
  catalogVersion: 3,
  verdict: "partial",
  undeterminedReason: null,
  summary: "…",
  probe: {
    source: "reported",
    observedAt: "2026-10-26T00:00:00Z",
    stale: false,
    pending: false,
    pendingSince: null,
    probedPaths: [],
    presentPaths: [],
    unreadablePaths: [],
    notProbedPaths: [],
  },
  families: [
    {
      family: "HostMetrics",
      state,
      reason,
      selectedUnits: state === "grantable" ? ["linux-host-metrics"] : [],
      units: [],
    },
  ],
  generatedAt: "2026-10-26T00:00:00Z",
});

const matched = resolveHostGrantState({
  ...base,
  purpose: purpose("LinuxHost"),
  work: work([]),
  preflight: preflightView("grantable", null),
});
assert.equal(
  matched.kind,
  "grantable",
  "预检说可授权 → 仍可授权（预检不夺掉目录给的结论）",
);

const absentReason =
  "目录约定的位置没有 /opt/homebrew/var/log（服务可能装在非标准目录，尚未自动定位）";
const absent = resolveHostGrantState({
  ...base,
  purpose: purpose("LinuxHost"),
  work: work([]),
  preflight: preflightView("absent", absentReason),
});
assert.equal(
  absent.kind,
  "blocked",
  "预检 absent（单元一条都没匹配）→ 不可授权：网关 derive_spec 会回 409",
);
assert.equal(absent.preflightBlocked, true, "要标记「是预检拦的」供页面去重");
assert.equal(absent.reason, absentReason, "理由用网关那句具体原因");

assert.equal(
  resolveHostGrantState({
    ...base,
    purpose: purpose("LinuxHost"),
    work: work([]),
    preflight: preflightView("unprobed", null),
  }).kind,
  "blocked",
  "还没探（unprobed）也选不出单元，网关同样回 409：改成不可授权 + 预检按钮",
);

assert.equal(
  resolveHostGrantState({
    ...base,
    purpose: purpose("LinuxHost"),
    work: work([]),
    preflight: preflightView("source_unresolved", "找不到日志目录"),
  }).kind,
  "blocked",
  "服务在但找不到日志（source_unresolved）→ 同样选不出单元，也是 409",
);

assert.equal(
  resolveHostGrantState({
    ...base,
    purpose: purpose("LinuxHost"),
    work: work([standing("active")]),
    preflight: preflightView("absent", absentReason),
  }).kind,
  "granted",
  "现有授权优先于预检结论（不把已授权的面说成不可授权）",
);

// 所有「选不出单元」的状态一律不可授权（网关 `expand` 会把这些单元全排除）。
for (const state of [
  "absent",
  "source_unresolved",
  "unreadable",
  "agent_too_old",
  "not_ready",
] as const) {
  const resolved = resolveHostGrantState({
    ...base,
    purpose: purpose("LinuxHost"),
    work: work([]),
    preflight: preflightView(state, "why"),
  });
  assert.equal(resolved.kind, "blocked", `${state} → 不可授权`);
  assert.equal(resolved.preflightBlocked, true, `${state} 要标记来源`);
  assert.equal(resolved.reason, "why", `${state} 用网关那句原因`);
}

// 预检还没读回来：不先打「可授权」的包票（否则先绿后红，手快就点了授权）。
assert.equal(
  resolveHostGrantState({
    ...base,
    purpose: purpose("LinuxHost"),
    work: work([]),
    preflightLoading: true,
  }).kind,
  "checking",
  "预检读取中 → 检查中",
);

// 没有预检（旧网关没这个接口 / 读取失败）时保持原判：不能因为拿不到事实就全拦。
assert.equal(
  resolveHostGrantState({
    ...base,
    purpose: purpose("LinuxHost"),
    work: work([]),
    preflight: null,
  }).kind,
  "grantable",
  "没有预检结论 → 仍按目录判可授权",
);

// 预检判不了（典型：从没上报过事实）。网关此时也画不出 spec（400），不能报可授权。
const undetermined: CollectionPreflightView = {
  ...preflightView("grantable", null),
  verdict: "undetermined",
  undeterminedReason: "no_facts",
  families: [],
};
const noFacts = resolveHostGrantState({
  ...base,
  purpose: purpose("LinuxHost"),
  work: work([]),
  preflight: undetermined,
});
assert.equal(noFacts.kind, "blocked", "预检 undetermined/no_facts → 不可授权");
assert.equal(noFacts.preflightBlocked, true, "同样要标记来源");
assert.ok(noFacts.reason && noFacts.reason.length > 0, "要给出「先探一次」的原因");
assert.equal(
  resolveHostGrantState({
    ...base,
    purpose: purpose("LinuxHost"),
    work: work([]),
    preflight: { ...preflightView("grantable", null), families: [] },
  }).kind,
  "grantable",
  "预检里没有这个面（面不在模板 scope）→ 保持目录判定",
);

assert.equal(
  resolveHostGrantState({
    ...base,
    purpose: purpose("LinuxHost"),
    workLoading: true,
  }).kind,
  "checking",
  "查询未完成 → 检查中",
);

const counts = countHostGrantStates([
  { kind: "grantable" },
  { kind: "grantable" },
  { kind: "granted" },
  { kind: "blocked" },
  { kind: "paused" },
  { kind: "checking" },
  { kind: "error" },
]);
assert.deepEqual(
  { ...counts },
  {
    checking: 1,
    unclassified: 0,
    blocked: 1,
    grantable: 2,
    granted: 1,
    paused: 1,
    error: 1,
  },
  "按状态计数",
);

console.log("collection grant state: OK");

// ── 平台筛选：面级「全部 / 部分 / 具体平台」与支持关系 ───────────────────────
const mixedCatalog: ContentCatalogView = {
  ...catalog,
  families: [
    {
      ...catalog.families[0],
      platforms: ["linux", "macos"],
    },
  ],
  readiness: [
    ...catalog.readiness,
    {
      family: "HostMetrics",
      platform: "macos",
      activeUnits: 0,
      parseReadyUnits: 0,
      totalUnits: 1,
      ready: false,
      parseReady: false,
    },
  ],
};
const mixedRow = buildFamilyOverview(mixedCatalog)[0];
assert.ok(mixedRow, "mixed family row 应存在");
assert.equal(familySupportsPlatform(mixedRow, "linux"), true);
assert.equal(familySupportsPlatform(mixedRow, "macos"), true);
assert.equal(
  familyBadgeState(mixedRow, "all"),
  "partial",
  "跨平台聚合 → 部分就绪",
);
assert.equal(
  familyBadgeState(mixedRow, "linux"),
  "ready",
  "Linux 面本身已就绪",
);
assert.equal(
  familyBadgeState(mixedRow, "macos"),
  "draft",
  "macOS 有单元但未 active",
);
assert.equal(
  familySupportsPlatform(buildFamilyOverview(catalog)[0], "macos"),
  false,
  "只声明 Linux 的面不应出现在 macOS tab",
);

/**
 * 平台不支持的面：模板存在、但该面只在别的平台上提供。
 *
 * 现实例子就是「macOS 开发机想采容器日志」：`ContainerWorkload` 只有 Linux 单元 ——
 * macOS 的容器跑在 VMware/VirtioFS 的虚拟机里（OrbStack / Docker Desktop 都是一个盘镜像），
 * 宿主文件系统上没有 `*-json.log` 可采。
 *
 * 文案**不能**让人读成「这台机器没有容器/数据库」：macOS 上这些东西是存在的，
 * 缺的是我们的采集单元。否则运维会去查“是不是没装”。
 */
const macCatalog: ContentCatalogView = {
  ...catalog,
  families: [
    ...catalog.families,
    {
      ...catalog.families[0],
      id: "ContainerWorkload",
      platforms: ["linux"],
      nameZh: "容器日志",
      nameEn: "Container logs",
    },
  ],
  templates: [
    ...catalog.templates,
    {
      templateId: "macos-daily",
      machineClass: "MacDaily",
      platform: "macos",
      status: "active",
      familyScope: ["HostMetrics"],
      capabilityScope: ["collect_metrics"],
    },
  ],
};

const unsupported = resolveHostGrantState({
  catalog: macCatalog,
  family: "ContainerWorkload",
  purpose: purpose("MacDaily"),
  work: work([]),
  purposeLoading: false,
  workLoading: false,
});
assert.equal(unsupported.kind, "blocked", "平台不支持 → 不可授权");
assert.ok(
  unsupported.reason?.includes("Linux") &&
    unsupported.reason?.includes("macOS"),
  `原因要点明平台，而不是「模板不包含」：${unsupported.reason}`,
);
// 「还没接入」而不是「机器上没有」：macOS 上容器是存在的，缺的是采集单元。
assert.ok(
  unsupported.reason?.includes("还没接入") &&
    !unsupported.reason?.includes("这台机器没有"),
  `不得断言机器没有该能力：${unsupported.reason}`,
);

// 对照组：同一台机器、模板里**有**的面，不该被说成「平台不支持」。
const macHostMetrics = resolveHostGrantState({
  catalog: macCatalog,
  family: "HostMetrics",
  purpose: purpose("MacDaily"),
  work: work([]),
  purposeLoading: false,
  workLoading: false,
});
assert.equal(
  macHostMetrics.kind,
  "blocked",
  "HostMetrics 在 macOS 上没有就绪单元 —— 这一条是就绪度问题，不是平台问题",
);
assert.ok(
  !(macHostMetrics.reason ?? "").includes("上提供"),
  `模板内的面不能被说成「平台不支持」：${macHostMetrics.reason}`,
);
