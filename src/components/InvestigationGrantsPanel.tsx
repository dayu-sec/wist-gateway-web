import { useMemo, useState } from "react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import {
  fetchAgentInvestigations,
  getAdminApiToken,
  resetAgentInvestigationGrant,
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
import {
  countSurfaceGrantStates,
  isSurfaceGranted,
  resolveSurfaceGrantState,
  surfaceGrantTopics,
  type SurfaceGrantState,
} from "./investigationGrantState";

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
 * 与采集授权同构：默认**按调查面**选面 → 勾主机 → 批量开启 / 批量取消。
 * 授权状态 = 上界（`allowed_topics`）∩ 本机授权，**不含** agent 能力 ——
 * 能力只是提示（G2 的另一道闸），混进来会让「已授权」与「跑得起来」互相冒充。
 * 「按主机配置」保留单机编辑（逐面勾选 / 恢复默认），作为高级入口。
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
              "按调查面授权：**默认全关**（与采集面一致，不授权就不查）。选面 → 勾选主机即开启、取消勾选即关闭，保存后即时生效。网关配置里的 allowed_topics 是上界，授权只能在它之内；要逐面细调或清空某台，切到「按主机配置」。",
              "Grant by investigation surface. Grants are **deny-by-default** (same as collection families: nothing is read until granted). Pick a surface, check to grant and uncheck to revoke; changes apply on save. The gateway's allowed_topics is the ceiling. Use “Configure by host” for per-surface editing or to clear a host.",
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

function surfaceStatusLabel(state: SurfaceGrantState): string {
  switch (state.kind) {
    case "checking":
      return t("检查中…", "Checking…");
    case "error":
      return t("读取失败", "Read failed");
    case "inherited":
      return t("已开启 · 继承", "On · inherited");
    case "custom":
      return t("已开启 · 本机", "On · custom");
    case "off":
      return t("未开启", "Off");
    default:
      return t("不可授权", "Not grantable");
  }
}

function surfaceStatusClass(state: SurfaceGrantState): string {
  switch (state.kind) {
    case "checking":
    case "error":
      return styles.stateMuted;
    case "inherited":
    case "custom":
      return styles.stateEnabled;
    case "off":
      return styles.stateGrantable;
    default:
      return styles.stateBlocked;
  }
}

/** 这台机器对这一面的能力：**只作提示**，不参与授权判定。 */
function capabilityText(
  view: AgentInvestigationsView | undefined,
  state: SurfaceGrantState,
): string {
  if (!view?.capabilities) return t("能力未上报", "Capability not reported");
  const role = view.capabilities.privileged
    ? t("root", "root")
    : t("非 root", "non-root");
  const can = state.supported
    ? t("支持该面", "supports this surface")
    : t("未上报该面", "does not report it");
  return `${role} · ${can}`;
}

function quotaText(view: AgentInvestigationsView | undefined): string {
  if (!view?.quota) return t("额度未知", "Quota unknown");
  if (view.quota.limitPerHour === 0) return t("额度不限", "Unlimited quota");
  return t("额度 {used}/{limit}", "Quota {used}/{limit}", {
    used: view.quota.usedLastHour ?? "—",
    limit: view.quota.limitPerHour,
  });
}

