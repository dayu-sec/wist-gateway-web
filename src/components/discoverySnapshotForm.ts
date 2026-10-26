import type {
  DiscoverySnapshotApplied,
  DiscoverySnapshotSetting,
} from "../api";
import { t } from "../i18n";

/**
 * 「原文快照上送」设置表单的**纯决策**。
 *
 * 为什么抽出来单独放一处（与 `uplinkForm.ts` 同一理由）：本仓没有组件渲染环境（无 jsdom），
 * 而这里的判断都有明确的业务后果 —— 尤其「配置值与实际生效值是否分叉」正是这一屏存在的理由，
 * 写在组件里就只能靠人眼 review。组件负责渲染与提交，这里负责判定。
 */

/** 周期预设（秒）：5 分钟 / 15 分钟 / 30 分钟 / 1 小时。 */
export const SNAPSHOT_INTERVAL_PRESETS: readonly number[] = [
  300, 900, 1800, 3600,
];

/** 没有任何一层设置时的表单初值：1 小时（与后端/agentd 的常用默认一致）。 */
export const SNAPSHOT_DEFAULT_INTERVAL_SECONDS = 3600;

export interface SnapshotDraft {
  enabled: boolean;
  /**
   * 周期保持字符串：输入过程中 `""` / `"09"` 都是合法中间态，
   * 过早转数字会吃掉光标（与 `uplinkForm.ts` 的端口字段同一处理）。
   */
  interval: string;
}

/**
 * 表单初值。
 *
 * `setting` 为空时给「未启用 + 1 小时」而不是随便一个开启值：全局从没设过时，
 * 页面不能一打开就像是「已经在全局启用了」。
 */
export function snapshotDraftFrom(
  setting: DiscoverySnapshotSetting | null,
): SnapshotDraft {
  return setting
    ? { enabled: setting.enabled, interval: String(setting.intervalSeconds) }
    : {
        enabled: false,
        interval: String(SNAPSHOT_DEFAULT_INTERVAL_SECONDS),
      };
}

export function snapshotDraftInterval(draft: SnapshotDraft): number {
  return Number(draft.interval.trim());
}

/** 当前值正好是某个预设时返回该预设，否则返回 `null`（= 该进「自定义」态）。 */
export function snapshotPresetOf(intervalSeconds: number): number | null {
  return SNAPSHOT_INTERVAL_PRESETS.includes(intervalSeconds)
    ? intervalSeconds
    : null;
}

export interface SnapshotDraftState {
  intervalOk: boolean;
  /** 与**服务端当前值**比有没有真改动；`hasServerValue=false` 时任何草稿都算待保存。 */
  dirty: boolean;
  canSubmit: boolean;
  /** 可见的校验原因；`null` = 没毛病。「保存被禁用」必须能说明为什么。 */
  validationError: string | null;
}

export function snapshotDraftState(
  serverDraft: SnapshotDraft,
  draft: SnapshotDraft,
  minIntervalSeconds: number,
  pending: boolean,
  hasServerValue = true,
): SnapshotDraftState {
  const intervalText = draft.interval.trim();
  const intervalNumber = Number(intervalText);
  // 纯整数字面量：`"1e3"` / `"60.5"` / `"-60"` 都不接受 —— 后端要的是 u64 秒。
  const intervalOk =
    /^\d+$/.test(intervalText) && intervalNumber >= minIntervalSeconds;
  // 服务端还没有这一层设置时，表单里显示的就是**将要创建**的值 —— 任何草稿都算待保存。
  // 否则「全局关闭 + 默认周期」这种合法设置永远点不了保存（它恰好等于空表单的初值）。
  const dirty =
    !hasServerValue ||
    draft.enabled !== serverDraft.enabled ||
    intervalText !== serverDraft.interval.trim();
  // 校验文案在**调用期**取词（本函数在组件渲染期调用），否则切语言不会变。
  const validationError =
    intervalText.length === 0
      ? t("周期不能为空。", "Interval must not be empty.")
      : !intervalOk
        ? t(
            "周期必须是 ≥ {min} 秒的整数。",
            "Interval must be an integer of at least {min} seconds.",
            { min: minIntervalSeconds },
          )
        : null;
  return {
    intervalOk,
    dirty,
    canSubmit: intervalOk && dirty && !pending,
    validationError,
  };
}

/**
 * 这台机器「配置要求的值」：单机覆盖优先，其次全局；两层都没有则 `null`。
 *
 * `null` 不代表「用默认值」——它表示控制面**没有任何意见**，机器按本机 `[discovery]` 跑。
 */
export function snapshotExpectedSetting(
  global: DiscoverySnapshotSetting | null,
  override: DiscoverySnapshotSetting | null,
): DiscoverySnapshotSetting | null {
  return override ?? global;
}

/**
 * 配置值与实际生效值是否**分叉**（这一屏的核心价值）。
 *
 * 三种情况都算分叉：
 * ① 控制面配了值，但机器回传的来源仍是 `local_config`（还没拉到 / 旧 agentd / 下发没落）；
 * ② 来源是 `control_plane`，但开关或周期与配置要求的不一致（典型：配了 3600 实际还在 300）；
 * ③ 任一侧缺失时**不下结论**（`false`）—— 「还没回传」不是「不一致」，
 *    不能因为数据没到就把整列标红。
 */
export function snapshotDivergence(
  expected: DiscoverySnapshotSetting | null,
  applied: DiscoverySnapshotApplied | null,
): boolean {
  if (expected === null || applied === null) return false;
  if (applied.source !== "control_plane") return true;
  return (
    applied.enabled !== expected.enabled ||
    applied.intervalSeconds !== expected.intervalSeconds
  );
}

/** `applied.source` 的人读文案；认不出的来源原样显示，不编一个。 */
export function snapshotSourceLabel(source: string): string {
  if (source === "control_plane") return t("控制面下发", "Control plane");
  if (source === "local_config") return t("本机配置", "Local config");
  return source;
}

/**
 * 周期的展示文案：整小时 / 整分钟用更适合读的单位，其余保持秒（与输入框口径一致）。
 */
export function formatSnapshotInterval(seconds: number): string {
  if (seconds >= 3600 && seconds % 3600 === 0) {
    return t("{h} 小时", "{h} h", { h: seconds / 3600 });
  }
  if (seconds >= 60 && seconds % 60 === 0) {
    return t("{m} 分钟", "{m} min", { m: seconds / 60 });
  }
  return t("{s} 秒", "{s} s", { s: seconds });
}
