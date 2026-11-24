import { ApiError, type ActionPlanPayload, type PlanTargetView } from "../api";

// 「发起响应」的**纯逻辑**：计划怎么拼、哪类错误要去签授权单、深链接该指向哪一条结果。
//
// 抽出来是为了能用契约测试钉住 —— 组件里既有 hooks 又有 JSX，测不起来；
// 而这些规则一旦漂，坏的是「能不能发起」和「发起了能不能找到结果」。

/**
 * 计划的执行窗口。
 *
 * 必须**不短于**审批单 TTL（网关 `plan_approval_ttl_seconds`，本栈是 24h）：
 * 审批是「换一台机器投票 + 签名」，30 分钟经常不够 —— 而证明的有效期不允许晚于计划
 * （网关与 CLI 都校验），所以计划一过期就必然签不成（`plan already expired`），
 * 票已经投了、单还挂在「已批准」。
 */
export const PLAN_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 网关 `action-results` 列表的硬上限（`MAX_RESULT_LIST_LIMIT = 50`）。 */
export const RESULT_LIST_LIMIT = 50;

export interface ResponsePlanInput {
  target: PlanTargetView;
  op: string;
  risk: "R0" | "R2";
  args: Record<string, unknown>;
  actionId: string;
  reason: string | null;
}

/**
 * 拼一份（未签发的）计划。
 *
 * 三条刻意的形状：
 * * **不带 `attestation`**：签发在审批机/网关上，客户端自带的证明会被网关拒；
 * * **`approval_ref` 为 `null`、`approval_mode` 为 `not_required`**：审批单号由网关铸并写回
 *   （客户端填的会被覆盖），这里只是占位；
 * * **`required_capabilities` 就是这一步的 op**：网关据此在下发前拦「这台机器不会跑」。
 */
export function buildResponsePlan(input: ResponsePlanInput): ActionPlanPayload {
  const now = new Date();
  const expires = new Date(now.getTime() + PLAN_WINDOW_MS);
  return {
    api_version: "v1",
    kind: "action_plan",
    meta: {
      action_id: input.actionId,
      request_id: input.actionId,
      template_id: null,
      tenant_id: "tenant-default",
      environment_id: "env-default",
      plan_version: 1,
      compiled_at: now.toISOString(),
      expires_at: expires.toISOString(),
    },
    target: {
      agent_id: input.target.agentId,
      instance_id: input.target.instanceId,
      node_id: input.target.nodeId,
      host_name: input.target.hostName,
      platform: input.target.platform,
      arch: input.target.arch,
      selectors: {},
    },
    constraints: {
      risk_level: input.risk,
      approval_ref: null,
      approval_mode: "not_required",
      requested_by: "admin-ui",
      reason: input.reason,
      max_total_duration_ms: 60_000,
      step_timeout_default_ms: 30_000,
      execution_profile: "agent_exec_v1",
      required_capabilities: [input.op],
    },
    program: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "invoke", op: input.op, args: input.args },
        { id: "s2", kind: "output", op: null },
      ],
    },
  };
}

/**
 * 是不是「没有可用授权单」这一类错误。
 *
 * 判 `code` 而不是文案：文案会改。这类错误**必须**配一个「去签授权单」的入口 ——
 * 发起页的第一步（预览）也受授权单约束，只说一句“先签一张”等于把人锁在门外。
 */
export function isResponseGrantError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  switch (error.code) {
    case "response_grant_missing":
    case "response_grant_revoked":
    case "response_grant_expired":
    case "response_grant_not_yet_valid":
    case "response_grant_insufficient":
      return true;
    default:
      return false;
  }
}

/**
 * 深链接（`?action=`）指定的动作是否要**单条读取**。
 *
 * 返回要钉住的 action id；已在列表里就返回 `null`（用列表项渲染即可，避免同一条出现两次）。
 * 这一层存在的原因：列表只回最近 N 条，而「详情」链接的可能是更早的一次执行 ——
 * 不兜底的话，点进来会是一个什么都不展开的空白页。
 */
export function pinnedActionId(
  results: { actionId: string }[],
  requested: string,
): string | null {
  const id = requested.trim();
  if (!id) return null;
  return results.some((item) => item.actionId === id) ? null : id;
}
