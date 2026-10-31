import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, getAdminApiToken, isRateLimitedError } from "../api";
import {
  useAgentInvestigationReport,
  useAgentInvestigations,
  useLaunchAgentInvestigation,
  useResetAgentInvestigationGrant,
  useSetAgentInvestigationGrant,
} from "../hooks";
import type { AgentInvestigationsView } from "../api";
import { RateLimitNotice } from "./RateLimitNotice";
import { t } from "../i18n";
import styles from "./SubsystemAgentInvestigationsPage.module.css";

interface SubsystemAgentInvestigationsPageProps {
  children?: React.ReactNode;
}

/** 网关只认词表里的题目（新增题目要网关 + agentd 两侧一起加）。 */
const TOPICS = ["disk"] as const;
type InvestigationTopic = (typeof TOPICS)[number];

/** 题目的人话名字（下拉框与提示里同用一份）。 */
function topicLabel(topic: string): string {
  return topic === "disk"
    ? t("disk（磁盘与文件）", "disk (storage & files)")
    : topic;
}

/**
 * 调查错误码 → 处置建议。
 *
 * 这五个码**都是“人该做什么”不同**，不能合并成一句“操作失败”：
 * 403 要改网关配置，409 要升级 / 提权 agent，429 要等额度，404 是保留期或还没落盘。
 * （码由 `wist-gateway` 的 `src/api/codes.rs` 定义。）
 */
function investigationErrorAdvice(code: string): string | null {
  switch (code) {
    case "investigation_not_allowed":
      return t(
        "本网关关闭了这个调查面（[investigations] allowed_topics）：要开放请改网关配置并重启。",
        "This gateway has disabled this investigation surface ([investigations] allowed_topics): change the gateway config and restart to enable it.",
      );
    case "investigation_unsupported":
      return t(
        "这台 Agent 不支持这个调查面：确认 agentd 已升级，并以 root / 系统服务运行。",
        "This agent does not support this investigation surface: check that agentd is upgraded and runs as root / a system service.",
      );
    case "investigation_quota_exceeded":
      return t(
        "这台 Agent 本小时的调查次数已用完（[investigations] max_per_agent_per_hour）：等额度恢复，或调高配置。",
        "This agent has used up its investigations for the hour ([investigations] max_per_agent_per_hour): wait for the quota to recover, or raise the limit.",
      );
    case "investigation_unknown_topic":
      return t(
        "网关不认识这个题目（只认词表里的题目，目前只有 disk）。",
        "The gateway does not know this topic (only topics in its vocabulary are accepted; currently just disk).",
      );
    case "investigation_bad_params":
      return t(
        "参数不合法（路径必须是绝对路径且不含 ..；条目 / 深度 / 时长由网关与 agentd 夹紧）。",
        "Invalid parameters (the path must be absolute and free of ..; count / depth / duration are clamped by the gateway and agentd).",
      );
    case "investigation_report_not_found":
      return t(
        "报告不在可见范围内：可能还没落盘（数据面回传要几十秒），或已超出保留期（[investigations] report_retention_days）。",
        "The report is not in the visible range: it may not have landed yet (the data plane takes tens of seconds), or it is older than the retention window ([investigations] report_retention_days).",
      );
    default:
      return null;
  }
}

function isUnknownAgentError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 404 &&
    /unknown agent/i.test(error.detail ?? "")
  );
}

function loadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // 调查专属码先看：它们各自的“人该做什么”完全不同（403 改配置 / 409 升级 / 429 等额度）。
    const advice = error.code ? investigationErrorAdvice(error.code) : null;
    if (advice) return advice;
    if (error.status === 401)
      return t(
        "Admin Token 缺失或无效：请在右上角点钥匙按钮，粘贴 Admin Token 后点击「应用」。",
        "Admin Token is missing or invalid: click the key button in the top bar, paste the correct Admin Token and click “Apply”.",
      );
    if (error.status === 429)
      return t(
        "认证失败次数过多，请稍后再试。",
        "Too many failed authentication attempts. Try again later.",
      );
    if (isUnknownAgentError(error))
      return t("网关不认识这台主机。", "The gateway does not know this host.");
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

