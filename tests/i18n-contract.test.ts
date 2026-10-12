import { pickLabel, setLocale } from "@dayu-sec/wist-web-core/i18n";
import { planStatusLabel } from "@dayu-sec/wist-web-core/release";
import { t } from "../src/i18n";

// 契约测试：双语取词的最小不变量。
//
// 这套东西最容易坏在两个地方，且都**不会**被 tsc 发现：
//   1. 默认语言被改坏 —— 全站（含本仓所有契约测试断言的 zh 文案）会一起变；
//   2. `t()` 在**模块顶层**求值 —— 切语言时那句文案不会变（本仓约定：渲染期求值）。
// 这里只钉「取词本身」；「有没有把某句文案包进 t()」由人工/审计脚本管（见 README 的 i18n 节）。
//
// Usage: npm run test:i18n

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

// 默认 zh：不设置语言时，`t()` 必须逐字返回中文原文 —— 老测试与老界面据此不受影响。
assert(t("已接入", "Enrolled") === "已接入", "默认必须是中文原文");
assert(pickLabel("中文", "English") === "中文", "共享包默认也是中文");
assert(planStatusLabel("rolling") === "灰度中", "共享口径默认中文");

// en：两处取词一起切（app 的 t() 与共享包的 xxxLabel()）。
setLocale("en");
assert(t("已接入", "Enrolled") === "Enrolled", "en 下取英文");
assert(t("已选 {n} 台", "{n} selected", { n: 3 }) === "3 selected", "占位符要替换");
assert(t("已接入", "Enrolled") === pickLabel("已接入", "Enrolled"), "t 与共享 pickLabel 同源");
assert(planStatusLabel("rolling") === "Rolling out", "共享口径跟着切英文");

// 占位符缺值 → 原样留着（不写 undefined），两种语言一致。
setLocale("zh");
assert(t("共 {n} 条", "{n} total") === "共 {n} 条", "没给 params 时占位符原样保留");
setLocale("en");
assert(t("共 {n} 条", "{n} total") === "{n} total", "同上（en）");

// 回头切中文要能切回来（开关是双向的）。
setLocale("zh");
assert(t("已接入", "Enrolled") === "已接入", "能切回中文");

// 认不出的语言忽略（不把界面切成空白）。
setLocale("fr");
assert(t("已接入", "Enrolled") === "已接入", "认不出的语言保持原语言");

console.log("i18n contract: OK (默认 zh / 双向切换 / 占位符 / 与共享口径同源)");
