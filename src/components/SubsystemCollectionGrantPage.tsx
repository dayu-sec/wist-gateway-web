import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api";
import {
  useAgentCollectionPreflights,
  useAgentFactRefreshes,
  useAgentPurposes,
  useAgentWorks,
  useContentCatalog,
  useGrantStandingWorkBatch,
  useRegisteredAgents,
  useRequestAgentFactRefresh,
  useRunAgentCollectionPreflights,
  type BatchGrantOutcome,
} from "../hooks";
import type {
  AgentFactRefreshCommand,
  AgentListEntryView,
  CollectionPreflightView,
} from "../api";
import type { FamilyState } from "./familyOverviewRows";
import { t } from "../i18n";
import { summarizeAddresses } from "../lib/format";
import { adminApiErrorMessage } from "./adminApiError";
import { standingAckState } from "./agentWorkStatus";
import { machineClassLabel } from "./SubsystemAgentPurposeView";
import {
  collectionFamilyName,
  collectionFamilySummary,
  indexCollectionFamilies,
} from "./collectionFamilyText";
import {
  buildFamilyOverview,
  type FamilyOverviewRow,
} from "./familyOverviewRows";
import {
  countHostGrantStates,
  resolveHostGrantState,
  type HostGrantCounts,
  type HostGrantState,
} from "./collectionGrantState";
import {
  factRefreshDetail,
  factRefreshStatus,
  factRefreshStatusLabel,
  factRefreshSummaryParts,
  factRefreshTone,
  summarizeFactRefresh,
  type FactRefreshTone,
} from "./factRefreshState";
import {
  preflightEvidenceLabel,
  preflightFamily,
  preflightFamilyStateLabel,
  preflightFamilyStateTone,
  preflightNeedsProbe,
  preflightPendingTimedOut,
  preflightReason,
  preflightSummaryParts,
  preflightUndeterminedLabel,
  summarizePreflight,
  type PreflightTone,
} from "./collectionPreflightState";
import styles from "./SubsystemCollectionGrantPage.module.css";

/**
 * 一次检查/展示的主机数上限。
 *
 * 网关的授权与用途都是**按 Agent** 的接口，没有「一次问整个机队」的聚合端点。
 * 这一页不能装作有：一进页面就替 500 台机器扇出 1000 个请求，会把网关自己打满，
 * 也让「为什么这台没出现」变得不可解释。所以：
 *   · 一次只检查当前筛选的前 40 台；
 *   · 目标不在这 40 台时，用搜索把范围缩小（搜索命中的主机一定会被检查）；
 *   · 检查结果进 React Query 缓存，切换采集面不会重复读同一台。
 * 以后网关有了机队级聚合端点，替换掉这里的 `useAgentPurposes/Works` 即可，
 * 页面其余判定不用动。
 */
const HOST_LIMIT = 40;

/** 页面上的主机状态比纯判定多一个「还没检查」。 */
type RowState = HostGrantState | null;

type FamilyBadgeState = FamilyState | "partial";

/**
 * 面级「就绪」是**跨平台聚合**：只要有一个平台有 active 单元就是 ready。
 * 但对某台主机来说，它所在平台没就绪就是不能授权。这里把「部分平台就绪」
 * 显式标出来，避免出现「面显示已就绪，主机却全不可授权」的错愕。
 */
function familyBadgeState(row: FamilyOverviewRow): FamilyBadgeState {
  if (row.state !== "ready") return row.state;
  const readyPlatforms = new Set(
    row.perPlatform
      .filter((entry) => entry.activeUnits > 0)
      .map((entry) => entry.platform),
  );
  const expected =
    row.family.platforms.length > 0
      ? row.family.platforms
      : row.perPlatform.map((entry) => entry.platform);
  return expected.some((platform) => !readyPlatforms.has(platform))
    ? "partial"
    : "ready";
}

function familyStateLabel(state: FamilyBadgeState): string {
  switch (state) {
    case "ready":
      return t("已就绪", "Ready");
    case "partial":
      return t("部分就绪", "Partially ready");
    case "draft":
      return t("未就绪", "Not ready");
    case "unconfigured":
      return t("未建单元", "No units");
  }
}

function familyStateClass(state: FamilyBadgeState): string {
  switch (state) {
    case "ready":
      return styles.familyReady;
    case "partial":
      return styles.familyPartial;
    case "draft":
      return styles.familyDraft;
    case "unconfigured":
      return styles.familyIdle;
  }
}

function hostStateLabel(state: HostGrantState): string {
  switch (state.kind) {
    case "checking":
      return t("检查中…", "Checking…");
    case "error":
      return t("读取失败", "Read failed");
    case "unclassified":
      return t("用途未判定", "Purpose not set");
    case "blocked":
      return t("不可授权", "Not grantable");
    case "grantable":
      return t("可授权", "Grantable");
    case "granted":
      return t("已授权", "Granted");
    case "paused":
      return t("已暂停", "Paused");
  }
}

function hostStateClass(state: HostGrantState): string {
  switch (state.kind) {
    case "grantable":
      return styles.stateGrantable;
    case "granted":
      return styles.stateGranted;
    case "paused":
      return styles.statePaused;
    case "blocked":
      return styles.stateBlocked;
    case "unclassified":
      return styles.stateUnclassified;
    case "error":
      return styles.stateError;
    case "checking":
      return styles.stateChecking;
  }
}

/** 重采徽标的色调 → 样式类（色调定义在 `factRefreshState.ts`）。 */
function refreshToneClass(tone: FactRefreshTone): string {
  switch (tone) {
    case "ok":
      return styles.refreshOk;
    case "warn":
      return styles.refreshWarn;
    case "crit":
      return styles.refreshCrit;
    case "pending":
      return styles.refreshPending;
    case "muted":
      return styles.refreshMuted;
  }
}

/** 预检徽标的色调 → 样式类（色调定义在 `collectionPreflightState.ts`）。 */
function preflightToneClass(tone: PreflightTone): string {
  switch (tone) {
    case "ok":
      return styles.preflightOk;
    case "warn":
      return styles.preflightWarn;
    case "crit":
      return styles.preflightCrit;
    case "muted":
      return styles.preflightMuted;
  }
}

function ackLabel(work: NonNullable<HostGrantState["work"]>): {
  text: string;
  className: string;
} {
  switch (standingAckState(work, Date.now())) {
    case "in-sync":
      return {
        text: t("已确认", "Acknowledged"),
        className: styles.ackOk,
      };
    case "awaiting-ack":
      return {
        text: t("待确认", "Awaiting ack"),
        className: styles.ackPending,
      };
    case "stale-ack":
      return {
        text: t("确认旧版", "Stale ack"),
        className: styles.ackWarn,
      };
    case "never-acked":
      return {
        text: t("尚未确认", "Not acknowledged"),
        className: styles.ackCrit,
      };
  }
}

function platformText(row: FamilyOverviewRow): string {
  if (row.perPlatform.length === 0)
    return t("未建采集单元", "No collection units");
  return row.perPlatform
    .map((entry) => {
      const platform =
        entry.platform === "linux"
          ? "Linux"
          : entry.platform === "macos"
            ? "macOS"
            : entry.platform;
      return `${platform} ${entry.activeUnits}/${entry.totalUnits}`;
    })
    .join(" · ");
}

function stateErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return t(
        "Admin Token 缺失或无效：请在右上角钥匙按钮里填入令牌。",
        "Admin Token missing or invalid: fill it in via the key button in the top bar.",
      );
    }
    if (error.status === 404) {
      return t(
        "网关没有这个 Agent / 接口（HTTP 404），可能已被删除或网关是旧构建。",
        "The gateway has no such Agent/endpoint (HTTP 404); it may be deleted or the gateway build is old.",
      );
    }
    return error.detail
      ? t("HTTP {status}：{detail}", "HTTP {status}: {detail}", {
          status: error.status,
          detail: error.detail,
        })
      : t("HTTP {status}", "HTTP {status}", { status: error.status });
  }
  return t(
    "响应不符合当前契约，请检查网关与前端版本。",
    "The response does not match the current contract; check the gateway and frontend versions.",
  );
}

function grantErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return t(
        "与当前状态冲突（HTTP 409）：{detail}",
        "Conflicts with the current state (HTTP 409): {detail}",
        {
          detail:
            error.detail ??
            t(
              "可能已授权，或模板不含这个采集面。",
              "It may already be granted, or the template lacks this family.",
            ),
        },
      );
    }
    if (error.status === 400) {
      return t(
        "请求不成立（HTTP 400）：{detail}",
        "The request is invalid (HTTP 400): {detail}",
        {
          detail:
            error.detail ?? t("检查采集面名称。", "Check the family name."),
        },
      );
    }
    if (error.status === 503) {
      return t(
        "采集内容目录未装载（HTTP 503）：网关未配置 [content]。",
        "The content catalog is not loaded (HTTP 503): the gateway has no [content] configured.",
      );
    }
    return error.detail
      ? t("HTTP {status}：{detail}", "HTTP {status}: {detail}", {
          status: error.status,
          detail: error.detail,
        })
      : t("HTTP {status}", "HTTP {status}", { status: error.status });
  }
  return t(
    "操作失败：响应不符合当前契约，请检查网关与前端版本。",
    "The action failed: the response does not match the current contract; check the gateway and frontend versions.",
  );
}

/**
 * 采集授权（按采集面）。
 *
 * 与「采集工作」的单机页互补：
 *   · 这里从**面**出发，回答「这个面还能授权给哪些主机」并批量下发；
 *   · 单机页从**主机**出发，回答「这台机器在采什么、期望与本机实际差多少」。
 *
 * 同一份常驻工作一台一份：批量授权不会把多台机器合成一份，也不会覆盖已授权的机器；
 * 已授权/已暂停的主机在这一页只读，改参数/暂停/撤回仍回单机页（那里有完整的期望/实际对照）。
 */
