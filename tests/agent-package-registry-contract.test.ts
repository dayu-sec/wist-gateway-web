import type {
  AgentInstallPackagePlatform,
  InstallPackageView,
} from "../src/api/admin";
import {
  activePackageCount,
  inUseVersionOptions,
  managedPackageRows,
  missingPlatforms,
} from "../src/components/agentPackageRegistry";
import { AGENTD_PLATFORMS, platformLabel } from "../src/components/agentPackagePlatforms";

// 契约测试：「已托管包」表的纯派生（components/agentPackageRegistry.ts）。
//
// 这一层是网关页与中心页**对齐的那部分口径**：一行 = 一个版本、平台是行内 chips、（网关侧没有
// 状态字段，所以）状态由「本机当前分发的是不是这一份」推出来。它出错的样子很隐蔽 —— 页面照常
// 渲染，只是把「已归档」错标成「在用」，或者反过来。所以这里把判定钉死。
//
// Usage: npm run test:agent-package-registry

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function pkg(overrides: Partial<InstallPackageView>): InstallPackageView {
  return {
    packageId: "pkg-1",
    source: "https://mirror.example.com/wist-agentd-0.3.0-alpha.tar.gz",
    packageSha256: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    version: "0.3.0-alpha",
    arch: "aarch64-apple-darwin",
    agentPackageUrl: "https://gw.example.com/api/v1/agent/packages/pkg-1",
    createdBy: "admin",
    createdAt: "2026-10-11T12:09:01Z",
    ...overrides,
  };
}

function setting(
  overrides: Partial<AgentInstallPackagePlatform>,
): AgentInstallPackagePlatform {
  return {
    platform: "aarch64-apple-darwin",
    packageUrl: "/srv/wist/packages/aarch64-apple-darwin__wist-agentd-0.3.0-alpha.tar.gz",
    packageSha256:
      "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    updatedBy: "admin",
    updatedAt: "2026-10-11T12:09:02Z",
    ...overrides,
  };
}

// --- 空历史：不编造行 ---
assert(managedPackageRows([], []).length === 0, "没有录入记录时不该有行");
assert(activePackageCount([]) === 0, "没有行时在用数为 0");

// --- 一个版本三平台、全部在用 → live（行内三个 chips 都 live） ---
const v3 = [
  pkg({ packageId: "p-darwin", arch: "aarch64-apple-darwin" }),
  pkg({
    packageId: "p-arm-linux",
    arch: "aarch64-unknown-linux-musl",
    packageSha256:
      "sha256:2222222222222222222222222222222222222222222222222222222222222222",
  }),
  pkg({
    packageId: "p-x86-linux",
    arch: "x86_64-unknown-linux-musl",
    packageSha256:
      "sha256:3333333333333333333333333333333333333333333333333333333333333333",
  }),
];
const allLive = managedPackageRows(v3, [
  setting({}),
  setting({
    platform: "aarch64-unknown-linux-musl",
    packageSha256:
      "sha256:2222222222222222222222222222222222222222222222222222222222222222",
  }),
  setting({
    platform: "x86_64-unknown-linux-musl",
    packageSha256:
      "sha256:3333333333333333333333333333333333333333333333333333333333333333",
  }),
]);
assert(allLive.length === 1, "同一版本的三条记录折成一行");
assert(allLive[0].status === "live", "三平台都在用 → live");
assert(allLive[0].platforms.length === 3, "行内三个平台");
assert(
  allLive[0].platforms.every((platform) => platform.live),
  "三个平台都标在用",
);
assert(
  allLive[0].platforms.every((platform) => platform.cachedPath !== null),
  "在用平台要带出本机缓存路径",
);

// --- 一个版本里只有部分平台在用 → partial；已归档的平台不带缓存路径 ---
const partial = managedPackageRows(v3, [setting({})]);
assert(partial[0].status === "partial", "只有 darwin 在用 → partial");
assert(
  partial[0].platforms.filter((platform) => platform.live).length === 1,
  "只有一个平台在用",
);
assert(
  partial[0].platforms
    .filter((platform) => !platform.live)
    .every((platform) => platform.cachedPath === null),
  "不在用的平台不报本机缓存路径",
);

// --- 摘要对不上（当前分发的是别的版本）→ 整个版本都是 archived ---
const archived = managedPackageRows(v3, [
  setting({
    packageSha256:
      "sha256:9999999999999999999999999999999999999999999999999999999999999999",
  }),
]);
assert(archived[0].status === "archived", "当前分发对不上任何录入记录 → archived");
assert(activePackageCount(archived) === 0, "archived 不算在用");
assert(activePackageCount(partial) === 1, "partial 算在用（中心页的『在用 N 个』同口径）");

