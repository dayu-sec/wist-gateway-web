import {
  ApiError,
  type InstallPackageView,
  fetchInstallPackages,
  jsonUpgradeSpec,
  parseUpgradeSpec,
  setAdminApiToken,
} from "../src/api/admin";
import {
  canSubmitUpgrade,
  findSelectedPackage,
  indexPackagesByUrl,
  isEmptyPackageHistory,
  packageCellLabel,
  packageOptionLabel,
} from "../src/components/agentUpgradePackages";

// 契约测试：网关**已录入**的安装包历史（`GET /api/v1/admin/agent/install-packages`）。
//
// 为什么单测这一块：升级页原让操作者手输包地址 + 摘要，现在改成从这里选一个已录入的包。
// 这里锁住新口径的取数与解析：
//   1. GET 路径与方法、凭据（token 进 Authorization Header，不进查询串）；
//   2. `packages[]` 的 snake_case → camelCase 映射，尤其 `agent_package_url`（网关派生好的
//      下载地址）必须原样透出 —— 前端**不自己拼** URL；
//   3. **形状漂移必须显式失败**（缺 `packages` 数组 / 某项缺 `package_id` 或 `agent_package_url`），
//      不静默成「一个包都没录入」或空地址 —— 那比报错更难查。

interface Recorded {
  url: string;
  method: string;
  authorization: string;
  body: string;
}

let recorded: Recorded[] = [];

const INSTALLED = {
  package_id: "pkg-0.1.9-darwin-arm64",
  source: "/Users/ops/wist-agentd-0.1.9-aarch64-apple-darwin.tar.gz",
  package_sha256: `sha256:${"a".repeat(64)}`,
  version: "0.1.9",
  arch: "aarch64-apple-darwin",
  agent_package_url:
    "https://gateway.example.com/api/v1/agent/packages/pkg-0.1.9-darwin-arm64",
  created_by: "ops-eng",
  created_at: "2026-09-20T08:30:00Z",
};

function payload(packages: unknown[]): Record<string, unknown> {
  return { packages };
}

let responder: () => Response = () => Response.json(payload([INSTALLED]));

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

// --- 路径 / 方法 / 凭据 -----------------------------------------------------
recorded = [];
const packages = await fetchInstallPackages();
const [call] = recorded;
if (recorded.length !== 1) {
  throw new Error(
    `install packages must issue exactly one request, got ${recorded.length}`,
  );
}
if (call.url !== "/api/v1/admin/agent/install-packages") {
  throw new Error(`unexpected path: ${call.url}`);
}
// 单数 `/agent/install-package` 是**另一个**端点（当前生效来源的读写，见 install-package
// 契约测试）；历史列表必须是复数这条。两个路径只差一个 `s`，正是最容易复制粘贴带错的。
if (call.url === "/api/v1/admin/agent/install-package") {
  throw new Error(
    "the package list must hit the plural install-packages endpoint, not install-package",
  );
}
if (call.method !== "GET") {
  throw new Error(`install packages must be GET, got ${call.method}`);
}
if (call.authorization !== "Bearer admin-token-under-test") {
  throw new Error("admin credential must be sent in the Authorization Header");
}
if (call.body !== "") {
  throw new Error("install packages must not send a body");
}
if (call.url.includes("admin-token-under-test")) {
  throw new Error("the admin credential must not leak into the query string");
}

// --- snake_case → camelCase（含网关派生的 agent_package_url）-------------------------
if (packages.length !== 1) {
  throw new Error(`expected one package, got ${packages.length}`);
}
const first = packages[0];
if (
  first.packageId !== "pkg-0.1.9-darwin-arm64" ||
  first.source !== "/Users/ops/wist-agentd-0.1.9-aarch64-apple-darwin.tar.gz" ||
  first.packageSha256 !== `sha256:${"a".repeat(64)}` ||
  first.version !== "0.1.9" ||
  first.arch !== "aarch64-apple-darwin" ||
  first.createdBy !== "ops-eng" ||
  first.createdAt !== "2026-09-20T08:30:00Z"
) {
  throw new Error("flat snake_case install package entry was not normalized");
}
// 下载地址必须原样透出，且确实是网关那边的地址（前端不自己拼）。
if (
  first.agentPackageUrl !==
  "https://gateway.example.com/api/v1/agent/packages/pkg-0.1.9-darwin-arm64"
) {
  throw new Error("agent_package_url must be carried through verbatim");
}

