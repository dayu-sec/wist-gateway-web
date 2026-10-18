import { setLocale } from "@dayu-sec/wist-web-core/i18n";
import { normalizeContentCatalog } from "../src/api/admin";
import {
  collectionFamilyName,
  collectionFamilySummary,
  indexCollectionFamilies,
} from "../src/components/collectionFamilyText";

// 契约测试：面名与说明来自**知识库**（网关 `GET /api/v1/admin/content` 的 `families`），
// 不是前端硬编码 —— 新增面不发前端。这里钉三件事：
//   1. 网关的 snake_case 载荷能归一化，且旧网关（不返回 `families`）不崩；
//   2. 按 ID 查；缺项回落成面 ID，且**不编造**说明；
//   3. 中英双语跟着界面语言走。
//
// Usage: npm run test:family-text

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const payload = {
  catalog_version: 6,
  superseded_by: null,
  families: [
    {
      id: "LoginSession",
      platforms: [],
      semantics_version: 0,
      name_zh: "登录会话",
      name_en: "Login sessions",
      summary_zh: "登录、退出与会话，含认证事件。",
      summary_en: "Logins, logouts, and sessions.",
    },
    {
      // 中文缺失：应当回落英文，而不是显示空白。
      id: "KernelSystem",
      platforms: ["linux"],
      semantics_version: 0,
      name_zh: "",
      name_en: "Kernel & system logs",
      summary_zh: "",
      summary_en: "Kernel logs.",
    },
  ],
  templates: [],
  readiness: [],
  units: [
    {
      unit_id: "linux-kernel",
      family: "KernelSystem",
      platform: "linux",
      capability: "collect_logs",
      match: "installed:rsyslog",
      rule_ref: "",
      requires_privilege: "root",
      status: "active",
      collect_ready: true,
      parse_ready: false,
      executable: true,
      sources: [
        {
          kind: "FileGlob",
          target: "/var/log/kern.log",
          multiline: "none",
          executable: true,
        },
        {
          kind: "Exporter",
          target: "dmesg:panic",
          multiline: "none",
          executable: false,
        },
      ],
    },
  ],
};

const catalog = normalizeContentCatalog(payload);
assert(catalog.families.length === 2, "families 要归一化出来");
assert(catalog.families[1].platforms[0] === "linux", "platforms 原样透传");
assert(catalog.families[0].nameZh === "登录会话", "name_zh → nameZh");

// 旧网关：没有 families 字段 → 空数组（页面回落成面 ID，而不是崩）。
const old = normalizeContentCatalog({ ...payload, families: undefined, units: undefined });
assert(old.families.length === 0, "旧网关缺 families 时要补空数组");
assert(old.units.length === 0, "旧网关缺 units 时要补空数组");

// 单元明细：snake_case → camelCase，`match` 原样保留（它是 JSON 关键字，不是重命名）。
assert(catalog.units.length === 1, "units 要归一化出来");
assert(catalog.units[0].match === "installed:rsyslog", "match 原样透传");
assert(catalog.units[0].collectReady === true, "collect_ready → collectReady");
assert(catalog.units[0].parseReady === false, "parse_ready → parseReady");
assert(
  catalog.units[0].sources[1].executable === false,
  "来源级可执行标志要传下来",
);

const index = indexCollectionFamilies(catalog.families);

setLocale("zh");
assert(collectionFamilyName("LoginSession", index) === "登录会话", "zh 取中文名");
assert(
  collectionFamilySummary("LoginSession", index) === "登录、退出与会话，含认证事件。",
  "zh 取中文说明",
);
assert(
  collectionFamilyName("KernelSystem", index) === "Kernel & system logs",
  "中文缺失时回落英文",
);

setLocale("en");
assert(collectionFamilyName("LoginSession", index) === "Login sessions", "en 取英文名");
assert(
  collectionFamilySummary("LoginSession", index) === "Logins, logouts, and sessions.",
  "en 取英文说明",
);

// 缺项：面 ID 照常可读，说明不编造。
assert(
  collectionFamilyName("UnknownFamily", index) === "UnknownFamily",
  "未知面回落成面 ID",
);
assert(collectionFamilySummary("UnknownFamily", index) === null, "未知面不编造说明");
assert(
  collectionFamilyName("LoginSession", indexCollectionFamilies(null)) === "LoginSession",
  "没有词表时回落成面 ID",
);

// 面 ID 是协议值：大小写敏感，不能「模糊匹配」到同一条。
assert(
  collectionFamilyName("loginsession", index) === "loginsession",
  "面 ID 大小写敏感",
);

// 两语都空 = 只有 ID 可读；不编造名称与说明。
const bare = indexCollectionFamilies([
  {
    id: "Bare",
    platforms: [],
    semanticsVersion: 0,
    nameZh: "",
    nameEn: "",
    summaryZh: "",
    summaryEn: "",
  },
]);
assert(collectionFamilyName("Bare", bare) === "Bare", "两语都空时回落面 ID");
assert(collectionFamilySummary("Bare", bare) === null, "两语都空时不编造说明");

// 全平台 = 空数组（原样透传，不补成 ["macos","linux"]）。
assert(
  catalog.families[0].platforms.length === 0,
  "全平台的 platforms 应为空数组",
);

// 载荷形状不对（families 不是数组）必须报错，不能静默当空词表。
let threw = false;
try {
  normalizeContentCatalog({ ...payload, families: "LoginSession" });
} catch {
  threw = true;
}
assert(threw, "families 形状不对时必须报错");

setLocale("zh");
console.log("collection family text: OK (知识库词表 / 旧网关兼容 / 回落 / 双语)");
