import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  dispatchActionPlan,
  getAdminApiToken,
  submitActionApproval,
  type ActionResultView,
} from "../api";
import {
  useActionResult,
  useActionResults,
  usePlanTarget,
  useRegisteredAgents,
} from "../hooks";
import { t, dateLocale } from "../i18n";
import { MIN_EXEC_AGENTD, execGate } from "../lib/agentdVersion";
import {
  RESULT_LIST_LIMIT,
  buildResponsePlan,
  isResponseGrantError,
  pinnedActionId,
} from "../lib/responseLaunch";
import styles from "./ResponseLaunchPanel.module.css";

/**
 * 「发起处置」：把一次处置从**页面**走通（选机器 → 填参数 → 先预览 → 提交审批）。
 *
 * 为什么第一版只开放 `disk.cleanup`：
 * 每个 opcode 的参数形状都不同，而契约里**没有**参数 schema（由 agentd 的执行侧校验）。
 * 前端要渲染参数表单，只能自己写一份元数据表 —— 那份表一定会漂。所以这里只做一个
 * **纵向切片**：清理（有真实价值、参数简单、preview 天然是只读），其余 opcode 等有
 * 参数契约或按同样方式逐个补。
 *
 * 流程刻意是两段：
 *   1. **先预览**（`disk.cleanup.preview`，R0）→ 看到"要删哪些、共多少"；
 *   2. **提交清理**（`disk.cleanup.apply`，R2）→ 进审批，人看过才签。
 * 不做「一键直接清」：不可撤回的动作不该由一次点击决定。
 */

const TARGETS = ["tmp", "rotated_logs"] as const;
type CleanupTarget = (typeof TARGETS)[number];

/** 与 agentd 的硬下限对齐（低于它会被执行侧拒绝，这里先拦住）。 */
function floorAgeHours(target: CleanupTarget): number {
  return target === "tmp" ? 1 : 24;
}

function defaultAgeHours(target: CleanupTarget): number {
  return target === "tmp" ? 24 : 168;
}

function targetLabel(target: CleanupTarget): string {
  return target === "tmp"
    ? t("临时目录（/tmp、/var/tmp）", "Temp dirs (/tmp, /var/tmp)")
    : t("已轮转日志（/var/log）", "Rotated logs (/var/log)");
}

/**
 * 失败的两种形态：可自解释的文字，和「得先去签一张授权单」这一类。
 *
 * `needsGrant` 的判定在 `lib/responseLaunch`（判 code，不判文案），这里只负责把
 * 它和渲染期才能算的文案拼起来。
 */
interface LaunchError {
  message: string;
  needsGrant: boolean;
}

function toLaunchError(error: unknown): LaunchError {
  return {
    message: launchErrorMessage(error),
    needsGrant: isResponseGrantError(error),
  };
}

function launchErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "response_grant_missing":
      case "response_grant_revoked":
      case "response_grant_expired":
      case "response_grant_not_yet_valid":
        return t(
          "这台机器没有生效中的处置授权单（预览也属于处置）。到「采集授权 → 处置授权」先签一张，再回来。",
          "This agent has no active disposition grant (preview counts as a disposition too). Issue one under Collection grants → Disposition grants, then come back.",
        );
      case "response_grant_insufficient":
        return t(
          "授权单的风险上限或 opcode 白名单放不过这个动作。提高上限或调整白名单后重试。",
          "The grant's risk cap or opcode allow-list does not cover this action. Raise the cap or adjust the allow-list and retry.",
        );
      case "action_plan_capability_missing":
      case "action_plan_capability_unknown":
        return t(
          "这台机器不支持该动作（或还没上报执行能力）。先升级 agentd 并等一次状态上报。",
          "This agent does not support the action (or has not reported capabilities yet). Upgrade agentd and wait for a status report.",
        );
      case "action_plan_target_unknown":
        return t(
          "这台机器还没上报系统信息（os / arch），无法生成计划。先在主机页刷新事实。",
          "This agent has not reported os/arch yet, so no plan can be built. Refresh facts on the host page first.",
        );
      case "approval_not_required":
        return t(
          "网关认为这个动作不需要审批 —— 这通常意味着风险等级填错了，请更新前端。",
          "The gateway says this action needs no approval, which usually means the risk level is wrong. Update the front-end.",
        );
      case "plan_signing_unavailable":
        return t(
          "网关没有配置签发私钥，写动作无法下发。先配 [plan_signing] key_file 并重启。",
          "The gateway has no signing key, so write actions cannot be dispatched. Add [plan_signing] key_file and restart.",
        );
      default:
        break;
    }
    if (error.status === 401) {
      return t(
        "Admin Token 缺失或无效：请在右上角点钥匙按钮，粘贴 Admin Token 后点击“应用”。",
        "Admin Token missing or invalid: click the key button in the top bar, paste the Admin Token and click “Apply”.",
      );
    }
    if (error.detail) {
      return t(
        "网关返回 HTTP {status}：{detail}",
        "The gateway returned HTTP {status}: {detail}",
        { status: error.status, detail: error.detail },
      );
    }
    return t(
      "网关返回 HTTP {status}，请检查网关日志。",
      "The gateway returned HTTP {status}; check the gateway logs.",
      { status: error.status },
    );
  }
  return t(
    "请求失败：响应不符合当前契约，请检查网关与前端版本。",
    "Request failed: the response does not match the current contract. Check the gateway and front-end versions.",
  );
}