// --- 空历史是合法结果（不是错误）：页面会据此给录入指引 ----------------------
responder = () => Response.json(payload([]));
const empty = await fetchInstallPackages();
if (empty.length !== 0) {
  throw new Error("an empty package history must map to an empty list");
}

// --- 形状漂移必须显式失败 ---------------------------------------------------
responder = () => Response.json({});
let rejectedMissingArray = false;
try {
  await fetchInstallPackages();
} catch {
  rejectedMissingArray = true;
}
if (!rejectedMissingArray) {
  throw new Error(
    "missing packages array must be rejected instead of silently empty",
  );
}

responder = () =>
  Response.json(payload([{ ...INSTALLED, package_id: undefined }]));
let rejectedMissingId = false;
try {
  await fetchInstallPackages();
} catch {
  rejectedMissingId = true;
}
if (!rejectedMissingId) {
  throw new Error("an entry without package_id must be rejected");
}

// `agent_package_url` 不能悄悄变空：页面拿它当 package_url 提交，缺了就得报错。
responder = () =>
  Response.json(payload([{ ...INSTALLED, agent_package_url: undefined }]));
let rejectedMissingUrl = false;
try {
  await fetchInstallPackages();
} catch {
  rejectedMissingUrl = true;
}
if (!rejectedMissingUrl) {
  throw new Error("an entry without agent_package_url must be rejected");
}

// --- `packages` 不是数组：显式失败（不静默成空列表）------------------
for (const bad of [null, {}, "pkg", 42]) {
  responder = () => Response.json({ packages: bad });
  let rejectedBadPackages = false;
  try {
    await fetchInstallPackages();
  } catch {
    rejectedBadPackages = true;
  }
  if (!rejectedBadPackages) {
    throw new Error(
      `packages=${JSON.stringify(bad)} must be rejected instead of silently empty`,
    );
  }
}

// --- 每条必填字段缺失 / 为 null 都必须拒 -------------------------------
for (const field of [
  "package_id",
  "source",
  "package_sha256",
  "version",
  "arch",
  "agent_package_url",
  "created_by",
  "created_at",
]) {
  const missing: Record<string, unknown> = { ...INSTALLED };
  delete missing[field];
  responder = () => Response.json(payload([missing]));
  let rejectedMissingField = false;
  try {
    await fetchInstallPackages();
  } catch {
    rejectedMissingField = true;
  }
  if (!rejectedMissingField) {
    throw new Error(`an entry without ${field} must be rejected`);
  }

  responder = () => Response.json(payload([{ ...INSTALLED, [field]: null }]));
  let rejectedNullField = false;
  try {
    await fetchInstallPackages();
  } catch {
    rejectedNullField = true;
  }
  if (!rejectedNullField) {
    throw new Error(
      `an entry with ${field}=null must be rejected, not blanked`,
    );
  }
}

// --- 一条不是对象：显式失败 --------------------------------------------
responder = () => Response.json(payload(["pkg"]));
let rejectedNonObject = false;
try {
  await fetchInstallPackages();
} catch {
  rejectedNonObject = true;
}
if (!rejectedNonObject) {
  throw new Error("a non-object entry must be rejected");
}

// --- 空串是**合法**的（requiredString 只查类型；网关侧 version/arch 读不到时就是空串）---
// 钉住「空串通过、null / 缺键才拒」的口径，与 install-package / registered-agents 一致。
responder = () =>
  Response.json(
    payload([{ ...INSTALLED, version: "", arch: "", created_at: "" }]),
  );
