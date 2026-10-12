import { ApiError, isRateLimitedError } from "../api";
import { RateLimitNotice } from "./RateLimitNotice";
import { t } from "../i18n";
import styles from "./SubsystemAgentPackages.module.css";

/**
 * 安装包两个页面（安装包管理 / 安装包录入）共用的提示与时间格式。
 *
 * 放在这里而不是各写一份：两页读的是同一批端点，401 / 404 / 429 的处置必须逐字一致 ——
 * 否则同一故障在两页会给出不同的话，操作者会以为是两个不同的问题。
 */

/** 读取失败时的提示（设置与包目录共用）。 */
export function packageLoadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return t(
        "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击“应用”。",
        'Admin Token missing or invalid: enter a valid Admin Token on the left and click "Apply".',
      );
    if (error.status === 429)
      return t(
        "认证失败次数过多，请稍后再试。",
        "Too many failed authentication attempts. Try again later.",
      );
    // 404 特指「路由不存在」：网关进程在应答（否则会是网络错误），只是没有这个接口，
    // 绝大多数情况是在跑旧构建的 gateway，而不是服务未启动。
    if (error.status === 404)
      return t(
        "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。",
        "The gateway has no such endpoint (HTTP 404): the running gateway is most likely an old build. Rebuild and restart the gateway, then retry.",
      );
    return error.detail
      ? t(
          "网关返回 HTTP {status}：{detail}",
          "The gateway returned HTTP {status}: {detail}",
          { status: error.status, detail: error.detail },
        )
      : t(
          "网关返回 HTTP {status}，请检查网关日志。",
          "The gateway returned HTTP {status}. Check the gateway logs.",
          { status: error.status },
        );
  }
  return t(
    "读取失败：响应不符合当前契约，请检查网关与前端版本。",
    "Read failed: the response does not match the current contract. Check the gateway and frontend versions.",
  );
}

/** 录入失败时的提示（400 = 地址/摘要不合规，或摘要与来源内容不符；502 = 来源拉不到）。 */
export function packageAddErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return t(
        "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击“应用”。",
        'Admin Token missing or invalid: enter a valid Admin Token on the left and click "Apply".',
      );
    if (error.status === 429)
      return t(
        "认证失败次数过多，请稍后再试。",
        "Too many failed authentication attempts. Try again later.",
      );
    if (error.status === 404)
      return t(
        "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。",
        "The gateway has no such endpoint (HTTP 404): the running gateway is most likely an old build. Rebuild and restart the gateway, then retry.",
      );
    // 后端已把具体原因写在正文里，优先透出它，操作者才知道该改哪里。
    if (error.detail)
      return t(
        "添加失败（HTTP {status}）：{detail}",
        "Add failed (HTTP {status}): {detail}",
        { status: error.status, detail: error.detail },
      );
    if (error.status === 400)
      return t(
        "地址或摘要不符合要求：地址必须是 https:// 链接或本机绝对路径；摘要必须是 64 位十六进制（可带 sha256: 前缀）。",
        "The address or digest is not acceptable: the address must be an https:// link or an absolute local path, and the digest must be 64 hex characters (a sha256: prefix is allowed).",
      );
    return t(
      "网关返回 HTTP {status}，请检查网关日志。",
      "The gateway returned HTTP {status}. Check the gateway logs.",
      { status: error.status },
    );
  }
  return t(
    "添加失败：响应不符合当前契约，请检查网关与前端版本。",
    "Add failed: the response does not match the current contract. Check the gateway and frontend versions.",
  );
}

/** 时间戳显示（读不出时原样回显，不编一个时间）。 */
export function timestampText(value: string | null): string {
  if (!value) return "—";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString();
}

/** 读取中 / 读取失败的提示条。 */
export function LoadNotice({
  loading,
  error,
}: {
  loading: boolean;
  error: unknown;
}) {
  if (loading) {
    return (
      <div className={styles.notice} role="status">
        {t("正在读取…", "Reading…")}
      </div>
    );
  }
  if (!error) return null;
  if (isRateLimitedError(error)) return <RateLimitNotice error={error} />;
  return (
    <div className={styles.noticeDanger} role="alert">
      {packageLoadErrorMessage(error)}
    </div>
  );
}
