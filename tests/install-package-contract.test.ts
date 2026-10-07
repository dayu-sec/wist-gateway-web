import {
  fetchAgentInstallPackage,
  normalizeAgentInstallPackage,
  setAdminApiToken,
  setAgentInstallPackage,
} from "../src/api/admin";

// 契约测试：管理面「Agent 安装包地址」读写。
//
// 后端 admin_ops.rs 直接 `Json(AgentInstallPackageResponse)` 返回**扁平**
// snake_case 载荷（不是 `{install_package: {...}}` 包装），这里同时锁住：
//   1. GET  /api/v1/admin/agent/install-package 的读写路径与方法；
//   2. POST body 的字段名（package_url / package_sha256 / requested_by）；
//   3. 未设置过时 updated_at / package_sha256 为 null（而不是 undefined）——
//      页面用 `?? "未设置..."` 判断，undefined 会让哨兵值失效；
//   4. 必填字段缺失时抛错，不把服务端契约漂移静默成空字段。

interface Recorded {
  url: string;
  method: string;
  authorization: string;
  body: string;
}

let recorded: Recorded[] = [];
let responder: () => Response = () =>
  Response.json({
    address_id: "default",
    package_url: "https://mirror.example.com/wist/agentd.tar.gz",
    package_sha256: "sha256:2f9c1a",
    updated_by: "platform-maintenance-engineer",
    updated_at: "2026-09-19T08:30:00+00:00",
  });

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

// --- 读取：路径 / 方法 / 扁平 snake_case 映射 -------------------------------
recorded = [];
const loaded = await fetchAgentInstallPackage();
const [readCall] = recorded;
if (recorded.length !== 1) {
  throw new Error(`install-package view must issue exactly one request, got ${recorded.length}`);
}
if (readCall.url !== "/api/v1/admin/agent/install-package") {
  throw new Error(`unexpected view path: ${readCall.url}`);
}
// 复数 `/agent/install-packages` 是**另一个**端点（录入历史列表，见 install-packages 契约
// 测试）；这里读写的是单数的「当前生效来源」。两条路径只差一个 `s`，别把读写打到列表上。
if (readCall.url === "/api/v1/admin/agent/install-packages") {
  throw new Error(
    "the install-package view/set must not hit the plural install-packages list endpoint",
  );
}
if (readCall.method !== "GET") {
  throw new Error(`install-package view must be GET, got ${readCall.method}`);
}
if (readCall.authorization !== "Bearer admin-token-under-test") {
  throw new Error("admin credential must be sent in the Authorization Header");
}
if (readCall.body !== "") {
  throw new Error("install-package view must not send a body");
}
if (
  loaded.addressId !== "default" ||
  loaded.packageUrl !== "https://mirror.example.com/wist/agentd.tar.gz" ||
  loaded.packageSha256 !== "sha256:2f9c1a" ||
  loaded.updatedBy !== "platform-maintenance-engineer" ||
  loaded.updatedAt !== "2026-09-19T08:30:00+00:00"
) {
  throw new Error("flat snake_case install-package response was not normalized");
}

// --- 未设置过：摘要与时间必须是 null ---------------------------------------
const unset = normalizeAgentInstallPackage({
  address_id: "default",
  package_url: "/opt/wist/dist/wist-agentd.tar.gz",
  package_sha256: null,
  updated_by: "",
  updated_at: null,
});
if (unset.packageSha256 !== null) {
  throw new Error("null package_sha256 must map to null, not undefined");
}
if (unset.updatedAt !== null) {
  throw new Error("null updated_at must map to null, not undefined");
}
// 关键：字段必须存在，页面才能用 `?? 哨兵` 判定「未设置」。
if (!("packageSha256" in unset) || !("updatedAt" in unset)) {
  throw new Error("nullable install-package fields must not be dropped by the normalizer");
}

