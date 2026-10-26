import {
  fetchAgentCollectionPreflight,
  normalizeCollectionPreflightView,
  runAgentCollectionPreflight,
  setAdminApiToken,
} from "../src/api/admin";
import {
  PREFLIGHT_PENDING_TIMEOUT_MS,
  preflightEvidenceLabel,
  preflightFamily,
  preflightFamilyStateLabel,
  preflightFamilyStateTone,
  preflightNeedsProbe,
  preflightPendingTimedOut,
  preflightReason,
  preflightRefetchInterval,
  preflightSummaryParts,
  preflightUndeterminedLabel,
  preflightVerdictLabel,
  summarizePreflight,
  type PreflightFamilyState,
} from "../src/components/collectionPreflightState";

// 契约测试：管理面「采集预检」+ 页面状态映射。
//
// 锁住四件事：
//   1. GET / POST 的路径、方法、URL 编码（agent_id 可能含 `/`、空格）；
//   2. 响应里「可省字段」的语义（`reason` / `undetermined_reason` / `pending_since` 缺省 = null），
//      以及**闭合取值**：认不出来的 verdict / state / result 必须报错，不能静默成“未知”；
//   3. 五种面状态各自的文案与色调 —— 「本机没有」与「还没探」处置完全不同，不能混；
//   4. 轮询只在命令在路上时进行，并且有超时（页面不能陪一台离线机器打几分钟）。
//
// Usage: npx tsx tests/collection-preflight-contract.test.ts

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

function viewPayload(overrides: Record<string, unknown> = {}) {
  return {
    agent_id: "agent-x",
    machine_class: "LinuxHost",
    platform: "linux",
    catalog_version: 3,
    verdict: "blocked",
    summary: "没有可授权的采集面：ContainerWorkload 这台机器没有 /var/log/containers",
    probe: {
      source: "probe",
      observed_at: "2026-10-26T00:00:00Z",
      stale: false,
      pending: false,
      probed_paths: ["/var/log/containers", "/var/lib/docker/containers"],
      present_paths: [],
      unreadable_paths: [],
      not_probed_paths: [],
    },
    families: [
      {
        family: "ContainerWorkload",
        state: "absent",
        reason: "这台机器没有 /var/log/containers",
        selected_units: [],
        units: [
          {
            unit_id: "linux-container-stdout",
            result: "match_unsatisfied",
            match_expr: "path_exists:/var/log/containers",
            paths: [{ path: "/var/log/containers", state: "absent" }],
          },
        ],
      },
    ],
    generated_at: "2026-10-26T00:00:01Z",
    ...overrides,
  };
}

async function testRequests() {
  recorded = [];
  responder = () => Response.json(viewPayload());
  const view = await fetchAgentCollectionPreflight("agent /one");
  assert(
    recorded[0].url ===
      "/api/v1/admin/agents/agent%20%2Fone/collection-preflight",
    `GET path must be encoded: ${recorded[0].url}`,
  );
  assert(recorded[0].method === "GET", "fetch must be GET");
  assert(
    recorded[0].authorization === "Bearer admin-token-under-test",
    "must send the admin bearer",
  );
  assert(
    view.agentId === "agent-x",
    "the view carries the server-side agent id (not the requested one)",
  );

  recorded = [];
  responder = () => Response.json(viewPayload({ probe: { ...viewPayload().probe, pending: true, pending_since: "2026-10-26T00:00:05Z" } }));
  const running = await runAgentCollectionPreflight("agent-x");
  assert(recorded[0].method === "POST", "run must be POST");
  assert(
    recorded[0].url === "/api/v1/admin/agents/agent-x/collection-preflight",
    `POST path: ${recorded[0].url}`,
  );
  assert(running.probe.pending, "pending must survive normalization");
  assert(
    running.probe.pendingSince === "2026-10-26T00:00:05Z",
    "pending_since must survive normalization",
  );
}