const blank = await fetchInstallPackages();
if (
  blank[0].version !== "" ||
  blank[0].arch !== "" ||
  blank[0].createdAt !== ""
) {
  throw new Error(
    "empty strings must be carried through verbatim, not rejected",
  );
}

// --- 多余键被容忍（网关将来加字段不该把整页弄崩）-------------------------
responder = () =>
  Response.json(
    payload([{ ...INSTALLED, cached_path: "/var/cache/x", future_field: 1 }]),
  );
const extra = await fetchInstallPackages();
if (extra[0].packageId !== INSTALLED.package_id) {
  throw new Error("unknown extra keys must not break normalization");
}

// --- camelCase 兜底键也接受（与 registered-agents 同一套 normalizer 口径）---
responder = () =>
  Response.json(
    payload([
      {
        packageId: "pkg-camel",
        source: "/srv/camel.tar.gz",
        packageSha256: "sha256:camel",
        version: "0.1.9",
        arch: "aarch64-apple-darwin",
        agentPackageUrl:
          "https://gateway.example.com/api/v1/agent/packages/pkg-camel",
        createdBy: "ops",
        createdAt: "2026-09-20T08:30:00Z",
      },
    ]),
  );
const camel = await fetchInstallPackages();
if (
  camel[0].packageId !== "pkg-camel" ||
  camel[0].agentPackageUrl !==
    "https://gateway.example.com/api/v1/agent/packages/pkg-camel"
) {
  throw new Error("camelCase fallback keys must be accepted and normalized");
}

// --- 401 透出状态 -----------------------------------------------------------
responder = () =>
  new Response("missing bearer", {
    status: 401,
    headers: { "content-type": "text/plain" },
  });
let unauthorized: unknown;
try {
  await fetchInstallPackages();
} catch (error) {
  unauthorized = error;
}
if (!(unauthorized instanceof ApiError) || unauthorized.status !== 401) {
  throw new Error("a rejected call must surface an ApiError with status 401");
}

// --- 6. 列表项 → 升级 spec：网关派生的下载地址必须能被**原样**写成 package_url ----------
//
// 跨仓契约（逐字核过源码，不是看文档）：
//   * 网关 `AdminConfig::agent_package_url_by_id_at(base, id)`（wist-gateway/src/infra/
//     config.rs:452）返回 `<base>/api/v1/agent/packages/<package_id>`；
//   * `package_id` 是内容寻址的 `pkg-<sha256 前 16 位裸 hex>`（install_package.rs:142
//     `package_id_for_sha256`）；
//   * agentd `UpgradeSpec`（wist-agentd/src/upgrade.rs:80）的 serde 字段名是 `package_url` /
//     `package_sha256`（容器上无 rename），且 `digest_hex`（upgrade.rs:267）接受 `sha256:` 前缀。
// 所以管理面列出的 `agent_package_url` / `package_sha256` 必须**一字不改**地进 spec：
// 前端既不拼地址，也不替 agentd 剥摘要前缀。
const CONTENT_ID = "pkg-0123456789abcdef"; // 即 package_id_for_sha256 的形状：pkg- + 16 hex
const ADVERTISE_BASE = "https://gateway.example.com";
responder = () =>
  Response.json(
    payload([
      {
        package_id: CONTENT_ID,
        source: "/srv/wist/wist-agentd-0.1.9-aarch64-apple-darwin.tar.gz",
        package_sha256: `sha256:${"a".repeat(64)}`,
        version: "0.1.9",
        arch: "aarch64-apple-darwin",
        agent_package_url: `${ADVERTISE_BASE}/api/v1/agent/packages/${CONTENT_ID}`,
        created_by: "ops-eng",
        created_at: "2026-09-20T08:30:00Z",
      },
    ]),
  );
