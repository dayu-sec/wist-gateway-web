import {
  ApiError,
  activateKnowledgePackage,
  fetchKnowledge,
  fetchKnowledgeLocks,
  fetchKnowledgePackages,
  normalizeKnowledge,
  normalizeKnowledgeLocks,
  normalizeKnowledgePackage,
  parseKnowledgeErrorDetail,
  recordKnowledgePackage,
  setAdminApiToken,
  type KnowledgeView,
} from "../src/api/admin";
import {
  findActiveKnowledgePackage,
  knowledgeActionErrorMessage,
  knowledgeLoadErrorMessage,
  knowledgePackageVersionSummary,
  knowledgeShaLabel,
  knowledgeSignatureLabel,
  knowledgeVersionLabel,
  knowledgeVersionSummary,
  lockedWorkTotal,
  rollbackTarget,
  staleLocks,
} from "../src/components/knowledgeContent";

// 契约测试：网关**知识库内容**的管理面（`/api/v1/admin/knowledge*`）。
//
// 为什么单测这一块：策展内容（采集目录 / 包 / 模板 + 用途规则 + 发现策略）过去靠改配置文件 +
// 重启网关，现在改成「录入包 → 激活」的管理面通路。这里锁住新口径的取数与解析：
//   1. 五条路由的路径、方法与凭据（token 进 Authorization Header，不进查询串）；
//   2. **录入 ≠ 生效**：`POST …/packages` 的 `activate` 缺省 `false`，字段是 snake_case；
//   3. **空载不是错误**：`configured: false` + `hint` 必须原样透出（页面靠它给「怎么办」）；
//   4. **形状漂移必须显式失败**（缺 `activations` / `files` / `locks`），不静默成空列表 ——
//      那会让页面说「没有内容 / 没有工作锁」，比报错更难查；
//   5. 错误的 `{code, message}` 正文要能解出 `code`（页面据此给处置建议）。

interface Recorded {
  url: string;
  method: string;
  authorization: string;
  body: string;
}

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(`FAIL: ${message}`);
}

let recorded: Recorded[] = [];

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

let responder: () => Response = () => Response.json({});

setAdminApiToken("admin-token-under-test");

const SHA = "a".repeat(64);
const PACKAGE_ID = `kbp-${SHA.slice(0, 16)}`;

function json(body: unknown): Response {
  return Response.json(body);
}

// ── ① `GET /api/v1/admin/knowledge`：路径 / 方法 / 凭据 ──────────────────────
responder = () =>
  json({
    source: "package",
    configured: true,
    package_id: PACKAGE_ID,
    generation: 4,
    catalog_version: 12,
    template_version: 12,
    policy_version: 5,
    purpose_version: 3,
    active: {
      package_id: PACKAGE_ID,
      activated_by: "ops-eng",
      activated_at: "2026-09-30T08:40:00Z",
    },
    hint: null,
    activations: [
      {
        from_package: "kbp-old",
        to_package: PACKAGE_ID,
        generation: 4,
        reason: "activate",
        requested_by: "ops-eng",
        created_at: "2026-09-30T08:40:00Z",
      },
    ],
  });

recorded = [];
const knowledge = await fetchKnowledge();
check(recorded.length === 1, "fetchKnowledge 必须只发一次请求");
check(
  recorded[0].url === "/api/v1/admin/knowledge",
  `知识库生效态路径不对：${recorded[0].url}`,
);
check(recorded[0].method === "GET", "知识库生效态必须是 GET");
check(
  recorded[0].authorization === "Bearer admin-token-under-test",
  "管理凭据必须走 Authorization Header",
);
check(recorded[0].body === "", "读生效态不该带请求体");
check(
  !recorded[0].url.includes("admin-token-under-test"),
  "管理凭据不得泄漏进查询串",
);

