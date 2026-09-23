import {
  fetchAgentWork,
  fetchContentCatalog,
  setAdminApiToken,
} from "../src/api/admin";
import {
  blockedFamilies,
  driftingCount,
  grantableFamilies,
  metricIntervalSeconds,
  platformForMachineClass,
  specCounts,
  standingDrift,
} from "../src/components/agentWorkStatus";
import type { MachineClass } from "../src/types";

// **联机**检查（不入 CI）：用正在运行的网关的真实响应跑一遍页面的严格 normalizer
// 与派活闸门。
//
// 为什么需要它：契约测试里的 mock 只能锁住「我以为的形状」。采集内容的就绪度实际是
// **按平台分组**的（`readiness: [{platform, families: […]}]`），而 mock 一度写成了扁平的
// —— 契约测试全绿，页面在真机上直接抛错。凡是「网关返回的结构」，都值得这样对一次。
//
// Usage:
//   WIST_GATEWAY_URL=https://127.0.0.1:3000 WIST_ADMIN_TOKEN=<token> \
//     NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx tests/live-gateway-check.ts <agent_id>
//
// 自签证书的 dev 栈需要 `NODE_TLS_REJECT_UNAUTHORIZED=0`（仅本机 dev 用）。

const base = process.env.WIST_GATEWAY_URL ?? "https://127.0.0.1:3000";
const token = process.env.WIST_ADMIN_TOKEN;
if (!token) {
  console.error("WIST_ADMIN_TOKEN is required");
  process.exit(2);
}

const originalFetch = globalThis.fetch;
// `requestJson` 走的是相对路径（浏览器里由同源代理兜住）：这里补上前缀。
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();
  return originalFetch(url.startsWith("/") ? `${base}${url}` : url, init);
}) as typeof fetch;

setAdminApiToken(token);
const agentId = process.argv[2];
if (!agentId) {
  console.error("usage: tsx tests/live-gateway-check.ts <agent_id>");
  process.exit(2);
}

const catalog = await fetchContentCatalog();
console.log(
  `content 目录：catalog_version=${catalog.catalogVersion} superseded_by=${catalog.supersededBy} ` +
    `templates=${catalog.templates.length} readiness=${catalog.readiness.length}（已摊平）`,
);
for (const template of catalog.templates) {
  console.log(
    `  ${template.machineClass} → ${template.platform} · 面 ${template.familyScope.length} 个 · 策展状态 ${template.status}`,
  );
}

const view = await fetchAgentWork(agentId);
console.log(`work 视图（${agentId}）：sequence=${view.sequence}`);
console.log(
  `  生效中 ${view.standing.length} · 未了结一次性 ${view.oneShot.length} · ` +
    `历史（撤回 ${view.retiredStanding.length} / 了结 ${view.settledOneShot.length}）· 漂移 ${driftingCount(view.standing)}`,
);
for (const work of view.standing) {
  const counts = specCounts(work.spec);
  console.log(
    `  [${work.family}] v${work.planVersion} ${work.status} · ${standingDrift(work)} · ` +
      `单元 ${counts.units} 来源 ${counts.sources} · 指标周期 ${metricIntervalSeconds(work.spec) ?? "—"} · ` +
      `spec 解析错误 ${work.spec.error ?? "无"}`,
  );
  for (const unit of work.spec.units) {
    console.log(
      `      ${unit.unitId}（${unit.capability}，规则 ${unit.ruleRef || "未绑定"}，需 ${unit.requiresPrivilege}）` +
        ` ← ${unit.sources.map((source) => `${source.kind}:${source.target}`).join(" | ") || "无来源"}`,
    );
  }
}

// 页面的派活闸门：拿真实目录 + 真实判定结果算出「能派什么 / 不能派什么」。
const purposeResponse = await originalFetch(
  `${base}/api/v1/admin/agents/${encodeURIComponent(agentId)}/purpose`,
  { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } },
);
const purpose = (await purposeResponse.json()) as {
  fact_summary?: { os?: string } | null;
  classification?: { machine_class?: string } | null;
};
console.log(
  `事实/判定：os=${purpose.fact_summary?.os ?? "未上报"} 判定=${purpose.classification?.machine_class ?? "未判定"}`,
);
const machineClass = purpose.classification?.machine_class as
  | MachineClass
  | undefined;
if (machineClass) {
  console.log(`  平台 ${platformForMachineClass(machineClass)}`);
  console.log(
    `  可派：${
      grantableFamilies(catalog, machineClass)
        .map((entry) => `${entry.family}(${entry.activeUnits}/${entry.totalUnits})`)
        .join("、") || "无"
    }`,
  );
  const blocked = blockedFamilies(catalog, machineClass);
  console.log(
    `  不可派（${blocked.length}）：${
      blocked.map((entry) => `${entry.family}（${entry.reason}）`).join("、") || "无"
    }`,
  );
}

console.log("live gateway check ok");
