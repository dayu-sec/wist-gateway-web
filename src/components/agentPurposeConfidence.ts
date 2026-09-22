/**
 * 「网关用途建议」的结论强度分档。
 *
 * 抽成不依赖 React / CSS 的纯模块，契约测试可以直接断言分档结果 ——
 * `confidence` 是后端算出来的数字，但**怎么读这个数字**很容易漂移。
 *
 * 后端 `confidence = 100 ×（最高分 − 次高分）/ 最高分`，总分低于规则册的
 * `weak_score` 再打对折。于是 **0 不是一种状态，而是两种**：
 *   - 最高分与次高分**并列**（例如 macOS 命中 `/Safari.app` 与 `/Mail.app`
 *     合计 20 分，`node_modules` 的 MacDev 也是 20 分）→ `tie`：
 *     有逐条命中依据，但得分没有拉开，无法区分；
 *   - **没有任何有效规则命中** → `baseline`：没有逐条依据，如果该平台规则册
 *     配了 `baseline_class` 就兜底给基线类别，没配就不产出建议。
 *
 * 把两者都写成「无有效依据 / 没有命中任何规则」会与面板下方列出的命中依据
 * 自相矛盾（Linux 规则册根本没有基线类别，那段文案对 Linux 也不成立）。
 */
export type ConfidenceTone = "baseline" | "tie" | "weak" | "fair" | "strong";

/**
 * 分档：`confidence <= 0` 时用**逐条依据条数**区分「并列」与「无依据」，
 * 而不是一律压成基线档。
 */
export function confidenceTone(
  confidence: number,
  signalCount: number,
): ConfidenceTone {
  // 非有限值只可能来自契约漂移，按「没有依据」处理；
  // 负值（公式理论上夹在 0..100，防一手）同样按 0 处理。
  if (!Number.isFinite(confidence) || confidence <= 0) {
    return signalCount > 0 ? "tie" : "baseline";
  }
  if (confidence < 50) return "weak";
  if (confidence < 80) return "fair";
  return "strong";
}

export const CONFIDENCE_LABEL: Record<ConfidenceTone, string> = {
  baseline: "无有效依据",
  tie: "并列无区分度",
  weak: "弱结论",
  fair: "中等把握",
  strong: "有把握",
};

export const CONFIDENCE_HINT: Record<ConfidenceTone, string> = {
  baseline:
    "没有任何有效规则命中，也没有逐条依据：如果该平台规则册配了基线类别，网关会兜底给一个基线类别；没配基线的平台（例如当前的 Linux 规则册）就不会产出建议 —— 所以它既不代表网关认定这台机器属于这一类，也不一定是基线兜底来的。",
  tie: "有逐条命中依据，但得分没有拉开差距（最高分与次高分并列，或总分不为正）：无法据此区分类别，需要人工判定。",
  weak: "弱结论：最高分只略微领先次高分，或总分低于规则册的 weak_score 被打过折。",
  fair: "中等把握：最高分对次高分有优势，但仍可能有规则未覆盖的信号。",
  strong: "有把握：最高分明显领先次高分。",
};
