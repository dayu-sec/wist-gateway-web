import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  dispatchActionPlan,
  getAdminApiToken,
  submitActionApproval,
  type ActionPlanPayload,
  type PlanTargetView,
} from "../api";
import { useActionResult, usePlanTarget, useRegisteredAgents } from "../hooks";
import { t } from "../i18n";
import styles from "./ResponseLaunchPanel.module.css";

/**
 * 「发起响应」：把一次处置从**页面**走通（选机器 → 填参数 → 先预览 → 提交审批）。
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

function launchErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "response_grant_missing":
      case "response_grant_revoked":
      case "response_grant_expired":
      case "response_grant_not_yet_valid":
        return t(
          "这台机器没有生效中的响应授权单（预览也属于响应）。到「采集授权 → 响应授权」先签一张，再回来。",
          "This agent has no active response grant (preview counts as a response too). Issue one under Collection grants → Response grants, then come back.",
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

function buildPlan(input: {
  target: PlanTargetView;
  op: string;
  risk: "R0" | "R2";
  args: Record<string, unknown>;
  actionId: string;
  reason: string | null;
}): ActionPlanPayload {
  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 60 * 1000);
  return {
    api_version: "v1",
    kind: "action_plan",
    meta: {
      action_id: input.actionId,
      request_id: input.actionId,
      template_id: null,
      tenant_id: "tenant-default",
      environment_id: "env-default",
      plan_version: 1,
      compiled_at: now.toISOString(),
      expires_at: expires.toISOString(),
    },
    target: {
      agent_id: input.target.agentId,
      instance_id: input.target.instanceId,
      node_id: input.target.nodeId,
      host_name: input.target.hostName,
      platform: input.target.platform,
      arch: input.target.arch,
      selectors: {},
    },
    constraints: {
      risk_level: input.risk,
      approval_ref: null,
      approval_mode: "not_required",
      requested_by: "admin-ui",
      reason: input.reason,
      max_total_duration_ms: 60_000,
      step_timeout_default_ms: 30_000,
      execution_profile: "agent_exec_v1",
      required_capabilities: [input.op],
    },
    program: {
      entry: "s1",
      steps: [
        { id: "s1", kind: "invoke", op: input.op, args: input.args },
        { id: "s2", kind: "output", op: null },
      ],
    },
  };
}

export function ResponseLaunchPanel() {
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
  const selected = agentId || agents[0]?.agentId || "";

  return (
    <section className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t("发起响应", "Launch response")}</h1>
        <p className={styles.summary}>
          {t(
            "一次响应的两步：**先预览**（只读，扫出将被清理的文件），**再提交清理**（写入，进审批）。预览也走响应授权，所以这台机器需要有生效中的授权单。",
            "Two steps: **preview** (read-only, lists what would be removed), then **submit the cleanup** (write, goes to approval). Preview is a response too, so the agent needs an active response grant.",
          )}
        </p>
      </header>

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

      {agents.length > 0 ? (
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

      {selected && hasToken ? <CleanupForm agentId={selected} /> : null}
    </section>
  );
}

function CleanupForm({ agentId }: { agentId: string }) {
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
  const [error, setError] = useState<string | null>(null);
  const [submittedApprovalId, setSubmittedApprovalId] = useState<string | null>(
    null,
  );

  const previewResult = useActionResult(agentId, previewActionId);

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
      const plan = buildPlan({
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
      setError(launchErrorMessage(err));
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
      const plan = buildPlan({
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
      setError(launchErrorMessage(err));
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className={styles.form}>
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
          "上限是**硬闸**：超过就停下并在结果里标 truncated。删除被进程占用的文件不会释放空间，这类文件会被跳过。",
          "Caps are hard limits: the run stops and reports truncated. Files still open by a process are skipped — deleting them frees nothing.",
        )}
      </p>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          disabled={!targetQuery.data || !ageValid || submitting !== null}
          onClick={() => void runPreview()}
        >
          {submitting === "preview"
            ? t("正在下发预览…", "Dispatching preview…")
            : t("① 先预览（只读）", "① Preview (read-only)")}
        </button>
        <button
          type="button"
          className={styles.danger}
          disabled={!targetQuery.data || !ageValid || submitting !== null}
          onClick={() => void submitCleanup()}
        >
          {submitting === "apply"
            ? t("正在提交…", "Submitting…")
            : t("② 提交清理（需审批）", "② Submit cleanup (needs approval)")}
        </button>
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {submittedApprovalId ? (
        <p className={styles.success}>
          {t("已提交审批：", "Submitted for approval: ")}
          <Link to="/approvals">{submittedApprovalId}</Link>
          {t(
            " —— 到「响应审批」批完才会下发。",
            " — it is dispatched only after approval.",
          )}
        </p>
      ) : null}

      {previewActionId ? (
        <PreviewResult
          loading={previewResult.isLoading || previewResult.isFetching}
          error={previewResult.error}
          report={previewResult.data?.report}
          finalStatus={previewResult.data?.finalStatus}
        />
      ) : null}
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

function PreviewResult({
  loading,
  error,
  report,
  finalStatus,
}: {
  loading: boolean;
  error: unknown;
  report: unknown;
  finalStatus?: string;
}) {
  if (error) {
    // 404 是「还没回」，不是错误 —— 轮询期间会一直这样。
    const pending = error instanceof ApiError && error.status === 404;
    return (
      <p className={pending ? styles.note : styles.error}>
        {pending
          ? t(
              "预览已下发，等机器回结果…（agent 下次取命令时执行）",
              "Preview dispatched, waiting for the agent… (it runs on the next command poll)",
            )
          : launchErrorMessage(error)}
      </p>
    );
  }
  if (loading && !report) {
    return (
      <p className={styles.note}>{t("等待结果…", "Waiting for the result…")}</p>
    );
  }
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
    <div className={styles.result}>
      <p className={styles.resultHead}>
        <strong>{t("预览结果", "Preview")}</strong>
        {" · "}
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
    </div>
  );
}
