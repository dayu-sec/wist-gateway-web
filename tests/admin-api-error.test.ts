import { ApiError } from "../src/api/admin";
import { adminApiErrorMessage } from "../src/components/adminApiError";

// 契约测试：管理接口读取失败的**文案**（`adminApiErrorMessage`）。
//
// 为什么单测这几行字符串：这三个页面（Agent 总览 / 主机指标 / 安装 Agent）以前把任何取数失败
// 一律说成「请确认 warp-insight-admin 已启动」，而服务端**已经返回了能照着做的正文**。
// 2026-10-01 真踩到：装 Agent 报「请确认服务已启动」，实际是管理面没录入安装包。
// 所以这里钉住的核心是一条：**服务端正文必须透出来，通用话只能兜底**。

let passed = 0;

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(`FAIL: ${message}`);
  passed += 1;
}

// ① 服务端给了正文 → 必须原样透出（这是本模块存在的理由）
const withText = adminApiErrorMessage(
  new ApiError(
    500,
    "/api/v1/agent/install-code",
    undefined,
    "failed to issue install code: 没有可用的 agent 安装包：管理面未录入来源，或录入的副本已不在",
  ),
);
check(
  withText.includes("没有可用的 agent 安装包"),
  `500 的正文必须透出来（否则运维去查一个不存在的问题）：${withText}`,
);
check(
  withText.includes("HTTP 500"),
  `透出正文时也要带上状态码：${withText}`,
);
check(
  !withText.includes("已启动"),
  `有正文时不该再吐"服务没启动"这类猜测：${withText}`,
);

// ② 正文是管理面的 {code,message} JSON → 只取 message，别把 JSON 摊到页面上
const withJson = adminApiErrorMessage(
  new ApiError(
    422,
    "/x",
    undefined,
    '{"code":"package_source_unavailable","message":"来源拉不到"}',
  ),
);
check(
  withJson.includes("来源拉不到") && !withJson.includes("{"),
  `JSON 正文要解出 message、不摊括号：${withJson}`,
);

// ③ 截断的 JSON（ApiError.detail 只留 300 字符）→ 当纯文本用，不能因此丢掉内容
const truncatedJson = adminApiErrorMessage(
  new ApiError(500, "/x", undefined, '{"code":"boom","message":"前半段被截'),
);
check(
  truncatedJson.includes("boom") || truncatedJson.includes("前半段被截"),
  `截断的 JSON 也要把已有内容透出来：${truncatedJson}`,
);

// ④ 空正文 5xx → 这才该说"请求很可能没到网关"（含 proxy 线索）
const emptyBody = adminApiErrorMessage(new ApiError(502, "/x"));
check(
  emptyBody.includes("网关没有应答") && emptyBody.includes("WARP_INSIGHT_WEB_PROXY_TARGET"),
  `空正文 5xx 要说"没应答"并给 proxy 线索：${emptyBody}`,
);

// ⑤ 401 / 404 有各自更准的话，不能被通用分支吞掉
const unauthorized = adminApiErrorMessage(new ApiError(401, "/x"));
check(
  unauthorized.includes("Admin Token") && unauthorized.includes("应用"),
  `401 要指向 Admin Token：${unauthorized}`,
);
const notFound = adminApiErrorMessage(new ApiError(404, "/x"));
check(
  notFound.includes("旧构建"),
  `404 要提示网关很可能是旧构建：${notFound}`,
);

// ⑥ 不是 ApiError（响应形状都不对）→ 指向版本不符，而不是"服务没启动"
const shape = adminApiErrorMessage(new Error("boom"));
check(
  shape.includes("契约") && shape.includes("版本"),
  `非 ApiError 要指向前后端版本：${shape}`,
);

// ⑦ 空 detail（undefined / 空白）等同于"没有正文"
check(
  adminApiErrorMessage(new ApiError(500, "/x", undefined, "   ")).includes("网关没有应答"),
  "空白正文要按「没有正文」处理",
);

console.log(`admin-api-error contract test passed (${passed} checks)`);
