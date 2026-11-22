import {
  fetchActionApproval,
  fetchActionApprovals,
  issueActionApproval,
  normalizeActionApproval,
  setAdminApiToken,
  voteActionApproval,
} from "../src/api/admin";

// 契约测试：管理面「响应审批」的读写路径与响应形状。
//
// 锁住四件事：
//   1. 路径与方法：`GET /approvals`、`GET /approvals/{id}`、
//      `POST /approvals/{id}/votes`、`POST /approvals/{id}/issue?dispatch=…`；
//   2. **投票体只有 `decision` / `comment`**：审批人身份必须由服务端从 token 派生，
//      前端多发一个 `approver` 字段会让人以为身份可自填；
//   3. 空评论**不发**（`comment: ""` 与 `null` 在网关侧语义不同）；
//   4. 列表项不带计划原文（`plan` / `issued_plan` 为 null），详情才带 ——
//      两者不能混：混了会把「列表不带」显示成「计划没了」。
//
// Usage: npm run test:approval

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

function approvalPayload(overrides: Record<string, unknown> = {}) {
  return {
    approval_id: "apv_agent-x_1795338980988065_9f2c1a7b",
    agent_id: "agent-x",
    plan_digest: `plan-v1:sha256:${"a".repeat(64)}`,
    risk_level: "R2",
    requested_by: "admin:9f2c1a7b3d40",
    reason: "clear expired temp files",
    requested_at: "2026-11-22T10:00:00Z",
    expires_at: "2026-11-23T10:00:00Z",
    required_approvers: 1,
    status: "pending",
    approved_at: null,
    votes: [],
    issued: false,
    plan: null,
    issued_plan: null,
    ...overrides,
  };
}

function reset() {
  recorded = [];
  responder = () => Response.json({});
}

async function listPath() {
  reset();
  responder = () => Response.json([approvalPayload()]);
  const approvals = await fetchActionApprovals();
  assert(recorded.length === 1, "list issues exactly one request");
  assert(
    recorded[0].url === "/api/v1/admin/approvals",
    `unexpected list path: ${recorded[0].url}`,
  );
  assert(recorded[0].method === "GET", "list must be GET");
  assert(
    recorded[0].authorization === "Bearer admin-token-under-test",
    "list must carry the admin bearer token",
  );
  assert(approvals.length === 1, "list returns one approval");
  assert(approvals[0].agentId === "agent-x", "agent id is normalized");
  assert(approvals[0].plan === null, "list items carry no plan body");
  assert(approvals[0].issuedPlan === null, "list items carry no issued plan");
}

async function listWithAgentFilter() {
  reset();
  responder = () => Response.json([approvalPayload()]);
  await fetchActionApprovals("agent x/1");
  assert(
    recorded[0].url === "/api/v1/admin/approvals?agent_id=agent%20x%2F1",
    `agent filter must be encoded: ${recorded[0].url}`,
  );
}

async function detailIncludesPlan() {
  reset();
  responder = () =>
    Response.json(
      approvalPayload({
        plan: { kind: "action_plan", meta: {} },
        issued_plan: { kind: "action_plan", attestation: { key_id: "k1" } },
      }),
    );
  const approval = await fetchActionApproval("apv-1");
  assert(
    recorded[0].url === "/api/v1/admin/approvals/apv-1",
    `unexpected detail path: ${recorded[0].url}`,
  );
  assert(approval.plan !== null, "detail carries the plan body");
  assert(approval.issuedPlan !== null, "detail carries the issued plan");
}

async function voteWithoutCommentOmitsField() {
  reset();
  responder = () => Response.json(approvalPayload({ status: "approved" }));
  const approval = await voteActionApproval("apv-1", "approve");
  assert(
    recorded[0].url === "/api/v1/admin/approvals/apv-1/votes",
    `unexpected vote path: ${recorded[0].url}`,
  );
  assert(recorded[0].method === "POST", "vote must be POST");
  const body = JSON.parse(recorded[0].body) as Record<string, unknown>;
  assert(body.decision === "approve", "vote carries the decision");
  assert(
    !("comment" in body),
    "empty comment must be omitted, not sent as an empty string",
  );
  assert(
    !("approver" in body),
    "the client must never send an approver — identity comes from the token",
  );
  assert(approval.status === "approved", "status is normalized");
}

async function voteWithCommentTrims() {
  reset();
  responder = () => Response.json(approvalPayload({ status: "rejected" }));
  await voteActionApproval("apv-1", "reject", "  not today  ");
  const body = JSON.parse(recorded[0].body) as Record<string, unknown>;
  assert(body.decision === "reject", "reject decision");
  assert(
    body.comment === "not today",
    `comment must be trimmed: ${body.comment}`,
  );
}

async function issueDispatchesByDefault() {
  reset();
  responder = () =>
    Response.json({
      ...approvalPayload({ status: "approved", issued: true }),
      dispatched_command_id: "cmd_agent-x_plan_1",
    });
  const result = await issueActionApproval("apv-1");
  assert(
    recorded[0].url === "/api/v1/admin/approvals/apv-1/issue?dispatch=true",
    `unexpected issue path: ${recorded[0].url}`,
  );
  assert(recorded[0].method === "POST", "issue must be POST");
  assert(result.approval.issued === true, "issued flag is normalized");
  assert(
    result.dispatchedCommandId === "cmd_agent-x_plan_1",
    "dispatched command id is surfaced",
  );
}

async function issueCanSkipDispatch() {
  reset();
  responder = () =>
    Response.json({
      ...approvalPayload({ status: "approved", issued: true }),
      dispatched_command_id: null,
    });
  const result = await issueActionApproval("apv-1", false);
  assert(
    recorded[0].url === "/api/v1/admin/approvals/apv-1/issue?dispatch=false",
    `unexpected issue path: ${recorded[0].url}`,
  );
  assert(
    result.dispatchedCommandId === null,
    "dispatch=false must report no dispatched command",
  );
}

function rejectsUnknownVoteDecision() {
  let threw = false;
  try {
    normalizeActionApproval(
      approvalPayload({
        votes: [
          {
            approver: "admin:9f2c1a7b3d40",
            decision: "maybe",
            comment: null,
            voted_at: "2026-11-22T10:05:00Z",
          },
        ],
      }),
    );
  } catch {
    threw = true;
  }
  assert(threw, "an unknown vote decision must throw, not be silently dropped");
}

function normalizesVotes() {
  const approval = normalizeActionApproval(
    approvalPayload({
      status: "approved",
      approved_at: "2026-11-22T10:05:00Z",
      votes: [
        {
          approver: "admin:9f2c1a7b3d40",
          decision: "approve",
          comment: null,
          voted_at: "2026-11-22T10:05:00Z",
        },
      ],
    }),
  );
  assert(approval.votes.length === 1, "one vote");
  assert(approval.votes[0].approver === "admin:9f2c1a7b3d40", "approver");
  assert(approval.votes[0].comment === null, "null comment stays null");
  assert(approval.approvedAt === "2026-11-22T10:05:00Z", "approved_at");
}

async function main() {
  await listPath();
  await listWithAgentFilter();
  await detailIncludesPlan();
  await voteWithoutCommentOmitsField();
  await voteWithCommentTrims();
  await issueDispatchesByDefault();
  await issueCanSkipDispatch();
  rejectsUnknownVoteDecision();
  normalizesVotes();
  console.log("approval contract OK");
}

// 必须 catch：`main` 是 async，若断言在某个 `await` 之后失败，未处理的 rejection
// **不会**让进程非零退出，测试会「假通过」。仓库既有范式见 tests/investigation-contract.test.ts。
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
