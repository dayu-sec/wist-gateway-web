import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ApiError, type PlanTargetView } from "../src/api";
import {
  PLAN_WINDOW_MS,
  RESULT_LIST_LIMIT,
  buildResponsePlan,
  isResponseGrantError,
  pinnedActionId,
} from "../src/lib/responseLaunch";

// 契约测试：「发起响应」的三条纯逻辑。
//
// 锁住三件事（都是**会在现场咬人**的那种）：
//   1. 计划窗口 ≥ 审批单 TTL：审批是「换台机器投票 + 签名」，窗口太短会导致
//      「票投了、计划过期、永远签不成」；
//   2. 计划形状：不带 attestation / approval_ref 为 null / required_capabilities 就是这一步的 op ——
//      网关靠它做下发前的能力闸；
//   3. 授权单类错误要能被识别（页面据此给「去签授权单」入口），
//      以及「详情」深链接指向的动作不在最近列表时，必须知道要单条读取。
//
// Usage: npm run test:response-launch

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

const target: PlanTargetView = {
  agentId: "agent-x",
  instanceId: "host-x",
  nodeId: "host-x",
  hostName: "Host-X.local",
  platform: "macos",
  arch: "aarch64",
};

const plan = buildResponsePlan({
  target,
  op: "disk.cleanup.apply",
  risk: "R2",
  actionId: "act_apply_test",
  reason: "cleanup tmp older than 24h",
  args: { target: "tmp", min_age_hours: 24, max_files: 100, max_bytes: 1024 },
});

// ① 计划窗口：必须与审批单 TTL 同量级（24h），绝不能回到 30 分钟
assert(PLAN_WINDOW_MS === 24 * 60 * 60 * 1000, "计划窗口应当是 24 小时");
const compiled = Date.parse(plan.meta.compiled_at);
const expires = Date.parse(plan.meta.expires_at);
assert(Number.isFinite(compiled), "compiled_at 必须可解析");
assert(Number.isFinite(expires), "expires_at 必须可解析");
assert(
  expires - compiled === PLAN_WINDOW_MS,
  `expires_at 必须正好晚 ${PLAN_WINDOW_MS}ms，实际 ${expires - compiled}`,
);
assert(
  expires - compiled > 30 * 60 * 1000,
  "窗口必须长于 30 分钟：否则审批慢一点，计划先过期，CLI 直接拒签",
);

// ② 计划形状
assert(plan.api_version === "v1" && plan.kind === "action_plan", "计划首部");
assert(plan.meta.action_id === "act_apply_test", "action_id 透传");
assert(plan.meta.request_id === plan.meta.action_id, "request_id 跟 action_id 一致");
assert(plan.meta.plan_version === 1, "plan_version");
assert(plan.meta.template_id === null, "template_id 为空");

assert(plan.target.agent_id === target.agentId, "target.agent_id 透传");
assert(plan.target.instance_id === target.instanceId, "target.instance_id 透传");
assert(plan.target.node_id === target.nodeId, "target.node_id 透传");
assert(plan.target.host_name === target.hostName, "target.host_name 透传");
assert(plan.target.platform === "macos", "platform 来自事实摘要，不能写死");
assert(plan.target.arch === "aarch64", "arch 来自事实摘要，不能写死");
assert(
  Object.keys(plan.target.selectors).length === 0,
  "selectors 为空对象（不能是 undefined）",
);

assert(plan.constraints.risk_level === "R2", "风险等级透传");
assert(plan.constraints.approval_ref === null, "审批单号由网关铸，客户端必须送 null");
assert(
  plan.constraints.approval_mode === "not_required",
  "客户端只说“我这里不需要审批”，网关会改成 required",
);
assert(plan.constraints.requested_by === "admin-ui", "发起人标识");
assert(
  plan.constraints.required_capabilities.length === 1 &&
    plan.constraints.required_capabilities[0] === "disk.cleanup.apply",
  "required_capabilities 必须就是这一步的 op（网关据此拦“这台机器不会跑”）",
);

assert(plan.program.entry === "s1", "入口 step");
assert(plan.program.steps.length === 2, "两步：invoke + output");
assert(plan.program.steps[0].kind === "invoke", "第一步是 invoke");
assert(plan.program.steps[0].op === "disk.cleanup.apply", "invoke 的 op");
assert(
  plan.program.steps[0].args?.target === "tmp",
  "args 原样透传（执行侧校验，前端不改写）",
);
assert(
  plan.program.steps[1].kind === "output" && plan.program.steps[1].op === null,
  "第二步是 output，且没有 op",
);
assert(
  (plan as { attestation?: unknown }).attestation === undefined,
  "计划不能自带 attestation：签发在审批机/网关上，客户端带来的会被网关拒",
);

// ③ 授权单类错误：页面靠它决定要不要给「去签授权单」入口
for (const code of [
  "response_grant_missing",
  "response_grant_revoked",
  "response_grant_expired",
  "response_grant_not_yet_valid",
  "response_grant_insufficient",
]) {
  assert(
    isResponseGrantError(new ApiError(403, "/x", { code })),
    `${code} 必须被判成“需要授权单”`,
  );
}
for (const code of ["action_plan_capability_missing", "approval_expired", "internal"]) {
  assert(
    !isResponseGrantError(new ApiError(409, "/x", { code })),
    `${code} 不该被当成授权单问题`,
  );
}
assert(!isResponseGrantError(new Error("boom")), "非 ApiError 不判");
assert(!isResponseGrantError(null), "null 不判");

// ④ 「详情」深链接：不在最近列表里才单条读取（否则同一条会渲染两次）
const listed = [{ actionId: "act-1" }, { actionId: "act-2" }];
assert(pinnedActionId(listed, "act-1") === null, "已在列表里 → 用列表项");
assert(
  pinnedActionId(listed, "act-older") === "act-older",
  "不在列表里 → 必须单条读取（否则点进来一片空白）",
);
assert(pinnedActionId(listed, "") === null, "没指定动作 → 不钉");
assert(pinnedActionId(listed, "   ") === null, "空白等于没指定");
assert(
  pinnedActionId(listed, " act-older ") === "act-older",
  "两端的空白要去掉再比",
);
assert(RESULT_LIST_LIMIT === 50, "列表上限应当取网关的最大值");

// ⑤ 源码闸：这些规则不能被“再内联回去”
const page = readFileSync(
  fileURLToPath(
    new URL("../src/components/ResponseLaunchPanel.tsx", import.meta.url),
  ),
  "utf8",
);
assert(
  page.includes("buildResponsePlan(") && !page.includes("function buildPlan("),
  "页面必须用 lib 里的 buildResponsePlan（窗口/形状只能有一份实现）",
);
assert(
  page.includes("pinnedActionId("),
  "深链接必须走 pinnedActionId（不能在组件里再手写一遍判断）",
);
assert(
  page.includes("/authorization?tab=response"),
  "授权单类错误必须给出去签授权单的链接",
);
assert(
  page.includes("styles.errorAction"),
  "链接要有自己的样式类（与正文区分）",
);

console.log("response launch contract OK");
