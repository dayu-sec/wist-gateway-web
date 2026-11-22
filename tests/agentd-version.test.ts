import {
  MIN_EXEC_AGENTD,
  execGate,
  parseVersion,
  versionAtLeast,
} from "../src/lib/agentdVersion";

// 响应发起页的**版本闸**（零依赖，`tsx` 直接跑）。
//
// 锁两件事：
//   1. 0.37.0 是「认识 action_plan」的分界：0.36.9 挡住、0.37.0 放行；
//   2. 读不到版本**不挡**（提示而不是拒绝）—— 挡掉会让一台其实能跑的机器不能用。
//
// Usage: npm run test:agentd-version

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

// ── 解析 ────────────────────────────────────────────────────────────────────
assert(parseVersion("0.36.0")?.join(".") === "0.36.0", "plain version");
assert(
  parseVersion("v0.41.0-alpha")?.join(".") === "0.41.0",
  "prefixed version",
);
assert(parseVersion("0.37")?.join(".") === "0.37.0", "two segments pad to 0");
assert(parseVersion("") === null, "empty is unknown");
assert(parseVersion("dev") === null, "non-numeric is unknown");

// ── 比较 ────────────────────────────────────────────────────────────────────
assert(versionAtLeast("0.37.0", "0.37.0"), "equal counts as at least");
assert(versionAtLeast("0.41.0", "0.37.0"), "newer minor");
assert(versionAtLeast("1.0.0", "0.99.9"), "major wins");
assert(!versionAtLeast("0.36.9", "0.37.0"), "older minor is below");
assert(!versionAtLeast("0.37.0", "0.37.1"), "older patch is below");
assert(!versionAtLeast("", "0.37.0"), "unknown never satisfies");

// ── 闸门 ────────────────────────────────────────────────────────────────────
assert(MIN_EXEC_AGENTD === "0.37.0", "minimum must match agentd's E2 release");
assert(execGate("0.36.0") === "old", "0.36.0 cannot execute plans");
assert(execGate("0.36.99") === "old", "0.36.x cannot execute plans");
assert(execGate("0.37.0") === "ok", "0.37.0 is the first version that can");
assert(execGate("0.41.0") === "ok", "current release can");
assert(execGate("") === "unknown", "missing version must not block");
assert(
  execGate("dev-build") === "unknown",
  "unparsable version must not block",
);

console.log("agentd version gate OK");
