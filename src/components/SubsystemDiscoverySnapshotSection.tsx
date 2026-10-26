import { Fragment, useState, type FormEvent } from "react";
import { ApiError, isRateLimitedError } from "../api";
import type {
  DiscoverySnapshotAgentRow,
  DiscoverySnapshotView,
} from "../api";
import {
  useClearAgentDiscoverySnapshot,
  useClearDiscoverySnapshotGlobal,
  useDiscoverySnapshot,
  useSetAgentDiscoverySnapshot,
  useSetDiscoverySnapshotGlobal,
} from "../hooks";
import { dateLocale, t } from "../i18n";
import { RateLimitNotice } from "./RateLimitNotice";
import {
  SNAPSHOT_INTERVAL_PRESETS,
  formatSnapshotInterval,
  snapshotDivergence,
  snapshotDraftFrom,
  snapshotDraftInterval,
  snapshotDraftState,
  snapshotExpectedSetting,
  snapshotPresetOf,
  snapshotSourceLabel,
  type SnapshotDraft,
} from "./discoverySnapshotForm";
import styles from "./SubsystemDiscoverySnapshotSection.module.css";

/**
 * 原文快照（DSNAP）上送设置：全局默认 + 按机器的单机覆盖。
 *
 * 为什么单独一张卡：快照周期以前只能逐台改 agentd 的 toml，资产变化快的主机没法单独调密；
 * 现在控制面下发，优先级是「单机覆盖 > 全局设置 > Agent 本机配置」。这一屏的核心不是
 * 「改设置」本身，而是**看清配置与实际生效是否一致** —— 所以每一行都把两层值并排放。
 */

function formatTime(value: string | null): string {
  if (!value) return "—";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString(dateLocale(), { hour12: false });
}

/** 一层设置的人读摘要：开关 + 周期（`applied` 与设置对象共用这一份显示口径）。 */
function settingSummary(setting: {
  enabled: boolean;
  intervalSeconds: number;
}): string {
  return t("{state} · 每 {interval}", "{state} · every {interval}", {
    state: setting.enabled ? t("启用", "On") : t("关闭", "Off"),
    interval: formatSnapshotInterval(setting.intervalSeconds),
  });
}

/**
 * 管理面错误 → 可见文案（读取与保存共用）。
 *
 * 400 的正文由网关写（周期下限等），原样透出；401 / 429 / 404 这几条是**确定性**错误，
 * 直接说「怎么办」，不让运维去猜。
 */
function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 400) {
      return error.detail ?? t("输入不成立（HTTP 400）。", "Invalid input (HTTP 400).");
    }
    if (error.status === 401) {
      return t(
        "Admin Token 缺失或无效：请在右上角点钥匙按钮，粘贴 Admin Token 后点击“应用”。",
        'Admin Token missing or invalid: click the key button in the top bar, paste the Admin Token and click "Apply".',
      );
    }
    if (error.status === 429) {
      return t(
        "认证失败次数过多，请稍后再试。",
        "Too many failed authentications — try again later.",
      );
    }
    if (error.status === 404) {
      return t(
        "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。",
        "The gateway has no such endpoint (HTTP 404): the running gateway is probably an old build — rebuild and restart the gateway, then retry.",
      );
    }
    return error.detail
      ? t(
          "网关返回 HTTP {status}：{detail}",
          "Gateway returned HTTP {status}: {detail}",
          { status: error.status, detail: error.detail },
        )
      : t(
          "网关返回 HTTP {status}，请检查网关日志。",
          "Gateway returned HTTP {status} — check the gateway logs.",
          { status: error.status },
        );
  }
  return fallback;
}

function loadErrorMessage(error: unknown): string {
  return apiErrorMessage(
    error,
    t(
      "读取失败：响应不符合当前契约，请检查网关与前端版本。",
      "Load failed: the response does not match the current contract — check the gateway and frontend versions.",
    ),
  );
}

function saveErrorMessage(error: unknown): string {
  return apiErrorMessage(
    error,
    t(
      "保存失败：响应不符合当前契约，请检查网关与前端版本。",
      "Save failed: the response does not match the current contract — check the gateway and frontend versions.",
    ),
  );
}

