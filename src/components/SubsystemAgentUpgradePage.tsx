import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, getAdminApiToken, isRateLimitedError } from "../api";
import { jsonUpgradeSpec, parseUpgradeSpec } from "../api/admin";
import {
  useCreateRolloutPlan,
  useRegisteredAgents,
  useRolloutPlans,
} from "../hooks";
import {
  availablePhaseCounts,
  phaseScaleLabel,
  planPhases,
  selectUpgradeTargets,
} from "./agentUpgradePhases";
import { RateLimitNotice } from "./RateLimitNotice";
import { planStatusLabel, planStatusTone, planTargetCount } from "./rolloutStatus";
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

/** 创建失败时的提示：网关对每种 400 都有明确原因，优先透出正文。 */
function createErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击“应用”。";
    if (error.status === 429) return "认证失败次数过多，请稍后再试。";
    if (error.status === 404)
      return "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。";
    if (error.detail) return `创建失败（HTTP ${error.status}）：${error.detail}`;
    return `创建失败（HTTP ${error.status}），请检查网关日志。`;
  }
  return "创建失败：响应不符合当前契约，请检查网关与前端版本。";
}

function formatTimestamp(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString("zh-CN", { hour12: false });
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

/**
 * 升级器取的包地址（`package_url`）：`https://…` 走网关取包，`/abs/path` 直接读本机。
 * 后者是**目标 Agent 主机上的绝对路径**（离线/联调把制品预置到目标机）。
 */
function isValidPackageUrl(value: string): boolean {
  const text = value.trim();
  return text.startsWith("https://") || text.startsWith("/");
}

/** 制品摘要（`package_sha256`）：64 位 hex，可带 `sha256:` 前缀（与升级器口径一致）。 */
function isValidPackageSha256(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value.trim().replace(/^sha256:/, ""));
}

/**
 * 包地址折成文件名（列表里只够放一格）。
 *
 * 目标版本现在由包决定，列表要认的就是「哪个包」：文件名里带着版本与目标架构
 * （`wist-agentd-0.1.5-aarch64-apple-darwin.tar.gz`），同版本不同 sha 的包则靠悬停看全地址。
 */
