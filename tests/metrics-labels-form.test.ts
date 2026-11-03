import { strict as assert } from "node:assert";
import { METRIC_LABEL_KEYS } from "../src/api/admin";
import type { MetricLabelKey } from "../src/api/admin";
import {
  EMPTY_LABEL_DRAFT,
  MAX_LABELS,
  describeLabelSource,
  diffOverrides,
  draftFromOverrides,
  previewLabels,
  validateLabelDraft,
  type LabelDraft,
} from "../src/lib/metricsLabels";

/**
 * 「指标标签」表单的纯逻辑契约。
 *
 * 页面没有 jsdom 测试环境；这里钉住的是**点保存会写出什么**，尤其是
 * `null`（删掉一个覆盖）与「值没变」（不写）的区别 —— 混淆它会给每台机器
 * 凭空写出一堆空覆盖，而空覆盖会盖掉网关的推断值。
 *
 * Usage: npm run test:metrics-labels
 */

function draft(patch: Partial<LabelDraft>): LabelDraft {
  return { ...EMPTY_LABEL_DRAFT, ...patch };
}

// ── ① 草稿装载 ───────────────────────────────────────────────────────────────

assert.deepEqual(
  draftFromOverrides(undefined),
  EMPTY_LABEL_DRAFT,
  "没有覆盖时装成空草稿",
);

assert.deepEqual(
  draftFromOverrides({ app: "kafka", cluster: "kafka-prod" }),
  draft({ app: "kafka", cluster: "kafka-prod" }),
  "覆盖值按 8 个键平铺到草稿",
);

// 后端可能返回闭集外的键（未来扩展）：草稿只保留闭集内的键。
assert.deepEqual(
  Object.keys(draftFromOverrides({ app: "kafka", service: "kafka" })).sort(),
  [...METRIC_LABEL_KEYS].sort(),
  "草稿只包含闭集内的键",
);

// ── ② 逐键差分 ───────────────────────────────────────────────────────────────

assert.deepEqual(
  diffOverrides(EMPTY_LABEL_DRAFT, undefined),
  {},
  "空草稿无改动",
);

assert.deepEqual(
  diffOverrides(draft({ app: "kafka" }), undefined),
  { app: "kafka" },
  "新增覆盖只带这一个键",
);

assert.deepEqual(
  diffOverrides(draft({ app: "kafka" }), { app: "kafka" }),
  {},
  "值没变时不产生写入",
);

assert.deepEqual(
  diffOverrides(EMPTY_LABEL_DRAFT, { app: "kafka" }),
  { app: null },
  "清空输入 = 删除该键的覆盖（null）而不是空串",
);

assert.deepEqual(
  diffOverrides(draft({ cluster: "  kafka-prod  " }), undefined),
  { cluster: "kafka-prod" },
  "提交前去掉首尾空白",
);

assert.deepEqual(
  diffOverrides(draft({ app: "kafka", env: "prod" }), { app: "mysql" }),
  { app: "kafka", env: "prod" },
  "多键改动一并提交",
);

// 删一个键、同时改另一个键：两种意图必须能同时表达。
assert.deepEqual(
  diffOverrides(draft({ app: "kafka" }), { app: "kafka", env: "prod" }),
  { env: null },
  "只删其中一个已有覆盖",
);

// ── ③ 生效值预览 ─────────────────────────────────────────────────────────────

assert.deepEqual(
  previewLabels({ env: "prod", cluster: "kafka-prod" }, { app: "kafka" }),
  { env: "prod", cluster: "kafka-prod", app: "kafka" },
  "预览 = 现有生效值 + 本次改动",
);

assert.deepEqual(
  previewLabels({ env: "prod", app: "kafka" }, { app: null }),
  { env: "prod" },
  "预览里 null 表示删除该键",
);

assert.deepEqual(
  previewLabels(undefined, { app: "kafka" }),
  { app: "kafka" },
  "没有生效值时预览从空开始",
);

// ── ④ 提交前校验 ─────────────────────────────────────────────────────────────

const okValidation = validateLabelDraft(
  draft({ env: "prod", cluster: "kafka-prod" }),
  { env: "prod", cluster: "kafka-prod" },
);
assert.equal(okValidation.ok, true, "env + cluster 是合法组合");
assert.deepEqual(okValidation.fieldErrors, {}, "合法组合没有单键错误");
assert.deepEqual(okValidation.issues, [], "合法组合没有整组问题");

const badEnv = validateLabelDraft(draft({ env: "production" }), {
  env: "production",
});
assert.equal(badEnv.ok, false, "env 不在闭集时必须拦住");
assert.ok(badEnv.fieldErrors.env?.includes("prod"), "env 错误提示里要列出闭集");

