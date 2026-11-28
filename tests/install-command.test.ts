import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REINSTALL_ENV_LINE,
  copyableInstallCommand,
  displayInstallCommand,
} from "../src/components/installCommand";
import {
  REINSTALL_PAGE_PATH,
  readInstallMode,
  writeInstallMode,
} from "../src/components/installMode";
import { remainingSeconds } from "../src/components/installCodeExpiry";

// 安装页的「命令拼装」与「用途深链」两件事的契约。
//
// 这一层最容易坏在「静默降级」上，且 **tsc 发现不了**：
//   1. 重装标记少拼一处 —— 用户粘过去的命令只会做一次普通安装，而普通安装在已注册的机器上
//      会被跳过注册（`ensure_enrolled` 见到 state 里已有身份就早返回），证书根本没换；
//   2. 用途深链对不上（链接写一套、解析写另一套）—— 从身份面板点过去却落在「首次安装」模式，
//      于是又回到第 1 条。
//
// Usage: npm run test:install-command

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const COMMAND =
  'set -eu; D="$(mktemp -d)"; curl -fsSLk "https://gw.example.com/api/v1/agent/install/x86_64-unknown-linux-musl/install.sh" -o "$D/s"';
const TOKEN =
  "wit_64ef997ced0c0a9c401d65687d4c4d0390c485f5bf04854b83e857879ef9612d";

// ── 普通安装：不得因为引入本模块而改变任何字节 ──
assert(
  displayInstallCommand(COMMAND, false) === COMMAND,
  "非重装：展示命令原样",
);
assert(
  copyableInstallCommand(COMMAND, TOKEN, false) ===
    `export WARP_INSIGHT_ENROLLMENT_TOKEN=${TOKEN}\n${COMMAND}`,
  "非重装：可复制命令 = token 行 + 命令",
);
assert(
  copyableInstallCommand(COMMAND, undefined, false) === COMMAND,
  "非重装：没给 token 时退回原命令",
);
assert(
  copyableInstallCommand(undefined, TOKEN, false) === undefined,
  "没命令时不乱造内容",
);

// ── 重装：令牌（WIST_AGENTD_REINSTALL=1）必须进两份产物 ──
assert(
  displayInstallCommand(COMMAND, true) === `${REINSTALL_ENV_LINE}\n${COMMAND}`,
  "重装：展示命令要带重装标记（否则用户看不出这条命令会替换证书）",
);

const withToken = copyableInstallCommand(COMMAND, TOKEN, true);
assert(withToken !== undefined, "重装：有命令就应给出可复制内容");
assert(
  withToken!.includes(REINSTALL_ENV_LINE),
  "重装：带 token 的那份必须含重装标记",
);
assert(
  withToken!.includes(`export WARP_INSIGHT_ENROLLMENT_TOKEN=${TOKEN}`),
  "重装：带 token 的那份仍含 token 行",
);
assert(
  withToken!.startsWith(`export WARP_INSIGHT_ENROLLMENT_TOKEN=${TOKEN}\n`),
  "token 行排在最前",
);
assert(
  withToken!.endsWith(`\n${COMMAND}`) || withToken!.endsWith(COMMAND),
  "命令本体在最末，且未被改写",
);
// 导出必须排在命令前面：install.sh 是被 `sh` 当子进程起来的，只能靠**导出的环境变量**传进去。
assert(
  withToken!.indexOf(REINSTALL_ENV_LINE) < withToken!.indexOf(COMMAND),
  "重装标记必须排在命令之前",
);

// 没 token 的重装命令也要能替换证书（页面另给了「复制 Token」，用户可能自己粘）。
assert(
  copyableInstallCommand(COMMAND, undefined, true)?.includes(
    REINSTALL_ENV_LINE,
  ) === true,
  "重装：即使没拼 token，也必须带重装标记",
);

// ── 用途深链：身份面板 → 安装页的「重装（替换证书）」──
// 链接目标必须能解析回重装模式。对不上的话，从证书过期的提示点过去会落在「首次安装」模式，
// 拿到的命令不换证书（而用户以为自己已经按提示做了）。
const linkUrl = new URL(REINSTALL_PAGE_PATH, "https://gw.example.invalid");
assert(
  linkUrl.pathname === "/install",
  `深链必须指向安装页：${linkUrl.pathname}`,
);
assert(
  readInstallMode(linkUrl.searchParams) === "reinstall",
  "深链必须解析回「重装（替换证书）」模式",
);

