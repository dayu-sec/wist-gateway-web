import { METRIC_LABEL_KEYS, type MetricLabelKey } from "../api";
import { t } from "../i18n";

/**
 * 选择类 label 的键元信息（规范《指标数据规范 v1》§3.4）。
 *
 * 闭集（`env` / `role` / `tier`）在这里再写一份，是为了在提交前就拦住「一定被网关拒收」
 * 的值 —— 网关仍是唯一权威，这里只是让运维少走一趟 400。两边漂移的后果是
 * 「页面放行、网关拒收」，比多问一次更难查。
 *
 * 是**函数**而不是模块级常量：`t()` 必须在渲染期求值，否则切语言时这些提示不会变。
 */
export interface LabelKeyMeta {
  hint: string;
  /** 有闭集的键给下拉框；没有的给自由输入。 */
  choices?: readonly string[];
}

export const ENV_CHOICES = ["prod", "staging", "dev", "test"] as const;
export const TIER_CHOICES = ["hot", "warm", "cold"] as const;
export const ROLE_CHOICES = [
  "arbiter",
  "broker",
  "config",
  "control-plane",
  "controller",
  "coordinator",
  "data",
  "ingest",
  "keeper",
  "learner",
  "mongos",
  "observer",
  "pd",
  "primary",
  "proxy",
  "replica",
  "sentinel",
  "tidb",
  "tikv",
  "worker",
] as const;

export function labelKeyMeta(): Record<MetricLabelKey, LabelKeyMeta> {
  return {
    app: {
      hint: t(
        "该主机承载的应用。取值必须命中网关的 app 注册表；role / shard / tier 都依赖它。",
        "The application this host runs. The value must exist in the gateway app registry; role / shard / tier depend on it.",
      ),
    },
    env: {
      hint: t(
        "环境轴。聚合同一环境的机器时按它分组。",
        "Environment axis; grouping by it aggregates machines of the same environment.",
      ),
      choices: ENV_CHOICES,
    },
    cluster: {
      hint: t(
        "业务集群名。多机成套时填同一个值，一条查询就能取到整组。",
        "Business cluster name. Use the same value on every machine of a set so one query returns the whole group.",
      ),
    },
    role: {
      hint: t(
        "该机在集群里的角色。必须先有 app。",
        "This machine's role in the cluster. Requires app.",
      ),
      choices: ROLE_CHOICES,
    },
    shard: {
      hint: t(
        "分片 / 分区标识。必须先有 app。",
        "Shard / partition identifier. Requires app.",
      ),
    },
    tier: {
      hint: t(
        "数据温度层。必须先有 app。",
        "Data temperature tier. Requires app.",
      ),
      choices: TIER_CHOICES,
    },
    region: {
      hint: t("地域，例如 cn-east-1。", "Region, e.g. cn-east-1."),
    },
    zone: {
      hint: t("可用区，例如 cn-east-1a。", "Zone, e.g. cn-east-1a."),
    },
  };
}

/** 与网关一致的上限：一条序列最多 6 对选择类 label。 */
export const MAX_LABELS = 6;

/** 值文法：小写字母 / 数字 / `-` / `_` / `.`，1–32 字符。 */
const VALUE_PATTERN = /^[a-z0-9._-]{1,32}$/;

/** 没有 `app` 就不允许出现的键（网关侧原因码 `metric_label_requires_app`）。 */
export const REQUIRES_APP: MetricLabelKey[] = ["role", "shard", "tier"];

export type LabelDraft = Record<MetricLabelKey, string>;

export const EMPTY_LABEL_DRAFT: LabelDraft = {
  app: "",
  env: "",
  cluster: "",
  role: "",
  shard: "",
  tier: "",
  region: "",
  zone: "",
};

