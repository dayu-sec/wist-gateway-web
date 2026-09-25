import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, getAdminApiToken, isRateLimitedError } from "../api";
import { jsonUpgradeSpec } from "../api/admin";
import {
  useAllAgentsHostMetrics,
  useCreateRolloutPlan,
  useRolloutPlans,
} from "../hooks";
import { RateLimitNotice } from "./RateLimitNotice";
import {
  advanceRuleLabel,
  planStatusLabel,
  planStatusTone,
  planTargetCount,
} from "./rolloutStatus";
import styles from "./SubsystemRolloutPlansPage.module.css";

/** 动作面：今天 agentd 只执行 `upgrade`，其余动作派下去会停在「已派发」。 */
const SUPPORTED_ACTIONS = ["upgrade"] as const;

type AdvanceRuleKind = "manual" | "all_succeeded" | "success_rate";

interface PhaseDraft {
  targetsText: string;
  rule: AdvanceRuleKind;
  /** `success_rate` 的阈值（0..100），只在 rule = success_rate 时生效。 */
  rate: string;
}

const ADVANCE_RULE_LABEL: Record<AdvanceRuleKind, string> = {
  manual: "人工确认后推进",
  all_succeeded: "全部成功自动推进",
  success_rate: "达到成功率自动推进",
};

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

/** 拆分阶段的目标文本：按行/逗号/空白分隔，去空去重。 */
function parseTargets(text: string): string[] {
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const raw of text.split(/[\s,，、]+/)) {
    const target = raw.trim();
    if (!target || seen.has(target)) continue;
    seen.add(target);
    targets.push(target);
  }
  return targets;
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
 * 灰度发布计划页（模型 `Control.Rollout`：`ListRolloutPlans` + `CreateRolloutPlan`）。
 *
 * 计划是**编排层**：把升级（今天唯一的动作）按阶段（金丝雀 → 扩大 → 全量）铺到机队。
 * 这里只创建草稿与列出计划；批准/推进在计划详情页 —— 那两个是灰度发布的**人工闸门**。
 */
