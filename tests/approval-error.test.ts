import {
  KNOWN_APPROVAL_ERROR_CODES,
  approvalCodeMessage,
  describeApprovalError,
} from "../src/lib/approvalError";

// 审批页的**错误文案**测试（零依赖，`tsx` 直接跑）。
//
// 锁两件事：
//   1. 每个已知原因码都有**专门**文案 —— 不能悄悄回落到「HTTP 409：<英文原文>」，
//      那等于让运维对着看不懂的话重试；
//   2. 未知原因码仍能把网关原话抬出来（兜底不能把信息吞掉）。
//
// Usage: npm run test:approval-error

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

// ── 每个已知码都得有文案，且不能是「通用兜底」那一句 ──────────────────────────
// （`approval_load_failed` / `approval_store_failed` 刻意共用一句：对我们的用户来说
// 处置方式一样——看磁盘和日志。所以不做「文案唯一」断言。）
const fallback = describeApprovalError({
  status: 409,
  detail: "raw gateway text",
});
for (const code of KNOWN_APPROVAL_ERROR_CODES) {
  const message = approvalCodeMessage(code);
  assert(message !== null, `${code} must have dedicated copy`);
  assert(message.trim().length > 0, `${code} copy must not be blank`);
  assert(
    message !== fallback && !message.includes("raw gateway text"),
    `${code} must not fall back to the generic gateway-detail message`,
  );
}

// 认不出的码必须返回 null（交给调用方回落到 detail）。
assert(
  approvalCodeMessage("some_future_code") === null,
  "an unknown code must fall through to null",
);

// ── describeApprovalError 的分派顺序 ────────────────────────────────────────
// 401 / 429 优先于原因码：token 错了先修 token，别让人去读业务原因。
assert(
  describeApprovalError({ status: 401, code: "approval_closed" }) ===
    describeApprovalError({ status: 401 }),
  "401 must win over a business code",
);
assert(
  describeApprovalError({ status: 429, code: "approval_closed" }) ===
    describeApprovalError({ status: 429 }),
  "429 must win over a business code",
);

// 已知码优先于 detail：同一个码，detail 写什么都不该改变给用户的建议。
const withDetail = describeApprovalError({
  status: 409,
  code: "plan_changed_since_approval",
  detail: "plan digest mismatch",
});
assert(
  withDetail === approvalCodeMessage("plan_changed_since_approval"),
  "a known code must beat gateway detail",
);
assert(
  !withDetail.includes("plan digest mismatch"),
  "a known code must not leak the raw english detail",
);

// 未知码 + detail：把网关原话抬出来（信息不能丢）。
const unknown = describeApprovalError({
  status: 409,
  code: "some_future_code",
  detail: "something specific",
});
assert(
  unknown.includes("something specific") && unknown.includes("409"),
  `unknown code with detail must surface both status and detail, got: ${unknown}`,
);

// 未知码且无 detail：退到「查日志」。
const bare = describeApprovalError({ status: 502 });
assert(
  bare.includes("502") && bare !== unknown,
  `bare error must mention the status, got: ${bare}`,
);

// 没有结构化错误 = 契约不匹配，不能伪装成 HTTP 错误。
const contract = describeApprovalError(null);
assert(
  !contract.includes("HTTP"),
  `a non-HTTP failure must not mention HTTP, got: ${contract}`,
);

console.log("approval error OK");
