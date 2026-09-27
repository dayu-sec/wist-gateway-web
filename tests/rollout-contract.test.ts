import {
  ApiError,
  advanceRolloutPlan,
  approveRolloutPlan,
  createRolloutPlan,
  fetchRolloutPlan,
  fetchRolloutPlans,
  jsonUpgradeSpec,
  normalizeRolloutPlan,
  normalizeRolloutPlanDetail,
  parseUpgradeSpec,
  setAdminApiToken,
} from "../src/api/admin";
import {
  advanceRuleLabel,
  countEntries,
  currentPhase,
  entryStatusLabel,
  entryStatusTone,
  phaseIncompleteCount,
  phaseSettled,
  phaseStatusLabel,
  planStatusLabel,
  planStatusTone,
  planTargetCount,
} from "../src/components/rolloutStatus";
import {
  PHASE_COUNTS,
  availablePhaseCounts,
  phaseScaleLabel,
  planPhases,
  selectUpgradeTargets,
} from "../src/components/agentUpgradePhases";

// 契约测试：管理面「灰度发布计划」（模型 `Control.Rollout` 的列表/创建/批准/推进/查看）。
//
// 后端把计划当成**编排层**：`spec` 是不透明 JSON 字符串、阶段以数组随计划返回、逐目标
// 条目靠 agentd 上报回填。这里锁住四件最容易漂移的事：
//   1. 请求形状：路径、方法、Bearer、body 字段名（`target_ids`/`advance_rule`/`plan_id`）；
//   2. `spec` 的拼/解：空的可选字段不能写成 ""，坏 JSON 要能被页面说出来；
//   3. 阶段与条目的派生：目标计数去重、是否全部了结、当前阶段；
//   4. 状态口径与闭合兜底：认不出的状态原样露出、404 透出 ApiError。
//
// Usage: npm run test:rollout

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

const PLAN_ID = "plan-abc123def456";

function phasePayload(overrides: Record<string, unknown> = {}) {
  return {
    phase_index: 1,
    target_ids: ["agent-canary"],
    advance_rule: "manual",
    status: "pending",
    ...overrides,
  };
}

function planPayload(overrides: Record<string, unknown> = {}) {
  return {
    plan_id: PLAN_ID,
    action: "upgrade",
    spec: JSON.stringify({
      target_version: "0.1.4",
      package_url: "https://mirror/wist-agentd.tar.gz",
    }),
    deadline_at: "2026-10-01T00:00:00Z",
    timeout_seconds: 600,
    phases: [
      phasePayload({ phase_index: 1, target_ids: ["agent-canary"] }),
      phasePayload({
        phase_index: 2,
        target_ids: ["agent-b", "agent-c"],
        advance_rule: "success_rate:80",
      }),
    ],
    batch_size: 1,
    current_phase: 1,
    status: "rolling",
    created_by: "admin",
    created_at: "2026-09-25T00:00:00Z",
    approved_by: "admin",
    approved_at: "2026-09-25T00:01:00Z",
    ...overrides,
  };
}

// --- 1. 列表：路径 + 规范化 + 阶段数组 --------------------------------------
recorded = [];
responder = () => Response.json([planPayload()]);

const plans = await fetchRolloutPlans();
assert(recorded[0].url === "/api/v1/admin/rollout-plans", "list path");
assert(recorded[0].method === "GET", "list must be GET");
assert(
  recorded[0].authorization === "Bearer admin-token-under-test",
  "list must send the admin bearer",
);
assert(plans.length === 1, "list must return the plans");
const plan = plans[0];
assert(plan.planId === PLAN_ID, "plan_id was not normalized");
assert(plan.currentPhase === 1, "current_phase was not normalized");
assert(plan.batchSize === 1, "batch_size was not normalized");
assert(plan.phases.length === 2, "phases must carry through");
assert(plan.phases[1].phaseIndex === 2, "phase_index was not normalized");
assert(
  plan.phases[1].advanceRule === "success_rate:80",
  "advance_rule was not normalized",
);
assert(
  plan.phases[1].targetIds.length === 2 &&
    plan.phases[1].targetIds[1] === "agent-c",
  "target_ids were not normalized",
);
assert(plan.approvedBy === "admin", "approved_by was not normalized");

// 目标计数按阶段去重（同一目标只属于一个阶段，但视图仍要防重）。
assert(planTargetCount(plan) === 3, "plan target count must de-duplicate");

