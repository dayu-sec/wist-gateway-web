import {
  fetchAgentCommandQueue,
  normalizeAgentCommandQueue,
  setAdminApiToken,
} from "../src/api/admin";
import {
  commandAgeLabel,
  commandKindLabel,
  commandKindRoute,
  commandSourceLabel,
  isAgentCommandQueueFilter,
  outcomeLabel,
  outcomeTone,
  queueStateLabel,
  queueStateTone,
} from "../src/lib/commandQueue";

// 契约测试：「任务队列」的读写路径与响应形状（网关 0.44+ 的两条只读口）。
//
// 锁住五件事：
//   1. 两条口的**路径**：给了 agent 走单机口（agent 在路径里、编码过），否则走全机队口；
//      `state` / `limit` 走 query，单机口不重复发 `agent_id`；
//   2. 状态 / 来源 / 结论三个**闭集**：认不出来就是契约漂移，不静默成「未知」——
//      把 `expired` 读成 `acked` 会把「命令根本没跑」显示成「做完了」；
//   3. `counts` **必须**是可读的数字：缺了就整页失败，不静默成 0（0 = 队列空了，会说谎）；
//   4. 全机队口**不下发** `agent_id`（`Option` + `skip_serializing_if`）：缺字段是正常形态，
//      不能判成漂移；
//   5. 界面投影（`lib/commandQueue`）：种类 → 说法 / 落地页，状态 → 徽标色调，
//      未知种类照实显示原始 `kind`（不冒充「其它」）。
//
// Usage: npm run test:command-queue

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

function item(overrides: Record<string, unknown> = {}) {
  return {
    command_id: "cmd_agent-x_investigate_1780000000000000",
    agent_id: "agent-x",
    kind: "investigate",
    state: "queued",
    source: "center",
    requested_by: "center:alice",
    summary: "topic=disk",
    requested_at: "2026-11-10T10:00:00+00:00",
    claimed_at: null,
    acknowledged_at: null,
    outcome: null,
    detail: null,
    ...overrides,
  };
}

function queuePayload() {
  return {
    agent_id: "agent-x",
    state: "queued",
    counts: { queued: 3, claimed: 1 },
    commands: [
      item(),
      item({
        command_id: "cmd_agent-x_refresh_facts_1780000000000001",
        kind: "refresh_facts",
        state: "acked",
        source: "admin",
        requested_by: "admin:9f2c1a7b3d40",
        summary: "what=facts,work",
        claimed_at: "2026-11-10T09:59:01+00:00",
        acknowledged_at: "2026-11-10T09:59:03+00:00",
        outcome: "succeeded",
        detail: "facts uploaded",
      }),
      item({
        command_id: "cmd_agent-x_investigate_1780000000000002",
        state: "expired",
        acknowledged_at: "2026-11-10T09:00:00+00:00",
        outcome: "expired",
      }),
    ],
  };
}