export function SubsystemDiscoverySnapshotSection() {
  const snapshot = useDiscoverySnapshot();
  const view = snapshot.data;

  return (
    <section
      className={styles.card}
      aria-labelledby="gateway-info-discovery-snapshot"
    >
      <header className={styles.cardHead}>
        <div className={styles.cardTitleRow}>
          <h2 id="gateway-info-discovery-snapshot">
            {t("原文快照上送", "Full snapshot uplink")}
          </h2>
          <span className={styles.cardChip}>{t("可改", "Editable")}</span>
        </div>
        <p className={styles.cardNote}>
          {t(
            "资产清单（进程 / 端口 / 容器）只写在原文快照里，快照送到中心资产目录（atlas）。这里控制它的上送周期。",
            "The asset inventory (processes / ports / containers) only exists in full snapshots, which are sent to the central asset catalog (atlas). This controls how often they are sent.",
          )}
        </p>
        <p className={styles.priorityNote}>
          {t(
            "优先级：单机覆盖 > 全局设置 > Agent 本机配置。两层都没设置时，机器按自己的 toml 跑。",
            "Priority: per-agent override > global setting > the agent's own config. When neither layer is set, each host keeps running on its own toml.",
          )}
        </p>
      </header>

      {snapshot.isLoading ? (
        <div className={styles.body}>
          <div className={styles.notice} role="status">
            {t("正在读取原文快照设置…", "Reading snapshot settings…")}
          </div>
        </div>
      ) : null}

      {snapshot.isError ? (
        <div className={styles.body}>
          {isRateLimitedError(snapshot.error) ? (
            <RateLimitNotice error={snapshot.error} />
          ) : (
            <div className={styles.noticeDanger} role="alert">
              {loadErrorMessage(snapshot.error)}
            </div>
          )}
        </div>
      ) : null}

      {view ? (
        <div className={styles.body}>
          <GlobalSnapshotPanel view={view} />
          <AgentSnapshotPanel view={view} />
        </div>
      ) : null}
    </section>
  );
}