function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // 上送额度 429 与“鉴权失败太多” 429 同状态码：必须先按 `code` 分开，否则会把“等额度”
    // 说成“token 错了”。
    const advice = error.code ? investigationErrorAdvice(error.code) : null;
    if (advice) return advice;
    if (error.status === 400) {
      return error.detail
        ? t("请求被拒绝：{detail}", "Request rejected: {detail}", {
            detail: error.detail,
          })
        : t("请求被拒绝（参数不合法）。", "Request rejected (invalid parameters).");
    }
    return loadErrorMessage(error);
  }
  return t("下发失败，请稍后重试。", "Failed to dispatch. Try again later.");
}

/** 命令结果的显示文案（与 `wist_api::status::command_outcome` 同一词表）。 */
function outcomeLabel(outcome: string | null): string {
  switch (outcome) {
    case null:
      return t("等待认领", "Awaiting pickup");
    case "succeeded":
      return t("已完成", "Succeeded");
    case "failed":
      return t("失败", "Failed");
    case "no_uplink":
      return t("已完成（无上送通道）", "Succeeded (no uplink)");
    case "throttled":
      return t("已节流", "Throttled");
    case "stale":
      return t("已过期", "Stale");
    case "unsupported":
      return t("Agent 不支持", "Unsupported by agent");
    case "superseded":
      return t("已被后续请求取代", "Superseded");
    case "expired":
      return t("下发超时", "Expired");
    default:
      return outcome;
  }
}

function overallLabel(overall: string): string {
  switch (overall) {
    case "ok":
      return t("正常", "OK");
    case "warn":
      return t("警告", "Warning");
    case "fail":
      return t("有失败项", "Failures");
    default:
      return t("未知", "Unknown");
  }
}

interface ReportRow {
  label: string;
  value: string;
  note: string;
}

interface ReportFinding {
  id: string;
  status: string;
  title: string;
  detail: string;
  hint: string;
  rows: ReportRow[];
}

