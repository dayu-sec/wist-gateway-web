import { useMemo, useState } from "react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import {
  fetchAgentInvestigations,
  getAdminApiToken,
  setAgentInvestigationGrant,
  type AgentInvestigationsView,
  type AgentListEntryView,
} from "../api";
import {
  useAgentInvestigations,
  useRegisteredAgents,
  useResetAgentInvestigationGrant,
  useSetAgentInvestigationGrant,
} from "../hooks";
import { t } from "../i18n";
import { summarizeAddresses } from "../lib/format";
import styles from "./InvestigationGrantsPanel.module.css";

/** 网关只认词表里的题目（新增题目要网关 + agentd 两侧一起加）。 */
const TOPICS = [
  "disk",
  "load",
  "accounts",
  "persistence",
  "exposure",
  "telemetry-health",
] as const;
/** 与采集授权的「一次最多检查 40 台」对齐：没有机队级聚合接口。 */
const HOST_LIMIT = 40;

function topicLabel(topic: string): string {
  if (topic === "disk") {
    return t("disk（磁盘与文件）", "disk (storage & files)");
  }
  if (topic === "load") {
    return t("load（负载、CPU 与内存）", "load (CPU & memory)");
  }
  if (topic === "accounts") {
    return t("accounts（账号与授权）", "accounts (accounts & privileges)");
  }
  if (topic === "persistence") {
    return t("persistence（开机自启与定时任务）", "persistence (boot & scheduled)");
  }
  if (topic === "exposure") {
    return t("exposure（监听端口与暴露面）", "exposure (listening ports)");
  }
  if (topic === "telemetry-health") {
    return t("telemetry-health（遥测健康）", "telemetry-health (telemetry health)");
  }
  return topic;
}

function topicName(topic: string): string {
  if (topic === "disk") return t("磁盘与文件", "Storage & files");
  if (topic === "load") return t("负载、CPU 与内存", "CPU & memory");
  if (topic === "accounts") return t("账号与授权", "Accounts & privileges");
  if (topic === "persistence") return t("开机自启", "Persistence");
  if (topic === "exposure") return t("监听端口", "Listening ports");
  if (topic === "telemetry-health") return t("遥测健康", "Telemetry health");
  return topic;
}

interface InvestigationGrantsPanelProps {
  /** 从别处深链进来时预选的主机（`?agent=<id>`）。 */
  initialAgentId?: string | null;
}

type Mode = "surface" | "host";

/**
 * 调查授权（**按机器**的下界）。
 *
 * 与采集授权同构：默认**按调查面**选面 → 勾主机 → 批量开启；已开启的主机只读。
 * 「按主机配置」保留原来的单机编辑（取消某个面 / 恢复继承），作为高级入口。
 */
export function InvestigationGrantsPanel({
  initialAgentId = null,
}: InvestigationGrantsPanelProps) {
  const agentsQuery = useRegisteredAgents();
  const agents = useMemo(
    () =>
      (agentsQuery.data ?? [])
        .slice()
        .sort((a, b) => a.agentId.localeCompare(b.agentId)),
    [agentsQuery.data],
  );
  const hasToken = Boolean(getAdminApiToken());
  // 深链带 agent 时直接进单机编辑；否则默认按调查面批量授权。
  const [mode, setMode] = useState<Mode>(initialAgentId ? "host" : "surface");

  return (
    <section className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <h1 className={styles.title}>
            {t("调查授权", "Investigation grants")}
          </h1>
          <p className={styles.summary}>
            {t(
              "按调查面授权：选面、勾选可授权主机、批量开启；已开启的主机只读。网关配置里的 allowed_topics 是上界，这里只能在它之内收窄。需要取消某个面或恢复继承时，切到「按主机配置」。",
              "Grant by investigation surface: pick a surface, select grantable hosts, and enable them in batch; hosts already enabled are read-only. The gateway's allowed_topics is the ceiling. To revoke a surface or restore inheritance, switch to “Configure by host”.",
            )}
          </p>
        </div>
        <button
          type="button"
          className={styles.secondaryLink}
          onClick={() =>
            setMode((current) => (current === "surface" ? "host" : "surface"))
          }
        >
          {mode === "surface"
            ? t("按主机配置", "Configure by host")
            : t("按调查面授权", "Grant by surface")}{" "}
          <span aria-hidden="true">→</span>
        </button>
      </header>

      {agentsQuery.isError ? (
        <p className={styles.error}>
          {t(
            "读取主机列表失败，请检查 Admin Token 与网关。",
            "Failed to load hosts; check the Admin Token and the gateway.",
          )}
        </p>
      ) : null}
      {!hasToken ? (
        <p className={styles.note}>
          {t(
            "未设置 Admin Token：先在右上角填入 Token 才能读取和修改授权。",
            "No Admin Token is set: enter one from the top right before reading or changing grants.",
          )}
        </p>
      ) : null}
      {agentsQuery.isLoading && agents.length === 0 ? (
        <p className={styles.note}>
          {t("正在读取主机列表…", "Loading hosts…")}
        </p>
      ) : null}
      {!agentsQuery.isLoading && agents.length === 0 ? (
        <p className={styles.note}>
          {t("还没有已登记的 Agent。", "No registered agents yet.")}
        </p>
      ) : null}

      {agents.length > 0 && mode === "surface" ? (
        <SurfaceGrantsView agents={agents} hasToken={hasToken} />
      ) : null}
      {agents.length > 0 && mode === "host" ? (
        <HostGrantEditor
          agents={agents}
          initialAgentId={initialAgentId}
          hasToken={hasToken}
        />
      ) : null}
    </section>
  );
}

