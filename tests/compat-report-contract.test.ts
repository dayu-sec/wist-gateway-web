import type { InstallPackageView } from "../src/api/admin";
import { normalizeCompatReport } from "../src/api/admin";
import { managedPackageRows } from "../src/components/agentPackageRegistry";
import {
  compatDeclaredRanges,
  compatLabel,
  compatSeverityLabel,
  compatSummary,
  compatTone,
} from "../src/components/compatReport";

// 契约测试：网关页面的「兼容性」展示。
//
// 锁住四件事：
//   1. 后端 snake_case（`checked_at`）→ 页面 camelCase，`checks[]` 逐条保留；
//   2. 老网关不带这个字段 / 数据形状不对 → null（显示“未检查”），不能抛错把列表打挂；
//   3. `unknown` 是灰、文案“未验证”—— 不能被当成绿色“兼容”；
//   4. 安装包列表按**版本**归行时，兼容性跟着该版本走（同版本多平台取第一份非空报告）。
//
// Usage: npm run test:compat-report

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const reportPayload = {
  status: "warn",
  checked_at: "2026-10-29T02:00:00Z",
  current: { "wist-gateway": "0.8.6", "wist-center": "0.24.0" },
  checks: [
    {
      package: "wist-agentd",
      version: "0.1.20",
      peer: "wist-gateway",
      required: ">=0.9.0 <0.10.0",
      actual: "0.8.6",
      ok: false,
      severity: "warn",
      message: "`wist-gateway` 0.8.6 不在范围内（兼容模式下可共存）",
    },
  ],
};

// ── 1. snake_case → camelCase ────────────────────────────────────────────────

const report = normalizeCompatReport(reportPayload);
assert(report !== null, "合法报告不该是 null");
assert(
  report?.checkedAt === "2026-10-29T02:00:00Z",
  `checked_at 没映射：${report?.checkedAt}`,
);
assert(
  report?.current["wist-gateway"] === "0.8.6",
  "current 版本向量丢了",
);
assert(
  report?.checks[0]?.required === ">=0.9.0 <0.10.0" &&
    report?.checks[0]?.actual === "0.8.6" &&
    report?.checks[0]?.severity === "warn",
  `检查条目丢了：${JSON.stringify(report?.checks[0])}`,
);

// ── 2. 老网关 / 脏数据：不抛错、不臆造 ok ────────────────────────────────────

assert(normalizeCompatReport(undefined) === null, "undefined 应为 null");
assert(normalizeCompatReport(null) === null, "null 应为 null");
assert(normalizeCompatReport("ok") === null, "字符串应为 null");
assert(normalizeCompatReport({ status: "weird" }) === null, "未知 status 应为 null");
assert(
  normalizeCompatReport({ status: "unknown" })?.checks.length === 0,
  "缺 checks 时应为空数组",
);

// ── 3. 颜色 / 文案：unknown 是灰 ─────────────────────────────────────────────

assert(compatTone("ok") === "ok", "ok tone");
assert(compatTone("warn") === "warn", "warn tone");
assert(compatTone("error") === "crit", "error tone");
assert(compatTone("unknown") === "unknown", "unknown 必须是灰");
assert(compatLabel("unknown") === "未验证", `unknown 文案：${compatLabel("unknown")}`);
assert(compatSeverityLabel("error") === "阻断", "error 级别文案");
assert(compatSummary(null) === "未检查", "没有报告时摘要");
assert(compatSummary(report) === "1 项告警", `warn 摘要：${compatSummary(report)}`);

// 声明的范围从 checks 里取；`*`（无声明）不算范围。
assert(
  compatDeclaredRanges(report).length === 1 &&
    compatDeclaredRanges(report)[0].peer === "wist-gateway",
  `声明范围取错：${JSON.stringify(compatDeclaredRanges(report))}`,
);
assert(
  compatDeclaredRanges(
    normalizeCompatReport({
      status: "unknown",
      checks: [
        {
          peer: "*",
          required: "*",
          actual: "",
          ok: false,
          severity: "warn",
          message: "包内没有 compat.json",
        },
      ],
    }),
  ).length === 0,
  "`*` 不该被当成声明的范围",
);

// ── 4. 列表归行：兼容性跟着版本走 ────────────────────────────────────────────

function entry(
  packageId: string,
  version: string,
  arch: string,
  compatibility: ReturnType<typeof normalizeCompatReport>,
): InstallPackageView {
  return {
    packageId,
    source: `/tmp/${packageId}.tar.gz`,
    packageSha256: `sha256:${packageId}`,
    version,
    arch,
    agentPackageUrl: `http://gw/api/v1/agent/packages/${packageId}`,
    createdBy: "ops",
    createdAt: "2026-10-29T00:00:00Z",
    compatibility,
  };
}

const rows = managedPackageRows(
  [
    entry("pkg-a", "0.1.20", "aarch64-apple-darwin", report),
    // 同版本第二平台没有报告（老记录）→ 仍用第一份。
    entry("pkg-b", "0.1.20", "x86_64-unknown-linux-musl", null),
    // 另一个版本完全没报告 → 该行是 null（显示“未检查”）。
    entry("pkg-c", "0.1.18", "aarch64-apple-darwin", null),
  ],
  [],
);

const current = rows.find((row) => row.version === "0.1.20");
const older = rows.find((row) => row.version === "0.1.18");
assert(
  current?.compatibility?.status === "warn",
  `同版本应带上兼容报告：${JSON.stringify(current?.compatibility)}`,
);
assert(older?.compatibility === null, "没有报告的版本应为 null");
assert(
  rows.length === 2 && current?.platforms.length === 2,
  "归行口径被改了（版本一行、平台 chips）",
);

console.log("compat-report-contract: ok");