function testNormalization() {
  const view = normalizeCollectionPreflightView(viewPayload());
  assert(view.verdict === "blocked", "verdict");
  assert(view.undeterminedReason === null, "absent undetermined_reason → null");
  assert(view.machineClass === "LinuxHost", "machine class");
  assert(view.families[0].selectedUnits.length === 0, "selected units");
  assert(
    view.families[0].units[0].paths[0].state === "absent",
    "path state",
  );
  assert(
    view.families[0].units[0].matchExpr === "path_exists:/var/log/containers",
    "match expr",
  );

  // `reason` 在 grantable 时不下发：必须是 null，而不是空字符串。
  const grantable = normalizeCollectionPreflightView(
    viewPayload({
      verdict: "grantable",
      families: [
        {
          family: "ContainerWorkload",
          state: "grantable",
          selected_units: ["linux-docker-container-stdout"],
          units: [],
        },
      ],
    }),
  );
  assert(grantable.families[0].reason === null, "missing reason → null");

  // 闭合取值：认不出来就是契约漂移。
  for (const [field, payload] of [
    ["verdict", viewPayload({ verdict: "maybe" })],
    [
      "family state",
      viewPayload({
        families: [{ family: "X", state: "weird", selected_units: [], units: [] }],
      }),
    ],
    [
      "unit result",
      viewPayload({
        families: [
          {
            family: "X",
            state: "absent",
            selected_units: [],
            units: [{ unit_id: "u", result: "nope", match_expr: "", paths: [] }],
          },
        ],
      }),
    ],
  ] as const) {
    let threw = false;
    try {
      normalizeCollectionPreflightView(payload);
    } catch {
      threw = true;
    }
    assert(threw, `${field} drift must throw`);
  }
}

function testStateMapping() {
  const states: PreflightFamilyState[] = [
    "grantable",
    "absent",
    "unprobed",
    "unreadable",
    "not_ready",
  ];
  const labels = states.map(preflightFamilyStateLabel);
  assert(new Set(labels).size === states.length, "every state has its own label");
  assert(
    preflightFamilyStateTone("grantable") === "ok",
    "grantable is the only ok",
  );
  assert(preflightFamilyStateTone("unprobed") !== preflightFamilyStateTone("absent"), "“not probed yet” must not look like “not on this host”");

  assert(preflightVerdictLabel("partial").length > 0, "verdict label");
  assert(
    preflightUndeterminedLabel("no_facts").includes("预检") ||
      preflightUndeterminedLabel("no_facts").includes("facts"),
    "no_facts must point at the preflight action",
  );
}

function testReasonAndEvidence() {
  const view = normalizeCollectionPreflightView(viewPayload());
  const family = preflightFamily(view, "ContainerWorkload");
  assert(family !== null, "family lookup");
  assert(
    preflightReason(family) === "这台机器没有 /var/log/containers",
    "gateway reason wins",
  );
  assert(preflightFamily(view, "NotInView") === null, "unknown family → null");
  assert(preflightFamily(view, null) === null, "no family selected → null");

  // 网关没给 reason 时也要有一句可说的人话（界面不能出现没有理由的红点）。
  const bare = normalizeCollectionPreflightView(
    viewPayload({
      families: [{ family: "X", state: "unreadable", selected_units: [], units: [] }],
    }),
  );
  assert(
    preflightReason(preflightFamily(bare, "X")) !== null,
    "fallback reason for unreadable",
  );
  assert(preflightReason(preflightFamily(view, "ContainerWorkload")) !== null, "reason");
  assert(
    preflightReason(
      preflightFamily(
        normalizeCollectionPreflightView(
          viewPayload({
            verdict: "grantable",
            families: [{ family: "X", state: "grantable", selected_units: ["u"], units: [] }],
          }),
        ),
        "X",
      ),
    ) === null,
    "grantable has no reason",
  );

  assert(
    preflightEvidenceLabel(view.probe).includes("实测"),
    "probe source is named",
  );
  const stale = normalizeCollectionPreflightView(
    viewPayload({
      probe: { ...viewPayload().probe, source: "reported", stale: true },
    }),
  );
  assert(preflightEvidenceLabel(stale.probe).includes("过期"), "stale is called out");

  // 有实测且完整 → 不需要再探；没实测 / 过期 / 目录多出没探的路径 → 需要。
  assert(!preflightNeedsProbe(view), "complete probe needs nothing");
  assert(
    preflightNeedsProbe(null),
    "no view yet → probing is exactly what is missing",
  );
  // 只有事实摘要、而且既新鲜又完整：求值用的就是这批路径，不必再劝。
  const reported = normalizeCollectionPreflightView(
    viewPayload({
      probe: { ...viewPayload().probe, source: "reported", stale: false },
    }),
  );
  assert(
    !preflightNeedsProbe(reported),
    "fresh, complete reported evidence must not nag",
  );
  assert(preflightNeedsProbe(stale), "stale evidence should be re-probed");
  const partial = normalizeCollectionPreflightView(
    viewPayload({
      probe: {
        ...viewPayload().probe,
        not_probed_paths: ["/var/log/pods"],
      },
    }),
  );
  assert(preflightNeedsProbe(partial), "missing paths should be re-probed");
  const pending = normalizeCollectionPreflightView(
    viewPayload({ probe: { ...viewPayload().probe, pending: true } }),
  );
  assert(!preflightNeedsProbe(pending), "already in flight → do not enqueue again");

  // 没证据时的文案：不能看起来像“刚查过”。
  const none = normalizeCollectionPreflightView(
    viewPayload({ probe: { ...viewPayload().probe, source: "none", observed_at: null } }),
  );
  assert(
    preflightEvidenceLabel(none.probe).includes("还没有证据"),
    `no evidence must say so: ${preflightEvidenceLabel(none.probe)}`,
  );
}