interface ReportBody {
  verdict: string;
  observedAt: string;
  findings: ReportFinding[];
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

/**
 * 把报告正文收窄成页面能画的结构。
 *
 * `report` 是 **agentd 的原样对象**（网关不做字段建模），所以这里必须**防御式**读：
 * 结构对不上就返回 `null`，由页面降级成「原文」展示 —— 不猜、不把未知版本渲染成空表。
 */
function readReportBody(report: unknown): ReportBody | null {
  if (typeof report !== "object" || report === null) return null;
  const record = report as Record<string, unknown>;
  if (!Array.isArray(record.findings)) return null;
  const findings: ReportFinding[] = [];
  for (const item of record.findings) {
    if (typeof item !== "object" || item === null) continue;
    const finding = item as Record<string, unknown>;
    const rows: ReportRow[] = [];
    if (Array.isArray(finding.rows)) {
      for (const row of finding.rows) {
        if (typeof row !== "object" || row === null) continue;
        const cell = row as Record<string, unknown>;
        rows.push({
          label: stringField(cell, "label"),
          value: stringField(cell, "value"),
          note: stringField(cell, "note"),
        });
      }
    }
    findings.push({
      id: stringField(finding, "id"),
      status: stringField(finding, "status"),
      title: stringField(finding, "title"),
      detail: stringField(finding, "detail"),
      hint: stringField(finding, "hint"),
      rows,
    });
  }
  return {
    verdict: stringField(record, "verdict"),
    observedAt: stringField(record, "observed_at"),
    findings,
  };
}

interface GrantEditorProps {
  agentId: string;
  view: AgentInvestigationsView;
  hasToken: boolean;
}

/**
 * 这台机器的调查授权编辑器（**下界**：只能在上界之内收窄）。
 *
 * 草稿 `draft` 只为“本地改动”存在：`null` 时直接读服务器值，保存/恢复成功后再回到 `null`，
 * 于是别处改过（或宽限期重拉）时页面不会拿着旧草稿不放。
 */
function GrantEditor({ agentId, view, hasToken }: GrantEditorProps) {
  const setGrant = useSetAgentInvestigationGrant(agentId);
  const resetGrant = useResetAgentInvestigationGrant(agentId);
  const ceiling = view.allowedTopics ?? [];
  /** 继承时勾选状态就是网关默认（不是空）—— 否则人会以为“一个都没开”。 */
  const serverTopics = view.grant?.inherited
    ? ceiling
    : (view.grant?.topics ?? []);
  const [draft, setDraft] = useState<string[] | null>(null);
  const selected = draft ?? serverTopics;
  const dirty =
    draft !== null &&
    [...draft].sort().join("\n") !== [...serverTopics].sort().join("\n");
  const pending = setGrant.isPending || resetGrant.isPending;
  const toggle = (topic: string) => {
    setDraft(
      selected.includes(topic)
        ? selected.filter((item) => item !== topic)
        : [...selected, topic],
    );
  };

  return (
    <div className={styles.grantBox}>
      <div className={styles.grantHead}>
        <strong>{t("这台机器的调查授权", "Per-agent investigation grant")}</strong>
        <span className={styles.grantBadge}>
          {view.grant?.inherited
            ? t("继承网关默认", "Inherits gateway default")
            : t("本机自定义", "Custom for this agent")}
        </span>
        {view.grant?.updatedBy ? (
          <span className={styles.note}>
            {t("最近修改", "Last change")}: <code>{view.grant.updatedBy}</code>{" "}
            {view.grant.updatedAt ?? "—"}
          </span>
        ) : null}
      </div>
      <div className={styles.grantOptions}>
        {TOPICS.map((topic) => {
          const inCeiling = ceiling.includes(topic);
          const supported = view.capabilities?.surfaces.includes(topic) ?? false;
          return (
            <label
              key={topic}
              className={styles.grantOption}
              title={
                inCeiling
                  ? undefined
                  : t(
                      "网关没有开启这个面，先改配置",
                      "disabled on this gateway: change the config first",
                    )
              }
            >
              <input
                type="checkbox"
                checked={selected.includes(topic)}
                disabled={!hasToken || pending || !inCeiling}
                onChange={() => toggle(topic)}
              />
              <span>{topicLabel(topic)}</span>
              {!supported ? (
                <span className={styles.grantHint}>
                  {t(
                    "Agent 未上报：勾上也要等它升级才会生效",
                    "agent has not reported it: takes effect only after the agent is upgraded",
                  )}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
      <div className={styles.grantActions}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!hasToken || pending || !dirty}
          onClick={() =>
            setGrant.mutate(selected, { onSuccess: () => setDraft(null) })
          }
        >
          {setGrant.isPending ? t("保存中…", "Saving…") : t("保存授权", "Save grant")}
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={
            !hasToken ||
            pending ||
            ((view.grant?.inherited ?? true) && draft === null)
          }
          onClick={() =>
            resetGrant.mutate(undefined, { onSuccess: () => setDraft(null) })
          }
        >
          {t("恢复继承", "Inherit again")}
        </button>
      </div>
      {setGrant.error ? (
        <p className={styles.error}>{actionErrorMessage(setGrant.error)}</p>
      ) : null}
      {resetGrant.error ? (
        <p className={styles.error}>{actionErrorMessage(resetGrant.error)}</p>
      ) : null}
    </div>
  );
}

export function SubsystemAgentInvestigationsPage(
  _props: SubsystemAgentInvestigationsPageProps,
) {
  const { agentId = "" } = useParams<{ agentId: string }>();
  const [topic, setTopic] = useState<string>(TOPICS[0]);
  const [path, setPath] = useState("");
  const [top, setTop] = useState("10");
  const [selectedCommandId, setSelectedCommandId] = useState<string | null>(
    null,
  );

  const investigations = useAgentInvestigations(agentId);
  const launch = useLaunchAgentInvestigation(agentId);
  const report = useAgentInvestigationReport(agentId, selectedCommandId);

  const view = investigations.data;
  const latest = view?.latestCommand;
  const hasToken = Boolean(getAdminApiToken());

  /**
   * 网关是 S2 构建：`allowed_topics` / `capabilities` / `retention_days` 是 S3 才有的。
   * 用「`allowed_topics` 缺字段」当判据——不能把它当成「`[]` = 一个都不许」，否则旧网关会把菜单全锁死。
   */
  const legacyGateway = view !== undefined && view.allowedTopics === null;

  const capabilities = view?.capabilities ?? null;

  /**
   * 菜单可用性 = **本网关允许的面（配置 ∩ 词表）∩ agent 自报的面**。
   *
   * 两个条件的“为什么不能点”不同，所以分开留理由；一句“不可用”会让人不知道去找网关还是找 agent。
   */
  const topicStates = useMemo(() => {
    return TOPICS.map((item) => {
      if (view === undefined) return { topic: item, selectable: true, reason: "" };
      if (view.allowedTopics !== null && !view.allowedTopics.includes(item)) {
        return {
          topic: item,
          selectable: false,
          reason: t(
            "本网关没有开启这个调查面",
            "this gateway has not enabled it",
          ),
        };
      }
      if (!legacyGateway && view.effectiveTopics !== null) {
        if (view.effectiveTopics.includes(item)) {
          return { topic: item, selectable: true, reason: "" };
        }
        // 生效集漏了它：要么机器不会，要么这台机器没被授权 —— 两句得分开说。
        if (!capabilities?.surfaces.includes(item)) {
          return {
            topic: item,
            selectable: false,
            reason: t(
              "这台 Agent 没有上报这个调查面（旧 agentd / 未实现）",
              "this agent has not reported it (old agentd / not implemented)",
            ),
          };
        }
        return {
          topic: item,
          selectable: false,
          reason: t(
            "这台机器未被授权（在下面勾选并保存）",
            "not granted to this agent (tick it below and save)",
          ),
        };
      }
      if (!legacyGateway && !capabilities?.surfaces.includes(item)) {
        return {
          topic: item,
          selectable: false,
          reason: t(
            "这台 Agent 没有上报这个调查面（旧 agentd / 未实现）",
            "this agent has not reported it (old agentd / not implemented)",
          ),
        };
      }
      return { topic: item, selectable: true, reason: "" };
    });
  }, [view, capabilities, legacyGateway]);

  const selectableTopics = topicStates
    .filter((item) => item.selectable)
    .map((item) => item.topic);

  /** 当前选中的题目一旦变得不可点，就落到第一个可点的：不让表单停在一个必定被拒的值上。 */
  const effectiveTopic: InvestigationTopic | null = selectableTopics.includes(
    topic as InvestigationTopic,
  )
    ? (topic as InvestigationTopic)
    : (selectableTopics[0] ?? null);

  /** 「最近一次命令的报告到了没有」：没到就一直显示「报告未到」，别让人以为调查没做。 */
  const latestHasReport = useMemo(() => {
    if (!latest?.commandId || !view) return false;
    return view.reports.some((item) => item.commandId === latest.commandId);
  }, [latest?.commandId, view]);

  const reportBody = report.data ? readReportBody(report.data.report) : null;

  return (
    <section className={styles.container}>
      {isRateLimitedError(investigations.error) ? (
        <RateLimitNotice error={investigations.error} />
      ) : null}

      <header className={styles.pageHeader}>
        <Link className={styles.back} to="/hosts">
          <span aria-hidden="true">←</span> {t("主机指标", "Host metrics")}
        </Link>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{t("一次性调查", "One-off investigation")}</h1>
          <code className={styles.agentId}>{agentId}</code>
        </div>
        <p className={styles.subtitle}>
          {t(
            "只读、有界的一次性取证：下发命令 → Agent 当场查 → 证据表经数据面落到网关本机报告目录。",
            "Read-only, bounded forensics: dispatch a command, the agent inspects the host, and the evidence table lands in the gateway's local report directory via the data plane.",
          )}
        </p>
        <div className={styles.linkRow}>
          <Link className={styles.inlineLink} to={`/agents/${encodeURIComponent(agentId)}/metrics`}>
            {t("主机详情", "Host details")}
          </Link>
          <Link className={styles.inlineLink} to={`/agents/${encodeURIComponent(agentId)}/work`}>
            {t("采集工作", "Collection work")}
          </Link>
        </div>
      </header>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("发起调查", "Launch an investigation")}</h2>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (effectiveTopic === null) return;
            const parsedTop = Number.parseInt(top, 10);
            launch.mutate({
              topic: effectiveTopic,
              path: path.trim() === "" ? undefined : path.trim(),
              top: Number.isFinite(parsedTop) ? parsedTop : undefined,
            });
          }}
        >
          <label className={styles.field}>
            <span>{t("题目", "Topic")}</span>
            <select
              value={effectiveTopic ?? ""}
              onChange={(event) => setTopic(event.target.value)}
              disabled={!hasToken || launch.isPending || effectiveTopic === null}
            >
              {effectiveTopic === null ? (
                <option value="">
                  {t("没有可用的调查面", "No investigable surface")}
                </option>
              ) : null}
              {topicStates.map((item) => (
                <option key={item.topic} value={item.topic} disabled={!item.selectable}>
                  {topicLabel(item.topic)}
                  {item.selectable ? "" : ` — ${item.reason}`}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>{t("扫描根（可空）", "Scan root (optional)")}</span>
            <input
              type="text"
              value={path}
              placeholder={t("留空 = 由题目挑最紧张的挂载点", "Empty = the topic picks the fullest mount")}
              onChange={(event) => setPath(event.target.value)}
              disabled={!hasToken || launch.isPending}
            />
          </label>
          <label className={`${styles.field} ${styles.fieldNarrow}`}>
            <span>{t("列前 N 条", "Top N")}</span>
            <input
              type="number"
              min={1}
              max={50}
              value={top}
              onChange={(event) => setTop(event.target.value)}
              disabled={!hasToken || launch.isPending}
            />
          </label>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={!hasToken || launch.isPending || effectiveTopic === null}
          >
            {launch.isPending
              ? t("下发中…", "Dispatching…")
              : t("开始调查", "Start investigation")}
          </button>
        </form>
        {/* 走到这里 = 一个面都点不了。旧网关不进来（它会全列为可点），所以只需分两种原因。 */}
        {effectiveTopic === null ? (
          <p className={styles.warn}>
            {view?.allowedTopics?.length === 0
              ? t(
                  "本网关关闭了所有调查面（[investigations] allowed_topics = []）：要么改配置，要么用别的网关。",
                  "This gateway has disabled every investigation surface ([investigations] allowed_topics = []): change the config or use another gateway.",
                )
              : t(
                  "这台 Agent 还没上报调查能力（旧 agentd / 刚升级）：等它下一次状态上报（≤3s）后再刷新。",
                  "This agent has not reported its investigation capabilities yet (old agentd / just upgraded): refresh after its next status report (≤3s).",
                )}
          </p>
        ) : null}
        {capabilities && !capabilities.privileged ? (
          <p className={styles.warn}>
            {t(
              "这台 Agent 不是以 root / 系统服务运行：结果是部分答案（例如别的用户的目录大小可能算不全）。要完整答案请以 root 重跑。",
              "This agent does not run as root / a system service: the answer is partial (e.g. other users' directories may be undercounted). Re-run as root for the full picture.",
            )}
          </p>
        ) : null}
        {legacyGateway ? (
          <p className={styles.note}>
            {t(
              "网关是旧构建：没给按面授权与能力强求，菜单暂时全列出来，点下去仍可能被 403 / 409 拒。",
              "The gateway is an old build: it reports neither the allow-list nor capabilities, so every topic is listed for now; pressing it may still be rejected with 403 / 409.",
            )}
          </p>
        ) : null}
        {!hasToken ? (
          <p className={styles.note}>
            {t(
              "需要先在右上角填入 Admin Token 才能下发。",
              "Fill in the Admin Token in the top bar before dispatching.",
            )}
          </p>
        ) : null}
        {launch.error ? (
          <p className={styles.error}>{actionErrorMessage(launch.error)}</p>
        ) : null}

        {/*
         * 授权与额度：以前只有一条 403/429 的报错，人得去翻代码才知道“找哪个开关”。这里把
         * **生效值** 直接列出来，并在下面一行写清改哪里 —— 控制台只读，改完重启。
         */}
        {view ? (
          <>
            <dl className={styles.statusGrid}>
              <dt>{t("允许的面", "Allowed surfaces")}</dt>
              <dd>
                {view.allowedTopics === null
                  ? t("未知（网关是旧构建）", "Unknown (old gateway build)")
                  : view.allowedTopics.length === 0
                    ? t("一个都不许", "None")
                    : view.allowedTopics.map(topicLabel).join("、")}
              </dd>
              <dt>{t("本小时额度", "Hourly quota")}</dt>
              <dd>
                {view.quota === null
                  ? t("未知（网关是旧构建）", "Unknown (old gateway build)")
                  : view.quota.limitPerHour === 0
                    ? t("不限", "Unlimited")
                    : `${view.quota.usedLastHour ?? "—"} / ${view.quota.limitPerHour}`}
              </dd>
              <dt>{t("报告保留", "Report retention")}</dt>
              <dd>
                {view.retentionDays === null
                  ? t("未知（网关是旧构建）", "Unknown (old gateway build)")
                  : view.retentionDays === 0
                    ? t("不限", "Unlimited")
                    : t("{days} 天", "{days} day(s)", { days: view.retentionDays })}
              </dd>
              <dt>{t("Agent 自报能力", "Agent capabilities")}</dt>
              <dd>
                {capabilities === null
                  ? t("尚未上报（旧 agentd / 刚升级）", "Not reported yet (old agentd / just upgraded)")
                  : `${capabilities.surfaces.map(topicLabel).join("、")}${
                      capabilities.privileged
                        ? t("（root：完整答案）", " (root: complete answers)")
                        : t("（非 root：部分答案）", " (non-root: partial answers)")
                    }`}
              </dd>
            </dl>
            <p className={styles.note}>
              {t(
                "这些是网关的生效值，改它们要改网关配置的 [investigations] 段（allowed_topics / max_per_agent_per_hour / report_retention_days），改完重启网关。",
                "These are the gateway's effective values. Change them in the gateway config's [investigations] section (allowed_topics / max_per_agent_per_hour / report_retention_days), then restart the gateway.",
              )}
            </p>
            {view.allowedTopics !== null && view.grant !== null ? (
              <GrantEditor agentId={agentId} view={view} hasToken={hasToken} />
            ) : null}
          </>
        ) : null}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("最近一次下发", "Latest dispatch")}</h2>
        {investigations.isLoading ? (
          <p className={styles.note}>{t("读取中…", "Loading…")}</p>
        ) : investigations.error ? (
          <p className={styles.error}>{loadErrorMessage(investigations.error)}</p>
        ) : latest?.commandId ? (
          <dl className={styles.statusGrid}>
            <dt>{t("命令", "Command")}</dt>
            <dd>
              <code>{latest.commandId}</code>
            </dd>
            {latest.requestedBy ? (
              <>
                <dt>{t("发起人", "Requested by")}</dt>
                <dd>
                  <code>{latest.requestedBy}</code>
                </dd>
              </>
            ) : null}
            <dt>{t("状态", "Status")}</dt>
            <dd>
              <span className={styles.statusPill}>{outcomeLabel(latest.outcome)}</span>
              {latest.detail ? <span className={styles.statusDetail}>{latest.detail}</span> : null}
            </dd>
            <dt>{t("下发时刻", "Requested at")}</dt>
            <dd>{latest.requestedAt ?? "—"}</dd>
            <dt>{t("报告", "Report")}</dt>
            <dd>
              {latestHasReport
                ? t("已落盘", "Stored")
                : latest.outcome === null
                  ? t("等 Agent 认领（≤3s）", "Waiting for the agent to pick it up (≤3s)")
                  : t(
                      "还没到（经数据面回传，可能要几十秒；也可能数据面没接这条通道）",
                      "Not here yet (it travels via the data plane; may take tens of seconds, or the data plane may not route it)",
                    )}
            </dd>
          </dl>
        ) : (
          <p className={styles.note}>
            {t("这台主机还没有下发过调查。", "No investigation has been dispatched to this host yet.")}
          </p>
        )}
        {view && !view.reportDir.configured ? (
          <p className={styles.note}>
            {t(
              "网关没有挂载报告目录（[data_plane] work_dir 未配置）：只能看到下发状态，看不到完整报告。",
              "The gateway has no report directory mounted ([data_plane] work_dir unset): only the dispatch status is visible, not the full report.",
            )}
          </p>
        ) : null}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("报告", "Reports")}</h2>
        {view && view.retentionDays !== null && view.retentionDays > 0 ? (
          <p className={styles.note}>
            {t(
              "只显示最近 {days} 天的报告（[investigations] report_retention_days）；更早的报告仍在报告目录里，网关不删。",
              "Only reports from the last {days} day(s) are listed ([investigations] report_retention_days); older ones stay in the report directory — the gateway never deletes them.",
              { days: view.retentionDays },
            )}
          </p>
        ) : null}
        {view && view.reportDir.configured && view.reports.length === 0 ? (
          <p className={styles.note}>
            {t("报告目录里还没有这台主机的报告。", "The report directory has no reports for this host yet.")}
          </p>
        ) : null}
        {view && view.reports.length > 0 ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("调查时间", "Observed at")}</th>
                <th>{t("题目", "Topic")}</th>
                <th>{t("结论", "Overall")}</th>
                <th>{t("判定", "Verdict")}</th>
                <th>{t("命令", "Command")}</th>
              </tr>
            </thead>
            <tbody>
              {view.reports.map((item) => (
                <tr
                  key={item.commandId}
                  className={
                    selectedCommandId === item.commandId ? styles.rowSelected : undefined
                  }
                >
                  <td>{item.observedAt || "—"}</td>
                  <td>{item.topic}</td>
                  <td>
                    <span className={styles[`overall_${item.overall}`] ?? styles.overall_unknown}>
                      {overallLabel(item.overall)}
                    </span>
                    <span className={styles.counts}>
                      {item.findingsOk}/{item.findingsWarn}/{item.findingsFail}
                    </span>
                  </td>
                  <td className={styles.verdictCell}>{item.verdict || "—"}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => setSelectedCommandId(item.commandId)}
                    >
                      {t("查看证据表", "Open evidence")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {selectedCommandId ? (
          <div className={styles.reportPanel}>
            <div className={styles.reportHeader}>
              <h3 className={styles.reportTitle}>
                {t("证据表", "Evidence")} <code>{selectedCommandId}</code>
              </h3>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setSelectedCommandId(null)}
              >
                {t("关闭", "Close")}
              </button>
            </div>
            {report.isLoading ? (
              <p className={styles.note}>{t("读取中…", "Loading…")}</p>
            ) : report.error ? (
              <p className={styles.error}>{loadErrorMessage(report.error)}</p>
            ) : reportBody === null ? (
              <pre className={styles.rawReport}>
                {JSON.stringify(report.data?.report ?? null, null, 2)}
              </pre>
            ) : (
              <>
                <p className={styles.reportVerdict}>{reportBody.verdict}</p>
                {reportBody.findings.map((finding) => (
                  <div key={finding.id} className={styles.finding}>
                    <div className={styles.findingHead}>
                      <span className={styles[`finding_${finding.status}`] ?? styles.finding_unknown}>
                        {finding.status}
                      </span>
                      <strong>{finding.title}</strong>
                    </div>
                    {finding.detail ? (
                      <p className={styles.findingDetail}>{finding.detail}</p>
                    ) : null}
                    {finding.hint ? (
                      <p className={styles.findingHint}>→ {finding.hint}</p>
                    ) : null}
                    {finding.rows.length > 0 ? (
                      <table className={styles.rowsTable}>
                        <thead>
                          <tr>
                            <th>{t("项", "Item")}</th>
                            <th>{t("值", "Value")}</th>
                            <th>{t("备注", "Note")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {finding.rows.map((row, index) => (
                            <tr key={`${finding.id}-${index}`}>
                              <td>{row.label}</td>
                              <td>{row.value}</td>
                              <td>{row.note || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : null}
                  </div>
                ))}
              </>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
