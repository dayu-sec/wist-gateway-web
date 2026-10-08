import { resolveGitHubRelease, setAdminApiToken } from "../src/api/admin";

// 契约测试：管理面「解析 GitHub Release」（安装包页一键填充用）。
//
// 锁住：
//   1. POST /api/v1/admin/github-release/resolve；
//   2. 请求体字段名（release_url）；
//   3. 响应归一化：snake_case（artifact_url）→ camelCase（artifactUrl），
//      sha256 / platform 允许为 null（不是 undefined）。

interface Recorded {
  url: string;
  method: string;
  authorization: string;
  body: string;
}

let recorded: Recorded[] = [];
let responder: () => Response = () =>
  Response.json({
    version: "v0.2.1-alpha",
    assets: [
      {
        name: "wist-agentd-v0.2.1-alpha-aarch64-apple-darwin.tar.gz",
        artifact_url:
          "https://github.com/dayu-sec/wist-agentd/releases/download/v0.2.1-alpha/wist-agentd-v0.2.1-alpha-aarch64-apple-darwin.tar.gz",
        sha256: "2f9c1a0000000000000000000000000000000000000000000000000000000000",
        platform: "aarch64-apple-darwin",
      },
      {
        name: "wist-agentd-v0.2.1-alpha.sha256",
        artifact_url:
          "https://github.com/dayu-sec/wist-agentd/releases/download/v0.2.1-alpha/wist-agentd-v0.2.1-alpha.sha256",
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
const resolved = await resolveGitHubRelease(
  "https://github.com/dayu-sec/wist-agentd/releases/tag/v0.2.1-alpha",
);
if (recorded.length !== 1) {
  throw new Error(
    `github-release resolve must issue exactly one request, got ${recorded.length}`,
  );
}
const call = recorded[0];
if (call.url !== "/api/v1/admin/github-release/resolve") {
  throw new Error(`unexpected resolve path: ${call.url}`);
}
if (call.method !== "POST") {
  throw new Error(`github-release resolve must be POST, got ${call.method}`);
}
if (call.authorization !== "Bearer admin-token-under-test") {
  throw new Error("admin credential must be sent in the Authorization Header");
}
const sentBody = JSON.parse(call.body) as Record<string, unknown>;
if (sentBody.release_url !== "https://github.com/dayu-sec/wist-agentd/releases/tag/v0.2.1-alpha") {
  throw new Error(`resolve body must carry release_url: ${call.body}`);
}
if (resolved.version !== "v0.2.1-alpha" || resolved.assets.length !== 2) {
  throw new Error("resolve response was not normalized");
}
const [darwin, shaManifest] = resolved.assets;
if (
  darwin.platform !== "aarch64-apple-darwin" ||
  darwin.artifactUrl !==
    "https://github.com/dayu-sec/wist-agentd/releases/download/v0.2.1-alpha/wist-agentd-v0.2.1-alpha-aarch64-apple-darwin.tar.gz" ||
  typeof darwin.sha256 !== "string"
) {
  throw new Error("asset platform/artifactUrl/sha256 was not normalized");
}
// 非制品（.sha256 清单）：platform / sha256 必须是 null，不是 undefined。
if (shaManifest.platform !== null || shaManifest.sha256 !== null) {
  throw new Error("missing platform/sha256 must map to null, not undefined");
}

console.log("github release resolve contract test passed");
