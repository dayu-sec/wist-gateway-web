import { Link } from "react-router-dom";
import { t } from "../i18n";
import { ApproverPackageSection } from "./ApproverPackageSection";
import styles from "./SubsystemAgentPackages.module.css";

/**
 * 「审批终端安装包」页（路由 `/install-package/approver`）。
 *
 * 与「安装包录入」（`/install-package/add`）同级、同一个入口行：审批人从**本网关**装
 * `wist-approve`（客户 / 隔离站点连不上 GitHub），所以网关要先持有三个平台的制品。
 *
 * 为什么不并进「已托管包」那张表：那张表的行是 **agentd 的版本**（一行一个版本、平台是 chips），
 * 审批终端是**另一个组件**、只有「当前登记的那一份」，两者的行语义不同，混在一张表里会让人
 * 以为审批终端也在按版本托管。
 */
export function SubsystemApproverPackagePage() {
  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>
            {t("审批终端安装包", "Approval CLI packages")}
          </h1>
          <p className={styles.pageSummary}>
            {t(
              "审批人从本网关下载 wist-approve（客户与隔离站点连不上 GitHub），所以网关要先持有三个平台的制品。这里登记的是审批终端，agentd 的包在「安装包管理」里。",
              "Approvers download wist-approve from this gateway (customers and air-gapped sites cannot reach GitHub), so the gateway must hold the artifacts for all three platforms. This page manages the approval CLI; agentd packages live under Install packages.",
            )}
          </p>
        </header>

        <div className={styles.pageActions}>
          <Link className={styles.backLink} to="/install-package">
            {t("← 返回包列表", "← Back to the package list")}
          </Link>
        </div>

        <ApproverPackageSection />
      </main>
    </div>
  );
}
