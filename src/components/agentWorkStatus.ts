import type {
  ContentCatalogView,
  MachineClass,
  StandingWork,
  StandingWorkStatus,
  WorkSpec,
  WorkSpecUnit,
} from "../types";

/**
 * 工作状态与**漂移**的呈现口径（页面与契约测试共用一份，避免两处各写一套判断）。
 *
 * 漂移的定义来自模型：网关记的是**期望版本**（`plan_version`），Agent 回的是它手上
 * 那一版（确认回执）。两者不一致、或者从来没确认过，就是漂移 —— 前者说明 Agent 还没
 * 拉到新版本，后者说明它可能压根没拉到。两种要分开说，因为处置不同。
 */

/** 与全局设计变量同一套语气：ok / warn / crit / unknown。 */
export type WorkTone = "ok" | "warn" | "crit" | "unknown";

export const STANDING_STATUS_LABEL: Record<StandingWorkStatus, string> = {
  active: "生效中",
  paused: "已暂停",
  superseded: "已被新版取代",
  revoked: "已撤回",
};

export const STANDING_STATUS_TONE: Record<StandingWorkStatus, WorkTone> = {
  active: "ok",
  // 暂停不是错误：期望状态就是「暂不做」，Agent 没在做不算漂移。
  paused: "warn",
  superseded: "unknown",
  revoked: "unknown",
};

/** Agent 侧的执行状态（一次性工作）。 */
export const ONE_SHOT_STATUS_LABEL: Record<string, string> = {
  dispatched: "已派发",
  accepted: "已接受",
  running: "执行中",
  paused: "已暂停",
  succeeded: "成功",
  failed: "失败",
  timed_out: "超时",
  canceled: "已取消",
  expired: "已过期",
};

export const ONE_SHOT_TERMINAL_STATUSES = [
  "succeeded",
  "failed",
  "timed_out",
  "canceled",
  "expired",
] as const;

export function oneShotStatusLabel(status: string): string {
  return ONE_SHOT_STATUS_LABEL[status] ?? status;
}

export function oneShotStatusTone(status: string): WorkTone {
  if (status === "succeeded") return "ok";
  if (status === "running" || status === "accepted") return "ok";
  if (status === "paused") return "warn";
  if (status === "failed" || status === "timed_out" || status === "expired")
    return "crit";
  return "unknown";
}

/** 漂移三态：从没确认 / 确认的是旧版本 / 已同步。 */
export type DriftKind = "never-acked" | "stale-ack" | "in-sync";

export function standingDrift(work: StandingWork): DriftKind {
  if (!work.ack) return "never-acked";
  if (work.ack.planVersion !== work.planVersion) return "stale-ack";
  return "in-sync";
}

export const DRIFT_LABEL: Record<DriftKind, string> = {
  "never-acked":
    "从未确认：期望版本发下去了，Agent 一直没回（它每 30 秒拉一次快照）",
  "stale-ack": "确认的是旧版本：Agent 手上那份还没跟到当前版本",
  "in-sync": "已确认",
};

export const DRIFT_TONE: Record<DriftKind, WorkTone> = {
  "never-acked": "crit",
  "stale-ack": "warn",
  "in-sync": "ok",
};

/** 该面由哪个采集器承接（工作不含工作级 capability，由单元各自决定）。 */
export function workCapabilities(spec: WorkSpec): string[] {
  const capabilities = new Set<string>();
  for (const unit of spec.units) capabilities.add(unit.capability);
  return [...capabilities].sort();
}

/** 一条采集来源的可读写法：`FileGlob /var/log/a*`。 */
export function sourceLabel(unit: WorkSpecUnit, index: number): string {
  const source = unit.sources[index];
  if (!source) return "";
  return `${source.kind} ${source.target}`;
}

/**
 * 工作里声明的指标周期（秒）；没有 `MetricInterval` 来源时返回 `null`。
 *
 * 与 agentd 的口径一致：取**最密**的那一个 —— 要得最急的才是上送频率的下界。
 */
export function metricIntervalSeconds(spec: WorkSpec): number | null {
  let tightest: number | null = null;
  for (const unit of spec.units) {
    for (const source of unit.sources) {
      if (source.kind !== "MetricInterval") continue;
      const seconds = parseIntervalSeconds(source.target);
      if (seconds === null) continue;
      tightest = tightest === null ? seconds : Math.min(tightest, seconds);
    }
  }
  return tightest;
}