const badRole = validateLabelDraft(draft({ app: "kafka", role: "brokers" }), {
  app: "kafka",
  role: "brokers",
});
assert.equal(badRole.ok, false, "role 不在词表时必须拦住");

const goodRole = validateLabelDraft(draft({ app: "kafka", role: "broker" }), {
  app: "kafka",
  role: "broker",
});
assert.equal(goodRole.ok, true, "登记过的 role 词可以通过");

const uppercase = validateLabelDraft(draft({ app: "Kafka" }), { app: "Kafka" });
assert.equal(
  uppercase.ok,
  false,
  "大写值必须拦住（会和 kafka 分裂成两条序列）",
);

const withSpace = validateLabelDraft(draft({ cluster: "kafka prod" }), {
  cluster: "kafka prod",
});
assert.equal(withSpace.ok, false, "含空格的值必须拦住");

const tooLong = validateLabelDraft(draft({ cluster: "a".repeat(33) }), {
  cluster: "a".repeat(33),
});
assert.equal(tooLong.ok, false, "超过 32 字符的值必须拦住");

const justLongEnough = validateLabelDraft(draft({ cluster: "a".repeat(32) }), {
  cluster: "a".repeat(32),
});
assert.equal(justLongEnough.ok, true, "32 字符是上限内的合法值");

// 键组合：role / shard / tier 依赖 app。
const ORPHAN_CASES = [
  ["role", "broker"],
  ["shard", "0"],
  ["tier", "hot"],
] as const;
for (const [key, value] of ORPHAN_CASES) {
  const orphan = validateLabelDraft(draft({ [key]: value }), { [key]: value });
  assert.equal(orphan.ok, false, `没有 app 时 ${key} 必须拦住`);
  assert.equal(
    orphan.fieldErrors[key],
    "需要先设置 app",
    `${key} 的错误提示指向 app`,
  );
}

// app 来自**推断层**（不在草稿里）时同样成立 —— 只看草稿会误报。
assert.equal(
  validateLabelDraft(draft({ role: "broker" }), {
    app: "kafka",
    role: "broker",
  }).ok,
  true,
  "app 由网关推断给出时 role 合法",
);

// 手工删掉 app、但推断层还能给出 app：合并后依然有 app，不该报错。
assert.equal(
  validateLabelDraft(EMPTY_LABEL_DRAFT, { app: "kafka", role: "broker" }).ok,
  true,
  "删掉 app 的手工覆盖但推断层仍有 app 时合法",
);

// 数量上限。
const sixLabels: Record<string, string> = {
  app: "kafka",
  env: "prod",
  cluster: "kafka-prod",
  role: "broker",
  region: "cn-east-1",
  zone: "cn-east-1a",
};
assert.equal(Object.keys(sixLabels).length, MAX_LABELS, "用例本身正好 6 对");
assert.equal(
  validateLabelDraft(draft(sixLabels as Partial<LabelDraft>), sixLabels).ok,
  true,
  "6 对是上限内的合法值",
);

const sevenLabels = { ...sixLabels, shard: "0" };
const sevenValidation = validateLabelDraft(
  draft(sevenLabels as Partial<LabelDraft>),
  sevenLabels,
);
assert.equal(sevenValidation.ok, false, "7 对必须拦住");
assert.equal(
  sevenValidation.issues.length,
  1,
  "超限只报一条整组问题，不逐键报错",
);

// 空草稿 + 空生效值：什么都不改，本身合法（清空全部覆盖后的状态）。
assert.equal(
  validateLabelDraft(EMPTY_LABEL_DRAFT, {}).ok,
  true,
  "空标签集合合法",
);

// ── ⑤ 来源文案 ───────────────────────────────────────────────────────────────

assert.equal(describeLabelSource("manual"), "手工");
assert.equal(describeLabelSource("inferred"), "网关推断");
assert.equal(describeLabelSource("default"), "部署默认");
assert.equal(describeLabelSource(undefined), "未知");
assert.equal(describeLabelSource("future"), "future", "未知来源原样展示");

// ── ⑥ 键闭集完整性 ───────────────────────────────────────────────────────────

assert.equal(
  METRIC_LABEL_KEYS.length,
  Object.keys(EMPTY_LABEL_DRAFT).length,
  "键闭集与草稿字段一一对应",
);
const typedKey: MetricLabelKey = "app";
assert.equal(typedKey, "app", "闭集键类型可用");

console.log(
  "metrics labels form: OK（草稿装载 / 逐键差分 / 生效值预览 / 提交前校验 / 来源文案）",
);
