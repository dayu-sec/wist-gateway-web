import { Link, useParams } from "react-router-dom";
import { ApiError, getAdminApiToken, isRateLimitedError } from "../api";
import {
  useAgentPurpose,
  useAgentRuntimeStatus,
  useAgentWork,
  useClassifyAgentPurpose,
  useContentCatalog,
  useGrantOneShotWork,
  useGrantStandingWork,
  useWorkAction,
} from "../hooks";
import { RateLimitNotice } from "./RateLimitNotice";
import {
  SubsystemAgentWorkView,
  type WorkActionCommand,
} from "./SubsystemAgentWorkView";
import { SubsystemAgentUplinkStatusPanel } from "./SubsystemAgentUplinkStatusPanel";
import styles from "./SubsystemAgentWorkPage.module.css";

interface SubsystemAgentWorkPageProps {
  children?: React.ReactNode;
}

/**
 * 区分 404 的两种含义（与用途页同一口径）。
 *
 * 管理面「未知 Agent」与「网关上没有这个接口」都是 404，但处置完全不同：
 * 前者是 agent_id 不存在（网关回纯文本 `unknown agent {id}`），
 * 后者说明在跑的 gateway 是旧构建（axum 对未注册路由回空正文）。
 */
function isUnknownAgentError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 404 &&
    /unknown agent/i.test(error.detail ?? "")
  );
}

function loadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击「应用」。";
    if (error.status === 429) return "认证失败次数过多，请稍后再试。";
    if (error.status === 404)
      return "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。";
    return error.detail
      ? `网关返回 HTTP ${error.status}：${error.detail}`
      : `网关返回 HTTP ${error.status}，请检查网关日志。`;
  }
  return "读取失败：响应不符合当前契约，请检查网关与前端版本。";
}

/**
 * 操作失败的原因（授权/暂停/恢复/撤回）。
 *
 * 网关对这几件事有明确的语义分层（400 请求本身不成立 / 409 与当前状态冲突），
 * 页面上要说清是哪一层，否则运维只会看到一个「操作失败」。
 */
function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409)
      return `操作与当前状态冲突（HTTP 409）：${error.detail ?? "请刷新后按当前状态重试。"}`;
    if (error.status === 400)
      return `请求本身不成立（HTTP 400）：${error.detail ?? "请检查面的名称与工作参数。"}`;
    if (error.status === 503)
      return "采集内容目录未装载（HTTP 503）：网关未配置 `[content]` 三件套。";
    return error.detail
      ? `操作失败（HTTP ${error.status}）：${error.detail}`
      : `操作失败（HTTP ${error.status}），请检查网关日志。`;
  }
  return "操作失败：响应不符合当前契约，请检查网关与前端版本。";
}

function formatTimestamp(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString("zh-CN", { hour12: false });
}

/**
 * Agent 工作页（模型 `ServeWorkGrant` 的管理面查看 + `AdminGrantWork`/`AdminRevokeWork`/
 * `AdminPauseWork`/`AdminResumeWork`）。
 *
 * 页面只管取数、提交与路由状态；工作在「在采什么 / 到了没有 / 能派什么」三节里的
 * 呈现都在 `SubsystemAgentWorkView` 里。
 */
