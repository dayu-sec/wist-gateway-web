import {
  normalizeGatewaySelfStateHistory,
  viewGatewaySelfStateHistory,
} from "../src/api/admin";

// 1) 契约：snake_case → camelCase；量不出的列是 null（不是缺键、也不是 0）。
const history = normalizeGatewaySelfStateHistory({
  window_seconds: 3600,
  samples: [
    {
      at: 1_700_000_000,
      cpu_percent: 1.5,
      memory_bytes: 67_108_864,
      load_1m: 0.42,
      online_agents: 3,
      disk_usage_percent: null,
    },
    {
      at: 1_700_000_030,
      cpu_percent: null,
      memory_bytes: null,
      load_1m: null,
      online_agents: 0,
      disk_usage_percent: 12.5,
    },
  ],
});
if (history.windowSeconds !== 3600 || history.samples.length !== 2) {
  throw new Error("self-state history was not normalized");
}
if (history.samples[0].cpuPercent !== 1.5 || history.samples[0].onlineAgents !== 3) {
  throw new Error("self-state sample fields were not preserved");
}
if (history.samples[0].diskUsagePercent !== null) {
  throw new Error("null column must stay null");
}
if (history.samples[1].cpuPercent !== null) {
  throw new Error("量不出必须是 null —— 静默变 0 会在图上画出一条骗人的平线");
}

// 2) 空轨迹（刚启动 / 刚清空）必须能收敛，不得抛错。
const empty = normalizeGatewaySelfStateHistory({
  window_seconds: 3600,
  samples: [],
});
if (empty.samples.length !== 0) {
  throw new Error("empty history should stay empty");
}

// 3) 查看：GET admin 面并带上窗口参数。
let getUrl = "";
globalThis.fetch = async (input: RequestInfo | URL) => {
  getUrl = input.toString();
  return Response.json({
    window_seconds: 1800,
    samples: [
      {
        at: 1_700_000_000,
        cpu_percent: 1,
        memory_bytes: 1,
        load_1m: 1,
        online_agents: 1,
        disk_usage_percent: 1,
      },
    ],
  });
};
const fetched = await viewGatewaySelfStateHistory(1800);
if (
  getUrl !== "/api/v1/admin/gateway/self-state/history?window_seconds=1800"
) {
  throw new Error(`unexpected self-state history path: ${getUrl}`);
}
if (fetched.windowSeconds !== 1800 || fetched.samples.length !== 1) {
  throw new Error("self-state history response was not normalized");
}

// 4) 契约破坏（缺 samples / 缺字段）必须**响亮报错**，不能静默成空数组。
for (const bad of [
  { window_seconds: 3600 },
  { window_seconds: 3600, samples: [{ at: 1_700_000_000 }] },
  { samples: [] },
]) {
  let threw = false;
  try {
    normalizeGatewaySelfStateHistory(bad);
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error(
      `malformed self-state history should throw: ${JSON.stringify(bad)}`,
    );
  }
}

console.log("gateway self-state history contract test passed");