// --- 多版本：按最近录入时间倒序，行的 recordedAt 取该版本最新一条 ---
const multi = managedPackageRows(
  [
    pkg({
      packageId: "new-1",
      version: "0.7.1-alpha",
      createdAt: "2026-10-10T16:38:56Z",
      packageSha256:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }),
    pkg({ packageId: "old-1", createdAt: "2026-10-09T10:00:00Z" }),
    pkg({
      packageId: "old-2",
      arch: "x86_64-unknown-linux-musl",
      createdAt: "2026-10-11T08:00:00Z",
      packageSha256:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    }),
  ],
  [],
);
assert(multi.length === 2, "两个版本两行");
assert(
  multi[0].version === "0.3.0-alpha" && multi[1].version === "0.7.1-alpha",
  "按该版本最近录入时间倒序（0.3.0 有一条 10-11，比 0.7.1 的 10-10 新）",
);
assert(multi[0].recordedAt === "2026-10-11T08:00:00Z", "行的录入时间取该版本最新一条");

// --- 架构读不出：不丢记录，chip 交给页面显示成 — ---
const noArch = managedPackageRows(
  [pkg({ packageId: "no-arch", arch: "", version: "0.1.0" })],
  [],
);
assert(noArch.length === 1 && noArch[0].platforms.length === 1, "无名平台也要保留在行里");
assert(noArch[0].platforms[0].platform === "", "无名平台原样传出空串（由页面渲染 —）");
assert(noArch[0].status === "archived", "没有在用记录 → archived");

// --- 版本读不出：归到「—」而不是消失 ---
const noVersion = managedPackageRows([pkg({ packageId: "no-version", version: "" })], []);
assert(noVersion[0].version === "—", "读不出版本时显示 —");

// --- 缺件平台：设置里没有，或地址为空，都算缺 ---
assert(
  missingPlatforms([], AGENTD_PLATFORMS).length === 3,
  "一个都没设置 → 三个平台都缺",
);
assert(
  missingPlatforms(
    [
      setting({}),
      setting({ platform: "aarch64-unknown-linux-musl", packageUrl: "  " }),
    ],
    AGENTD_PLATFORMS,
  ).join(",") === "x86_64-unknown-linux-musl,aarch64-unknown-linux-musl",
  "空白地址也算缺（后端从没写入过的样子）",
);
assert(
  missingPlatforms(
    [
      setting({}),
      setting({ platform: "aarch64-unknown-linux-musl" }),
      setting({ platform: "x86_64-unknown-linux-musl" }),
    ],
    AGENTD_PLATFORMS,
  ).length === 0,
  "三平台齐全时不报缺件",
);

// --- 升级目标版本：只列**在用**版本（旧版本是存档，不能当升级目标） ---
const twoVersions = [
  pkg({
    packageId: "cur-1",
    version: "0.3.0-alpha",
    arch: "aarch64-apple-darwin",
    createdAt: "2026-10-11T12:09:01Z",
  }),
  pkg({
    packageId: "cur-2",
    version: "0.3.0-alpha",
    arch: "x86_64-unknown-linux-musl",
    createdAt: "2026-10-11T12:09:01Z",
    packageSha256:
      "sha256:3333333333333333333333333333333333333333333333333333333333333333",
  }),
  pkg({
    packageId: "old-1",
    version: "0.7.1-alpha",
    arch: "aarch64-apple-darwin",
    createdAt: "2026-10-10T16:38:56Z",
    packageSha256:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  }),
];
const upgradeOptions = inUseVersionOptions(twoVersions, [
  setting({}),
  setting({
    platform: "x86_64-unknown-linux-musl",
    packageSha256:
      "sha256:3333333333333333333333333333333333333333333333333333333333333333",
  }),
]);
assert(upgradeOptions.length === 1, "只有一个在用版本 → 只给一个选项");
assert(
  upgradeOptions[0].version === "0.3.0-alpha",
  "选项用的是在用版本，旧版本（0.7.1-alpha）不出现",
);
assert(
  upgradeOptions[0].platforms.join(",") ===
    "aarch64-apple-darwin,x86_64-unknown-linux-musl",
  "选项带着该版本已覆盖的平台（给「已覆盖平台」那行用）",
);
assert(
  inUseVersionOptions(twoVersions, []).length === 0,
  "网关还没设置过当前分发包 → 没有可选的升级目标（页面给空态说明，不列存档版本）",
);
assert(
  inUseVersionOptions(twoVersions, [
    setting({
      packageSha256:
        "sha256:9999999999999999999999999999999999999999999999999999999999999999",
    }),
  ]).length === 0,
  "当前分发对不上任何录入记录 → 同样不列（宁可空，也不给对不上的版本）",
);

// --- 平台标签：认识的走人读名，不认识的原样露出 triple ---
assert(platformLabel("aarch64-apple-darwin") === "macOS · ARM", "认识 macos");
assert(
  platformLabel("riscv64-unknown-linux-musl") === "riscv64-unknown-linux-musl",
  "不认识的平台原样露出，不编名字",
);

console.log(
  "agent package registry contract: OK (一行=一个版本 / 在用判定 / 升级只列在用版本 / 缺件平台 / 平台标签)",
);