// snake_case → camelCase
check(
  knowledge.source === "package" &&
    knowledge.configured === true &&
    knowledge.packageId === PACKAGE_ID &&
    knowledge.generation === 4 &&
    knowledge.catalogVersion === 12 &&
    knowledge.templateVersion === 12 &&
    knowledge.policyVersion === 5 &&
    knowledge.purposeVersion === 3 &&
    knowledge.hint === null,
  "知识库生效态的 snake_case 字段没有归一化",
);
check(
  knowledge.active?.packageId === PACKAGE_ID &&
    knowledge.active?.activatedBy === "ops-eng" &&
    knowledge.active?.activatedAt === "2026-09-30T08:40:00Z",
  "生效包的登记信息（active）没有归一化",
);
check(
  knowledge.activations.length === 1 &&
    knowledge.activations[0].fromPackage === "kbp-old" &&
    knowledge.activations[0].toPackage === PACKAGE_ID &&
    knowledge.activations[0].generation === 4 &&
    knowledge.activations[0].reason === "activate" &&
    knowledge.activations[0].requestedBy === "ops-eng" &&
    knowledge.activations[0].createdAt === "2026-09-30T08:40:00Z",
  "切换审计（activations）没有归一化",
);

// ── ② 空载：`configured: false` + `hint` 是**合法结果**，不是错误 ──────────────
responder = () =>
  json({
    source: "none",
    configured: false,
    package_id: null,
    generation: 0,
    catalog_version: null,
    template_version: null,
    policy_version: null,
    purpose_version: null,
    active: null,
    hint: "知识库未配置：不产「系统类型」建议与用途建议；发现策略用 agentd 内建默认值。",
    activations: [],
  });
const empty = await fetchKnowledge();
check(empty.configured === false, "空载必须映射成 configured=false");
check(
  empty.source === "none" && empty.packageId === null && empty.active === null,
  "空载的 source / packageId / active 口径不对",
);
check(
  typeof empty.hint === "string" && empty.hint.length > 0,
  "空载必须带上「为什么 + 怎么办」的 hint",
);
check(
  empty.generation === 0 &&
    empty.catalogVersion === null &&
    empty.templateVersion === null &&
    empty.policyVersion === null &&
    empty.purposeVersion === null &&
    empty.activations.length === 0,
  "空载的版本号与审计必须是 0 / null / 空",
);
// `active` / `hint` 的键必须**存在**（值为 null）：缺失属于契约漂移，不能读成「恰好为空」。
let rejectedMissingHint = false;
try {
  normalizeKnowledge({
    source: "none",
    configured: false,
    package_id: null,
    generation: 0,
    catalog_version: null,
    template_version: null,
    policy_version: null,
    purpose_version: null,
    active: null,
    activations: [],
  });
} catch {
  rejectedMissingHint = true;
}
check(rejectedMissingHint, "缺 `hint` 键必须显式失败，而不是静默读成 null");

// ── ③ `GET …/knowledge/packages`：裸数组 + 一项的完整形状 ─────────────────────
const PKG = {
  package_id: PACKAGE_ID,
  source:
    "https://github.com/dayu-sec/wist-knowledge/releases/download/v0.1.1/wist-knowledge-0.1.1.tar.gz",
  package_sha256: SHA,
  version: "0.1.1",
  catalog_version: 12,
  template_version: 12,
  policy_version: 5,
  purpose_version: 3,
  parser_abi: 1,
  signed_by: "b".repeat(64),
  cached_path: "/var/lib/wist-gateway/knowledge/kbp-aaa",
  created_by: "ops-eng",
  created_at: "2026-09-30T08:35:00Z",
  active: true,
  available: true,
  files: [
    { name: "catalog.toml", sha256: "c".repeat(64), bytes: 1024 },
    { name: "manifest.json", sha256: "d".repeat(64), bytes: 256 },
  ],
};

responder = () => json([PKG]);
recorded = [];
const packages = await fetchKnowledgePackages();
check(
  recorded[0].url === "/api/v1/admin/knowledge/packages" &&
    recorded[0].method === "GET",
  `录入历史路径 / 方法不对：${recorded[0].method} ${recorded[0].url}`,
);
check(packages.length === 1, `期望一条录入历史，得到 ${packages.length}`);
const first = packages[0];
check(
  first.packageId === PACKAGE_ID &&
    first.packageSha256 === SHA &&
    first.version === "0.1.1" &&
    first.catalogVersion === 12 &&
    first.templateVersion === 12 &&
    first.policyVersion === 5 &&
    first.purposeVersion === 3 &&
    first.signedBy === "b".repeat(64) &&
    first.cachedPath === "/var/lib/wist-gateway/knowledge/kbp-aaa" &&
    first.createdBy === "ops-eng" &&
    first.createdAt === "2026-09-30T08:35:00Z" &&
    first.active === true &&
    first.available === true,
  "录入历史的 snake_case 字段没有归一化",
);
check(
  first.files.length === 2 &&
    first.files[0].name === "catalog.toml" &&
    first.files[0].sha256 === "c".repeat(64) &&
    first.files[0].bytes === 1024,
  "包副本文件清单（files）没有归一化",
);

