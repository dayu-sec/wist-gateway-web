import {
  ApiError,
  fetchAgentInvestigationReport,
  fetchAgentInvestigations,
  launchAgentInvestigation,
  normalizeAgentInvestigations,
  setAdminApiToken,
} from "../src/api/admin";

// 契约测试：管理面「一次性调查」的读写路径与响应形状。
//
// 锁住五件事：
//   1. GET（最近一次下发 + 报告列表）/ POST（下发）/ GET 单份报告的**路径与方法**；
//   2. POST body 的字段名与「空值不发」：`path` 留空不能发成空串（agentd 会当成
//      相对路径 / 非法路径拒掉整条命令）；
//   3. 响应里 `null` 的语义（从没下发 / 等待认领 / 还没有结果）—— 与 `fact-refresh` 同一口径；
//   4. 报告列表缺字段/类型漂移时抛错，不静默成空数组（那会把「有报告」显示成「没有」）；
//   5. S3 的三个「菜单可用性」字段：`allowed_topics` / `capabilities` / `retention_days`。
//      关键是 **`[]` 与 `null` 不能混**：`[]` = 一个都不许（菜单全禁），`null` = 旧网关没这个字段
//      （菜单不能全禁，否则升级网关这件事会表现为「功能没了」）。
//
// Usage: npm run test:investigations

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

function commandPayload() {
  return {
    command_id: "cmd_agent-x_investigate_1780000000000000",
    kind: "investigate",
    requested_by: "admin:9f2c1a7b3d40",
    requested_at: "2026-10-30T10:00:00+00:00",
    acknowledged_at: null,
    outcome: null,
    detail: null,
  };
}

function listPayload() {
  return {
    agent_id: "agent-x",
    capabilities: { surfaces: ["disk"], privileged: true },
    allowed_topics: ["disk"],
    quota: { limit_per_hour: 12, used_last_hour: 3 },
    retention_days: 7,
    report_dir: {
      configured: true,
      path: "/data-plane/data/ivsrep",
    },
    latest_command: commandPayload(),
    reports: [
      {
        command_id: "cmd_agent-x_investigate_1780000000000000",
        topic: "disk",
        observed_at: "2026-10-30T10:00:05Z",
        overall: "warn",
        verdict: "3 项正常 / 1 项警告 / 0 项失败",
        findings_ok: 3,
        findings_warn: 1,
        findings_fail: 0,
        seq: 42,
      },
    ],
  };
}