function testPolling() {
  const idle = normalizeCollectionPreflightView(viewPayload());
  assert(
    preflightRefetchInterval(idle) === false,
    "not pending → no polling",
  );

  const pending = normalizeCollectionPreflightView(
    viewPayload({
      probe: {
        ...viewPayload().probe,
        pending: true,
        pending_since: "2026-10-26T00:00:00Z",
      },
    }),
  );
  const at = Date.parse("2026-10-26T00:00:10Z");
  assert(
    typeof preflightRefetchInterval(pending, at) === "number",
    "pending → polling",
  );
  // 超时后停：网关要等命令 TTL 才判 expired，页面不能陪一台离线机器打几分钟。
  const late = Date.parse("2026-10-26T00:00:00Z") + PREFLIGHT_PENDING_TIMEOUT_MS;
  assert(
    preflightRefetchInterval(pending, late) === false,
    "pending too long → stop polling",
  );

  // `pending_since` 缺失（或不可解析）时照样轮询：那只是少一个超时依据，
  // 不能因此把一个正在跑的探测当成“没有在跑”。
  const noSince = normalizeCollectionPreflightView(
    viewPayload({ probe: { ...viewPayload().probe, pending: true, pending_since: null } }),
  );
  assert(
    typeof preflightRefetchInterval(noSince, late) === "number",
    "missing pending_since must not stop polling",
  );

  // 超时后徽标也要换文案：不能永远停在「探测中」（机器大概率离线）。
  assert(
    preflightPendingTimedOut(pending, late),
    "timed out pending must be visible",
  );
  assert(
    !preflightPendingTimedOut(pending, at),
    "just-queued is not timed out",
  );
  assert(
    !preflightPendingTimedOut(idle, late),
    "not pending → never timed out",
  );
}

function testSummary() {
  const absent = normalizeCollectionPreflightView(viewPayload());
  const grantable = normalizeCollectionPreflightView(
    viewPayload({
      verdict: "grantable",
      families: [{ family: "ContainerWorkload", state: "grantable", selected_units: ["u"], units: [] }],
    }),
  );
  const pending = normalizeCollectionPreflightView(
    viewPayload({ probe: { ...viewPayload().probe, pending: true } }),
  );
  const summary = summarizePreflight(
    [absent, grantable, pending, { error: new Error("x") }, undefined],
    "ContainerWorkload",
  );
  assert(summary.total === 3, `total counts views only: ${summary.total}`);
  assert(summary.pending === 1, "pending counted separately");
  assert(summary.counts.absent === 1, "absent counted");
  assert(summary.counts.grantable === 1, "grantable counted");

  const parts = preflightSummaryParts(summary);
  assert(parts[0].state === "grantable", "summary leads with what can be done");
  assert(parts.length === 2, `only non-zero states: ${JSON.stringify(parts)}`);

  // 视图里没有当前面（例如这台机器的模板不包含它）：计入总数，但不计入任何状态 ——
  // 否则汇总会凭空多出一台「本机没有」。
  const otherFamily = normalizeCollectionPreflightView(
    viewPayload({
      families: [{ family: "LoginSession", state: "absent", selected_units: [], units: [] }],
    }),
  );
  const foreign = summarizePreflight([otherFamily], "ContainerWorkload");
  assert(foreign.total === 1, "total counts the view");
  assert(
    Object.values(foreign.counts).every((count) => count === 0),
    "a family outside the machine's scope is not counted as absent",
  );

  // 没选采集面时不汇总（没有“当前面”可谈）。
  const none = summarizePreflight([absent], null);
  assert(none.total === 0, "no family → no summary");
}

async function main() {
  await testRequests();
  testNormalization();
  testStateMapping();
  testReasonAndEvidence();
  testPolling();
  testSummary();
  console.log("collection-preflight contract: ok");
}

void main();
