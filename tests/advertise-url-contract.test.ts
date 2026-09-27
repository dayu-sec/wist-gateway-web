import {
  ApiError,
  fetchAgentAdvertiseUrl,
  normalizeAgentAdvertiseUrl,
  setAdminApiToken,
  setAgentAdvertiseUrl,
} from "../src/api/admin";

// 契约测试：管理面「网关对外地址」读写。
//
// 这个设置不是普通的一行配置 —— 它决定了**新签发 Agent 连到哪**：渲染成初始配置里的
// `[control_plane] endpoint`，同时派生出安装命令 / install.sh / 安装包的分发基址。
// 地址写错，后面所有配置都救不回来（agent 根本看不到控制面）。所以这里把契约钉死：
//   1. GET/POST 都是 /api/v1/admin/agent/advertise-url，凭证走 Authorization Header；
//   2. 后端返回**扁平** snake_case 载荷（不是 `{advertise_url: {...}}` 包装）；
//   3. 未设置过时 `url` 为空串、`updated_at` 为 null，而 `fallback_url` **必须照旧给出**
//      —— 页面靠它显示「不设置会连到哪」，两侧都空的话界面就只剩一片空白；
//   4. POST body 字段名是 `url` / `requested_by`（可选字段省略时不发空键）；
//   5. 400 的纯文本正文要落到 ApiError.detail，页面才能把后端拒绝原因透出来；
//   6. `url` / `fallback_url` 缺失时抛错，不把契约漂移静默成一个空地址。

interface Recorded {
  url: string;
  method: string;
  authorization: string;
  body: string;
}

