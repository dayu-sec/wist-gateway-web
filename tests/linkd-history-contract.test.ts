import {
  normalizeGatewayLinkdHistory,
  viewGatewayLinkdHistory,
} from "../src/api/admin";

// 1) 轨迹契约：snake_case → camelCase，samples 保住时刻与状态。
const history = normalizeGatewayLinkdHistory({
  window_seconds: 3600,
  samples: [
    { at: 1_700_000_000, state: "Linked" },
    { at: 1_700_000_030, state: "Degraded" },
  ],
});
if (history.windowSeconds !== 3600 || history.samples.length !== 2) {
  throw new Error("linkd history was not normalized");
}
if (
  history.samples[0].at !== 1_700_000_000 ||
  history.samples[1].state !== "Degraded"
) {
  throw new Error("linkd history samples were not preserved");
}

// 2) 空轨迹（窗口内一次都没上报）必须能收敛，不得抛错 —— 页面要显示「无心跳记录」。
const empty = normalizeGatewayLinkdHistory({
  window_seconds: 3600,
  samples: [],
});
if (empty.samples.length !== 0) {
  throw new Error("empty history should stay empty");
}

// 3) 查看：GET admin 面并带上窗口参数（页面按窗口取数）。
let getUrl = "";
globalThis.fetch = async (input: RequestInfo | URL) => {
  getUrl = input.toString();
  return Response.json({
    window_seconds: 1800,
    samples: [{ at: 1_700_000_000, state: "Linked" }],
  });
};
const fetched = await viewGatewayLinkdHistory(1800);
if (getUrl !== "/api/v1/admin/gateway/linkd-status/history?window_seconds=1800") {
  throw new Error(`unexpected history path: ${getUrl}`);
}
if (fetched.windowSeconds !== 1800 || fetched.samples.length !== 1) {
  throw new Error("history response was not normalized");
}

// 4) 契约破坏（缺 samples / 缺字段）必须**响亮报错**，不能静默成空数组 ——
//    静默会把「接口变了」伪装成「最近一小时没心跳」，那是最容易骗过排障的假象。
for (const bad of [
  { window_seconds: 3600 },
  { window_seconds: 3600, samples: [{ at: 1_700_000_000 }] },
  { samples: [] },
]) {
  let threw = false;
  try {
    normalizeGatewayLinkdHistory(bad);
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error(`malformed history should throw: ${JSON.stringify(bad)}`);
  }
}

console.log("gateway linkd-history contract test passed");
