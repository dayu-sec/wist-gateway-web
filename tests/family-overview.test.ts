import {
  buildFamilyOverview,
  familyFilterCounts,
  filterFamilyOverview,
} from "../src/components/familyOverviewRows";
import type {
  ContentCatalogView,
  ContentFamilyView,
  ContentTemplateView,
  ContentUnitView,
  FamilyReadinessView,
  MachineClass,
} from "../src/types/views";

// 契约测试：采集面全景的**派生规则**。
//
// 这一页最容易出错的地方是把三件事混成一个状态：
//   - 面已定义但**没有单元**（unconfigured）—— 不是「0 个单元已就绪」；
//   - 有单元但**没有一个 active**（draft）—— 还不能派；
//   - 至少一个 active（ready）—— 能派。
// 另外 `readiness` 只含有单元的面，缺行必须按「未建单元」算，不能当成 0/0 已就绪。
//
// Usage: npm run test:family-overview

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function family(id: string, platforms: string[]): ContentFamilyView {
  return {
    id,
    platforms,
    semanticsVersion: 0,
    nameZh: id,
    nameEn: id,
    summaryZh: "",
    summaryEn: "",
  };
}

function template(
  templateId: string,
  machineClass: MachineClass,
  platform: string,
  familyScope: string[],
): ContentTemplateView {
  return {
    templateId,
    machineClass,
    platform,
    status: "active",
    familyScope,
    capabilityScope: [],
  };
}

function readiness(
  familyId: string,
  platform: string,
  activeUnits: number,
  parseReadyUnits: number,
  totalUnits: number,
): FamilyReadinessView {
  return {
    family: familyId,
    platform,
    activeUnits,
    parseReadyUnits,
    totalUnits,
    ready: activeUnits > 0,
    parseReady: parseReadyUnits > 0,
  };
}

function unit(
  unitId: string,
  familyId: string,
  platform: string,
  options: {
    capability?: string;
    match?: string;
    ruleRef?: string;
    privilege?: string;
    status?: string;
    executable?: boolean;
    target?: string;
  } = {},
): ContentUnitView {
  const executable = options.executable ?? true;
  return {
    unitId,
    family: familyId,
    platform,
    capability: options.capability ?? "collect_logs",
    match: options.match ?? "",
    ruleRef: options.ruleRef ?? "",
    requiresPrivilege: options.privilege ?? "none",
    status: options.status ?? "active",
    collectReady: (options.status ?? "active") === "active",
    parseReady: (options.ruleRef ?? "").length > 0,
    executable,
    sources: [
      {
        kind: "FileGlob",
        target: options.target ?? `/var/log/${unitId}.log`,
        multiline: "none",
        executable,
      },
    ],
  };
}

const catalog: ContentCatalogView = {
  catalogVersion: 6,
  supersededBy: null,
  families: [
    family("LoginSession", []),
    family("KernelSystem", ["linux"]),
    family("ContainerRuntime", ["linux"]),
    family("CrashPanic", []),
  ],
  templates: [
    template("macos-daily", "MacDaily", "macos", ["LoginSession", "CrashPanic"]),
    template("linux-host", "LinuxHost", "linux", [
      "LoginSession",
      "KernelSystem",
      "ContainerRuntime",
    ]),
    template("linux-data", "LinuxData", "linux", ["LoginSession", "KernelSystem"]),
  ],
  readiness: [
    readiness("LoginSession", "linux", 0, 0, 2),
    readiness("LoginSession", "macos", 1, 1, 1),
    readiness("KernelSystem", "linux", 1, 0, 3),
    readiness("CrashPanic", "macos", 0, 0, 1),
    // ContainerRuntime: 词表里有，但任何平台都没有单元。
  ],
  units: [
    unit("mac-login", "LoginSession", "macos", {
      ruleRef: "macos/login",
      status: "active",
    }),
    unit("linux-login", "LoginSession", "linux", {
      status: "draft",
      executable: false,
      target: "journalctl-unit:systemd-logind",
    }),
    unit("linux-kernel", "KernelSystem", "linux", {
      match: "installed:rsyslog",
      privilege: "root",
      status: "active",
    }),
    unit("mac-crash", "CrashPanic", "macos", { status: "draft" }),
  ],
};

const rows = buildFamilyOverview(catalog);
const byId = new Map(rows.map((row) => [row.family.id, row]));

