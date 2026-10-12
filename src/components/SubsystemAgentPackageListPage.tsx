import { Link } from "react-router-dom";
import { useAgentInstallPackage, useInstallPackages } from "../hooks";
import { t } from "../i18n";
import { AGENTD_PLATFORMS, platformLabel } from "./agentPackagePlatforms";
import {
  activePackageCount,
  managedPackageRows,
  missingPlatforms,
  type ManagedPackageStatus,
} from "./agentPackageRegistry";
import { LoadNotice, timestampText } from "./agentPackageUi";
import styles from "./SubsystemAgentPackages.module.css";

/** 网关只托管 agentd 这一个组件（中心的「已托管包」表有五个组件，这里只有一行的那一个）。 */
const COMPONENT_NAME = "WistAgentd";

/** 行状态文案：与中心「已托管包」的 已录入/已过期 同一套位置，网关侧按**本机当前分发**判定。 */
function statusLabel(status: ManagedPackageStatus): string {
  switch (status) {
    case "live":
      return t("在用", "In use");
    case "partial":
      return t("部分在用", "Partly in use");
    default:
      return t("已归档", "Archived");
  }
}

function statusClass(status: ManagedPackageStatus): string {
  switch (status) {
    case "live":
      return `${styles.statusBadge} ${styles.statusBadgeLive}`;
    case "partial":
      return `${styles.statusBadge} ${styles.statusBadgePartial}`;
    default:
      return `${styles.statusBadge} ${styles.statusBadgeArchived}`;
  }
}

/**
 * 「安装包管理」页（路由 `/install-package`）：网关已托管的安装包一览。
 *
 * 形态对齐中心 `/packages` 的「已托管包」表：**一行 = 一个版本**，平台是行内的 chips，
 * 状态与录入时间在行上；录入新版本在独立页「安装包录入」（右上角进入）。
 *
 * 与中心的两点差别（都在数据里，不在排版里）：
 * ① 网关只有 agentd 一个组件，所以「组件」列恒为 WistAgentd；
 * ② 没有「操作」列 —— 网关没有「标记过期/恢复在用」这种状态开关，它的写操作是「一次覆盖三平台」
 *    的**录入**（在录入页），当前用什么由那次录入决定。
 *
 * 状态推导看 `agentPackageRegistry.ts`（行状态 = 该版本各平台是否就是本机当前分发的那一份）。
 * 另有一条**缺件**提示：某个平台还没有在用包时，该平台新签发的安装命令会明确报错（不给旧包）。
 */
export function SubsystemAgentPackageListPage() {
  const installPackage = useAgentInstallPackage();
  const packages = useInstallPackages();

  const current = installPackage.data?.packages ?? [];
  const history = packages.data ?? [];
  const rows = managedPackageRows(history, current);
  const missing = missingPlatforms(current, AGENTD_PLATFORMS);
  const loading = installPackage.isLoading || packages.isLoading;
  const error = installPackage.isError
    ? installPackage.error
    : packages.isError
      ? packages.error
      : null;

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>{t("安装包管理", "Install packages")}</h1>
          <p className={styles.pageSummary}>
            {t(
              "网关已托管的安装包一览：组件、版本、平台、状态与录入时间。录入新版本见「安装包录入」。",
              "Packages hosted by this gateway: component, version, platforms, status and record time. Use Install package entry for a new version.",
            )}
          </p>
        </header>

        <div className={`${styles.pageActions} ${styles.pageActionsEnd}`}>
          <Link className={styles.actionLink} to="/install-package/add">
            {t("安装包录入", "Install package entry")}
          </Link>
        </div>

        <section className={styles.card} aria-labelledby="install-package-registry">
          <header className={styles.cardHead}>
            <h2 id="install-package-registry">{t("已托管包", "Hosted packages")}</h2>
            <p>
              {t(
                "共 {n} 个版本，在用 {m} 个。",
                "{n} versions, {m} in use.",
                { n: rows.length, m: activePackageCount(rows) },
              )}
            </p>
          </header>

          {loading || error ? (
            <div className={styles.noticeBlock}>
              <LoadNotice loading={loading} error={error} />
            </div>
          ) : rows.length === 0 ? (
            <div className={styles.packageEmpty}>
              <strong>{t("包目录还是空的", "The package catalog is still empty")}</strong>
              <span>
                {t(
                  "在「安装包录入」填一次来源，网关就会把制品读进这里。",
                  "Fill in sources once under Install package entry and the gateway will read the artifacts into this list.",
                )}
              </span>
            </div>
          ) : (
            <>
              <div className={styles.registry}>
                <div className={styles.registryHeader} aria-hidden="true">
                  <span>{t("组件", "Component")}</span>
                  <span>{t("版本", "Version")}</span>
                  <span>{t("平台", "Platforms")}</span>
                  <span>{t("状态", "Status")}</span>
                  <span>{t("录入时间", "Recorded at")}</span>
                </div>
                {rows.map((row) => (
                  <div key={row.version} className={styles.registryRow}>
                    <strong className={styles.registryComponent}>
                      {COMPONENT_NAME}
                    </strong>
                    <span className={styles.registryVersion}>{row.version}</span>
                    <span className={styles.registryPlatform}>
                      {row.platforms.map((platform, index) => (
                        <span
                          key={`${platform.platform || "none"}/${index}`}
                          className={
                            platform.live
                              ? `${styles.platformChip} ${styles.platformChipLive}`
                              : styles.platformChip
                          }
                          // 在用的那一份顺手把本机缓存路径带出来（录入页的「最近录入」看来源，这里看落盘位置）。
                          title={platform.cachedPath ?? platform.entry.source}
                        >
                          {platform.platform === ""
                            ? "—"
                            : platformLabel(platform.platform)}
                        </span>
                      ))}
                    </span>
                    <span className={styles.registryStatus}>
                      <span className={statusClass(row.status)}>
                        {statusLabel(row.status)}
                      </span>
                    </span>
                    <span className={styles.registryTime}>
                      {timestampText(row.recordedAt)}
                    </span>
                  </div>
                ))}
              </div>

              <p className={styles.registryNote}>
                {missing.length === 0 ? (
                  t(
                    "三个平台都在用：macOS · ARM + Linux x86_64/ARM64 各有当前分发包。",
                    "All three platforms are in use: macOS · ARM and Linux x86_64/ARM64 each have a current package.",
                  )
                ) : (
                  <>
                    {t(
                      "还没在用的平台：",
                      "Platforms without a package in use: ",
                    )}
                    <span className={styles.registryMissing}>
                      {missing.map((platform) => platformLabel(platform)).join(" / ")}
                    </span>
                    {t(
                      " —— 这些平台上新签发的安装命令会明确报错（不会默默给旧包）。",
                      " — newly issued install commands on these platforms fail explicitly (no silent fallback to an old package).",
                    )}
                  </>
                )}
              </p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
