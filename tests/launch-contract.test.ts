import {
  dispatchActionPlan,
  fetchActionResult,
  fetchPlanTarget,
  setAdminApiToken,
  submitActionApproval,
  type ActionPlanPayload,
} from "../src/api/admin";

// 契约测试：管理面「发起响应」用到的三个端点。
//
// 锁住三件事：
//   1. 路径与方法：`GET /agents/{id}/plan-target`、`POST /agents/{id}/plans`、
//      `POST /agents/{id}/approvals`、`GET /agents/{id}/action-results/{action_id}`；
//   2. **计划体不发 `attestation`、`approval_ref` 为 null**：签发由网关做，
//      客户端自己带的证明会被网关拒（网关没有信任锚，无法判断真假）；
//   3. 结果读取原样透出 `report`（网关不镜像结构）。
//
// Usage: npm run test:launch

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

function lastCall(): Recorded {
  const call = recorded[recorded.length - 1];
  assert(call !== undefined, "expected at least one recorded call");
  return call;
}

function samplePlan(): ActionPlanPayload {
  return {
    api_version: "v1",
    kind: "action_plan",
    meta: {
      action_id: "act_preview_1",
      request_id: "act_preview_1",
      template_id: null,
      tenant_id: "tenant-default",
      environment_id: "env-default",
      plan_version: 1,
      compiled_at: "2026-11-22T10:00:00Z",
      expires_at: "2026-11-22T10:30:00Z",
    },
    target: {
      agent_id: "agent-x",
      instance_id: null,
      node_id: "node-x",
      host_name: null,
      platform: "linux",
      arch: "x86_64",
      selectors: {},
    },
    constraints: {
      risk_level: "R0",
      approval_ref: null,
      approval_mode: "not_required",
      requested_by: "admin-ui",
      reason: "preview tmp",
      max_total_duration_ms: 60000,
      step_timeout_default_ms: 30000,
      execution_profile: "agent_exec_v1",
      required_capabilities: ["disk.cleanup.preview"],
    },
    program: {
      entry: "s1",
      steps: [
        {
          id: "s1",
          kind: "invoke",
          op: "disk.cleanup.preview",
          args: { target: "tmp", min_age_hours: 24 },
        },
        { id: "s2", kind: "output", op: null },
      ],
    },
  };
}

// ── plan-target ─────────────────────────────────────────────────────────────
{
  recorded = [];
  responder = () =>
    Response.json({
      agent_id: "agent-x",
      instance_id: "node-x",
      node_id: "node-x",
      host_name: "host-x",
      platform: "linux",
      arch: "x86_64",
    });
  const target = await fetchPlanTarget("agent-x");
  const call = lastCall();
  assert(
    call.url === "/api/v1/admin/agents/agent-x/plan-target",
    `unexpected url: ${call.url}`,
  );
  assert(call.method === "GET", `expected GET, got ${call.method}`);
  assert(target.platform === "linux", "platform");
  assert(target.arch === "x86_64", "arch");
  assert(target.nodeId === "node-x", "node id");
}

// ── 下发（R0 预览）──────────────────────────────────────────────────────────
{
  recorded = [];
  responder = () => Response.json({ agent_id: "agent-x", command_id: "cmd-1" });
  const result = await dispatchActionPlan("agent-x", samplePlan());
  const call = lastCall();
  assert(
    call.url === "/api/v1/admin/agents/agent-x/plans",
    `unexpected url: ${call.url}`,
  );
  assert(call.method === "POST", `expected POST, got ${call.method}`);
  const body = JSON.parse(call.body) as Record<string, unknown>;
  assert(body.kind === "action_plan", "kind");
  assert(
    !("attestation" in body),
    "the client must never send an attestation — the gateway signs, and rejects client-carried proofs",
  );
  const constraints = body.constraints as Record<string, unknown>;
  assert(
    constraints.approval_ref === null,
    "approval_ref is minted by the gateway, not the client",
  );
  assert(result.commandId === "cmd-1", "command id");
}

// ── 提交审批（R2）───────────────────────────────────────────────────────────
{
  recorded = [];
  responder = () =>
    Response.json({
      approval_id: "apv_agent-x_1_abcd",
      agent_id: "agent-x",
      plan_digest: "plan-v1:sha256:deadbeef",
      risk_level: "R2",
      requested_by: "admin:9f2c1a7b3d40",
      reason: "cleanup",
      requested_at: "2026-11-22T10:00:00Z",
      expires_at: "2026-11-23T10:00:00Z",
      required_approvers: 1,
      status: "pending",
      approved_at: null,
      votes: [],
      issued: false,
      plan: null,
      issued_plan: null,
    });
  const approval = await submitActionApproval("agent-x", samplePlan(), "cleanup");
  const call = lastCall();
  assert(
    call.url === "/api/v1/admin/agents/agent-x/approvals",
    `unexpected url: ${call.url}`,
  );
  assert(call.method === "POST", `expected POST, got ${call.method}`);
  const body = JSON.parse(call.body) as Record<string, unknown>;
  assert(body.reason === "cleanup", "reason");
  assert(
    !("approver" in body) && !("approvers" in body),
    "the approver identity comes from the token; the client must not send one",
  );
  assert(approval.approvalId === "apv_agent-x_1_abcd", "approval id");
}

// ── 执行结果 ────────────────────────────────────────────────────────────────
{
  recorded = [];
  responder = () =>
    Response.json({
      agent_id: "agent-x",
      action_id: "act_preview_1",
      execution_id: "exec-1",
      plan_digest: "plan-v1:sha256:deadbeef",
      final_status: "succeeded",
      reported_at: "2026-11-22T10:01:00Z",
      received_at: "2026-11-22T10:01:01Z",
      report: {
        action_id: "act_preview_1",
        result: { outputs: { items: [{ name: "s1", value: { candidates: { files: 3, bytes: 4096 } } }] } },
      },
    });
  const result = await fetchActionResult("agent-x", "act_preview_1");
  const call = lastCall();
  assert(
    call.url === "/api/v1/admin/agents/agent-x/action-results/act_preview_1",
    `unexpected url: ${call.url}`,
  );
  assert(call.method === "GET", `expected GET, got ${call.method}`);
  assert(result.finalStatus === "succeeded", "final status");
  // 报文原样透出（网关不镜像结果结构）。
  const report = result.report as { result?: { outputs?: { items?: unknown[] } } };
  assert(
    Array.isArray(report.result?.outputs?.items),
    "report must be passed through as an object",
  );
}

console.log("launch contract OK");
