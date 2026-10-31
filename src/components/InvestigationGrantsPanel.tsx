import { useMemo, useState } from "react";
import { getAdminApiToken } from "../api";
import {
  useAgentInvestigations,
  useRegisteredAgents,
  useResetAgentInvestigationGrant,
  useSetAgentInvestigationGrant,
} from "../hooks";
import { t } from "../i18n";
import styles from "./InvestigationGrantsPanel.module.css";

/** 网关只认词表里的题目（新增题目要网关 + agentd 两侧一起加）。 */
const TOPICS = ["disk", "load"] as const;

function topicLabel(topic: string): string {
  if (topic === "disk") {
    return t("disk（磁盘与文件）", "disk (storage & files)");
  }
  if (topic === "load") {
    return t("load（负载、CPU 与内存）", "load (CPU & memory)");
  }
  return topic;
}

interface InvestigationGrantsPanelProps {
  /** 从别处深链进来时预选的主机（`?agent=<id>`）。 */
  initialAgentId?: string | null;
}

/**
 * 调查授权（**按机器**的下界）。
 *
 * 为什么放在「授权」页而不是调查页：授权是**管理动作**（谁能在哪台机器上读什么），
 * 与「发起一次调查 / 看报告」是两件事 —— 放在一起会让人以为不授权就看不到已有报告。
 */
export function InvestigationGrantsPanel({
  initialAgentId = null,
}: InvestigationGrantsPanelProps) {
  const agentsQuery = useRegisteredAgents();
  const agents = useMemo(
    () => (agentsQuery.data ?? []).slice().sort((a, b) => a.agentId.localeCompare(b.agentId)),
    [agentsQuery.data],
  );
  const [picked, setPicked] = useState<string | null>(initialAgentId);
  const agentId = picked ?? agents[0]?.agentId ?? "";
  const view = useAgentInvestigations(agentId);
  const data = view.data;
  const hasToken = Boolean(getAdminApiToken());

  const ceiling = data?.allowedTopics ?? null;
  const capabilities = data?.capabilities ?? null;
  /** 继承时勾选状态就是网关默认（不是空）—— 否则人会以为“一个都没开”。 */
  const serverTopics = data?.grant?.inherited
    ? (ceiling ?? [])
    : (data?.grant?.topics ?? (ceiling ?? []));
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
    <section className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t("调查授权", "Investigation grants")}</h1>
        <p className={styles.summary}>
          {t(
            "按机器决定「这台能不能查、能查哪几面」。网关配置里的 allowed_topics 是上界（环境策略，改完重启），这里只能在它之内收窄，改动即时生效，只影响下发。",
            "Decide per host whether it may investigate and which surfaces it may use. The gateway's allowed_topics is the ceiling (environment policy, needs a restart); this page can only narrow within it, takes effect immediately, and only affects dispatching.",
          )}
        </p>
      </header>

      <div className={styles.picker}>
        <label className={styles.field}>
          <span>{t("主机", "Host")}</span>
          <select
            value={agentId}
            onChange={(event) => {
              setPicked(event.target.value);
              resetDraft();
            }}
            disabled={agents.length === 0}
          >
            {agents.length === 0 ? (
              <option value="">{t("还没有已登记的 Agent", "No registered agents yet")}</option>
            ) : null}
            {agents.map((agent) => (
              <option key={agent.agentId} value={agent.agentId}>
                {agent.hostname ? `${agent.hostname} · ${agent.agentId}` : agent.agentId}
              </option>
            ))}
          </select>
        </label>
      </div>

      {agentsQuery.isError ? (
        <p className={styles.error}>
          {t("读取主机列表失败，请检查 Admin Token 与网关。", "Failed to load hosts; check the Admin Token and the gateway.")}
        </p>
      ) : null}

      {agentId === "" ? null : view.isLoading ? (
        <p className={styles.note}>{t("读取中…", "Loading…")}</p>
      ) : view.error ? (
        <p className={styles.error}>
          {t("读取这台机器的授权失败。", "Failed to load this host's grants.")}
        </p>
      ) : data ? (
        <>
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
                ? t("尚未上报（旧 agentd / 刚升级）", "Not reported yet (old agentd / just upgraded)")
                : `${capabilities.surfaces.map(topicLabel).join("、")}${
                    capabilities.privileged
                      ? t("（root：完整答案）", " (root: complete answers)")
                      : t("（非 root：部分答案）", " (non-root: partial answers)")
                  }`}
            </dd>
          </dl>

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
                <strong>{t("这台机器开哪几面", "Surfaces enabled on this host")}</strong>
                <span className={styles.badge}>
                  {data.grant.inherited
                    ? t("继承网关默认", "Inherits gateway default")
                    : t("本机自定义", "Custom for this host")}
                </span>
                {data.grant.updatedBy ? (
                  <span className={styles.note}>
                    {t("最近修改", "Last change")}: <code>{data.grant.updatedBy}</code>{" "}
                    {data.grant.updatedAt ?? "—"}
                  </span>
                ) : null}
              </div>
              <div className={styles.options}>
                {TOPICS.map((topic) => {
                  const inCeiling = (ceiling ?? []).includes(topic);
                  const supported = capabilities?.surfaces.includes(topic) ?? false;
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
                  onClick={() => setGrant.mutate(selected, { onSuccess: resetDraft })}
                >
                  {setGrant.isPending ? t("保存中…", "Saving…") : t("保存授权", "Save grant")}
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={
                    !hasToken || pending || ((data.grant?.inherited ?? true) && draft === null)
                  }
                  onClick={() => resetGrant.mutate(undefined, { onSuccess: resetDraft })}
                >
                  {t("恢复继承", "Inherit again")}
                </button>
              </div>
              {setGrant.error || resetGrant.error ? (
                <p className={styles.error}>
                  {t("保存失败：参数越界或网络异常（上界与词表见上表）。", "Save failed: out of range or network error (see the ceiling above).")}
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
    </section>
  );
}
