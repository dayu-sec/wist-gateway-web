import styles from "./SubsystemAgentControlCenterPage.module.css";
import { SubsystemAdminOperatorLane } from "./SubsystemAdminOperatorLane";
import { SubsystemAgentControlUsecaseBoard } from "./SubsystemAgentControlUsecaseBoard";

interface SubsystemAgentControlCenterPageProps {
  children?: React.ReactNode;
}

export function SubsystemAgentControlCenterPage({}: SubsystemAgentControlCenterPageProps) {
  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Agent 控制中心</h1>
        <p className={styles.pageSummary}>集中管理已注册主机的远程运维动作。</p>
      </header>

      <SubsystemAdminOperatorLane />

      <SubsystemAgentControlUsecaseBoard />
    </div>
  );
}