/** 把手覆盖值装成表单草稿：留空表示「该键没有手工覆盖」。 */
export function draftFromOverrides(
  overrides?: Record<string, string>,
): LabelDraft {
  const draft: LabelDraft = { ...EMPTY_LABEL_DRAFT };
  for (const key of METRIC_LABEL_KEYS) {
    const value = overrides?.[key];
    draft[key] = typeof value === "string" ? value : "";
  }
  return draft;
}

/**
 * 草稿与现有覆盖的差分。
 *
 * `null` 表示「删掉该键的手工覆盖」—— 与「值没变」（不出现）是两件事：
 * 前者要写一条空覆盖，后者什么都不该发。
 */
export function diffOverrides(
  draft: LabelDraft,
  overrides?: Record<string, string>,
): Partial<Record<MetricLabelKey, string | null>> {
  const changes: Partial<Record<MetricLabelKey, string | null>> = {};
  for (const key of METRIC_LABEL_KEYS) {
    const value = draft[key].trim();
    const previous = overrides?.[key] ?? "";
    if (value === previous) continue;
    changes[key] = value === "" ? null : value;
  }
  return changes;
}

/** 把差分套到生效值上，得到「提交后会生效的整组 label」。 */
export function previewLabels(
  labels: Record<string, string> | undefined,
  changes: Partial<Record<MetricLabelKey, string | null>>,
): Record<string, string> {
  const merged: Record<string, string> = { ...(labels ?? {}) };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete merged[key];
    else if (typeof value === "string") merged[key] = value;
  }
  return merged;
}

export interface LabelValidation {
  /** 单键错误（展示在对应输入框下）。 */
  fieldErrors: Partial<Record<MetricLabelKey, string>>;
  /** 整组约束（数量上限），展示在表单底部。 */
  issues: string[];
  ok: boolean;
}

/**
 * 提交前校验。
 *
 * 键组合（`role` / `shard` / `tier` 依赖 `app`）判的是 `preview` —— 合并后的生效值，
 * 而不是只看本次改动的键：手工删掉 `app`、而网关仍能推断出 `app` 时，那组值其实合法，
 * 只看草稿会误报 `metric_label_requires_app`。
 */
export function validateLabelDraft(
  draft: LabelDraft,
  preview: Record<string, string>,
): LabelValidation {
  const meta = labelKeyMeta();
  const fieldErrors: Partial<Record<MetricLabelKey, string>> = {};
  for (const key of METRIC_LABEL_KEYS) {
    const value = draft[key].trim();
    if (!value) continue;
    if (!VALUE_PATTERN.test(value)) {
      fieldErrors[key] = t(
        "只允许小写字母 / 数字 / - / _ / .，且不超过 32 字符",
        "Only lowercase letters, digits, - , _ and . are allowed; 32 characters max",
      );
      continue;
    }
    const choices = meta[key].choices;
    if (choices && !choices.includes(value)) {
      fieldErrors[key] = t("只允许：{choices}", "Allowed values: {choices}", {
        choices: choices.join(" / "),
      });
    }
  }

  const issues: string[] = [];
  if (Object.keys(preview).length > MAX_LABELS) {
    issues.push(
      t("生效的 label 最多 {max} 对", "At most {max} labels can be in effect", {
        max: MAX_LABELS,
      }),
    );
  }

  if (!preview.app) {
    for (const key of REQUIRES_APP) {
      if (preview[key] || draft[key].trim()) {
        fieldErrors[key] ??= t("需要先设置 app", "Requires app first");
      }
    }
  }

  return {
    fieldErrors,
    issues,
    ok: Object.keys(fieldErrors).length === 0 && issues.length === 0,
  };
}

/** 来源键的展示文案。 */
export function describeLabelSource(source: string | undefined): string {
  switch (source) {
    case "manual":
      return t("手工", "Manual");
    case "inferred":
      return t("网关推断", "Inferred");
    case "default":
      return t("部署默认", "Deploy default");
    case undefined:
    case "":
      return t("未知", "Unknown");
    default:
      return source;
  }
}
