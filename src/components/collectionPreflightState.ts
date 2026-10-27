import type {
  CollectionPreflightFamily,
  CollectionPreflightFamilyState,
  CollectionPreflightProbe,
  CollectionPreflightUndeterminedReason,
  CollectionPreflightVerdict,
  CollectionPreflightView,
} from "../api";
import { t } from "../i18n";

/**
 * 采集预检（collection preflight）的**展示判定**。
 *
 * 为什么单独放一处：本仓没有组件渲染环境（无 jsdom），而这些映射决定了运维如何理解
 * 一台机器 —— 「约定位置没有」是换机器 / 改目录、「还没探」是再点一次、「探不了」是去要权限，
 * 三种处置完全不同。抽出来就能被测试钉住，也保证行内徽标与提示条说的是同一句话。
 */

/** 与后端 `families[].state` 一一对应：五个值就是五种处置。 */
export type PreflightFamilyState = CollectionPreflightFamilyState;

/** 徽标色调：只表达「要不要处理」，不与授权状态抢同一套颜色。 */
export type PreflightTone = "ok" | "warn" | "crit" | "muted";

/**
 * 面级状态文案。
 *
 * 刻意**不使用**网关内部的 `match_unsatisfied` / `fact_not_collected` 这些词：
 * 它们是排障线索（放在 `match_expr` 与逐路径证据里），不是给人看的结论。
 */
export function preflightFamilyStateLabel(
  state: PreflightFamilyState,
): string {
  switch (state) {
    case "grantable":
      return t("可授权", "Grantable");
    case "absent":
      return t("约定位置没有", "Not at expected paths");
    case "unprobed":
      return t("还没探", "Not probed yet");
    case "unreadable":
      return t("探不了", "Unreadable");
    case "source_unresolved":
      return t("找不到日志目录", "Log dir unresolved");
    case "agent_too_old":
      return t("要升级 agentd", "agentd too old");
    case "not_ready":
      return t("策展未就绪", "Not curated yet");
  }
}

export function preflightFamilyStateTone(
  state: PreflightFamilyState,
): PreflightTone {
  switch (state) {
    case "grantable":
      return "ok";
    case "absent":
      return "crit";
    case "unreadable":
      return "warn";
    case "source_unresolved":
      // 不是“机器没有”，也不是“再探一次”：要人配一条覆盖（或开搜索）。
      return "warn";
    case "agent_too_old":
      // 处置明确（升级 agentd），但也不是“这台机器没有”。
      return "warn";
    case "unprobed":
    case "not_ready":
      return "muted";
  }
}

/** 总判决文案（`undetermined` 要配 `preflightUndeterminedLabel` 才有意义）。 */
export function preflightVerdictLabel(
  verdict: CollectionPreflightVerdict,
): string {
  switch (verdict) {
    case "grantable":
      return t("全部可授权", "All grantable");
    case "partial":
      return t("部分可授权", "Partially grantable");
    case "blocked":
      return t("不可授权", "Blocked");
    case "undetermined":
      return t("无法判断", "Undetermined");
  }
}

/** 「答不了」时给人的下一步（决定页面给哪个入口，而不是只显示一句错误）。 */
export function preflightUndeterminedLabel(
  reason: CollectionPreflightUndeterminedReason,
): string {
  switch (reason) {
    case "no_content":
      return t(
        "网关还没有装载采集目录：先到知识库录入并激活一个版本。",
        "The gateway has no collection catalog loaded: record and activate a knowledge version first.",
      );
    case "unclassified":
      return t(
        "这台机器还没判定用途：没有机器类别就取不到采集模板。",
        "This host has no purpose classification yet: without a machine class there is no collection template.",
      );
    case "no_template":
      return t(
        "这台机器的类别没有对应的采集模板：知识库里缺这份模板。",
        "No collection template for this machine class: the catalog is missing it.",
      );
    case "no_facts":
      return t(
        "这台机器还没上报过事实：点「预检」让它自己探一次（不用登录）。",
        "This host has not reported facts yet: click “Preflight” and it will probe itself (no login needed).",
      );
    case "catalog_error":
      return t(
        "采集目录自相矛盾：模板与单元对不上，先修知识库。",
        "The catalog contradicts itself: templates and units disagree. Fix the knowledge base first.",
      );
  }
}

/** 证据来源：这一版结论用的是「本机实测」还是「事实摘要里的路径」。 */
export function preflightEvidenceLabel(probe: CollectionPreflightProbe): string {
  const source =
    probe.source === "probe"
      ? t("本机实测", "Measured on the host")
      : probe.source === "reported"
        ? t("事实摘要", "From the fact summary")
        : t("还没有证据", "No evidence yet");
  return probe.stale ? `${source} · ${t("可能过期", "may be stale")}` : source;
}

/** 该机器当前面（若给 `familyId`）的结论；没选中采集面时返回 `null`。 */
export function preflightFamily(
  view: CollectionPreflightView | null | undefined,
  familyId: string | null,
): CollectionPreflightFamily | null {
  if (!view || !familyId) return null;
  return view.families.find((family) => family.family === familyId) ?? null;
}

