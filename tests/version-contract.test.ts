import { fetchBackendVersion, normalizeBackendVersion } from "../src/api/admin";

// 契约测试：网关（后端）版本端点 `GET /api/v1/version`。
//
// 这条端点是**公开**的 —— 页面左下角在未登录时也要显示后端版本，所以它绝不能依赖 admin token。
// 契约定死两条：
//   1. 路径 / 方法正确，且**未设 token 时不发 Authorization**（公开端点，凭据可有可无）；
//   2. 载荷是扁平的 `{ version }`；缺 `version`（或非对象）即契约漂移，必须显式抛错 ——
//      版本块据此显示 `—`，**绝不回落示例值**（一个假的版本号比没有更误导排障）。
//
// Usage: npm run test:version

interface Recorded {
  url: string;
  method: string;
  authorization: string;
}

let recorded: Recorded[] = [];
let responder: () => Response = () => Response.json({ version: "0.8.0" });

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
if (version !== "0.8.0") {
  throw new Error(`version was not read from the flat { version } payload: ${version}`);
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

console.log("gateway version contract test passed");