export function SubsystemRolloutPlansPage() {
  const plans = useRolloutPlans();
  const agents = useAllAgentsHostMetrics();
  const create = useCreateRolloutPlan();
  const navigate = useNavigate();

  const agentIds = useMemo(
    () => (agents.data ?? []).map((host) => host.agentId).sort(),
    [agents.data],
  );

  // ── 表单状态 ────────────────────────────────────────────────────────────
  const [action, setAction] = useState<string>(SUPPORTED_ACTIONS[0]);
  const [targetVersion, setTargetVersion] = useState("");
  const [packageUrl, setPackageUrl] = useState("");
  const [packageSha256, setPackageSha256] = useState("");
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [timeoutSeconds, setTimeoutSeconds] = useState("600");
  const [batchSize, setBatchSize] = useState("0");
  const [phases, setPhases] = useState<PhaseDraft[]>([
    { targetsText: "", rule: "manual", rate: "80" },
  ]);
  const [formError, setFormError] = useState<string | null>(null);

  function updatePhase(index: number, patch: Partial<PhaseDraft>) {
    setPhases((prev) =>
      prev.map((phase, i) => (i === index ? { ...phase, ...patch } : phase)),
    );
  }

  function addPhase() {
    setPhases((prev) => [
      ...prev,
      { targetsText: "", rule: "manual", rate: "80" },
    ]);
  }

  function removePhase(index: number) {
    setPhases((prev) => prev.filter((_, i) => i !== index));
  }

  /**
   * 把表单折算成创建命令。校验放在提交前，是为了在**本地**说清「哪一段不成立」，
   * 而不是让网关回一个只说第一条错的 400。跨阶段的重复目标在这里就能看出来。
   */
  function buildCommand(): {
    spec: string;
    targetIdsPerPhase: string[][];
    advanceRules: string[];
    deadlineAt: string;
    timeout: number;
    batch: number;
  } | null {
    if (!targetVersion.trim()) {
      setFormError("请填写升级目标版本（target_version）。");
      return null;
    }
    const at = new Date(deadline);
    if (Number.isNaN(at.getTime())) {
      setFormError("截止时间不是合法的时间。");
      return null;
    }
    const timeout = Number(timeoutSeconds);
    if (!Number.isInteger(timeout) || timeout <= 0) {
      setFormError("执行预算必须是正整数秒。");
      return null;
    }
    const batch = Number(batchSize);
    if (!Number.isInteger(batch) || batch < 0) {
      setFormError("阶段内并发必须是非负整数（0 = 不节流）。");
      return null;
    }
    const targetIdsPerPhase: string[][] = [];
    const advanceRules: string[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < phases.length; index += 1) {
      const phase = phases[index];
      const targets = parseTargets(phase.targetsText);
      if (targets.length === 0) {
        setFormError(`阶段 ${index + 1} 至少要有一个目标。`);
        return null;
      }
      for (const target of targets) {
        if (seen.has(target)) {
          setFormError(`目标 ${target} 出现在多个阶段里，每个目标只能属于一个阶段。`);
          return null;
        }
        seen.add(target);
      }
      targetIdsPerPhase.push(targets);
      if (phase.rule === "success_rate") {
        const rate = Number(phase.rate);
        if (!Number.isInteger(rate) || rate < 0 || rate > 100) {
          setFormError(`阶段 ${index + 1} 的成功率必须是 0..100 的整数。`);
          return null;
        }
        advanceRules.push(`success_rate:${rate}`);
      } else {
        advanceRules.push(phase.rule);
      }
    }
    setFormError(null);
    return {
      spec: jsonUpgradeSpec({ targetVersion, packageUrl, packageSha256 }),
      targetIdsPerPhase,
      advanceRules,
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
        action,
        spec: built.spec,
        phases: built.targetIdsPerPhase.map((targetIds, index) => ({
          targetIds,
          advanceRule: built.advanceRules[index],
        })),
        deadlineAt: built.deadlineAt,
        timeoutSeconds: built.timeout,
        batchSize: built.batch,
      },
      {
        onSuccess: (plan) => navigate(`/rollout/${encodeURIComponent(plan.planId)}`),
      },
    );
  }

  const noToken = !getAdminApiToken();

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>灰度发布计划</h1>
        <p className={styles.pageSummary}>
          用灰度发布的节奏，把 agentd 升级按阶段（金丝雀 → 扩大 → 全量）铺到机队。
          计划本身只是编排：批准后才进入第一阶段，为阶段内的 Agent 各生成一件一次性升级工作，
          逐台结果经 agentd 上报回填到计划条目。
        </p>
      </header>

      <section className={styles.panel} aria-labelledby="rollout-plans-title">
        <header className={styles.panelHead}>
          <h2 className={styles.panelTitle} id="rollout-plans-title">
            计划列表
          </h2>
          <span className={styles.panelHint}>
            不自动轮询：计划只在创建/批准/推进时变化，操作后自动重取
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

        {!plans.isError && !plans.isLoading && (plans.data ?? []).length === 0 ? (
          <div className={styles.empty}>
            <strong className={styles.emptyTitle}>还没有灰度发布计划</strong>
            <span className={styles.emptyText}>
              {noToken
                ? "未设置 Admin Token：在左侧填入后才向管理面请求。"
                : "在下方创建第一份计划。"}
            </span>
          </div>
        ) : null}

        {plans.data && plans.data.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">计划</th>
                  <th scope="col">动作</th>
                  <th scope="col">状态</th>
                  <th scope="col">阶段</th>
                  <th scope="col" className={styles.thNum}>
                    目标
                  </th>
                  <th scope="col">创建</th>
                  <th scope="col" className={styles.thAction}>
                    <span className={styles.srOnly}>操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {plans.data.map((plan) => (
                  <tr key={plan.planId}>
                    <td>
                      <Link
                        className={styles.planLink}
                        to={`/rollout/${encodeURIComponent(plan.planId)}`}
                      >
                        {plan.planId}
                      </Link>
                    </td>
                    <td>
                      <span className={styles.mono}>{plan.action}</span>
                    </td>
                    <td>
                      <span
                        className={`${styles.badge} ${toneClass(planStatusTone(plan.status))}`}
                      >
                        {planStatusLabel(plan.status)}
                      </span>
                    </td>
                    <td className={styles.mono}>
                      {plan.currentPhase > 0
                        ? `${plan.currentPhase} / ${plan.phases.length}`
                        : `0 / ${plan.phases.length}`}
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
                    <td className={styles.tdAction}>
                      <Link
                        className={styles.detailLink}
                        to={`/rollout/${encodeURIComponent(plan.planId)}`}
                      >
                        查看<span aria-hidden="true">→</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className={styles.panel} aria-labelledby="rollout-create-title">
        <header className={styles.panelHead}>
          <h2 className={styles.panelTitle} id="rollout-create-title">
            新建计划
          </h2>
          <span className={styles.panelHint}>
            创建后是草稿；批准前不会派发任何工作
          </span>
        </header>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span>动作</span>
              <select
                value={action}
                onChange={(event) => setAction(event.target.value)}
              >
                {SUPPORTED_ACTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <small>今天 agentd 只执行 upgrade。</small>
            </label>
            <label className={styles.field}>
              <span>目标版本（target_version）</span>
              <input
                type="text"
                value={targetVersion}
                onChange={(event) => setTargetVersion(event.target.value)}
                placeholder="0.1.4"
                autoComplete="off"
                spellCheck={false}
                required
              />
              <small>升级到的 agentd 版本号。</small>
            </label>
          </div>

          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span>包地址（package_url，可选）</span>
              <input
                type="text"
                value={packageUrl}
                onChange={(event) => setPackageUrl(event.target.value)}
                placeholder="留空 = Agent 用网关默认安装包来源"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className={styles.field}>
              <span>包摘要 sha256（可选）</span>
              <input
                type="text"
                value={packageSha256}
                onChange={(event) => setPackageSha256(event.target.value)}
                placeholder="64 位十六进制"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </div>

          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span>截止时间（deadline_at）</span>
              <input
                type="datetime-local"
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
                required
              />
            </label>
            <label className={styles.field}>
              <span>执行预算（秒）</span>
              <input
                type="number"
                min="1"
                value={timeoutSeconds}
                onChange={(event) => setTimeoutSeconds(event.target.value)}
                required
              />
            </label>
            <label className={styles.field}>
              <span>阶段内并发（batch_size）</span>
              <input
                type="number"
                min="0"
                value={batchSize}
                onChange={(event) => setBatchSize(event.target.value)}
                required
              />
              <small>0 = 不节流；N = 每阶段最多 N 台在飞。</small>
            </label>
          </div>

          <div className={styles.phases}>
            <div className={styles.phasesHead}>
              <span className={styles.phasesTitle}>灰度阶段</span>
              <span className={styles.panelHint}>
                从金丝雀开始，后一阶段的范围应逐步扩大；同一目标只能出现在一个阶段
              </span>
            </div>

            {phases.map((phase, index) => (
              <div className={styles.phaseCard} key={index}>
                <div className={styles.phaseCardHead}>
                  <span className={styles.phaseIndex}>阶段 {index + 1}</span>
                  <button
                    type="button"
                    className={styles.removePhase}
                    onClick={() => removePhase(index)}
                    disabled={phases.length === 1}
                  >
                    移除
                  </button>
                </div>
                <label className={styles.field}>
                  <span>目标（每行一个 agent_id，也可用逗号分隔）</span>
                  <textarea
                    className={styles.textarea}
                    value={phase.targetsText}
                    onChange={(event) =>
                      updatePhase(index, { targetsText: event.target.value })
                    }
                    rows={3}
                    spellCheck={false}
                    placeholder={"agent-a\nagent-b"}
                  />
                </label>
                <div className={styles.phaseRuleRow}>
                  <label className={styles.field}>
                    <span>推进闸门</span>
                    <select
                      value={phase.rule}
                      onChange={(event) =>
                        updatePhase(index, {
                          rule: event.target.value as AdvanceRuleKind,
                        })
                      }
                    >
                      {(Object.keys(ADVANCE_RULE_LABEL) as AdvanceRuleKind[]).map(
                        (kind) => (
                          <option key={kind} value={kind}>
                            {ADVANCE_RULE_LABEL[kind]}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  {phase.rule === "success_rate" ? (
                    <label className={styles.field}>
                      <span>成功率阈值（%）</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={phase.rate}
                        onChange={(event) =>
                          updatePhase(index, { rate: event.target.value })
                        }
                      />
                    </label>
                  ) : null}
                </div>
              </div>
            ))}

            <button type="button" className={styles.addPhase} onClick={addPhase}>
              + 添加阶段
            </button>
          </div>

          {agentIds.length > 0 ? (
            <details className={styles.agentHint}>
              <summary>
                可用 Agent（{agentIds.length}）—— 目标必须是已注册的 agent_id
              </summary>
              <div className={styles.agentList}>
                {agentIds.map((id) => (
                  <span key={id} className={styles.agentChip}>
                    {id}
                  </span>
                ))}
              </div>
            </details>
          ) : null}

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
              disabled={create.isPending}
            >
              {create.isPending ? "正在创建…" : "创建计划（草稿）"}
            </button>
            <span className={styles.actionHint}>
              当前动作的推进闸门取值：
              {advanceRuleLabel("manual")} 已强制生效；自动推进（{advanceRuleLabel(
                "all_succeeded",
              )} / {advanceRuleLabel("success_rate:80")}）为后续实现。
            </span>
          </div>
        </form>
      </section>
    </div>
  );
}
