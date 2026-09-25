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
  spec: jsonUpgradeSpec({ targetVersion: "0.1.4" }),
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

// spec 只有 target_version：可选字段**不写成空串**（agentd 按「有没有」决定用不用）。
const bareSpec = JSON.parse(jsonUpgradeSpec({ targetVersion: "0.1.4" }));
assert(bareSpec.target_version === "0.1.4", "spec must carry target_version");
assert(
  bareSpec.package_url === undefined && bareSpec.package_sha256 === undefined,
  "empty optional fields must be omitted, not written as empty strings",
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

console.log(
  "rollout plan contract ok: list/detail/create/approve/advance shapes + spec 拼/解(fail loud) + phase 派生 + 状态口径",
);
