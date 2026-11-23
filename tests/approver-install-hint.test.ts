import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  APPROVER_TRIPLES,
  approverInstallCommand,
  approverPlatforms,
  detectApproverPlatform,
} from "../src/lib/approverInstall";

// 契约测试：审批页上的「怎么装审批终端」。
//
// 锁四件事：
//   1. **三个 triple 与网关白名单一致** —— 网关侧有对称的测试
//      （`approver_install.rs` 的 `install_script_handles_every_whitelisted_platform`），
//      这边锁定「页面给出的命令」用的是同一组名字。名字漂了不会报错，只会在客户机器上 404。
//   2. **命令形状**：`curl -fsSLk '<base>/api/v1/approver/install/<triple>/install.sh' | sh`，
//      且基址末尾的 `/` 会被消掉（管理面粘进来的值常带尾斜杠）。
//   3. **基址来自管理面的「Agent 对外地址」**，不是页面的 location —— 页面在 nginx 的
//      8443，审批人机器要连的是网关的 443，两个入口是分开的。
//   4. **页面确实渲染了这个区块**（源码闸）：否则组件是死的，测试全绿而界面上没有。
//
// Usage: npm run test:approver-install

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

// ── 1. triple 表 ────────────────────────────────────────────────────────────
const expected = [
  "x86_64-unknown-linux-musl",
  "aarch64-unknown-linux-musl",
  "aarch64-apple-darwin",
];
assert(
  JSON.stringify([...APPROVER_TRIPLES]) === JSON.stringify(expected),
  `triple 表必须正好是 ${expected.join(" / ")}（现为 ${APPROVER_TRIPLES.join(" / ")}）`,
);
const platforms = approverPlatforms();
assert(
  platforms.length === expected.length,
  "平台选项数量必须与 triple 表一致",
);
for (const platform of platforms) {
  assert(
    expected.includes(platform.triple),
    `平台 ${platform.triple} 不在网关白名单里（下载会 404）`,
  );
  assert(platform.label.trim().length > 0, `${platform.triple} 缺显示名`);
}
// gnu 制品在老跳板机上跑不起来，且网关白名单里没有 —— 不许出现在页面上。
for (const platform of platforms) {
  assert(
    !platform.triple.includes("linux-gnu"),
    `平台 ${platform.triple} 是 gnu；Linux 必须是 musl`,
  );
}

// ── 2. 命令形状 ─────────────────────────────────────────────────────────────
for (const triple of expected) {
  const command = approverInstallCommand("https://gw.example", triple);
  assert(
    command ===
      `curl -fsSLk 'https://gw.example/api/v1/approver/install/${triple}/install.sh' | sh`,
    `命令形状不对：${command}`,
  );
}
// 尾斜杠 / 空白：管理面粘进来的值常带，`//api/...` 在部分反代上会 404。
assert(
  approverInstallCommand("https://gw.example/", "aarch64-apple-darwin") ===
    approverInstallCommand("https://gw.example", "aarch64-apple-darwin"),
  "基址末尾的 / 必须被消掉",
);
assert(
  approverInstallCommand("  https://gw.example//  ", "aarch64-apple-darwin").includes(
    "'https://gw.example/api/v1/approver/install/",
  ),
  "基址两端的空白与多余斜杠都要去掉",
);

// ── 3. 平台预选（只预选，用户可改）──────────────────────────────────────────
assert(
  detectApproverPlatform(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
  ) === "aarch64-apple-darwin",
  "Mac 应预选 darwin（本版只出 Apple 芯片制品）",
);
assert(
  detectApproverPlatform("Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36") ===
    "aarch64-unknown-linux-musl",
  "Linux arm64 应预选 aarch64 musl",
);
assert(
  detectApproverPlatform("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36") ===
    "x86_64-unknown-linux-musl",
  "Linux x86_64 应预选 x86_64 musl",
);
assert(
  detectApproverPlatform("") === "x86_64-unknown-linux-musl",
  "认不出 UA 时回退到最常见的 x86_64",
);

// ── 4. 源码闸：基址来源 + 页面挂载 ──────────────────────────────────────────
const hint = readSource("../src/components/ApproverInstallHint.tsx");
assert(
  hint.includes("useAgentAdvertiseUrl"),
  "基址必须取管理面的「Agent 对外地址」（useAgentAdvertiseUrl）",
);
assert(
  hint.includes("fallbackUrl"),
  "没设置过时必须回落 fallbackUrl（配置文件里的 public_base_url）",
);
assert(
  !hint.includes("window.location") && !hint.includes("location.host"),
  "不能用页面自身的 location 拼基址：页面在 8443，审批人连的是网关 443",
);

const page = readSource("../src/components/SubsystemAgentApprovalPage.tsx");
assert(
  page.includes("<ApproverInstallHint />"),
  "审批页没有渲染 ApproverInstallHint（组件是死的，界面上看不到）",
);
// 只读的约束仍然成立（与 approver-keys 那条源码闸同一理由）。
for (const forbidden of [
  "useVoteActionApproval",
  "useIssueActionApproval",
  "wist-approve approve --sign",
]) {
  assert(
    !page.includes(forbidden),
    `审批页不该出现 ${forbidden}：投票/签名的入口只有审批机上的 CLI`,
  );
}

const pkg = JSON.parse(readSource("../package.json")) as {
  scripts: Record<string, string>;
};
assert(
  pkg.scripts["test:approver-install"]?.includes("approver-install-hint.test.ts"),
  "package.json 缺 test:approver-install 脚本",
);

console.log("ok: 审批终端安装提示（triple 白名单 / 命令形状 / 基址来源 / 页面挂载）");
