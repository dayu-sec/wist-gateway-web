import { Link } from "react-router-dom";
import { t } from "../i18n";
import styles from "./AgentFeatureNav.module.css";

/**
 * 同一台主机下的几个页面（指标 / 采集工作 / 用途 / 标签 / 调查）。
 *
 * 为什么抽成一个组件：这五页以前各自在标题行里挂三四个「采集工作 →」「用途 →」纯文字
 * 链接，条目越加越多、位置各不相同 —— 现场反馈「不成体系、认不出当前在哪一页」
 * （2026-11-03）。抽成同一条 tab 条之后：五页共用一套顺序与措辞（整体性），
 * 当前页高亮并带下划线（辨识度），换页不会换位置。
 *
 * 活动项渲染成 `<span aria-current="page">` 而不是指向自身的链接：当前页再点一次没有意义，
 * 读屏也应该读成「当前位置」。
 */
export type AgentFeatureKey =
  | "metrics"
  | "work"
  | "purpose"
  | "labels"
  | "investigations";

/** 顺序 = 从「机器怎么样」到「出事了去查」，与机队列表、Agent 卡片的用词保持同一套短标签。
 *  必须是函数：`t()` 在模块顶层求值一次的话，切语言不会变。 */
function features(): { key: AgentFeatureKey; label: string }[] {
  return [
    { key: "metrics", label: t("主机指标", "Host metrics") },
    { key: "work", label: t("采集工作", "Collection work") },
    { key: "purpose", label: t("用途", "Purpose") },
    { key: "labels", label: t("指标标签", "Metric labels") },
    { key: "investigations", label: t("一次性调查", "One-off investigation") },
  ];
}

export function AgentFeatureNav({
  agentId,
  active,
}: {
  agentId: string;
  active: AgentFeatureKey;
}) {
  const encoded = encodeURIComponent(agentId);
  return (
    <nav className={styles.nav} aria-label={t("本机页面", "Host pages")}>
      {features().map((feature) =>
        feature.key === active ? (
          <span
            key={feature.key}
            className={`${styles.tab} ${styles.tabActive}`}
            aria-current="page"
          >
            {feature.label}
          </span>
        ) : (
          <Link
            key={feature.key}
            className={styles.tab}
            to={`/agents/${encoded}/${feature.key}`}
          >
            {feature.label}
          </Link>
        ),
      )}
    </nav>
  );
}
