import { Link, useParams } from "react-router-dom";
import {
  ApiError,
  type GrantStandingWorkAllOutcome,
  getAdminApiToken,
  isRateLimitedError,
} from "../api";
import {
  useAgentPurpose,
  useAgentRuntimeStatus,
  useAgentWork,
  useClassifyAgentPurpose,
  useContentCatalog,
  useGrantAllStandingWork,
  useGrantOneShotWork,
  useGrantStandingWork,
  useWorkAction,
} from "../hooks";
import { RateLimitNotice } from "./RateLimitNotice";
import { t, dateLocale } from "../i18n";
import {
  SubsystemAgentWorkView,
  type WorkActionCommand,
} from "./SubsystemAgentWorkView";
import { SubsystemAgentUplinkStatusPanel } from "./SubsystemAgentUplinkStatusPanel";
import { SubsystemAgentIdentityPanel } from "./SubsystemAgentIdentityPanel";
import { summarizeAddresses } from "../lib/format";
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
      return t(
        "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击「应用」。",
        "Admin Token is missing or invalid: enter the correct Admin Token on the left and click “Apply”.",
      );
    if (error.status === 429)
      return t(
        "认证失败次数过多，请稍后再试。",
        "Too many failed authentication attempts. Try again later.",
      );
    if (error.status === 404)
      return t(
        "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。",
        "The gateway has no such endpoint (HTTP 404): the running gateway is most likely an old build. Rebuild and restart it, then retry.",
      );
    return error.detail
      ? t(
          "网关返回 HTTP {status}：{detail}",
          "Gateway returned HTTP {status}: {detail}",
          { status: error.status, detail: error.detail },
        )
      : t(
          "网关返回 HTTP {status}，请检查网关日志。",
          "Gateway returned HTTP {status}. Check the gateway logs.",
          { status: error.status },
        );
  }
  return t(
    "读取失败：响应不符合当前契约，请检查网关与前端版本。",
    "Load failed: the response does not match the current contract. Check the gateway and web versions.",
  );
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
      return t(
        "操作与当前状态冲突（HTTP 409）：{detail}",
        "The operation conflicts with the current status (HTTP 409): {detail}",
        {
          detail:
            error.detail ??
            t("请刷新后按当前状态重试。", "Refresh and retry per the current status."),
        },
      );
    if (error.status === 400)
      return t(
        "请求本身不成立（HTTP 400）：{detail}",
        "The request itself is invalid (HTTP 400): {detail}",
        {
          detail:
            error.detail ??
            t(
              "请检查面的名称与工作参数。",
              "Check the family name and the work parameters.",
            ),
        },
      );
    if (error.status === 503)
      return t(
        "采集内容目录未装载（HTTP 503）：网关未配置 `[content]` 三件套。",
        "The collection content catalog is not loaded (HTTP 503): the gateway has no `[content]` trio configured.",
      );
    return error.detail
      ? t(
          "操作失败（HTTP {status}）：{detail}",
          "Operation failed (HTTP {status}): {detail}",
          { status: error.status, detail: error.detail },
        )
      : t(
          "操作失败（HTTP {status}），请检查网关日志。",
          "Operation failed (HTTP {status}). Check the gateway logs.",
          { status: error.status },
        );
  }
  return t(
    "操作失败：响应不符合当前契约，请检查网关与前端版本。",
    "Operation failed: the response does not match the current contract. Check the gateway and web versions.",
  );
}

