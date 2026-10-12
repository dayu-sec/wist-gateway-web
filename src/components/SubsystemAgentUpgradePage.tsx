import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, getAdminApiToken, isRateLimitedError } from "../api";
import { jsonUpgradeSpec, parseUpgradeSpec } from "../api/admin";
import {
  useCreateRolloutPlan,
  useAgentInstallPackage,
  useInstallPackages,
  useRegisteredAgents,
  useRolloutPlans,
} from "../hooks";
import {
  LATEST_PLAN_LIMIT,
  availablePhaseCounts,
  filterRolloutPlans,
  latestPlans,
  phaseScaleLabel,
  planPhases,
  planStatusFilters,
  planStatusLabel,
  planStatusTone,
  planTargetCount,
  planTimeRanges,
  type PlanStatusFilter,
  type PlanTimeRange,
} from "@dayu-sec/wist-web-core/release";
import {
  canSubmitUpgrade,
  findVersionOption,
  indexPackagesByUrl,
  isEmptyPackageHistory,
  planVersionCellLabel,
  versionOptionLabel,
} from "./agentUpgradePackages";
import { selectUpgradeTargets } from "./agentUpgradeTargets";
import { platformLabel } from "./agentPackagePlatforms";
import { inUseVersionOptions } from "./agentPackageRegistry";
import { RateLimitNotice } from "./RateLimitNotice";
import { t, dateLocale } from "../i18n";
import styles from "./SubsystemAgentUpgradePage.module.css";

/**
 * 本页就是「Agent 升级」——**不做任务类型选择**。
 *
 * 引擎（模型 `Control.Rollout`）本是通用的「分阶段灰度铺任务」，但页面对操作者只呈现这一种
 * 具体任务：固定 `action = upgrade`。将来日志清理、数据备份等各是一片独立的页（同一引擎、
 * 不同参数），不在这里变成下拉项。
 */
const UPGRADE_ACTION = "upgrade";

/** 读取列表失败时的提示（口径与安装包设置页一致）。 */
function loadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return t(
        "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击“应用”。",
        "Admin Token missing or invalid: enter a valid Admin Token on the left and click “Apply”.",
      );
    if (error.status === 429)
      return t("认证失败次数过多，请稍后再试。", "Too many failed authentication attempts. Try again later.");
    if (error.status === 404)
      return t(
        "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。",
        "The gateway has no such endpoint (HTTP 404): the running gateway is likely an old build. Rebuild and restart the gateway, then retry.",
      );
    return error.detail
      ? t("网关返回 HTTP {status}：{detail}", "Gateway returned HTTP {status}: {detail}", {
          status: error.status,
          detail: error.detail,
        })
      : t(
          "网关返回 HTTP {status}，请检查网关日志。",
          "Gateway returned HTTP {status}; check the gateway logs.",
          { status: error.status },
        );
  }
  return t(
    "读取失败：响应不符合当前契约，请检查网关与前端版本。",
    "Load failed: the response does not match the current contract. Check the gateway and frontend versions.",
  );
}

/** 创建失败时的提示：网关对每种 400 都有明确原因，优先透出正文。 */
function createErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return t(
        "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击“应用”。",
        "Admin Token missing or invalid: enter a valid Admin Token on the left and click “Apply”.",
      );
    if (error.status === 429)
      return t("认证失败次数过多，请稍后再试。", "Too many failed authentication attempts. Try again later.");
    if (error.status === 404)
      return t(
        "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。",
        "The gateway has no such endpoint (HTTP 404): the running gateway is likely an old build. Rebuild and restart the gateway, then retry.",
      );
    if (error.detail)
      return t("创建失败（HTTP {status}）：{detail}", "Create failed (HTTP {status}): {detail}", {
        status: error.status,
        detail: error.detail,
      });
    return t(
      "创建失败（HTTP {status}），请检查网关日志。",
      "Create failed (HTTP {status}); check the gateway logs.",
      { status: error.status },
    );
  }
  return t(
    "创建失败：响应不符合当前契约，请检查网关与前端版本。",
    "Create failed: the response does not match the current contract. Check the gateway and frontend versions.",
  );
}

