import { Link, useParams } from "react-router-dom";
import { ApiError, getAdminApiToken, isRateLimitedError } from "../api";
import { parseUpgradeSpec } from "../api/admin";
import { useRolloutPlan, useRolloutPlanAction } from "../hooks";
import { RateLimitNotice } from "./RateLimitNotice";
import { rolloutActionLabel } from "./rolloutActionNotice";
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
} from "@dayu-sec/wist-web-core/release";
import { t, dateLocale } from "../i18n";
import styles from "./SubsystemAgentUpgradeDetailPage.module.css";

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
      return t(
        "Admin Token 缺失或无效：请在右上角点钥匙按钮，粘贴 Admin Token 后点击“应用”。",
        "Admin Token missing or invalid: click the key button in the top bar, paste the Admin Token and click “Apply”.",
      );
    if (error.status === 429)
      return t(
        "认证失败次数过多，请稍后再试。",
        "Too many failed authentications; try again later.",
      );
    if (error.status === 404)
      return t(
        "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。",
        "The gateway has no such endpoint (HTTP 404): the running gateway is most likely an old build; rebuild and restart the gateway, then try again.",
      );
    return error.detail
      ? t(
          "网关返回 HTTP {status}：{detail}",
          "The gateway returned HTTP {status}: {detail}",
          {
            status: error.status,
            detail: error.detail,
          },
        )
      : t(
          "网关返回 HTTP {status}，请检查网关日志。",
          "The gateway returned HTTP {status}; check the gateway logs.",
          { status: error.status },
        );
  }
  return t(
    "读取失败：响应不符合当前契约，请检查网关与前端版本。",
    "Load failed: the response does not match the current contract; check the gateway and frontend versions.",
  );
}

/** 批准/推进失败：409 是与当前状态冲突（并发操作、状态已变），要把正文透出来。 */
function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409)
      return t(
        "操作与当前状态冲突（HTTP 409）：{detail}",
        "The operation conflicts with the current state (HTTP 409): {detail}",
        {
          detail:
            error.detail ??
            t(
              "请刷新后按当前状态重试。",
              "Refresh and retry from the current state.",
            ),
        },
      );
    if (error.status === 404)
      return t(
        "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。",
        "The gateway has no such endpoint (HTTP 404): the running gateway is most likely an old build; rebuild and restart the gateway, then try again.",
      );
    return error.detail
      ? t(
          "操作失败（HTTP {status}）：{detail}",
          "Operation failed (HTTP {status}): {detail}",
          {
            status: error.status,
            detail: error.detail,
          },
        )
      : t(
          "操作失败（HTTP {status}），请检查网关日志。",
          "Operation failed (HTTP {status}); check the gateway logs.",
          { status: error.status },
        );
  }
  return t(
    "操作失败：响应不符合当前契约，请检查网关与前端版本。",
    "Operation failed: the response does not match the current contract; check the gateway and frontend versions.",
  );
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString(dateLocale(), { hour12: false });
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
 * 升级计划详情页（模型 `Control.Rollout` 的具体化：`ViewRolloutPlan` + `ApproveRolloutPlan`
 * + `AdvanceRolloutPlan`）。
 *
 * 一份「Agent 升级」计划的分阶段推进就落在这里，承载两处人工闸门：
 *   · 草稿 → 批准（进入第一阶段，为阶段内的 Agent 各派一件升级）；
 *   · 进行中 → 推进（金丝雀确认无问题后，把下一阶段范围也铺下去）。
 * 失败的目标可以**重试**（逐台或一次全部）—— 网关会派一件新工作并把计划重开为进行中。
 * 逐台进度是条目（entry），由 agentd 上报的升级结果回填而来。
 */