/** 解析 `15s` / `5m`（与采集目录的写法一致）；认不出来返回 `null`。 */
export function parseIntervalSeconds(raw: string): number | null {
  const text = raw.trim();
  if (text.endsWith("s")) {
    const value = Number.parseInt(text.slice(0, -1).trim(), 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (text.endsWith("m")) {
    const value = Number.parseInt(text.slice(0, -1).trim(), 10);
    return Number.isFinite(value) && value > 0 ? value * 60 : null;
  }
  return null;
}

/**
 * 机器类别 → 平台。
 *
 * 这份映射在网关侧也有一份（`platform_for_machine_class`），这里重复是为了**只把
 * 网关肯接受的面摆给运维**：机器类别的平台归属是模型里的闭合关系（Mac* → macos，
 * Linux* → linux），不会各自漂移；而让网关去回一个 409 再让用户猜原因，体验差得多。
 */
export function platformForMachineClass(
  machineClass: MachineClass,
): "macos" | "linux" {
  return machineClass === "MacDaily" || machineClass === "MacDev"
    ? "macos"
    : "linux";
}

/**
 * 这台机器**能派**的采集面 = 该机器类别模板覆盖的面 ∩ 该平台上就绪的面。
 *
 * 两个条件都得满足，而且各有各的理由：
 *   · 模板覆盖：不在模板里的面派了也取不到内容（网关回 409「模板不含此面」）；
 *   · 面就绪：规则还没写好（没有 `active` 单元）的面不许授权（渐进启用）。
 * 把两者取交集，运维在表单里看不到注定失败的选项。
 */
export function grantableFamilies(
  catalog: ContentCatalogView,
  machineClass: MachineClass,
): { family: string; activeUnits: number; totalUnits: number }[] {
  const platform = platformForMachineClass(machineClass);
  const template = catalog.templates.find(
    (candidate) => candidate.machineClass === machineClass,
  );
  if (!template) return [];
  const readiness = new Map(
    catalog.readiness
      .filter((entry) => entry.platform === platform && entry.ready)
      .map((entry) => [entry.family, entry]),
  );
  return template.familyScope
    .map((family) => {
      const entry = readiness.get(family);
      if (!entry) return null;
      return {
        family,
        activeUnits: entry.activeUnits,
        totalUnits: entry.totalUnits,
      };
    })
    .filter((entry): entry is { family: string; activeUnits: number; totalUnits: number } =>
      entry !== null,
    )
    .sort((left, right) => left.family.localeCompare(right.family));
}

/**
 * 这台机器**不能派**的面及原因（正好是上一条的补集）。
 *
 * 为什么要列出来：只给一三个可选面、不说缺什么，运维会以为「平台就只支持这些」；
 * 而真相往往是「规则还没写好」—— 那是进度问题，不是能力问题。
 */
export function blockedFamilies(
  catalog: ContentCatalogView,
  machineClass: MachineClass,
): { family: string; reason: string }[] {
  const platform = platformForMachineClass(machineClass);
  const template = catalog.templates.find(
    (candidate) => candidate.machineClass === machineClass,
  );
  if (!template) {
    return [
      {
        family: "-",
        reason: `采集目录里没有机器类别 ${machineClass} 的模板（网关授权时会回 409）`,
      },
    ];
  }
  const readiness = new Map(
    catalog.readiness
      .filter((entry) => entry.platform === platform)
      .map((entry) => [entry.family, entry]),
  );
  return template.familyScope
    .map((family) => {
      const entry = readiness.get(family);
      if (entry && entry.ready) return null;
      const detail = entry
        ? `该面还没有 status = active 的采集单元（${entry.activeUnits}/${entry.totalUnits}）`
        : "该平台上没有这个面的采集单元";
      return { family, reason: detail };
    })
    .filter((entry): entry is { family: string; reason: string } => entry !== null)
    .sort((left, right) => left.family.localeCompare(right.family));
}

/** 工作里出现的采集单元总数与来源总数（摘要条用）。 */
export function specCounts(spec: WorkSpec): { units: number; sources: number } {
  return {
    units: spec.units.length,
    sources: spec.units.reduce(
      (total, unit) => total + unit.sources.length,
      0,
    ),
  };
}

/** 漂移的工作数（期望版本与确认版本不一致，或从来没确认过）。 */
export function driftingCount(works: StandingWork[]): number {
  return works.filter((work) => standingDrift(work) !== "in-sync").length;
}