function shortActionId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}`;
}

export function ResponseLaunchPanel({
  agentId: fixedAgentId,
  embedded = false,
}: {
  /** 指定后**不显示机器选择器**（单机页用：机器已经由路由决定）。 */
  agentId?: string;
  /** 嵌在页头下面时不要再加一层页面内边距。 */
  embedded?: boolean;
} = {}) {
  const agentsQuery = useRegisteredAgents();
  const agents = useMemo(
    () =>
      (agentsQuery.data ?? [])
        .slice()
        .sort((a, b) => a.agentId.localeCompare(b.agentId)),
    [agentsQuery.data],
  );
  const hasToken = Boolean(getAdminApiToken());
  const [agentId, setAgentId] = useState<string>("");
  const selected = fixedAgentId || agentId || agents[0]?.agentId || "";

  return (
    <section className={embedded ? styles.containerEmbedded : styles.container}>
      {embedded ? null : (
        <header className={styles.header}>
          <h1 className={styles.title}>
            {t("发起处置", "Launch disposition")}
          </h1>
          <p className={styles.summary}>
            {t(
              "一次处置的两步：先预览（只读，扫出将被清理的文件），再提交清理（写入，进审批）。预览也走处置授权，所以这台机器需要有生效中的授权单。",
              "Two steps: preview (read-only, lists what would be removed), then submit the cleanup (write, goes to approval). Preview is a response too, so the agent needs an active response grant.",
            )}
          </p>
        </header>
      )}

      {!hasToken ? (
        <p className={styles.note}>
          {t(
            "未设置 Admin Token：先在右上角填入 Token。",
            "No Admin Token is set: enter one from the top right.",
          )}
        </p>
      ) : null}
      {agentsQuery.isError ? (
        <p className={styles.error}>
          {t("读取主机列表失败。", "Failed to load hosts.")}
        </p>
      ) : null}
      {!agentsQuery.isLoading && agents.length === 0 ? (
        <p className={styles.note}>
          {t("还没有已登记的 Agent。", "No registered agents yet.")}
        </p>
      ) : null}

      {!fixedAgentId && agents.length > 0 ? (
        <label className={styles.agentPicker}>
          <span>{t("目标机器", "Target agent")}</span>
          <select
            value={selected}
            onChange={(event) => setAgentId(event.target.value)}
          >
            {agents.map((agent) => (
              <option key={agent.agentId} value={agent.agentId}>
                {agent.agentId}
                {agent.hostname ? ` · ${agent.hostname}` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {selected && hasToken ? (
        <CleanupForm
          agentId={selected}
          agentVersion={
            agents.find((agent) => agent.agentId === selected)?.version ?? ""
          }
        />
      ) : null}
    </section>
  );
}

function CleanupForm({
  agentId,
  agentVersion,
}: {
  agentId: string;
  agentVersion: string;
}) {
  // 版本未知（空串）不拦，只提示；版本过旧则**挡住** —— 那种情况下计划永远不会被执行。
  const gate = execGate(agentVersion);
  const versionKnown = gate !== "unknown";
  const execSupported = gate !== "old";
  const targetQuery = usePlanTarget(agentId);
  const [cleanupTarget, setCleanupTarget] = useState<CleanupTarget>("tmp");
  const [ageHours, setAgeHours] = useState<string>(
    String(defaultAgeHours("tmp")),
  );
  const [maxFiles, setMaxFiles] = useState("100");
  const [maxBytesMb, setMaxBytesMb] = useState("1024");
  const [previewActionId, setPreviewActionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"preview" | "apply" | null>(
    null,
  );
  const [error, setError] = useState<LaunchError | null>(null);
  const [submittedApprovalId, setSubmittedApprovalId] = useState<string | null>(
    null,
  );

  const previewResult = useActionResult(agentId, previewActionId);
  const queryClient = useQueryClient();

  // 预览结果到了就把「最近结果」列表刷一次 —— 否则刚看到的预览要等下次进页才进列表。
  useEffect(() => {
    if (!previewResult.data) return;
    void queryClient.invalidateQueries({ queryKey: ["action-results", agentId] });
  }, [previewResult.data?.actionId, agentId, queryClient]);

  const floor = floorAgeHours(cleanupTarget);
  const age = Number.parseInt(ageHours, 10);
  const ageValid = Number.isFinite(age) && age >= floor && age <= 8760;

  function switchTarget(next: CleanupTarget) {
    setCleanupTarget(next);
    setAgeHours(String(defaultAgeHours(next)));
    setPreviewActionId(null);
    setSubmittedApprovalId(null);
    setError(null);
  }

  async function runPreview() {
    setError(null);
    setSubmittedApprovalId(null);
    const target = targetQuery.data;
    if (!target || !ageValid) return;
    setSubmitting("preview");
    try {
      const actionId = shortActionId("act_preview");
      const plan = buildResponsePlan({
        target,
        op: "disk.cleanup.preview",
        risk: "R0",
        actionId,
        reason: `preview ${cleanupTarget}`,
        args: {
          target: cleanupTarget,
          min_age_hours: age,
        },
      });
      await dispatchActionPlan(agentId, plan);
      setPreviewActionId(actionId);
    } catch (err) {
      setError(toLaunchError(err));
    } finally {
      setSubmitting(null);
    }
  }

  async function submitCleanup() {
    setError(null);
    const target = targetQuery.data;
    if (!target || !ageValid) return;
    setSubmitting("apply");
    try {
      const actionId = shortActionId("act_apply");
      const plan = buildResponsePlan({
        target,
        op: "disk.cleanup.apply",
        risk: "R2",
        actionId,
        reason: `cleanup ${cleanupTarget} older than ${age}h`,
        args: {
          target: cleanupTarget,
          min_age_hours: age,
          max_files: Number.parseInt(maxFiles, 10) || 100,
          max_bytes: (Number.parseInt(maxBytesMb, 10) || 1024) * 1024 * 1024,
        },
      });
      const approval = await submitActionApproval(
        agentId,
        plan,
        `清理 ${cleanupTarget}（${age}h 以上）`,
      );
      setSubmittedApprovalId(approval.approvalId);
    } catch (err) {
      setError(toLaunchError(err));
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className={styles.form}>
      {!execSupported ? (
        <p className={styles.error} role="alert">
          {t(
            "这台机器的 agentd 是 {version}，不认识执行计划命令（需要 ≥ {min}）。请先升级 agentd；否则计划会入队但机器永远不执行，页面只能一直等。",
            "This agent runs agentd {version}, which does not understand action plans (needs ≥ {min}). Upgrade agentd first; otherwise the plan is queued but never executed and this page just waits.",
            { version: agentVersion, min: MIN_EXEC_AGENTD },
          )}
        </p>
      ) : null}
      {!versionKnown ? (
        <p className={styles.note}>
          {t(
            "读不到这台机器的 agentd 版本：如果点了没反应，先去任务队列看这条命令有没有被取走。",
            "Could not read this agent's agentd version. If nothing happens after dispatch, check the command queue to see whether it was claimed.",
          )}
        </p>
      ) : null}
      {targetQuery.isError ? (
        <p className={styles.error}>{launchErrorMessage(targetQuery.error)}</p>
      ) : null}
      {targetQuery.data ? (
        <p className={styles.meta}>
          {t("目标画像", "Target")}：`{targetQuery.data.platform}/
          {targetQuery.data.arch}`
          {targetQuery.data.hostName ? ` · ${targetQuery.data.hostName}` : ""}
          {` · node=${targetQuery.data.nodeId}`}
        </p>
      ) : null}

      <div className={styles.grid}>
        <label className={styles.field}>
          <span>{t("动作", "Action")}</span>
          <select value="disk.cleanup" disabled>
            <option value="disk.cleanup">
              {t(
                "清理过期临时文件 / 已轮转日志",
                "Remove expired temp files / rotated logs",
              )}
            </option>
          </select>
        </label>

        <label className={styles.field}>
          <span>{t("清理范围", "Scope")}</span>
          <select
            value={cleanupTarget}
            onChange={(event) =>
              switchTarget(event.target.value as CleanupTarget)
            }
          >
            {TARGETS.map((target) => (
              <option key={target} value={target}>
                {targetLabel(target)}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span>
            {t(
              "最小文件年龄（小时，≥{floor}）",
              "Min file age (hours, ≥{floor})",
              {
                floor,
              },
            )}
          </span>
          <input
            type="number"
            min={floor}
            max={8760}
            value={ageHours}
            onChange={(event) => setAgeHours(event.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span>{t("最多文件数", "Max files")}</span>
          <input
            type="number"
            min={1}
            max={5000}
            value={maxFiles}
            onChange={(event) => setMaxFiles(event.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span>{t("最大总量（MiB）", "Max total size (MiB)")}</span>
          <input
            type="number"
            min={1}
            value={maxBytesMb}
            onChange={(event) => setMaxBytesMb(event.target.value)}
          />
        </label>
      </div>

      <p className={styles.hint}>
        {t(
          "上限是硬闸：超过就停下并在结果里标 truncated。删除被进程占用的文件不会释放空间，这类文件会被跳过。",
          "Caps are hard limits: the run stops and reports truncated. Files still open by a process are skipped — deleting them frees nothing.",
        )}
      </p>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          disabled={
            !execSupported ||
            !targetQuery.data ||
            !ageValid ||
            submitting !== null
          }
          onClick={() => void runPreview()}
        >
          {submitting === "preview"
            ? t("正在下发预览…", "Dispatching preview…")
            : t("① 先预览（只读）", "① Preview (read-only)")}
        </button>
        <button
          type="button"
          className={styles.danger}
          disabled={
            !execSupported ||
            !targetQuery.data ||
            !ageValid ||
            submitting !== null
          }
          onClick={() => void submitCleanup()}
        >
          {submitting === "apply"
            ? t("正在提交…", "Submitting…")
            : t("② 提交清理（需审批）", "② Submit cleanup (needs approval)")}
        </button>
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error.message}
          {error.needsGrant ? (
            <>
              {" "}
              <Link
                className={styles.errorAction}
                to="/authorization?tab=response"
              >
                {t("去签处置授权单 →", "Issue a disposition grant →")}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      {submittedApprovalId ? (
        <p className={styles.success}>
          {t("已提交审批：", "Submitted for approval: ")}
          <Link to="/approvals">{submittedApprovalId}</Link>
          {t(
            " —— 到「处置审批」批完才会下发。",
            " — it is dispatched only after approval.",
          )}
        </p>
      ) : null}

      {previewActionId ? (
        <PreviewResult
          actionId={previewActionId}
          loading={previewResult.isLoading || previewResult.isFetching}
          error={previewResult.error}
          report={previewResult.data?.report}
          finalStatus={previewResult.data?.finalStatus}
        />
      ) : null}

      <RecentResults agentId={agentId} />
    </div>
  );
}

interface PreviewSummary {
  files?: number;
  bytes?: number;
  complete?: boolean;
  items?: Array<{
    path?: string;
    bytes?: number;
    age_hours?: number;
    open?: boolean;
  }>;
  truncated?: boolean;
}

/** 从结果报文里把清理预览的那一段抠出来（`outputs.items[0].value`）。 */
function readPreview(report: unknown): PreviewSummary | null {
  if (!report || typeof report !== "object") return null;
  const result = (report as { result?: unknown }).result;
  if (!result || typeof result !== "object") return null;
  const outputs = (result as { outputs?: unknown }).outputs;
  if (!outputs || typeof outputs !== "object") return null;
  const items = (outputs as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const first = items[0] as { value?: unknown };
  if (!first || typeof first.value !== "object" || first.value === null) {
    return null;
  }
  const value = first.value as {
    candidates?: { files?: number; bytes?: number };
    scan?: { complete?: boolean };
    items?: PreviewSummary["items"];
    listing_truncated?: boolean;
  };
  return {
    files: value.candidates?.files,
    bytes: value.candidates?.bytes,
    complete: value.scan?.complete,
    items: value.items,
    truncated: value.listing_truncated,
  };
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function formatTimestamp(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString(dateLocale(), { hour12: false });
}

/** 契约的 wire 状态值 → 色调（只影响样式，不映射值本身）。 */
function statusBadgeClass(status: string): string {
  switch (status) {
    case "succeeded":
      return `${styles.badge} ${styles.badgeOk}`;
    case "failed":
      return `${styles.badge} ${styles.badgeCrit}`;
    case "partial":
      return `${styles.badge} ${styles.badgeWarn}`;
    default:
      return `${styles.badge} ${styles.badgeUnknown}`;
  }
}

/** 等多久之后把「可能卡住了」的排查路径给出来（agent 默认 5s 取一次命令）。 */
const WAIT_HINT_SECONDS = 45;

function PreviewResult({
  actionId,
  loading,
  error,
  report,
  finalStatus,
}: {
  actionId: string;
  loading: boolean;
  error: unknown;
  report: unknown;
  finalStatus?: string;
}) {
  const [elapsed, setElapsed] = useState(0);
  const settled = Boolean(report);
  useEffect(() => {
    if (settled) return;
    setElapsed(0);
    const timer = window.setInterval(
      () => setElapsed((value) => value + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [actionId, settled]);

  if (error && !(error instanceof ApiError && error.status === 404)) {
    return <p className={styles.error}>{launchErrorMessage(error)}</p>;
  }
  if (!settled) {
    // 「等」不是一个状态而是一个事实：把**已经下发了什么**与**等了多久**摆出来，
    // 再给出「可能卡在哪」的下一步。否则用户只能盯着三个点猜。
    return (
      <div className={styles.note}>
        <p>
          {t(
            "预览已下发（action {id}），等机器取命令并回结果… 已等 {seconds}s",
            "Preview dispatched (action {id}); waiting for the agent to pick it up… {seconds}s elapsed",
            { id: actionId, seconds: elapsed },
          )}
        </p>
        {elapsed >= WAIT_HINT_SECONDS ? (
          <p className={styles.warn}>
            {t(
              "超过 {seconds}s 还没回来。常见原因：agentd 太旧（< {min}）、机器离线 / 长时间没心跳、或命令被本地终审拒了。",
              "Nothing after {seconds}s. Common causes: agentd too old (< {min}), the agent is offline / not heartbeating, or the plan was rejected by local review.",
              { seconds: WAIT_HINT_SECONDS, min: MIN_EXEC_AGENTD },
            )}{" "}
            <Link to="/commands">
              {t("去任务队列看这条命令", "Check the command queue")}
            </Link>
          </p>
        ) : null}
        {loading ? null : (
          <p className={styles.warn}>
            {t(
              "轮询已停止。到任务队列（或刷新页面）再确认一次。",
              "Polling stopped. Check the command queue (or refresh) to confirm.",
            )}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className={styles.result}>
      <CleanupListing
        report={report}
        finalStatus={finalStatus}
        title={t("预览结果", "Preview")}
      />
    </div>
  );
}

/**
 * 清理类结果里那一段「候选清单」。
 *
 * 预览（当次会话）与「最近结果」（刷新后仍可见）共用这一份渲染 ——
 * 两处各写一遍一定会漂，而它们形状完全相同（同一份 `outputs.items[0].value`）。
 */
function CleanupListing({
  report,
  finalStatus,
  title,
}: {
  report: unknown;
  finalStatus?: string;
  title?: string;
}) {
  const preview = readPreview(report);
  if (!preview) {
    return (
      <p className={styles.note}>
        {t(
          "结果已收到（{status}），但没有可展示的清理清单。",
          "Result received ({status}), but it has no cleanup listing to show.",
          { status: finalStatus ?? "—" },
        )}
      </p>
    );
  }
  return (
    <>
      <p className={styles.resultHead}>
        {title ? (
          <>
            <strong>{title}</strong>
            {" · "}
          </>
        ) : null}
        {t("候选 {files} 个文件 / 共 {bytes}", "{files} files / {bytes}", {
          files: preview.files ?? 0,
          bytes: formatBytes(preview.bytes),
        })}
        {preview.complete === false ? (
          <span className={styles.warn}>
            {" "}
            · {t("扫描未完成（达预算）", "scan incomplete (budget)")}
          </span>
        ) : null}
        {preview.truncated ? (
          <span className={styles.warn}>
            {" "}
            · {t("清单已截断", "listing truncated")}
          </span>
        ) : null}
      </p>
      {preview.items && preview.items.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t("路径", "Path")}</th>
              <th scope="col">{t("大小", "Size")}</th>
              <th scope="col">{t("年龄(h)", "Age (h)")}</th>
              <th scope="col">{t("被占用", "Open")}</th>
            </tr>
          </thead>
          <tbody>
            {preview.items.slice(0, 20).map((item, index) => (
              <tr key={`${item.path ?? ""}-${index}`}>
                <td className={styles.mono}>{item.path ?? "—"}</td>
                <td className={styles.mono}>{formatBytes(item.bytes)}</td>
                <td className={styles.mono}>{item.age_hours ?? "—"}</td>
                <td className={styles.mono}>
                  {item.open
                    ? t("是（会跳过）", "yes (skipped)")
                    : t("否", "no")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={styles.note}>
          {t(
            "没有匹配的文件 —— 不需要清理。",
            "No matching files — nothing to clean up.",
          )}
        </p>
      )}
    </>
  );
}

/**
 * 「最近的处置结果」：刷新页面后还能找回的历史入口。
 *
 * 为什么必须有：发起页的预览只活在当次会话里（`actionId` 是组件 state，刷新即丢），
 * 用户执行成功后找不到任何反馈。结果恰恰是复核与审计要反复看的东西。
 */
function RecentResults({ agentId }: { agentId: string }) {
  // 列表默认只取 10 条（网关默认），而「详情」里链接的可能是更早的一次执行。
  // 取到网关允许的最大值，剩下的用下面那条单条读取兜底。
  const query = useActionResults(agentId, RESULT_LIST_LIMIT);
  const [searchParams] = useSearchParams();
  // `?action=<id>`：任务队列行的「详情」跳进来时，直接展开那一条。
  // 同一台机器可能跑过很多次，落到哪一条必须由调用方指定，不能靠“最新一条”猜。
  const requestedAction = (searchParams.get("action") ?? "").trim();
  const [expanded, setExpanded] = useState<string | null>(
    requestedAction || null,
  );
  useEffect(() => {
    if (requestedAction) setExpanded(requestedAction);
  }, [requestedAction]);
  const results = query.data?.results ?? [];
  // 目标动作不在列表里（超出窗口 / 保留期）就单条读：
  // 不这么做的话，「详情」点进来会是一个什么都不展开的空白页。
  const pinnedId = pinnedActionId(results, requestedAction);
  const pinnedQuery = useActionResult(agentId, pinnedId);
  const pinned = pinnedQuery.data ?? null;

  return (
    <div className={styles.recent}>
      <div className={styles.recentHead}>
        <strong>{t("最近的执行结果", "Recent results")}</strong>
        <span className={styles.recentMeta}>
          {t(
            "刷新页面后仍在这里；同一个动作只保留最新一次。",
            "Stays here after a reload; only the latest run per action is kept.",
          )}
        </span>
        <button
          type="button"
          className={styles.recentRefresh}
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {query.isFetching ? t("读取中…", "Loading…") : t("刷新", "Refresh")}
        </button>
      </div>

      {query.isError ? (
        <p className={styles.error}>{launchErrorMessage(query.error)}</p>
      ) : null}

      {!query.isLoading && results.length === 0 && !pinned && !requestedAction ? (
        <p className={styles.note}>
          {t(
            "这台机器还没有执行结果。预览或清理命令执行完成后会出现在这里。",
            "No results for this agent yet. They appear here once a preview or cleanup run finishes.",
          )}
        </p>
      ) : null}

      {results.length > 0 || pinned ? (
        <ul className={styles.recentList}>
          {/* 指定了 `?action=` 但它不在最近窗口里：把它钉在最上面，别让人对着一页空白。 */}
          {pinned ? (
            <ResultRow
              item={pinned}
              open={expanded === pinned.actionId}
              onToggle={() =>
                setExpanded(expanded === pinned.actionId ? null : pinned.actionId)
              }
            />
          ) : null}
          {results.map((item) => (
            <ResultRow
              key={item.actionId}
              item={item}
              open={expanded === item.actionId}
              onToggle={() =>
                setExpanded(expanded === item.actionId ? null : item.actionId)
              }
            />
          ))}
        </ul>
      ) : null}

      {pinnedId && pinnedQuery.isError ? (
        <p className={styles.note}>
          {t(
            "没找到这条执行结果（{id}）：可能超出保留期，或这台机器还没回报。",
            "No result for {id}: it may be past the retention window, or the agent has not reported yet.",
            { id: pinnedId },
          )}
        </p>
      ) : null}
    </div>
  );
}

/** 单条执行结果的折叠行（列表项与「详情」钉住项共用同一套渲染）。 */
function ResultRow({
  item,
  open,
  onToggle,
}: {
  item: ActionResultView;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li className={styles.recentItem}>
      <button
        type="button"
        className={styles.recentToggle}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className={statusBadgeClass(item.finalStatus)}>
          {item.finalStatus}
        </span>
        <span className={styles.mono}>{item.actionId}</span>
        <span className={styles.recentTime}>
          {formatTimestamp(item.receivedAt)}
        </span>
        <span className={styles.recentChevron}>{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className={styles.recentDetail}>
          <CleanupListing report={item.report} finalStatus={item.finalStatus} />
          <p className={styles.recentFoot}>
            {t("execution {exec}", "execution {exec}", {
              exec: item.executionId,
            })}
            {" · "}
            {t("plan {digest}", "plan {digest}", {
              digest: item.planDigest,
            })}
          </p>
        </div>
      ) : null}
    </li>
  );
}