/* ========================================================================== */
/* 按调查面批量授权                                                           */
/* ========================================================================== */

interface SurfaceHostState {
  agent: AgentListEntryView;
  view: AgentInvestigationsView | undefined;
  loading: boolean;
  error: boolean;
  enabled: boolean;
  canGrant: boolean;
  inherited: boolean;
  inCeiling: boolean;
  supported: boolean | null;
  reason: string | null;
  topics: string[];
  capability: string;
  quota: string;
}

function hostSurfaceState(
  agent: AgentListEntryView,
  view: AgentInvestigationsView | undefined,
  loading: boolean,
  error: boolean,
  surface: string,
): SurfaceHostState {
  if (loading || !view) {
    return {
      agent,
      view,
      loading,
      error,
      enabled: false,
      canGrant: false,
      inherited: true,
      inCeiling: false,
      supported: null,
      reason: null,
      topics: [],
      capability: "—",
      quota: "—",
    };
  }
  const ceiling = view.allowedTopics;
  const grant = view.grant;
  const effective =
    view.effectiveTopics ??
    (grant?.inherited ? (ceiling ?? []) : (grant?.topics ?? []));
  const enabled = effective.includes(surface);
  const inCeiling = ceiling?.includes(surface) ?? false;
  const supported = view.capabilities
    ? view.capabilities.surfaces.includes(surface)
    : null;
  const canGrant = Boolean(grant) && inCeiling && !enabled;
  let reason: string | null = null;
  if (!grant) {
    reason = t(
      "网关是旧构建，不支持按机器授权",
      "Old gateway: per-host grants unsupported",
    );
  } else if (ceiling === null) {
    reason = t(
      "网关没有下发允许面",
      "The gateway did not report allowed surfaces",
    );
  } else if (!inCeiling) {
    reason = t(
      "网关没有开启这个面（allowed_topics）",
      "This surface is not enabled on the gateway (allowed_topics)",
    );
  } else if (enabled) {
    reason = grant.inherited
      ? t("继承网关默认", "Inherits the gateway default")
      : t("本机已自定义开启", "Explicitly enabled on this host");
  } else if (!supported) {
    reason = t(
      "Agent 未上报这个面：勾选后等它升级才生效",
      "The agent has not reported this surface; it takes effect after an upgrade",
    );
  }
  const capability =
    view.capabilities === null
      ? t("能力未上报", "Capability not reported")
      : `${view.capabilities.privileged ? t("root", "root") : t("非 root", "non-root")} · ${
          supported
            ? t("支持该面", "supports this surface")
            : t("不支持该面", "does not support it")
        }`;
  const quota =
    view.quota === null
      ? t("额度未知", "Quota unknown")
      : view.quota.limitPerHour === 0
        ? t("额度不限", "Unlimited quota")
        : t("额度 {used}/{limit}", "Quota {used}/{limit}", {
            used: view.quota.usedLastHour ?? "—",
            limit: view.quota.limitPerHour,
          });
  return {
    agent,
    view,
    loading,
    error,
    enabled,
    canGrant,
    inherited: grant?.inherited ?? true,
    inCeiling,
    supported,
    reason,
    topics: grant ? (grant.inherited ? (ceiling ?? []) : grant.topics) : [],
    capability,
    quota,
  };
}

