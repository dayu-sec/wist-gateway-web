import {
  ApiError,
  fetchAgentRevocations,
  fetchAgentRuntimeStatus,
  liftAgentRevocation,
  revokeAgent,
  setAdminApiToken,
} from "../src/api/admin";

// 契约测试：Agent 身份与证书（§5.5 / §5.6）。
//
// 为什么单测这一块：证书状态只有 agent 本机能报（服务端握手期就验完了），而「吊销」是
// 「立即生效且跳续签持续」的切断点 —— 页面既要把它们显示出来，也要能在这里下发。
// 这里锁住：
//   1. `certificate_status` 的 snake_case → camelCase 映射；null / 缺失都映射成 null 且字段存在；
//   2. `revoked` 缺失（旧网关）默认 false，不把自己不知道的事说成「被吊销」；
//   3. 吊销 / 解除 / 列表三条请求的路径、方法、凭据与请求体；
//   4. 形状漂移必须显式失败。

interface Recorded {
  url: string;
  method: string;
  authorization: string;
  body: string;
}

let recorded: Recorded[] = [];

function baseRuntimePayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    agent_id: "agent-1",
    instance_id: "inst-1",
    version: "0.2.0",
    status: "online",
    health: "healthy",
    last_seen_at: "2026-09-26T00:00:00+00:00",
    ...overrides,
  };
}

function baseRevocation(overrides: Record<string, unknown> = {}) {
  return {
    entry_id: "denylist-agent-1",
    agent_id: "agent-1",
    reason_code: "compromised",
    denied_by: "admin",
    denied_at: "2026-09-29T00:00:00+00:00",
    retain_until: "2026-10-30T00:00:00+00:00",
    ...overrides,
  };
}

let responder: () => Response = () => Response.json(baseRuntimePayload());

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

// --- 运行态：证书状态 snake_case → camelCase --------------------------------
recorded = [];
responder = () =>
  Response.json(
    baseRuntimePayload({
      certificate_status: {
        not_after: "2026-11-04T00:00:00+00:00",
        remaining_seconds: 1_234_567,
        state: "renew_due",
        last_renewal: {
          outcome: "renewed",
          checked_at: "2026-10-08T00:00:00+00:00",
          detail: "credential renewed",
          not_after: "2026-11-04T00:00:00+00:00",
        },
      },
      revoked: true,
    }),
  );
const status = await fetchAgentRuntimeStatus("agent-1");
if (recorded.length !== 1) {
  throw new Error(
    `runtime-status must issue exactly one request, got ${recorded.length}`,
  );
}
if (!status.certificateStatus) {
  throw new Error("certificate_status must be normalized, not dropped");
}
if (
  status.certificateStatus.notAfter !== "2026-11-04T00:00:00+00:00" ||
  status.certificateStatus.remainingSeconds !== 1_234_567 ||
  status.certificateStatus.state !== "renew_due"
) {
  throw new Error("flat snake_case certificate_status was not normalized");
}
// 续签上报（§5.5）：嵌套的 last_renewal 也要 snake_case → camelCase。
if (
  status.certificateStatus.lastRenewal?.outcome !== "renewed" ||
  status.certificateStatus.lastRenewal?.checkedAt !== "2026-10-08T00:00:00+00:00" ||
  status.certificateStatus.lastRenewal?.detail !== "credential renewed"
) {
  throw new Error("nested last_renewal was not normalized");
}
if (status.revoked !== true) {
  throw new Error("revoked=true was not carried through");
}

// --- certificate_status 为 null：字段存在且为 null --------------------------
responder = () =>
  Response.json(baseRuntimePayload({ certificate_status: null }));
const nullCert = await fetchAgentRuntimeStatus("agent-1");
if (nullCert.certificateStatus !== null) {
  throw new Error("null certificate_status must map to null");
}
if (!("certificateStatus" in nullCert)) {
  throw new Error(
    "nullable certificateStatus must not be dropped by the normalizer",
  );
}

// --- certificate_status 存在但没 last_renewal（旧版本 agentd）：映射成 null ---
responder = () =>
  Response.json(
    baseRuntimePayload({
      certificate_status: {
        not_after: "2026-11-04T00:00:00+00:00",
        remaining_seconds: 100,
        state: "valid",
      },
    }),
  );
