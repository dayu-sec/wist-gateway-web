import {
  fetchAgentInstallPackage,
  normalizeAgentInstallPackage,
  setAdminApiToken,
  setAgentInstallPackage,
} from "../src/api/admin";

// 契约测试：管理面「Agent 安装包地址」读写（**多平台**）。
//
// 后端 admin_ops.rs 直接 `Json(AgentInstallPackageResponse)` 返回扁平 snake_case 载荷
// （`{packages: [{platform, package_url, ...}]}`，不是 `{install_package: {...}}` 包装），这里锁住：
//   1. GET  /api/v1/admin/agent/install-package 的读写路径与方法；
//   2. POST body 的字段名（artifacts[].platform / package_url / package_sha256，+ requested_by）；
//   3. 未设置过时 package_sha256 / updated_at 为 null（而不是 undefined）；
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
    packages: [
      {
        platform: "aarch64-apple-darwin",
        package_url: "https://mirror.example.com/wist/agentd-macos.tar.gz",
        package_sha256: "sha256:2f9c1a",
        updated_by: "platform-maintenance-engineer",
        updated_at: "2026-09-19T08:30:00+00:00",
      },
      {
        platform: "x86_64-unknown-linux-musl",
        package_url: "https://mirror.example.com/wist/agentd-linux-x86.tar.gz",
        package_sha256: "sha256:ab12cd",
        updated_by: "platform-maintenance-engineer",
        updated_at: "2026-09-19T08:30:00+00:00",
      },
    ],
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
  throw new Error(
    `install-package view must issue exactly one request, got ${recorded.length}`,
  );
}
if (readCall.url !== "/api/v1/admin/agent/install-package") {
  throw new Error(`unexpected view path: ${readCall.url}`);
}
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
  loaded.packages.length !== 2 ||
  loaded.packages[0].platform !== "aarch64-apple-darwin" ||
  loaded.packages[0].packageUrl !==
    "https://mirror.example.com/wist/agentd-macos.tar.gz" ||
  loaded.packages[0].packageSha256 !== "sha256:2f9c1a" ||
  loaded.packages[0].updatedBy !== "platform-maintenance-engineer" ||
  loaded.packages[0].updatedAt !== "2026-09-19T08:30:00+00:00" ||
  loaded.packages[1].platform !== "x86_64-unknown-linux-musl"
) {
  throw new Error("flat snake_case install-package response was not normalized");
}

// --- 未设置过：摘要与时间必须是 null ---------------------------------------
const unset = normalizeAgentInstallPackage({
  packages: [
    {
      platform: "aarch64-apple-darwin",
      package_url: "/opt/wist/dist/wist-agentd.tar.gz",
      package_sha256: null,
      updated_by: "",
      updated_at: null,
    },
  ],
});
if (unset.packages[0].packageSha256 !== null) {
  throw new Error("null package_sha256 must map to null, not undefined");
}
if (unset.packages[0].updatedAt !== null) {
  throw new Error("null updated_at must map to null, not undefined");
}
if (
  !("packageSha256" in unset.packages[0]) ||
  !("updatedAt" in unset.packages[0])
) {
  throw new Error(
    "nullable install-package fields must not be dropped by the normalizer",
  );
}

// --- 写入：POST / body 字段名 / 返回体复用同一映射 -------------------------
recorded = [];
responder = () =>
  Response.json({
    packages: [
      {
        platform: "aarch64-apple-darwin",
        package_url: "https://mirror.example.com/wist/agentd-v2.tar.gz",
        package_sha256: "sha256:64hex",
        updated_by: "ops-eng",
        updated_at: "2026-09-19T09:00:00+00:00",
      },
    ],
  });