function statusLabel(state: SurfaceHostState): string {
  if (state.loading) return t("检查中…", "Checking…");
  if (state.error) return t("读取失败", "Read failed");
  if (state.enabled) return t("已开启", "Enabled");
  if (state.canGrant) return t("可授权", "Grantable");
  return t("不可授权", "Not grantable");
}

function statusClass(state: SurfaceHostState): string {
  if (state.loading || state.error) return styles.stateMuted;
  if (state.enabled) return styles.stateEnabled;
  if (state.canGrant) return styles.stateGrantable;
  return styles.stateBlocked;
}

function SurfaceGrantsView({
  agents,
  hasToken,
}: {
  agents: AgentListEntryView[];
  hasToken: boolean;
}) {
  const [surface, setSurface] = useState<string>(TOPICS[0]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const limitedAgents = useMemo(() => agents.slice(0, HOST_LIMIT), [agents]);
  const queries = useQueries({
    queries: limitedAgents.map((agent) => ({
      queryKey: ["agent-investigations", agent.agentId],
      queryFn: () => fetchAgentInvestigations(agent.agentId),
      enabled: hasToken && Boolean(agent.agentId),
      retry: 1,
    })),
  });
  const states = limitedAgents.map((agent, index) => {
    const query = queries[index];
    return hostSurfaceState(
      agent,
      query?.data,
      Boolean(query?.isLoading),
      Boolean(query?.isError),
      surface,
    );
  });
  const enabledCount = states.filter((state) => state.enabled).length;
  const grantableCount = states.filter((state) => state.canGrant).length;
  const grantableIds = states
    .filter((state) => state.canGrant)
    .map((state) => state.agent.agentId);
  const allSelected =
    grantableIds.length > 0 && grantableIds.every((id) => selected.has(id));

  function chooseSurface(next: string) {
    if (next === surface) return;
    setSurface(next);
    setSelected(new Set());
    setNotice(null);
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(grantableIds));
  }

  const batch = useMutation({
    mutationFn: async () => {
      const targets = states.filter(
        (state) => state.canGrant && selected.has(state.agent.agentId),
      );
      const results = await Promise.allSettled(
        targets.map(async (state) => {
          const grant = state.view?.grant;
          if (!grant) throw new Error("no grant");
          const current = grant.inherited
            ? (state.view?.allowedTopics ?? [])
            : grant.topics;
          await setAgentInvestigationGrant(state.agent.agentId, [
            ...new Set([...current, surface]),
          ]);
        }),
      );
      const failed = results.filter(
        (result) => result.status === "rejected",
      ).length;
      return { total: targets.length, failed };
    },
    onSuccess: async ({ total, failed }) => {
      setSelected(new Set());
      setNotice(
        failed === 0
          ? t(
              "已为 {n} 台主机开启「{surface}」。",
              "Enabled “{surface}” on {n} hosts.",
              { n: total, surface: topicName(surface) },
            )
          : t(
              "已尝试 {total} 台，{failed} 台失败（其余成功）；请刷新后重试失败项。",
              "Tried {total} hosts; {failed} failed (the rest succeeded). Refresh and retry the failed ones.",
              { total, failed },
            ),
      );
      await queryClient.invalidateQueries({
        queryKey: ["agent-investigations"],
      });
    },
    onError: () =>
      setNotice(
        t(
          "批量授权失败，请检查网关与 Admin Token。",
          "Batch grant failed; check the gateway and Admin Token.",
        ),
      ),
  });
  const pending = batch.isPending;

  return (
    <>
      <section
        className={styles.selector}
        aria-label={t("调查面", "Investigation surfaces")}
      >
        <div className={styles.selectorCopy}>
          <div className={styles.selectorTitleRow}>
            <h2 className={styles.selectorTitle}>
              {t("调查面", "Investigation surfaces")}
            </h2>
            <span className={styles.selectorCount}>{TOPICS.length}</span>
          </div>
          <p className={styles.selectorHint}>
            {t(
              "选面后勾选可授权主机，批量开启；已开启主机只读。",
              "Pick a surface, select grantable hosts, and enable them in batch; already-enabled hosts are read-only.",
            )}
          </p>
          <div
            className={styles.surfaceTabs}
            role="tablist"
            aria-label={t("调查面", "Investigation surfaces")}
          >
            {TOPICS.map((topic) => {
              const active = topic === surface;
              const topicStates = limitedAgents.map((agent, index) =>
                hostSurfaceState(
                  agent,
                  queries[index]?.data,
                  Boolean(queries[index]?.isLoading),
                  Boolean(queries[index]?.isError),
                  topic,
                ),
              );
              const enabled = topicStates.filter(
                (state) => state.enabled,
              ).length;
              const grantable = topicStates.filter(
                (state) => state.canGrant,
              ).length;
              return (
                <button
                  key={topic}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`${styles.surfaceTab} ${active ? styles.surfaceTabActive : ""}`}
                  disabled={pending}
                  onClick={() => chooseSurface(topic)}
                >
                  <span>{topicLabel(topic)}</span>
                  <span className={styles.surfaceTabMeta}>
                    {enabled} {t("已开启", "on")} · {grantable}{" "}
                    {t("可授权", "grantable")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section
        className={styles.detail}
        aria-label={t("调查面主机授权", "Investigation surface grants")}
      >
        <header className={styles.detailHead}>
          <div className={styles.detailTitleRow}>
            <div className={styles.detailTitleCopy}>
              <h2 className={styles.detailTitle}>
                {topicName(surface)}
                <span className={styles.detailId}>{surface}</span>
              </h2>
              <p className={styles.detailSummary}>
                {t(
                  "按这个调查面查看主机：已开启只读；可授权主机勾选后批量开启；不可授权会说明上界或 Agent 能力原因。",
                  "Hosts for this surface: enabled ones are read-only; select grantable hosts to enable in batch; blocked rows explain the ceiling or agent capability.",
                )}
              </p>
            </div>
            <span className={styles.countChip}>
              {enabledCount} {t("已开启", "on")} · {grantableCount}{" "}
              {t("可授权", "grantable")}
            </span>
          </div>
        </header>

        {limitedAgents.length < agents.length ? (
          <p className={styles.limitNote}>
            {t(
              "只检查前 {shown} 台（共 {total} 台）；请用机队页确认范围。",
              "Only the first {shown} of {total} hosts are checked; use the fleet page to narrow the scope.",
              { shown: limitedAgents.length, total: agents.length },
            )}
          </p>
        ) : null}

        <div className={styles.listToolbar}>
          <label className={styles.selectAll}>
            <input
              type="checkbox"
              checked={allSelected}
              disabled={pending || grantableIds.length === 0}
              onChange={toggleAll}
            />
            <span>全选可授权</span>
          </label>
          <span className={styles.toolbarHint}>
            {selected.size > 0
              ? t("{n} 台已选", "{n} selected", { n: selected.size })
              : t(
                  "勾选可授权主机后批量开启",
                  "Select grantable hosts to enable in batch",
                )}
          </span>
        </div>

        <div className={styles.hostList}>
          {states.map((state) => {
            const id = state.agent.agentId;
            const addresses = summarizeAddresses(state.agent.ipAddresses ?? []);
            const checked = state.enabled || selected.has(id);
            return (
              <div
                key={id}
                className={`${styles.hostRow} ${state.enabled ? styles.hostRowEnabled : ""}`}
              >
                <input
                  type="checkbox"
                  className={styles.hostCheck}
                  checked={checked}
                  disabled={pending || !state.canGrant}
                  aria-label={t("选择 {host}", "Select {host}", {
                    host: state.agent.hostname || id,
                  })}
                  onChange={() => {
                    if (state.canGrant) toggle(id);
                  }}
                />
                <div className={styles.hostMain}>
                  <span className={styles.hostName}>
                    {state.agent.hostname || id}
                  </span>
                  <span className={styles.hostSub} title={id}>
                    {id}
                    {addresses.primary
                      ? ` · ${addresses.primary}${addresses.others > 0 ? ` +${addresses.others}` : ""}`
                      : ""}
                  </span>
                </div>
                <span className={`${styles.stateBadge} ${statusClass(state)}`}>
                  {statusLabel(state)}
                </span>
                <div className={styles.hostMeta}>
                  <span>{state.capability}</span>
                  <span>{state.quota}</span>
                  {state.reason ? (
                    <span
                      className={
                        state.enabled ? styles.metaMuted : styles.metaReason
                      }
                    >
                      {state.reason}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className={styles.batchBar}>
          <span className={styles.batchCount}>
            {selected.size > 0
              ? t("{n} 台已选", "{n} selected", { n: selected.size })
              : t(
                  grantableCount > 0 ? "{n} 台可授权" : "当前没有可授权的主机",
                  grantableCount > 0 ? "{n} grantable" : "No grantable host",
                  { n: grantableCount },
                )}
          </span>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={pending || selected.size === 0}
            onClick={() => batch.mutate()}
          >
            {pending
              ? t("授权中…", "Granting…")
              : t("授权选中主机（{n}）", "Grant selected ({n})", {
                  n: selected.size,
                })}
          </button>
        </div>

        {notice ? (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        ) : null}
      </section>
    </>
  );
}

/* ========================================================================== */
/* 按主机配置（取消面 / 恢复继承）                                            */
/* ========================================================================== */

function HostGrantEditor({
  agents,
  initialAgentId,
  hasToken,
}: {
  agents: AgentListEntryView[];
  initialAgentId: string | null;
  hasToken: boolean;
}) {
  const [picked, setPicked] = useState<string | null>(initialAgentId);
  const agentId = picked ?? agents[0]?.agentId ?? "";
  const view = useAgentInvestigations(agentId);
  const data = view.data;
  const ceiling = data?.allowedTopics ?? null;
  const capabilities = data?.capabilities ?? null;
  const serverTopics = data?.grant?.inherited
    ? (ceiling ?? [])
    : (data?.grant?.topics ?? ceiling ?? []);
  const [draft, setDraft] = useState<string[] | null>(null);
  const setGrant = useSetAgentInvestigationGrant(agentId);
  const resetGrant = useResetAgentInvestigationGrant(agentId);
  const selected = draft ?? serverTopics;
  const dirty =
    draft !== null &&
    [...draft].sort().join("\n") !== [...serverTopics].sort().join("\n");
  const pending = setGrant.isPending || resetGrant.isPending;

  const resetDraft = () => setDraft(null);
  const toggle = (topic: string) =>
    setDraft(
      selected.includes(topic)
        ? selected.filter((item) => item !== topic)
        : [...selected, topic],
    );

  return (
    <>
      <section className={styles.selector} aria-label={t("主机", "Host")}>
        <div className={styles.selectorCopy}>
          <div className={styles.selectorTitleRow}>
            <h2 className={styles.selectorTitle}>{t("主机", "Host")}</h2>
            <span className={styles.selectorCount}>{agents.length}</span>
          </div>
          <p className={styles.selectorHint}>
            {t(
              "单机编辑：可以取消某个面，或恢复继承网关默认。",
              "Per-host editing: revoke a surface or restore inheritance from the gateway default.",
            )}
          </p>
        </div>
        <label className={styles.hostField}>
          <span className={styles.srOnly}>{t("主机", "Host")}</span>
          <select
            value={agentId}
            onChange={(event) => {
              setPicked(event.target.value);
              resetDraft();
            }}
            disabled={agents.length === 0}
          >
            {agents.map((agent) => (
              <option key={agent.agentId} value={agent.agentId}>
                {agent.hostname
                  ? `${agent.hostname} · ${agent.agentId}`
                  : agent.agentId}
              </option>
            ))}
          </select>
        </label>
      </section>

      {agentId === "" ? null : view.isLoading ? (
        <p className={styles.note}>{t("读取中…", "Loading…")}</p>
      ) : view.error ? (
        <p className={styles.error}>
          {t("读取这台机器的授权失败。", "Failed to load this host's grants.")}
        </p>
      ) : data ? (
        <>
          <section className={styles.infoCard}>
            <header className={styles.infoHead}>
              <h2 className={styles.infoTitle}>
                {t("权限与能力", "Permissions and capabilities")}
              </h2>
              <p className={styles.infoHint}>
                {t(
                  "网关配置给的上界、本小时额度和 Agent 本机自报能力。",
                  "The gateway's ceiling, this hour's quota, and what the agent reports it can do.",
                )}
              </p>
            </header>
            <dl className={styles.grid}>
              <dt>{t("允许的面（上界）", "Allowed surfaces (ceiling)")}</dt>
              <dd>
                {ceiling === null
                  ? t("未知（网关是旧构建）", "Unknown (old gateway build)")
                  : ceiling.length === 0
                    ? t("一个都不许", "None")
                    : ceiling.map(topicLabel).join("、")}
              </dd>
              <dt>{t("本小时额度", "Hourly quota")}</dt>
              <dd>
                {data.quota === null
                  ? t("未知（网关是旧构建）", "Unknown (old gateway build)")
                  : data.quota.limitPerHour === 0
                    ? t("不限", "Unlimited")
                    : `${data.quota.usedLastHour ?? "—"} / ${data.quota.limitPerHour}`}
              </dd>
              <dt>{t("Agent 自报能力", "Agent capabilities")}</dt>
              <dd>
                {capabilities === null
                  ? t(
                      "尚未上报（旧 agentd / 刚升级）",
                      "Not reported yet (old agentd / just upgraded)",
                    )
                  : `${capabilities.surfaces.map(topicLabel).join("、")}${
                      capabilities.privileged
                        ? t("（root：完整答案）", " (root: complete answers)")
                        : t(
                            "（非 root：部分答案）",
                            " (non-root: partial answers)",
                          )
                    }`}
              </dd>
            </dl>
          </section>

          {data.grant === null ? (
            <p className={styles.warn}>
              {t(
                "网关是旧构建：不支持按机器授权（这里只能看，不能改）。升级网关后再来。",
                "This gateway build does not support per-host grants (read-only here). Upgrade the gateway.",
              )}
            </p>
          ) : (
            <div className={styles.grantBox}>
              <div className={styles.grantHead}>
                <strong>
                  {t("这台机器开哪几面", "Surfaces enabled on this host")}
                </strong>
                <span className={styles.badge}>
                  {data.grant.inherited
                    ? t("继承网关默认", "Inherits gateway default")
                    : t("本机自定义", "Custom for this host")}
                </span>
                {data.grant.updatedBy ? (
                  <span className={styles.note}>
                    {t("最近修改", "Last change")}:{" "}
                    <code>{data.grant.updatedBy}</code>{" "}
                    {data.grant.updatedAt ?? "—"}
                  </span>
                ) : null}
              </div>
              <div className={styles.options}>
                {TOPICS.map((topic) => {
                  const inCeiling = (ceiling ?? []).includes(topic);
                  const supported =
                    capabilities?.surfaces.includes(topic) ?? false;
                  return (
                    <label
                      key={topic}
                      className={styles.option}
                      title={
                        inCeiling
                          ? undefined
                          : t(
                              "网关没有开启这个面，先改配置",
                              "disabled on this gateway: change the config first",
                            )
                      }
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(topic)}
                        disabled={!hasToken || pending || !inCeiling}
                        onChange={() => toggle(topic)}
                      />
                      <span>{topicLabel(topic)}</span>
                      {!supported ? (
                        <span className={styles.hint}>
                          {t(
                            "Agent 未上报：勾上也要等它升级才会生效",
                            "agent has not reported it: takes effect only after the agent is upgraded",
                          )}
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={!hasToken || pending || !dirty}
                  onClick={() =>
                    setGrant.mutate(selected, { onSuccess: resetDraft })
                  }
                >
                  {setGrant.isPending
                    ? t("保存中…", "Saving…")
                    : t("保存授权", "Save grant")}
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={
                    !hasToken ||
                    pending ||
                    ((data.grant?.inherited ?? true) && draft === null)
                  }
                  onClick={() =>
                    resetGrant.mutate(undefined, { onSuccess: resetDraft })
                  }
                >
                  {t("恢复继承", "Inherit again")}
                </button>
              </div>
              {setGrant.error || resetGrant.error ? (
                <p className={styles.error}>
                  {t(
                    "保存失败：参数越界或网络异常（上界与词表见上表）。",
                    "Save failed: out of range or network error (see the ceiling above).",
                  )}
                </p>
              ) : null}
            </div>
          )}

          <p className={styles.note}>
            {t(
              "授权只影响下发；已经落盘的报告仍可查看（取证记录不因事后收权而消失）。",
              "Grants only affect dispatching; reports already on disk stay readable (a revocation never hides evidence).",
            )}
          </p>
        </>
      ) : null}
    </>
  );
}
