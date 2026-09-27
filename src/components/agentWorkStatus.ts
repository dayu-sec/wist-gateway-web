import type {
  ContentCatalogView,
  MachineClass,
  StandingWork,
  StandingWorkStatus,
  WorkSpec,
  WorkSpecSource,
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
  return sourceText(source);
}

/** 一条来源的可读写法（`kind target`）；与 [`sourceLabel`] 同一口径。 */
export function sourceText(source: WorkSpecSource): string {
  return `${source.kind} ${source.target}`;
}

/** 目标里有没有通配元字符（与模型 `has_glob_meta` 同一口径：`* ? [`）。 */
export function hasGlobMeta(target: string): boolean {
  return ["*", "?", "["].some((meta) => target.includes(meta));
}

/**
 * 这个目标是不是采集端今天**真能打开**的路径：**绝对路径、无通配**。
 *
 * `~` 展开与 glob 展开都不在 agentd 第一版的能力边界内，所以两者都不算显式路径。
 */
export function isExplicitPath(target: string): boolean {
  return target.startsWith("/") && !hasGlobMeta(target);
}

/**
 * 一条来源今天**能不能被采**（与模型 / agentd 的 `is_executable_source` 同一口径）。
 *
 * 这个判据必须与 agentd 完全一致：不一致就会出现「页面说可采、agent 拿到后报 unsupported」
 * 这种没人能发现的矛盾。加一种可采 kind 时，两侧一起改。
 */
export function isExecutableSource(kind: string, target: string): boolean {
  if (kind === "FileGlob") return isExplicitPath(target);
  if (kind === "MetricInterval") return true;
  return false;
}

/**
 * 一条来源**今天采不到**的原因；能采返回 `null`。
 *
 * 页面要把它如实标出来 —— 否则通配路径/导出器看起来和普通路径一样，运维会以为「已经采上了」。
 */
export function unsupportedSourceReason(
  kind: string,
  target: string,
): string | null {
  if (isExecutableSource(kind, target)) return null;
  if (kind === "FileGlob") return "通配路径";
  if (kind === "Exporter") return "导出器";
  if (kind === "UnifiedLogPredicate") return "统一日志谓词";
  return `未知类型 ${kind}`;
}

/** 工作里「今天采不到」的来源条数（摘要与告警用）。 */
export function unsupportedSourceCount(spec: WorkSpec): number {
  let total = 0;
  for (const unit of spec.units) {
    for (const source of unit.sources) {
      if (!isExecutableSource(source.kind, source.target)) total += 1;
    }
  }
  return total;
}

/**
 * 本机**实际会去 tail 的日志文件**（从授权折算，去重）。
 *
 * 这就是 agentd `state/work.json` 里 `standing[].tasks[].path` 的来源：agentd 用**同一份判据**
 * 折算（`is_executable_source`）。只有「可采的 `FileGlob`」会成为采集任务 ——
 * 指标周期不是文件；通配 / `~` / 导出器 / 统一日志谓词今天采不到。
 *
 * 注意：本机配置里手工加的 `[telemetry.logs] file_inputs`（运维逃生舱）**不**在这里，
 * 也**不在** `work.json` 里 —— 它不来自任何采集面，只网关不知道、agent 自己知道。
 */
export function collectedLogFiles(spec: WorkSpec): string[] {
  const files: string[] = [];
  for (const unit of spec.units) {
    for (const source of unit.sources) {
      if (source.kind !== "FileGlob") continue;
      if (!isExecutableSource(source.kind, source.target)) continue;
      if (!files.includes(source.target)) files.push(source.target);
    }
  }
  return files;
}

/**
 * 同一个文件被**两份以上工作**声明的路径 → 声明它的采集面清单（去重后只留 2+）。
 *
 * 一条路径被两份工作采 = agentd 会把它 tail 两遍（重复采集）。原先这件事是靠
 * 「本机在采的日志文件」那张汇总表看出来的（同一路径只列一行、把归属都挂上），
 * 那份汇总表已并进各工作卡的「在采文件」行，这个判据就得单独留着 ——
 * 不标出来，重复采集会藏在两张卡里，谁都看不见。
 */
export function duplicatedCollectedPaths(
  works: StandingWork[],
): Map<string, string[]> {
  const byPath = new Map<string, string[]>();
  for (const work of works) {
    for (const path of collectedLogFiles(work.spec)) {
      const owners = byPath.get(path);
      if (!owners) {
        byPath.set(path, [work.family]);
      } else if (!owners.includes(work.family)) {
        owners.push(work.family);
      }
    }
  }
  for (const [path, owners] of byPath) {
    if (owners.length < 2) byPath.delete(path);
  }
  return byPath;
}

/** 本机侧一次性工作的执行阶段（`AgentLocalOneShotWorkView.execution`）。 */
export const LOCAL_EXECUTION_LABEL: Record<string, string> = {
  unexecuted: "未开始",
  executing: "执行中",
  executed: "已执行",
};

export function localExecutionLabel(execution: string): string {
  return LOCAL_EXECUTION_LABEL[execution] ?? execution;
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

/** 一个可派的采集面及其就绪度（页面上就是一张「待授权」卡）。 */
export interface GrantableFamily {
  family: string;
  activeUnits: number;
  totalUnits: number;
  parseReady: boolean;
}

/**
 * 这台机器**能派**的采集面 = 该机器类别模板覆盖的面 ∩ 该平台上**采集就绪**的面。
 *
 * 两个条件都得满足，而且各有各的理由：
 *   · 模板覆盖：不在模板里的面派了也取不到内容（网关回 409「模板不含此面」）；
 *   · 采集就绪：还没有能采的单元（没有 `status = active`）的面不许授权（渐进启用）。
 * 把两者取交集，页面上就不会摆出注定失败的选项。
 *
 * **不看解析就绪**（`ruleRef`）：采原文不需要解析规则。`parseReady` 只是随行带出去，
 * 让卡片能如实标一句「原文未归类」，而不是把两者搅在一起。
 */
export function grantableFamilies(
  catalog: ContentCatalogView,
  machineClass: MachineClass,
): GrantableFamily[] {
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
        parseReady: entry.parseReady,
      };
    })
    .filter((entry): entry is GrantableFamily => entry !== null)
    .sort((left, right) => left.family.localeCompare(right.family));
}

/**
 * **还没授权**的可派面 = 可派的面 − 已经有常驻工作的面。
 *
 * 页面直接把这份清单摆成待授权的卡（授权按钮就在卡上），于是「哪些面在采」与
 * 「哪些面还能派」是同一屏里的一件事，不必另开一节再挑一遍面。
 *
 * 已经有工作的面**不**在这里：那一份就在它自己的卡上改参数重授（版本 +1），
 * 再摆一张卡就是同一个面两张卡了；被撤回的面不在 `standing` 里，自然回到这里。
 */
export function ungrantedFamilies(
  grantable: GrantableFamily[],
  standing: StandingWork[],
): GrantableFamily[] {
  const granted = new Set(standing.map((work) => work.family));
  return grantable.filter((entry) => !granted.has(entry.family));
}

/**
 * 这台机器**不能派**的面及原因（正好是上一条的补集）。
 *
 * 为什么要列出来：只给一三个可选面、不说缺什么，运维会以为「平台就只支持这些」；
 * 而真相往往是「采集要素还没齐」（或者来源类型 agentd 还执行不了）——
 * 那是进度问题，不是能力问题。
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
        ? `该面还没有采集就绪（status = active）的单元（${entry.activeUnits}/${entry.totalUnits}）`
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
