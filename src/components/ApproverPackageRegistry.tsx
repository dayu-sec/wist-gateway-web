import { useState } from "react";
import { ApiError } from "../api";
import { useApproverPackages, useRemoveApproverPackage } from "../hooks";
import { t } from "../i18n";
import { shortDigest } from "../lib/approvalState";
import { platformLabel } from "./agentPackagePlatforms";
import { timestampText } from "./agentPackageUi";
import shared from "./SubsystemAgentPackages.module.css";
import styles from "./ApproverPackageRegistry.module.css";

/** 与 agentd 档的「组件」列对齐：一行一个组件，不是一行一个版本。 */
const COMPONENT_NAME = "WistApprove";

/**
 * 「已托管包」里的**审批终端**一档：`wist-approve` 三个平台的当前登记。
 *
 * 视觉与 agentd 档同一套：组件 / 版本 / 平台 chips / 状态徽标 / 录入信息。
 * 差别只在语义 —— 审批终端没有「版本历史」，每个平台只有**当前那一份**，所以每行是
 * 「一个平台」，末列多一个「撤销登记」（agentd 档的写操作在录入页，没有行内动作）。
 *
 * 列表在这里、录入在 `/install-package/approver`：列表是**看现状**，与 agentd 的已托管包
 * 是同一个问题；录入是**改状态**，与「安装包录入」同级的独立页。
 */
export function ApproverPackageRegistry() {
  const query = useApproverPackages();
  const remove = useRemoveApproverPackage();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const packages = query.data ?? [];

  function errorText(error: unknown): string {
    if (error instanceof ApiError) {
      return error.detail
        ? `${error.code}：${error.detail}`
        : `${error.code}（HTTP ${error.status}）`;
    }
    return t(
      "请求失败：响应不符合当前契约。",
      "Request failed: the response does not match the current contract.",
    );
  }

  if (query.isError) {
    return (
      <div className={shared.noticeBlock}>
        <div className={shared.errorBanner} role="alert">
          {errorText(query.error)}
        </div>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className={shared.noticeBlock}>
        <p className={styles.loading}>{t("正在读取…", "Loading…")}</p>
      </div>
    );
  }

  if (packages.length === 0) {
    return (
      <div className={shared.packageEmpty}>
        <strong>{t("还没有登记任何平台", "No platform registered yet")}</strong>
        <span>
          {t(
            "此时审批页的安装命令会回 503 approver_package_unavailable。到「审批终端安装包」页登记一次即可。",
            "Until then the install command on the approvals page returns 503 approver_package_unavailable. Register a platform on the Approval CLI packages page.",
          )}
        </span>
      </div>
    );
  }

  return (
    <>
      <div className={shared.registry}>
        <div className={styles.header} aria-hidden="true">
          <span>{t("组件", "Component")}</span>
          <span>{t("版本", "Version")}</span>
          <span>{t("平台", "Platform")}</span>
          <span>{t("状态", "Status")}</span>
          <span>{t("来源", "Source")}</span>
          <span>{t("操作", "Actions")}</span>
        </div>
        {packages.map((item) => (
          <div key={item.platform} className={styles.row}>
            <strong className={shared.registryComponent}>
              {COMPONENT_NAME}
            </strong>
            <span className={shared.registryVersion}>
              {item.version || "—"}
            </span>
            <span className={shared.registryPlatform}>
              <span
                className={
                  item.available
                    ? `${shared.platformChip} ${shared.platformChipLive}`
                    : shared.platformChip
                }
                title={item.platform}
              >
                {platformLabel(item.platform)}
              </span>
            </span>
            <span className={shared.registryStatus}>
              <span
                className={
                  item.available
                    ? `${shared.statusBadge} ${shared.statusBadgeLive}`
                    : `${shared.statusBadge} ${shared.statusBadgeArchived}`
                }
              >
                {item.available
                  ? t("生效中", "Available")
                  : t("缓存缺失", "Cache missing")}
              </span>
            </span>
            <span className={styles.source}>
              <span className={styles.sourceUrl} title={item.source}>
                {item.source}
              </span>
              <span className={styles.sourceMeta}>
                {[
                  item.packageSha256 ? shortDigest(item.packageSha256) : "",
                  item.updatedAt ? timestampText(item.updatedAt) : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <span>
              {confirmRemove === item.platform ? (
                <>
                  <button
                    type="button"
                    className={styles.danger}
                    disabled={remove.isPending}
                    onClick={() =>
                      remove.mutate(item.platform, {
                        onSuccess: () => setConfirmRemove(null),
                      })
                    }
                  >
                    {t("确认", "Confirm")}
                  </button>
                  <button
                    type="button"
                    className={styles.plain}
                    disabled={remove.isPending}
                    onClick={() => setConfirmRemove(null)}
                  >
                    {t("取消", "Cancel")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={styles.danger}
                  disabled={remove.isPending}
                  onClick={() => setConfirmRemove(item.platform)}
                >
                  {t("撤销", "Remove")}
                </button>
              )}
            </span>
          </div>
        ))}
      </div>

      {remove.error ? (
        <div className={shared.noticeBlock}>
          <div className={shared.errorBanner} role="alert">
            {errorText(remove.error)}
          </div>
        </div>
      ) : null}

      <p className={shared.registryNote}>
        {t(
          "撤销只删这条登记，不删网关盘上的缓存副本（现场回滚不必重新拉）。缓存缺失（available=false）表示记录还在但盘上那份没了：重新登记一次即可恢复。",
          "Removing deletes only the registration, not the cached copy on disk (so a rollback does not need a re-download). Cache missing (available=false) means the record is still here but the cached copy is gone: register it again to restore.",
        )}
      </p>
    </>
  );
}
