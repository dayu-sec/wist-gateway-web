import {
  ApiError,
  fetchAgentUplink,
  normalizeAgentUplink,
  setAdminApiToken,
  setAgentUplink,
} from "../src/api/admin";

// 契约测试：管理面「数据面上送地址 + 部署级开关」读写。
//
// 后端返回**扁平** snake_case 载荷（不是 `{uplink: {...}}` 包装），这里同时锁住：
//   1. GET  /api/v1/admin/agent/uplink 的读写路径与方法；
//   2. POST body 的字段名（host / port / enabled / requested_by），port 必须是数字、
//      enabled 必须是布尔且**总是**发出去（它是表单的当前值，不是可省略的元数据）；
//   3. 未设置过时 updated_at 为 null（而不是 undefined）、port 为约定的 9000 ——
//      页面用 `updatedAt === null` 判定「未设置」，undefined 会让哨兵值失效；
//   4. 400 的纯文本正文要落到 ApiError.detail，页面才能把后端原因透出来；
//   5. 必填字段缺失时抛错，不把服务端契约漂移静默成空字段。
//      `enabled` / `enabled_configured` 也是必填：它们决定「上不上送」这个动作，
//      缺了默认为 false 就是把「已打开」静默读成「未打开」。

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
    host: "10.0.0.7",
    port: 9000,
    enabled: true,
    enabled_configured: true,
    updated_by: "platform-maintenance-engineer",
    updated_at: "2026-09-21T08:30:00+00:00",
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
const loaded = await fetchAgentUplink();
const [readCall] = recorded;
if (recorded.length !== 1) {
  throw new Error(
    `uplink view must issue exactly one request, got ${recorded.length}`,
  );
}
if (readCall.url !== "/api/v1/admin/agent/uplink") {
  throw new Error(`unexpected view path: ${readCall.url}`);
}
if (readCall.method !== "GET") {
  throw new Error(`uplink view must be GET, got ${readCall.method}`);
}
if (readCall.authorization !== "Bearer admin-token-under-test") {
  throw new Error("admin credential must be sent in the Authorization Header");
}
if (readCall.body !== "") {
  throw new Error("uplink view must not send a body");
}
if (
  loaded.settingId !== "default" ||
  loaded.host !== "10.0.0.7" ||
  loaded.port !== 9000 ||
  loaded.enabled !== true ||
  loaded.enabledConfigured !== true ||
  loaded.updatedBy !== "platform-maintenance-engineer" ||
  loaded.updatedAt !== "2026-09-21T08:30:00+00:00"
) {
  throw new Error("flat snake_case uplink response was not normalized");
}

// --- 未设置过：updated_at 必须是 null，port 是约定默认值 --------------------
const unset = normalizeAgentUplink({
  setting_id: "default",
  host: "",
  port: 9000,
  enabled: false,
  enabled_configured: false,
  updated_by: "",
  updated_at: null,
});
if (unset.updatedAt !== null) {
  throw new Error("null updated_at must map to null, not undefined");
}
if (unset.host !== "") {
  throw new Error(
    "unset uplink must keep the empty host instead of inventing one",
  );
}
if (unset.port !== 9000) {
  throw new Error("unset uplink must keep the agreed default port 9000");
}
// 关键：字段必须存在，页面才能用 `updatedAt === null` 判定「未设置」。
if (!("updatedAt" in unset) || !("host" in unset)) {
  throw new Error(
    "nullable uplink fields must not be dropped by the normalizer",
  );
}
// 开关也是必填：缺了会被默认为 false，那就是把「已打开」静默读成「未打开」。
if (unset.enabled !== false || unset.enabledConfigured !== false) {
  throw new Error(
    "derived (unset) uplink must report the switch as off and unconfigured",
  );
}

// --- 写入：POST / body 字段名 / 返回体复用同一映射 -------------------------
recorded = [];
responder = () =>
  Response.json({
    setting_id: "default",
    host: "127.0.0.1",
    port: 9100,
    enabled: true,
    enabled_configured: true,
    updated_by: "ops-eng",
    updated_at: "2026-09-21T09:00:00+00:00",
  });
