import {
  ApiError,
  type InstallPackageView,
  fetchInstallPackages,
  jsonUpgradeSpec,
  parseUpgradeSpec,
  setAdminApiToken,
} from "../src/api/admin";
import {
  PACKAGE_HISTORY_DISPLAY_LIMIT,
  canSubmitUpgrade,
  distinctVersionOptions,
  findCurrentPackage,
  findVersionOption,
  indexPackagesByUrl,
  isEmptyPackageHistory,
  packageLabel,
  packageShaLabel,
  planVersionCellLabel,
  recentPackages,
  versionOptionLabel,
} from "../src/components/agentUpgradePackages";

// 契约测试：网关**已录入**的安装包历史（`GET /api/v1/admin/agent/install-packages`）。
//
// 为什么单测这一块：升级页原让操作者手输包地址 + 摘要，现在改成从这里选一个已录入的包。
// 这里锁住新口径的取数与解析：
//   1. GET 路径与方法、凭据（token 进 Authorization Header，不进查询串）；
//   2. `packages[]` 的 snake_case → camelCase 映射，尤其 `agent_package_url`（网关派生好的
//      下载地址）必须原样透出 —— 前端**不自己拼** URL；
//   3. **形状漂移必须显式失败**（缺 `packages` 数组 / 某项缺 `package_id` 或 `agent_package_url`），
//      不静默成「一个包都没录入」或空地址 —— 那比报错更难查；
//   4. 「安装包」页的显示口径：当前生效的那一份按**摘要**对齐、历史列表最多列 5 条。

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

// --- 「选版本」纯派生（components/agentUpgradePackages.ts）-------------------
//
// 升级页按**版本**选：操作者在版本下拉里选一个，制品由网关按目标平台解析。页面的
// 「能否提交 / 历史为空 / 列表里显示哪个版本」都抽成了纯函数。这里直接测它们，不渲染 React。
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

// distinctVersionOptions：把历史折叠成按版本的选项（去重、保持首次出现顺序）。
const versionOptions = distinctVersionOptions([pkgA, pkgB]);
if (versionOptions.length !== 2) {
  throw new Error(`expected one option per version, got ${versionOptions.length}`);
}
if (
  versionOptions[0].version !== "0.1.9" ||
  versionOptions[0].platforms.join(",") !== "aarch64-apple-darwin"
) {
  throw new Error(`unexpected first version option: ${JSON.stringify(versionOptions[0])}`);
}
// 同一个版本的多平台包折成**一个**选项（平台合并去重）。
const multi = distinctVersionOptions([
  view({ packageId: "pkg-x", version: "0.2.0", arch: "aarch64-apple-darwin" }),
  view({ packageId: "pkg-y", version: "0.2.0", arch: "x86_64-unknown-linux-musl" }),
  view({ packageId: "pkg-z", version: "0.2.0", arch: "x86_64-unknown-linux-musl" }),
]);
if (
  multi.length !== 1 ||
  multi[0].platforms.join(",") !== "aarch64-apple-darwin,x86_64-unknown-linux-musl"
) {
  throw new Error(`same version must fold into one option: ${JSON.stringify(multi)}`);
}
// 版本读不出的包不进选项（按版本选时选到它必败）。
if (distinctVersionOptions([view({ version: "" })]).length !== 0) {
  throw new Error("packages without a version must not become options");
}

// findVersionOption：命中 / 未选（空串）/ 刷新后消失都落到 null，而非 undefined。
if (findVersionOption(versionOptions, "0.1.10")?.version !== "0.1.10") {
  throw new Error("findVersionOption must resolve the selected version");
}
if (findVersionOption(versionOptions, "") !== null) {
  throw new Error("an unset selection must read as null");
}
if (findVersionOption(versionOptions, "9.9.9") !== null) {
  throw new Error("a vanished selection must read as null, not undefined");
}

// versionOptionLabel：下拉项文字 = 版本 · 平台1, 平台2；无平台时只说版本。
if (versionOptionLabel(versionOptions[1]) !== "0.1.10 · x86_64-unknown-linux-gnu") {
  throw new Error(`unexpected option label: ${versionOptionLabel(versionOptions[1])}`);
}
if (versionOptionLabel({ version: "0.3.0", platforms: [] }) !== "0.3.0") {
  throw new Error("an option without platforms must show only the version");
}

