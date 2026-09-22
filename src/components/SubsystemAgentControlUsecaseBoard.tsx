import styles from "./SubsystemAgentControlUsecaseBoard.module.css";

interface SubsystemAgentControlUsecaseBoardProps {
  children?: React.ReactNode;
}

/**
 * Agent 控制中心用例看板：集中承载各条远程用例卡片。
 * 当前没有可用的远程用例，看板为空容器，后续用例按需挂载。
 */
export function SubsystemAgentControlUsecaseBoard({
  children,
}: SubsystemAgentControlUsecaseBoardProps) {
  return <div className={styles.container}>{children}</div>;
}