// --- 2. 详情：路径编码 + 条目 ------------------------------------------------
recorded = [];
responder = () =>
  Response.json({
    plan: planPayload(),
    entries: [
      {
        target_id: "agent-canary",
        work_id: "work-plan-abc-agent-canary",
        status: "succeeded",
        detail: "",
        updated_at: "2026-09-25T00:02:00Z",
      },
      {
        target_id: "agent-b",
        work_id: null,
        status: "pending",
        detail: "",
        updated_at: "2026-09-25T00:00:00Z",
      },
    ],
  });

const detail = await fetchRolloutPlan(PLAN_ID);
assert(
  recorded[0].url === `/api/v1/admin/rollout-plans/${PLAN_ID}`,
  "detail path",
);
assert(detail.plan.planId === PLAN_ID, "detail plan was not normalized");
assert(detail.entries.length === 2, "detail entries must carry through");
assert(
  detail.entries[0].workId === "work-plan-abc-agent-canary",
  "entry work_id was not normalized",
);
assert(detail.entries[1].workId === null, "a not-yet-dispatched entry has null work_id");

// --- 3. 阶段与条目的派生 ---------------------------------------------------
const counts = countEntries(detail.entries);
assert(
  counts.total === 2 && counts.succeeded === 1 && counts.pending === 1,
  "entry counts must be bucketed by status",
);

const phaseOne = plan.phases[0]; // target: agent-canary
const activePhase = currentPhase(plan);
assert(activePhase?.phaseIndex === 1, "currentPhase must map current_phase to a phase");

// agent-canary 已成功 → 阶段 1 了结；阶段 2 仍 pending（未派发）→ 未了结。
assert(
  phaseSettled(phaseOne, detail.entries),
  "phase 1 must be settled (its only target succeeded)",
);
assert(
  !phaseSettled(plan.phases[1], detail.entries),
  "phase 2 must not be settled (targets still pending)",
);
assert(
  phaseIncompleteCount(plan.phases[1], detail.entries) === 2,
  "phase 2 has two incomplete targets",
);

// --- 4. 创建：body 形状 + spec 拼装 ----------------------------------------
recorded = [];
responder = () => Response.json(planPayload({ status: "draft", phases: [phasePayload()] }));

const created = await createRolloutPlan({
  action: "upgrade",
  spec: jsonUpgradeSpec({
    packageUrl: "/srv/wist/wist-agentd-0.1.4.tar.gz",
    packageSha256: `sha256:${"a".repeat(64)}`,
  }),
  phases: [
    { targetIds: ["agent-canary"], advanceRule: "manual" },
    { targetIds: ["agent-b", "agent-c"], advanceRule: "success_rate:80" },
  ],
  deadlineAt: "2026-10-01T00:00:00Z",
  timeoutSeconds: 600,
  batchSize: 1,
});
assert(
  recorded[0].url === "/api/v1/admin/rollout-plans",
  "create path",
);
assert(recorded[0].method === "POST", "create must be POST");
const createBody = JSON.parse(recorded[0].body);
assert(createBody.action === "upgrade", "create must carry the action");
assert(createBody.deadline_at === "2026-10-01T00:00:00Z", "create must carry deadline_at");
assert(createBody.timeout_seconds === 600, "create must carry timeout_seconds");
assert(createBody.batch_size === 1, "create must carry batch_size");
assert(Array.isArray(createBody.phases) && createBody.phases.length === 2, "create must carry phases");
assert(
  createBody.phases[1].target_ids[1] === "agent-c" &&
    createBody.phases[1].advance_rule === "success_rate:80",
  "phases must use the snake_case field names the gateway expects",
);
assert(created.status === "draft", "create returns a draft plan");

// spec 只写 package_url / package_sha256：`target_version` **留空就不写** —— 新 agentd 会从包内
// agentd 自报的版本取；但**旧 agentd 要求这个键存在**，所以升级旧 Agent 时要把它填上。
const localSpec = JSON.parse(
  jsonUpgradeSpec({
    packageUrl: "/srv/wist/wist-agentd.tar.gz",
    packageSha256: "sha256:abc",
  }),
);
assert(
  localSpec.package_url === "/srv/wist/wist-agentd.tar.gz",
  "spec must pass a target-host absolute path through verbatim",
);
assert(localSpec.package_sha256 === "sha256:abc", "spec must carry package_sha256");
assert(
  !("target_version" in localSpec),
  "留空就不写 target_version（版本由包内 agentd 自报决定）",
);

// 填了就写进去（升级还没跟上的旧 agent 需要这个键）。
const explicitTarget = JSON.parse(
  jsonUpgradeSpec({
    targetVersion: "0.1.5",
    packageUrl: "/srv/wist/p.tar.gz",
    packageSha256: "abc",
  }),
);
assert(explicitTarget.target_version === "0.1.5", "填了目标版本就写进去");