// 空历史是合法结果（页面据此给录入指引）。
responder = () => json([]);
const noPackages = await fetchKnowledgePackages();
check(noPackages.length === 0, "空录入历史必须映射成空列表");

// 缺 `files` 必须显式失败。
let rejectedMissingFiles = false;
try {
  normalizeKnowledgePackage({ ...PKG, files: undefined });
} catch {
  rejectedMissingFiles = true;
}
check(rejectedMissingFiles, "包缺 `files` 数组必须显式失败");

// ── ④ 录入：`activate` 缺省 false，字段是 snake_case ─────────────────────────
responder = () => json({ ...PKG, active: false });
recorded = [];
const recordedPkg = await recordKnowledgePackage({ source: "file.tar.gz" });
const recordCall = recorded[0];
check(
  recordCall.url === "/api/v1/admin/knowledge/packages" &&
    recordCall.method === "POST",
  `录入的路径 / 方法不对：${recordCall.method} ${recordCall.url}`,
);
const recordBody = JSON.parse(recordCall.body) as Record<string, unknown>;
check(
  recordBody.source === "file.tar.gz" &&
    recordBody.activate === false &&
    !("sha256" in recordBody) &&
    !("requested_by" in recordBody),
  `录入请求体口径不对（activate 缺省必须显式 false，可选键不得出现）：${recordCall.body}`,
);
check(recordedPkg.active === false, "录入响应必须原样带回 active=false");
check(
  recordedPkg.packageId === PACKAGE_ID,
  "录入响应必须归一化成同一个 KnowledgePackageView 形状",
);

responder = () => json({ ...PKG, active: true });
recorded = [];
await recordKnowledgePackage({
  source: "file.tar.gz",
  sha256: SHA,
  activate: true,
  requestedBy: "ops-eng",
});
const recordBody2 = JSON.parse(recorded[0].body) as Record<string, unknown>;
check(
  recordBody2.sha256 === SHA &&
    recordBody2.activate === true &&
    recordBody2.requested_by === "ops-eng",
  `录入的可选键没有按 snake_case 透出：${recorded[0].body}`,
);

// ── ⑤ 激活 / 回滚：同一条接口，`reason` 区分 ─────────────────────────────────
responder = () => json({ ...PKG, active: true });
recorded = [];
await activateKnowledgePackage("kbp-old", { reason: "rollback" });
check(
  recorded[0].url === "/api/v1/admin/knowledge/packages/kbp-old/activate" &&
    recorded[0].method === "POST",
  `激活路径 / 方法不对：${recorded[0].method} ${recorded[0].url}`,
);
const activateBody = JSON.parse(recorded[0].body) as Record<string, unknown>;
check(
  activateBody.reason === "rollback" && !("requested_by" in activateBody),
  `激活请求体口径不对：${recorded[0].body}`,
);
// 包 id 必须转义：它是内容寻址的 `kbp-…`，但路径段不该被原样拼进去。
recorded = [];
await activateKnowledgePackage("kbp/weird id", {});
check(
  recorded[0].url ===
    "/api/v1/admin/knowledge/packages/kbp%2Fweird%20id/activate",
  `包 id 未转义：${recorded[0].url}`,
);
// `reason` 缺省时不下发该键（网关按 `activate` 处理）。
check(
  !("reason" in (JSON.parse(recorded[0].body) as Record<string, unknown>)),
  "reason 缺省时不该下发该键",
);

// ── ⑥ `GET …/knowledge/locks` ──────────────────────────────────────────────
responder = () =>
  json({
    active_catalog_version: 12,
    locks: [
      { catalog_version: 12, works: 4 },
      { catalog_version: 11, works: 2 },
    ],
  });