// 解析口径：没带 / 认不出 / 带了别的参数 → 一律「首次安装」，不猜别的模式。
assert(
  readInstallMode(new URLSearchParams()) === "install",
  "没带参数 → 首次安装",
);
assert(
  readInstallMode(new URLSearchParams("mode=reinstall")) === "reinstall",
  "带了重装取值 → 重装",
);
assert(
  readInstallMode(new URLSearchParams("mode=whatever")) === "install",
  "认不出的取值 → 首次安装（不能落成别的状态）",
);
assert(
  readInstallMode(new URLSearchParams("agent=x")) === "install",
  "别的参数不设用途",
);
assert(
  readInstallMode(new URLSearchParams("mode=batch")) === "batch",
  "批量安装取值 → 批量安装（不能落回首次安装：那样会拿一次性 token 去装第二台）",
);
assert(
  writeInstallMode(new URLSearchParams(), "batch").get("mode") === "batch",
  "切到批量安装要写进 URL",
);

// 写回 URL：切到重装要写进去（刷新/转发不丢），切回安装要清掉，但别人的参数不能碰。
assert(
  writeInstallMode(new URLSearchParams(), "reinstall").get("mode") ===
    "reinstall",
  "切到重装要写进 URL",
);
const cleared = writeInstallMode(
  new URLSearchParams("mode=reinstall&agent=x"),
  "install",
);
assert(cleared.get("mode") === null, "切回首次安装要清掉 mode 参数");
assert(cleared.get("agent") === "x", "切用途不该清掉别的查询参数");

// ── 批量 Token 的倒计时（纯函数口径）──
// 窗口由网关的 `bootstrap_bundle.expires_at` 决定：取不到就不编窗口；过期后不出现负数。
assert(remainingSeconds(undefined) === undefined, "没有到期时间 → 不编窗口");
assert(
  remainingSeconds("not-a-timestamp") === undefined,
  "不可解析 → 不编窗口（不要回落到 60）",
);
assert(
  remainingSeconds(
    "2026-01-01T00:00:10Z",
    Date.parse("2026-01-01T00:00:00Z"),
  ) === 10,
  "Z 形式：整秒差",
);
assert(
  remainingSeconds(
    "2026-01-01T00:00:10+00:00",
    Date.parse("2026-01-01T00:00:00Z"),
  ) === 10,
  "chrono 可能发 +00:00 形式：与 Z 同口径",
);
assert(
  remainingSeconds(
    "2026-01-01T00:00:10Z",
    Date.parse("2026-01-01T00:00:09.600Z"),
  ) === 1,
  "还剩 0.4s 也显示 1s（向上取整，别提前说已过期）",
);
assert(
  remainingSeconds(
    "2026-01-01T00:00:00Z",
    Date.parse("2026-01-01T00:00:00Z"),
  ) === 0,
  "恰好到点 → 0（页面显示已过期）",
);
assert(
  remainingSeconds(
    "2026-01-01T00:00:00Z",
    Date.parse("2026-01-01T00:00:05Z"),
  ) === 0,
  "过了点也不出现负数",
);

// ── 源码守卫（本仓没有组件渲染测试环境，无 jsdom）──
// 钉住「链接与解析同源」与「路由真的存在」：这两件事都在源码里，渲染层测不到。
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceOf = (relative: string) =>
  readFileSync(join(root, relative), "utf8");
assert(
  sourceOf("src/components/SubsystemAgentIdentityPanel.tsx").includes(
    "REINSTALL_PAGE_PATH",
  ),
  "身份面板的重装链接要用 installMode 里的常量，别手写 URL（手写就会与解析口径分开漂）",
);
const installPage = sourceOf("src/components/SubsystemAgentInstallPage.tsx");
assert(
  installPage.includes("readInstallMode") &&
    installPage.includes("writeInstallMode"),
  "安装页的用途要从 URL 读、并写回 URL（只读不写会让刷新丢模式，只写不读会让深链失效）",
);
// 批量 token 只活 5 分钟：页面不能用普通查询自动签发（等用户复制完命令，寿命已经烧掉一半）。
// 真按下去要显式调用生成接口。
assert(
  installPage.includes("useIssueAgentBatchInstallCode"),
  "批量安装页要有一个显式的「生成」入口（POST 签发），不能跟着页面打开就铸 token",
);
assert(
  installPage.includes("useAgentInstallCode(!batch)"),
  "批量模式下不要自动取一次性安装码（enabled=false）",
);
assert(
  installPage.includes("SubsystemAgentInstallPolicyForm"),
  "批量安装策略要能在安装页上改（不能只靠配置文件 + 重启）",
);
assert(
  installPage.includes("useRevokeAgentBatchInstallCode"),
  "批量码要能一键作废（泄露时不必干等窗口到期）",
);
assert(
  sourceOf("src/App.tsx").includes('path="/install"'),
  "深链指向的 /install 路由必须真的存在",
);
assert(
  sourceOf("src/components/SubsystemBootstrapTokenCard.tsx").includes(
    "remainingSeconds",
  ),
  "Token 卡的倒计时要用共享纯函数（组件自己再算一份，早晚与测试口径漂移）",
);

console.log(
  "install command contract: OK (重装标记进两份产物 / 非重装逐字节不变 / 用途深链可解析且指向真实路由)",
);
