import { Link } from "react-router-dom";

import { useRegisteredAgents } from "../hooks";
import { t } from "../i18n";
import { summarizeAddresses } from "../lib/format";
import { AgentFeatureNav, type AgentFeatureKey } from "./AgentFeatureNav";
import styles from "./AgentPageHeader.module.css";

/**
 * 同一台主机下五页共用的页头：返回 → 主机名 → 身份行 → tab 条 → 导语。
 *
 * 为什么要共用：以前每页各写一套 —— 标题有的带「· 指标标签」后缀、有的直接写 agent_id；
 * 身份行有的在 tab 上面、有的压根没有；说明文字还混在身份行里。结果是**切 tab 时页头高度、
 * tab 位置、标题都变**，现场反馈「切换时感到跳跃」（2026-11-04）。
 *
 * 现在的约定：
 * - 标题只有一个来源（机队里的 hostname，取不到才退回 agent_id），五页一致；
 * - 身份行固定是最多三项公共事实（IP / Agent ID / 版本），**不放页面专属信息**；
 * - tab 条紧接身份行，页面专属的说明文字一律放在 tab **下面**（`children`），
 *   所以切页时页头与 tab 不动，只有下面的内容换。
 */
export function AgentPageHeader({
  agentId,
  active,
  badge,
  children,
}: {
  agentId: string;
  active: AgentFeatureKey;
  /** 标题行右侧的状态/范围 chip（「5 秒自动刷新」「采集工作：授权 / 确认 / 漂移」…）。 */
  badge?: React.ReactNode;
  /** tab 下方的导语（页面说明）。不要在这里放动态读数 —— 那属于正文。 */
  children?: React.ReactNode;
}) {
  // 身份只认一个来源：机队注册表（与机队列表、采集工作索引同一份缓存，不额外发请求）。
  // 取不到（未注册 / 无 token）时退回 agent_id，标题不会因此空掉。
  const agents = useRegisteredAgents();
  const row = agents.data?.find((agent) => agent.agentId === agentId);
  const hostname = row?.hostname.trim() || agentId;
  const address = summarizeAddresses(row?.ipAddresses ?? []);

  return (
    <header className={styles.header}>
      <Link className={styles.back} to="/hosts">
        <span aria-hidden="true">←</span>{" "}
        {t("返回机队视图", "Back to fleet view")}
      </Link>

      <div className={styles.titleRow}>
        <h1 className={styles.title}>{hostname}</h1>
        {badge}
      </div>

      <div className={styles.metaRow}>
        <span className={styles.metaItem}>
          IP{" "}
          <strong title={address.full || undefined}>
            {address.primary ?? "—"}
            {address.others > 0 ? ` +${address.others}` : ""}
          </strong>
        </span>
        <span className={styles.metaItem}>
          {t("Agent ID", "Agent ID")}{" "}
          <span className={styles.agentId} title={agentId}>
            {agentId}
          </span>
        </span>
        {row?.version ? (
          <span className={styles.metaItem}>
            {t("版本", "Version")} <strong>{row.version}</strong>
          </span>
        ) : null}
      </div>

      <AgentFeatureNav agentId={agentId} active={active} />

      {children ? <div className={styles.lead}>{children}</div> : null}
    </header>
  );
}