function packageFileName(url: string | null): string {
  if (!url) return "—";
  const trimmed = url.trim().replace(/[/\\]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut >= 0 ? trimmed.slice(cut + 1) : trimmed;
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
 * 更具体地说，「升级」在这里只是一组参数（包地址 / 摘要）；目标版本由包决定（升级器从包内
 * agentd 自报取得）。它的推进方式（灰度阶段、阶段内并发、截止）由引擎提供。将来日志清理、
 * 数据备份等各是一片独立的页。
 */
export function SubsystemAgentUpgradePage() {
  const plans = useRolloutPlans();
  // 机队 = **已注册**的 Agent（不是“有主机指标的”）：待命/新装的机器不上送指标，
  // 用指标列表会让它们从升级计划里彻底消失。
  const agents = useRegisteredAgents();
  const create = useCreateRolloutPlan();
  const navigate = useNavigate();

  // 升级目标只取在线的机器（排掉明确离线的），并把被排掉的台数说出来 —— 不然一台离线
  // 机器为何不在计划里会很难查。在线判据由**网关**给（不在这页重新定义一次“多久算掉线”）。
  const { agentIds, fleetSize, offlineCount } = useMemo(
    () => selectUpgradeTargets(agents.data ?? []),
    [agents.data],
  );

  // ── 表单状态 ────────────────────────────────────────────────────────────
  const [packageUrl, setPackageUrl] = useState("");
  const [packageSha256, setPackageSha256] = useState("");
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [timeoutSeconds, setTimeoutSeconds] = useState("600");
  const [batchSize, setBatchSize] = useState("0");
  const [phaseCount, setPhaseCount] = useState(3);
  const [formError, setFormError] = useState<string | null>(null);

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

  /**
   * 把表单折算成创建命令。校验放在提交前，是为了在**本地**说清「哪一段不成立」，
   * 而不是让网关回一个只说第一条错的 400。
   */
  function buildCommand(): {
    spec: string;
    phases: { targetIds: string[]; advanceRule: string }[];
    deadlineAt: string;
    timeout: number;
    batch: number;
  } | null {
    if (!isValidPackageUrl(packageUrl)) {
      setFormError(
        "包地址必须是 https:// 链接，或目标 Agent 主机上的绝对路径（如 /srv/wist/wist-agentd.tar.gz）。",
      );
      return null;
    }
    if (!isValidPackageSha256(packageSha256)) {
      setFormError(
        "安装包摘要必须是 64 位十六进制（可带 sha256: 前缀）—— 升级器按它校验制品。",
      );
      return null;
    }
    const at = new Date(deadline);
    if (Number.isNaN(at.getTime())) {
      setFormError("截止时间不是合法的时间。");
      return null;
    }
    const timeout = Number(timeoutSeconds);
    if (!Number.isInteger(timeout) || timeout <= 0) {
      setFormError("单个 Agent 的升级超时必须是正整数秒。");
      return null;
    }
    const batch = Number(batchSize);
    if (!Number.isInteger(batch) || batch < 0) {
      setFormError("阶段内并发必须是非负整数（0 = 不节流）。");
      return null;
    }
    if (phasePlan.error) {
      setFormError(phasePlan.error);
      return null;
    }
    setFormError(null);
    return {
      // 不写 target_version：由升级器从包内 agentd 自报的版本取（单一事实来源）。
      spec: jsonUpgradeSpec({ packageUrl, packageSha256 }),
      // 推进一律人工确认（自动推进两种规则网关侧尚未实现）。
      phases: phasePlan.phases.map((phase) => ({
        targetIds: phase.targetIds,
        advanceRule: "manual",
      })),
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
        phases: built.phases,
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

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <div className={styles.titleRow}>
          <h1 className={styles.pageTitle}>Agent 升级</h1>
          <Link className={styles.crossLink} to="/gateway-init">
            Gateway 初始化 <span aria-hidden="true">→</span>
          </Link>
        </div>
        <p className={styles.pageSummary}>
          按灰度节奏（金丝雀 → 扩大 → 全量）把 agentd 升到指定版本。计划只是编排：批准后才派发，逐台成败由 agentd 上报回填。
        </p>
      </header>

      <section className={styles.panel} aria-labelledby="upgrade-plans-title">
        <header className={styles.panelHead}>
          <h2 className={styles.panelTitle} id="upgrade-plans-title">
            升级计划
          </h2>
          <span className={styles.panelHint}>
            {upgradePlans.length > 0 ? `共 ${upgradePlans.length} 份 · ` : ""}
            不自动轮询：只有创建 / 批准 / 推进会改变计划，操作后自动重取
          </span>
        </header>

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
            <strong className={styles.emptyTitle}>还没有升级计划</strong>
            <span className={styles.emptyText}>
              {noToken
                ? "未设置 Admin Token：在左侧填入后才向管理面请求。"
                : "在下方创建第一份升级计划。"}
            </span>
          </div>
        ) : null}

        {upgradePlans.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">计划</th>
                  <th scope="col" className={styles.pkgCol}>
                    安装包
                  </th>
                  <th scope="col">状态</th>
                  <th scope="col">阶段</th>
                  <th scope="col" className={styles.thNum}>
                    目标台数
                  </th>
                  <th scope="col">创建</th>
                </tr>
              </thead>
              <tbody>
                {upgradePlans.map((plan) => {
                  const done = plan.phases.filter(
                    (phase) => phase.status === "completed",
                  ).length;
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
                        {/* 升级到哪个版本由包决定，所以这里认得是**哪个包**：
                            文件名带着版本与目标架构，悬停给全地址。 */}
                        <span
                          className={styles.pkgCell}
                          title={parseUpgradeSpec(plan.spec).packageUrl ?? undefined}
                        >
                          {packageFileName(parseUpgradeSpec(plan.spec).packageUrl)}
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
                          title={`已走完 ${done} 批，共 ${plan.phases.length} 批`}
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
            新建升级计划
          </h2>
          <span className={styles.panelHint}>
            创建后是草稿；批准前不会派发任何升级
          </span>
        </header>

        <form className={styles.form} onSubmit={handleSubmit}>
          <section className={styles.formSection}>
            <div className={styles.sectionHead}>
              <h3 className={styles.formSectionTitle}>升级参数</h3>
              <span className={styles.sectionNote}>
                升到哪个版本由包决定 —— 升级器读包内 agentd 自报的版本，这里不再单填
              </span>
            </div>
            <div className={styles.fieldColumn}>
              <label className={styles.field}>
                <span>安装包地址</span>
                <input
                  type="text"
                  value={packageUrl}
                  onChange={(event) => setPackageUrl(event.target.value)}
                  placeholder="/srv/wist/wist-agentd-0.1.4.tar.gz 或 https://网关/api/v1/agent/packages/current"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
                <small>
                  https 链接，或目标 Agent 主机上的绝对路径（离线/联调把制品预置到目标机）。
                </small>
              </label>
              <label className={styles.field}>
                <span>安装包摘要 sha256</span>
                <input
                  type="text"
                  value={packageSha256}
                  onChange={(event) => setPackageSha256(event.target.value)}
                  placeholder="64 位十六进制，可带 sha256: 前缀"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
                <small>升级器按它校验制品，不符不换件。</small>
              </label>
            </div>
          </section>

          <section className={styles.formSection}>
            <div className={styles.sectionHead}>
              <h3 className={styles.formSectionTitle}>升级节奏</h3>
            </div>
            <div className={styles.fieldGridThree}>
              <label className={styles.field}>
                <span>截止时间</span>
                <input
                  type="datetime-local"
                  value={deadline}
                  onChange={(event) => setDeadline(event.target.value)}
                  required
                />
                <small>到点仍未完成的升级会被判过期。</small>
              </label>
              <label className={styles.field}>
                <span>单个 Agent 升级超时</span>
                <span className={styles.inputWrap}>
                  <input
                    type="number"
                    min="1"
                    value={timeoutSeconds}
                    onChange={(event) => setTimeoutSeconds(event.target.value)}
                    required
                  />
                  <span className={styles.inputUnit}>秒</span>
                </span>
                <small>只在实际执行时计时。</small>
              </label>
              <label className={styles.field}>
                <span>阶段内并发</span>
                <span className={styles.inputWrap}>
                  <input
                    type="number"
                    min="0"
                    value={batchSize}
                    onChange={(event) => setBatchSize(event.target.value)}
                    required
                  />
                  <span className={styles.inputUnit}>台</span>
                </span>
                <small>0 = 不节流；N = 每阶段最多 N 台同时升级。</small>
              </label>
            </div>
          </section>

          <section className={styles.formSection}>
            <div className={styles.sectionHead}>
              <h3 className={styles.formSectionTitle}>灰度阶段</h3>
              <span className={styles.sectionNote}>
                选阶段数即可 —— 按 1 台 → 10% → 30% → 70% → 全量的阶梯自动分配 Agent，无需手填
              </span>
            </div>

            {phaseCounts.length > 0 ? (
              <div className={styles.countTabs} role="group" aria-label="灰度阶段数">
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
                    {count} 阶段
                  </button>
                ))}
              </div>
            ) : null}

            <span className={styles.formNote}>
              在线 {agentIds.length} 台
              {offlineCount > 0
                ? `（机队 ${fleetSize} 台，已排除离线 ${offlineCount} 台）`
                : null}
              ，最多分
              {phaseCounts.length > 0 ? phaseCounts[phaseCounts.length - 1] : 0} 批—— 每段至少 1 台，按排序后的 agent_id 依次切片、互不重叠（一个 Agent 只升一次）。推进一律人工确认。
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
                        <span className={styles.phaseIndex}>第 {phase.index} 批</span>
                        <span
                          className={`${styles.phaseScale} ${
                            phase.isCanary
                              ? styles.phaseScaleCanary
                              : phase.isFinal
                                ? styles.phaseScaleFinal
                                : ""
                          }`}
                        >
                          {phase.isFinal ? "全量（剩余）" : phaseScaleLabel(phase)}
                        </span>
                        <span className={styles.phaseMeta}>
                          新增 {phase.targetIds.length} 台
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
              disabled={create.isPending || phasePlan.error !== null}
            >
              {create.isPending ? "正在创建…" : "创建升级计划（草稿）"}
            </button>
            {/* 提交前把「这份计划长什么样」摊开：阶段 / 目标 / 并发 / 截止。 */}
            <dl className={styles.planSummary}>
              <div className={styles.planSummaryItem}>
                <dt>阶段</dt>
                <dd>{phasePlan.error ? "—" : `${effectivePhaseCount} 批`}</dd>
              </div>
              <div className={styles.planSummaryItem}>
                <dt>目标</dt>
                <dd>{agentIds.length} 台</dd>
              </div>
              <div className={styles.planSummaryItem}>
                <dt>并发</dt>
                <dd>{batchSize.trim() === "0" ? "不节流" : `${batchSize} 台 / 批`}</dd>
              </div>
              <div className={styles.planSummaryItem}>
                <dt>截止</dt>
                <dd>{formatDeadlineHint(deadline)}</dd>
              </div>
            </dl>
          </div>
        </form>
      </section>
    </div>
  );
}
