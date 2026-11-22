import { useSearchParams } from "react-router-dom";
import { ResponseLaunchPanel } from "./ResponseLaunchPanel";
import { SubsystemAgentHostListPage } from "./SubsystemAgentHostListPage";
import { t } from "../i18n";
import styles from "./SubsystemAuthorizationPage.module.css";

/**
 * 主机页的 tab 壳：「主机清单」与「发起响应」。
 *
 * 为什么放这里：发起响应的**起点就是一台机器** —— 从主机清单看到"这台盘满了"，
 * 下一步就是"在这台上清一下"。拆成两个入口等于让人记住机器名再跳一次。
 *
 * tab 进 URL（`?tab=`）：刷新/分享都还能停在同一处，与授权页同一约定。
 */
type HostTab = "hosts" | "respond";

export function SubsystemAgentHostPage() {
  const [params, setParams] = useSearchParams();
  const tab: HostTab = params.get("tab") === "respond" ? "respond" : "hosts";
  const select = (next: HostTab) => {
    const merged = new URLSearchParams(params);
    merged.set("tab", next);
    setParams(merged, { replace: true });
  };

  return (
    <>
      <nav className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "hosts"}
          className={tab === "hosts" ? styles.tabActive : styles.tab}
          onClick={() => select("hosts")}
        >
          {t("主机清单", "Hosts")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "respond"}
          className={tab === "respond" ? styles.tabActive : styles.tab}
          onClick={() => select("respond")}
        >
          {t("发起响应", "Launch response")}
        </button>
      </nav>
      {tab === "respond" ? (
        <ResponseLaunchPanel />
      ) : (
        <SubsystemAgentHostListPage />
      )}
    </>
  );
}
