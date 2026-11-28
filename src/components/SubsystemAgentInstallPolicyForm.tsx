import { useState } from "react";
import { t } from "../i18n";
import styles from "./SubsystemAgentInstallPolicyForm.module.css";
import { adminApiErrorMessage } from "./adminApiError";
import { useAgentInstallPolicy, useSetAgentInstallPolicy } from "../hooks";

/**
 * 批量安装策略（有效期 + 台数上限）。
 *
 * 只影响**之后生成**的批量 Token：已经发出去的码按它自己的窗口 / 台数走，
 * 不会被改设置提前作废，也不会被放宽。上限由后端 `limits` 下发，页面不再硬编码一份。
 */
export function SubsystemAgentInstallPolicyForm() {
  const policy = useAgentInstallPolicy();
  const save = useSetAgentInstallPolicy();
  const [editing, setEditing] = useState(false);
  const [ttlSeconds, setTtlSeconds] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const data = policy.data;

  const beginEdit = () => {
    setTtlSeconds(String(data?.batchTtlSeconds ?? ""));
    setMaxUses(String(data?.batchMaxUses ?? ""));
    setLocalError(null);
    save.reset();
    setEditing(true);
  };

  const submit = () => {
    if (!data) return;
    const ttl = Number(ttlSeconds);
    const uses = Number(maxUses);
    const limits = data.limits;
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > limits.batchTtlSeconds) {
      setLocalError(
        t(
          `有效期需为 1–${limits.batchTtlSeconds} 秒的整数`,
          `Validity must be an integer between 1 and ${limits.batchTtlSeconds} seconds`,
        ),
      );
      return;
    }
    if (!Number.isInteger(uses) || uses < 1 || uses > limits.batchMaxUses) {
      setLocalError(
        t(
          `台数上限需为 1–${limits.batchMaxUses} 的整数`,
          `Host cap must be an integer between 1 and ${limits.batchMaxUses}`,
        ),
      );
      return;
    }
    setLocalError(null);
    save.mutate(
      {
        batchTtlSeconds: ttl,
        batchMaxUses: uses,
        requestedBy: "admin-console",
      },
      { onSuccess: () => setEditing(false) },
    );
  };

  const errorText =
    localError ?? (save.isError ? adminApiErrorMessage(save.error) : null);

  return (
    <section className={styles.container}>
      <div className={styles.head}>
        <h2 className={styles.title}>
          {t("批量安装策略", "Batch install policy")}
        </h2>
        <p className={styles.hint}>
          {t(
            "决定之后生成的批量 Token 的有效期与最多可注册台数；已经发出去的码不受影响。",
            "Controls the validity window and host cap of tokens generated from now on; already issued tokens are unaffected.",
          )}
        </p>
      </div>
      {policy.isLoading ? (
        <p className={styles.hint}>{t("策略加载中...", "Loading policy...")}</p>
      ) : policy.isError ? (
        <p className={styles.error}>{adminApiErrorMessage(policy.error)}</p>
      ) : data ? (
        editing ? (
          <div className={styles.form}>
            <label className={styles.field}>
              <span>{t("有效期（秒）", "Validity (seconds)")}</span>
              <input
                type="number"
                min={1}
                max={data.limits.batchTtlSeconds}
                step={1}
                value={ttlSeconds}
                onChange={(event) => setTtlSeconds(event.target.value)}
                className={styles.input}
              />
              <span className={styles.fieldHint}>
                {t(
                  `允许范围 1–${data.limits.batchTtlSeconds}`,
                  `Allowed 1–${data.limits.batchTtlSeconds}`,
                )}
              </span>
            </label>
            <label className={styles.field}>
              <span>{t("最多可注册台数", "Max hosts")}</span>
              <input
                type="number"
                min={1}
                max={data.limits.batchMaxUses}
                step={1}
                value={maxUses}
                onChange={(event) => setMaxUses(event.target.value)}
                className={styles.input}
              />
              <span className={styles.fieldHint}>
                {t(
                  `允许范围 1–${data.limits.batchMaxUses}`,
                  `Allowed 1–${data.limits.batchMaxUses}`,
                )}
              </span>
            </label>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                onClick={submit}
                disabled={save.isPending}
              >
                {save.isPending
                  ? t("保存中...", "Saving...")
                  : t("保存", "Save")}
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => setEditing(false)}
                disabled={save.isPending}
              >
                {t("取消", "Cancel")}
              </button>
            </div>
            {errorText ? <p className={styles.error}>{errorText}</p> : null}
          </div>
        ) : (
          <div className={styles.summary}>
            <p className={styles.values}>
              {t(
                `有效期 ${data.batchTtlSeconds} 秒 · 最多 ${data.batchMaxUses} 台`,
                `Valid for ${data.batchTtlSeconds}s · up to ${data.batchMaxUses} hosts`,
              )}
            </p>
            <p className={styles.source}>
              {data.source === "setting"
                ? t(
                    `来自本页设置${data.updatedBy ? `（${data.updatedBy}）` : ""}`,
                    `Set from this page${data.updatedBy ? ` (${data.updatedBy})` : ""}`,
                  )
                : t(
                    "来自部署配置（本页尚未设置）",
                    "From deployment config (not set here)",
                  )}
            </p>
            <button
              type="button"
              className={styles.secondary}
              onClick={beginEdit}
            >
              {t("修改", "Edit")}
            </button>
          </div>
        )
      ) : null}
    </section>
  );
}
