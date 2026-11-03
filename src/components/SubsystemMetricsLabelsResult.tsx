import { METRIC_LABEL_KEYS, type AgentMetricsLabelsView } from "../api";
import { dateLocale, t } from "../i18n";
import { describeLabelSource } from "../lib/metricsLabels";
import styles from "./SubsystemMetricsLabelsResult.module.css";

interface SubsystemMetricsLabelsResultProps {
  view: AgentMetricsLabelsView;
  /** 「重新下发」：让这台机器立刻重拉一次标签（命令入队，≤3s 送达）。 */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** 成功提示。失败不在这里渲染：429 要交给 `RateLimitNotice` 做倒计时。 */
  refreshNotice?: string | null;
}

/**
 * 当前生效的 label 表。
 *
 * 展示的是**合并后**的值（部署默认 ∪ 网关推断 ∪ 手工覆盖），每行带来源 ——
 * 运维要能一眼看出「这个 cluster 是我填的，还是网关推出来的」。
 */
export function SubsystemMetricsLabelsResult({
  view,
  onRefresh,
  refreshing = false,
  refreshNotice = null,
}: SubsystemMetricsLabelsResultProps) {
  const keys = METRIC_LABEL_KEYS.filter((key) => key in view.labels);
  const overrideCount = Object.keys(view.overrides).length;

  return (
    <section
      className={styles.container}
      aria-labelledby="metrics-labels-effective"
    >
      <header className={styles.header}>
        <h2 className={styles.title} id="metrics-labels-effective">
          {t("生效标签", "Effective labels")}
        </h2>
        <span className={styles.revision}>
          {t("版本 {n}", "revision {n}", { n: view.revision })}
        </span>
        {view.updatedAt ? (
          <span className={styles.updatedAt}>
            {t("更新于 {time}", "Updated {time}", {
              time: formatTimestamp(view.updatedAt),
            })}
          </span>
        ) : null}
        {onRefresh ? (
          <div className={styles.actions}>
            <span className={styles.refreshHint}>
              {t("排队后 ≤3s 送达", "delivered within 3s of queueing")}
            </span>
            <button
              type="button"
              className={styles.refreshButton}
              onClick={onRefresh}
              disabled={refreshing}
            >
              {refreshing
                ? t("下发中…", "Dispatching…")
                : t("重新下发", "Re-dispatch")}
            </button>
          </div>
        ) : null}
      </header>

      {refreshNotice ? (
        <p className={styles.refreshNotice} role="status">
          {refreshNotice}
        </p>
      ) : null}

      {keys.length === 0 ? (
        <p className={styles.empty}>
          {t(
            "这台机器当前没有任何选择类 label。指标仍会采集，但无法按环境 / 集群聚合。",
            "This machine has no selection labels yet. Metrics are still collected, but they cannot be aggregated by environment or cluster.",
          )}
        </p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t("键", "Key")}</th>
              <th scope="col">{t("生效值", "Value")}</th>
              <th scope="col">{t("来源", "Source")}</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key}>
                <td className={styles.keyCell}>{key}</td>
                <td className={styles.valueCell}>{view.labels[key]}</td>
                <td>
                  <span
                    className={styles.source}
                    data-source={view.sources[key]}
                  >
                    {describeLabelSource(view.sources[key])}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className={styles.foot}>
        {t(
          "手工覆盖 {n} 项；清空覆盖后回落到网关推断 / 部署默认。标签贴在全部指标序列上，改完历史序列不会重新贴标。",
          "{n} manual overrides; clearing them falls back to inference / deployment defaults. Labels apply to every series, and already-written history is not relabelled.",
          { n: overrideCount },
        )}
      </p>
    </section>
  );
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(dateLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(parsed);
}
