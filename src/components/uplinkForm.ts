import type { AgentUplink } from "../api";

/**
 * 「数据面上送地址与开关」表单的**纯决策**。
 *
 * 为什么抽出来单独放一处（而不是留在组件里）：本仓没有组件渲染环境（无 jsdom，见
 * `tests/routes-contract.test.mjs` 的说明），而这里的每一条判断都对应一个**曾经写错过**的点
 * —— 不抽出来就只能靠人眼 review，抽出来就能被 `tests/uplink-form.test.ts` 钉住。
 * 组件负责渲染与提交，这里负责「能不能提交 / 该不该警告」。
 */

/** 端口范围与网关侧 `validate_uplink_address` 同口径；前端拦一道只为省一次往返。 */
const PORT_MIN = 1;
const PORT_MAX = 65535;

export interface UplinkDraft {
  host: string;
  /** 端口保持字符串：输入过程中 `""` / `"09"` 都是合法中间态，过早转数字会吃掉光标。 */
  port: string;
  enabled: boolean;
}

export interface UplinkFormState {
  hostOk: boolean;
  portOk: boolean;
  /**
   * 有没有**真**改动。
   *
   * `false` 时不允许提交（见 `canSubmit`）：否则在**派生值**上按一下「保存」会把 `updated_at`
   * 从 null 写成 now，于是这个地址从「来自部署配置」静默变成「管理面录入的」（两个徽标一起消失），
   * 而实际上什么都没改 —— 那是把状态改了，不是把配置改了。
   */
  dirty: boolean;
  canSubmit: boolean;
  /** 可见的校验原因；`null` = 没毛病。**「保存被禁用」必须能说明为什么**，不能让人猜。 */
  validationError: string | null;
}

export function uplinkFormState(
  setting: AgentUplink,
  draft: UplinkDraft,
  pending: boolean,
): UplinkFormState {
  const hostText = draft.host.trim();
  const portText = draft.port.trim();
  const portNumber = Number(portText);
  const hostOk = hostText.length > 0;
  const portOk =
    /^\d+$/.test(portText) && portNumber >= PORT_MIN && portNumber <= PORT_MAX;
  const dirty =
    hostText !== setting.host ||
    portText !== String(setting.port) ||
    draft.enabled !== setting.enabled;
  const validationError = !hostOk
    ? "主机不能为空。"
    : portText.length > 0 && !portOk
      ? `端口必须是 ${PORT_MIN}–${PORT_MAX} 的整数。`
      : null;
  return {
    hostOk,
    portOk,
    dirty,
    canSubmit: hostOk && portOk && dirty && !pending,
    validationError,
  };
}

/**
 * 该不该提示「这是一次全队动作」。
 *
 * `savedOk`（刚保存成功）时必须**不**提示：重取到服务端值之前 `setting.enabled` 还是旧的
 * `false`，两个提示会同时出现，读起来像是又改了一次。
 */
export function shouldWarnAboutTurningOnUplink(
  setting: AgentUplink,
  draft: UplinkDraft,
  savedOk: boolean,
): boolean {
  return draft.enabled && !setting.enabled && !savedOk;
}

/** 提交体里的端口：与网关要的数字对齐（校验已保证它是合法整数）。 */
export function uplinkDraftPort(draft: UplinkDraft): number {
  return Number(draft.port.trim());
}

/** 提交体里的主机：裁掉两端空白（用户看不出来的差异不该进库）。 */
export function uplinkDraftHost(draft: UplinkDraft): string {
  return draft.host.trim();
}
