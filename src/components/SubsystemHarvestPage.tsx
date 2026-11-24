import { t } from "../i18n";
import { SubsystemHarvestSettingSection } from "./SubsystemHarvestSettingSection";
import styles from "./SubsystemHarvestPage.module.css";

/**
 * 云资产采集**独立页**（菜单：采集 → 云资产采集）。
 *
 * 原先它以一张卡片的形式嵌在「网关配置」页里。那一页讲的是**本网关**的对外地址与
 * 上送设置，而云账号采集是另一个对象（宿主上的 harvest worker + 采集计划 + 手动触发）：
 * 混在一起既不好找，面包屑也指向错误的主题。抽成独立页后归到「采集」组。
 */
export function SubsystemHarvestPage() {
  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t("云资产采集", "Cloud asset harvest")}</h1>
      </header>

      <SubsystemHarvestSettingSection />
    </div>
  );
}