export function SubsystemCollectionGrantPage() {
  const agentsQuery = useRegisteredAgents();
  const catalogQuery = useContentCatalog();
  const catalog = catalogQuery.data ?? null;

  // 旧网关可能不返回词表：用 readiness 里的面 ID 兜底，至少还能按面分组。
  // 不编造展示名，名称回落成协议值。
  const catalogForRows = useMemo(() => {
    if (!catalog) return null;
    if (catalog.families.length > 0) return catalog;
    const ids = Array.from(
      new Set(catalog.readiness.map((entry) => entry.family)),
    );
    if (ids.length === 0) return catalog;
    return {
      ...catalog,
      families: ids.map((id) => ({
        id,
        platforms: [],
        semanticsVersion: 0,
        nameZh: id,
        nameEn: id,
        summaryZh: "",
        summaryEn: "",
      })),
    };
  }, [catalog]);

  const familyRows = useMemo(() => {
    const order: Record<FamilyState, number> = {
      ready: 0,
      draft: 1,
      unconfigured: 2,
    };
    return buildFamilyOverview(catalogForRows)
      .slice()
      .sort((left, right) => order[left.state] - order[right.state]);
  }, [catalogForRows]);
  const familyText = useMemo(
    () => indexCollectionFamilies(catalogForRows?.families),
    [catalogForRows],
  );

  const [selectedFamily, setSelectedFamily] = useState<string | null>(null);
  const [familySearch, setFamilySearch] = useState("");
  const [hostSearch, setHostSearch] = useState("");
  const [checkRequest, setCheckRequest] = useState<{
    family: string;
    ids: string[];
  } | null>(null);
  const [selectedHosts, setSelectedHosts] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [outcomes, setOutcomes] = useState<BatchGrantOutcome[] | null>(null);
  // 「重采事实」跟踪：只装**已发起过**的 agent（提示条与行内徽标都看这份），
  // 发起失败的也装进去，否则失败在界面上无处表达。
  const [refreshIds, setRefreshIds] = useState<string[]>([]);
  const [refreshErrors, setRefreshErrors] = useState<Record<string, unknown>>(
    {},
  );
  // 「预检」跟踪：同样是**已发起过**的 agent。与重采分开两份：两者的问题不同
  // （重采是“重新报事实”，预检是“跑一趟本机实测并回答能不能授”）。
  const [preflightIds, setPreflightIds] = useState<string[]>([]);
  const [preflightErrors, setPreflightErrors] = useState<
    Record<string, unknown>
  >({});

  const selectedRow = useMemo(
    () => familyRows.find((row) => row.family.id === selectedFamily) ?? null,
    [familyRows, selectedFamily],
  );
  const selectedBadge = selectedRow ? familyBadgeState(selectedRow) : null;

  const checkedIds = checkRequest?.ids ?? [];
  const purposes = useAgentPurposes(checkedIds);
  const works = useAgentWorks(checkedIds);
  const grantBatch = useGrantStandingWorkBatch();
  const requestFactRefresh = useRequestAgentFactRefresh();
  // 只对已发起的主机开轮询（终端/超时后由 refetchInterval 自己停）。
  const refreshQueries = useAgentFactRefreshes(refreshIds);
  const runPreflight = useRunAgentCollectionPreflights();
  // 预检结果：`probe.pending` 为真时自己转（“机器自己探”最多几秒）。
  const preflightQueries = useAgentCollectionPreflights(preflightIds);

  const checkedIndex = useMemo(
    () => new Map(checkedIds.map((id, index) => [id, index])),
    [checkedIds],
  );

  const agents = useMemo(
    () =>
      (agentsQuery.data ?? [])
        .slice()
        .sort((left, right) => left.agentId.localeCompare(right.agentId)),
    [agentsQuery.data],
  );

  const filteredFamilies = useMemo(() => {
    const query = familySearch.trim().toLowerCase();
    if (!query) return familyRows;
    return familyRows.filter((row) => {
      const name = collectionFamilyName(
        row.family.id,
        familyText,
      ).toLowerCase();
      const summary = (
        collectionFamilySummary(row.family.id, familyText) ?? ""
      ).toLowerCase();
      return (
        row.family.id.toLowerCase().includes(query) ||
        name.includes(query) ||
        summary.includes(query) ||
        row.machineClasses.some(
          (machineClass) =>
            machineClass.toLowerCase().includes(query) ||
            machineClassLabel(machineClass).toLowerCase().includes(query),
        )
      );
    });
  }, [familyRows, familyText, familySearch]);

  const filteredHosts = useMemo(() => {
    const query = hostSearch.trim().toLowerCase();
    if (!query) return agents;
    return agents.filter((agent) => {
      const address = summarizeAddresses(agent.ipAddresses);
      return (
        agent.agentId.toLowerCase().includes(query) ||
        agent.hostname.toLowerCase().includes(query) ||
        address.full.toLowerCase().includes(query)
      );
    });
  }, [agents, hostSearch]);

  const visibleHosts = filteredHosts.slice(0, HOST_LIMIT);
  const overflowHosts = Math.max(0, filteredHosts.length - visibleHosts.length);

  const stateByAgent = useMemo(() => {
    const map = new Map<string, RowState>();
    if (!catalogForRows || !selectedFamily) return map;
    for (const agent of visibleHosts) {
      const index = checkedIndex.get(agent.agentId);
      if (index === undefined) {
        map.set(agent.agentId, null);
        continue;
      }
      const purpose = purposes[index];
      const work = works[index];
      if (!purpose || !work) {
        map.set(agent.agentId, { kind: "checking" });
        continue;
      }
      map.set(
        agent.agentId,
        resolveHostGrantState({
          catalog: catalogForRows,
          family: selectedFamily,
          purpose: purpose.data,
          work: work.data,
          purposeLoading: purpose.isPending,
          workLoading: work.isPending,
          purposeError: purpose.error,
          workError: work.error,
        }),
      );
    }
    return map;
  }, [
    catalogForRows,
    selectedFamily,
    visibleHosts,
    checkedIndex,
    purposes,
    works,
  ]);

  const checkedVisible = visibleHosts.filter((agent) =>
    checkedIndex.has(agent.agentId),
  );
  const states = checkedVisible
    .map((agent) => stateByAgent.get(agent.agentId))
    .filter((state): state is HostGrantState => Boolean(state));
  const counts: HostGrantCounts = countHostGrantStates(states);
  const eligibleHosts = visibleHosts.filter(
    (agent) => stateByAgent.get(agent.agentId)?.kind === "grantable",
  );
  const allEligibleSelected =
    eligibleHosts.length > 0 &&
    eligibleHosts.every((agent) => selectedHosts.has(agent.agentId));
  const selectedVisible = visibleHosts.filter((agent) =>
    selectedHosts.has(agent.agentId),
  );

  const agentsById = useMemo(() => {
    const map = new Map<string, AgentListEntryView>();
    for (const agent of agents) map.set(agent.agentId, agent);
    return map;
  }, [agents]);

  // 已发起的主机 → 最新命令（批量查询按 refreshIds 顺序返回）。
  const refreshByAgent = new Map<string, AgentFactRefreshCommand>();
  refreshQueries.forEach((query, index) => {
    const agentId = refreshIds[index];
    if (agentId && query.data) refreshByAgent.set(agentId, query.data);
  });

  const refreshEntries = refreshIds.map((agentId) => ({
    agentId,
    label: agentsById.get(agentId)?.hostname.trim() || agentId,
    command: refreshByAgent.get(agentId) ?? null,
    failed: Object.prototype.hasOwnProperty.call(refreshErrors, agentId),
    error: refreshErrors[agentId],
  }));
  const refreshSummary = summarizeFactRefresh(
    // 发起失败的机器可能还挂着一条**旧**命令；那不代表这次的结果，别把它数进汇总。
    refreshEntries.map((entry) => (entry.failed ? null : entry.command)),
  );
  const refreshSummaryParts = factRefreshSummaryParts(refreshSummary);
  const refreshRequestFailures = refreshEntries.filter(
    (entry) => entry.failed,
  ).length;

  // 有勾选就重采勾选的；没勾选就对**当前筛选出的全部主机**发起（上限与检查一致）。
  //
  // 为什么不是只挑「可授权」：事实过期恰恰是主机被判成「不可授权 / 未判定用途」的常见原因
  // —— 只对已可授权的重采，最该重采的那批反而永远点不到（按钮会变成 0 台且不可点），
  // 正好把这个入口存在的理由抵消掉。
  const refreshTargets = (
    selectedHosts.size > 0 ? selectedVisible : visibleHosts
  )
    .map((agent) => agent.agentId)
    .slice(0, HOST_LIMIT);
  const refreshPending = requestFactRefresh.isPending;

  function refreshFacts() {
    if (refreshTargets.length === 0 || refreshPending) return;
    requestFactRefresh.mutate(refreshTargets, {
      onSuccess: (results) => {
        // 最新一批排在最前：提示条只列前 8 台，刚发起的不能被旧的终态挤掉。
        setRefreshIds((current) => {
          const requested = results.map((entry) => entry.agentId);
          const rest = current.filter((id) => !requested.includes(id));
          return Array.from(new Set([...requested, ...rest]));
        });
        setRefreshErrors((current) => {
          const next = { ...current };
          for (const entry of results) {
            if (entry.ok) delete next[entry.agentId];
            else next[entry.agentId] = entry.error;
          }
          return next;
        });
      },
    });
  }

  // 已发起预检的主机 → 最新视图（批量查询按 preflightIds 顺序返回）。
  const preflightByAgent = new Map<string, CollectionPreflightView>();
  preflightQueries.forEach((query, index) => {
    const agentId = preflightIds[index];
    if (agentId && query.data) preflightByAgent.set(agentId, query.data);
  });
  const preflightViews = preflightIds.map((agentId) =>
    Object.prototype.hasOwnProperty.call(preflightErrors, agentId)
      ? { error: preflightErrors[agentId] }
      : preflightByAgent.get(agentId),
  );
  const preflightSummary = summarizePreflight(preflightViews, selectedFamily);
  const preflightParts = preflightSummaryParts(preflightSummary);
  const preflightTargets = (
    selectedHosts.size > 0 ? selectedVisible : visibleHosts
  )
    .map((agent) => agent.agentId)
    .slice(0, HOST_LIMIT);
  const preflightPending = runPreflight.isPending;

  /**
   * 让主机**自己**再探一次。
   *
   * 不需要任何人登录客户机：命令走 agentd 的状态上报回执（≤3s），探完由 agentd
   * 把实测回传到网关。页面只需轮询 `GET` 直到 `probe.pending` 变 `false`。
   */
  function preflightHosts(agentIds: readonly string[]) {
    if (agentIds.length === 0 || preflightPending) return;
    runPreflight.mutate(agentIds, {
      onSuccess: (results) => {
        // 最新一批排在最前：提示条只列前几台，刚发起的不能被旧的终态挤掉。
        setPreflightIds((current) => {
          const requested = results.map((entry) => entry.agentId);
          const rest = current.filter((id) => !requested.includes(id));
          return Array.from(new Set([...requested, ...rest]));
        });
        setPreflightErrors((current) => {
          const next = { ...current };
          for (const entry of results) {
            if (entry.ok) delete next[entry.agentId];
            else next[entry.agentId] = entry.error;
          }
          return next;
        });
      },
    });
  }

  /**
   * 只跟踪、不发起：授权被 409 拒时**网关自己**已入队了探测命令
   * （`enqueue_if_evidence_missing`），这里再 POST 一条会把它取代掉。
   * 跟踪后查询一次，看到 `probe.pending = true` 就自己轮询到结果。
   */
  function trackPreflight(agentIds: readonly string[]) {
    if (agentIds.length === 0) return;
    setPreflightIds((current) =>
      Array.from(new Set([...agentIds, ...current])),
    );
  }

  function resetSelection() {
    setSelectedHosts(new Set());
    setConfirming(false);
    setOutcomes(null);
  }

  function chooseFamily(family: string) {
    setSelectedFamily(family);
    resetSelection();
    setCheckRequest({
      family,
      ids: filteredHosts.slice(0, HOST_LIMIT).map((agent) => agent.agentId),
    });
  }

  function checkCurrent() {
    if (!selectedFamily) return;
    const next = filteredHosts
      .slice(0, HOST_LIMIT)
      .map((agent) => agent.agentId);
    const previous =
      checkRequest?.family === selectedFamily ? checkRequest.ids : [];
    setCheckRequest({
      family: selectedFamily,
      ids: Array.from(new Set([...previous, ...next])),
    });
    setSelectedHosts(new Set());
    setConfirming(false);
    setOutcomes(null);
  }

  function toggleHost(agentId: string) {
    setSelectedHosts((current) => {
      const next = new Set(current);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
    setConfirming(false);
    setOutcomes(null);
  }

  function toggleAllEligible() {
    setSelectedHosts((current) => {
      if (allEligibleSelected) {
        const next = new Set(current);
        for (const agent of eligibleHosts) next.delete(agent.agentId);
        return next;
      }
      const next = new Set(current);
      for (const agent of eligibleHosts) next.add(agent.agentId);
      return next;
    });
    setConfirming(false);
    setOutcomes(null);
  }

  function submitBatch() {
    if (!selectedFamily || selectedHosts.size === 0) return;
    grantBatch.mutate(
      { agentIds: Array.from(selectedHosts), family: selectedFamily },
      {
        onSuccess: (results) => {
          setOutcomes(results);
          setConfirming(false);
          setSelectedHosts(new Set());
          // 被拒的机器：网关已经替我们下发了探测，这里只开始跟踪并轮询 ——
          // 「授权失败」到「知道为什么」之间不该再要人点一次。
          trackPreflight(
            results.filter((entry) => !entry.ok).map((entry) => entry.agentId),
          );
        },
      },
    );
  }

  const catalogUnavailable =
    catalogQuery.isError &&
    catalogQuery.error instanceof ApiError &&
    catalogQuery.error.status === 503;

  const hostCheckActive =
    selectedFamily !== null &&
    checkRequest?.family === selectedFamily &&
    checkedVisible.length > 0;

  useEffect(() => {
    if (!confirming) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !grantBatch.isPending) {
        event.stopPropagation();
        setConfirming(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirming, grantBatch.isPending]);

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <div className={styles.pageHeaderCopy}>
          <h1 className={styles.pageTitle}>
            {t("采集授权", "Collection grants")}
          </h1>
          <p className={styles.pageSummary}>
            {t(
              "从采集面出发：选面，勾选可授权主机，批量下发同一份常驻工作。已经授权/暂停这个面的主机在这一页只读。",
              "Family first: pick a collection family, select grantable hosts, and dispatch the standing work in batch. Hosts already granted or paused for this family are read-only.",
            )}
          </p>
        </div>
        <div className={styles.pageHeaderActions}>
          <Link className={styles.secondaryLink} to="/work">
            {t("按主机查看", "By host")} <span aria-hidden="true">→</span>
          </Link>
        </div>
      </header>

      {catalogQuery.isLoading ? (
        <div className={styles.statePanel} role="status">
          <strong>
            {t("正在读取采集内容目录…", "Loading the content catalog…")}
          </strong>
          <span>
            {t(
              "可授权的面与平台就绪度都来自它。",
              "Grantable families and platform readiness both come from it.",
            )}
          </span>
        </div>
      ) : catalogQuery.isError && !catalog ? (
        <div className={styles.errorPanel} role="alert">
          <strong>
            {catalogUnavailable
              ? t("采集内容目录未装载", "The content catalog is not loaded")
              : t("读取采集内容目录失败", "Failed to load the content catalog")}
          </strong>
          <span>
            {catalogUnavailable
              ? t(
                  "网关没有配置 [content] 三件套，无法知道有哪些采集面、哪些平台就绪。配好目录并重启网关后再来。",
                  "The gateway has no [content] trio configured, so the collection families and platform readiness are unknown. Configure the catalog, restart the gateway, then come back.",
                )
              : adminApiErrorMessage(catalogQuery.error)}
          </span>
        </div>
      ) : familyRows.length === 0 ? (
        <div className={styles.statePanel}>
          <strong>
            {t("没有可授权的采集面", "No collection family to grant")}
          </strong>
          <span>
            {t(
              "当前内容目录没有定义任何采集面。先到「知识库」录入/切换内容，再回来授权。",
              "The current content catalog defines no collection family. Record or activate content in the knowledge base, then come back.",
            )}
          </span>
          <Link className={styles.inlineLink} to="/knowledge">
            {t("打开知识库", "Open the knowledge base")}{" "}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      ) : (
        <>
          <section
            className={styles.selector}
            aria-label={t("采集面", "Collection families")}
          >
            <header className={styles.selectorHead}>
              <div className={styles.selectorCopy}>
                <div className={styles.selectorTitleRow}>
                  <h2 className={styles.selectorTitle}>
                    {t("采集面", "Collection families")}
                  </h2>
                  <span className={styles.selectorCount}>
                    {familyRows.length}
                  </span>
                </div>
                <p className={styles.selectorHint}>
                  {t(
                    "选面后自动检查当前筛选的前 {limit} 台；就绪度来自本机知识库。",
                    "The first {limit} in the current filter are checked automatically; readiness comes from the local catalog.",
                    { limit: HOST_LIMIT },
                  )}
                </p>
              </div>
              <input
                className={styles.selectorSearch}
                type="search"
                value={familySearch}
                placeholder={t(
                  "搜索采集面 / 机器类别",
                  "Search family / machine class",
                )}
                aria-label={t("搜索采集面", "Search collection families")}
                onChange={(event) => setFamilySearch(event.target.value)}
              />
            </header>
            {filteredFamilies.length === 0 ? (
              <p className={styles.selectorEmpty}>
                {t("没有匹配的采集面。", "No matching collection family.")}
              </p>
            ) : (
              <div className={styles.familyStrip}>
                {filteredFamilies.map((row) => {
                  const active = row.family.id === selectedFamily;
                  const name = collectionFamilyName(row.family.id, familyText);
                  const badge = familyBadgeState(row);
                  const platform = platformText(row);
                  const classes =
                    row.machineClasses.length === 0
                      ? t("未绑定模板", "No template")
                      : row.machineClasses.map(machineClassLabel).join(" · ");
                  return (
                    <button
                      key={row.family.id}
                      type="button"
                      className={`${styles.familyChip} ${active ? styles.familyChipActive : ""}`}
                      aria-pressed={active}
                      disabled={grantBatch.isPending}
                      title={`${row.family.id} · ${platform} · ${classes}`}
                      onClick={() => chooseFamily(row.family.id)}
                    >
                      <span
                        className={`${styles.familyDot} ${
                          badge === "ready"
                            ? styles.familyDotReady
                            : badge === "partial" || badge === "draft"
                              ? styles.familyDotDraft
                              : styles.familyDotIdle
                        }`}
                        aria-hidden="true"
                      />
                      <span className={styles.familyChipName}>{name}</span>
                      <span className={styles.familyChipState}>
                        {familyStateLabel(badge)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section
            className={styles.detail}
            aria-label={t("授权主机", "Grant hosts")}
          >
            {/* 授权前先重采：事实摘要决定了「用途」与「能不能授权」，
                拿过期事实做判断会把主机误判成不可授权（或反过来）。 */}
            <div className={styles.refreshBar}>
              <div className={styles.refreshCopy}>
                <p className={styles.refreshLead}>
                  {t(
                    "授权前先重采事实：用途与可授权判定来自事实摘要。",
                    "Refresh facts before granting: purpose and grantability come from the fact summary.",
                  )}
                </p>
                {refreshSummaryParts.length > 0 ||
                refreshRequestFailures > 0 ? (
                  <p className={styles.refreshSummary}>
                    {refreshSummaryParts.map((part) => (
                      <span
                        key={part.status}
                        className={styles.refreshSummaryItem}
                      >
                        {factRefreshStatusLabel(part.status)} {part.count}
                      </span>
                    ))}
                    {refreshRequestFailures > 0 ? (
                      <span className={styles.refreshSummaryItem}>
                        {t("发起失败", "Request failed")}{" "}
                        {refreshRequestFailures}
                      </span>
                    ) : null}
                  </p>
                ) : null}
                {refreshSummary.counts.no_uplink > 0 ? (
                  <p className={styles.refreshHint}>
                    {t(
                      "有 {n} 台没有上送通道：先到「Gateway 信息」页把数据面上送开起来。",
                      "{n} host(s) have no uplink: turn on data plane reporting on the Gateway info page first.",
                      { n: refreshSummary.counts.no_uplink },
                    )}
                  </p>
                ) : null}
                {refreshSummary.counts.unsupported > 0 ? (
                  <p className={styles.refreshHint}>
                    {t(
                      "有 {n} 台的 agentd 还不支持这个命令：升级 agentd 后再试。",
                      "{n} host(s) run an agentd that does not support this command: upgrade agentd and retry.",
                      { n: refreshSummary.counts.unsupported },
                    )}
                  </p>
                ) : null}
                {refreshEntries.length > 0 ? (
                  <ul className={styles.refreshList}>
                    {refreshEntries.slice(0, 8).map((entry) => {
                      // “为什么失败”与“失败了”必须同行：只放在 title 里 = 触屏/截图都看不到。
                      const reason = entry.failed
                        ? adminApiErrorMessage(entry.error)
                        : factRefreshDetail(entry.command);
                      return (
                        <li
                          key={entry.agentId}
                          className={styles.refreshEntry}
                          title={reason ?? undefined}
                        >
                          <span className={styles.refreshHost}>
                            {entry.label}
                          </span>
                          <span
                            className={styles.refreshSep}
                            aria-hidden="true"
                          >
                            ·
                          </span>
                          <span>
                            {entry.failed
                              ? t("发起失败", "Request failed")
                              : factRefreshStatusLabel(
                                  factRefreshStatus(entry.command),
                                )}
                          </span>
                          {reason ? (
                            <>
                              <span
                                className={styles.refreshSep}
                                aria-hidden="true"
                              >
                                ·
                              </span>
                              <span className={styles.refreshReason}>
                                {reason}
                              </span>
                            </>
                          ) : null}
                        </li>
                      );
                    })}
                    {refreshEntries.length > 8 ? (
                      <li className={styles.refreshEntry}>
                        {t("等 {n} 台", "and {n} more", {
                          n: refreshEntries.length - 8,
                        })}
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </div>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={refreshTargets.length === 0 || refreshPending}
                onClick={refreshFacts}
              >
                {refreshPending
                  ? t("正在发起…", "Requesting…")
                  : selectedHosts.size > 0
                    ? t("重采事实（{n} 台）", "Refresh facts ({n} hosts)", {
                        n: refreshTargets.length,
                      })
                    : t(
                        "重采当前筛选（{n} 台）",
                        "Refresh filter ({n} hosts)",
                        { n: refreshTargets.length },
                      )}
              </button>
            </div>

            {!selectedRow ? (
              <div className={styles.welcome}>
                <span className={styles.welcomeMark} aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    width="22"
                    height="22"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path
                      d="M12 3.2 19 6.6v5.2c0 4.1-2.8 7.4-7 9-4.2-1.6-7-4.9-7-9V6.6Z"
                      strokeLinejoin="round"
                    />
                    <path
                      d="m8.6 12 2.3 2.3 4.5-4.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <h2 className={styles.welcomeTitle}>
                  {t("先选一个采集面", "Pick a collection family first")}
                </h2>
                <p className={styles.welcomeText}>
                  {t(
                    "上方每个面都会告诉你在 Linux / macOS 上的就绪度、绑定哪些机器类别。选中后，这一页会列出可以授权的主机。",
                    "Each family above shows its Linux / macOS readiness and the machine classes it is bound to. Once selected, this page lists the hosts it can be granted to.",
                  )}
                </p>
                <ol className={styles.welcomeSteps}>
                  <li>{t("选面", "Choose a family")}</li>
                  <li>{t("检查可授权主机", "Check grantable hosts")}</li>
                  <li>{t("勾选后批量授权", "Select and grant in batch")}</li>
                </ol>
              </div>
            ) : (
              <>
                <header className={styles.detailHead}>
                  <div className={styles.detailTitleRow}>
                    <div className={styles.detailTitleCopy}>
                      <h2 className={styles.detailTitle}>
                        {collectionFamilyName(
                          selectedRow.family.id,
                          familyText,
                        )}
                        <span className={styles.detailId}>
                          {selectedRow.family.id}
                        </span>
                      </h2>
                    </div>
                    <span
                      className={`${styles.familyState} ${selectedBadge ? familyStateClass(selectedBadge) : ""}`}
                    >
                      {selectedBadge ? familyStateLabel(selectedBadge) : ""}
                    </span>
                  </div>
                  {collectionFamilySummary(
                    selectedRow.family.id,
                    familyText,
                  ) ? (
                    <p className={styles.detailSummary}>
                      {collectionFamilySummary(
                        selectedRow.family.id,
                        familyText,
                      )}
                    </p>
                  ) : null}
                  <div className={styles.detailMeta}>
                    <span className={styles.metaChip}>
                      {t("就绪度", "Readiness")} {platformText(selectedRow)}
                    </span>
                    <span className={styles.metaChip}>
                      {t("绑定模板", "Templates")}{" "}
                      {selectedRow.machineClasses.length === 0
                        ? "—"
                        : selectedRow.machineClasses
                            .map(machineClassLabel)
                            .join(" · ")}
                    </span>
                    <span className={styles.metaChip}>
                      {t("已检查", "Checked")} {checkedVisible.length} /{" "}
                      {visibleHosts.length}
                    </span>
                  </div>
                  {selectedBadge && selectedBadge !== "ready" ? (
                    <div className={styles.familyWarning}>
                      {selectedBadge === "partial"
                        ? t(
                            "这个采集面只在部分平台就绪（{readiness}）；未就绪平台的主机会在下面显示为不可授权。",
                            "This family is ready on some platforms only ({readiness}); hosts on unready platforms are blocked below.",
                            { readiness: platformText(selectedRow) },
                          )
                        : t(
                            "这个采集面当前没有采集就绪的单元（status = active），不能授权；先到知识库补齐内容并切换生效版本。",
                            "This family has no collection-ready unit (status = active), so it cannot be granted. Add content in the knowledge base and activate a version first.",
                          )}
                    </div>
                  ) : null}
                </header>

                <div className={styles.toolbar}>
                  <input
                    className={styles.hostSearch}
                    type="search"
                    value={hostSearch}
                    placeholder={t(
                      "搜索主机名 / agent_id / IP",
                      "Search hostname / agent_id / IP",
                    )}
                    aria-label={t("搜索主机", "Search hosts")}
                    onChange={(event) => {
                      setHostSearch(event.target.value);
                      resetSelection();
                    }}
                  />
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={
                      !selectedFamily ||
                      filteredHosts.length === 0 ||
                      grantBatch.isPending
                    }
                    onClick={checkCurrent}
                  >
                    {hostCheckActive
                      ? t("重新检查当前筛选", "Re-check current filter")
                      : t("检查当前筛选", "Check current filter")}
                  </button>
                  {/* 「预检」与「检查」是两件事：后者读网关已有的用途/授权，
                      前者让**机器自己**再探一次 —— 后者能回答「为什么不可授权」。 */}
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={
                      !selectedFamily ||
                      preflightTargets.length === 0 ||
                      preflightPending
                    }
                    title={t(
                      "让机器自己探一次路径（不需要登录主机，约 3 秒出结果）。",
                      "Let each host probe its own paths (no login needed; a few seconds).",
                    )}
                    onClick={() => preflightHosts(preflightTargets)}
                  >
                    {preflightPending
                      ? t("正在下发…", "Dispatching…")
                      : selectedHosts.size > 0
                        ? t("预检（{n} 台）", "Preflight ({n} hosts)", {
                            n: preflightTargets.length,
                          })
                        : t("预检当前筛选（{n} 台）", "Preflight filter ({n})", {
                            n: preflightTargets.length,
                          })}
                  </button>
                  <span className={styles.toolbarInfo}>
                    {t("匹配 {n} 台", "{n} hosts match", {
                      n: filteredHosts.length,
                    })}
                    {overflowHosts > 0
                      ? t(
                          "，显示前 {limit} 台；用搜索定位其它主机",
                          ", showing the first {limit}; search to find others",
                          { limit: HOST_LIMIT },
                        )
                      : ""}
                  </span>
                </div>

                {preflightParts.length > 0 || preflightSummary.pending > 0 ? (
                  <div className={styles.preflightBar}>
                    <span className={styles.preflightLead}>
                      {t("预检结果", "Preflight")}
                    </span>
                    {preflightSummary.pending > 0 ? (
                      <span className={styles.preflightPending}>
                        {t("探测中 {n} 台", "{n} probing", {
                          n: preflightSummary.pending,
                        })}
                      </span>
                    ) : null}
                    {preflightParts.map((part) => (
                      <span
                        key={part.state}
                        className={`${styles.preflightChip} ${preflightToneClass(preflightFamilyStateTone(part.state))}`}
                      >
                        {preflightFamilyStateLabel(part.state)} {part.count}
                      </span>
                    ))}
                  </div>
                ) : null}

                {agentsQuery.isError ? (
                  <div className={styles.inlineError} role="alert">
                    {adminApiErrorMessage(agentsQuery.error)}
                  </div>
                ) : null}

                {agentsQuery.isLoading ? (
                  <div className={styles.statePanel}>
                    <strong>{t("正在读取机队…", "Loading the fleet…")}</strong>
                    <span>
                      {t(
                        "主机身份来自已注册 Agent；选中采集面后会读取用途与现有授权。",
                        "Host identities come from registered Agents; purpose and current grants are read after a family is selected.",
                      )}
                    </span>
                  </div>
                ) : visibleHosts.length === 0 ? (
                  <div className={styles.statePanel}>
                    <strong>
                      {hostSearch.trim()
                        ? t("没有匹配的主机", "No matching host")
                        : t(
                            "机队里还没有已注册的 Agent",
                            "No registered Agent in the fleet yet",
                          )}
                    </strong>
                    <span>
                      {hostSearch.trim()
                        ? t(
                            "换个主机名 / agent_id / IP 试试。",
                            "Try another hostname / agent_id / IP.",
                          )
                        : t(
                            "先安装并注册一台 Agent，再回来授权。",
                            "Install and register an Agent first, then come back.",
                          )}
                    </span>
                  </div>
                ) : (
                  <>
                    <div className={styles.listHead}>
                      <label className={styles.selectAll}>
                        <input
                          type="checkbox"
                          checked={allEligibleSelected}
                          disabled={
                            eligibleHosts.length === 0 || grantBatch.isPending
                          }
                          onChange={toggleAllEligible}
                        />
                        <span>{t("全选可授权", "Select grantable")}</span>
                      </label>
                      <div className={styles.countChips}>
                        <CountChip
                          tone="grantable"
                          label={t("可授权", "Grantable")}
                          value={counts.grantable}
                        />
                        <CountChip
                          tone="granted"
                          label={t("已授权", "Granted")}
                          value={counts.granted}
                        />
                        <CountChip
                          tone="paused"
                          label={t("已暂停", "Paused")}
                          value={counts.paused}
                        />
                        <CountChip
                          tone="blocked"
                          label={t("不可授权", "Blocked")}
                          value={counts.blocked + counts.unclassified}
                        />
                        {counts.checking > 0 ? (
                          <CountChip
                            tone="checking"
                            label={t("检查中", "Checking")}
                            value={counts.checking}
                          />
                        ) : null}
                        {counts.error > 0 ? (
                          <CountChip
                            tone="error"
                            label={t("读取失败", "Failed")}
                            value={counts.error}
                          />
                        ) : null}
                      </div>
                    </div>

                    {checkedVisible.length === 0 ? (
                      <div className={styles.checkHint}>
                        {t(
                          "还没检查可授权主机。点击「检查当前筛选」读取前 {limit} 台的用途与现有授权；结果会缓存，切换采集面不会重复读取。",
                          "No hosts checked yet. Click “Check current filter” to read purpose and current grants for the first {limit} hosts; results are cached, so switching families will not read them again.",
                          { limit: HOST_LIMIT },
                        )}
                      </div>
                    ) : null}

                    <ul className={styles.hostList}>
                      {visibleHosts.map((agent) => {
                        const state = stateByAgent.get(agent.agentId) ?? null;
                        const address = summarizeAddresses(agent.ipAddresses);
                        const identity = agent.hostname.trim() || agent.agentId;
                        const checked = state !== null;
                        const grantable = state?.kind === "grantable";
                        const selected = selectedHosts.has(agent.agentId);
                        const machineClass = state?.machineClass;
                        const ack =
                          state?.work &&
                          (state.kind === "granted" || state.kind === "paused")
                            ? ackLabel(state.work)
                            : null;
                        const refreshError = refreshErrors[agent.agentId];
                        const refreshFailed =
                          Object.prototype.hasOwnProperty.call(
                            refreshErrors,
                            agent.agentId,
                          );
                        const refreshCommand =
                          refreshByAgent.get(agent.agentId) ?? null;
                        const refreshStatus = factRefreshStatus(refreshCommand);
                        const preflightView =
                          preflightByAgent.get(agent.agentId) ?? null;
                        const preflightError =
                          preflightErrors[agent.agentId];
                        const preflightFailed =
                          Object.prototype.hasOwnProperty.call(
                            preflightErrors,
                            agent.agentId,
                          );
                        const preflightEntry = preflightFamily(
                          preflightView,
                          selectedFamily,
                        );
                        const preflightWhy = preflightReason(preflightEntry);
                        // 探测等到超时（机器大概率离线）：徽标不能永远停在「探测中」。
                        const preflightOverdue = preflightPendingTimedOut(
                          preflightView,
                        );
                        return (
                          <li
                            key={agent.agentId}
                            className={`${styles.hostRow} ${!checked ? styles.hostRowPending : ""}`}
                          >
                            <input
                              className={styles.hostCheck}
                              type="checkbox"
                              checked={selected}
                              disabled={
                                !grantable || !checked || grantBatch.isPending
                              }
                              aria-label={t("选择 {host}", "Select {host}", {
                                host: identity,
                              })}
                              onChange={() => toggleHost(agent.agentId)}
                            />
                            <div className={styles.hostIdentity}>
                              <span className={styles.hostName}>
                                {identity}
                              </span>
                              <span className={styles.hostMeta}>
                                <span className={styles.mono}>
                                  {agent.agentId}
                                </span>
                                {address.primary ? (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span
                                      className={styles.hostAddress}
                                      title={address.full}
                                    >
                                      {address.primary}
                                      {address.others > 0
                                        ? ` +${address.others}`
                                        : ""}
                                    </span>
                                  </>
                                ) : null}
                              </span>
                            </div>
                            <div className={styles.hostClass}>
                              {machineClass ? (
                                <>
                                  <span className={styles.hostClassLabel}>
                                    {machineClassLabel(machineClass)}
                                  </span>
                                  <span className={styles.hostClassCode}>
                                    {machineClass}
                                  </span>
                                </>
                              ) : (
                                <span className={styles.hostClassEmpty}>—</span>
                              )}
                            </div>
                            <div className={styles.hostState}>
                              {state ? (
                                <>
                                  <span
                                    className={`${styles.stateBadge} ${hostStateClass(state)}`}
                                  >
                                    {hostStateLabel(state)}
                                  </span>
                                  {state.kind === "granted" ||
                                  state.kind === "paused" ? (
                                    <span className={styles.stateMeta}>
                                      {t(
                                        "版本 {version}",
                                        "Version {version}",
                                        {
                                          version:
                                            state.work?.planVersion ?? "—",
                                        },
                                      )}
                                      {ack ? (
                                        <>
                                          <span aria-hidden="true"> · </span>
                                          <span className={ack.className}>
                                            {ack.text}
                                          </span>
                                        </>
                                      ) : null}
                                    </span>
                                  ) : null}
                                  {state.kind === "unclassified" ? (
                                    <Link
                                      className={styles.stateLink}
                                      to={`/agents/${encodeURIComponent(agent.agentId)}/purpose`}
                                    >
                                      {t("去归档用途", "Set purpose")} →
                                    </Link>
                                  ) : null}
                                  {state.kind === "blocked" && state.reason ? (
                                    <span
                                      className={styles.stateReason}
                                      title={state.reason}
                                    >
                                      {state.reason}
                                    </span>
                                  ) : null}
                                  {state.kind === "error" ? (
                                    <span className={styles.stateReason}>
                                      {stateErrorMessage(state.error)}
                                    </span>
                                  ) : null}
                                </>
                              ) : (
                                <span
                                  className={`${styles.stateBadge} ${styles.stateChecking}`}
                                >
                                  {t("待检查", "Not checked")}
                                </span>
                              )}
                              {/* 重采状态只在「已发起 / 正在刷新 / 终态」时出现；
                                  没请求过的行不额外占地方。 */}
                              {refreshFailed ? (
                                <span
                                  className={`${styles.refreshBadge} ${styles.refreshCrit}`}
                                  title={adminApiErrorMessage(refreshError)}
                                >
                                  {t(
                                    "重采 · 发起失败",
                                    "Refresh · request failed",
                                  )}
                                </span>
                              ) : refreshStatus !== "idle" ? (
                                <span
                                  className={`${styles.refreshBadge} ${refreshToneClass(factRefreshTone(refreshStatus))}`}
                                  title={refreshCommand?.detail || undefined}
                                >
                                  {t("重采", "Refresh")} ·{" "}
                                  {factRefreshStatusLabel(refreshStatus)}
                                </span>
                              ) : null}
                              {/* 预检：这一版的结论 + 为什么（网关已经把它写成一句话了）。 */}
                              {preflightFailed ? (
                                <span
                                  className={`${styles.refreshBadge} ${styles.refreshCrit}`}
                                  title={adminApiErrorMessage(preflightError)}
                                >
                                  {t(
                                    "预检 · 发起失败",
                                    "Preflight · request failed",
                                  )}
                                </span>
                              ) : preflightView ? (
                                <span
                                  className={`${styles.preflightBadge} ${preflightToneClass(
                                    preflightOverdue
                                      ? "warn"
                                      : preflightFamilyStateTone(
                                          preflightEntry?.state ?? "unprobed",
                                        ),
                                  )}`}
                                  title={preflightEvidenceLabel(
                                    preflightView.probe,
                                  )}
                                >
                                  {preflightView.probe.pending
                                    ? preflightOverdue
                                      ? t(
                                          "预检 · 探测超时",
                                          "Preflight · probe timed out",
                                        )
                                      : t("预检 · 探测中", "Preflight · probing")
                                    : preflightView.verdict === "undetermined"
                                      ? t("预检 · 无法判断", "Preflight · undetermined")
                                      : preflightEntry
                                        ? `${t("预检", "Preflight")} · ${preflightFamilyStateLabel(
                                            preflightEntry.state,
                                          )}`
                                        : t("预检 · 无此面", "Preflight · not in scope")}
                                </span>
                              ) : null}
                              {preflightWhy && preflightView ? (
                                <span
                                  className={styles.stateReason}
                                  title={`${preflightWhy} · ${preflightEvidenceLabel(
                                    preflightView.probe,
                                  )}`}
                                >
                                  {preflightWhy}
                                </span>
                              ) : null}
                              {/* 证据不全（没实测 / 过期 / 目录多出没探的路径）：直接说出来，
                                  否则人会拿一份旧账当成“刚查过”。 */}
                              {preflightView &&
                              !preflightView.probe.pending &&
                              preflightNeedsProbe(preflightView) ? (
                                <span className={styles.stateMeta}>
                                  {preflightEvidenceLabel(preflightView.probe)} ·{" "}
                                  {t("建议再探", "probe again")}
                                </span>
                              ) : null}
                              {preflightView?.verdict === "undetermined" &&
                              preflightView.undeterminedReason ? (
                                <span className={styles.stateReason}>
                                  {preflightUndeterminedLabel(
                                    preflightView.undeterminedReason,
                                  )}
                                </span>
                              ) : null}
                            </div>
                            <div className={styles.hostAction}>
                              {state?.kind === "granted" ||
                              state?.kind === "paused" ? (
                                <Link
                                  className={styles.stateLink}
                                  to={`/agents/${encodeURIComponent(agent.agentId)}/work`}
                                >
                                  {t("查看工作", "View work")} →
                                </Link>
                              ) : state?.kind === "grantable" ? (
                                <span className={styles.actionHint}>
                                  {t("勾选后批量授权", "Select to grant")}
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className={styles.preflightButton}
                                  disabled={preflightPending}
                                  title={t(
                                    "让这台机器自己探一次路径（不需要登录主机）。",
                                    "Let this host probe its own paths (no login needed).",
                                  )}
                                  onClick={() =>
                                    preflightHosts([agent.agentId])
                                  }
                                >
                                  {preflightView
                                    ? t("再探一次", "Probe again")
                                    : t("预检", "Preflight")}
                                </button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}

                {outcomes ? (
                  <div className={styles.outcomePanel} role="status">
                    <div className={styles.outcomeHead}>
                      <strong>{t("批量授权结果", "Batch grant result")}</strong>
                      <button
                        type="button"
                        className={styles.textButton}
                        onClick={() => setOutcomes(null)}
                      >
                        {t("关闭", "Dismiss")}
                      </button>
                    </div>
                    <p className={styles.outcomeSummary}>
                      {t(
                        "成功 {ok} 台，失败 {failed} 台；成功的机器会在 30 秒内拉取快照并确认。",
                        "{ok} succeeded, {failed} failed; successful hosts will pull a snapshot and acknowledge within 30 seconds.",
                        {
                          ok: outcomes.filter((entry) => entry.ok).length,
                          failed: outcomes.filter((entry) => !entry.ok).length,
                        },
                      )}
                    </p>
                    {outcomes.some((entry) => !entry.ok) ? (
                      <p className={styles.outcomeHint}>
                        {t(
                          "被拒的机器已自动开始本机探测（约 3 秒），原因会显示在主机行上。",
                          "Rejected hosts started probing themselves (a few seconds); the reason appears on each host row.",
                        )}
                      </p>
                    ) : null}
                    <ul className={styles.outcomeList}>
                      {outcomes.map((entry) => {
                        const agent = agentsById.get(entry.agentId);
                        const label = agent?.hostname.trim() || entry.agentId;
                        return (
                          <li
                            key={entry.agentId}
                            className={
                              entry.ok ? styles.outcomeOk : styles.outcomeFail
                            }
                          >
                            <span className={styles.mono}>{label}</span>
                            <span>
                              {entry.ok
                                ? t(
                                    "已授权（版本 {version}）",
                                    "Granted (version {version})",
                                    {
                                      version:
                                        entry.receipt?.planVersion ?? "—",
                                    },
                                  )
                                : grantErrorMessage(entry.error)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}

                {grantBatch.isError && !outcomes ? (
                  <div className={styles.inlineError} role="alert">
                    {grantErrorMessage(grantBatch.error)}
                  </div>
                ) : null}

                <div className={styles.batchBar}>
                  <div className={styles.batchCount}>
                    {selectedHosts.size > 0 ? (
                      <>
                        <strong>{selectedHosts.size}</strong>
                        <span>{t("台已选", "selected")}</span>
                      </>
                    ) : (
                      <span>
                        {eligibleHosts.length > 0
                          ? t(
                              "勾选可授权主机后批量下发",
                              "Select grantable hosts to dispatch in batch",
                            )
                          : t(
                              "当前筛选里没有可授权的主机",
                              "No grantable host in the current filter",
                            )}
                      </span>
                    )}
                  </div>
                  <div className={styles.batchActions}>
                    {selectedHosts.size > 0 ? (
                      <button
                        type="button"
                        className={styles.textButton}
                        disabled={grantBatch.isPending}
                        onClick={resetSelection}
                      >
                        {t("清空", "Clear")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={styles.primaryButton}
                      disabled={
                        selectedHosts.size === 0 || grantBatch.isPending
                      }
                      onClick={() => setConfirming(true)}
                    >
                      {t("授权选中主机（{n}）", "Grant selected ({n})", {
                        n: selectedHosts.size,
                      })}
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        </>
      )}

      {confirming && selectedRow && selectedVisible.length > 0 ? (
        <div
          className={styles.confirmBackdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !grantBatch.isPending) {
              setConfirming(false);
            }
          }}
        >
          <div
            className={styles.confirmPanel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="grant-confirm-title"
            aria-describedby="grant-confirm-desc"
          >
            <header className={styles.confirmHeader}>
              <div>
                <h2 className={styles.confirmTitle} id="grant-confirm-title">
                  {t("确认授权 {n} 台主机？", "Grant to {n} hosts?", {
                    n: selectedVisible.length,
                  })}
                </h2>
                <p className={styles.confirmFamily}>
                  {collectionFamilyName(selectedRow.family.id, familyText)}
                </p>
              </div>
              <button
                type="button"
                className={styles.confirmClose}
                aria-label={t("关闭", "Close")}
                disabled={grantBatch.isPending}
                onClick={() => setConfirming(false)}
              >
                ×
              </button>
            </header>
            <div className={styles.confirmBody} id="grant-confirm-desc">
              <p>
                {t(
                  "将向以下主机各下发一份「{family}」常驻工作；Agent 下次拉快照（≤30 秒）后应用。这些主机上其它采集面的工作不受影响。",
                  "One “{family}” standing work will be dispatched to each host below; Agents apply it on their next snapshot (≤30 seconds). Work for other collection families on these hosts is untouched.",
                  {
                    family: collectionFamilyName(
                      selectedRow.family.id,
                      familyText,
                    ),
                  },
                )}
              </p>
              <ul className={styles.confirmHosts}>
                {selectedVisible.slice(0, 6).map((agent) => (
                  <li key={agent.agentId} className={styles.confirmHost}>
                    <span className={styles.confirmHostName}>
                      {agent.hostname.trim() || agent.agentId}
                    </span>
                    <span className={styles.confirmHostId}>
                      {agent.agentId}
                    </span>
                  </li>
                ))}
                {selectedVisible.length > 6 ? (
                  <li className={styles.confirmMore}>
                    {t("还有 {n} 台未列出…", "and {n} more not listed…", {
                      n: selectedVisible.length - 6,
                    })}
                  </li>
                ) : null}
              </ul>
            </div>
            <footer className={styles.confirmActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                autoFocus
                disabled={grantBatch.isPending}
                onClick={() => setConfirming(false)}
              >
                {t("取消", "Cancel")}
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={grantBatch.isPending}
                onClick={submitBatch}
              >
                {grantBatch.isPending
                  ? t("授权中…", "Granting…")
                  : t("确认授权（{n}）", "Confirm grant ({n})", {
                      n: selectedVisible.length,
                    })}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CountChip({
  tone,
  label,
  value,
}: {
  tone: "grantable" | "granted" | "paused" | "blocked" | "checking" | "error";
  label: string;
  value: number;
}) {
  return (
    <span className={`${styles.countChip} ${styles[`count_${tone}`] ?? ""}`}>
      <span className={styles.countValue}>{value}</span>
      {label}
    </span>
  );
}
