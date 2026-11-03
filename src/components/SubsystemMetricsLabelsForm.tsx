import { useMemo, useState } from "react";
import { ApiError, METRIC_LABEL_KEYS, isRateLimitedError } from "../api";
import type { AgentMetricsLabelsView, MetricLabelKey } from "../api";
import { t } from "../i18n";
import {
  describeLabelSource,
  diffOverrides,
  draftFromOverrides,
  labelKeyMeta,
  previewLabels,
  validateLabelDraft,
  type LabelDraft,
} from "../lib/metricsLabels";
import { RateLimitNotice } from "./RateLimitNotice";
import styles from "./SubsystemMetricsLabelsForm.module.css";

interface SubsystemMetricsLabelsFormProps {
  view: AgentMetricsLabelsView;
  submitting?: boolean;
  /** 保存 / 清空失败的原因（成功时为 `undefined`）。 */
  error?: unknown;
  onSubmit: (overrides: Partial<Record<MetricLabelKey, string | null>>) => void;
  onClear: () => void;
}

/**
 * 逐键编辑选择类 label。
 *
 * 展示的是**手工覆盖**而不是生效值：输入框留空 = 这台机器没有该键的手工覆盖，
 * 此时回落到网关推断 / 部署默认。所以「删掉一个覆盖」与「值刚好等于推断值」在界面上
 * 是两件事 —— 前者要写一条空覆盖，后者什么都不写。
 */
