import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  fetchActionResults,
  normalizeActionResults,
  setAdminApiToken,
} from "../src/api/admin";

// 契约测试：执行结果**列表**（刷新页面后仍能找回历史反馈）。
//
// 锁四件事：
//   1. 路径与方法：`GET /agents/{id}/action-results`，`limit` 只在给了的时候才带；
//   2. 顺序：网关按 `received_at` 倒序，前端**不再重排**（重排会让两边口径打架）；
//   3. 报文原样透出 `report`（网关不镜像结构，前端也不拆改）；
//   4. 发起页确实挂了这块「最近结果」—— 单条结果只活在会话里，列表才是持久入口。
//
// Usage: npm run test:action-results

interface Recorded {
  url: string;
  method: string;
  authorization: string;
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
  });
  return responder();
};

setAdminApiToken("admin-token-under-test");

function lastCall(): Recorded {
  const call = recorded[recorded.length - 1];
  assert(call !== undefined, "expected at least one recorded call");
  return call;
}

function resultRow(actionId: string, receivedAt: string, report: unknown) {
  return {
    agent_id: "agent-x",
    action_id: actionId,
    execution_id: `exec-${actionId}`,
    plan_digest: "plan-v1:sha256:deadbeef",
    final_status: "succeeded",
    reported_at: receivedAt,
    received_at: receivedAt,
    report,
  };
}

// ── 路径与方法：不带 limit ───────────────────────────────────────────────────
{
  recorded = [];
  responder = () =>
    Response.json({
      agent_id: "agent-x",
      results: [
        resultRow("act_new", "2026-11-23T00:02:00Z", {
          action_id: "act_new",
          result: { outputs: { items: [{ name: "s1", value: {} }] } },
        }),
        resultRow("act_old", "2026-11-23T00:01:00Z", {
          action_id: "act_old",
          result: { outputs: { items: [{ name: "s1", value: {} }] } },
        }),
      ],
    });
  const view = await fetchActionResults("agent-x");
  const call = lastCall();
  assert(
    call.url === "/api/v1/admin/agents/agent-x/action-results",
    `unexpected url: ${call.url}`,
  );
  assert(call.method === "GET", `expected GET, got ${call.method}`);
  assert(call.authorization === "Bearer admin-token-under-test", "bearer token");
  assert(view.agentId === "agent-x", "agent id");
  assert(view.results.length === 2, "two results");
  // 顺序保持网关给的（最新在前），前端不重排。
  assert(view.results[0]?.actionId === "act_new", "newest first (as returned)");
  assert(view.results[1]?.actionId === "act_old", "oldest last (as returned)");
  // 报文原样透出。
  const report = view.results[0]?.report as {
    result?: { outputs?: { items?: unknown[] } };
  };
  assert(
    Array.isArray(report.result?.outputs?.items),
    "report must pass through as an object",
  );
}

// ── limit 只在给出时带上；agent id 要编码 ───────────────────────────────────
{
  recorded = [];
  responder = () => Response.json({ agent_id: "a/b c", results: [] });
  const view = await fetchActionResults("a/b c", 5);
  const call = lastCall();
  assert(
    call.url === "/api/v1/admin/agents/a%2Fb%20c/action-results?limit=5",
    `unexpected url: ${call.url}`,
  );
  assert(view.results.length === 0, "empty list is a valid answer");
}

// ── 形状漂移要显式失败（不能静默当成空列表） ────────────────────────────────
{
  let threw = false;
  try {
    normalizeActionResults({ agent_id: "agent-x" });
  } catch {
    threw = true;
  }
  assert(threw, "missing results array must throw, not silently degrade");
}

{
  let threw = false;
  try {
    normalizeActionResults({ agent_id: "agent-x", results: [{}] });
  } catch {
    threw = true;
  }
  assert(threw, "a row missing action_id must throw");
}

// ── 发起页确实挂了「最近结果」（持久入口） ──────────────────────────────────
{
  const panelPath = fileURLToPath(
    new URL("../src/components/ResponseLaunchPanel.tsx", import.meta.url),
  );
  const source = readFileSync(panelPath, "utf8");
  assert(
    source.includes("useActionResults("),
    "the launch panel must read the result list, otherwise a reload loses all feedback",
  );
  assert(
    /<RecentResults\s+agentId=\{agentId\}/.test(source),
    "the launch panel must render <RecentResults agentId={agentId} />",
  );
  assert(
    source.includes('queryKey: ["action-results"'),
    "the panel must invalidate the list key after a preview lands",
  );
}

console.log("action-results contract OK");
