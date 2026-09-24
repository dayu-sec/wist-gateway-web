import { readFileSync } from "node:fs";
import { normalizeOverview } from "../src/api/admin";

// Verifies that a live `/api/v1/admin/agents/overview` response survives the
// frontend normalizer with its status metrics intact. Guards the exact
// regression where normalizeRecentOnlineAgent dropped memoryBytes /
// cpuPercent / adminLatencyMs / metricsHistory (card always rendered "—").
//
// Also checks the two CPU calibers: `cpuCores` (逻辑核数) and
// `cpuPercentOfMachine` (整机占比) must pass through the normalizer, and must
// stay `undefined` when the payload omits them (they must not be coerced to 0 —
// 0% and 「后端没测到」are different states, the card shows "—" for the latter).
//
// Usage:
//   tsx tests/overview-display.test.ts <overview.json> <agentId> [resources]
//   - resources: pass to also require memoryBytes/cpuPercent to be populated
//     (the daemon measures these on Linux and macOS hosts).
const [overviewPath, agentId, hostFlag] = process.argv.slice(2);
if (!overviewPath || !agentId) {
  console.error(
    "usage: tsx tests/overview-display.test.ts <overview.json> <agentId> [resources]",
  );
  process.exit(2);
}

let payload: unknown;
try {
  payload = JSON.parse(readFileSync(overviewPath, "utf8"));
} catch (err) {
  console.error(`failed to read overview payload ${overviewPath}: ${err}`);
  process.exit(1);
}

const overview = normalizeOverview(payload);
const agent = overview.recentOnlineAgents.find((item) => item.agentId === agentId);
const failures: string[] = [];

// 归一化契约自检（不依赖外部载荷）：两个新 CPU 口径键原样透传；缺省时保持
// undefined 而不是被补成 0。外部载荷未必带这两个键，所以这里用内联载荷补齐。
{
  const synthetic = normalizeOverview({
    metrics: {
      total_agents: 2,
      online_agents: 2,
      unhealthy_agents: 0,
      last_seen_lag_seconds: 0,
    },
    recent_online_agents: [
      {
        agent_id: "self-check-cpu-keys",
        instance_id: "i-self-1",
        version: "v0",
        registered_at: "2024-01-01T00:00:00Z",
        online_since: "2024-01-01T00:00:00Z",
        online_duration_seconds: 1,
        source: "real",
        cpu_percent: 13.5,
        cpu_cores: 16,
        cpu_percent_of_machine: 0.84375,
        metrics_history: [
          {
            at: "2024-01-01T00:00:00Z",
            cpu_percent: 13.5,
            cpu_cores: 16,
            cpu_percent_of_machine: 0.84375,
          },
        ],
      },
      {
        agent_id: "self-check-no-cpu-keys",
        instance_id: "i-self-2",
        version: "v0",
        registered_at: "2024-01-01T00:00:00Z",
        online_since: "2024-01-01T00:00:00Z",
        online_duration_seconds: 1,
        source: "real",
        cpu_percent: 13.5,
        metrics_history: [{ at: "2024-01-01T00:00:00Z", cpu_percent: 13.5 }],
      },
    ],
    abnormal_agents: [],
  });
  const [withKeys, withoutKeys] = synthetic.recentOnlineAgents;
  if (withKeys.cpuCores !== 16) {
    failures.push(`cpuCores not passed through: ${withKeys.cpuCores}`);
  }
  if (withKeys.cpuPercentOfMachine !== 0.84375) {
    failures.push(
      `cpuPercentOfMachine not passed through: ${withKeys.cpuPercentOfMachine}`,
    );
  }
  const sample = withKeys.metricsHistory?.[0];
  if (sample?.cpuCores !== 16) {
    failures.push(`metricsHistory cpuCores not passed through: ${sample?.cpuCores}`);
  }
  if (sample?.cpuPercentOfMachine !== 0.84375) {
    failures.push(
      `metricsHistory cpuPercentOfMachine not passed through: ${sample?.cpuPercentOfMachine}`,
    );
  }
  if (withoutKeys.cpuCores !== undefined) {
    failures.push(
      `cpuCores must stay undefined when absent, got ${withoutKeys.cpuCores}`,
    );
  }
  if (withoutKeys.cpuPercentOfMachine !== undefined) {
    failures.push(
      `cpuPercentOfMachine must stay undefined when absent, got ${withoutKeys.cpuPercentOfMachine}`,
    );
  }
}

if (!agent) {
  failures.push(`agent ${agentId} not found in overview`);
} else {
  const history = agent.metricsHistory ?? [];
  if (history.length < 2) {
    failures.push(`metricsHistory length ${history.length} < 2`);
  }
  if (!history.some((sample) => typeof sample.adminLatencyMs === "number" && sample.adminLatencyMs > 0)) {
    failures.push("no adminLatencyMs sample");
  }
  history.forEach((sample, index) => {
    if (!sample.at) failures.push(`sample ${index} missing at`);
  });
  // The metric keys must survive normalization even when the value is null
  // (unsupported hosts report no memory/CPU). A dropped key means the
  // normalizer strips the field, which is the display bug this test guards.
  if (!("memoryBytes" in agent)) failures.push("memoryBytes dropped by normalizer");
  if (!("cpuPercent" in agent)) failures.push("cpuPercent dropped by normalizer");
  if (!("adminLatencyMs" in agent)) failures.push("adminLatencyMs dropped by normalizer");
  // 两个新增 CPU 口径键同样必须存在（即使缺省也保留键），透传原值；缺省时是
  // undefined，不能被补成 0。
  const rawAgents =
    (payload as any).recent_online_agents ?? (payload as any).recentOnlineAgents ?? [];
  const rawAgent = rawAgents.find(
    (item: any) => (item.agent_id ?? item.agentId) === agentId,
  );
  const cpuKeys = [
    ["cpuCores", "cpu_cores"],
    ["cpuPercentOfMachine", "cpu_percent_of_machine"],
  ] as const;
  for (const [normKey, rawKey] of cpuKeys) {
    const rawValue = rawAgent?.[rawKey] ?? rawAgent?.[normKey];
    const normalized = agent[normKey];
    if (!(normKey in agent)) {
      failures.push(`${normKey} dropped by normalizer`);
    } else if (rawValue === undefined) {
      if (normalized !== undefined) {
        failures.push(`${normKey} must stay undefined when absent, got ${normalized}`);
      }
    } else if (normalized !== rawValue) {
      failures.push(
        `${normKey} not passed through: raw=${rawValue} normalized=${normalized}`,
      );
    }
  }
  if (hostFlag === "resources") {
    if (typeof agent.memoryBytes !== "number" || agent.memoryBytes <= 0) {
      failures.push("memoryBytes not reported on this host");
    }
    if (typeof agent.cpuPercent !== "number" || agent.cpuPercent < 0) {
      failures.push("cpuPercent not reported on this host");
    }
  }
}

if (failures.length > 0) {
  console.error(`overview display test failed: ${failures.join("; ")}`);
  process.exit(1);
}

const history = agent!.metricsHistory ?? [];
console.log(`overview display ok: ${agentId} history=${history.length} samples`);
