import { readFileSync } from "node:fs";
import { fetchBackendVersion, normalizeBackendVersion } from "../src/api/admin";

// 契约测试：网关（后端）与部署栈的版本端点 `GET /api/v1/version`。
//
// 这条端点是**公开**的 —— 页面左下角在未登录时也要显示后端/全栈版本，所以它绝不能依赖 admin token。
// 契约定死：
//   1. 路径 / 方法正确，且**未设 token 时不发 Authorization**（公开端点，凭据可有可无）；
//   2. 载荷是扁平的 `{ version, stack_version? }`；缺 `version`（或非对象）即契约漂移，必须显式抛错
//      —— 版本块据此显示 `—`，**绝不回落示例值**（一个假的版本号比没有更误导排障）；
//   3. `stack_version` 可省（旧网关），一旦存在就必须是非空字符串；前端把它映射成 `stackVersion`。
//
// Usage: npm run test:version

interface Recorded {
  url: string;
  method: string;
  authorization: string;
}

let recorded: Recorded[] = [];
let responder: () => Response = () =>
  Response.json({ version: "0.8.0", stack_version: "0.1.49" });

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  recorded.push({
    url: input.toString(),
    method: (init?.method ?? "GET").toUpperCase(),
    authorization: headers.get("authorization") ?? "",
  });
  return responder();
};

// 未设 token（进程初始态）：公开端点也应能取。
recorded = [];
const version = await fetchBackendVersion();
const [call] = recorded;
if (recorded.length !== 1) {
  throw new Error(`version view must issue exactly one request, got ${recorded.length}`);
}
if (call.url !== "/api/v1/version") {
  throw new Error(`unexpected version path: ${call.url}`);
}
if (call.method !== "GET") {
  throw new Error(`version view must be GET, got ${call.method}`);
}
if (call.authorization !== "") {
  throw new Error(
    "version endpoint is public — no credential must be sent (nor required) when no token is set",
  );
}
if (version.version !== "0.8.0") {
  throw new Error(`backend version was not read from { version }: ${version.version}`);
}
if (version.stackVersion !== "0.1.49") {
  throw new Error(
    `stack version was not read from { stack_version }: ${version.stackVersion}`,
  );
}

// 旧网关：不返回 `stack_version` 时必须是 undefined（版本块显示 `—`），而不是空串或假值。
const legacy = normalizeBackendVersion({ version: "0.8.0" });
if (legacy.stackVersion !== undefined) {
  throw new Error(`missing stack_version must be undefined, got: ${legacy.stackVersion}`);
}

// 契约漂移：缺 `version` 必须显式失败，不能静默成空串。
let rejectedMissing = false;
try {
  normalizeBackendVersion({});
} catch {
  rejectedMissing = true;
}
if (!rejectedMissing) {
  throw new Error("missing version must be rejected instead of silently blanked");
}

// 非对象载荷同样拒绝（版本块会把它当未知显示 `—`）。
let rejectedNonObject = false;
try {
  normalizeBackendVersion("0.8.0");
} catch {
  rejectedNonObject = true;
}
if (!rejectedNonObject) {
  throw new Error("non-object version payload must be rejected");
}

// `stack_version` 存在但不是字符串 = 契约漂移，必须失败（不能把数字/对象直接展示）。
let rejectedBadStackVersion = false;
try {
  normalizeBackendVersion({ version: "0.8.0", stack_version: 49 });
} catch {
  rejectedBadStackVersion = true;
}
if (!rejectedBadStackVersion) {
  throw new Error("a non-string stack_version must be rejected");
}

// 空串同样是漂移：契约是「要么不返回，要么非空」。
let rejectedBlankStackVersion = false;
try {
  normalizeBackendVersion({ version: "0.8.0", stack_version: "  " });
} catch {
  rejectedBlankStackVersion = true;
}
if (!rejectedBlankStackVersion) {
  throw new Error("a blank stack_version must be rejected");
}

// 仓内版本一致性：`version.txt` 是 gx 的版本源，`package.json` 由 `gx adm v_feat` 同步。
// 两者不一致 = 有人只改了其中一个。发版之后最难发现（tag 已指向旧版本的文件），所以在 CI 里钉住；
// 顺带提醒：只改 version.txt 时镜像里的版本号（`APP_VERSION=<tag>`）与本地构建会不一致。
const repoRoot = new URL("..", import.meta.url).pathname;
const versionFile = readFileSync(`${repoRoot}/version.txt`, "utf8").trim();
const pkg = JSON.parse(readFileSync(`${repoRoot}/package.json`, "utf8")) as {
  version?: unknown;
};
if (versionFile !== pkg.version) {
  throw new Error(
    `version.txt(${versionFile}) 与 package.json(${String(pkg.version)}) 不一致：用 gx adm v_feat 升版，别手工改`, 
  );
}

console.log("gateway version contract test passed");
