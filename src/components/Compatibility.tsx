import type { CompatReport } from "../api/admin";
import { t } from "../i18n";
import {
  compatDeclaredRanges,
  compatLabel,
  compatSeverityLabel,
  compatSummary,
  compatTone,
} from "./compatReport";
import styles from "./Compatibility.module.css";

/**
 * 兼容性展示（安装包页 / 知识库页共用）。
 *
 * 网关侧拿到的是**检查结果**（`CompatReport`）：每条 `checks[]` 都带
 * `peer / required / actual / message` —— 所以「声明的范围」和「检查结论」都在这里，
 * 不需要再从包里读 `compat.json`。
 *
 * `unknown` 是灰：「包内没声明」不等于「兼容」，列表上绝不能显示成绿色。
 */

const TONE_CLASS = {
  ok: styles.toneOk,
  warn: styles.toneWarn,
  crit: styles.toneCrit,
  unknown: styles.toneUnknown,
} as const;

/** 列表里的徽标；没有报告（老后端）时显示灰色「未检查」。 */
export function CompatibilityBadge({ report }: { report: CompatReport | null }) {
  if (!report) {
    return (
      <span className={`${styles.badge} ${styles.toneUnknown}`}>
        {t("未检查", "Not checked")}
      </span>
    );
  }
  return (
    <span
      className={`${styles.badge} ${TONE_CLASS[compatTone(report.status)]}`}
    >
      {compatLabel(report.status)}
    </span>
  );
}

/**
 * 详情面板（放进 `<details>` 或卡片里）：声明范围 + 逐条检查 + 当前版本向量。
 *
 * 一行一条检查；`required` 就是该 peer 的声明范围，`actual` 是网关当前版本 ——
 * 「为什么是黄/红」看一眼就清楚。
 */
export function CompatibilityDetail({ report }: { report: CompatReport | null }) {
  if (!report) {
    return (
      <p className={styles.muted}>
        {t(
          "没有兼容性报告（网关版本较旧或尚未检查）。",
          "No compatibility report (the gateway is older, or nothing has been checked yet).",
        )}
      </p>
    );
  }
  const ranges = compatDeclaredRanges(report);
  const current = Object.entries(report.current ?? {});
  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span className={styles.summary}>{compatSummary(report)}</span>
        {report.checkedAt ? (
          <span className={styles.checkedAt}>{report.checkedAt}</span>
        ) : null}
      </div>

      {ranges.length > 0 ? (
        <div className={styles.row}>
          <span className={styles.rowLabel}>
            {t("声明的范围", "Declared ranges")}
          </span>
          <span className={styles.chips}>
            {ranges.map((range) => (
              <span key={`${range.peer}|${range.required}`} className={styles.chip}>
                <span className={styles.chipPeer}>{range.peer}</span>
                <span className={styles.chipValue}>{range.required}</span>
              </span>
            ))}
          </span>
        </div>
      ) : null}

      {current.length > 0 ? (
        <div className={styles.row}>
          <span className={styles.rowLabel}>{t("当前版本", "Current")}</span>
          <span className={styles.chips}>
            {current.map(([peer, version]) => (
              <span key={peer} className={styles.chip}>
                <span className={styles.chipPeer}>{peer}</span>
                <span className={styles.chipValue}>{version}</span>
              </span>
            ))}
          </span>
        </div>
      ) : null}

      <ul className={styles.checks}>
        {report.checks.map((check, index) => (
          <li
            key={`${check.peer}/${index}`}
            className={`${styles.check} ${SEVERITY_CLASS[check.severity] ?? ""}`}
          >
            <span className={styles.severityTag}>
              {compatSeverityLabel(check.severity)}
            </span>
            <span className={styles.checkMessage}>{check.message}</span>
            <span className={styles.checkDetail}>
              {check.peer} · {t("要求", "requires")} {check.required} ·{" "}
              {t("实际", "actual")} {check.actual || t("未知", "unknown")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SEVERITY_CLASS: Record<string, string> = {
  ok: styles.severityOk,
  warn: styles.severityWarn,
  error: styles.severityError,
};