const noRenewal = await fetchAgentRuntimeStatus("agent-1");
if (noRenewal.certificateStatus?.lastRenewal !== null) {
  throw new Error("absent last_renewal must map to null");
}

// --- 旧网关：certificate_status 缺失 → null，revoked 缺失 → false ------------
const legacy = baseRuntimePayload();
responder = () => Response.json(legacy);
const legacyStatus = await fetchAgentRuntimeStatus("agent-1");
if (legacyStatus.certificateStatus !== null) {
  throw new Error("missing certificate_status must map to null, not throw");
}
if (legacyStatus.revoked !== false) {
  throw new Error(
    "missing revoked must default to false (do not claim 'revoked' blindly)",
  );
}

// --- 吊销：POST + 路径 + 请求体 --------------------------------------------
recorded = [];
responder = () => Response.json(baseRevocation());
const revoked = await revokeAgent("agent-1", "compromised");
if (recorded.length !== 1) {
  throw new Error(`revokeAgent must issue exactly one request, got ${recorded.length}`);
}
const [revokeCall] = recorded;
if (revokeCall.url !== "/api/v1/admin/agents/agent-1/revocation") {
  throw new Error(`unexpected revocation path: ${revokeCall.url}`);
}
if (revokeCall.method !== "POST") {
  throw new Error(`revokeAgent must be POST, got ${revokeCall.method}`);
}
if (revokeCall.authorization !== "Bearer admin-token-under-test") {
  throw new Error("admin credential must be sent in the Authorization Header");
}
if (revokeCall.body !== JSON.stringify({ reason_code: "compromised" })) {
  throw new Error(`unexpected revoke body: ${revokeCall.body}`);
}
if (
  revoked.entryId !== "denylist-agent-1" ||
  revoked.agentId !== "agent-1" ||
  revoked.reasonCode !== "compromised" ||
  revoked.deniedBy !== "admin" ||
  revoked.deniedAt !== "2026-09-29T00:00:00+00:00" ||
  revoked.retainUntil !== "2026-10-30T00:00:00+00:00"
) {
  throw new Error("revocation response was not normalized");
}

// --- 解除吊销：DELETE + 路径 ------------------------------------------------
recorded = [];
responder = () => Response.json({ agent_id: "agent-1", status: "lifted" });
await liftAgentRevocation("agent-1");
const [liftCall] = recorded;
if (liftCall.url !== "/api/v1/admin/agents/agent-1/revocation") {
  throw new Error(`unexpected lift path: ${liftCall.url}`);
}
if (liftCall.method !== "DELETE") {
  throw new Error(`liftAgentRevocation must be DELETE, got ${liftCall.method}`);
}

// --- 解除一台不在名单里的 Agent：404 落到 ApiError --------------------------
responder = () =>
  new Response("agent agent-1 is not in the revocation list", {
    status: 404,
    headers: { "content-type": "text/plain" },
  });
let liftError: unknown;
try {
  await liftAgentRevocation("agent-1");
} catch (error) {
  liftError = error;
}
if (!(liftError instanceof ApiError) || liftError.status !== 404) {
  throw new Error("lifting a non-revoked agent must surface an ApiError 404");
}

// --- 拒绝名单列表 -----------------------------------------------------------
recorded = [];
responder = () =>
  Response.json({ revocations: [baseRevocation()], generated_at: "2026-09-29T01:00:00+00:00" });
const list = await fetchAgentRevocations();
const [listCall] = recorded;
if (listCall.url !== "/api/v1/admin/agent-revocations") {
  throw new Error(`unexpected revocations path: ${listCall.url}`);
}
if (listCall.method !== "GET") {
  throw new Error(`fetchAgentRevocations must be GET, got ${listCall.method}`);
}
if (list.length !== 1 || list[0].agentId !== "agent-1") {
  throw new Error("revocation list was not normalized");
}

// --- 列表形状漂移必须显式失败 -----------------------------------------------
responder = () => Response.json({ revocations: "nope" });
let rejectedShape = false;
try {
  await fetchAgentRevocations();
} catch {
  rejectedShape = true;
}
if (!rejectedShape) {
  throw new Error("non-array revocations must be rejected instead of silently empty");
}

console.log("agent revocation contract test passed");