const [listed] = await fetchInstallPackages();

// 包 id 必须是内容寻址形状（不是文件名 / 版本串），否则下载地址的路径段也对不上。
if (!/^pkg-[0-9a-f]{16}$/.test(listed.packageId)) {
  throw new Error(
    `package_id must be content-addressed (pkg-<16 hex>), got ${listed.packageId}`,
  );
}
// 地址必须是「按 id 取包」那条路由的产物：不是 `.../current`，也不带查询串（凭据走 Header）。
const derivedUrl = `${ADVERTISE_BASE}/api/v1/agent/packages/${CONTENT_ID}`;
if (listed.agentPackageUrl !== derivedUrl) {
  throw new Error(
    `agent_package_url must be carried verbatim, got ${listed.agentPackageUrl}`,
  );
}
if (
  listed.agentPackageUrl.endsWith("/current") ||
  listed.agentPackageUrl.includes("?") ||
  listed.agentPackageUrl.includes("#")
) {
  throw new Error(
    "the per-id download url must point at /agent/packages/<id>, not /current, and carry no query/fragment",
  );
}

// 原样写成 spec：package_url 与列表项**逐字节**相同（前端不拼、不改写）。
const specText = jsonUpgradeSpec({
  packageUrl: listed.agentPackageUrl,
  packageSha256: listed.packageSha256,
});
const spec = JSON.parse(specText) as Record<string, unknown>;
if (spec.package_url !== listed.agentPackageUrl) {
  throw new Error(
    `spec.package_url must equal the listed url byte-for-byte, got ${spec.package_url}`,
  );
}
// agentd 的 `UpgradeSpec` 只对 target_version / allow_downgrade 加了 serde default；
// `package_url` / `package_sha256` **没有** default，这两个键必须始终在、且非空。
if (
  typeof spec.package_url !== "string" ||
  spec.package_url === "" ||
  typeof spec.package_sha256 !== "string" ||
  spec.package_sha256 === ""
) {
  throw new Error(
    "spec must always carry non-empty package_url / package_sha256",
  );
}
// 摘要的 `sha256:` 前缀原样透出（agentd 的 digest_hex 认前缀，前端不替它剥）。
if (spec.package_sha256 !== listed.packageSha256) {
  throw new Error(
    `spec.package_sha256 must be carried through verbatim, got ${spec.package_sha256}`,
  );
}
// 页面不写 target_version（版本由包内 agentd 自报）；未勾降级时不出现 allow_downgrade。
if ("target_version" in spec || "allow_downgrade" in spec) {
  throw new Error(
    "the page must not invent target_version / allow_downgrade from a listed package",
  );
}

// 回读：页面用 parseUpgradeSpec 反查计划详情，包事实要一字不差地回来。
const reread = parseUpgradeSpec(specText);
if (
  reread.error !== null ||
  reread.packageUrl !== listed.agentPackageUrl ||
  reread.packageSha256 !== listed.packageSha256 ||
  reread.allowDowngrade !== false
) {
  throw new Error(`spec round-trip lost the package facts: ${specText}`);
}

// --- 「选包」纯派生（components/agentUpgradePackages.ts）---------------------
//
// 页面的「能否提交 / 历史为空 / 列表里显示哪个包」都抽成了纯函数。这里直接测它们，
// 不渲染 React —— 契约测试跑在 tsx 里，本就没有 DOM。
function view(overrides: Partial<InstallPackageView> = {}): InstallPackageView {
  return {
    packageId: "pkg-a",
    source: "/srv/a.tar.gz",
    packageSha256: `sha256:${"a".repeat(64)}`,
    version: "0.1.9",
    arch: "aarch64-apple-darwin",
    agentPackageUrl: "https://gateway.example.com/api/v1/agent/packages/pkg-a",
    createdBy: "ops",
    createdAt: "2026-09-20T08:30:00Z",
    ...overrides,
  };
}

