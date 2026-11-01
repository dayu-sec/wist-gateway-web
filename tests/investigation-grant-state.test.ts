import { strict as assert } from "node:assert";
import type { AgentInvestigationsView } from "../src/api";
import {
  countSurfaceGrantStates,
  isSurfaceGranted,
  resolveSurfaceGrantState,
  surfaceGrantTopics,
} from "../src/components/investigationGrantState";

/**
 * 「按调查面授权」的纯判定契约。
 *
 * 页面本身没有 jsdom 测试环境；把「这台主机对当前面是不是已授权 / 能不能改」
 * 抽成纯函数，在这里钉住四件事：
 *   1. **默认全关**（与采集面一致）：没有本机授权行 = 一个面都不开；
 *   2. 判的是**授权**（上界 ∩ 本机清单），不是「跑得起来」——agent 自报能力只是提示；
 *   3. 开启 / 关闭写的是**本机清单加减这一面**，不是覆盖整份清单；
 *   4. 旧构建的 `inherited`（跟随上界）仍按“已开启”解释，免得版本错配时骗人。
 */

const command = {
  agentId: "agent-a",
  commandId: null,
  kind: null,
  requestedBy: null,
  requestedAt: null,
  acknowledgedAt: null,
  outcome: null,
  detail: null,
};

/** 新网关的默认形态：没有本机行 = `topics: []`（不是 `inherited: true`）。 */
const view = (
  overrides: Partial<AgentInvestigationsView> = {},
): AgentInvestigationsView => ({
  agentId: "agent-a",
  capabilities: { surfaces: ["disk", "load"], privileged: true },
  allowedTopics: ["disk", "load", "exposure"],
  grant: { inherited: false, topics: [], updatedAt: null, updatedBy: null },
  effectiveTopics: [],
  quota: { limitPerHour: 12, usedLastHour: 1 },
  retentionDays: 7,
  reportDir: { configured: true, path: "/data-plane/data/ivsrep" },
  latestCommand: command,
  reports: [],
  ...overrides,
});

/** 旧构建的形态：没有本机行时网关说“跟随上界”。 */
const legacyView = (
  overrides: Partial<AgentInvestigationsView> = {},
): AgentInvestigationsView =>
  view({
    grant: { inherited: true, topics: [], updatedAt: null, updatedBy: null },
    effectiveTopics: ["disk", "load"],
    ...overrides,
  });

const resolve = (
  target: AgentInvestigationsView | undefined,
  surface: string,
  loading = false,
  error = false,
) =>
  resolveSurfaceGrantState({
    agentId: "agent-a",
    view: target,
    loading,
    error,
    surface,
  });

// ── 默认全关：没授权过就是「未开启」，勾上只开这一面 ─────────────────────
const denied = resolve(view(), "disk");
assert.equal(denied.kind, "off", "缺行 = 全关（上界开着也不算授权）");
assert.equal(denied.granted, false);
assert.equal(denied.canToggle, true, "未开启的要能开启");
assert.equal(isSurfaceGranted(denied), false);
assert.deepEqual(
  surfaceGrantTopics(denied, "disk", true),
  ["disk"],
  "开启只加这一面 —— 不能把上界整个写进去",
);

// agent 上报了能力也不代表授权：能力只是提示。
const deniedButCapable = resolve(view(), "load");
assert.equal(deniedButCapable.kind, "off");
assert.equal(deniedButCapable.supported, true);

// ── 授权与能力是两件事 ───────────────────────────────────────────────────
// 已授权、但 agent 还没上报这个面：授权照样是开的，只是提示“等它升级”。
const grantedUnreported = resolve(
  view({
    grant: {
      inherited: false,
      topics: ["exposure"],
      updatedAt: "2026-11-01T00:00:00Z",
      updatedBy: "admin:9f2c1a7b3d40",
    },
    effectiveTopics: [],
  }),
  "exposure",
);
assert.equal(grantedUnreported.kind, "custom");
assert.equal(grantedUnreported.granted, true, "能力缺不影响授权判定");
assert.equal(grantedUnreported.supported, false);
assert.ok(
  grantedUnreported.reason?.includes("升级"),
  `已授权但能力未上报要说清楚：${grantedUnreported.reason}`,
);

// `effective_topics` 是「跑得起来」的集合（上界 ∩ 授权 ∩ 能力），不能拿它判授权。
assert.deepEqual(view().effectiveTopics, [], "fixture：默认生效集为空");
assert.equal(
  resolve(view(), "exposure").kind,
  "off",
  "授权判定不吃 effective_topics",
);