const saved = await setAgentUplink({
  host: "127.0.0.1",
  port: 9100,
  enabled: true,
  requestedBy: "ops-eng",
});
const [writeCall] = recorded;
if (recorded.length !== 1) {
  throw new Error(
    `uplink set must issue exactly one request, got ${recorded.length}`,
  );
}
if (writeCall.url !== "/api/v1/admin/agent/uplink") {
  throw new Error(`unexpected set path: ${writeCall.url}`);
}
if (writeCall.method !== "POST") {
  throw new Error(`uplink set must be POST, got ${writeCall.method}`);
}
if (writeCall.authorization !== "Bearer admin-token-under-test") {
  throw new Error(
    "uplink set must keep the credential in the Authorization Header",
  );
}
const sentBody = JSON.parse(writeCall.body) as Record<string, unknown>;
if (
  sentBody.host !== "127.0.0.1" ||
  sentBody.port !== 9100 ||
  sentBody.enabled !== true ||
  sentBody.requested_by !== "ops-eng"
) {
  throw new Error(
    `uplink set body does not match the backend request contract: ${writeCall.body}`,
  );
}
// 字段名必须是 snake_case，且 port 以数字、enabled 以布尔发送。
if (
  "requestedBy" in sentBody ||
  typeof sentBody.port !== "number" ||
  typeof sentBody.enabled !== "boolean"
) {
  throw new Error(
    `uplink set body must be flat snake_case with a numeric port and boolean switch: ${writeCall.body}`,
  );
}
// 前端不让地址进入查询串。
if (writeCall.url.includes("host") || writeCall.url.includes("token")) {
  throw new Error("uplink set must not put fields or credentials in the URL");
}
if (
  saved.host !== "127.0.0.1" ||
  saved.port !== 9100 ||
  saved.enabled !== true ||
  saved.updatedBy !== "ops-eng"
) {
  throw new Error("uplink set must return the stored setting");
}

// --- 可选字段省略时不发送空键（后端按 Option 反序列化） ---------------------
// 注意 `enabled` **不**属于可选字段：它是当前值，总是显式发出（哪怕是 false）。
recorded = [];
await setAgentUplink({ host: "127.0.0.1", port: 9000, enabled: false });
const optionalBody = JSON.parse(recorded[0].body) as Record<string, unknown>;
if ("requested_by" in optionalBody) {
  throw new Error("omitted optional fields must not be sent as empty keys");
}
if (
  optionalBody.host !== "127.0.0.1" ||
  optionalBody.port !== 9000 ||
  optionalBody.enabled !== false
) {
  throw new Error(
    "host / port / enabled must always be present in the set body",
  );
}

// --- 400 纯文本错误要透出正文 ----------------------------------------------
responder = () =>
  new Response("port must be within 1-65535", {
    status: 400,
    headers: { "content-type": "text/plain" },
  });
let badInput: unknown;
try {
  await setAgentUplink({ host: "127.0.0.1", port: 70000, enabled: false });
} catch (error) {
  badInput = error;
}
if (!(badInput instanceof ApiError) || badInput.status !== 400) {
  throw new Error(
    "rejected uplink set must surface an ApiError with status 400",
  );
}
if (badInput.detail !== "port must be within 1-65535") {
  throw new Error(
    `plain-text 400 body must reach ApiError.detail, got ${JSON.stringify(badInput.detail)}`,
  );
}

// --- 兼容包装载荷（若后端未来改为包一层 uplink） ---------------------------
const wrapped = normalizeAgentUplink({
  uplink: {
    setting_id: "default",
    host: "127.0.0.1",
    port: 9000,
    enabled: false,
    enabled_configured: false,
    updated_by: "ops-eng",
    updated_at: null,
  },
});
if (wrapped.host !== "127.0.0.1" || wrapped.updatedAt !== null) {
  throw new Error("wrapped uplink payload was not normalized");
}

// --- 契约漂移必须显式失败 ---------------------------------------------------
let rejectedMissingHost = false;
try {
  normalizeAgentUplink({
    setting_id: "default",
    port: 9000,
    enabled: false,
    enabled_configured: false,
    updated_by: "",
    updated_at: null,
  });
} catch {
  rejectedMissingHost = true;
}
if (!rejectedMissingHost) {
  throw new Error("missing host must be rejected instead of silently blanked");
}

let rejectedMissingPort = false;
try {
  normalizeAgentUplink({
    setting_id: "default",
    host: "127.0.0.1",
    enabled: false,
    enabled_configured: false,
    updated_by: "",
    updated_at: null,
  });
} catch {
  rejectedMissingPort = true;
}
if (!rejectedMissingPort) {
  throw new Error("missing port must be rejected");
}

let rejectedMissingUpdatedBy = false;
try {
  normalizeAgentUplink({
    setting_id: "default",
    host: "127.0.0.1",
    port: 9000,
    enabled: false,
    enabled_configured: false,
    updated_at: null,
  });
} catch {
  rejectedMissingUpdatedBy = true;
}
if (!rejectedMissingUpdatedBy) {
  throw new Error("missing updated_by must be rejected");
}

// 开关字段缺失也不能放行：读成默认 false 就是把「已打开」静默读成「未打开」，
// 而这两个在页面上是「全队开始上送」与「待命」的区别。
for (const missing of ["enabled", "enabled_configured"] as const) {
  const payload: Record<string, unknown> = {
    setting_id: "default",
    host: "127.0.0.1",
    port: 9000,
    enabled: true,
    enabled_configured: true,
    updated_by: "ops-eng",
    updated_at: null,
  };
  delete payload[missing];
  let rejected = false;
  try {
    normalizeAgentUplink(payload);
  } catch {
    rejected = true;
  }
  if (!rejected) {
    throw new Error(`missing ${missing} must be rejected`);
  }
}

console.log("agent uplink contract test passed");