// 列表「目标版本」列：按版本 → 给版本；旧计划（显式制品）→ 反查到的「版本 · 架构」/ 文件名 / —。
const byUrl = indexPackagesByUrl([pkgA, pkgB]);
if (byUrl.get(pkgA.agentPackageUrl)?.packageId !== "pkg-a") {
  throw new Error("indexPackagesByUrl must key by agentPackageUrl");
}
if (
  planVersionCellLabel({ targetVersion: "0.1.10", packageUrl: null }, byUrl) !==
  "0.1.10"
) {
  throw new Error("a version-based plan must show its target version");
}
if (
  planVersionCellLabel(
    { targetVersion: null, packageUrl: pkgB.agentPackageUrl },
    byUrl,
  ) !== "0.1.10 · x86_64-unknown-linux-gnu"
) {
  throw new Error("a legacy plan must fall back to version · arch");
}
if (
  planVersionCellLabel(
    { targetVersion: null, packageUrl: "/srv/legacy/wist-agentd-0.1.4.tar.gz" },
    byUrl,
  ) !== "wist-agentd-0.1.4.tar.gz"
) {
  throw new Error("an unknown url must fall back to the file name");
}
if (
  planVersionCellLabel({ targetVersion: null, packageUrl: "/srv/legacy/" }, byUrl) !==
  "legacy"
) {
  throw new Error("trailing slashes must be folded away");
}
if (
  planVersionCellLabel({ targetVersion: null, packageUrl: null }, byUrl) !== "—"
) {
  throw new Error("a plan with neither version nor url must read as —");
}

// packageLabel：版本 · 架构；读不出的部分不留悬空分隔符。
if (packageLabel(pkgB) !== "0.1.10 · x86_64-unknown-linux-gnu") {
  throw new Error(`unexpected package label: ${packageLabel(pkgB)}`);
}
// 包身份读不出来时网关给的是空串（见上面「空串是合法的」那一段），两个都空必须说未识别，
// 而不是渲染成一个孤零零的「 · 」。
if (packageLabel(view({ version: "", arch: "" })) !== "未识别") {
  throw new Error("an unreadable package identity must read as 未识别");
}
// 只读出一半时只报这一半（`parse_agent_package_dir_name` 实际是全有全无，但契约允许半空）。
if (packageLabel(view({ arch: "" })) !== "0.1.9") {
  throw new Error("a half-known identity must not render a dangling separator");
}
if (packageLabel(view({ version: "", arch: "x86_64-unknown-linux-gnu" })) !== "x86_64-unknown-linux-gnu") {
  throw new Error("a half-known identity must report the half it knows");
}

// --- 摘要在「当前安装包」两行里的紧凑形式 ---------------------------------------
//
// 那一卡只给两行，摘要并排在来源之后，64 位十六进制铺开会把来源挤掉。前 12 位足够区分两个包，
// 完整值仍在复制按钮与 title 上。这里钉住「截多少、什么形状不截」。
const fullSha = `sha256:${"a".repeat(64)}`;
if (packageShaLabel(fullSha) !== "aaaaaaaaaaaa…") {
  throw new Error(`unexpected short digest: ${packageShaLabel(fullSha)}`);
}
// 网关的 `set_agent_install_package` 两种形状都收（带 / 不带 `sha256:` 前缀），显示要一致。
if (packageShaLabel("b".repeat(64)) !== "bbbbbbbbbbbb…") {
  throw new Error("a bare hex digest must shorten the same way");
}
// 摘要比较是十六进制，大小写等价，短形式上不该突然区分大小写。
if (packageShaLabel(`sha256:${"C".repeat(64)}`) !== "CCCCCCCCCCCC…") {
  throw new Error("an uppercase digest must shorten the same way");
}
// 形状**不认识的原样返回**：把一段说不上是摘要的字符串截掉只会造成误读（截出来的前缀
// 反而像真的）。16 位以下、非十六进制都走这条路。
if (packageShaLabel("sha256:abc") !== "sha256:abc") {
  throw new Error("a too-short digest must be printed as-is");
}
if (packageShaLabel("not-a-digest-at-all") !== "not-a-digest-at-all") {
  throw new Error("a non-hex value must be printed as-is");
}
// 未设置（null：网关对从未添加过返回 null）读 `—`，与其余只读值一致。
if (packageShaLabel(null) !== "—" || packageShaLabel("") !== "—") {
  throw new Error("a missing digest must read as —");
}