function formatTimestamp(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString(dateLocale(), { hour12: false });
}

/** 把 Date 写成 `<input type="datetime-local">` 要的本地时间串。 */
function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 默认截止：现在 + 24 小时。 */
function defaultDeadline(): string {
  return toLocalInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000));
}

/** 表单里的 `datetime-local` 值折成紧凑读法（`9/26 22:30`），用于提交前摘要。 */
function formatDeadlineHint(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${at.getMonth() + 1}/${at.getDate()} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function toneClass(tone: string): string {
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
 * Agent 升级页（模型 `Control.Rollout` 的具体化：`ListRolloutPlans` + `CreateRolloutPlan`）。
 *
 * 引擎是通用的「分阶段灰度铺任务」，但页面对操作者要**具体** —— 今天就是「Agent 升级」：
 * 把 agentd 按灰度阶段（金丝雀 → 扩大 → 全量）升级到指定版本。灰度阶段只让运维选**阶段数**
 * （2/3/4/5），每个阶段的 agent_id 由 `planPhases` 按固定阶梯**自动分配**，不用手填。
 * 批准/推进在升级计划详情页 —— 那两个是灰度发布的**人工闸门**。
 *
 * 更具体地说，「升级」在这里只要选**一个版本** —— 每个 Agent 对应平台的制品由**网关**在派活时
 * 按目标 agent 的平台自动挑好（与中心按网关平台派生 gops/gx 制品同一思路），不用手选制品。
 * 它的推进方式（灰度阶段、阶段内并发、截止）由引擎提供。
 * 将来日志清理、数据备份等各是一片独立的页。
 */
export function SubsystemAgentUpgradePage() {
  const plans = useRolloutPlans();
  // 机队 = **已注册**的 Agent（不是“有主机指标的”）：待命/新装的机器不上送指标，
  // 用指标列表会让它们从升级计划里彻底消失。
  const agents = useRegisteredAgents();
  // 可选的升级包 = 网关**已录入**的安装包历史（不再让操作者手输地址 + 摘要）。
  const packages = useInstallPackages();
  const currentPackages = useAgentInstallPackage();
  const create = useCreateRolloutPlan();
  const navigate = useNavigate();

  // 升级目标只取在线的机器（排掉明确离线的），并把被排掉的台数说出来 —— 不然一台离线
  // 机器为何不在计划里会很难查。在线判据由**网关**给（不在这页重新定义一次“多久算掉线”）。
  const { agentIds, fleetSize, offlineCount } = useMemo(
    () => selectUpgradeTargets(agents.data ?? []),
    [agents.data],
  );

  // ── 表单状态 ────────────────────────────────────────────────────────────
  const [selectedVersion, setSelectedVersion] = useState("");
  const [allowDowngrade, setAllowDowngrade] = useState(false);
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [timeoutSeconds, setTimeoutSeconds] = useState("600");
  const [batchSize, setBatchSize] = useState("0");
  const [phaseCount, setPhaseCount] = useState(3);
  const [formError, setFormError] = useState<string | null>(null);

  // 升级计划**列表**的筛选（状态分页 + 时间窗）。只影响上面的列表，不影响下方的创建表单。
  const [statusFilter, setStatusFilter] = useState<PlanStatusFilter>("all");
  const [timeRange, setTimeRange] = useState<PlanTimeRange>("all");

  const installPackages = packages.data ?? [];
  // 升级按**版本**选，且**只有在用版本**可选：包目录是存档，里面的旧版本页面标「已归档」，拿它们
  // 当升级目标等于把 Agent 升到网关已不再分发的版本。判据与「安装包管理」页的「在用」同源。
  const versionOptions = inUseVersionOptions(
    installPackages,
    currentPackages.data?.packages ?? [],
  );
  const selectedVersionOption = findVersionOption(versionOptions, selectedVersion);
  // 计划 → 包（仅旧计划 / 显式制品兑底显示用）：按下载地址反查「哪个包」。
  const packageByUrl = indexPackagesByUrl(installPackages);

  // 阶段数按机队台数收窄：每段至少 1 台，小机队就不再多轮。
  const phaseCounts = useMemo(
    () => availablePhaseCounts(agentIds.length),
    [agentIds.length],
  );
  const effectivePhaseCount = phaseCounts.includes(phaseCount)
    ? phaseCount
    : (phaseCounts[phaseCounts.length - 1] ?? phaseCount);

  // 阶段分配（纯派生，跟着机队与阶段数走）。
  const phasePlan = useMemo(
    () => planPhases(agentIds, effectivePhaseCount),
    [agentIds, effectivePhaseCount],
  );

  // 本页只呈现「Agent 升级」这一种任务；引擎里可能还有别的 action（将来）。
  const upgradePlans = useMemo(
    () => (plans.data ?? []).filter((plan) => plan.action === UPGRADE_ACTION),
    [plans.data],
  );

  // 先按「状态 + 时间窗」筛，再取**最近** LATEST_PLAN_LIMIT 条（后端已按 created_at 倒序）。
  // 总数与「筛出数」都按全量算，免得「共 N 份」被裁成 5 份 —— 展示条数与统计是两件事。
  const filtering = statusFilter !== "all" || timeRange !== "all";
  const filteredPlans = useMemo(
    () =>
      filterRolloutPlans(
        upgradePlans,
        { status: statusFilter, timeRange },
        new Date(),
      ),
    [upgradePlans, statusFilter, timeRange],
  );
  // 未筛选时只铺**最近** LATEST_PLAN_LIMIT 条（列表默认视图保持精简）；一旦按状态 / 时间窗
  // 筛过了，就把命中的全铺出来 —— 筛完还被裁掉几条会让人以为「搜不到」。
  const visiblePlans = useMemo(
    () => (filtering ? filteredPlans : latestPlans(filteredPlans)),
    [filtering, filteredPlans],
  );

  /**
   * 把表单折算成创建命令。校验放在提交前，是为了在**本地**说清「哪一段不成立」，
   * 而不是让网关回一个只说第一条错的 400。
   */
  function buildCommand(): {
    spec: string;
    targetIds: string[];
    phaseCount: number;
    deadlineAt: string;
    timeout: number;
    batch: number;
  } | null {
    if (!selectedVersionOption) {
      setFormError(t("请先选择一个在用版本。", "Pick a version in use first."));
      return null;
    }
    const at = new Date(deadline);
    if (Number.isNaN(at.getTime())) {
      setFormError(t("截止时间不是合法的时间。", "The deadline is not a valid time."));
      return null;
    }
    const timeout = Number(timeoutSeconds);
    if (!Number.isInteger(timeout) || timeout <= 0) {
      setFormError(
        t(
          "单个 Agent 的升级超时必须是正整数秒。",
          "The per-agent upgrade timeout must be a positive whole number of seconds.",
        ),
      );
      return null;
    }
    const batch = Number(batchSize);
    if (!Number.isInteger(batch) || batch < 0) {
      setFormError(
        t(
          "阶段内并发必须是非负整数（0 = 不节流）。",
          "Concurrency per phase must be a non-negative whole number (0 = unthrottled).",
        ),
      );
      return null;
    }
    if (phasePlan.error) {
      setFormError(phasePlan.error);
      return null;
    }
    setFormError(null);
    return {
      // 只写 target_version：制品由**网关**在派活时按每个目标 agent 的平台解析（不手选制品）。
      // 不写 target_version 以外的包字段 —— 那才是「按版本」这一路径的判据。
      spec: jsonUpgradeSpec({
        targetVersion: selectedVersionOption.version,
        allowDowngrade,
      }),
      // 阶段交给服务端切（只给目标 + 段数）；上面的 `phasePlan` 只用于预览。
      targetIds: agentIds,
      phaseCount: effectivePhaseCount,
      deadlineAt: at.toISOString(),
      timeout,
      batch,
    };
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const built = buildCommand();
    if (!built) return;
    create.mutate(
      {
        action: UPGRADE_ACTION,
        spec: built.spec,
        targetIds: built.targetIds,
        phaseCount: built.phaseCount,
        deadlineAt: built.deadlineAt,
        timeoutSeconds: built.timeout,
        batchSize: built.batch,
      },
      {
        onSuccess: (plan) =>
          navigate(`/upgrade/${encodeURIComponent(plan.planId)}`),
      },
    );
  }

  const noToken = !getAdminApiToken();

  // 筛选选项的文案跟着语言走（共享包里的 `PLAN_STATUS_FILTERS` / `PLAN_TIME_RANGES` 是 zh 原文表）。
  const statusFilters = planStatusFilters();
  const timeRanges = planTimeRanges();

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <div className={styles.titleRow}>
          <h1 className={styles.pageTitle}>{t("Agent 升级", "Agent upgrade")}</h1>
          <Link className={styles.crossLink} to="/gateway-info">
            {t("Gateway 信息", "Gateway info")} <span aria-hidden="true">→</span>
          </Link>
        </div>
        <p className={styles.pageSummary}>
          {t(
            "按灰度节奏（金丝雀 → 扩大 → 全量）把 agentd 升到指定版本。计划只是编排：批准后才派发，逐台成败由 agentd 上报回填。",
            "Roll agentd out to a chosen version in stages (canary → expand → full). A plan is just orchestration: nothing is dispatched until approved, and each host's outcome is reported back by agentd.",
          )}
        </p>
      </header>

      <section className={styles.panel} aria-labelledby="upgrade-plans-title">
        <header className={styles.panelHead}>
          <h2 className={styles.panelTitle} id="upgrade-plans-title">
            {t("升级计划", "Upgrade plans")}
          </h2>
          <span className={styles.panelHint}>
            {upgradePlans.length > 0
              ? filtering
                ? t(
                    "共 {total} 份 · 筛出 {filtered} 份 · ",
                    "{total} total · {filtered} matched · ",
                    { total: upgradePlans.length, filtered: filteredPlans.length },
                  )
                : t("共 {total} 份 · ", "{total} total · ", {
                    total: upgradePlans.length,
                  })
              : ""}
            {!filtering && filteredPlans.length > LATEST_PLAN_LIMIT
              ? t(
                  "列表只列最近 {limit} 条 · ",
                  "List shows the latest {limit} · ",
                  { limit: LATEST_PLAN_LIMIT },
                )
              : ""}
            {t(
              "不自动轮询：只有创建 / 批准 / 推进会改变计划，操作后自动重取",
              "No auto-polling: only create / approve / advance changes a plan, and the list refetches after those actions",
            )}
          </span>
        </header>

        {upgradePlans.length > 0 ? (
          <div className={styles.planFilters}>
            <div
              className={styles.countTabs}
              role="group"
              aria-label={t("按状态筛选", "Filter by status")}
            >
              {statusFilters.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={
                    option.value === statusFilter
                      ? `${styles.countTab} ${styles.countTabActive}`
                      : styles.countTab
                  }
                  aria-pressed={option.value === statusFilter}
                  onClick={() => setStatusFilter(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <label className={styles.planRangeFilter}>
              <span>{t("时间", "Time")}</span>
              <select
                value={timeRange}
                onChange={(event) =>
                  setTimeRange(event.target.value as PlanTimeRange)
                }
              >
                {timeRanges.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        {plans.isError ? (
          isRateLimitedError(plans.error) ? (
            <RateLimitNotice error={plans.error} />
          ) : (
            <div className={styles.errorBanner} role="alert">
              {loadErrorMessage(plans.error)}
            </div>
          )
        ) : null}

        {!plans.isError && plans.isLoading ? (
          <div className={styles.skeletonWrap}>
            {[0, 1].map((index) => (
              <div key={index} className={styles.skeletonRow} />
            ))}
          </div>
        ) : null}

        {!plans.isError && !plans.isLoading && upgradePlans.length === 0 ? (
          <div className={styles.empty}>
            <strong className={styles.emptyTitle}>
              {t("还没有升级计划", "No upgrade plans yet")}
            </strong>
            <span className={styles.emptyText}>
              {noToken
                ? t(
                    "未设置 Admin Token：在左侧填入后才向管理面请求。",
                    "No Admin Token set: fill it in on the left to query the admin API.",
                  )
                : t(
                    "在下方创建第一份升级计划。",
                    "Create the first upgrade plan below.",
                  )}
            </span>
          </div>
        ) : null}

        {!plans.isError &&
        !plans.isLoading &&
        upgradePlans.length > 0 &&
        filteredPlans.length === 0 ? (
          <div className={styles.empty}>
            <strong className={styles.emptyTitle}>
              {t("没有符合条件的计划", "No plans match")}
            </strong>
            <span className={styles.emptyText}>
              {t(
                "共 {total} 份，但当前「状态 + 时间」筛不出计划 —— 换一个状态或时间范围试试。",
                "{total} plans in total, but the current status + time filter matches none — try another status or time range.",
                { total: upgradePlans.length },
              )}
            </span>
          </div>
        ) : null}

        {visiblePlans.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t("计划", "Plan")}</th>
                  <th scope="col" className={styles.pkgCol}>
                    {t("目标版本", "Target version")}
                  </th>
                  <th scope="col">{t("状态", "Status")}</th>
                  <th scope="col">{t("阶段", "Phase")}</th>
                  <th scope="col" className={styles.thNum}>
                    {t("目标台数", "Targets")}
                  </th>
                  <th scope="col">{t("创建", "Created")}</th>
                </tr>
              </thead>
              <tbody>
                {visiblePlans.map((plan) => {
                  const done = plan.phases.filter(
                    (phase) => phase.status === "completed",
                  ).length;
                  const spec = parseUpgradeSpec(plan.spec);
                  return (
                    <tr key={plan.planId}>
                      <td>
                        {/* 计划 ID 本身就是详情页入口：不再单开一列「查看」。 */}
                        <Link
                          className={styles.planLink}
                          to={`/upgrade/${encodeURIComponent(plan.planId)}`}
                        >
                          {plan.planId}
                          <span className={styles.planArrow} aria-hidden="true">
                            →
                          </span>
                        </Link>
                      </td>
                      <td className={styles.pkgCol}>
                        {/* 按版本选：列目标版本。旧计划（显式制品）退回「版本 · 架构」/ 文件名。 */}
                        <span
                          className={styles.pkgCell}
                          title={
                            spec.targetVersion ?? spec.packageUrl ?? undefined
                          }
                        >
                          {planVersionCellLabel(spec, packageByUrl)}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`${styles.badge} ${toneClass(planStatusTone(plan.status))}`}
                        >
                          {planStatusLabel(plan.status)}
                        </span>
                      </td>
                      <td>
                        <span
                          className={styles.phaseCell}
                          title={t(
                            "已走完 {done} 批，共 {total} 批",
                            "{done} of {total} batches done",
                            { done, total: plan.phases.length },
                          )}
                        >
                          <span className={styles.phaseDots} aria-hidden="true">
                            {plan.phases.map((phase) => (
                              <span
                                key={phase.phaseIndex}
                                className={`${styles.phaseDot} ${
                                  phase.status === "completed"
                                    ? styles.phaseDotDone
                                    : phase.status === "rolling"
                                      ? styles.phaseDotActive
                                      : ""
                                }`}
                              />
                            ))}
                          </span>
                          <span className={styles.mono}>
                            {plan.currentPhase > 0 ? plan.currentPhase : 0} /{" "}
                            {plan.phases.length}
                          </span>
                        </span>
                      </td>
                      <td className={`${styles.tdNum} ${styles.mono}`}>
                        {planTargetCount(plan)}
                      </td>
                      <td>
                        <span className={styles.timeCell}>
                          {formatTimestamp(plan.createdAt)}
                          <span className={styles.timeMeta}>{plan.createdBy}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className={styles.panel} aria-labelledby="upgrade-create-title">
        <header className={styles.panelHead}>
          <h2 className={styles.panelTitle} id="upgrade-create-title">
            {t("新建升级计划", "New upgrade plan")}
          </h2>
          <span className={styles.panelHint}>
            {t(
              "创建后是草稿；批准前不会派发任何升级",
              "Created as a draft; nothing is dispatched before approval",
            )}
          </span>
        </header>

        <form className={styles.form} onSubmit={handleSubmit}>
          <section className={styles.formSection}>
            <div className={styles.sectionHead}>
              <h3 className={styles.formSectionTitle}>
                {t("升级参数", "Upgrade parameters")}
              </h3>
              <span className={styles.sectionNote}>
                {t(
                  "选一个版本 —— 每个 Agent 对应平台的制品由网关在派活时自动挑好，无需手选制品",
                  "Pick one version — the gateway automatically picks the artifact for each agent's platform when dispatching; no manual artifact selection",
                )}
              </span>
            </div>

            {packages.isError ? (
              isRateLimitedError(packages.error) ? (
                <RateLimitNotice error={packages.error} />
              ) : (
                <div className={styles.errorBanner} role="alert">
                  {loadErrorMessage(packages.error)}
                </div>
              )
            ) : null}

            {isEmptyPackageHistory({
              isLoading: packages.isLoading,
              isError: packages.isError,
              count: installPackages.length,
            }) ? (
              <div className={styles.packageEmpty}>
                <strong>{t("还没有录入过安装包", "No install packages recorded yet")}</strong>
                <span>
                  {t("去", "Go to the")}{" "}
                  <Link to="/install-package">{t("安装包", "Install packages")}</Link>{" "}
                  {t(
                    "页填「安装包来源」（本地路径或 https 均可），网关会把它存进自己的包目录，之后这里就能选。",
                    "page and fill in the package source (a local path or https both work); the gateway stores it in its own package catalog, and it becomes selectable here.",
                  )}
                </span>
              </div>
            ) : null}

            {versionOptions.length > 0 ? (
              <div className={styles.fieldColumn}>
                <label className={styles.field}>
                  <span>{t("目标版本", "Target version")}</span>
                  <select
                    value={selectedVersion}
                    onChange={(event) => setSelectedVersion(event.target.value)}
                    required
                  >
                    <option value="">
                      {versionOptions.length === 0
                        ? t("当前没有在用版本", "No version in use")
                        : t("选择一个在用版本…", "Pick a version in use…")}
                    </option>
                    {versionOptions.map((option) => (
                      <option
                        key={option.version}
                        value={option.version}
                        // 选项文字只给版本号（与中心的「请选择已发布版本」一致）；覆盖了哪些平台在
                        // 下面那行「已覆盖平台」里说，悬停也能看到。
                        title={versionOptionLabel(option)}
                      >
                        {option.version}
                      </option>
                    ))}
                  </select>
                  <small>
                    {versionOptions.length === 0
                      ? t(
                          "包目录里没有「在用」版本：旧版本已归档，不能作为升级目标。先到「安装包录入」把要升级到的版本录成当前分发版本，再回来建计划。",
                          "No version in use in the package catalog: older versions are archived and cannot be a rollout target. Record the version you want to roll out under Install package entry first, then come back.",
                        )
                      : t(
                          "只选版本，且只列在用版本；每个 Agent 对应平台的制品由网关在派活时自动挑好（与 gops 计划同一思路）。",
                          "Version only, and only versions in use; the gateway automatically picks the artifact for each agent's platform when dispatching (same idea as gops plans).",
                        )}
                  </small>
                </label>

                {selectedVersionOption ? (
                  <div className={styles.packageDetail}>
                    <span className={styles.packageDetailLabel}>
                      {t("已覆盖平台", "Covered platforms")}
                    </span>
                    <span className={styles.mono}>
                      {selectedVersionOption.platforms.length > 0
                        ? selectedVersionOption.platforms
                            .map((platform) => platformLabel(platform))
                            .join(" / ")
                        : t(
                            "未识别平台（请到「安装包」页确认包是否完整）",
                            "Platform not recognized (check on the Install packages page whether the package is complete)",
                          )}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {installPackages.length > 0 && versionOptions.length === 0 ? (
              <div className={styles.packageEmpty}>
                <strong>
                  {t(
                    "已录入的安装包都读不出身份",
                    "None of the recorded install packages has a readable identity",
                  )}
                </strong>
                <span>
                  {t(
                    "包内目录名里没有可识别的「版本 + 平台」，无法按版本升级 —— 到",
                    "The package directory name has no recognizable version + platform, so version-based upgrades are impossible — go to the",
                  )}{" "}
                  <Link to="/install-package">{t("安装包", "Install packages")}</Link>{" "}
                  {t("页重新录入带身份的包。", "page and record a package with an identity.")}
                </span>
              </div>
            ) : null}

            {installPackages.length > 0 ? (
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={allowDowngrade}
                  onChange={(event) => setAllowDowngrade(event.target.checked)}
                />
                <span>
                  {t("允许降级", "Allow downgrade")}
                  <small className={styles.checkboxNote}>
                    {t(
                      "默认只允许更新（版本高于当前）；勾选后才允许同版本 / 降级。",
                      "By default only updates are allowed (version higher than current); check to also allow the same version / a downgrade.",
                    )}
                  </small>
                </span>
              </label>
            ) : null}
          </section>

          <section className={styles.formSection}>
            <div className={styles.sectionHead}>
              <h3 className={styles.formSectionTitle}>
                {t("升级节奏", "Rollout pacing")}
              </h3>
            </div>
            <div className={styles.fieldGridThree}>
              <label className={styles.field}>
                <span>{t("截止时间", "Deadline")}</span>
                <input
                  type="datetime-local"
                  value={deadline}
                  onChange={(event) => setDeadline(event.target.value)}
                  required
                />
                <small>
                  {t(
                    "到点仍未完成的升级会被判过期。",
                    "Upgrades not finished by then are considered expired.",
                  )}
                </small>
              </label>
              <label className={styles.field}>
                <span>{t("单个 Agent 升级超时", "Per-agent upgrade timeout")}</span>
                <span className={styles.inputWrap}>
                  <input
                    type="number"
                    min="1"
                    value={timeoutSeconds}
                    onChange={(event) => setTimeoutSeconds(event.target.value)}
                    required
                  />
                  <span className={styles.inputUnit}>{t("秒", "s")}</span>
                </span>
                <small>{t("只在实际执行时计时。", "Timed only while actually running.")}</small>
              </label>
              <label className={styles.field}>
                <span>{t("阶段内并发", "Concurrency per phase")}</span>
                <span className={styles.inputWrap}>
                  <input
                    type="number"
                    min="0"
                    value={batchSize}
                    onChange={(event) => setBatchSize(event.target.value)}
                    required
                  />
                  <span className={styles.inputUnit}>{t("台", "hosts")}</span>
                </span>
                <small>
                  {t(
                    "0 = 不节流；N = 每阶段最多 N 台同时升级。",
                    "0 = unthrottled; N = at most N hosts upgrade at the same time per phase.",
                  )}
                </small>
              </label>
            </div>
          </section>

          <section className={styles.formSection}>
            <div className={styles.sectionHead}>
              <h3 className={styles.formSectionTitle}>{t("灰度阶段", "Rollout phases")}</h3>
              <span className={styles.sectionNote}>
                {t(
                  "选阶段数即可 —— 按 1 台 → 10% → 30% → 70% → 全量的阶梯自动分配 Agent，无需手填",
                  "Just pick the number of phases — agents are assigned automatically along the 1 → 10% → 30% → 70% → full ladder; nothing to fill in by hand",
                )}
              </span>
            </div>

            {phaseCounts.length > 0 ? (
              <div
                className={styles.countTabs}
                role="group"
                aria-label={t("灰度阶段数", "Number of rollout phases")}
              >
                {phaseCounts.map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={
                      count === effectivePhaseCount
                        ? `${styles.countTab} ${styles.countTabActive}`
                        : styles.countTab
                    }
                    aria-pressed={count === effectivePhaseCount}
                    onClick={() => setPhaseCount(count)}
                  >
                    {t("{count} 阶段", "{count} phases", { count })}
                  </button>
                ))}
              </div>
            ) : null}

            <span className={styles.formNote}>
              {t("在线 {n} 台", "{n} hosts online", { n: agentIds.length })}
              {offlineCount > 0
                ? t(
                    "（机队 {fleet} 台，已排除离线 {offline} 台）",
                    " ({fleet} in fleet, {offline} offline excluded)",
                    { fleet: fleetSize, offline: offlineCount },
                  )
                : null}
              {t(
                "，最多分 {max} 批 —— 每段至少 1 台，按排序后的 agent_id 依次切片、互不重叠（一个 Agent 只升一次）。推进一律人工确认。",
                ", up to {max} batches — at least 1 host per phase, sliced in order of the sorted agent_id with no overlap (each agent upgrades once). Every advance is confirmed manually.",
                {
                  max: phaseCounts.length > 0 ? phaseCounts[phaseCounts.length - 1] : 0,
                },
              )}
            </span>

            {phasePlan.error ? (
              <div className={styles.errorBanner} role="alert">
                {phasePlan.error}
              </div>
            ) : (
              <ol className={styles.phaseList}>
                {phasePlan.phases.map((phase) => (
                  <li key={phase.index} className={styles.phaseItem}>
                    <div className={styles.phaseRail} aria-hidden="true">
                      <span
                        className={`${styles.railDot} ${
                          phase.isCanary
                            ? styles.railDotCanary
                            : phase.isFinal
                              ? styles.railDotFinal
                              : ""
                        }`}
                      >
                        {phase.index}
                      </span>
                      <span className={styles.railLine} />
                    </div>
                    <div className={styles.phaseBody}>
                      <div className={styles.phaseTop}>
                        <span className={styles.phaseIndex}>
                          {t("第 {index} 批", "Batch {index}", { index: phase.index })}
                        </span>
                        <span
                          className={`${styles.phaseScale} ${
                            phase.isCanary
                              ? styles.phaseScaleCanary
                              : phase.isFinal
                                ? styles.phaseScaleFinal
                                : ""
                          }`}
                        >
                          {phase.isFinal
                            ? t("全量（剩余）", "Full (remaining)")
                            : phaseScaleLabel(phase)}
                        </span>
                        <span className={styles.phaseMeta}>
                          {t("新增 {n} 台", "{n} added", {
                            n: phase.targetIds.length,
                          })}
                        </span>
                      </div>
                      <div className={styles.phaseAgents}>
                        {phase.targetIds.map((id) => (
                          <span key={id} className={styles.agentChip}>
                            {id}
                          </span>
                        ))}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {formError ? (
            <div className={styles.errorBanner} role="alert">
              {formError}
            </div>
          ) : null}
          {create.isError ? (
            <div className={styles.errorBanner} role="alert">
              {createErrorMessage(create.error)}
            </div>
          ) : null}

          <div className={styles.formActions}>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={
                !canSubmitUpgrade({
                  isPending: create.isPending,
                  phaseError: phasePlan.error,
                  selectedVersion,
                })
              }
            >
              {create.isPending
                ? t("正在创建…", "Creating…")
                : t("创建升级计划（草稿）", "Create upgrade plan (draft)")}
            </button>
            {/* 提交前把「这份计划长什么样」摊开：阶段 / 目标 / 并发 / 降级 / 截止。 */}
            <dl className={styles.planSummary}>
              <div className={styles.planSummaryItem}>
                <dt>{t("阶段", "Phases")}</dt>
                <dd>
                  {phasePlan.error
                    ? "—"
                    : t("{n} 批", "{n} batches", { n: effectivePhaseCount })}
                </dd>
              </div>
              <div className={styles.planSummaryItem}>
                <dt>{t("目标", "Targets")}</dt>
                <dd>{t("{n} 台", "{n} hosts", { n: agentIds.length })}</dd>
              </div>
              <div className={styles.planSummaryItem}>
                <dt>{t("并发", "Concurrency")}</dt>
                <dd>
                  {batchSize.trim() === "0"
                    ? t("不节流", "Unthrottled")
                    : t("{n} 台 / 批", "{n} hosts / batch", { n: batchSize })}
                </dd>
              </div>
              <div className={styles.planSummaryItem}>
                <dt>{t("降级", "Downgrade")}</dt>
                <dd>
                  {allowDowngrade
                    ? t("允许", "Allowed")
                    : t("不允许", "Not allowed")}
                </dd>
              </div>
              <div className={styles.planSummaryItem}>
                <dt>{t("截止", "Deadline")}</dt>
                <dd>{formatDeadlineHint(deadline)}</dd>
              </div>
            </dl>
          </div>
        </form>
      </section>
    </div>
  );
}