// --- 写入：POST / body 字段名 / 返回体复用同一映射 -------------------------
recorded = [];
responder = () =>
  Response.json({
    address_id: "default",
    package_url: "https://mirror.example.com/wist/agentd-v2.tar.gz",
    package_sha256: "sha256:64hex",
    updated_by: "ops-eng",
    updated_at: "2026-09-19T09:00:00+00:00",
  });
const saved = await setAgentInstallPackage({
  packageUrl: "https://mirror.example.com/wist/agentd-v2.tar.gz",
  packageSha256: "sha256:64hex",
  requestedBy: "ops-eng",
});
const [writeCall] = recorded;
if (recorded.length !== 1) {
  throw new Error(`install-package set must issue exactly one request, got ${recorded.length}`);
}
if (writeCall.url !== "/api/v1/admin/agent/install-package") {
  throw new Error(`unexpected set path: ${writeCall.url}`);
}
if (writeCall.method !== "POST") {
  throw new Error(`install-package set must be POST, got ${writeCall.method}`);
}
if (writeCall.authorization !== "Bearer admin-token-under-test") {
  throw new Error("install-package set must keep the credential in the Authorization Header");
}
const sentBody = JSON.parse(writeCall.body) as Record<string, unknown>;
if (
  sentBody.package_url !== "https://mirror.example.com/wist/agentd-v2.tar.gz" ||
  sentBody.package_sha256 !== "sha256:64hex" ||
  sentBody.requested_by !== "ops-eng"
) {
  throw new Error(`install-package set body does not match the backend request contract: ${writeCall.body}`);
}
// 前端不让 URL/摘要进入查询串。
if (writeCall.url.includes("package_url") || writeCall.url.includes("token")) {
  throw new Error("install-package set must not put fields or credentials in the URL");
}
if (saved.packageUrl !== "https://mirror.example.com/wist/agentd-v2.tar.gz" || saved.updatedBy !== "ops-eng") {
  throw new Error("install-package set must return the stored setting");
}

// --- `package_sha256` 必填、永远带上；`requested_by` 仍可选，省略时不发空键 ---------
recorded = [];
await setAgentInstallPackage({
  packageUrl: "https://mirror.example.com/wist/agentd.tar.gz",
  packageSha256: "sha256:64hex",
});
const requiredBody = JSON.parse(recorded[0].body) as Record<string, unknown>;
if (requiredBody.package_sha256 !== "sha256:64hex") {
  throw new Error("package_sha256 is required and must always be present in the set body");
}
if ("requested_by" in requiredBody) {
  throw new Error("omitted requested_by must not be sent as an empty key");
}
if (requiredBody.package_url !== "https://mirror.example.com/wist/agentd.tar.gz") {
  throw new Error("package_url must always be present in the set body");
}

// --- 兼容包装载荷（若后端未来改为包一层 install_package） -------------------
const wrapped = normalizeAgentInstallPackage({
  install_package: {
    address_id: "default",
    package_url: "https://mirror.example.com/wist/agentd.tar.gz",
    package_sha256: null,
    updated_by: "ops-eng",
    updated_at: null,
  },
});
if (wrapped.packageUrl !== "https://mirror.example.com/wist/agentd.tar.gz") {
  throw new Error("wrapped install_package payload was not normalized");
}

// --- 契约漂移必须显式失败 ---------------------------------------------------
let rejectedMissingUrl = false;
try {
  normalizeAgentInstallPackage({
    address_id: "default",
    package_sha256: null,
    updated_by: "",
    updated_at: null,
  });
} catch {
  rejectedMissingUrl = true;
}
if (!rejectedMissingUrl) {
  throw new Error("missing package_url must be rejected instead of silently blanked");
}

let rejectedMissingUpdatedBy = false;
try {
  normalizeAgentInstallPackage({
    address_id: "default",
    package_url: "/opt/wist/dist/wist-agentd.tar.gz",
    package_sha256: null,
    updated_at: null,
  });
} catch {
  rejectedMissingUpdatedBy = true;
}
if (!rejectedMissingUpdatedBy) {
  throw new Error("missing updated_by must be rejected");
}

console.log("agent install package contract test passed");