export function SubsystemAgentWorkPage({}: SubsystemAgentWorkPageProps) {
  const { agentId = "" } = useParams<{ agentId: string }>();
  const work = useAgentWork(agentId);
  const runtime = useAgentRuntimeStatus(agentId);
  const catalog = useContentCatalog();
  const purpose = useAgentPurpose(agentId);
  const grantStanding = useGrantStandingWork(agentId);
  const grantOneShot = useGrantOneShotWork(agentId);
  const workAction = useWorkAction(agentId);
  const classify = useClassifyAgentPurpose(agentId);

  const unknownAgent = work.isError && isUnknownAgentError(work.error);
  // 未知 Agent（404）由上面的横幅负责；这里只把**其它**运行态读取错误报出来。
  const runtimeLoadError =
    runtime.isError && !isUnknownAgentError(runtime.error)
      ? loadErrorMessage(runtime.error)
      : null;
  const pending =
    grantStanding.isPending || grantOneShot.isPending || workAction.isPending;
  const mutationError =
    grantStanding.error ?? grantOneShot.error ?? workAction.error ?? classify.error;
  const notice = mutateNotice({
    standing: grantStanding.data,
    oneShot: grantOneShot.data,
    action: workAction.data,
  });

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <Link className={styles.back} to="/hosts">
          <span aria-hidden="true">←</span> 返回机队视图
        </Link>
        <div className={styles.titleRow}>
          <h1 className={styles.pageTitle}>{agentId || "未指定主机"}</h1>
          <span className={styles.scopeBadge}>采集工作：授权 / 确认 / 漂移</span>
          <Link
            className={styles.crossLink}
            to={`/agents/${encodeURIComponent(agentId)}/purpose`}
          >
            用途判定 <span aria-hidden="true">→</span>
          </Link>
          <Link
            className={styles.crossLink}
            to={`/agents/${encodeURIComponent(agentId)}/metrics`}
          >
            主机指标 <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className={styles.metaRow}>
          {work.data ? (
            <span className={styles.metaItem}>
              视图生成 <strong>{formatTimestamp(work.data.generatedAt)}</strong>
            </span>
          ) : null}
          <span className={styles.metaItemMuted}>
            不自动轮询：授权由管理面人工操作、Agent 按 30 秒的节拍拉快照。提交操作后会自动重取，确认到达即可见 —— 需要重取用右上角「刷新」。
          </span>
        </div>
      </header>

      {unknownAgent ? (
        <section className={styles.unknownAgent} role="alert">
          <h2 className={styles.unknownTitle}>未知 Agent</h2>
          <p className={styles.unknownText}>
            网关里没有 <strong>{agentId}</strong> 这台 Agent 的注册记录（HTTP 404）。没有注册记录就没有可授权工作的对象。
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

      {work.isError && !unknownAgent ? (
        isRateLimitedError(work.error) ? (
          <RateLimitNotice error={work.error} />
        ) : (
          <div className={styles.errorBanner} role="alert">
            {loadErrorMessage(work.error)}
          </div>
        )
      ) : null}

      {work.isLoading ? (
        <div className={styles.skeletonWrap}>
          {[0, 1, 2].map((index) => (
            <div key={index} className={styles.skeletonPanel} />
          ))}
        </div>
      ) : null}

      {!work.isLoading && !work.isError && !work.data ? (
        <div className={styles.idleNotice} role="status">
          {getAdminApiToken()
            ? "尚未取到工作数据，用右上角「刷新」重试。"
            : "未设置 Admin Token：在左侧填入后才向管理面请求，这里不会显示数据。"}
        </div>
      ) : null}

      {work.data ? (
        <div className={styles.viewWrap}>
          {mutationError ? (
            <div className={styles.errorBanner} role="alert">
              {actionErrorMessage(mutationError)}
            </div>
          ) : null}
          {notice ? (
            <div className={styles.noticeBanner} role="status">
              {notice}
            </div>
          ) : null}
          <SubsystemAgentUplinkStatusPanel
            uplinkState={runtime.data?.uplinkState ?? null}
            loading={runtime.isLoading}
            loadError={runtimeLoadError}
          />
          <SubsystemAgentWorkView
            agentWorkView={work.data}
            catalog={catalog.data ?? null}
            catalogUnavailable={
              catalog.error instanceof ApiError && catalog.error.status === 503
            }
            machineClass={purpose.data?.classification?.machineClass ?? null}
            pending={pending}
            actionError={null}
            actionNotice={null}
            onGrantStanding={(command) => grantStanding.mutate(command)}
            onGrantOneShot={(command) => grantOneShot.mutate(command)}
            onAction={(command: WorkActionCommand) => workAction.mutate(command)}
          />
        </div>
      ) : null}
    </div>
  );
}

/** 操作成功后说一句「刚刚改了什么」—— 页面不自动轮询，没有回执会让人不敢确定。 */
function mutateNotice(input: {
  standing?: { workId: string; planVersion: number; status: string };
  oneShot?: { workId: string; status: string };
  action?: { workId: string; status: string };
}): string | null {
  if (input.standing) {
    return `常驻工作 ${input.standing.workId} 已授权（期望版本 ${input.standing.planVersion}）：Agent 下一次拉快照（≤30 秒）时会应用并确认。`;
  }
  if (input.oneShot) {
    return `一次性工作 ${input.oneShot.workId} 已派发（状态 ${input.oneShot.status}）。`;
  }
  if (input.action) {
    return `工作 ${input.action.workId} 已${actionVerb(input.action.status)}。`;
  }
  return null;
}

function actionVerb(status: string): string {
  switch (status) {
    case "paused":
      return "暂停";
    case "resumed":
      return "恢复";
    case "revoked":
      return "撤回";
    default:
      return `置为 ${status}`;
  }
}
