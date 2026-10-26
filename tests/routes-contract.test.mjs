// 路由与网关信息页的**源码守卫**：本仓没有组件渲染测试环境（无 jsdom），所以用读源码的方式
// 钉住两条容易在后续改动里被无声弄坏的决定：
//   1. `/control`（Agent 控制中心）已删 —— 路由、导航、面包屑都不该再提它；
//   2. 「网关信息」页的分界线：**对外地址只读**（由部署配置决定），**上送目标与启用开关可写**
//      （新装机没有生效工作，没这个开关就永远待命）。见 `docs/design/agent-uplink-enablement.md` §4.1。
// 参考范式：`tests/admin-token-bundle.test.mjs`（纯 node 脚本，失败即非零退出）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

const app = read("src/App.tsx");
const nav = read("src/components/SubsystemAdminTopNavigation.tsx");
const statusBar = read("src/components/AppStatusBar.tsx");
const infoPage = read("src/components/SubsystemGatewayInfoPage.tsx");
const readme = read("README.md");

// ── ① `/control` 已删 ────────────────────────────────────────────────────────
check(
  !app.includes('path="/control"'),
  "App.tsx 仍在注册 /control 路由（该页已删；未知路径由 `*` 兜底回首页）",
);
check(
  !nav.includes("/control"),
  "侧边栏仍在链接 /control（该页已删）",
);
check(
  !statusBar.includes('case "/control"'),
  "面包屑仍在描述 /control（该页已删）",
);
check(!readme.includes("`/control`"), "README 路由表仍有 /control");
check(
  !app.includes("SubsystemAgentControlCenterPage"),
  "App.tsx 仍在导入已删的控制中心页面组件",
);

// ── ② `/gateway-info` 落地，旧路名保留重定向 ──────────────────────────────────
check(
  app.includes('path="/gateway-info"') &&
    app.includes("<SubsystemGatewayInfoPage />"),
  "App.tsx 未把 /gateway-info 挂到 SubsystemGatewayInfoPage",
);
for (const legacy of ["/gateway-init", "/uplink", "/agent-init"]) {
  check(
    new RegExp(
      `path="${legacy}"[^>]*Navigate to="/gateway-info"`,
      "s",
    ).test(app),
    `${legacy} 应保留到 /gateway-info 的重定向（旧书签/外链不失效）`,
  );
}
check(
  nav.includes('to: "/gateway-info"'),
  "侧边栏未指向 /gateway-info",
);
check(
  statusBar.includes('case "/gateway-info"'),
  "面包屑缺少 /gateway-info 的 case（会显示「未知页面」）",
);

// ── ③ 网关信息页：对外地址**只读**，上送目标 + 开关**可写** ──────────────────
//
// 分界线是刻意的（`docs/design/agent-uplink-enablement.md` §4.1）：
//   · 对外地址由部署配置决定（改它要换域名/证书），管理面没有录入的必要；
//   · 上送目标与「启用开关」必须在管理面可改 —— 新装机没有生效工作，
//     没有这个开关就永远待命（注册成功却什么也干不了）。
check(
  infoPage.includes("useSetAgentUplink"),
  "网关信息页缺少上送开关的写接口 hook（新装机将无入口可启用上送）",
);
check(
  !infoPage.includes("useSetAgentAdvertiseUrl"),
  "网关信息页引用了对外地址的写接口 hook（那一项只读，由部署配置决定）",
);
// 表单只能长在**上送**那张卡里。只查 hook 名不够：后来人抄一份表单到对外地址那张卡、
// 直接调 `setAgentAdvertiseUrl(...)`（绕开 hook）时，上面两条都不会响。
const firstFormIndex = infoPage.indexOf("<form");
const uplinkCardIndex = infoPage.indexOf("gateway-info-uplink");
check(
  firstFormIndex !== -1 && uplinkCardIndex !== -1 && firstFormIndex > uplinkCardIndex,
  "网关信息页的表单必须落在上送那张卡里（对外地址那张只读）",
);