async function main() {
  // ① 单机口：agent 在路径里（编码），过滤词走 query
  recorded = [];
  responder = () => Response.json(queuePayload());
  const single = await fetchAgentCommandQueue({
    agentId: "agent/x y",
    state: "queued",
    limit: 100,
  });
  assert(
    recorded[0].url.includes("/api/v1/admin/agents/agent%2Fx%20y/commands?"),
    `单机口路径或编码不对：${recorded[0].url}`,
  );
  assert(recorded[0].method === "GET", "队列只读：必须是 GET");
  assert(
    recorded[0].authorization === "Bearer admin-token-under-test",
    "缺少 admin bearer",
  );
  assert(recorded[0].url.includes("state=queued"), "state 应走 query");
  assert(recorded[0].url.includes("limit=100"), "limit 应走 query");
  assert(
    !recorded[0].url.includes("agent_id="),
    "单机口的 agent 在路径里，不能重复发 agent_id",
  );

  // ② 全机队口：路径不同，agent 过滤走 query
  recorded = [];
  responder = () => Response.json({ ...queuePayload(), agent_id: undefined });
  await fetchAgentCommandQueue({ state: "all", agentId: undefined });
  assert(
    recorded[0].url.includes("/api/v1/admin/agent-commands?"),
    `全机队口路径不对：${recorded[0].url}`,
  );
  assert(
    recorded[0].url.includes("state=all"),
    "state=all 应显式发（网关缺省是 queued）",
  );

  recorded = [];
  responder = () => Response.json({ ...queuePayload(), agent_id: undefined });
  await fetchAgentCommandQueue({ agentId: "agent-x" });
  // 注意：给了 agentId 就走单机口 —— 全机队口只在页面不窄化时用。
  assert(
    recorded[0].url.includes("/api/v1/admin/agents/agent-x/commands") &&
      !recorded[0].url.includes("?"),
    `无过滤条件时不该带空 query：${recorded[0].url}`,
  );

  // ③ 形状：counts + 三种状态 + 来源 + null 语义
  recorded = [];
  responder = () => Response.json(queuePayload());
  const view = await fetchAgentCommandQueue({
    agentId: "agent-x",
    state: "queued",
  });
  assert(view.agentId === "agent-x", "单机口应回显 agent_id");
  assert(view.state === "queued", "网关实际过滤词应回显");
  assert(
    view.counts.queued === 3 && view.counts.claimed === 1,
    "counts 应解析",
  );
  assert(view.commands.length === 3, "commands 应解析");
  assert(view.commands[0].source === "center", "source 应透传（中心下发）");
  assert(
    view.commands[0].claimedAt === null,
    "claimed_at 的 null 是状态（还没取走），不能变成 undefined",
  );
  assert(view.commands[0].outcome === null, "outcome 的 null 是状态（未终态）");
  assert(view.commands[0].summary === "topic=disk", "summary 应透传");
  assert(view.commands[1].outcome === "succeeded", "终态结论应透传");
  assert(
    view.commands[2].state === "expired",
    "过期不能并进 acked（它没执行过）",
  );

  // ③b 全机队口不下发 agent_id：缺字段读成 null，不判漂移
  const fleet = normalizeAgentCommandQueue({
    state: "queued",
    counts: { queued: 1, claimed: 0 },
    commands: [item()],
  });
  assert(fleet.agentId === null, "全机队口没有 agent_id → null");

  // ③c counts 缺失 / 类型漂移要冒出来：静默成 0 会说「队列空了」
  for (const broken of [
    { state: "queued", commands: [] },
    { state: "queued", counts: {}, commands: [] },
    { state: "queued", counts: { queued: "3", claimed: 0 }, commands: [] },
  ]) {
    let threw = false;
    try {
      normalizeAgentCommandQueue(broken);
    } catch {
      threw = true;
    }
    assert(threw, `counts 不可读时应抛错：${JSON.stringify(broken)}`);
  }

  // ④ 闭集漂移：状态 / 来源 / 结论 / 过滤词
  const drifts: [string, unknown][] = [
    [
      "未知 state",
      { ...queuePayload(), commands: [item({ state: "exploded" })] },
    ],
    [
      "未知 source",
      { ...queuePayload(), commands: [item({ source: "gwlinkd" })] },
    ],
    [
      "未知 outcome",
      { ...queuePayload(), commands: [item({ outcome: "exploded" })] },
    ],
    ["未知过滤词", { ...queuePayload(), state: "everything" }],
    ["commands 不是数组", { ...queuePayload(), commands: {} }],
  ];
  for (const [label, payload] of drifts) {
    let threw = false;
    try {
      normalizeAgentCommandQueue(payload);
    } catch {
      threw = true;
    }
    assert(threw, `${label} 应抛错`);
  }

  // ⑤ 界面投影：说法 + 落地页 + 色调
  assert(queueStateLabel("queued") === "待执行", "queued 的说法");
  assert(queueStateLabel("claimed") === "执行中", "claimed 的说法");
  assert(queueStateLabel("acked") === "已回执", "acked 的说法");
  assert(queueStateLabel("expired") === "已过期", "expired 的说法");
  assert(queueStateLabel("superseded") === "被取代", "superseded 的说法");
  assert(queueStateTone("acked") === "acked", "只有真正执行完才是绿色");
  assert(queueStateTone("expired") === "void", "过期不是绿色");
  assert(queueStateTone("queued") === "queued", "待执行是提醒色");

  assert(commandSourceLabel("center") === "中心", "中心下发的说法");
  assert(commandSourceLabel("admin") === "页面", "页面发起的说法");
  assert(commandSourceLabel("system") === "系统", "系统自排的说法");

  assert(commandKindLabel("investigate") === "一次性调查", "调查的说法");
  assert(commandKindLabel("refresh_facts") === "重采事实", "重采的说法");
  assert(
    commandKindLabel("something_new") === "something_new",
    "未知种类照实显示（不冒充「其它」）",
  );

  assert(
    commandKindRoute("investigate", "agent/x") ===
      "/agents/agent%2Fx/investigations",
    "调查应落到调查页（id 要编码）",
  );
  assert(
    commandKindRoute("refresh_facts", "agent-x") === "/agents/agent-x/work",
    "重采应落到采集工作页",
  );
  assert(
    commandKindRoute("something_new", "agent-x") === null,
    "未知种类没有落地页",
  );

  assert(outcomeLabel(null) === null, "未终态没有说法");
  assert(outcomeLabel("succeeded") === "成功", "成功");
  assert(
    outcomeLabel("expired") === "过期未执行",
    "过期不是「失败」，要说清没跑",
  );
  assert(outcomeTone("succeeded") === "acked", "成功才绿");
  assert(outcomeTone("failed") === "queued", "失败要显眼（不是绿色）");
  assert(outcomeTone("expired") === "void", "过期是灰的");

  // ⑥ 「等了多久」：粗粒度、像一句话；坏时间戳返回 null（不渲染成 1970 年）
  const now = Date.parse("2026-11-10T10:05:00Z");
  assert(
    commandAgeLabel("2026-11-10T10:04:55Z", now) === "刚刚",
    "10 秒内是「刚刚」",
  );
  assert(
    commandAgeLabel("2026-11-10T10:04:50Z", now) === "10 秒前",
    "满 10 秒就该报秒数",
  );
  assert(
    commandAgeLabel("2026-11-10T10:04:00Z", now) === "1 分钟前",
    "1 分钟前",
  );
  assert(
    commandAgeLabel("2026-11-10T07:00:00Z", now) === "3 小时前",
    "3 小时前",
  );
  assert(commandAgeLabel(null, now) === null, "没有时刻就没有时长");
  assert(commandAgeLabel("not-a-time", now) === null, "坏时间戳返回 null");

  // ⑦ URL 过滤词的守卫：闭集之外一律回落（页面据此换成 queued）
  assert(isAgentCommandQueueFilter("claimed"), "闭集内应通过");
  assert(isAgentCommandQueueFilter("all"), "all 应通过");
  assert(!isAgentCommandQueueFilter("everything"), "闭集外应拒绝");
  assert(!isAgentCommandQueueFilter(null), "null 应拒绝");

  console.log("command queue contract: OK");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
