import type { CompatReport, CompatStatus } from "../api/admin";
import { t } from "../i18n";

/**
 * 兼容性展示的**纯逻辑**（无 JSX / 无 CSS），给 `Compatibility.tsx` 与契约测试共用。
 *
 * 口径与后端 `wist_release::compat::check` 一致：只有 `requires` 被明确违反才是
 * `error`（红）；`supports` 越界 / 对端版本未知是 `warn`（黄）；包内没有声明是
 * `unknown`（灰）—— **“没声明”不是“兼容”**，所以绝不能显示成绿色。
 *
 * 注意：这里的 `t()` 必须在**渲染期**调用（本模块的函数都在组件体内被调用），
 * 不要在模块顶层求值成常量表。
 */

export type CompatTone = "ok" | "warn" | "crit" | "unknown";

export function compatTone(status: CompatStatus): CompatTone {
  switch (status) {
    case "ok":
      return "ok";
    case "warn":
      return "warn";
    case "error":
      return "crit";
    default:
      return "unknown";
  }
}

export function compatLabel(status: CompatStatus): string {
  switch (status) {
    case "ok":
      return t("兼容", "Compatible");
    case "warn":
      return t("有告警", "Warnings");
    case "error":
      return t("不兼容", "Incompatible");
    default:
      return t("未验证", "Unverified");
  }
}

/** 报告 → 一句话摘要（列表行上显示；详情里还有逐条原因）。 */
export function compatSummary(report: CompatReport | null): string {
  if (!report) return t("未检查", "Not checked");
  const findings = report.checks.filter((check) => check.severity !== "ok");
  switch (report.status) {
    case "ok":
      return t("范围都满足", "All ranges satisfied");
    case "warn":
      return findings.length > 0
        ? t("{n} 项告警", "{n} warning(s)", { n: findings.length })
        : t("有告警", "Warnings");
    case "error":
      return findings.length > 0
        ? t("{n} 项不兼容", "{n} incompatible", { n: findings.length })
        : t("不兼容", "Incompatible");
    default:
      return t("包内未声明兼容范围", "No compatibility ranges declared");
  }
}

/** 严重级别 → 文案。 */
export function compatSeverityLabel(severity: string): string {
  switch (severity) {
    case "ok":
      return t("通过", "OK");
    case "warn":
      return t("告警", "Warn");
    case "error":
      return t("阻断", "Block");
    default:
      return severity;
  }
}

/**
 * 报告里声明的范围（`checks[].required` 按 peer 归并）。
 *
 * 网关侧拿到的是**检查结果**（包里 `compat.json` 已随包解析过，但接口只回报告），
 * 所以“声明的范围”从报告里取 —— 与后端检查用的是同一份数据，不会两处漂移。
 */
export function compatDeclaredRanges(
  report: CompatReport | null,
): { peer: string; required: string }[] {
  if (!report) return [];
  const seen = new Set<string>();
  const rows: { peer: string; required: string }[] = [];
  for (const check of report.checks) {
    if (!check.peer || check.peer === "*") continue;
    const key = `${check.peer}|${check.required}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ peer: check.peer, required: check.required });
  }
  return rows;
}
