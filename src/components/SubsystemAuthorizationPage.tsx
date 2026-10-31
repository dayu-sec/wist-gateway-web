import { useSearchParams } from "react-router-dom";
import { InvestigationGrantsPanel } from "./InvestigationGrantsPanel";
import { SubsystemCollectionGrantPage } from "./SubsystemCollectionGrantPage";
import { t } from "../i18n";
import styles from "./SubsystemAuthorizationPage.module.css";

/** 授权页的两个 tab：**采集面**与**调查面**是两条独立的授权轴，但都是“谁能读这台机器的什么”。 */
type GrantTab = "collection" | "investigation";

/**
 * 授权页（tab 壳）。
 *
 * 为什么不把两块合成一张表：采集授权是“按面选主机、批量下发常驻工作”，调查授权是
 * “按主机勾面、即时生效” —— 操作对象与生效方式都不同。共用一页省的是“去哪找”，
 * 不是“合成一个表单”。
 */
export function SubsystemAuthorizationPage() {
  const [params, setParams] = useSearchParams();
  const tab: GrantTab =
    params.get("tab") === "investigation" ? "investigation" : "collection";
  const agent = params.get("agent");

  const select = (next: GrantTab) => {
    const merged = new URLSearchParams(params);
    merged.set("tab", next);
    // tab 与主机选择都进 URL：刷新/分享都还能停在同一处。
    setParams(merged, { replace: true });
  };

  return (
    <>
      <nav className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "collection"}
          className={tab === "collection" ? styles.tabActive : styles.tab}
          onClick={() => select("collection")}
        >
          {t("采集面授权", "Collection grants")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "investigation"}
          className={tab === "investigation" ? styles.tabActive : styles.tab}
          onClick={() => select("investigation")}
        >
          {t("调查授权", "Investigation grants")}
        </button>
      </nav>
      {tab === "investigation" ? (
        <InvestigationGrantsPanel initialAgentId={agent} />
      ) : (
        <SubsystemCollectionGrantPage />
      )}
    </>
  );
}