export function SubsystemMetricsLabelsForm({
  view,
  submitting,
  error,
  onSubmit,
  onClear,
}: SubsystemMetricsLabelsFormProps) {
  const meta = labelKeyMeta();
  const [draft, setDraft] = useState<LabelDraft>(() =>
    draftFromOverrides(view.overrides),
  );
  const [confirmingClear, setConfirmingClear] = useState(false);

  // 只在「版本变了」时重放草稿（渲染期调整 state，不用 effect）：
  //   * 同一版本的重新渲染（例如切换语言、父组件刷新）不能覆盖正在输入的内容；
  //   * 用 effect 会先渲染一帧空输入框，数据到达时再填进来，看起来像被清空了。
  const loadKey = `${view.agentId}#${view.revision}`;
  const [loadedKey, setLoadedKey] = useState(loadKey);
  if (loadedKey !== loadKey) {
    setLoadedKey(loadKey);
    setDraft(draftFromOverrides(view.overrides));
    setConfirmingClear(false);
  }

  const changes = useMemo(
    () => diffOverrides(draft, view.overrides),
    [draft, view.overrides],
  );
  const preview = useMemo(
    () => previewLabels(view.labels, changes),
    [view.labels, changes],
  );
  const validation = useMemo(
    () => validateLabelDraft(draft, preview),
    [draft, preview],
  );

  const changedCount = Object.keys(changes).length;
  const canSubmit = changedCount > 0 && validation.ok && !submitting;

  function update(key: MetricLabelKey, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <form
      className={styles.container}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit(changes);
      }}
    >
      <header className={styles.header}>
        <h2 className={styles.title}>{t("手工覆盖", "Manual overrides")}</h2>
        <span className={styles.subtitle}>
          {t(
            "留空 = 不覆盖，回落到网关推断 / 部署默认。保存后网关会让该 Agent 立刻刷新，最迟 5 分钟自动生效。",
            "Empty means no override: the value falls back to what the gateway inferred or the deployment default. After saving, the gateway asks the agent to refresh; it applies within 5 minutes at the latest.",
          )}
        </span>
      </header>

      <div className={styles.grid}>
        {METRIC_LABEL_KEYS.map((key) => {
          const info = meta[key];
          const effective = view.labels[key];
          const source = view.sources[key];
          const fieldError = validation.fieldErrors[key];
          return (
            <div className={styles.row} key={key}>
              <div className={styles.rowHead}>
                <code className={styles.key}>{key}</code>
                {source ? (
                  <span className={styles.source} data-source={source}>
                    {describeLabelSource(source)}
                  </span>
                ) : null}
              </div>

              {info.choices ? (
                <select
                  className={styles.control}
                  aria-label={t(
                    "{key} 的手工覆盖",
                    "Manual override for {key}",
                    { key },
                  )}
                  value={draft[key]}
                  onChange={(event) => update(key, event.target.value)}
                >
                  <option value="">{t("（不覆盖）", "(no override)")}</option>
                  {info.choices.map((choice) => (
                    <option key={choice} value={choice}>
                      {choice}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={styles.control}
                  aria-label={t(
                    "{key} 的手工覆盖",
                    "Manual override for {key}",
                    { key },
                  )}
                  placeholder={effective ?? t("（不覆盖）", "(no override)")}
                  value={draft[key]}
                  // 值文法只允许小写：边输边转，别让人敲完才被告知不合法。
                  onChange={(event) =>
                    update(key, event.target.value.toLowerCase())
                  }
                  spellCheck={false}
                />
              )}

              <div className={styles.rowFoot}>
                <span className={styles.effective}>
                  {t("生效值", "Effective")}{" "}
                  {effective ? (
                    <strong className={styles.effectiveValue}>
                      {effective}
                    </strong>
                  ) : (
                    <span className={styles.effectiveEmpty}>
                      {t("（空）", "(empty)")}
                    </span>
                  )}
                </span>
                {draft[key] ? (
                  <button
                    className={styles.linkButton}
                    type="button"
                    onClick={() => update(key, "")}
                  >
                    {t("清除覆盖", "Clear override")}
                  </button>
                ) : null}
              </div>

              <p
                className={fieldError ? styles.rowError : styles.rowHint}
                role={fieldError ? "alert" : undefined}
              >
                {fieldError ?? info.hint}
              </p>
            </div>
          );
        })}
      </div>

      {validation.issues.length > 0 ? (
        <ul className={styles.issues}>
          {validation.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}

      {error ? (
        isRateLimitedError(error) ? (
          <RateLimitNotice error={error} />
        ) : (
          <div className={styles.errorBanner} role="alert">
            {describeSaveError(error)}
          </div>
        )
      ) : null}

      <div className={styles.actions}>
        <button
          className={styles.primaryButton}
          type="submit"
          disabled={!canSubmit}
        >
          {submitting
            ? t("保存中…", "Saving…")
            : changedCount > 0
              ? t("保存 {n} 项修改", "Save {n} changes", { n: changedCount })
              : t("保存修改", "Save changes")}
        </button>
        <button
          className={
            confirmingClear ? styles.dangerButton : styles.secondaryButton
          }
          type="button"
          disabled={submitting || view.revision === 0}
          onClick={() => {
            if (!confirmingClear) {
              setConfirmingClear(true);
              return;
            }
            setConfirmingClear(false);
            onClear();
          }}
        >
          {confirmingClear
            ? t("确认清空全部覆盖", "Confirm: clear all overrides")
            : t("清空全部覆盖", "Clear all overrides")}
        </button>
        {confirmingClear ? (
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => setConfirmingClear(false)}
          >
            {t("取消", "Cancel")}
          </button>
        ) : null}
      </div>
    </form>
  );
}

/** 保存失败的原因。稳定原因码在前 —— 它才是能搜、能贴给别人看的那一半。 */
function describeSaveError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code && error.detail) {
      return t(
        "保存失败（{code}）：{detail}",
        "Save failed ({code}): {detail}",
        { code: error.code, detail: error.detail },
      );
    }
    if (error.code) {
      return t("保存失败（{code}）", "Save failed ({code})", {
        code: error.code,
      });
    }
    return t("保存失败：HTTP {status}", "Save failed: HTTP {status}", {
      status: error.status,
    });
  }
  return t("保存失败：{message}", "Save failed: {message}", {
    message: error instanceof Error ? error.message : String(error),
  });
}
