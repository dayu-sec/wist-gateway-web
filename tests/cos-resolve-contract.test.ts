import { resolveCosPath, setAdminApiToken } from "../src/api/admin";

// 契约测试：管理面「解析腾讯 COS 路径」（安装包页一键填充用）。
//
// 锁住：
//   1. POST /api/v1/admin/cos/resolve；
//   2. 请求体字段名（cos_path）；
//   3. 响应归一化：snake_case（artifact_url）→ camelCase（artifactUrl），
//      sha256 / platform 允许为 null（不是 undefined）——与 GitHub 解析同一份口径。

interface Recorded {
  url: string;
  method: string;
  authorization: string;
  body: string;
}

let recorded: Recorded[] = [];
const responder = () =>
  Response.json({
    version: "v0.4.0-alpha",
    assets: [
      {
        name: "wist-agentd-v0.4.0-alpha-aarch64-apple-darwin.tar.gz",
        artifact_url:
          "https://wist-1347593047.cos.ap-guangzhou.myqcloud.com/wist-agentd/v0.4.0-alpha/wist-agentd-v0.4.0-alpha-aarch64-apple-darwin.tar.gz",
        sha256: "3d9478082139e0081fcea1c23a794f60491e6561c8efb03d88e015aaba19f765",
        platform: "aarch64-apple-darwin",
      },
      {
        // 单制品形态（无三元组）：platform 必须是 null，不是 undefined。
        name: "wist-agentd-v0.4.0-alpha.tar.gz",
        artifact_url:
          "https://wist-1347593047.cos.ap-guangzhou.myqcloud.com/wist-agentd/v0.4.0-alpha/wist-agentd-v0.4.0-alpha.tar.gz",
        sha256: null,
        platform: null,
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

recorded = [];
const resolved = await resolveCosPath("wist-1347593047/wist-agentd/v0.4.0-alpha");
if (recorded.length !== 1) {
  throw new Error(`cos resolve must issue exactly one request, got ${recorded.length}`);
}
const call = recorded[0];
if (call.url !== "/api/v1/admin/cos/resolve") {
  throw new Error(`unexpected resolve path: ${call.url}`);
}
if (call.method !== "POST") {
  throw new Error(`cos resolve must be POST, got ${call.method}`);
}
if (call.authorization !== "Bearer admin-token-under-test") {
  throw new Error("admin credential must be sent in the Authorization Header");
}
const sentBody = JSON.parse(call.body) as Record<string, unknown>;
if (sentBody.cos_path !== "wist-1347593047/wist-agentd/v0.4.0-alpha") {
  throw new Error(`resolve body must carry cos_path: ${call.body}`);
}
if (resolved.version !== "v0.4.0-alpha" || resolved.assets.length !== 2) {
  throw new Error("resolve response was not normalized");
}
const [darwin, bare] = resolved.assets;
if (
  darwin.platform !== "aarch64-apple-darwin" ||
  !darwin.artifactUrl.endsWith(
    "wist-agentd-v0.4.0-alpha-aarch64-apple-darwin.tar.gz",
  ) ||
  typeof darwin.sha256 !== "string"
) {
  throw new Error("asset platform/artifactUrl/sha256 was not normalized");
}
if (bare.platform !== null || bare.sha256 !== null) {
  throw new Error("missing platform/sha256 must map to null, not undefined");
}

console.log("cos resolve contract test passed");