let recorded: Recorded[] = [];
let responder: () => Response = () =>
  Response.json({
    setting_id: "default",
    url: "https://gateway.example.com",
    fallback_url: "https://gw.internal.example.com",
    updated_by: "platform-maintenance-engineer",
    updated_at: "2026-09-26T08:30:00+00:00",
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
const loaded = await fetchAgentAdvertiseUrl();
const [readCall] = recorded;
if (recorded.length !== 1) {
  throw new Error(
    `advertise url view must issue exactly one request, got ${recorded.length}`,
  );
}
if (readCall.url !== "/api/v1/admin/agent/advertise-url") {
  throw new Error(`unexpected view path: ${readCall.url}`);
}
if (readCall.method !== "GET") {
  throw new Error(`advertise url view must be GET, got ${readCall.method}`);
}
if (readCall.authorization !== "Bearer admin-token-under-test") {
  throw new Error("admin credential must be sent in the Authorization Header");
}
if (readCall.body !== "") {
  throw new Error("advertise url view must not send a body");
}
if (
  loaded.settingId !== "default" ||
  loaded.url !== "https://gateway.example.com" ||
  loaded.fallbackUrl !== "https://gw.internal.example.com" ||
  loaded.updatedBy !== "platform-maintenance-engineer" ||
  loaded.updatedAt !== "2026-09-26T08:30:00+00:00"
) {
  throw new Error("flat snake_case advertise url response was not normalized");
}

// --- 未设置过：url 空串 / updated_at 为 null / fallback_url 仍在 ------------
const unset = normalizeAgentAdvertiseUrl({
  setting_id: "default",
  url: "",
  fallback_url: "https://gw.internal.example.com",
  updated_by: "",
  updated_at: null,
});
if (unset.url !== "") {
  throw new Error("unset advertise url must stay an empty string");
}
if (unset.updatedAt !== null) {
  throw new Error("null updated_at must map to null, not undefined");
}
// 关键：未设置 ≠ 没有地址。回落值必须在，否则界面答不出「不设置会连到哪」。
if (unset.fallbackUrl !== "https://gw.internal.example.com") {
  throw new Error(
    "unset advertise url must keep the config fallback so the page can show it",
  );
}
if (!("updatedAt" in unset) || !("fallbackUrl" in unset) || !("url" in unset)) {
  throw new Error(
    "nullable advertise url fields must not be dropped by the normalizer",
  );
}

// --- 写入：POST / body 字段名 / 返回体复用同一映射 -------------------------
recorded = [];
responder = () =>
  Response.json({
    setting_id: "default",
    url: "https://edge.example.net",
    fallback_url: "https://gw.internal.example.com",
    updated_by: "ops-eng",
    updated_at: "2026-09-26T09:00:00+00:00",
  });
const saved = await setAgentAdvertiseUrl({
  url: "https://edge.example.net",
  requestedBy: "ops-eng",
});
const [writeCall] = recorded;
if (recorded.length !== 1) {
  throw new Error(
    `advertise url set must issue exactly one request, got ${recorded.length}`,
  );
}
if (writeCall.url !== "/api/v1/admin/agent/advertise-url") {
  throw new Error(`unexpected set path: ${writeCall.url}`);
}
if (writeCall.method !== "POST") {
  throw new Error(`advertise url set must be POST, got ${writeCall.method}`);
}
if (writeCall.authorization !== "Bearer admin-token-under-test") {
  throw new Error(
    "advertise url set must keep the credential in the Authorization Header",
  );
}
const sentBody = JSON.parse(writeCall.body) as Record<string, unknown>;
if (sentBody.url !== "https://edge.example.net" || sentBody.requested_by !== "ops-eng") {
  throw new Error(
    `advertise url set body does not match the backend request contract: ${writeCall.body}`,
  );
}
if ("requestedBy" in sentBody) {
  throw new Error(
    `advertise url set body must use snake_case field names: ${writeCall.body}`,
  );
}
// 前端不让地址进入查询串（地址是数据，不是路由的一部分）。
if (writeCall.url.includes("url=") || writeCall.url.includes("token")) {
  throw new Error("advertise url set must not put fields or credentials in the URL");
}
if (
  saved.url !== "https://edge.example.net" ||
  saved.updatedBy !== "ops-eng" ||
  saved.fallbackUrl !== "https://gw.internal.example.com"
) {
  throw new Error("advertise url set must return the stored setting with fallback");
}

// --- 可选字段省略时不发送空键（后端按 Option 反序列化） ---------------------
recorded = [];
await setAgentAdvertiseUrl({ url: "https://edge.example.net" });
const optionalBody = JSON.parse(recorded[0].body) as Record<string, unknown>;
if ("requested_by" in optionalBody) {
  throw new Error("omitted optional fields must not be sent as empty keys");
}
if (optionalBody.url !== "https://edge.example.net") {
  throw new Error("url must always be present in the set body");
}

// --- 400 纯文本错误要透出正文 ----------------------------------------------
responder = () =>
  new Response("url must be an https:// URL", {
    status: 400,
    headers: { "content-type": "text/plain" },
  });
let badInput: unknown;
try {
  await setAgentAdvertiseUrl({ url: "http://gateway.example.com" });
} catch (error) {
  badInput = error;
}
if (!(badInput instanceof ApiError) || badInput.status !== 400) {
  throw new Error(
    "rejected advertise url set must surface an ApiError with status 400",
  );
}
if (badInput.detail !== "url must be an https:// URL") {
  throw new Error(
    `plain-text 400 body must reach ApiError.detail, got ${JSON.stringify(badInput.detail)}`,
  );
}

// --- 兼容包装载荷（若后端未来改为包一层 advertise_url） ---------------------
const wrappedSnake = normalizeAgentAdvertiseUrl({
  advertise_url: {
    setting_id: "default",
    url: "",
    fallback_url: "https://gw.internal.example.com",
    updated_by: "",
    updated_at: null,
  },
});
if (wrappedSnake.url !== "" || wrappedSnake.updatedAt !== null) {
  throw new Error("wrapped snake_case payload was not normalized");
}
if (wrappedSnake.fallbackUrl !== "https://gw.internal.example.com") {
  throw new Error("wrapped payload must keep the config fallback");
}

const wrappedCamel = normalizeAgentAdvertiseUrl({
  advertiseUrl: {
    settingId: "default",
    url: "https://edge.example.net",
    fallbackUrl: "https://gw.internal.example.com",
    updatedBy: "ops-eng",
    updatedAt: null,
  },
});
if (wrappedCamel.url !== "https://edge.example.net" || wrappedCamel.updatedAt !== null) {
  throw new Error("wrapped camelCase payload was not normalized");
}

// --- 契约漂移必须显式失败 ---------------------------------------------------
let rejectedMissingUrl = false;
try {
  normalizeAgentAdvertiseUrl({
    setting_id: "default",
    fallback_url: "https://gw.internal.example.com",
    updated_by: "",
    updated_at: null,
  });
} catch {
  rejectedMissingUrl = true;
}
if (!rejectedMissingUrl) {
  throw new Error("missing url must be rejected instead of silently blanked");
}

let rejectedMissingFallback = false;
try {
  normalizeAgentAdvertiseUrl({
    setting_id: "default",
    url: "",
    updated_by: "",
    updated_at: null,
  });
} catch {
  rejectedMissingFallback = true;
}
if (!rejectedMissingFallback) {
  throw new Error(
    "missing fallback_url must be rejected — a blank fallback hides where agents would connect",
  );
}

let rejectedMissingUpdatedBy = false;
try {
  normalizeAgentAdvertiseUrl({
    setting_id: "default",
    url: "",
    fallback_url: "https://gw.internal.example.com",
    updated_at: null,
  });
} catch {
  rejectedMissingUpdatedBy = true;
}
if (!rejectedMissingUpdatedBy) {
  throw new Error("missing updated_by must be rejected");
}

console.log("agent advertise url contract test passed");