/** 全局设置：一条控制面默认值，保存后对已在网 Agent 的下一个轮询（≤30s）生效。 */
function GlobalSnapshotPanel({ view }: { view: DiscoverySnapshotView }) {
  const setGlobal = useSetDiscoverySnapshotGlobal();
  const clearGlobal = useClearDiscoverySnapshotGlobal();

  const setting = view.global;
  // 与**服务端当前值**比对：保存成功后查询重取，表单自然回到「没有改动」。
  const serverDraft = snapshotDraftFrom(setting);
  const [draft, setDraft] = useState<SnapshotDraft>(() => serverDraft);
  // 当前值不在预设里时自动进「自定义」态（例如别处写入了 420 秒）。
  const [customInterval, setCustomInterval] = useState(
    () => snapshotPresetOf(snapshotDraftInterval(serverDraft)) === null,
  );
  const [confirmClear, setConfirmClear] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const pending = setGlobal.isPending || clearGlobal.isPending;
  const form = snapshotDraftState(
    serverDraft,
    draft,
    view.minIntervalSeconds,
    pending,
    // 全局从未设置过时，表单里的值就是「将要创建的值」——允许直接落一条
    // 「关闭 + 默认周期」的全局（否则它等于空表单初值，永远不算 dirty）。
    setting !== null,
  );

  function updateDraft(patch: Partial<SnapshotDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setSavedNote(null);
  }

  function choosePreset(seconds: number) {
    setCustomInterval(false);
    updateDraft({ interval: String(seconds) });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.canSubmit) return;
    setSavedNote(null);
    setGlobal.mutate(
      {
        enabled: draft.enabled,
        intervalSeconds: snapshotDraftInterval(draft),
      },
      {
        onSuccess: (created) =>
          setSavedNote(
            t(
              "已保存全局设置：{summary}",
              "Global setting saved: {summary}",
              { summary: settingSummary(created) },
            ),
          ),
      },
    );
  }

  function handleClear() {
    clearGlobal.mutate(undefined, {
      onSuccess: () => {
        setConfirmClear(false);
        setCustomInterval(false);
        // 清掉后服务端是「没有这一层设置」：把表单拉回未启用 + 默认周期，
        // 否则旧值还留在输入框里、保存按钮看起来像有未提交的改动。
        setDraft(snapshotDraftFrom(null));
        setSavedNote(
          t(
            "已清除全局设置：所有机器回落到各自的本机配置。",
            "Global setting cleared: every host falls back to its own local config.",
          ),
        );
      },
    });
  }

  const activePreset = customInterval
    ? null
    : snapshotPresetOf(snapshotDraftInterval(draft));
  // 当前值不在预设里就自动露出数字输入（例如别处写入了 420 秒，
  // 或用户在自定义里输入了非预设值）—— 不能让人看到「一个都没选中」却没有输入框。
  const showCustomInterval =
    customInterval || snapshotPresetOf(snapshotDraftInterval(draft)) === null;

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <h3 className={styles.panelTitle}>{t("全局设置", "Global setting")}</h3>
        {setting ? (
          <span className={styles.panelMeta}>
            {t("最后修改：{at}", "Last edited: {at}", {
              at: `${formatTime(setting.updatedAt)} · ${setting.updatedBy}`,
            })}
          </span>
        ) : (
          <span className={styles.panelMetaMuted}>
            {t(
              "未设置：机器各按本机配置跑",
              "Not set: hosts use their local config",
            )}
          </span>
        )}
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => updateDraft({ enabled: event.target.checked })}
          />
          <span>
            {t(
              "启用全局原文快照上送（本网关所有 Agent 的默认）",
              "Enable full snapshot uplink globally (default for every agent in this gateway)",
            )}
          </span>
        </label>

        <div className={styles.intervalRow}>
          <span className={styles.intervalLabel}>{t("上送周期", "Interval")}</span>
          <div
            className={styles.presetGroup}
            role="group"
            aria-label={t("上送周期预设", "Snapshot interval presets")}
          >
            {SNAPSHOT_INTERVAL_PRESETS.map((seconds) => (
              <button
                key={seconds}
                type="button"
                className={
                  activePreset === seconds
                    ? styles.presetActive
                    : styles.presetButton
                }
                aria-pressed={activePreset === seconds}
                onClick={() => choosePreset(seconds)}
              >
                {formatSnapshotInterval(seconds)}
              </button>
            ))}
            <button
              type="button"
              className={
                showCustomInterval ? styles.presetActive : styles.presetButton
              }
              aria-pressed={showCustomInterval}
              onClick={() => setCustomInterval(true)}
            >
              {t("自定义", "Custom")}
            </button>
          </div>
        </div>

        {showCustomInterval ? (
          <label className={styles.customField}>
            {t("自定义周期（秒）", "Custom interval (seconds)")}
            <input
              type="number"
              min={view.minIntervalSeconds}
              step={1}
              inputMode="numeric"
              value={draft.interval}
              onChange={(event) => updateDraft({ interval: event.target.value })}
              aria-invalid={!form.intervalOk}
            />
            <small>
              {t(
                "最小 {min} 秒；周期越短，机器与中心的负载越高。",
                "Minimum {min} seconds; shorter intervals cost more on both the host and the center.",
                { min: view.minIntervalSeconds },
              )}
            </small>
          </label>
        ) : null}

        {form.validationError ? (
          <div className={styles.formHint} role="alert">
            {form.validationError}
          </div>
        ) : null}

        <div className={styles.actions}>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={!form.canSubmit}
          >
            {setGlobal.isPending
              ? t("保存中…", "Saving…")
              : t("保存全局设置", "Save global setting")}
          </button>

          {setting ? (
            confirmClear ? (
              <span className={styles.inlineConfirm}>
                <span>
                  {t(
                    "确认清除全局设置？清除后所有机器回落本机配置。",
                    "Clear the global setting? Every host will fall back to its local config.",
                  )}
                </span>
                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={handleClear}
                  disabled={clearGlobal.isPending}
                >
                  {clearGlobal.isPending
                    ? t("清除中…", "Clearing…")
                    : t("确认清除", "Clear")}
                </button>
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={() => setConfirmClear(false)}
                  disabled={clearGlobal.isPending}
                >
                  {t("取消", "Cancel")}
                </button>
              </span>
            ) : (
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => setConfirmClear(true)}
                disabled={clearGlobal.isPending}
              >
                {t("清除全局设置", "Clear global setting")}
              </button>
            )
          ) : null}
        </div>

        {setGlobal.isError ? (
          isRateLimitedError(setGlobal.error) ? (
            <RateLimitNotice error={setGlobal.error} />
          ) : (
            <div className={styles.errorBanner} role="alert">
              {saveErrorMessage(setGlobal.error)}
            </div>
          )
        ) : null}
        {clearGlobal.isError ? (
          isRateLimitedError(clearGlobal.error) ? (
            <RateLimitNotice error={clearGlobal.error} />
          ) : (
            <div className={styles.errorBanner} role="alert">
              {saveErrorMessage(clearGlobal.error)}
            </div>
          )
        ) : null}
        {savedNote ? (
          <div className={styles.formNotice} role="status">
            {savedNote}
          </div>
        ) : null}
      </form>
    </div>
  );
}

