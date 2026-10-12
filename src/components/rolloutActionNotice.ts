/**
 * 升级计划详情页「操作成功」提示条里，按动作选动词。
 *
 * `useRolloutPlanAction` 有三种动作：`approve` / `advance` / `retry`。提示条原先是二选一
 * （`kind === "approve" ? "批准" : "推进"`）—— 于是**重试**被显示成「已推进」，与刚做的事不符。
 * 抽成纯函数钉在测试里，免得再被这种「只认两种」的条件漏掉第三种。
 *
 * 文案在**调用那一刻**取（`t()`）：本函数在渲染期被调用，切语言会重新求值。
 */
import { t } from "../i18n";

export type RolloutActionKind = "approve" | "advance" | "retry";

/** 动作在提示条里的说法；认不出的（理论上不会发生）退化为中性的「操作」。 */
export function rolloutActionLabel(kind: RolloutActionKind | undefined): string {
  switch (kind) {
    case "approve":
      return t("批准", "Approved");
    case "advance":
      return t("推进", "Advanced");
    case "retry":
      return t("重试失败项", "Retried failed items");
    default:
      return t("操作", "Action");
  }
}