const blankSpec = JSON.parse(jsonUpgradeSpec({ packageUrl: "", packageSha256: "" }));
assert(
  "package_url" in blankSpec && "package_sha256" in blankSpec,
  "package_url / package_sha256 键必须始终在（UpgradeSpec 对它们没有 serde default）",
);

// --- 5. 批准 / 推进：body 形状 ---------------------------------------------
recorded = [];
responder = () => Response.json(planPayload({ status: "rolling" }));
await approveRolloutPlan(PLAN_ID);
assert(
  recorded[0].url === "/api/v1/admin/rollout-plans/approve",
  "approve path",
);
assert(recorded[0].method === "POST", "approve must be POST");
assert(
  JSON.parse(recorded[0].body).plan_id === PLAN_ID,
  "approve must carry plan_id",
);

recorded = [];
responder = () => Response.json(planPayload({ current_phase: 2 }));
await advanceRolloutPlan(PLAN_ID);
assert(
  recorded[0].url === "/api/v1/admin/rollout-plans/advance",
  "advance path",
);
assert(
  JSON.parse(recorded[0].body).plan_id === PLAN_ID,
  "advance must carry plan_id",
);

// --- 6. spec 解析：成功 + 失败不静默 ---------------------------------------
const parsed = parseUpgradeSpec(
  JSON.stringify({
    target_version: "0.1.5",
    package_url: "https://mirror/x.tar.gz",
    package_sha256: "abc",
  }),
);
assert(parsed.error === null, "a valid spec must parse");
assert(parsed.targetVersion === "0.1.5", "target_version must parse");
assert(parsed.packageSha256 === "abc", "package_sha256 must parse");

const broken = parseUpgradeSpec("not json");
assert(broken.error !== null, "a broken spec must surface an error, not parse to empty");
assert(broken.raw === "not json", "the raw spec must be preserved for display");

// 没写 target_version 的 spec 也合法（版本由包内 agentd 自报决定）—— 不能当契约漂移。
const derived = parseUpgradeSpec(
  JSON.stringify({ package_url: "/srv/wist/p.tar.gz", package_sha256: "abc" }),
);
assert(derived.error === null, "spec 缺 target_version 不是错误");
assert(derived.targetVersion === null, "target_version 缺省读作 null");
assert(derived.packageUrl === "/srv/wist/p.tar.gz", "包地址要读出来");

// --- 7. 状态口径与闭合兜底 -------------------------------------------------
assert(planStatusLabel("draft") === "草稿（待批准）", "draft label");
assert(planStatusTone("failed") === "crit", "failed tone");
assert(planStatusLabel("wat") === "wat", "认不出的计划状态原样露出，不编造");
assert(phaseStatusLabel("rolling") === "进行中", "phase status label");
assert(entryStatusLabel("dispatched") === "执行中", "entry status label");
assert(entryStatusTone("succeeded") === "ok", "succeeded tone");
assert(entryStatusTone("failed") === "crit", "failed tone");
assert(entryStatusLabel("wat") === "wat", "认不出的条目状态原样露出");

assert(advanceRuleLabel("manual") === "人工确认后推进", "manual rule label");
assert(
  advanceRuleLabel("all_succeeded") === "本阶段全部成功自动推进",
  "all_succeeded rule label",
);
assert(
  advanceRuleLabel("success_rate:80") === "本阶段成功率 ≥ 80% 自动推进",
  "success_rate rule label",
);
assert(advanceRuleLabel("wat") === "wat", "认不出的闸门原样露出");
// 末阶段没有「下一段」：闸门不适用，全部了结后自动收尾。
assert(
  advanceRuleLabel("manual", true) === "末阶段：全部了结后自动收尾",
  "末阶段不该再说「人工确认后推进」",
);

// 缺字段的响应必须抛错（不静默成空计划）。
let missingPhase: unknown;
try {
  normalizeRolloutPlan({ plan_id: "p", action: "upgrade", spec: "{}" });
} catch (error) {
  missingPhase = error;
}
assert(missingPhase instanceof Error, "missing phases must throw");

let badDetail: unknown;
try {
  normalizeRolloutPlanDetail({ plan: planPayload() });
} catch (error) {
  badDetail = error;
}
assert(badDetail instanceof Error, "a detail without entries must throw");