// --- 「当前安装包」：按摘要对齐到包目录里的那一条 --------------------------------
//
// 录入时来源地址与制品摘要由**同一个**请求写进设置与包目录（网关 set_agent_install_package），
// 所以摘要是两侧唯一的公共键；版本 / 架构只有包目录那一侧有。对不上不能编。
const shaA = `sha256:${"a".repeat(64)}`;
if (findCurrentPackage([pkgA, pkgB], shaA)?.packageId !== "pkg-a") {
  throw new Error("the current package must be matched by its digest");
}
// 设置侧还没有摘要（旧库行 / 未设置）：没有键可对，返回 null 而不是撞上第一条。
if (findCurrentPackage([pkgA, pkgB], null) !== null) {
  throw new Error("a missing digest must not match any recorded package");
}
if (findCurrentPackage([pkgA, pkgB], "") !== null) {
  throw new Error("an empty digest must not match any recorded package");
}
// 摘要对不上（设置早于包目录表，或摘要在库外被改过）：如实返回 null。
if (findCurrentPackage([pkgA, pkgB], `sha256:${"f".repeat(64)}`) !== null) {
  throw new Error("an unmatched digest must read as no current package");
}
if (findCurrentPackage([], shaA) !== null) {
  throw new Error("an empty history must read as no current package");
}
// 同一份内容从两个来源各录一次仍是同一行（内容寻址），所以不会同时匹配到两条。
if (findCurrentPackage([pkgA], pkgA.packageSha256)?.packageId !== "pkg-a") {
  throw new Error("an exact digest match must resolve the entry");
}

// --- 历史列表的显示上限 ------------------------------------------------------
//
// 显示上限是 5（产品口径）；网关侧不截断 —— 升级页要能选到任意一个录过的包。
if (PACKAGE_HISTORY_DISPLAY_LIMIT !== 5) {
  throw new Error(
    `the history display limit is pinned at 5, got ${PACKAGE_HISTORY_DISPLAY_LIMIT}`,
  );
}
const many = Array.from({ length: 7 }, (_, index) =>
  view({ packageId: `pkg-${index}`, createdAt: `2026-09-2${index}T08:30:00Z` }),
);
const capped = recentPackages(many, PACKAGE_HISTORY_DISPLAY_LIMIT);
if (capped.length !== PACKAGE_HISTORY_DISPLAY_LIMIT) {
  throw new Error(`expected the list to be capped at 5, got ${capped.length}`);
}
// 只截断、不重排：后端已按录入时间倒序，页面不许自作主张改顺序。
if (capped.map((pkg) => pkg.packageId).join(",") !== "pkg-0,pkg-1,pkg-2,pkg-3,pkg-4") {
  throw new Error(`the newest entries must be kept in order: ${capped.map((p) => p.packageId)}`);
}
if (recentPackages(many.slice(0, 3), PACKAGE_HISTORY_DISPLAY_LIMIT).length !== 3) {
  throw new Error("a short history must be returned as-is");
}
if (recentPackages(many, 0).length !== 0) {
  throw new Error("a zero limit must list nothing");
}
if (recentPackages(many, -1).length !== 0) {
  throw new Error("a negative limit must list nothing, not everything");
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

// canSubmitUpgrade：没选版本 / 阶段分不出来 / 正在提交 —— 任一为真都禁用。
if (
  !canSubmitUpgrade({
    isPending: false,
    phaseError: null,
    selectedVersion: "0.1.9",
  })
) {
  throw new Error(
    "selected version + no phase error + idle must be submittable",
  );
}
if (
  canSubmitUpgrade({ isPending: false, phaseError: null, selectedVersion: "" })
) {
  throw new Error("no selected version must block submit");
}
if (
  canSubmitUpgrade({
    isPending: false,
    phaseError: "机队为空",
    selectedVersion: "0.1.9",
  })
) {
  throw new Error("a phase error must block submit");
}
if (
  canSubmitUpgrade({ isPending: true, phaseError: null, selectedVersion: "0.1.9" })
) {
  throw new Error("pending must block submit");
}

console.log("install packages contract test passed");