function formatTimestamp(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString(dateLocale(), { hour12: false });
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
  const grantAllStanding = useGrantAllStandingWork(agentId);
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
    grantStanding.isPending ||
    grantAllStanding.isPending ||
    grantOneShot.isPending ||
    workAction.isPending;
  const mutationError =
    grantStanding.error ??
    grantAllStanding.error ??
    grantOneShot.error ??
    workAction.error ??
    classify.error;
  const notice = mutateNotice({
    all: grantAllStanding.data,
    standing: grantStanding.data,
    oneShot: grantOneShot.data,
    action: workAction.data,
  });
  // 多网卡主机一次能报十几条 IP，运行态这里也只挑主地址，全量进 tooltip。
  const runtimeAddress = summarizeAddresses(runtime.data?.ipAddresses ?? []);

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <Link className={styles.back} to="/hosts">
          <span aria-hidden="true">←</span> {t("返回机队视图", "Back to fleet view")}
        </Link>
        <div className={styles.titleRow}>
          <h1 className={styles.pageTitle}>
            {agentId || t("未指定主机", "Unspecified host")}
          </h1>
          <span className={styles.scopeBadge}>
            {t(
              "采集工作：授权 / 确认 / 漂移",
              "Collection work: grant / confirm / drift",
            )}
          </span>
          <Link
            className={styles.crossLink}
            to={`/agents/${encodeURIComponent(agentId)}/purpose`}
          >
            {t("用途判定", "Purpose classification")}{" "}
            <span aria-hidden="true">→</span>
          </Link>
          <Link
            className={styles.crossLink}
            to={`/agents/${encodeURIComponent(agentId)}/metrics`}
          >
            {t("主机指标", "Host metrics")}{" "}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className={styles.metaRow}>
          {runtime.data ? (
            <span className={styles.metaItem}>
              {t("主机", "Host")}{" "}
              <strong>{runtime.data.hostname || "—"}</strong>
              {runtimeAddress.primary ? (
                <>
                  {" · "}
                  <strong title={runtimeAddress.full || undefined}>
                    {runtimeAddress.primary}
                    {runtimeAddress.others > 0
                      ? ` +${runtimeAddress.others}`
                      : ""}
                  </strong>
                </>
              ) : null}
            </span>
          ) : null}
          {work.data ? (
            <span className={styles.metaItem}>
              {t("视图生成", "View generated")}{" "}
              <strong>{formatTimestamp(work.data.generatedAt)}</strong>
            </span>
          ) : null}
          <span className={styles.metaItemMuted}>
            {t(
              "不自动轮询：授权由管理面人工操作、Agent 按 30 秒的节拍拉快照。提交操作后会自动重取，确认到达即可见 —— 需要重取用右上角「刷新」。",
              "No automatic polling: grants are made by hand on the admin side and agents pull snapshots on a 30 s beat. Submitting an operation refetches automatically, so it becomes visible once it arrives — use “Refresh” at the top right to refetch.",
            )}
          </span>
        </div>
      </header>

      {unknownAgent ? (
        <section className={styles.unknownAgent} role="alert">
          <h2 className={styles.unknownTitle}>{t("未知 Agent", "Unknown Agent")}</h2>
          <p className={styles.unknownText}>
            {t(
              "网关里没有 ",
              "The gateway has no registration record for ",
            )}
            <strong>{agentId}</strong>
            {t(
              " 这台 Agent 的注册记录（HTTP 404）。没有注册记录就没有可授权工作的对象。",
              " (HTTP 404). Without a registration record there is nothing to grant work to.",
            )}
          </p>
          <p className={styles.unknownHint}>
            {t(
              "请确认 agent_id 拼写是否正确；已注册的主机可以在",
              "Check that agent_id is spelled correctly; registered hosts can be verified on the ",
            )}
            <Link className={styles.unknownLink} to="/hosts">
              {t("主机指标", "Host metrics")}
            </Link>
            {t("页核对。", " page.")}
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
            ? t(
                "尚未取到工作数据，用右上角「刷新」重试。",
                "No work data yet; use “Refresh” at the top right to retry.",
              )
            : t(
                "未设置 Admin Token：在左侧填入后才向管理面请求，这里不会显示数据。",
                "Admin Token is not set: nothing is requested from the admin side until you enter it on the left, so no data appears here.",
              )}
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
          <SubsystemAgentIdentityPanel
            agentId={agentId}
            certificateStatus={runtime.data?.certificateStatus ?? null}
            revoked={runtime.data?.revoked ?? false}
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
            grantAllPending={grantAllStanding.isPending}
            actionError={null}
            actionNotice={null}
            onGrantStanding={(command) => grantStanding.mutate(command)}
            onGrantAll={(families) => grantAllStanding.mutate(families)}
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
  all?: GrantStandingWorkAllOutcome;
  standing?: { workId: string; planVersion: number; status: string };
  oneShot?: { workId: string; status: string };
  action?: { workId: string; status: string };
}): string | null {
  // 批量结果排在前面：它是「一口气授权了这一批」的完整交代，比单张卡的回执信息量大。
  if (input.all) {
    const { granted, failed } = input.all;
    if (failed.length === 0) {
      return t(
        "全部授权完成：{n} 份常驻工作已下发（Agent 下一次拉快照（≤30 秒）时会应用并确认）。",
        "Grant all done: {n} standing work items dispatched (the agent applies and confirms them on its next snapshot pull, ≤30 s).",
        { n: granted.length },
      );
    }
    const failureText = failed
      .map((entry) =>
        t("{family}（{message}）", "{family} ({message})", {
          family: entry.family,
          message: entry.message,
        }),
      )
      .join(t("；", "; "));
    return granted.length === 0
      ? t(
          "全部授权都没成：{failures}。",
          "Grant all failed entirely: {failures}.",
          { failures: failureText },
        )
      : t(
          "全部授权：成功 {ok} 份，失败 {failed} 份 —— {failures}。",
          "Grant all: {ok} succeeded, {failed} failed — {failures}.",
          { ok: granted.length, failed: failed.length, failures: failureText },
        );
  }
  if (input.standing) {
    return t(
      "常驻工作 {workId} 已授权（期望版本 {planVersion}）：Agent 下一次拉快照（≤30 秒）时会应用并确认。",
      "Standing work {workId} granted (expected version {planVersion}): the agent applies and confirms it on its next snapshot pull (≤30 s).",
      {
        workId: input.standing.workId,
        planVersion: input.standing.planVersion,
      },
    );
  }
  if (input.oneShot) {
    return t(
      "一次性工作 {workId} 已派发（状态 {status}）。",
      "One-shot work {workId} dispatched (status {status}).",
      { workId: input.oneShot.workId, status: input.oneShot.status },
    );
  }
  if (input.action) {
    return t("工作 {workId} 已{verb}。", "Work {workId} {verb}.", {
      workId: input.action.workId,
      verb: actionVerb(input.action.status),
    });
  }
  return null;
}

function actionVerb(status: string): string {
  switch (status) {
    case "paused":
      return t("暂停", "paused");
    case "resumed":
      return t("恢复", "resumed");
    case "revoked":
      return t("撤回", "revoked");
    default:
      return t("置为 {status}", "set to {status}", { status });
  }
}