export function SubsystemAgentUpgradeDetailPage() {
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
        <Link className={styles.back} to="/upgrade">
          <span aria-hidden="true">←</span>{" "}
          {t("返回升级计划", "Back to upgrade plans")}
        </Link>
        <div className={styles.titleRow}>
          <h1 className={styles.pageTitle}>
            {planId || t("未指定计划", "No plan specified")}
          </h1>
          {plan ? (
            <span
              className={`${styles.badge} ${toneClass(planStatusTone(plan.status))}`}
            >
              {planStatusLabel(plan.status)}
            </span>
          ) : null}
        </div>
        <p className={styles.pageSummary}>
          {t(
            "这份计划把 agentd 升级按灰度阶段铺到它覆盖的 Agent：批准/推进时才真正派发升级，逐台成败由 agentd 上报回填。本页不自动轮询，操作后或点右上角「刷新」重取。",
            "This plan rolls the agentd upgrade out to the agents it covers, phase by phase: upgrades are actually dispatched only on approve/advance, and per-agent success or failure is reported back by agentd. This page does not poll; refetch after an operation or via “Refresh” in the top-right corner.",
          )}
        </p>
      </header>

      {unknownPlan ? (
        <section className={styles.unknown} role="alert">
          <h2 className={styles.unknownTitle}>
            {t("未知计划", "Unknown plan")}
          </h2>
          <p className={styles.unknownText}>
            {t("网关里没有 ", "The gateway has no ")}
            <strong>{planId}</strong>
            {t(
              " 这份升级计划（HTTP 404）。",
              " upgrade plan with this id (HTTP 404).",
            )}
          </p>
          <p className={styles.unknownHint}>
            {t(
              "请确认计划 id 是否正确；已创建的升级计划可以在",
              "Check that the plan id is correct; existing upgrade plans can be verified on the",
            )}
            <Link className={styles.unknownLink} to="/upgrade">
              {t("升级计划", "Upgrade plans")}
            </Link>
            {t("页核对。", " page.")}
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
            ? t(
                "尚未取到计划数据，用右上角「刷新」重试。",
                "No plan data yet; retry with “Refresh” in the top-right corner.",
              )
            : t(
                "未设置 Admin Token：在右上角钥匙按钮里填入后才向管理面请求，这里不会显示数据。",
                "No Admin Token set: the admin plane is only queried once it is entered via the key button in the top bar, so no data is shown here.",
              )}
        </div>
      ) : null}

      {plan ? (
        <div className={styles.viewWrap}>
          <section
            className={styles.summary}
            aria-label={t("升级计划摘要", "Upgrade plan summary")}
          >
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>
                {t("Agent 数", "Agents")}
              </span>
              <span className={styles.summaryValue}>
                {planTargetCount(plan)}
              </span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>
                {t("成功", "Succeeded")}
              </span>
              <span className={`${styles.summaryValue} ${styles.valueOk}`}>
                {counts.succeeded}
              </span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>{t("失败", "Failed")}</span>
              <span
                className={`${styles.summaryValue} ${
                  counts.failed > 0 ? styles.valueCrit : ""
                }`}
              >
                {counts.failed}
              </span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>
                {t("执行中", "Running")}
              </span>
              <span className={styles.summaryValue}>{counts.dispatched}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>
                {t("待派发", "Awaiting dispatch")}
              </span>
              <span className={styles.summaryValue}>{counts.pending}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>{t("阶段", "Phase")}</span>
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
              {t("已{action}：", "{action}: ", {
                action: rolloutActionLabel(action.variables?.kind),
              })}
              {plan.status === "completed"
                ? t("计划已完成。", "Plan completed.")
                : t(
                    "当前处于第 {phase} 阶段。",
                    "Currently in phase {phase}.",
                    {
                      phase: plan.currentPhase,
                    },
                  )}
              {t(
                "Agent 下一次拉快照（≤30 秒）后会看到新派的工作。",
                " The agent will see the newly dispatched work at its next snapshot (≤30 seconds).",
              )}
            </div>
          ) : null}

          <section
            className={styles.card}
            aria-labelledby="rollout-plan-meta-title"
          >
            <header className={styles.cardHead}>
              <h2 className={styles.cardTitle} id="rollout-plan-meta-title">
                {t("升级参数", "Upgrade parameters")}
              </h2>
              <span className={styles.cardHint}>
                {t("各阶段共用一份", "Shared by all phases")}
              </span>
            </header>
            <dl className={styles.metaList}>
              <div className={styles.metaRow}>
                <dt>{t("任务类型", "Task type")}</dt>
                <dd>
                  <span className={styles.mono}>
                    {plan.action === "upgrade"
                      ? t("Agent 升级", "Agent upgrade")
                      : plan.action}
                  </span>
                </dd>
              </div>
              <div className={styles.metaRow}>
                <dt>{t("目标版本", "Target version")}</dt>
                <dd>
                  {spec?.error ? (
                    <span className={styles.valueWarn}>
                      {t(
                        "spec 不是合法 JSON：{detail}",
                        "spec is not valid JSON: {detail}",
                        {
                          detail: spec.error,
                        },
                      )}
                    </span>
                  ) : spec?.targetVersion ? (
                    <span className={styles.mono}>{spec.targetVersion}</span>
                  ) : (
                    <span className={styles.valueMuted}>
                      {t(
                        "由包内 agentd 决定",
                        "Determined by the agentd in the package",
                      )}
                    </span>
                  )}
                </dd>
              </div>
              <div className={styles.metaRow}>
                <dt>{t("截止时间", "Deadline")}</dt>
                <dd>
                  <span className={styles.mono}>
                    {formatTimestamp(plan.deadlineAt)}
                  </span>
                </dd>
              </div>
              <div className={`${styles.metaRow} ${styles.metaRowWide}`}>
                <dt>{t("包地址", "Package URL")}</dt>
                <dd>
                  <span className={styles.mono}>
                    {spec?.packageUrl ??
                      t(
                        "（按 Agent 平台自动选择）",
                        "(selected automatically per agent platform)",
                      )}
                  </span>
                </dd>
              </div>
              <div className={`${styles.metaRow} ${styles.metaRowWide}`}>
                <dt>{t("包摘要", "Package digest")}</dt>
                <dd>
                  <span className={styles.mono}>
                    {spec?.packageSha256 ??
                      t(
                        "（按 Agent 平台自动选择）",
                        "(selected automatically per agent platform)",
                      )}
                  </span>
                </dd>
              </div>
              <div className={styles.metaRow}>
                <dt>{t("单个 Agent 超时", "Per-agent timeout")}</dt>
                <dd>
                  <span className={styles.mono}>
                    {t("{n} 秒", "{n} seconds", { n: plan.timeoutSeconds })}
                  </span>
                </dd>
              </div>
              <div className={styles.metaRow}>
                <dt>{t("阶段内并发", "Concurrency within a phase")}</dt>
                <dd>
                  <span className={styles.mono}>
                    {plan.batchSize === 0
                      ? t(
                          "不节流（全部同时升级）",
                          "Unthrottled (all upgraded at once)",
                        )
                      : t("最多 {n} 台同时升级", "Up to {n} upgraded at once", {
                          n: plan.batchSize,
                        })}
                  </span>
                </dd>
              </div>
              <div className={styles.metaRow}>
                <dt>{t("创建", "Created")}</dt>
                <dd>
                  <span className={styles.mono}>
                    {formatTimestamp(plan.createdAt)}
                  </span>
                  <span className={styles.meta}>{plan.createdBy}</span>
                </dd>
              </div>
              <div className={`${styles.metaRow} ${styles.metaRowWide}`}>
                <dt>{t("批准", "Approved")}</dt>
                <dd>
                  {plan.approvedAt ? (
                    <>
                      <span className={styles.mono}>
                        {formatTimestamp(plan.approvedAt)}
                      </span>
                      <span className={styles.meta}>{plan.approvedBy}</span>
                    </>
                  ) : (
                    <span className={styles.valueMuted}>
                      {t("尚未批准", "Not approved yet")}
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <section
            className={styles.card}
            aria-labelledby="rollout-plan-phases-title"
          >
            <header className={styles.cardHead}>
              <h2 className={styles.cardTitle} id="rollout-plan-phases-title">
                {t("灰度阶段", "Rollout phases")}
              </h2>
              <span className={styles.cardHint}>
                {t(
                  "逐阶段推进：金丝雀确认无问题，再铺下一阶段",
                  "Advance phase by phase: confirm the canary is fine, then roll out the next phase",
                )}
              </span>
            </header>

            {plan.status === "draft" ? (
              <div className={styles.gateRow}>
                <div className={styles.gateCopy}>
                  <span className={styles.gateTitle}>
                    {t(
                      "批准并进入第一阶段",
                      "Approve and enter the first phase",
                    )}
                  </span>
                  <span className={styles.gateHint}>
                    {t(
                      "批准后为第 1 批（金丝雀）的 {n} 个 Agent 各派一件升级。",
                      "Approving dispatches one upgrade to each of the {n} agents in batch 1 (the canary).",
                      { n: plan.phases[0]?.targetIds.length ?? 0 },
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={action.isPending}
                  onClick={() => action.mutate({ kind: "approve", planId })}
                >
                  {action.isPending
                    ? t("正在批准…", "Approving…")
                    : t("批准", "Approve")}
                </button>
              </div>
            ) : null}

            {plan.status === "rolling" ? (
              <div className={styles.gateRow}>
                <div className={styles.gateCopy}>
                  <span className={styles.gateTitle}>
                    {isLastPhase
                      ? t("推进并收尾计划", "Advance and finish the plan")
                      : t("推进到下一阶段", "Advance to the next phase")}
                  </span>
                  <span className={styles.gateHint}>
                    {activeSettled
                      ? isLastPhase
                        ? t(
                            "当前阶段已全部了结，推进后计划完成。",
                            "The current phase is fully settled; advancing completes the plan.",
                          )
                        : t(
                            "当前阶段已全部了结，推进后为第 {phase} 批的 {n} 个 Agent 派发升级。",
                            "The current phase is fully settled; advancing dispatches upgrades to the {n} agents in batch {phase}.",
                            {
                              phase: plan.currentPhase + 1,
                              n:
                                plan.phases[plan.currentPhase]?.targetIds
                                  .length ?? 0,
                            },
                          )
                      : t(
                          "当前阶段还有 {n} 个目标未了结（执行中或待派发）。",
                          "{n} targets in the current phase are still unsettled (running or awaiting dispatch).",
                          { n: activeIncomplete },
                        )}
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
                  onClick={() => action.mutate({ kind: "advance", planId })}
                >
                  {action.isPending
                    ? t("正在推进…", "Advancing…")
                    : isLastPhase
                      ? t("推进并收尾", "Advance and finish")
                      : t("推进", "Advance")}
                </button>
              </div>
            ) : null}

            {counts.failed > 0 ? (
              <div className={styles.gateRow}>
                <div className={styles.gateCopy}>
                  <span className={styles.gateTitle}>
                    {t("重试失败项", "Retry failed items")}
                  </span>
                  <span className={styles.gateHint}>
                    {t(
                      "为 {n} 个失败目标重新派发升级（新的工作 id），并把计划重开为进行中。",
                      "Dispatch upgrades again (with new work ids) to the {n} failed targets and reopen the plan as rolling.",
                      { n: counts.failed },
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={action.isPending}
                  onClick={() => action.mutate({ kind: "retry", planId })}
                >
                  {action.isPending
                    ? t("正在重试…", "Retrying…")
                    : t("重试失败项", "Retry failed items")}
                </button>
              </div>
            ) : null}

            {!activeSettled && plan.status === "rolling" ? (
              <p className={styles.gateWarn} role="note">
                {t(
                  "本阶段未全部了结就推进，未了结目标的结果仍会回填到条目，但阶段会被标记为已完成 —— 人工闸门的判断权在你。",
                  "Advancing before the phase is fully settled still writes the results of unsettled targets back to their entries, but the phase is marked completed — the manual gate is your call.",
                )}
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
                      isActive
                        ? `${styles.phaseItem} ${styles.phaseActive}`
                        : styles.phaseItem
                    }
                  >
                    <div className={styles.phaseTop}>
                      <span className={styles.phaseIndex}>
                        {t("第 {index} 批", "Batch {index}", {
                          index: phase.phaseIndex,
                        })}
                      </span>
                      <span
                        className={`${styles.badge} ${toneClass(phaseStatusTone(phase.status))}`}
                      >
                        {phaseStatusLabel(phase.status)}
                      </span>
                      <span className={styles.phaseMeta}>
                        {t("{n} 个 Agent", "{n} agents", {
                          n: phase.targetIds.length,
                        })}{" "}
                        ·{" "}
                        {advanceRuleLabel(
                          phase.advanceRule,
                          phase.phaseIndex === plan.phases.length,
                        )}
                      </span>
                    </div>
                    <div className={styles.phaseProgress}>
                      {settled
                        ? t("已全部了结", "Fully settled")
                        : t("未了结 {n} 个", "{n} unsettled", {
                            n: phaseIncompleteCount(phase, entries),
                          })}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <section
            className={styles.card}
            aria-labelledby="rollout-plan-entries-title"
          >
            <header className={styles.cardHead}>
              <h2 className={styles.cardTitle} id="rollout-plan-entries-title">
                {t("逐台进度", "Per-agent progress")}
              </h2>
              <span className={styles.cardHint}>
                {t(
                  "一个 Agent 一行；进入阶段时才派发升级，结果回填到这里",
                  "One row per agent; upgrades are dispatched only when the phase is entered, and results are written back here",
                )}
              </span>
            </header>

            {entries.length === 0 ? (
              <p className={styles.emptyNotice}>
                {t(
                  "这份计划还没有 Agent 条目。",
                  "This plan has no agent entries yet.",
                )}
              </p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Agent</th>
                      <th scope="col">{t("状态", "Status")}</th>
                      <th scope="col">{t("升级工作", "Upgrade work")}</th>
                      <th scope="col">{t("说明", "Detail")}</th>
                      <th scope="col">{t("更新时间", "Updated at")}</th>
                      <th scope="col">{t("操作", "Actions")}</th>
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
                        <td>
                          {entry.status === "failed" ? (
                            <button
                              type="button"
                              className={styles.smallButton}
                              disabled={action.isPending}
                              onClick={() =>
                                action.mutate({
                                  kind: "retry",
                                  planId,
                                  targetIds: [entry.targetId],
                                })
                              }
                            >
                              {t("重试", "Retry")}
                            </button>
                          ) : (
                            <span className={styles.valueMuted}>—</span>
                          )}
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