recorded = [];
const locks = await fetchKnowledgeLocks();
check(
  recorded[0].url === "/api/v1/admin/knowledge/locks" &&
    recorded[0].method === "GET",
  `锁旧版路径 / 方法不对：${recorded[0].method} ${recorded[0].url}`,
);
check(
  locks.activeCatalogVersion === 12 &&
    locks.locks.length === 2 &&
    locks.locks[1].catalogVersion === 11 &&
    locks.locks[1].works === 2,
  "锁旧版的分组没有归一化",
);
check(lockedWorkTotal(locks) === 6, "锁旧版总数应为各组之和");
check(
  staleLocks(locks).length === 1 && staleLocks(locks)[0].catalogVersion === 11,
  "staleLocks 应只留下**不**等于生效目录版本的那几组",
);

let rejectedMissingLocks = false;
try {
  // `locks` 取自 `presentField`：键缺失必须显式失败。
  normalizeKnowledgeLocks({ active_catalog_version: 12 });
} catch {
  rejectedMissingLocks = true;
}
check(rejectedMissingLocks, "缺 `locks` 键必须显式失败");

const locksNoActive = {
  activeCatalogVersion: null,
  locks: [{ catalogVersion: 3, works: 1 }],
};
check(
  lockedWorkTotal(locksNoActive) === 1 &&
    staleLocks(locksNoActive).length === 1,
  "生效目录版本未知时，所有分组都算「锁在旧版」",
);

// ── ⑦ 错误正文 `{code, message}` ───────────────────────────────────────────
check(
  parseKnowledgeErrorDetail(
    '{"code":"package_signature_invalid","message":"签名验不过"}',
  )?.code === "package_signature_invalid",
  "必须能从错误正文里解出 code",
);
check(
  parseKnowledgeErrorDetail('{"code":"x","message":"y"}')?.message === "y",
  "必须能从错误正文里解出 message",
);
check(
  parseKnowledgeErrorDetail('{"code":"x"}') === null,
  "没有 message 的正文不算结构化错误（回落原文）",
);
check(
  parseKnowledgeErrorDetail("plain text") === null &&
    parseKnowledgeErrorDetail(undefined) === null,
  "非 JSON / 空正文必须回 null",
);

// ── ⑧ 显示口径（纯函数） ───────────────────────────────────────────────────
const view: KnowledgeView = {
  source: "package",
  configured: true,
  packageId: PACKAGE_ID,
  generation: 4,
  catalogVersion: 12,
  templateVersion: null,
  policyVersion: 5,
  purposeVersion: null,
  active: {
    packageId: PACKAGE_ID,
    activatedBy: "ops-eng",
    activatedAt: "2026-09-30T08:40:00Z",
  },
  hint: null,
  activations: [
    {
      fromPackage: "kbp-old",
      toPackage: PACKAGE_ID,
      generation: 4,
      reason: "activate",
      requestedBy: "ops-eng",
      createdAt: "2026-09-30T08:40:00Z",
    },
  ],
};

check(
  knowledgeVersionSummary(view) === "目录 12 · 策略 5",
  `版本摘要应省略取不到的份数：${knowledgeVersionSummary(view)}`,
);
check(
  knowledgePackageVersionSummary(first) ===
    "目录 12 · 模板 12 · 策略 5 · 用途 3",
  `包的内容版本摘要不对：${knowledgePackageVersionSummary(first)}`,
);
check(knowledgeVersionLabel(first) === "v0.1.1", "版本显示应为 v0.1.1");
check(
  knowledgeVersionLabel({ ...first, version: "" }) === "未知版本",
  "版本为空时不该装作有",
);
check(
  knowledgeShaLabel(SHA) === `${"a".repeat(12)}…`,
  `摘要截短口径不对：${knowledgeShaLabel(SHA)}`,
);
check(
  knowledgeSignatureLabel({ ...first, signedBy: "" }) ===
    "未验签（网关未配公钥）",
  "未配公钥时必须说「未验签」，而不是显示空签发者",
);
check(
  knowledgeSignatureLabel(first).startsWith("已验签"),
  "验签通过时应报「已验签」",
);