const saved = await setAgentInstallPackage({
  artifacts: [
    {
      platform: "aarch64-apple-darwin",
      packageUrl: "https://mirror.example.com/wist/agentd-v2.tar.gz",
      packageSha256: "sha256:64hex",
    },
  ],
  requestedBy: "ops-eng",
});
const [writeCall] = recorded;
if (recorded.length !== 1) {
  throw new Error(
    `install-package set must issue exactly one request, got ${recorded.length}`,
  );
}
if (writeCall.url !== "/api/v1/admin/agent/install-package") {
  throw new Error(`unexpected set path: ${writeCall.url}`);
}
if (writeCall.method !== "POST") {
  throw new Error(`install-package set must be POST, got ${writeCall.method}`);
}
if (writeCall.authorization !== "Bearer admin-token-under-test") {
  throw new Error(
    "install-package set must keep the credential in the Authorization Header",
  );
}
const sentBody = JSON.parse(writeCall.body) as {
  artifacts?: Array<Record<string, unknown>>;
  requested_by?: unknown;
};
if (!Array.isArray(sentBody.artifacts) || sentBody.artifacts.length !== 1) {
  throw new Error(
    `install-package set must send an artifacts array: ${writeCall.body}`,
  );
}
if (
  sentBody.artifacts[0].platform !== "aarch64-apple-darwin" ||
  sentBody.artifacts[0].package_url !==
    "https://mirror.example.com/wist/agentd-v2.tar.gz" ||
  sentBody.artifacts[0].package_sha256 !== "sha256:64hex" ||
  sentBody.requested_by !== "ops-eng"
) {
  throw new Error(
    `install-package set body does not match the backend request contract: ${writeCall.body}`,
  );
}
// 前端不让 URL/摘要进入查询串。
if (writeCall.url.includes("package_url") || writeCall.url.includes("token")) {
  throw new Error(
    "install-package set must not put fields or credentials in the URL",
  );
}
if (
  saved.packages[0].packageUrl !==
    "https://mirror.example.com/wist/agentd-v2.tar.gz" ||
  saved.packages[0].updatedBy !== "ops-eng"
) {
  throw new Error("install-package set must return the stored settings");
}

// --- `package_sha256` 必填、永远带上；`requested_by` 仍可选，省略时不发空键 -----
recorded = [];
await setAgentInstallPackage({
  artifacts: [
    {
      platform: "x86_64-unknown-linux-musl",
      packageUrl: "https://mirror.example.com/wist/agentd.tar.gz",
      packageSha256: "sha256:64hex",
    },
  ],
});
const requiredBody = JSON.parse(recorded[0].body) as {
  artifacts: Array<Record<string, unknown>>;
  requested_by?: unknown;
};
if (requiredBody.artifacts[0].package_sha256 !== "sha256:64hex") {
  throw new Error(
    "package_sha256 is required and must always be present in the set body",
  );
}
if ("requested_by" in requiredBody) {
  throw new Error("omitted requested_by must not be sent as an empty key");
}
if (
  requiredBody.artifacts[0].package_url !==
  "https://mirror.example.com/wist/agentd.tar.gz"
) {
  throw new Error("package_url must always be present in the set body");
}

// --- 兼容包装载荷（若后端未来改为包一层 install_package） -------------------
const wrapped = normalizeAgentInstallPackage({
  install_package: {
    packages: [
      {
        platform: "aarch64-apple-darwin",
        package_url: "https://mirror.example.com/wist/agentd.tar.gz",
        package_sha256: null,
        updated_by: "ops-eng",
        updated_at: null,
      },
    ],
  },
});
if (
  wrapped.packages[0].packageUrl !==
  "https://mirror.example.com/wist/agentd.tar.gz"
) {
  throw new Error("wrapped install_package payload was not normalized");
}

// --- 契约漂移必须显式失败 ---------------------------------------------------
let rejectedMissingPackages = false;
try {
  normalizeAgentInstallPackage({});
} catch {
  rejectedMissingPackages = true;
}
if (!rejectedMissingPackages) {
  throw new Error("missing packages array must be rejected");
}

let rejectedMissingUrl = false;
try {
  normalizeAgentInstallPackage({
    packages: [
      {
        platform: "aarch64-apple-darwin",
        package_sha256: null,
        updated_by: "",
        updated_at: null,
      },
    ],
  });
} catch {
  rejectedMissingUrl = true;
}
if (!rejectedMissingUrl) {
  throw new Error(
    "missing package_url must be rejected instead of silently blanked",
  );
}

let rejectedMissingPlatform = false;
try {
  normalizeAgentInstallPackage({
    packages: [
      {
        package_url: "/opt/wist/dist/wist-agentd.tar.gz",
        package_sha256: null,
        updated_by: "ops-eng",
        updated_at: null,
      },
    ],
  });
} catch {
  rejectedMissingPlatform = true;
}
if (!rejectedMissingPlatform) {
  throw new Error("missing platform must be rejected");
}

console.log("agent install package contract test passed");