// ── ④ 页面名与组件名一起归位（别再出现旧页名）────────────────────────────────
check(
  infoPage.includes("Gateway 信息"),
  "网关信息页缺少页名「Gateway 信息」",
);
check(
  !readme.includes("/gateway-init` | Gateway 初始化"),
  "README 路由表仍把 /gateway-init 写成当前路由",
);

// ── ⑤ `/knowledge`（知识库）落地：路由 / 导航 / 面包屑 / README 四处一致 ────────
// 这四处任缺一处，知识库就会变成「有接口但没入口」，而那正是它当初被提出来的原因。
check(
  app.includes('path="/knowledge"') &&
    app.includes("<SubsystemKnowledgePage />"),
  "App.tsx 未把 /knowledge 挂到 SubsystemKnowledgePage",
);
check(
  nav.includes('to: "/knowledge"'),
  "侧边栏未指向 /knowledge（知识库就没有入口了）",
);
check(
  statusBar.includes('case "/knowledge"'),
  "面包屑缺少 /knowledge 的 case（会显示「未知页面」）",
);
check(
  readme.includes("`/knowledge`"),
  "README 路由表缺少 /knowledge",
);

// ── ⑤b 采集授权：从「面」出发的批量授权入口，四处都要一致 ───────────────────
check(
  app.includes('path="/collection-grants"') &&
    app.includes("<SubsystemCollectionGrantPage />"),
  "App.tsx 未把 /collection-grants 挂到 SubsystemCollectionGrantPage",
);
check(
  nav.includes('to: "/collection-grants"'),
  "侧边栏未指向 /collection-grants（按采集面授权就没有入口）",
);
check(
  readme.includes("`/collection-grants`"),
  "README 路由表缺少 /collection-grants",
);

// ── ⑥ 侧边栏每一项都要有面包屑：漏一条就落到 default 的「未知页面」 ─────────────
// 之前是逐条手写 check（/gateway-info、/knowledge 各一条），新加页面时照样会漏 ——
// /gwlinkd、/revocations 就是这样在状态条上写着「监控 / 未知页面」的。这里改成从导航
// 源码里取全部 `to:` 反查：以后新增页面，只要忘了在 AppStatusBar 里补 case 就会失败。
const navRoutes = [...nav.matchAll(/to: "(\/[^"]*)"/g)].map((match) => match[1]);
check(navRoutes.length >= 10, "没能从侧边栏源码里解析出导航项（正则可能已与 JSX 写法漂移）");
for (const route of navRoutes) {
  const casePath = route === "/" ? 'case "/"' : `case "${route}"`;
  check(
    statusBar.includes(casePath),
    `面包屑缺少 ${route} 的 case（会显示「未知页面」）`,
  );
}
// 分组也要对：面包屑的首段来自 section，写错分组时页面标题对、归属却错了。
// 「观测看监控、对机队动手归运维、网关自身配置归设置」—— 2026-10-25 的菜单调整：
// gwlinkd 状态挪进监控；安装 Agent / 安装包 / 知识库挪进运维。
check(
  /case "\/gwlinkd":[\s\S]{0,160}?section: "monitoring"/.test(statusBar),
  "/gwlinkd 应归「监控」组（侧边栏把它放在监控组，面包屑不能还写设置）",
);
check(
  /case "\/revocations":[\s\S]{0,160}?section: "ops"/.test(statusBar),
  "/revocations 应归「运维」组",
);
for (const route of ["/install", "/install-package", "/knowledge"]) {
  check(
    new RegExp(`case "${route}":[\\s\\S]{0,200}?section: "ops"`).test(statusBar),
    `${route} 应归「运维」组（与侧边栏一致）`,
  );
}

if (failures.length > 0) {
  for (const message of failures) console.error(`FAIL: ${message}`);
  process.exit(1);
}
console.log("routes contract test passed");
