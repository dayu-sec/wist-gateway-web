import { useSearchParams } from "react-router-dom";
import { InvestigationGrantsPanel } from "./InvestigationGrantsPanel";
import { ResponseGrantPanel } from "./ResponseGrantPanel";
import { SubsystemCollectionGrantPage } from "./SubsystemCollectionGrantPage";
import { t } from "../i18n";
import styles from "./SubsystemAuthorizationPage.module.css";

/**
 * 授权页的三个 tab：**采集面**、**调查面**、**响应**。
 *
 * 前两个是「谁能读这台机器的什么」，第三个是「谁能动这台机器」—— 读与写分成两条轴，
 * 但都是「对某台机器的一次授权决定」，所以收在同一页。
 */
type GrantTab = "collection" | "investigation" | "response";

function parseTab(value: string | null): GrantTab {
  if (value === "investigation") return "investigation";
  if (value === "response") return "response";
  return "collection";
}

/**
 * 授权页（tab 壳）。
 *
 * 为什么不把两块合成一张表：采集授权是“按面选主机、批量下发常驻工作”，调查授权是
 * “按面选主机、批量开启调查面” —— 授权动作不同，但入口都收在采集面／调查面。
 */
export function SubsystemAuthorizationPage() {
  const [params, setParams] = useSearchParams();
  const tab: GrantTab = parseTab(params.get("tab"));
  const select = (next: GrantTab) => {
    const merged = new URLSearchParams(params);
    merged.set("tab", next);
    // tab 进 URL：刷新/分享都还能停在同一处。
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
        <button
          type="button"
          role="tab"
          aria-selected={tab === "response"}
          className={tab === "response" ? styles.tabActive : styles.tab}
          onClick={() => select("response")}
        >
          {t("响应授权", "Response grants")}
        </button>
      </nav>
      {tab === "investigation" ? (
        <InvestigationGrantsPanel />
      ) : tab === "response" ? (
        <ResponseGrantPanel />
      ) : (
        <SubsystemCollectionGrantPage />
      )}
    </>
  );
}
