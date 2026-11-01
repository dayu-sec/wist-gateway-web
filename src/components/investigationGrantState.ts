import type { AgentInvestigationsView } from "../api";
import { t } from "../i18n";

/**
 * 「按调查面授权」里，一台主机对**当前选中的调查面**的判定。
 *
 * 判定的是**授权**（上界 `allowed_topics` ∩ 按机器下界 `investigation_grant`），
 * **不是**「这台机器现在能不能跑」—— 后者还要乘上 agent 自报能力
 * （`InvestigationCapabilities`），那是网关的第三道闸（G2）。
 *
 * **默认是全关**（与采集面同一逻辑：没派过活就不采）：没有本机授权行 = 一个面都不开。
 * 所以这里看到的一大片应该都是「未开启」，勾上并保存才会真的开。
 *
 * 两者混在一起会出两类假象，正是「授权页变成摆设」的来源：
 *   · 已经授权、但 agent 还没上报这个面 → 页面显示「可授权」，
 *     点保存写回去的还是同一份清单（什么都没变），看着像授权成功了；
 *   · agent 升级后上报了新的面 → 从没点过授权的机器也显示「已开启」，
 *     而「已开启」又是只读的 —— 想收权只能去另一个入口逐台点。
 *
 * 所以这里只算授权，能力单独给一行提示（`supported` / `reason`）。
 */
export type SurfaceGrantKind =
  | "checking"
  | "error"
  /** 已开启，跟随网关默认（**仅旧构建**：旧默认是上界；新构建默认全关，不会出现）。 */
  | "inherited"
  /** 已开启，本机存了一份自己的清单。 */
  | "custom"
  /** 上界开着，但这台机器没授权这一面。 */
  | "off"
  /** 改不了：旧网关，或网关没开这个面。 */
  | "blocked";

export interface SurfaceGrantState {
  agentId: string;
  kind: SurfaceGrantKind;
  /** 授权现在是不是开着（上界 ∩ 下界），**不含** agent 能力。 */
  granted: boolean;
  /** `true` = 旧构建的“没有本机行、跟随上界”；新构建恒为 `false`（缺行 = 全关）。 */
  inherited: boolean;
  /** 能不能在页面上改（旧网关 / 上界没开 → `false`）。 */
  canToggle: boolean;
  inCeiling: boolean;
  /** agent 自报能力：`null` = 还没上报（旧 agentd / 刚升级）。 */
  supported: boolean | null;
  /** 改这一面要写回的本机清单（旧构建继承时 = 上界；新构建 = 本机存的那份，默认空）。 */
  topics: string[];
  /** 页面上的说明：为什么改不了，或为什么「已开启但可能跑不了」。 */
  reason: string | null;
}

export function resolveSurfaceGrantState(input: {
  agentId: string;
  view: AgentInvestigationsView | undefined;
  loading: boolean;
  error: boolean;
  surface: string;
}): SurfaceGrantState {
  const { agentId, view, loading, error, surface } = input;
  const base = {
    agentId,
    granted: false,
    inherited: true,
    canToggle: false,
    inCeiling: false,
    supported: null as boolean | null,
    topics: [] as string[],
    reason: null as string | null,
  };

  if (loading) return { ...base, kind: "checking" };
  if (error) return { ...base, kind: "error" };
  // 没开查询（如未填 Admin Token）也算「还没读到」，不能冒充「读取失败」。
  if (!view) return { ...base, kind: "checking" };

  const ceiling = view.allowedTopics;
  const grant = view.grant;
  const supported = view.capabilities
    ? view.capabilities.surfaces.includes(surface)
    : null;
  const inCeiling = ceiling?.includes(surface) ?? false;

  // 旧网关：没有按机器授权这一层，页面只能看。
  if (!grant) {
    return {
      ...base,
      kind: "blocked",
      granted: inCeiling,
      inCeiling,
      supported,
      topics: ceiling ?? [],
      reason: t(
        "网关是旧构建，不支持按机器授权",
        "Old gateway: per-host grants are unsupported",
      ),
    };
  }
  // 旧网关没下发上界：`[]`（一个都不许）与「没这个字段」不能混成同一件事。
  if (ceiling === null) {
    return {
      ...base,
      kind: "blocked",
      supported,
      topics: grant.inherited ? [] : grant.topics,
      reason: t(
        "网关没有下发允许面",
        "The gateway did not report allowed surfaces",
      ),
    };
  }

  // 旧构建：本机行里的面就是全部；新构建默认全关，也只是这一份清单。
  // 只有旧构建的“继承”形态（`inherited = true`）把上界当成已授权。
  const topics = grant.inherited ? ceiling : grant.topics;
  if (!inCeiling) {
    return {
      ...base,
      kind: "blocked",
      inherited: grant.inherited,
      supported,
      topics,
      reason: t(
        "网关没有开启这个面（allowed_topics）",
        "This surface is not enabled on the gateway (allowed_topics)",
      ),
    };
  }

  const granted = topics.includes(surface);
  const capabilityHint =
    supported === true
      ? null
      : supported === false
        ? t(
            "Agent 未上报这个面：要等它升级后才会真的跑",
            "The agent has not reported this surface; it takes effect after an upgrade",
          )
        : t(
            "Agent 还没上报能力（旧 agentd / 刚升级）",
            "The agent has not reported capabilities yet (old agentd / just upgraded)",
          );

  if (!granted) {
    return {
      ...base,
      kind: "off",
      inherited: grant.inherited,
      canToggle: true,
      inCeiling,
      supported,
      topics,
      reason: capabilityHint,
    };
  }

  return {
    ...base,
    kind: grant.inherited ? "inherited" : "custom",
    granted: true,
    inherited: grant.inherited,
    canToggle: true,
    inCeiling,
    supported,
    topics,
    reason:
      capabilityHint ??
      (grant.inherited
        ? t(
            "跟随网关默认（旧构建：上界全开）",
            "Inherits the gateway default (old build: the whole ceiling)",
          )
        : t("本机已授权", "Granted on this host")),
  };
}

/**
 * 把「这一面要开 / 要关」翻译成要 `PUT` 的本机清单；返回 `null` = 不用写。
 *
 * 读改写（不是覆盖）：清单的其余面原样保留 —— 页面在这个入口只动一个面，
 * 不能顺手把别的面一起改掉。
 */
export function surfaceGrantTopics(
  state: SurfaceGrantState,
  surface: string,
  desired: boolean,
): string[] | null {
  if (!state.canToggle) return null;
  if (desired === state.granted) return null;
  const base = state.topics;
  const next = desired
    ? [...base.filter((topic) => topic !== surface), surface]
    : base.filter((topic) => topic !== surface);
  return [...new Set(next)];
}

export interface SurfaceGrantCounts {
  inherited: number;
  custom: number;
  off: number;
  blocked: number;
  checking: number;
  error: number;
}

export function countSurfaceGrantStates(
  states: readonly SurfaceGrantState[],
): SurfaceGrantCounts {
  const counts: SurfaceGrantCounts = {
    inherited: 0,
    custom: 0,
    off: 0,
    blocked: 0,
    checking: 0,
    error: 0,
  };
  for (const state of states) counts[state.kind] += 1;
  return counts;
}

/** 授权开着（不论继承还是本机自定义）。 */
export function isSurfaceGranted(state: SurfaceGrantState): boolean {
  return state.kind === "inherited" || state.kind === "custom";
}
