import { strict as assert } from "node:assert";
import type {
  AgentPurposeView,
  AgentWorkView,
  ContentCatalogView,
  StandingWork,
} from "../src/types";
import {
  countHostGrantStates,
  resolveHostGrantState,
} from "../src/components/collectionGrantState";

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
