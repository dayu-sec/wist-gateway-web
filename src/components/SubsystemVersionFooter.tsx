import { useBackendVersion } from "../hooks";
import { t } from "../i18n";
import styles from "./SubsystemVersionFooter.module.css";

/**
 * 侧边栏底部的版本块（左下角常驻）：前端版本 + 后端版本 + 全栈版本。
 *
 * 前端版本来自构建期注入的 `VITE_APP_VERSION`（运行态来自 Docker 的 `APP_VERSION`；dev 由 vite.config 从
 * `version.txt` 补上）；后端/全栈版本调公开端点 `GET /api/v1/version`（见 `useBackendVersion`），
 * 其中 `stack_version` 由网关读 stack 的 `version.txt` 得到。任一未知都显示 `—`，**不回落示例值**
 * —— 一个假的版本号比没有更误导运维（会照着错版本排障）。旧网关不返回 `stack_version` 时，
 * 全栈版本那行同样显示 `—`（而不是整行隐藏）：三行布局在「有版本 / 没版本」的部署里保持一致。
 */
function formatVersion(raw: string | undefined): string {
  // 运行态注入的是**发布 tag 名**（自带 `v`，如 `v0.5.0-alpha`）；后端返回纯 semver（`0.9.0`）。
  // 统一成 `vX.Y.Z…`：已带 `v` 就原样、否则补 `v` —— 免得拼出 `vv0.5.0-alpha`。
  const value = (raw ?? "").trim();
  if (value === "") return "—";
  return value.startsWith("v") ? value : `v${value}`;
}

export function SubsystemVersionFooter() {
  // 后端/全栈版本：公开端点，不需要 admin token；加载中 / 失败都是 undefined → 显示 `—`。
  const { data: backendVersion } = useBackendVersion();
  const frontendVersion = import.meta.env.VITE_APP_VERSION;

  return (
    <div className={styles.version} aria-label={t("版本信息", "Version info")}>
      <span className={styles.row}>
        <span className={styles.label}>{t("前端版本", "Frontend version")}</span>
        <span className={styles.value}>{formatVersion(frontendVersion)}</span>
      </span>
      <span className={styles.row}>
        <span className={styles.label}>{t("后端版本", "Backend version")}</span>
        <span className={styles.value}>{formatVersion(backendVersion?.version)}</span>
      </span>
      <span className={styles.row}>
        <span className={styles.label}>
          {t("全栈版本", "Full-stack version")}
        </span>
        <span className={styles.value}>
          {formatVersion(backendVersion?.stackVersion)}
        </span>
      </span>
    </div>
  );
}