/** 每台一台一行：单机覆盖 / 实际生效 / 来源，并把「配置与实际不一致」的行标出来。 */
function AgentSnapshotPanel({ view }: { view: DiscoverySnapshotView }) {
  const setOverride = useSetAgentDiscoverySnapshot();
  const clearOverride = useClearAgentDiscoverySnapshot();

  // 「正在编辑哪一行」与草稿放在同一个状态里：若拆成两个 state，一次保存的返回
  // 可能把**另一行**刚打开的编辑态关掉（两个 setState 之间没有原子性）。
  const [editing, setEditing] = useState<{
    agentId: string;
    draft: SnapshotDraft;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function beginEdit(row: DiscoverySnapshotAgentRow) {
    // 新一次编辑从干净的错误态开始（上一次失败的红条不该跟过来）。
    setOverride.reset();
    clearOverride.reset();
    // 预填「这台当前**应当**生效的值」：有覆盖用覆盖，否则用全局，
    // 两层都没有才落到未启用 + 默认周期。
    setEditing({
      agentId: row.agentId,
      draft: snapshotDraftFrom(row.overrideSetting ?? view.global),
    });
    setNotice(null);
  }

  function cancelEdit() {
    setEditing(null);
  }

  function updateDraft(patch: Partial<SnapshotDraft>) {
    setEditing((current) =>
      current
        ? { ...current, draft: { ...current.draft, ...patch } }
        : current,
    );
    setNotice(null);
  }

  function saveRow(row: DiscoverySnapshotAgentRow) {
    const draft =
      editing?.agentId === row.agentId ? editing.draft : null;
    if (!draft) return;
    const base = snapshotDraftFrom(row.overrideSetting ?? view.global);
    const state = snapshotDraftState(
      base,
      draft,
      view.minIntervalSeconds,
      false,
    );
    if (!state.canSubmit) return;
    setOverride.mutate(
      {
        agentId: row.agentId,
        command: {
          enabled: draft.enabled,
          intervalSeconds: snapshotDraftInterval(draft),
        },
      },
      {
        onSuccess: (created) => {
          // 只关这一台的编辑态（用户可能在等待期间又打开了另一行）。
          setEditing((current) =>
            current?.agentId === row.agentId ? null : current,
          );
          setNotice(
            t(
              "已保存 {agent} 的单机覆盖：{summary}",
              "Override saved for {agent}: {summary}",
              { agent: row.agentId, summary: settingSummary(created) },
            ),
          );
        },
      },
    );
  }

  function clearRow(row: DiscoverySnapshotAgentRow) {
    clearOverride.mutate(row.agentId, {
      onSuccess: () => {
        setEditing((current) =>
          current?.agentId === row.agentId ? null : current,
        );
        setNotice(
          t(
            "已清除 {agent} 的单机覆盖：回落到{fallback}。",
            "Override cleared for {agent}: falling back to {fallback}.",
            {
              agent: row.agentId,
              fallback: view.global
                ? t("全局设置", "the global setting")
                : t("本机配置", "the local config"),
            },
          ),
        );
      },
    });
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <h3 className={styles.panelTitle}>
          {t("按机器生效情况", "Per-agent state")}
        </h3>
        {view.agents.length > 0 ? (
          <span className={styles.panelMeta}>
            {t("{n} 台机器", "{n} hosts", { n: view.agents.length })}
          </span>
        ) : null}
      </div>

      {notice ? (
        <div className={styles.formNotice} role="status">
          {notice}
        </div>
      ) : null}
      {setOverride.isError ? (
        isRateLimitedError(setOverride.error) ? (
          <RateLimitNotice error={setOverride.error} />
        ) : (
          <div className={styles.errorBanner} role="alert">
            {saveErrorMessage(setOverride.error)}
          </div>
        )
      ) : null}
      {clearOverride.isError ? (
        isRateLimitedError(clearOverride.error) ? (
          <RateLimitNotice error={clearOverride.error} />
        ) : (
          <div className={styles.errorBanner} role="alert">
            {saveErrorMessage(clearOverride.error)}
          </div>
        )
      ) : null}

      {view.agents.length === 0 ? (
        <div className={styles.empty}>
          {t(
            "还没有已注册的 Agent：机器入网后会出现在这里。",
            "No enrolled agents yet — hosts appear here once they enroll.",
          )}
        </div>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("Agent", "Agent")}</th>
                <th>{t("单机覆盖", "Override")}</th>
                <th>{t("实际生效", "Effective")}</th>
                <th>{t("来源", "Source")}</th>
                <th className={styles.actionsHead}>
                  {t("操作", "Actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {view.agents.map((row) => {
                const expected = snapshotExpectedSetting(
                  view.global,
                  row.overrideSetting,
                );
                const divergent = snapshotDivergence(expected, row.applied);
                const base = snapshotDraftFrom(
                  row.overrideSetting ?? view.global,
                );
                const draft =
                  editing?.agentId === row.agentId ? editing.draft : null;
                const editingThisRow = draft !== null;
                const savingRow =
                  setOverride.isPending &&
                  setOverride.variables?.agentId === row.agentId;
                const clearingRow =
                  clearOverride.isPending &&
                  clearOverride.variables === row.agentId;
                const rowPending = savingRow || clearingRow;
                const rowForm = snapshotDraftState(
                  base,
                  draft ?? base,
                  view.minIntervalSeconds,
                  rowPending,
                );
                // 分叉说明放进 `title`：表格里放不下整句，但鼠标悬停要能读到
                // 「配置要求什么、实际是什么」。
                const divergenceHint =
                  divergent && expected && row.applied
                    ? t(
                        "配置要求：{expected}；实际生效：{applied}（{source}）",
                        "Configured: {expected}; effective: {applied} ({source})",
                        {
                          expected: settingSummary(expected),
                          applied: settingSummary(row.applied),
                          source: snapshotSourceLabel(row.applied.source),
                        },
                      )
                    : undefined;

                return (
                  <Fragment key={row.agentId}>
                    <tr
                      className={
                        divergent ? styles.rowDivergent : styles.row
                      }
                      title={divergenceHint}
                    >
                      <td className={styles.agentCell}>
                        <span className={styles.agentId}>{row.agentId}</span>
                      </td>
                      <td>
                        {row.overrideSetting ? (
                          <>
                            <span className={styles.valuePrimary}>
                              {settingSummary(row.overrideSetting)}
                            </span>
                            <span className={styles.valueMeta}>
                              {formatTime(row.overrideSetting.updatedAt)} ·{" "}
                              {row.overrideSetting.updatedBy}
                            </span>
                          </>
                        ) : (
                          <span className={styles.valueMuted}>
                            {view.global
                              ? t("继承全局", "Inherits global")
                              : t("本机配置", "Local config")}
                          </span>
                        )}
                      </td>
                      <td>
                        {row.applied ? (
                          <span
                            className={
                              divergent
                                ? styles.valueDivergent
                                : styles.valuePrimary
                            }
                          >
                            {settingSummary(row.applied)}
                          </span>
                        ) : (
                          <span className={styles.valueMuted}>
                            {t("尚未回传", "Not reported yet")}
                          </span>
                        )}
                      </td>
                      <td>
                        {row.applied ? (
                          <>
                            <span className={styles.sourceLabel}>
                              {snapshotSourceLabel(row.applied.source)}
                            </span>
                            <span className={styles.valueMeta}>
                              {t("自 {at} 起", "since {at}", {
                                at: formatTime(row.applied.since),
                              })}
                            </span>
                          </>
                        ) : (
                          <span className={styles.valueMuted}>—</span>
                        )}
                      </td>
                      <td className={styles.actionsCell}>
                        {editingThisRow ? (
                          <span className={styles.valueMuted}>
                            {t("编辑中", "Editing")}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={styles.textButton}
                            onClick={() => beginEdit(row)}
                            disabled={rowPending}
                          >
                            {t("编辑", "Edit")}
                          </button>
                        )}
                      </td>
                    </tr>

                    {editingThisRow && draft ? (
                      <tr className={styles.editorRow}>
                        <td colSpan={5}>
                          <form
                            className={styles.rowEditor}
                            onSubmit={(event) => {
                              event.preventDefault();
                              saveRow(row);
                            }}
                          >
                            <div className={styles.rowEditorHead}>
                              <span className={styles.rowEditorTitle}>
                                {t(
                                  "编辑 {agent} 的单机覆盖",
                                  "Edit the override for {agent}",
                                  { agent: row.agentId },
                                )}
                              </span>
                              <span className={styles.rowEditorHint}>
                                {row.overrideSetting
                                  ? t(
                                      "保存后覆盖全局；清除则回落到{fallback}。",
                                      "Saving overrides the global setting; clearing falls back to {fallback}.",
                                      {
                                        fallback: view.global
                                          ? t("全局设置", "the global setting")
                                          : t("本机配置", "the local config"),
                                      },
                                    )
                                  : t(
                                      "这台当前没有单机覆盖，保存后立即覆盖全局与本机配置。",
                                      "This host has no override yet; saving overrides both the global setting and the local config.",
                                    )}
                              </span>
                            </div>

                            <div className={styles.rowEditorControls}>
                              <label className={styles.checkRow}>
                                <input
                                  type="checkbox"
                                  checked={draft.enabled}
                                  onChange={(event) =>
                                    updateDraft({
                                      enabled: event.target.checked,
                                    })
                                  }
                                />
                                <span>
                                  {t(
                                    "启用原文快照上送",
                                    "Enable full snapshot uplink",
                                  )}
                                </span>
                              </label>
                              <label className={styles.customField}>
                                {t("周期（秒）", "Interval (seconds)")}
                                <input
                                  type="number"
                                  min={view.minIntervalSeconds}
                                  step={1}
                                  inputMode="numeric"
                                  value={draft.interval}
                                  onChange={(event) =>
                                    updateDraft({ interval: event.target.value })
                                  }
                                  aria-invalid={!rowForm.intervalOk}
                                />
                              </label>
                            </div>

                            {rowForm.validationError ? (
                              <div className={styles.formHint} role="alert">
                                {rowForm.validationError}
                              </div>
                            ) : null}

                            <div className={styles.actions}>
                              <button
                                type="submit"
                                className={styles.primaryButton}
                                disabled={!rowForm.canSubmit}
                              >
                                {savingRow
                                  ? t("保存中…", "Saving…")
                                  : t("保存", "Save")}
                              </button>
                              <button
                                type="button"
                                className={styles.ghostButton}
                                onClick={cancelEdit}
                                disabled={rowPending}
                              >
                                {t("取消", "Cancel")}
                              </button>
                              {row.overrideSetting ? (
                                <button
                                  type="button"
                                  className={styles.dangerGhostButton}
                                  onClick={() => clearRow(row)}
                                  disabled={rowPending}
                                >
                                  {clearingRow
                                    ? t("清除中…", "Clearing…")
                                    : t("清除覆盖", "Clear override")}
                                </button>
                              ) : null}
                            </div>
                          </form>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
