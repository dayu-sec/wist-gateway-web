import { t } from "../i18n";

/**
 * 审批终端（`wist-approve`）安装命令的拼装 —— 页面与契约测试共用同一份事实。
 *
 * 为什么不把命令写死在组件里：这条命令里有两处**会漂的外部事实**
 *   1. 三个 target triple（必须与网关分发白名单一致：gateway `src/api/install_package.rs`
 *      的 PLATFORM_*，审批分发面复用它）—— 写错不会报错，只会在客户机器上跑出 404；
 *   2. 网关的**对外**基址（不是当前页面的 `:8443`）—— 审批人是在**自己的机器**上执行，
 *      地址必须是那台机器能连到的网关，来源只能是管理面设置的「Agent 对外地址」。
 *
 * 所以：基址由调用方给（页面从 `useAgentAdvertiseUrl` 取），triple 在这里列成表。
 */

/** 白名单里的三个 triple（顺序即页面上的展示顺序）。 */
export const APPROVER_TRIPLES = [
  "x86_64-unknown-linux-musl",
  "aarch64-unknown-linux-musl",
  "aarch64-apple-darwin",
] as const;

export type ApproverTriple = (typeof APPROVER_TRIPLES)[number];

/** 平台选项：`triple` 必须逐字符对上网关白名单（见文件头）。 */
export interface ApproverPlatform {
  triple: ApproverTriple;
  label: string;
}

/**
 * 平台表写成**函数**：`t()` 必须在渲染期求值，模块顶层求值会让切语言时这句文案不变
 * （本仓 i18n 约定，见 `tests/i18n-contract.test.ts`）。
 */
export function approverPlatforms(): ApproverPlatform[] {
  return [
    { triple: "x86_64-unknown-linux-musl", label: t("Linux x86_64", "Linux x86_64") },
    {
      triple: "aarch64-unknown-linux-musl",
      label: t("Linux ARM64", "Linux ARM64"),
    },
    {
      triple: "aarch64-apple-darwin",
      label: t("macOS（Apple 芯片）", "macOS (Apple silicon)"),
    },
  ];
}

/**
 * 拼一条安装命令。
 *
 * - 基址末尾的 `/` 会被去掉：管理面上粘贴时常带尾斜杠，`//api/...` 在部分反代上会 404；
 * - 用 `install.sh`（而不是直接下二进制）：脚本内嵌了包摘要，装完还会打印下一步；
 * - `-k` 是刻意保留的：管理面是自签 CA，新机器还没信任它 —— 完整性靠脚本里的 sha256，
 *   TLS 在这里只当传输层。
 */
export function approverInstallCommand(base: string, triple: ApproverTriple): string {
  const trimmed = base.trim().replace(/\/+$/, "");
  return `curl -fsSLk '${trimmed}/api/v1/approver/install/${triple}/install.sh' | sh`;
}

/**
 * 从 UA 猜默认平台（只用来**预选**，用户随时可以改）。
 *
 * macOS 一律选 arm64：本版只出 Apple 芯片制品，Intel Mac 上安装脚本会当场拒收并说明原因
 * （"这份安装命令是给 aarch64-apple-darwin 的，但本机是 Darwin x86_64"），比给一条
 * 根本跑不起来的命令好。
 */
export function detectApproverPlatform(userAgent: string): ApproverTriple {
  if (/Mac OS X|Macintosh/i.test(userAgent)) return "aarch64-apple-darwin";
  if (/aarch64|arm64/i.test(userAgent)) return "aarch64-unknown-linux-musl";
  return "x86_64-unknown-linux-musl";
}
