import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  fetchApproverKeys,
  registerApproverKey,
  revokeApproverKey,
  setAdminApiToken,
} from "../src/api/admin";

// 契约测试：审批公钥（外部签发）。
//
// 锁四件事：
//   1. 路径与方法：`GET/POST /approver-keys`、`DELETE /approver-keys/{id}`；
//   2. **`reactivate` 只在显式要求时才发**（不发 = 网关保持吊销）；
//   3. 列表包含已吊销的行（审计要能回答「什么时候撤的」）；
//   4. 审批页是**只读**的：不能再出现投票/签发动作（否则会变成两条审批路径）。
//
// Usage: npm run test:approver-keys

interface Recorded {
  url: string;
  method: string;
  body: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

let recorded: Recorded[] = [];
let responder: () => Response = () => Response.json({});

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  recorded.push({
    url: input.toString(),
    method: (init?.method ?? "GET").toUpperCase(),
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

function keyRow(keyId: string, revokedAt: string | null) {
  return {
    key_id: keyId,
    owner: "role:approver",
    fingerprint: "0123456789abcdef",
    added_by: "admin:test",
    added_at: "2026-11-23T00:00:00Z",
    revoked_at: revokedAt,
  };
}

// ── 列表（含已吊销）────────────────────────────────────────────────────────
{
  recorded = [];
  responder = () =>
    Response.json({
      keys: [keyRow("site-k1", null), keyRow("site-k0", "2026-11-23T01:00:00Z")],
    });
  const keys = await fetchApproverKeys();
  const call = lastCall();
  assert(
    call.url === "/api/v1/admin/approver-keys",
    `unexpected url: ${call.url}`,
  );
  assert(call.method === "GET", `expected GET, got ${call.method}`);
  assert(keys.length === 2, "two keys");
  assert(keys[1]?.revokedAt === "2026-11-23T01:00:00Z", "revoked row kept");
  assert(keys[0]?.fingerprint === "0123456789abcdef", "fingerprint");
}

// ── 登记：不带 reactivate ───────────────────────────────────────────────────
{
  recorded = [];
  responder = () => Response.json(keyRow("site-k1", null));
  await registerApproverKey({
    keyId: "site-k1",
    owner: "role:approver",
    publicKey: "-----BEGIN PUBLIC KEY-----\nAA==\n-----END PUBLIC KEY-----\n",
  });
  const call = lastCall();
  assert(
    call.url === "/api/v1/admin/approver-keys",
    `unexpected url: ${call.url}`,
  );
  assert(call.method === "POST", `expected POST, got ${call.method}`);
  const body = JSON.parse(call.body) as Record<string, unknown>;
  assert(body.key_id === "site-k1", "key_id");
  assert(
    !("reactivate" in body),
    "reactivate must be omitted unless explicitly requested — otherwise a retry can undo a revocation",
  );
}

// ── 登记：带 reactivate（显式恢复） ─────────────────────────────────────────
{
  recorded = [];
  responder = () => Response.json(keyRow("site-k1", null));
  await registerApproverKey({
    keyId: "site-k1",
    owner: "role:approver",
    publicKey: "-----BEGIN PUBLIC KEY-----\nAA==\n-----END PUBLIC KEY-----\n",
    reactivate: true,
  });
  const body = JSON.parse(lastCall().body) as Record<string, unknown>;
  assert(body.reactivate === true, "explicit reactivate is forwarded");
}

// ── 吊销 ────────────────────────────────────────────────────────────────────
{
  recorded = [];
  responder = () => new Response(null, { status: 204 });
  await revokeApproverKey("site/k 1");
  const call = lastCall();
  assert(
    call.url === "/api/v1/admin/approver-keys/site%2Fk%201",
    `unexpected url: ${call.url}`,
  );
  assert(call.method === "DELETE", `expected DELETE, got ${call.method}`);
}

// ── 形状漂移要显式失败 ──────────────────────────────────────────────────────
{
  let threw = false;
  try {
    // 少了 keys 数组：契约漂移，不能当成“没有钥匙”。
    responder = () => Response.json({});
    await fetchApproverKeys();
  } catch {
    threw = true;
  }
  assert(threw, "missing keys array must throw");
}

// ── 审批页必须是只读的（不许再有投票 / 签发动作） ───────────────────────────
{
  const pagePath = fileURLToPath(
    new URL("../src/components/SubsystemAgentApprovalPage.tsx", import.meta.url),
  );
  const source = readFileSync(pagePath, "utf8");
  assert(
    !source.includes("useVoteActionApproval"),
    "the approval page must not vote any more — voting happens in wist-approve",
  );
  assert(
    !source.includes("useIssueActionApproval"),
    "the approval page must not issue any more — signing happens in wist-approve",
  );
  assert(
    source.includes("wist-approve"),
    "the page must tell the operator which command to run next",
  );
  assert(
    source.includes("<ApproverKeysSection"),
    "the page must expose approver key management",
  );
}

console.log("approver-keys contract OK");