/**
 * 一行「为什么」：优先用网关给的具体原因（它带着具体路径 / 权限错误），
 * 缺了才退回按状态给一句通用说明 —— 界面上不能出现一个没有理由的红点。
 */
export function preflightReason(
  family: CollectionPreflightFamily | null,
): string | null {
  if (!family) return null;
  if (family.reason) return family.reason;
  switch (family.state) {
    case "grantable":
      return null;
    case "absent":
      return t(
        "目录约定的位置没有这个面要求的路径（服务可能装在非标准目录）",
        "The expected paths are not present (the service may live in a non-standard directory)",
      );
    case "unprobed":
      return t("这个面的路径还没探过", "The paths for this family have not been probed yet");
    case "unreadable":
      return t("这个面的路径探不了（权限 / IO）", "The paths for this family cannot be read (permissions / IO)");
    case "source_unresolved":
      return t(
        "服务在，但找不到它的日志目录（先配人工覆盖，或开受限搜索）",
        "The service is up but its log directory is unknown (set an override or enable bounded search)",
      );
    case "agent_too_old":
      return t(
        "这台机器的 agentd 版本低于知识库要求（升级 agentd 后自动恢复）",
        "This host's agentd is older than the catalog requires (upgrading restores collection)",
      );
    case "not_ready":
      return t("知识库还没把这个面的单元标成 active", "The catalog has no active unit for this family yet");
  }
}

/**
 * 一台机器是否**值得再探一次**：没证据 / 证据可能过期 / 目录多出没探的路径。
 *
 * 刻意**不**把 `source = reported` 当成需要再探：没有实测时，求值用的就是事实摘要里的
 * 那批路径 —— 再探一遍不会改变结论，只会让每一行都挂一句“建议再探”。
 */
export function preflightNeedsProbe(
  view: CollectionPreflightView | null | undefined,
): boolean {
  if (!view) return true;
  if (view.probe.pending) return false; // 已经在路上了，别再发一条
  return (
    view.probe.source === "none" ||
    view.probe.stale ||
    view.probe.notProbedPaths.length > 0
  );
}

/**
 * 轮询间隔：只在「命令在路上」时轮询。
 *
 * 停下来的条件是 `probe.pending = false`；另外加一道超时 —— 网关侧要等命令 TTL
 * 才判 `expired`，页面不能陪一台离线机器打几分钟。超时后运维可以再点一次。
 */
export const PREFLIGHT_POLL_MS = 2_000;
export const PREFLIGHT_PENDING_TIMEOUT_MS = 5 * 60_000;

export function preflightRefetchInterval(
  view: CollectionPreflightView | undefined,
  nowMs: number = Date.now(),
): number | false {
  if (!view || !view.probe.pending) return false;
  if (preflightPendingTimedOut(view, nowMs)) return false;
  return PREFLIGHT_POLL_MS;
}

/**
 * 探测已经等太久（页面已停止轮询）。
 *
 * 为什么需要它：命令在网关里要等 TTL（10 分钟）才判 `expired`，而页面 5 分钟就停轮询了。
 * 没有这个判定，行内徽标会永远停在「探测中」—— 而机器其实可能早就离线了。
 */
export function preflightPendingTimedOut(
  view: CollectionPreflightView | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!view?.probe.pending) return false;
  const since = view.probe.pendingSince
    ? Date.parse(view.probe.pendingSince)
    : Number.NaN;
  if (!Number.isFinite(since)) return false;
  return nowMs - since >= PREFLIGHT_PENDING_TIMEOUT_MS;
}

/**
 * 批次汇总：一次预检多台时，用计数回答「多少台能授、多少台要人管」。
 *
 * 只数**有结论**的面（选中采集面的那一个）；没选中采集面时不汇总。
 */
export interface PreflightSummary {
  counts: Record<PreflightFamilyState, number>;
  pending: number;
  total: number;
}

export function summarizePreflight(
  views: ReadonlyArray<
    CollectionPreflightView | null | undefined | { error: unknown }
  >,
  familyId: string | null,
): PreflightSummary {
  const counts: Record<PreflightFamilyState, number> = {
    grantable: 0,
    absent: 0,
    unprobed: 0,
    unreadable: 0,
    not_ready: 0,
    source_unresolved: 0,
    agent_too_old: 0,
  };
  let pending = 0;
  let total = 0;
  if (!familyId) return { counts, pending, total };
  for (const entry of views) {
    if (!entry || "error" in entry) continue;
    total += 1;
    if (entry.probe.pending) {
      pending += 1;
      continue;
    }
    const family = preflightFamily(entry, familyId);
    if (family) counts[family.state] += 1;
  }
  return { counts, pending, total };
}

/** 汇总里的展示顺序：先说能授的，再说要人管的。 */
export const PREFLIGHT_SUMMARY_ORDER: readonly PreflightFamilyState[] = [
  "grantable",
  "unprobed",
  "unreadable",
  "agent_too_old",
  "source_unresolved",
  "absent",
  "not_ready",
];

export function preflightSummaryParts(
  summary: PreflightSummary,
): Array<{ state: PreflightFamilyState; count: number }> {
  return PREFLIGHT_SUMMARY_ORDER.filter(
    (state) => summary.counts[state] > 0,
  ).map((state) => ({ state, count: summary.counts[state] }));
}
