import { t } from "../i18n";
import styles from "./SubsystemAbnormalAgentPanel.module.css";
import { SubsystemAbnormalAgentCardGrid } from "./SubsystemAbnormalAgentCardGrid";
import { SubsystemNoAbnormalAgentPlaceholder } from "./SubsystemNoAbnormalAgentPlaceholder";
import type { AgentRuntimeStatusView } from "../api";

interface SubsystemAbnormalAgentPanelProps {
  agents?: AgentRuntimeStatusView[];
  loading?: boolean;
  children?: React.ReactNode;
}

export function SubsystemAbnormalAgentPanel({ agents = [], loading }: SubsystemAbnormalAgentPanelProps) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>{t("异常 Agent", "Abnormal agents")}</h2>
        <span className={styles.count}>
          {loading
            ? t("加载中", "Loading")
            : t("{n} 个", "{n}", { n: agents.length })}
        </span>
      </div>
      {agents.length > 0 ? (
        <SubsystemAbnormalAgentCardGrid items={agents} />
      ) : (
        <SubsystemNoAbnormalAgentPlaceholder />
      )}
    </div>
  );
}