const pkgA = view();
const pkgB = view({
  packageId: "pkg-b",
  source: "/srv/b.tar.gz",
  version: "0.1.10",
  arch: "x86_64-unknown-linux-gnu",
  agentPackageUrl: "https://gateway.example.com/api/v1/agent/packages/pkg-b",
});

// findSelectedPackage：按 id 命中 / 未选（空串）/ 已消失都落到 null，而非 undefined。
if (findSelectedPackage([pkgA, pkgB], "pkg-b")?.packageId !== "pkg-b") {
  throw new Error(
    "findSelectedPackage must resolve the selected package by id",
  );
}
if (findSelectedPackage([pkgA, pkgB], "") !== null) {
  throw new Error("an unset selection must read as null");
}
if (findSelectedPackage([pkgA, pkgB], "pkg-gone") !== null) {
  throw new Error("a vanished selection must read as null, not undefined");
}

// packageOptionLabel：下拉项文字 = 版本 · 架构 · 来源。
if (
  packageOptionLabel(pkgB) !==
  "0.1.10 · x86_64-unknown-linux-gnu · /srv/b.tar.gz"
) {
  throw new Error(`unexpected option label: ${packageOptionLabel(pkgB)}`);
}

// 列表「安装包」列：反查到 → 版本 · 架构；反查不到 → 文件名；无地址 → —。
const byUrl = indexPackagesByUrl([pkgA, pkgB]);
if (byUrl.get(pkgA.agentPackageUrl)?.packageId !== "pkg-a") {
  throw new Error("indexPackagesByUrl must key by agentPackageUrl");
}
if (
  packageCellLabel(pkgB.agentPackageUrl, byUrl) !==
  "0.1.10 · x86_64-unknown-linux-gnu"
) {
  throw new Error(
    "a plan matching an installed package must show version · arch",
  );
}
if (
  packageCellLabel("/srv/legacy/wist-agentd-0.1.4.tar.gz", byUrl) !==
  "wist-agentd-0.1.4.tar.gz"
) {
  throw new Error("an unknown url must fall back to the file name");
}
if (packageCellLabel("/srv/legacy/", byUrl) !== "legacy") {
  throw new Error("trailing slashes must be folded away");
}
if (packageCellLabel(null, byUrl) !== "—") {
  throw new Error("a missing package url must read as —");
}

// isEmptyPackageHistory：只有「加载完 + 无错 + 空」才算空历史。
if (!isEmptyPackageHistory({ isLoading: false, isError: false, count: 0 })) {
  throw new Error("loaded & no error & empty must read as empty history");
}
if (isEmptyPackageHistory({ isLoading: true, isError: false, count: 0 })) {
  throw new Error("still-loading is not empty history");
}
if (isEmptyPackageHistory({ isLoading: false, isError: true, count: 0 })) {
  throw new Error("an error is not empty history");
}
if (isEmptyPackageHistory({ isLoading: false, isError: false, count: 1 })) {
  throw new Error("a non-empty history is not empty");
}

// canSubmitUpgrade：没选包 / 阶段分不出来 / 正在提交 —— 任一为真都禁用。
if (
  !canSubmitUpgrade({
    isPending: false,
    phaseError: null,
    selectedPackage: pkgA,
  })
) {
  throw new Error(
    "selected package + no phase error + idle must be submittable",
  );
}
if (
  canSubmitUpgrade({
    isPending: false,
    phaseError: null,
    selectedPackage: null,
  })
) {
  throw new Error("no selected package must block submit");
}
if (
  canSubmitUpgrade({
    isPending: false,
    phaseError: "机队为空",
    selectedPackage: pkgA,
  })
) {
  throw new Error("a phase error must block submit");
}
if (
  canSubmitUpgrade({ isPending: true, phaseError: null, selectedPackage: pkgA })
) {
  throw new Error("pending must block submit");
}

console.log("install packages contract test passed");