assert(rows.length === 4, "一行一面");
assert(
  rows.map((row) => row.family.id).join(",") ===
    "LoginSession,KernelSystem,ContainerRuntime,CrashPanic",
  "顺序跟词表一致",
);

const login = byId.get("LoginSession")!;
assert(login.state === "ready", "至少一个 active = ready");
assert(login.activeUnits === 1, "active 跨平台合计");
assert(login.totalUnits === 3, "total 跨平台合计");
assert(login.parseReadyUnits === 1, "解析就绪独立统计");
assert(
  login.perPlatform.map((entry) => entry.platform).join(",") === "linux,macos",
  "按平台明细要排序",
);
assert(login.family.platforms.length === 0, "全平台保持空数组，不展开");

const kernel = byId.get("KernelSystem")!;
assert(kernel.state === "ready", "KernelSystem 有 active");
assert(kernel.parseReadyUnits === 0, "采得到不代表解析得动");

const crash = byId.get("CrashPanic")!;
assert(crash.state === "draft", "有单元但没 active = draft");
assert(crash.activeUnits === 0 && crash.totalUnits === 1, "draft 的计数也要准");

const container = byId.get("ContainerRuntime")!;
assert(
  container.state === "unconfigured",
  "词表里有、readiness 里没有 = 未建单元（不是 0/0 已就绪）",
);
assert(container.perPlatform.length === 0, "没有单元的平台上没有明细");
assert(container.totalUnits === 0, "未建单元的计数为 0");

// 覆盖机型：来自模板的 family_scope，去重且按模板顺序。
assert(
  login.machineClasses.join(",") === "MacDaily,LinuxHost,LinuxData",
  "覆盖机型去重并按模板顺序",
);
assert(
  kernel.machineClasses.join(",") === "LinuxHost,LinuxData",
  "同一平台多类机器都要列出来",
);
assert(
  container.machineClasses.join(",") === "LinuxHost",
  "未建单元的面也可能被模板声明覆盖",
);
assert(crash.machineClasses.join(",") === "MacDaily", "只列真正声明它的模板");

// 展开明细：单元按 `family` 分组，没单元的而为空（不是「0 个单元已就绪」）。
assert(login.units.length === 2, "LoginSession 两个单元");
assert(
  login.units.map((entry) => entry.unitId).join(",") === "mac-login,linux-login",
  "单元顺序跟目录一致",
);
assert(login.units[1].executable === false, "来源不可执行要如实传出来");
assert(login.units[1].sources[0].executable === false, "来源级也要标");
assert(kernel.units[0].match === "installed:rsyslog", "采集前提原样保留");
assert(kernel.units[0].requiresPrivilege === "root", "权限原样保留");
assert(crash.units.length === 1, "CrashPanic 一个单元");
assert(container.units.length === 0, "未建单元的面没有任何单元");

const counts = familyFilterCounts(rows);
assert(counts.all === 4, "全部计数");
assert(counts.ready === 2, "已就绪计数");
assert(counts.unready === 1, "未就绪计数");
assert(counts.unconfigured === 1, "未建单元计数");

assert(filterFamilyOverview(rows, "all").length === 4, "all 不筛");
assert(
  filterFamilyOverview(rows, "ready").map((row) => row.family.id).join(",") ===
    "LoginSession,KernelSystem",
  "ready 只留已就绪",
);
assert(
  filterFamilyOverview(rows, "unready").map((row) => row.family.id).join(",") ===
    "CrashPanic",
  "unready 只留有单元未就绪",
);
assert(
  filterFamilyOverview(rows, "unconfigured")
    .map((row) => row.family.id)
    .join(",") === "ContainerRuntime",
  "unconfigured 只留未建单元",
);

// 没有内容 / 没有词表：空表，而不是崩。
assert(buildFamilyOverview(null).length === 0, "null catalog → 空");
assert(
  buildFamilyOverview({ ...catalog, families: [] }).length === 0,
  "没有词表 → 空",
);
assert(
  buildFamilyOverview({ ...catalog, readiness: [] }).every(
    (row) => row.state === "unconfigured",
  ),
  "没有 readiness → 全部按未建单元",
);

console.log("family overview: OK (三态 / 跨平台合计 / 模板覆盖 / 筛选)");
