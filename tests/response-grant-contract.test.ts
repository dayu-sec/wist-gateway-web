import {
  fetchResponseGrant,
  normalizeResponseGrantEnvelope,
  putResponseGrant,
  revokeResponseGrant,
  setAdminApiToken,
} from "../src/api/admin";

// 契约测试：管理面「响应授权单（时间窗授权）」的读写路径与响应形状。
//
// 锁住四件事：
//   1. 路径与方法：`GET / PUT / DELETE /agents/{id}/response-grant`；
//   2. **请求只发 `duration_minutes`，不发绝对时刻** —— 期限由服务端按自己的时钟算
//      （客户端时钟不可信，差一小时就会让人按错误前提做决定）；
//   3. 可选项**不发空值**：空 opcode 数组 / 空理由都不发（它们在网关侧语义不同：
//      空数组是"什么都不许"，省略才是"不按 op 收窄"）；
//   4. `state` 是**闭集**，未知状态必须抛错 —— 页面据此决定按钮与文案，静默回落会
//      把"已撤销"显示成"已生效"。
//
// Usage: npm run test:response-grant

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

function grantPayload(overrides: Record<string, unknown> = {}) {
  return {
    grant_id: "grn_agent-x_1795338980988065_9f2c1a7b",
    max_risk: "R2",
    opcodes: null,
    not_before: "2026-11-22T10:00:00Z",
    not_after: "2026-11-23T10:00:00Z",
    reason: "on-call window",
    granted_by: "admin:9f2c1a7b3d40",
    granted_at: "2026-11-22T10:00:00Z",
    revoked_at: null,
    state: "active",
    remaining_seconds: 3600,
    ...overrides,
  };
}

function envelope(grant: unknown = grantPayload()) {
  return { agent_id: "agent-x", grant };
}

function lastCall(): Recorded {
  const call = recorded[recorded.length - 1];
  assert(call !== undefined, "expected at least one recorded call");
  return call;
}

// ── GET ─────────────────────────────────────────────────────────────────────
{
  recorded = [];
  responder = () => Response.json(envelope());
  const result = await fetchResponseGrant("agent-x");
  const call = lastCall();
  assert(recorded.length === 1, `GET must issue exactly one request`);
  assert(
    call.url === "/api/v1/admin/agents/agent-x/response-grant",
    `unexpected url: ${call.url}`,
  );
  assert(call.method === "GET", `expected GET, got ${call.method}`);
  assert(
    call.authorization === "Bearer admin-token-under-test",
    `admin token must be sent as a bearer`,
  );
  assert(result.agentId === "agent-x", "agent id must be read back");
  assert(result.grant?.grantId === "grn_agent-x_1795338980988065_9f2c1a7b", "grant id");
  assert(result.grant?.state === "active", "state");
  assert(result.grant?.maxRisk === "R2", "risk cap");
  assert(result.grant?.remainingSeconds === 3600, "remaining seconds");
}

// ── GET：从未签发 = null（不是错误）────────────────────────────────────────
{
  recorded = [];
  responder = () => Response.json({ agent_id: "agent-x", grant: null });
  const result = await fetchResponseGrant("agent-x");
  assert(result.grant === null, "no grant must stay null, not an empty object");
}

// ── PUT：只有 duration_minutes，没有绝对时刻 ────────────────────────────────
{
  recorded = [];
  responder = () => Response.json(envelope());
  await putResponseGrant("agent-x", {
    maxRisk: "R2",
    durationMinutes: 60,
    reason: "on-call window",
  });
  const call = lastCall();
  assert(call.method === "PUT", `expected PUT, got ${call.method}`);
  const body = JSON.parse(call.body) as Record<string, unknown>;
  assert(body.max_risk === "R2", "max_risk");
  assert(body.duration_minutes === 60, "duration_minutes");
  assert(body.reason === "on-call window", "reason");
  assert(
    !("not_after" in body) && !("not_before" in body),
    "the client must not send absolute timestamps — the server owns the clock",
  );
  assert(!("opcodes" in body), "omitted allow-list must not be sent as null");
}

// ── PUT：opcode 白名单按原样发；空白名单不发送 ─────────────────────────────
{
  recorded = [];
  responder = () => Response.json(envelope());
  await putResponseGrant("agent-x", {
    maxRisk: "R1",
    opcodes: ["log.rotate", "log.archive"],
  });
  const body = JSON.parse(lastCall().body) as Record<string, unknown>;
  assert(Array.isArray(body.opcodes) && body.opcodes.length === 2, "opcodes");
  assert(!("duration_minutes" in body), "omitted duration must not be sent");

  recorded = [];
  responder = () => Response.json(envelope());
  await putResponseGrant("agent-x", {
    maxRisk: "R0",
    opcodes: [],
    reason: "   ",
  });
  const emptyBody = JSON.parse(lastCall().body) as Record<string, unknown>;
  assert(
    !("opcodes" in emptyBody),
    "an empty allow-list means 'nothing allowed' on the server — the UI must omit it, not send []",
  );
  assert(!("reason" in emptyBody), "a blank reason must not be sent");
}

// ── DELETE ──────────────────────────────────────────────────────────────────
{
  recorded = [];
  responder = () =>
    Response.json(
      envelope(
        grantPayload({ state: "revoked", revoked_at: "2026-11-22T11:00:00Z" }),
      ),
    );
  const result = await revokeResponseGrant("agent-x");
  const call = lastCall();
  assert(call.method === "DELETE", `expected DELETE, got ${call.method}`);
  assert(
    call.url === "/api/v1/admin/agents/agent-x/response-grant",
    `unexpected url: ${call.url}`,
  );
  assert(result.grant?.state === "revoked", "revoke must report the revoked state");
  assert(result.grant?.revokedAt === "2026-11-22T11:00:00Z", "revoked_at");
}

// ── 归一化：未知 state 必须抛错（闭集）──────────────────────────────────────
{
  let threw = false;
  try {
    normalizeResponseGrantEnvelope(envelope(grantPayload({ state: "zombie" })));
  } catch {
    threw = true;
  }
  assert(threw, "an unknown grant state must be rejected, not silently mapped");
}

// ── 归一化：缺 grant_id 必须抛错（否则页面上会出现一张无法撤销的单）────────
{
  let threw = false;
  try {
    normalizeResponseGrantEnvelope(
      envelope(grantPayload({ grant_id: undefined })),
    );
  } catch {
    threw = true;
  }
  assert(threw, "a grant without grant_id must be rejected");
}

console.log("response grant contract OK");
