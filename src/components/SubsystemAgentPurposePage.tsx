import { Link, useParams } from "react-router-dom";
import { ApiError, getAdminApiToken, isRateLimitedError } from "../api";
import { useAgentPurpose } from "../hooks";
import { RateLimitNotice } from "./RateLimitNotice";
import { SubsystemAgentPurposeView } from "./SubsystemAgentPurposeView";
import styles from "./SubsystemAgentPurposePage.module.css";

interface SubsystemAgentPurposePageProps {
  children?: React.ReactNode;
}

/**
 * 区分 404 的两种含义。
 *
 * 管理面「未知 Agent」与「网关上没有这个接口」都是 404，但处置完全不同：
 * 前者是 agent_id 不存在（网关自己回纯文本 `unknown agent {id}`），
 * 后者说明在跑的 gateway 是旧构建（axum 对未注册路由回空正文）。
 * 用响应正文区分，避免把「这台机器不存在」误报成「网关版本旧」。
 */
function isUnknownAgentError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 404 &&
    /unknown agent/i.test(error.detail ?? "")
  );
}

/** 读取失败时的提示（与其它管理面页面同一口径）。 */
function loadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击「应用」。";
    if (error.status === 429) return "认证失败次数过多，请稍后再试。";
    // 走到这里说明 404 的正文对不上「未知 Agent」：更可能是网关没有这个路由。
    if (error.status === 404)
      return "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。";
    return error.detail
      ? `网关返回 HTTP ${error.status}：${error.detail}`
      : `网关返回 HTTP ${error.status}，请检查网关日志。`;
  }
  return "读取失败：响应不符合当前契约，请检查网关与前端版本。";
}

function formatTimestamp(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString("zh-CN", { hour12: false });
}

/**
 * Agent 用途页（模型 `ViewAgentPurpose`，管理面条目 `AdminViewAgentPurpose`）。
 *
 * 页面只管取数与路由状态（加载中 / 未知 Agent / 读取失败），
 * 事实 / 推断 / 判定三分并列的展示在 `SubsystemAgentPurposeView` 里。
 */
export function SubsystemAgentPurposePage({}: SubsystemAgentPurposePageProps) {
  const { agentId = "" } = useParams<{ agentId: string }>();
  const { data, error, isLoading, isError } = useAgentPurpose(agentId);

  const unknownAgent = isError && isUnknownAgentError(error);

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <Link className={styles.back} to="/hosts">
          <span aria-hidden="true">←</span> 返回机队视图
        </Link>
        <div className={styles.titleRow}>
          <h1 className={styles.pageTitle}>{agentId || "未指定主机"}</h1>
          <span className={styles.scopeBadge}>用途：事实 / 推断 / 判定</span>
          <Link
            className={styles.crossLink}
            to={`/agents/${encodeURIComponent(agentId)}/metrics`}
          >
            主机指标 <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className={styles.metaRow}>
          {data ? (
            <span className={styles.metaItem}>
              视图生成 <strong>{formatTimestamp(data.generatedAt)}</strong>
            </span>
          ) : null}
          <span className={styles.metaItemMuted}>
            不自动轮询：事实只在内容变化时上报，建议只在事实或规则册变化时重算 ——
            需要重取用右上角「刷新」。
          </span>
        </div>
      </header>

      {unknownAgent ? (
        // 「这台机器不存在」（404）与「它还没报过事实」（200 + 空视图）必须分开呈现。
        <section className={styles.unknownAgent} role="alert">
          <h2 className={styles.unknownTitle}>未知 Agent</h2>
          <p className={styles.unknownText}>
            网关里没有 <strong>{agentId}</strong> 这台 Agent 的注册记录（HTTP 404）。
            这与「尚未上报事实」是两回事：后者是已知的 Agent 还没报过摘要，网关会返回空的事实与
            建议，而不是 404。
          </p>
          <p className={styles.unknownHint}>
            请确认 agent_id 拼写是否正确；已注册的主机可以在
            <Link className={styles.unknownLink} to="/hosts">
              主机指标
            </Link>
            页核对。
          </p>
        </section>
      ) : null}

      {isError && !unknownAgent ? (
        isRateLimitedError(error) ? (
          <RateLimitNotice error={error} />
        ) : (
          <div className={styles.errorBanner} role="alert">
            {loadErrorMessage(error)}
          </div>
        )
      ) : null}

      {isLoading ? (
        <div className={styles.skeletonWrap}>
          {[0, 1, 2].map((index) => (
            <div key={index} className={styles.skeletonPanel} />
          ))}
        </div>
      ) : null}

      {/* 未设置 token 时查询是 disabled 的（不请求管理面），要明确说出来而不是留白。 */}
      {!isLoading && !isError && !data ? (
        <div className={styles.idleNotice} role="status">
          {getAdminApiToken()
            ? "尚未取到用途数据，用右上角「刷新」重试。"
            : "未设置 Admin Token：在左侧填入后才向管理面请求，这里不会显示数据。"}
        </div>
      ) : null}

      {data ? (
        <div className={styles.viewWrap}>
          <SubsystemAgentPurposeView agentPurposeView={data} />
        </div>
      ) : null}
    </div>
  );
}
