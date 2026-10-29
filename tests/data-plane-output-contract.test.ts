import {
  fetchDataPlaneOutputs,
  fetchDataPlaneOutputTail,
  setAdminApiToken,
} from "../src/api/admin";

// 契约测试：管理面「采集日志」的输出文件 tail
// （`GET /api/v1/admin/data-plane/output/files` + `…/output/tail`）。
//
// 这一页最容易漂移的四件事：
//   1. 请求形状：`path` 必带且 URI 编码；`offset` / `max_bytes` 省略时**不**拼空参数；
//   2. `content` 是**原文**，多行 / 中文必须逐字保留（不能裁剪、不能改写换行）；
//   3. 偏移是契约：`next_offset` 必须原样透出，页面下一次轮询靠它只取新增字节；
//   4. `reset` 与 `available` 不能被静默成 false —— 前者决定「文件轮转后清屏重读」，
//      后者区分「还没写出文件」与「网关没挂载输出目录」。
//
// Usage: npm run test:data-plane-output

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

interface Recorded {
  url: string;
  method: string;
  authorization: string;
}

let recorded: Recorded[] = [];
let responder: (url: string) => Response = () =>
  Response.json({
    dir: "/data-plane/data/out_dat",
    available: true,
    files: [],
    truncated: false,
  });

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  const url = input.toString();
  recorded.push({
    url,
    method: (init?.method ?? "GET").toUpperCase(),
    authorization: headers.get("authorization") ?? "",
  });
  return responder(url);
};

setAdminApiToken("admin-token-under-test");

// --- 1. 请求形状 ------------------------------------------------------------
recorded = [];
responder = () =>
  Response.json({
    dir: "/data-plane/data/out_dat",
    available: true,
    files: [
      {
        path: "gateway.json",
        size: 1234,
        modified: "2026-10-28T10:00:00Z",
      },
      { path: "nested/agent.log", size: 8, modified: null },
    ],
    truncated: false,
  });
const listing = await fetchDataPlaneOutputs();
assert(recorded.length === 1, `listing must issue one request, got ${recorded.length}`);
assert(
  recorded[0].url === "/api/v1/admin/data-plane/output/files",
  `unexpected listing path: ${recorded[0].url}`,
);
assert(recorded[0].method === "GET", "listing must be GET");
assert(
  recorded[0].authorization === "Bearer admin-token-under-test",
  "admin credential must be sent in the Authorization Header",
);
assert(listing.available === true, "available must be normalized");
assert(listing.dir === "/data-plane/data/out_dat", "dir must be normalized");
assert(listing.files.length === 2, "file list must be normalized");
assert(
  listing.files[0].path === "gateway.json" && listing.files[0].size === 1234,
  "file entry must be normalized",
);
assert(
  listing.files[1].modified === null,
  "null modified must stay null (not become an empty string)",
);

// path 必须编码：带 / 或空格的文件名不能改道到别的路由。
recorded = [];
responder = () =>
  Response.json({
    path: "a b/c.json",
    dir: "/data-plane/data/out_dat",
    offset: 0,
    next_offset: 5,
    size: 5,
    modified: null,
    content: "hello",
    pending_after: 0,
    reset: false,
  });
await fetchDataPlaneOutputTail("a b/c.json");
assert(
  recorded[0].url ===
    "/api/v1/admin/data-plane/output/tail?path=a+b%2Fc.json",
  `path must be URI-encoded, got ${recorded[0].url}`,
);

// offset / max_bytes 可选：省略不带；给了就显式透传（服务端夹取口径只留一处）。
recorded = [];
await fetchDataPlaneOutputTail("gateway.json", 42, 262144);
assert(
  recorded[0].url ===
    "/api/v1/admin/data-plane/output/tail?path=gateway.json&offset=42&max_bytes=262144",
  `offset + max_bytes must be passed through, got ${recorded[0].url}`,
);

// --- 2. 原文逐字保留 --------------------------------------------------------
recorded = [];
const raw = '{"msg":"第一行"}\n{"msg":"second","nested":{"k":"v"}}\n';
responder = () =>
  Response.json({
    path: "gateway.json",
    dir: "/data-plane/data/out_dat",
    offset: 100,
    next_offset: 100 + new TextEncoder().encode(raw).length,
    size: 100 + new TextEncoder().encode(raw).length,
    modified: "2026-10-28T10:00:01Z",
    content: raw,
    pending_after: 0,
    reset: false,
  });
const chunk = await fetchDataPlaneOutputTail("gateway.json", 100);
assert(chunk.content === raw, "content must be preserved verbatim (newlines included)");
assert(chunk.offset === 100, "offset must be normalized");
assert(
  chunk.nextOffset === 100 + new TextEncoder().encode(raw).length,
  "next_offset must be normalized",
);
assert(chunk.reset === false, "reset must be normalized");
assert(chunk.modified === "2026-10-28T10:00:01Z", "modified must be normalized");

// --- 3. 轮转 / 目录不存在是两种不同的状态 -----------------------------------
recorded = [];
responder = () =>
  Response.json({
    path: "gateway.json",
    dir: "/data-plane/data/out_dat",
    offset: 0,
    next_offset: 4,
    size: 4,
    modified: null,
    content: "abc\n",
    pending_after: 0,
    reset: true,
  });
const rotated = await fetchDataPlaneOutputTail("gateway.json", 999999);
assert(rotated.reset === true, "reset must not be silently dropped");
assert(rotated.nextOffset === 4, "next_offset must be normalized after reset");

recorded = [];
responder = () =>
  Response.json({
    dir: "/data-plane/data/out_dat",
    available: false,
    files: [],
    truncated: false,
  });
const missing = await fetchDataPlaneOutputs();
assert(
  missing.available === false && missing.files.length === 0,
  "unavailable output dir must keep available=false with an empty list",
);

// --- 4. 缺字段是契约漂移（不能静默成 0 / 空串） -------------------------------
responder = () =>
  Response.json({
    dir: "/data-plane/data/out_dat",
    available: true,
    files: [],
    // truncated 缺失
  });
let failed = false;
try {
  await fetchDataPlaneOutputs();
} catch (error) {
  failed = String(error).includes("truncated");
}
assert(failed, "missing truncated must be rejected, not defaulted to false");

console.log("data-plane output contract: OK (请求形状 / 原文 / 偏移 / 轮转 / 缺字段)");