// ── 本机清单 ───────────────────────────────────────────────────────────────
const custom = resolve(
  view({
    grant: {
      inherited: false,
      topics: ["disk", "load"],
      updatedAt: "2026-11-01T00:00:00Z",
      updatedBy: "admin:9f2c1a7b3d40",
    },
  }),
  "disk",
);
assert.equal(custom.kind, "custom");
assert.equal(custom.granted, true);
assert.equal(custom.canToggle, true);

const off = resolve(
  view({
    grant: {
      inherited: false,
      topics: ["load"],
      updatedAt: "2026-11-01T00:00:00Z",
      updatedBy: "admin:9f2c1a7b3d40",
    },
  }),
  "disk",
);
assert.equal(off.kind, "off");
assert.equal(off.granted, false);
assert.equal(off.supported, true);
assert.equal(off.reason, null, "能力支持时不需要提示");

// ── 旧构建：`inherited` = 跟随上界（按已开启解释，免得版本错配时骗人） ──
const inherited = resolve(legacyView(), "disk");
assert.equal(inherited.kind, "inherited");
assert.equal(inherited.granted, true, "旧构建的继承就是已授权");
assert.equal(inherited.inherited, true);
assert.equal(inherited.canToggle, true, "已开启的也要能取消");
assert.deepEqual(
  surfaceGrantTopics(inherited, "disk", false),
  ["load", "exposure"],
  "旧构建收权 = 上界减这一面（其余面原样保留）",
);

// ── 改不了的两种：上界没开 / 旧网关 ──────────────────────────────────────
const notInCeiling = resolve(
  view({ allowedTopics: ["disk", "load"], effectiveTopics: [] }),
  "exposure",
);
assert.equal(notInCeiling.kind, "blocked");
assert.equal(notInCeiling.canToggle, false);
assert.equal(notInCeiling.granted, false);

const oldGateway = resolve(
  view({ grant: null, effectiveTopics: null }),
  "disk",
);
assert.equal(oldGateway.kind, "blocked");
assert.equal(oldGateway.canToggle, false);
assert.ok(oldGateway.reason?.length, "旧网关要说明不能改");

const noCeiling = resolve(view({ allowedTopics: null }), "disk");
assert.equal(noCeiling.kind, "blocked", "没有上界字段 ≠ 上界为空");
assert.equal(noCeiling.canToggle, false);

// ── 读改写：只动这一面 ─────────────────────────────────────────────────────
assert.deepEqual(
  surfaceGrantTopics(off, "disk", true),
  ["load", "disk"],
  "开启 = 本机清单加这一面",
);
assert.deepEqual(
  surfaceGrantTopics(custom, "disk", false),
  ["load"],
  "关闭 = 本机清单减这一面（其余面原样保留）",
);
assert.deepEqual(
  surfaceGrantTopics(custom, "load", false),
  ["disk"],
  "关别的面也只看这一面",
);
assert.deepEqual(
  surfaceGrantTopics(
    resolve(
      view({
        grant: {
          inherited: false,
          topics: ["disk"],
          updatedAt: null,
          updatedBy: null,
        },
      }),
      "disk",
    ),
    "disk",
    false,
  ),
  [],
  "关掉最后一个面 → 全关（不是一个“继承”标记）",
);
assert.equal(
  surfaceGrantTopics(inherited, "disk", true),
  null,
  "已经开着的面不写请求",
);
assert.equal(
  surfaceGrantTopics(denied, "disk", false),
  null,
  "本来就没开的面不写请求",
);
assert.equal(
  surfaceGrantTopics(notInCeiling, "exposure", true),
  null,
  "上界没开的面不写请求",
);
assert.deepEqual(
  surfaceGrantTopics(inherited, "disk", false),
  [...new Set(surfaceGrantTopics(inherited, "disk", false) ?? [])],
  "清单不能有重复面",
);

// ── 计数与状态 ──────────────────────────────────────────────────────────
const noQuery = resolve(undefined, "disk");
assert.equal(
  noQuery.kind,
  "checking",
  "还没读到（如未填 Admin Token）不算「读取失败」",
);

const counts = countSurfaceGrantStates([
  denied,
  inherited,
  custom,
  notInCeiling,
  resolve(undefined, "disk", true),
  resolve(undefined, "disk", false, true),
]);
assert.deepEqual(
  { ...counts },
  {
    inherited: 1,
    custom: 1,
    off: 1,
    blocked: 1,
    checking: 1,
    error: 1,
  },
  "按 kind 计数（页面的「已开启 / 未开启」直接取它）",
);

console.log("investigation grant state: OK");