// 404（未知计划）必须透出 ApiError，页面靠它区分「未知计划」与「旧构建」。
responder = () => new Response("unknown rollout plan plan-x", { status: 404 });
let notFound: unknown;
try {
  await fetchRolloutPlan("plan-x");
} catch (error) {
  notFound = error;
}
assert(notFound instanceof ApiError, "404 must surface as ApiError");
assert((notFound as ApiError).status === 404, "404 status must be preserved");
assert(
  /unknown rollout plan/.test((notFound as ApiError).detail ?? ""),
  "404 正文要保留（页面靠它区分未知计划）",
);

// --- 7b. 灰度阶段自动分配（只选阶段数，agent_id 自动切片） --------------------
const fleet = Array.from(
  { length: 100 },
  (_, index) => `agent-${String(index).padStart(3, "0")}`,
);

const five = planPhases(fleet, 5);
assert(five.error === null, "100 台分 5 阶段应可分");
assert(
  five.phases.map((phase) => phase.targetIds.length).join(",") === "1,9,20,40,30",
  `5 阶段按 1/10/30/70/剩余 切片，实际 ${five.phases
    .map((phase) => phase.targetIds.length)
    .join(",")}`,
);
assert(five.phases[0].isCanary, "第 1 批应是金丝雀（1 台）");
assert(five.phases[4].isFinal, "末批应收尾全量");

const assigned = five.phases.flatMap((phase) => phase.targetIds);
assert(assigned.length === fleet.length, "每个 Agent 恰好出现一次");
assert(new Set(assigned).size === fleet.length, "分配不得重叠");
assert(phaseScaleLabel(five.phases[0]) === "1 台（金丝雀）", "金丝雀规模文字");
assert(phaseScaleLabel(five.phases[4]) === "覆盖 ~100%", "收尾批规模文字");

for (const count of PHASE_COUNTS) {
  const plan = planPhases(fleet, count);
  assert(
    plan.error === null && plan.phases.length === count,
    `${count} 阶段的段数与分配都不应报错`,
  );
}

// 小机队：分段数不得大于台数，也不给空阶段。
const tooMany = planPhases(["a", "b"], 3);
assert(tooMany.error !== null, "2 台分不出 3 个非空阶段");
const twoOnTwo = planPhases(["a", "b"], 2);
assert(
  twoOnTwo.error === null &&
    twoOnTwo.phases.every((phase) => phase.targetIds.length === 1),
  "2 台分 2 阶段应各 1 台",
);
assert(planPhases([], 2).error !== null, "空机队要报错");

// 小机队不再多轮：可选阶段数按台数收窄。
assert(availablePhaseCounts(0).length === 0, "空机队没有可选阶段数");
assert(availablePhaseCounts(1).join(",") === "1", "单台机队退化为 1 阶段（不分批）");
assert(availablePhaseCounts(2).join(",") === "2", "2 台只够 2 阶段");
assert(availablePhaseCounts(3).join(",") === "2,3", "3 台最多 3 阶段");
assert(availablePhaseCounts(100).join(",") === "2,3,4,5", "大机队给全预设");

const single = planPhases(["only-one"], 1);
assert(single.error === null && single.phases.length === 1, "单台机队可分 1 阶段");
assert(
  single.phases[0].isFinal && !single.phases[0].isCanary,
  "单台一批算「全量」，不该叫金丝雀",
);

// --- 7c. 升级目标：排掉明确离线的机器（未知 ≠ 离线）---------------------------
const pick = selectUpgradeTargets([
  { agentId: "agent-b", status: "online" },
  { agentId: "agent-a", status: "offline" }, // 掉线：不进目标
  { agentId: "agent-d", status: "online" },
  { agentId: "agent-c", status: "" }, // 状态未知：不能当离线丢掉
]);
assert(
  pick.agentIds.join(",") === "agent-b,agent-c,agent-d",
  `只排离线的、其余保留并按 id 排序，实际 ${pick.agentIds.join(",")}`,
);
assert(pick.fleetSize === 4, "机队台数含离线");
assert(pick.offlineCount === 1, "离线台数要算出来（页面上要说）");
assert(
  selectUpgradeTargets([{ agentId: "only", status: "offline" }]).agentIds
    .length === 0,
  "全离线时目标为空（页面会报阶段错误，而不是悄悄升）",
);
assert(
  selectUpgradeTargets([]).agentIds.length === 0,
  "空机队给空目标（不是报错）",
);

console.log(
  "rollout plan contract ok: list/detail/create/approve/advance shapes + spec 拼/解(fail loud) + phase 派生 + 升级目标排除离线 + 状态口径",
);
