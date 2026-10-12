// 契约测试：管理 token 的**传输机制**（存哪 / 怎么发 / 被拒时怎么办）。
//
// 这套是从「明明输了 token 却一直 401，继而 429」那串坑里固化下来的，钉死这几条：
//   1. token 落 `sessionStorage["warpInsightAdminApiToken"]`，且设了才发 `Authorization: Bearer`；
//      清了 / 没设 → **不带** Authorization（未认证请求不计入限流，别把本机 IP 打进封禁）；
//   2. 每次设 / 清都派发 `warpInsightAdminAuthChanged`（查询据此重取或丢弃缓存）；
//   3. 网关**明确**拒绝（401 + `invalid_admin_bearer_token`）→ 就地清 token（打破「429 盖住 401」的死循环）；
//   4. 其它 401（如证书吊销）与 **429** → **不动** token（429 只是限流，不是 token 错）；
//   5. 429 的 `Retry-After` → `ApiError.retryAfterSeconds`（缺省 60）。
//
// 机制实作在共享包 `@dayu-sec/wist-web-core/auth`；这里钉的是**本 app 的接线**（key / 事件名 /
// Bearer 注入口径 / 客户端的清除策略），那才是「一改就踩」的部分。

const STORAGE_KEY = "warpInsightAdminApiToken";
const AUTH_EVENT = "warpInsightAdminAuthChanged";
const TOKEN = "admin-token-under-test";

// 造一个只含 sessionStorage + dispatchEvent 的假 window —— 必须在 import 前就位：
// `createAdminAuth` 在模块求值时就会读它。
const store = new Map<string, string>();
const events: string[] = [];
(globalThis as unknown as { window: unknown }).window = {
  sessionStorage: {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
  },
  dispatchEvent: (event: Event) => {
    events.push(event.type);
    return true;
  },
};

let recorded: { url: string; method: string; authorization: string }[] = [];

function advertiseUrlPayload(): Record<string, unknown> {
  return {
    setting_id: "default",
    url: "https://gateway.example.com",
    fallback_url: "https://gw.internal.example.com",
    updated_by: "ops",
    updated_at: "2026-10-11T00:00:00+00:00",
  };
}

let responder: () => Response = () => Response.json(advertiseUrlPayload());

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  recorded.push({
    url: input.toString(),
    method: (init?.method ?? "GET").toUpperCase(),
    authorization: headers.get("authorization") ?? "",
  });
  return responder();
};

const {
  ADMIN_AUTH_CHANGED_EVENT,
  ApiError,
  clearAdminApiToken,
  fetchAgentAdvertiseUrl,
  getAdminApiToken,
  setAdminApiToken,
} = await import("../src/api/admin");

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(`FAIL: ${message}`);
}

async function probe(): Promise<{ url: string; authorization: string }> {
  recorded = [];
  await fetchAgentAdvertiseUrl();
  check(recorded.length === 1, `探针应只发一个请求，实际 ${recorded.length}`);
  return recorded[0];
}

async function expectThrow(): Promise<unknown> {
  try {
    await fetchAgentAdvertiseUrl();
  } catch (error) {
    return error;
  }
  throw new Error("FAIL: 预期抛错，但没有");
}

check(AUTH_EVENT === ADMIN_AUTH_CHANGED_EVENT, "auth-changed 事件名必须与 app 约定一致");

// ① 初始（无 token）：不带 Authorization，不落存储
check(getAdminApiToken() === null, "初始应无 token");
check(!store.has(STORAGE_KEY), "未设 token 时不应在 sessionStorage 留键");
check((await probe()).authorization === "", "未设 token 时不得发送 Authorization");

// ② 设 token：去首尾空白 + 落 sessionStorage + 发 Bearer + 派发事件 + 不把 token 放进 URL
events.length = 0;
setAdminApiToken(`  ${TOKEN}  `);
check(getAdminApiToken() === TOKEN, "set 应去掉首尾空白");
check(store.get(STORAGE_KEY) === TOKEN, `token 应落在 sessionStorage[${STORAGE_KEY}]`);
check(events.includes(AUTH_EVENT), "set 应派发变更事件");
const withToken = await probe();
check(
  withToken.authorization === `Bearer ${TOKEN}`,
  `设了 token 后应发 Bearer，实际 ${JSON.stringify(withToken.authorization)}`,
);
check(!withToken.url.includes(TOKEN), "token 不得出现在 URL（只走 Authorization 头）");

// ③ 清除：移除存储 + 派发事件 + 之后不再带 Authorization
events.length = 0;
clearAdminApiToken();
check(getAdminApiToken() === null, "clear 后应无 token");
check(!store.has(STORAGE_KEY), "clear 应移除 sessionStorage 的键");
check(events.includes(AUTH_EVENT), "clear 应派发变更事件");
check(
  (await probe()).authorization === "",
  "清除后不得再发送 Authorization（未认证请求不计入限流）",
);

// ④ 网关明确拒绝（401 + invalid_admin_bearer_token）→ 就地清 token
setAdminApiToken(TOKEN);
responder = () =>
  new Response(
    JSON.stringify({
      error: { code: "invalid_admin_bearer_token", message: "invalid admin bearer token" },
    }),
    { status: 401, headers: { "content-type": "application/json" } },
  );
const rejected = await expectThrow();
check(
  rejected instanceof ApiError && rejected.status === 401,
  "401 应抛 ApiError(401)",
);
check(getAdminApiToken() === null, "网关明确拒绝 token 后应就地清除");
check(!store.has(STORAGE_KEY), "自动清除应同时移除 sessionStorage 的键");

// ⑤ 其它 401（非 admin-bearer 码，如证书吊销）→ 不动 token
setAdminApiToken(TOKEN);
responder = () =>
  new Response(
    JSON.stringify({ error: { code: "certificate_revoked", message: "revoked" } }),
    { status: 401, headers: { "content-type": "application/json" } },
  );
await expectThrow();
check(getAdminApiToken() === TOKEN, "非 admin-bearer 的 401 不应清除 token");

// ⑥ 429：保留 token（限流 ≠ token 错）+ 解析 Retry-After
setAdminApiToken(TOKEN);
responder = () =>
  new Response("too many failed authentication attempts", {
    status: 429,
    headers: { "retry-after": "42" },
  });
const limited = await expectThrow();
check(
  limited instanceof ApiError && limited.status === 429,
  "429 应抛 ApiError(429)",
);
check(
  limited instanceof ApiError && limited.retryAfterSeconds === 42,
  `429 应解析 Retry-After，实际 ${limited instanceof ApiError ? limited.retryAfterSeconds : "?"}`,
);
check(getAdminApiToken() === TOKEN, "429（限流）不应清除 token");

// ⑦ 429 无 Retry-After → 缺省 60
responder = () => new Response("", { status: 429 });
const limitedDefault = await expectThrow();
check(
  limitedDefault instanceof ApiError && limitedDefault.retryAfterSeconds === 60,
  "429 无 Retry-After 时应缺省 60s",
);

console.log("admin token contract test passed");
