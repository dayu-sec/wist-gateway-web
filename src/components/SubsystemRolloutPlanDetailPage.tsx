import { Link, useParams } from "react-router-dom";
import { ApiError, getAdminApiToken, isRateLimitedError } from "../api";
import { parseUpgradeSpec } from "../api/admin";
import { useRolloutPlan, useRolloutPlanAction } from "../hooks";
import { RateLimitNotice } from "./RateLimitNotice";
import {
  advanceRuleLabel,
  countEntries,
  currentPhase,
  entryStatusLabel,
  entryStatusTone,
  phaseIncompleteCount,
  phaseSettled,
  phaseStatusLabel,
  phaseStatusTone,
  planStatusLabel,
  planStatusTone,
  planTargetCount,
  type RolloutTone,
} from "./rolloutStatus";
import styles from "./SubsystemRolloutPlanDetailPage.module.css";

/** 区分 404 的两种含义（与其余管理面页面同一口径）。 */
function isUnknownPlanError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 404 &&
    /unknown rollout plan/i.test(error.detail ?? "")
  );
}

function loadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击“应用”。";
    if (error.status === 429) return "认证失败次数过多，请稍后再试。";
    if (error.status === 404)
      return "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。";
    return error.detail
      ? `网关返回 HTTP ${error.status}：${error.detail}`
      : `网关返回 HTTP ${error.status}，请检查网关日志。`;
  }
  return "读取失败：响应不符合当前契约，请检查网关与前端版本。";
}

/** 批准/推进失败：409 是与当前状态冲突（并发操作、状态已变），要把正文透出来。 */
function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409)
      return `操作与当前状态冲突（HTTP 409）：${error.detail ?? "请刷新后按当前状态重试。"}`;
    if (error.status === 404)
      return "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。";
    return error.detail
      ? `操作失败（HTTP ${error.status}）：${error.detail}`
      : `操作失败（HTTP ${error.status}），请检查网关日志。`;
  }
  return "操作失败：响应不符合当前契约，请检查网关与前端版本。";
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString("zh-CN", { hour12: false });
}

function toneClass(tone: RolloutTone): string {
  switch (tone) {
    case "ok":
      return styles.toneOk;
    case "warn":
      return styles.toneWarn;
    case "crit":
      return styles.toneCrit;
    default:
      return styles.toneUnknown;
  }
}

/**
 * 灰度发布计划详情页（模型 `Control.Rollout`：`ViewRolloutPlan` + `ApproveRolloutPlan`
 * + `AdvanceRolloutPlan`）。
 *
 * 这一页承载灰度发布的**两处人工闸门**：
 *   · 草稿 → 批准（进入第一阶段，把阶段内的 Agent 各展开成一件一次性升级工作）；
 *   · 进行中 → 推进（金丝雀确认无问题后，把下一阶段范围也铺下去）。
 * 逐台进度是条目（entry），由 agentd 上报的结果回填而来。
 */