check(
  findActiveKnowledgePackage([first], PACKAGE_ID)?.packageId === PACKAGE_ID,
  "生效包要能按 id 对齐到录入历史",
);
check(
  findActiveKnowledgePackage([first], "kbp-nope") === null &&
    findActiveKnowledgePackage([first], null) === null,
  "对齐不上 / 无生效包时返回 null（页面据此说「未识别」）",
);

const rollbackOk = rollbackTarget(view, [{ ...first, packageId: "kbp-old" }]);
check(
  rollbackOk?.packageId === "kbp-old" && rollbackOk.blockedReason === null,
  "回滚目标应取最近一次切换的 from_package，且副本在时可用",
);
check(
  rollbackTarget(view, [])?.blockedReason !== null,
  "上一版不在历史里时必须给出不能回滚的原因",
);
check(
  rollbackTarget(view, [{ ...first, packageId: "kbp-old", available: false }])
    ?.blockedReason !== null,
  "上一版副本缺失时必须给出不能回滚的原因",
);
check(
  rollbackTarget({ ...view, activations: [] }, []) === null,
  "没有切换记录时没有「上一版」可回滚",
);
check(
  rollbackTarget(
    {
      ...view,
      activations: [{ ...view.activations[0], fromPackage: null }],
    },
    [],
  ) === null,
  "首次激活（from_package 为 null）没有可回滚的上一版",
);

// ── ⑨ 401 是确定性错误：ApiError 保留状态码与路径，页面据此提示重填 token ──────
responder = () =>
  new Response(JSON.stringify({ code: "x", message: "y" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
let unauthorized = false;
try {
  await fetchKnowledge();
} catch (error) {
  unauthorized = error instanceof ApiError && error.status === 401;
}
check(unauthorized, "401 必须抛 ApiError(401)");

// ── ⑩ 提示语：**空的 5xx 正文**要说「网关没应答」，而不是「请检查网关日志」─────────
// 2026-09-30 现场：网关进程没在跑，dev 代理回了无正文 500，页面却说「请检查网关日志」——
// 把人送进日志里找一个不存在的错误。知识库这几条路由自己的 5xx 一定带 {code, message}，
// 所以「空正文」这个信号足以把两者分开。
const noAnswer = knowledgeLoadErrorMessage(
  new ApiError(500, "/api/v1/admin/knowledge"),
);
check(
  noAnswer.includes("网关没有应答"),
  `空正文 5xx 应说「网关没有应答」：${noAnswer}`,
);
check(
  noAnswer.includes("WARP_INSIGHT_WEB_PROXY_TARGET"),
  "「网关没应答」的提示要能指向 dev 代理这个最常见的坑",
);
const withBody = knowledgeLoadErrorMessage(
  new ApiError(
    500,
    "/api/v1/admin/knowledge/locks",
    undefined,
    '{"code":"package_store_failed","message":"统计工作版本失败"}',
  ),
);
check(
  withBody === "网关返回 HTTP 500：统计工作版本失败",
  `带正文的 5xx 要透出正文：${withBody}`,
);
check(
  !withBody.includes("网关没有应答"),
  "带正文的 5xx 不应被当成「网关没应答」",
);
check(
  knowledgeLoadErrorMessage(
    new ApiError(401, "/api/v1/admin/knowledge"),
  ).includes("Admin Token"),
  "401 要提示重填 Admin Token",
);
check(
  knowledgeLoadErrorMessage(
    new ApiError(404, "/api/v1/admin/knowledge"),
  ).includes("旧构建"),
  "404 要提示网关很可能是旧构建",
);

const signed = knowledgeActionErrorMessage(
  new ApiError(
    422,
    "/api/v1/admin/knowledge/packages",
    undefined,
    '{"code":"package_signature_invalid","message":"签名验不过"}',
  ),
  "录入",
);
check(
  signed.includes("package_signature_invalid") && signed.includes("签名验不过"),
  `动作失败要同时给出 code 与正文：${signed}`,
);
check(
  signed.includes("包被动过"),
  `可识别的 code 要顺带给处置建议：${signed}`,
);
check(
  knowledgeActionErrorMessage(new ApiError(500, "/x"), "切换").includes(
    "网关没有应答",
  ),
  "动作失败遇上空正文 5xx 也要说「网关没应答」",
);

console.log("knowledge contract test passed");