async function main() {
  // ① GET：路径 + 形状
  recorded = [];
  responder = () => Response.json(listPayload());
  const view = await fetchAgentInvestigations("agent/x y");
  assert(
    recorded[0].url.endsWith(
      "/api/v1/admin/agents/agent%2Fx%20y/investigations",
    ),
    `GET 路径或编码不对：${recorded[0].url}`,
  );
  assert(recorded[0].method === "GET", "GET 方法不对");
  assert(recorded[0].authorization === "Bearer admin-token-under-test", "缺少 admin bearer");
  assert(view.reportDir.configured === true, "report_dir.configured 应透传");
  assert(view.reportDir.path === "/data-plane/data/ivsrep", "report_dir.path 应透传");
  assert(view.latestCommand.commandId !== null, "最新命令应解析出来");
  assert(view.latestCommand.outcome === null, "outcome 的 null 是状态，不能变成 undefined");
  assert(view.reports.length === 1, "报告列表应解析出来");
  assert(view.reports[0].findingsWarn === 1, "findings_warn 应解析出来");
  assert(view.reports[0].overall === "warn", "overall 应透传");
  assert(view.latestCommand.requestedBy === "admin:9f2c1a7b3d40", "requested_by 应透传（审计回显）");
  assert(view.allowedTopics?.join(",") === "disk", "allowed_topics 应解析成数组");
  assert(view.quota?.limitPerHour === 12, "quota.limit_per_hour 应透传（页面靠它解释 429）");
  assert(view.quota?.usedLastHour === 3, "quota.used_last_hour 应透传");
  assert(view.retentionDays === 7, "retention_days 应透传");
  assert(view.capabilities?.privileged === true, "capabilities.privileged 应透传");
  assert(view.capabilities?.surfaces.join(",") === "disk", "capabilities.surfaces 应透传");

  // ①b S3 之前的老网关（没这三个字段）：`null` = 「不知道」，不能读成 `[]`/false
  const legacy = normalizeAgentInvestigations({
    agent_id: "agent-x",
    report_dir: { configured: true, path: "/x" },
    latest_command: commandPayload(),
    reports: [],
  });
  assert(legacy.allowedTopics === null, "缺 allowed_topics 必须读成 null（不是 []）");
  assert(legacy.retentionDays === null, "缺 retention_days 必须读成 null");
  assert(legacy.quota === null, "缺 quota 必须读成 null（旧网关）");
  assert(legacy.capabilities === null, "缺 capabilities 必须读成 null");

  // ①c 空允许集是**真的**「一个都不许」：不能与上一例混为一谈
  const noneAllowed = normalizeAgentInvestigations({
    ...listPayload(),
    allowed_topics: [],
    capabilities: null,
  });
  assert(noneAllowed.allowedTopics?.length === 0, "空允许集要保留成 []");
  assert(noneAllowed.capabilities === null, "capabilities: null = 还没上报");

  // ② POST：字段名 + 空值不发
  recorded = [];
  responder = () =>
    Response.json({
      agent_id: "agent-x",
      capabilities: { surfaces: ["disk"], privileged: false },
      allowed_topics: ["disk"],
      command: commandPayload(),
    });
  const launched = await launchAgentInvestigation("agent-x", {
    topic: "disk",
    path: "   ",
    top: 5,
  });
  assert(
    recorded[0].url.endsWith("/api/v1/admin/agents/agent-x/investigations"),
    `POST 路径不对：${recorded[0].url}`,
  );
  assert(recorded[0].method === "POST", "POST 方法不对");
  const body = JSON.parse(recorded[0].body) as Record<string, unknown>;
  assert(body.topic === "disk", "POST 应带 topic");
  assert(body.top === 5, "POST 应带 top");
  assert(!("path" in body), "空白的 path 不能发（会被 agentd 当非法路径拒掉整条命令）");
  assert(launched.command.kind === "investigate", "下发返回应解析 kind");
  assert(launched.capabilities?.privileged === false, "下发响应也应回带 capabilities（非 root = 部分答案）");
  assert(launched.allowedTopics?.join(",") === "disk", "下发响应也应回带 allowed_topics");

  // ③ GET 单份报告：路径编码
  recorded = [];
  responder = () =>
    Response.json({
      agent_id: "agent-x",
      command_id: "cmd-1",
      report: { command_id: "cmd-1", topic: "disk", findings: [] },
    });
  const detail = await fetchAgentInvestigationReport("agent-x", "cmd-1");
  assert(
    recorded[0].url.endsWith("/api/v1/admin/agents/agent-x/investigations/cmd-1"),
    `报告路径不对：${recorded[0].url}`,
  );
  assert((detail.report as { topic?: string }).topic === "disk", "报告正文应透传");

  // ④ 契约漂移要冒出来
  let threw = false;
  try {
    normalizeAgentInvestigations({ agent_id: "agent-x" });
  } catch {
    threw = true;
  }
  assert(threw, "缺 report_dir / reports 时应抛错，不能静默成空列表");

  // ⑤ 未知 outcome 是漂移（终态是闭集）
  threw = false;
  try {
    normalizeAgentInvestigations({
      ...listPayload(),
      latest_command: { ...commandPayload(), outcome: "exploded" },
    });
  } catch {
    threw = true;
  }
  assert(threw, "未知 outcome 应抛错");

  // ⑤b capabilities 形状漂移（缺 privileged）也要冒出来：否则「是否 root」会静默成 false
  threw = false;
  try {
    normalizeAgentInvestigations({
      ...listPayload(),
      capabilities: { surfaces: ["disk"] },
    });
  } catch {
    threw = true;
  }
  assert(threw, "capabilities 缺 privileged 应抛错");

  // ⑤c 允许集类型漂移（数字）也要冒出来
  threw = false;
  try {
    normalizeAgentInvestigations({ ...listPayload(), allowed_topics: [1] });
  } catch {
    threw = true;
  }
  assert(threw, "allowed_topics 非字符串数组应抛错");

  // ⑤d 额度漂移（缺 limit_per_hour）也要冒出来：否则页面会把它显示成“不限”。
  threw = false;
  try {
    normalizeAgentInvestigations({
      ...listPayload(),
      quota: { used_last_hour: 3 },
    });
  } catch {
    threw = true;
  }
  assert(threw, "quota 缺 limit_per_hour 应抛错");

  // ⑥ 404 透传成 ApiError（页面据此区分「旧网关」与「未知主机」）
  responder = () => new Response("unknown agent agent-x", { status: 404 });
  let error: unknown = null;
  try {
    await fetchAgentInvestigations("agent-x");
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof ApiError, "404 应抛 ApiError");
  assert((error as ApiError).status === 404, "404 状态应保留");

  // ⑦ 403 / 409 / 429 的稳定码要透传：页面靠 `code` 把「关面 / 升级 / 等额度」分成三种处置。
  //    尤其是 429：它与「认证失败太多」同码，页面必须能按 `code` 区分，否则会说错话。
  const gated = [
    [403, "investigation_not_allowed"],
    [409, "investigation_unsupported"],
    [429, "investigation_quota_exceeded"],
  ] as const;
  for (const [status, code] of gated) {
    responder = () =>
      Response.json({ error: { code, message: "denied" } }, { status });
    let caught: unknown = null;
    try {
      await launchAgentInvestigation("agent-x", { topic: "disk" });
    } catch (thrown) {
      caught = thrown;
    }
    assert(caught instanceof ApiError, `${code} 应抛 ApiError`);
    assert((caught as ApiError).status === status, `${code} 状态应保留`);
    assert((caught as ApiError).code === code, `${code} 稳定码应透传`);
  }

  console.log("investigation contract: OK");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