export function SubsystemRolloutPlanDetailPage() {
  const { planId = "" } = useParams<{ planId: string }>();
  const detail = useRolloutPlan(planId);
  const action = useRolloutPlanAction();

  const unknownPlan = detail.isError && isUnknownPlanError(detail.error);
  const plan = detail.data?.plan ?? null;
  const entries = detail.data?.entries ?? [];
  const counts = countEntries(entries);
  const spec = plan ? parseUpgradeSpec(plan.spec) : null;
  const active = plan ? currentPhase(plan) : null;
  const activeSettled = active ? phaseSettled(active, entries) : false;
  const activeIncomplete = active ? phaseIncompleteCount(active, entries) : 0;
  const isLastPhase = plan ? plan.currentPhase === plan.phases.length : false;

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <Link className={styles.back} to="/rollout">
          <span aria-hidden="true">←</span> 返回计划列表
        </Link>
        <div className={styles.titleRow}>
          <h1 className={styles.pageTitle}>{planId || "未指定计划"}</h1>
          {plan ? (
            <span className={`${styles.badge} ${toneClass(planStatusTone(plan.status))}`}>
              {planStatusLabel(plan.status)}
            </span>
          ) : null}
        </div>
        <p className={styles.pageSummary}>
          计划是编排层：批准/推进时才把阶段内的 Agent 物化成一次性升级工作；
          逐台成败由 agentd 上报回填。本页不自动轮询，操作后或点右上角「刷新」重取。
        </p>
      </header>

      {unknownPlan ? (
        <section className={styles.unknown} role="alert">
          <h2 className={styles.unknownTitle}>未知计划</h2>
          <p className={styles.unknownText}>
            网关里没有 <strong>{planId}</strong> 这份灰度发布计划（HTTP 404）。
          </p>
          <p className={styles.unknownHint}>
            请确认计划 id 是否正确；已创建的计划可以在
            <Link className={styles.unknownLink} to="/rollout">
              计划列表
            </Link>
            页核对。
          </p>
        </section>
      ) : null}

      {detail.isError && !unknownPlan ? (
        isRateLimitedError(detail.error) ? (
          <RateLimitNotice error={detail.error} />
        ) : (
          <div className={styles.errorBanner} role="alert">
            {loadErrorMessage(detail.error)}
          </div>
        )
      ) : null}

      {detail.isLoading ? (
        <div className={styles.skeletonWrap}>
          {[0, 1, 2].map((index) => (
            <div key={index} className={styles.skeletonPanel} />
          ))}
        </div>
      ) : null}

      {!detail.isLoading && !detail.isError && !detail.data ? (
        <div className={styles.idleNotice} role="status">
          {getAdminApiToken()
            ? "尚未取到计划数据，用右上角「刷新」重试。"
            : "未设置 Admin Token：在左侧填入后才向管理面请求，这里不会显示数据。"}
        </div>
      ) : null}

      {plan ? (
        <div className={styles.viewWrap}>
          <section className={styles.summary} aria-label="计划摘要">
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>目标总数</span>
              <span className={styles.summaryValue}>{planTargetCount(plan)}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>成功</span>
              <span className={`${styles.summaryValue} ${styles.valueOk}`}>
                {counts.succeeded}
              </span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>失败</span>
              <span
                className={`${styles.summaryValue} ${
                  counts.failed > 0 ? styles.valueCrit : ""
                }`}
              >
                {counts.failed}
              </span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>执行中</span>
              <span className={styles.summaryValue}>{counts.dispatched}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>待派发</span>
              <span className={styles.summaryValue}>{counts.pending}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>阶段</span>
              <span className={styles.summaryValue}>
                {plan.currentPhase} / {plan.phases.length}
              </span>
            </div>
          </section>

          {action.isError ? (
            <div className={styles.errorBanner} role="alert">
              {actionErrorMessage(action.error)}
            </div>
          ) : null}
          {action.isSuccess ? (
            <div className={styles.noticeBanner} role="status">
              已{action.variables?.kind === "approve" ? "批准" : "推进"}：
              {plan.status === "completed"
                ? "计划已完成。"
                : `当前处于第 ${plan.currentPhase} 阶段。`}
              Agent 下一次拉快照（≤30 秒）后会看到新派的工作。
            </div>
          ) : null}

          <section className={styles.card} aria-labelledby="rollout-plan-meta-title">
            <header className={styles.cardHead}>
              <h2 className={styles.cardTitle} id="rollout-plan-meta-title">
                计划内容
              </h2>
              <span className={styles.cardHint}>动作与参数在各阶段共用一份</span>
            </header>
            <dl className={styles.metaList}>
              <div className={styles.metaRow}>
                <dt>动作</dt>
                <dd>
                  <span className={styles.mono}>{plan.action}</span>
                </dd>
              </div>
              <div className={styles.metaRow}>
                <dt>目标版本</dt>
                <dd>
                  {spec?.error ? (
                    <span className={styles.valueWarn}>
                      spec 不是合法 JSON：{spec.error}
                    </span>
                  ) : (
                    <span className={styles.mono}>
                      {spec?.targetVersion ?? "—"}
                    </span>
                  )}
                </dd>
              </div>
              <div className={styles.metaRow}>
                <dt>包地址</dt>
                <dd>
                  <span className={styles.mono}>
                    {spec?.packageUrl ?? "（未指定，用网关默认来源）"}
                  </span>
                </dd>
              </div>
              <div className={styles.metaRow}>
                <dt>包摘要</dt>
                <dd>
                  <span className={styles.mono}>
                    {spec?.packageSha256 ?? "—"}
                  </span>
                </dd>
              </div>
              <div className={styles.metaRow}>
                <dt>截止时间</dt>
                <dd>
                  <span className={styles.mono}>
                    {formatTimestamp(plan.deadlineAt)}
                  </span>
                </dd>
              </div>
              <div className={styles.metaRow}>
                <dt>执行预算</dt>
                <dd>
                  <span className={styles.mono}>{plan.timeoutSeconds} 秒</span>
                </dd>
              </div>
              <div className={styles.metaRow}>
                <dt>阶段内并发</dt>
                <dd>
                  <span className={styles.mono}>
                    {plan.batchSize === 0
                      ? "不节流（全量同时）"
                      : `最多 ${plan.batchSize} 台在飞`}
                  </span>
                </dd>
              </div>
              <div className={styles.metaRow}>
                <dt>创建</dt>
                <dd>
                  <span className={styles.mono}>
                    {formatTimestamp(plan.createdAt)}
                  </span>
                  <span className={styles.meta}>{plan.createdBy}</span>
                </dd>
              </div>
              <div className={styles.metaRow}>
                <dt>批准</dt>
                <dd>
                  {plan.approvedAt ? (
                    <>
                      <span className={styles.mono}>
                        {formatTimestamp(plan.approvedAt)}
                      </span>
                      <span className={styles.meta}>{plan.approvedBy}</span>
                    </>
                  ) : (
                    <span className={styles.valueMuted}>尚未批准</span>
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <section className={styles.card} aria-labelledby="rollout-plan-phases-title">
            <header className={styles.cardHead}>
              <h2 className={styles.cardTitle} id="rollout-plan-phases-title">
                灰度阶段
              </h2>
              <span className={styles.cardHint}>
                逐阶段推进：金丝雀确认无问题，再铺下一阶段
              </span>
            </header>

            {plan.status === "draft" ? (
              <div className={styles.gateRow}>
                <div className={styles.gateCopy}>
                  <span className={styles.gateTitle}>批准并进入第一阶段</span>
                  <span className={styles.gateHint}>
                    批准后为阶段 1 的 {plan.phases[0]?.targetIds.length ?? 0} 个
                    Agent 各生成一件一次性升级工作。
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({ kind: "approve", planId })
                  }
                >
                  {action.isPending ? "正在批准…" : "批准"}
                </button>
              </div>
            ) : null}

            {plan.status === "rolling" ? (
              <div className={styles.gateRow}>
                <div className={styles.gateCopy}>
                  <span className={styles.gateTitle}>
                    {isLastPhase ? "推进并收尾计划" : "推进到下一阶段"}
                  </span>
                  <span className={styles.gateHint}>
                    {activeSettled
                      ? isLastPhase
                        ? "当前阶段已全部了结，推进后计划完成。"
                        : `当前阶段已全部了结，推进后为阶段 ${
                            plan.currentPhase + 1
                          } 的 ${
                            plan.phases[plan.currentPhase]?.targetIds.length ?? 0
                          } 个 Agent 派发工作。`
                      : `当前阶段还有 ${activeIncomplete} 个目标未了结（执行中或待派发）。`}
                  </span>
                </div>
                <button
                  type="button"
                  className={
                    activeSettled
                      ? styles.primaryButton
                      : `${styles.primaryButton} ${styles.primaryButtonWarn}`
                  }
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({ kind: "advance", planId })
                  }
                >
                  {action.isPending ? "正在推进…" : isLastPhase ? "推进并收尾" : "推进"}
                </button>
              </div>
            ) : null}

            {!activeSettled && plan.status === "rolling" ? (
              <p className={styles.gateWarn} role="note">
                本阶段未全部了结就推进，未了结目标的结果仍会回填到条目，但阶段会被标记为已完成
                —— 人工闸门的判断权在你。
              </p>
            ) : null}

            <ol className={styles.phaseList}>
              {plan.phases.map((phase) => {
                const settled = phaseSettled(phase, entries);
                const isActive = phase.phaseIndex === plan.currentPhase;
                return (
                  <li
                    key={phase.phaseIndex}
                    className={
                      isActive ? `${styles.phaseItem} ${styles.phaseActive}` : styles.phaseItem
                    }
                  >
                    <div className={styles.phaseTop}>
                      <span className={styles.phaseIndex}>阶段 {phase.phaseIndex}</span>
                      <span
                        className={`${styles.badge} ${toneClass(phaseStatusTone(phase.status))}`}
                      >
                        {phaseStatusLabel(phase.status)}
                      </span>
                      <span className={styles.phaseMeta}>
                        {phase.targetIds.length} 个目标 ·{" "}
                        {advanceRuleLabel(phase.advanceRule)}
                      </span>
                    </div>
                    <div className={styles.phaseProgress}>
                      {settled
                        ? "已全部了结"
                        : `未了结 ${phaseIncompleteCount(phase, entries)} 个`}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className={styles.card} aria-labelledby="rollout-plan-entries-title">
            <header className={styles.cardHead}>
              <h2 className={styles.cardTitle} id="rollout-plan-entries-title">
                逐台进度
              </h2>
              <span className={styles.cardHint}>
                一个目标一行；进入阶段时物化出工作，结果回填到这里
              </span>
            </header>

            {entries.length === 0 ? (
              <p className={styles.emptyNotice}>这份计划还没有目标条目。</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">目标</th>
                      <th scope="col">状态</th>
                      <th scope="col">工作</th>
                      <th scope="col">说明</th>
                      <th scope="col">更新时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.targetId}>
                        <td>
                          <Link
                            className={styles.targetLink}
                            to={`/agents/${encodeURIComponent(entry.targetId)}/work`}
                          >
                            {entry.targetId}
                          </Link>
                        </td>
                        <td>
                          <span
                            className={`${styles.badge} ${toneClass(
                              entryStatusTone(entry.status),
                            )}`}
                          >
                            {entryStatusLabel(entry.status)}
                          </span>
                        </td>
                        <td>
                          <span className={styles.mono}>
                            {entry.workId ?? "—"}
                          </span>
                        </td>
                        <td className={styles.tdDetail}>
                          {entry.detail || "—"}
                        </td>
                        <td>
                          <span className={styles.mono}>
                            {formatTimestamp(entry.updatedAt)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