function SurfaceGrantsView({
  agents,
  hasToken,
}: {
  agents: AgentListEntryView[];
  hasToken: boolean;
}) {
  const [surface, setSurface] = useState<string>(TOPICS[0]);
  /** 只记「和服务器不一样」的行；保存时按它做差量（差量里既有开启也有关闭）。 */
  const [draft, setDraft] = useState<Record<string, boolean>>({});
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
  const rows = limitedAgents.map((agent, index) => {
    const query = queries[index];
    return {
      agent,
      view: query?.data,
      state: resolveSurfaceGrantState({
        agentId: agent.agentId,
        view: query?.data,
        loading: Boolean(query?.isLoading),
        error: Boolean(query?.isError),
        surface,
      }),
    };
  });
  /** 页面上的当前值：改过的看草稿，没改的看服务器。 */
  const desired = (state: SurfaceGrantState) =>
    draft[state.agentId] ?? state.granted;
  const changes = rows.filter(
    (row) => row.state.canToggle && desired(row.state) !== row.state.granted,
  );
  const turningOn = changes.filter((row) => desired(row.state)).length;
  const turningOff = changes.length - turningOn;
  const counts = countSurfaceGrantStates(rows.map((row) => row.state));
  const enabledCount = counts.inherited + counts.custom;
  const offCount = counts.off;
  /** 「全选」只针对**服务器上本来就没开**的行，不会把别人的收权勾回来。 */
  const serverOff = rows.filter(
    (row) => row.state.kind === "off" && row.state.canToggle,
  );
  const allOffSelected =
    serverOff.length > 0 &&
    serverOff.every((row) => draft[row.state.agentId] === true);

  function chooseSurface(next: string) {
    if (next === surface) return;
    setSurface(next);
    setDraft({});
    setNotice(null);
  }

  function setDesired(state: SurfaceGrantState, value: boolean) {
    setDraft((current) => {
      const next = { ...current };
      if (value === state.granted) delete next[state.agentId];
      else next[state.agentId] = value;
      return next;
    });
  }

  function toggleAllOff() {
    setDraft((current) => {
      const next = { ...current };
      for (const row of serverOff) {
        if (allOffSelected) delete next[row.state.agentId];
        else next[row.state.agentId] = true;
      }
      return next;
    });
  }

  const save = useMutation({
    mutationFn: async () => {
      const targets = rows.filter(
        (row) =>
          row.state.canToggle && desired(row.state) !== row.state.granted,
      );
      const results = await Promise.allSettled(
        targets.map(async (row) => {
          const topics = surfaceGrantTopics(
            row.state,
            surface,
            desired(row.state),
          );
          // `null` = 这一行不用写（理论上与上面的过滤同义，留一份保险）。
          if (!topics) return;
          await setAgentInvestigationGrant(row.state.agentId, topics);
        }),
      );
      return {
        total: targets.length,
        on: targets.filter((row) => desired(row.state)).length,
        off: targets.filter((row) => !desired(row.state)).length,
        failed: results.filter((result) => result.status === "rejected").length,
      };
    },
    onSuccess: async ({ total, on, off, failed }) => {
      setDraft({});
      setNotice(
        failed === 0
          ? t(
              "已保存 {n} 台改动：开启 {on} 台、关闭 {off} 台。",
              "Saved changes for {n} hosts: {on} enabled, {off} revoked.",
              { n: total, on, off },
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
          "保存授权失败，请检查网关与 Admin Token。",
          "Saving grants failed; check the gateway and the Admin Token.",
        ),
      ),
  });

  /** 单行「恢复默认」：删本机行（= 回到全关，不等批量保存）。 */
  const resetOne = useMutation({
    mutationFn: (agentId: string) => resetAgentInvestigationGrant(agentId),
    onSuccess: async (_saved, agentId) => {
      setDraft((current) => {
        const next = { ...current };
        delete next[agentId];
        return next;
      });
      setNotice(
        t(
          "已恢复默认：这台机器回到全关。",
          "Reset: this host is back to deny-all.",
        ),
      );
      await queryClient.invalidateQueries({
        queryKey: ["agent-investigations"],
      });
    },
    onError: () =>
      setNotice(
        t(
          "恢复默认失败，请检查网关与 Admin Token。",
          "Reset failed; check the gateway and the Admin Token.",
        ),
      ),
  });
  const pending = save.isPending || resetOne.isPending;

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
              "选面 → 勾选主机即开启、取消勾选即关闭；点保存后即时生效。默认全关，Agent 能力只作提示，不拦授权。",
              "Pick a surface; check to grant and uncheck to revoke, then save. Default is off; agent capability is a hint, not a gate.",
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
                resolveSurfaceGrantState({
                  agentId: agent.agentId,
                  view: queries[index]?.data,
                  loading: Boolean(queries[index]?.isLoading),
                  error: Boolean(queries[index]?.isError),
                  surface: topic,
                }),
              );
              const on = topicStates.filter(isSurfaceGranted).length;
              const off = topicStates.filter(
                (state) => state.kind === "off",
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
                    {on} {t("已开启", "on")} · {off} {t("未开启", "off")}
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
                  "授权 = 上界（allowed_topics）∩ 本机。已开启的可取消（这台机器显式关闭），未开启的可勾选开启；不可授权的行会说明上界或旧网关原因。",
                  "A grant is the ceiling (allowed_topics) intersect this host. Enabled rows can be revoked and off rows can be granted; blocked rows explain the ceiling or an old gateway.",
                )}
              </p>
            </div>
            <span className={styles.countChip}>
              {enabledCount} {t("已开启", "on")} · {offCount}{" "}
              {t("未开启", "off")}
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
              checked={allOffSelected}
              disabled={pending || serverOff.length === 0}
              onChange={toggleAllOff}
            />
            <span>{t("全选未开启", "Select all off")}</span>
          </label>
          <span className={styles.toolbarHint}>
            {t(
              "勾选=开启，取消勾选=关闭；保存后即时生效。",
              "Check to grant, uncheck to revoke; applied on save.",
            )}
          </span>
        </div>

        <div className={styles.hostList}>
          {rows.map(({ agent, view, state }) => {
            const id = state.agentId;
            const addresses = summarizeAddresses(agent.ipAddresses ?? []);
            const isOn = desired(state);
            return (
              <div
                key={id}
                className={`${styles.hostRow} ${state.granted ? styles.hostRowEnabled : ""}`}
              >
                <input
                  type="checkbox"
                  className={styles.hostCheck}
                  checked={isOn}
                  disabled={pending || !state.canToggle}
                  aria-label={t(
                    "开启 {host} 的这一面",
                    "Grant this surface on {host}",
                    {
                      host: agent.hostname || id,
                    },
                  )}
                  onChange={() => setDesired(state, !isOn)}
                />
                <div className={styles.hostMain}>
                  <span className={styles.hostName}>
                    {agent.hostname || id}
                  </span>
                  <span className={styles.hostSub} title={id}>
                    {id}
                    {addresses.primary
                      ? ` · ${addresses.primary}${addresses.others > 0 ? ` +${addresses.others}` : ""}`
                      : ""}
                  </span>
                </div>
                <div className={styles.stateCell}>
                  <span
                    className={`${styles.stateBadge} ${surfaceStatusClass(state)}`}
                  >
                    {surfaceStatusLabel(state)}
                  </span>
                  {state.kind === "custom" ? (
                    <button
                      type="button"
                      className={styles.rowAction}
                      disabled={pending}
                      onClick={() => resetOne.mutate(id)}
                    >
                      {t("恢复默认", "Reset")}
                    </button>
                  ) : null}
                </div>
                <div className={styles.hostMeta}>
                  <span>{capabilityText(view, state)}</span>
                  <span>{quotaText(view)}</span>
                  {state.reason ? (
                    <span
                      className={
                        state.kind === "blocked"
                          ? styles.metaReason
                          : styles.metaMuted
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
            {changes.length > 0
              ? t(
                  "{n} 台待改动（开启 {on} · 关闭 {off}）",
                  "{n} pending (on {on} · off {off})",
                  {
                    n: changes.length,
                    on: turningOn,
                    off: turningOff,
                  },
                )
              : t("勾选或取消勾选主机后保存", "Toggle a host, then save")}
          </span>
          <div className={styles.batchActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={pending || changes.length === 0}
              onClick={() => setDraft({})}
            >
              {t("放弃改动", "Discard")}
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={pending || changes.length === 0}
              onClick={() => save.mutate()}
            >
              {save.isPending
                ? t("保存中…", "Saving…")
                : t("保存改动（{n}）", "Save changes ({n})", {
                    n: changes.length,
                  })}
            </button>
          </div>
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
/* 按主机配置（逐面开关 / 恢复默认）                                            */
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
              "单机编辑：可以逐面开关；「恢复默认」会删掉这台机器的授权行（当前默认是全关，与采集面一致）。",
              "Per-host editing: toggle surfaces; “Reset” deletes this host's grant row (the default is deny-all, same as collection families).",
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
                    ? t("跟随网关默认（旧构建）", "Gateway default (old build)")
                    : t("本机已授权", "Granted on this host")}
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
              {selected.length === 0 ? (
                <p className={styles.warn}>
                  {t(
                    "这台机器现在一个调查面都没开（默认全关，与采集面一致）：勾选要开的面后保存。",
                    "No surface is granted on this host (deny-by-default, same as collection families): tick the surfaces you need and save.",
                  )}
                </p>
              ) : null}
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
                  {t("恢复默认", "Reset")}
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
