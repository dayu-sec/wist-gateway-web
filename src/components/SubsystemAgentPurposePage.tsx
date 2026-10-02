import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, getAdminApiToken, isRateLimitedError } from "../api";
import type { MachineClass } from "../types";
import { useAgentPurpose, useClassifyAgentPurpose } from "../hooks";
import { RateLimitNotice } from "./RateLimitNotice";
import { SubsystemAgentPurposeView } from "./SubsystemAgentPurposeView";
import styles from "./SubsystemAgentPurposePage.module.css";

interface SubsystemAgentPurposePageProps {
  children?: React.ReactNode;
}

/**
 * 区分 404 的两种含义。
 *
 * 管理面「未知 Agent」与「网关上没有这个接口」都是 404，但处置完全不同：
 * 前者是 agent_id 不存在（网关自己回纯文本 `unknown agent {id}`），
 * 后者说明在跑的 gateway 是旧构建（axum 对未注册路由回空正文）。
 * 用响应正文区分，避免把「这台机器不存在」误报成「网关版本旧」。
 */
function isUnknownAgentError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 404 &&
    /unknown agent/i.test(error.detail ?? "")
  );
}

/** 读取失败时的提示（与其它管理面页面同一口径）。 */
function loadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击「应用」。";
    if (error.status === 429) return "认证失败次数过多，请稍后再试。";
    // 走到这里说明 404 的正文对不上「未知 Agent」：更可能是网关没有这个路由。
    if (error.status === 404)
      return "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。";
    return error.detail
      ? `网关返回 HTTP ${error.status}：${error.detail}`
      : `网关返回 HTTP ${error.status}，请检查网关日志。`;
  }
  return "读取失败：响应不符合当前契约，请检查网关与前端版本。";
}

function formatTimestamp(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString("zh-CN", { hour12: false });
}

/**
 * Agent 用途页（模型 `ViewAgentPurpose`，管理面条目 `AdminViewAgentPurpose`）。
 *
 * 页面只管取数与路由状态（加载中 / 未知 Agent / 读取失败），
 * 结论带（判定 | 推断）与事实 / 依据全宽分区的展示在 `SubsystemAgentPurposeView` 里。
 */
export function SubsystemAgentPurposePage({}: SubsystemAgentPurposePageProps) {
  const { agentId = "" } = useParams<{ agentId: string }>();
  const { data, error, isLoading, isError } = useAgentPurpose(agentId);

  const unknownAgent = isError && isUnknownAgentError(error);

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <Link className={styles.back} to="/hosts">
          <span aria-hidden="true">←</span> 返回机队视图
        </Link>
        <div className={styles.titleRow}>
          <h1 className={styles.pageTitle}>{agentId || "未指定主机"}</h1>
          <span className={styles.scopeBadge}>用途：事实 / 推断 / 判定</span>
          <Link
            className={styles.crossLink}
            to={`/agents/${encodeURIComponent(agentId)}/metrics`}
          >
            主机指标 <span aria-hidden="true">→</span>
          </Link>
          <Link
            className={styles.crossLink}
            to={`/agents/${encodeURIComponent(agentId)}/work`}
          >
            采集工作 <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className={styles.metaRow}>
          {data ? (
            <span className={styles.metaItem}>
              视图生成 <strong>{formatTimestamp(data.generatedAt)}</strong>
            </span>
          ) : null}
          <span className={styles.metaItemMuted}>
            不自动轮询：事实只在内容变化时上报，建议只在事实或规则册变化时重算 —— 需要重取用右上角「刷新」。
          </span>
        </div>
      </header>

      {unknownAgent ? (
        // 「这台机器不存在」（404）与「它还没报过事实」（200 + 空视图）必须分开呈现。
        <section className={styles.unknownAgent} role="alert">
          <h2 className={styles.unknownTitle}>未知 Agent</h2>
          <p className={styles.unknownText}>
            网关里没有 <strong>{agentId}</strong> 这台 Agent 的注册记录（HTTP 404）。这与「尚未上报事实」是两回事：后者是已知的 Agent 还没报过摘要，网关会返回空的事实与建议，而不是 404。
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

      {isError && !unknownAgent ? (
        isRateLimitedError(error) ? (
          <RateLimitNotice error={error} />
        ) : (
          <div className={styles.errorBanner} role="alert">
            {loadErrorMessage(error)}
          </div>
        )
      ) : null}

      {isLoading ? (
        <div className={styles.skeletonWrap}>
          {[0, 1, 2].map((index) => (
            <div key={index} className={styles.skeletonPanel} />
          ))}
        </div>
      ) : null}

      {/* 未设置 token 时查询是 disabled 的（不请求管理面），要明确说出来而不是留白。 */}
      {!isLoading && !isError && !data ? (
        <div className={styles.idleNotice} role="status">
          {getAdminApiToken()
            ? "尚未取到用途数据，用右上角「刷新」重试。"
            : "未设置 Admin Token：在左侧填入后才向管理面请求，这里不会显示数据。"}
        </div>
      ) : null}

      {data ? (
        <div className={styles.viewWrap}>
          <ClassifyPanel
            agentId={agentId}
            currentClass={data.classification?.machineClass ?? null}
            suggestedClass={data.suggestion?.suggestedClass ?? null}
            suggestionId={data.suggestion?.suggestionId ?? null}
            hasFacts={data.factSummary !== null}
            platform={data.factSummary?.os ?? null}
          />
          <SubsystemAgentPurposeView agentPurposeView={data} />
        </div>
      ) : null}
    </div>
  );
}

const MACHINE_CLASS_OPTIONS: MachineClass[] = [
  "MacDaily",
  "MacDev",
  "LinuxHost",
  "LinuxCompute",
  "LinuxData",
];

interface ClassifyPanelProps {
  agentId: string;
  currentClass: MachineClass | null;
  suggestedClass: MachineClass | null;
  suggestionId: string | null;
  hasFacts: boolean;
  /** 已观测到的平台（`factSummary.os`）；`null` = 还没事实（此时表单本来就被挡住）。 */
  platform: string | null;
}

/**
 * 归档用途判定（模型 `AdminClassifyAgent`）。
 *
 * 为什么放在用途页而不是派活页：判定是**采集范围的前置**，它回答的是「这台机器是什么」——
 * 那是本页的题目；派活页只是它的下游使用者。
 *
 * 两个必须说在前面的事：
 *   · 分类必须与该机器**已观测到的平台**一致（网关联没有事实时报 400，不默认放行）；
 *   · 改判就是改采集范围：**合规边界**，因此留判的人与时间。
 */
function ClassifyPanel({
  agentId,
  currentClass,
  suggestedClass,
  suggestionId,
  hasFacts,
  platform,
}: ClassifyPanelProps) {
  const mutation = useClassifyAgentPurpose(agentId);
  const [selected, setSelected] = useState<MachineClass | "">(
    currentClass ?? suggestedClass ?? "",
  );
  const [note, setNote] = useState("");
  // 既无建议也无当前判定时的默认值要**按平台**给：网关只接受与已观测平台一致的类别，
  // 写死 MacDaily 会让 Linux 机器一点提交就 400（旧行为的坑）。
  const fallback: MachineClass = platform === "macos" ? "MacDaily" : "LinuxHost";
  const value = selected || suggestedClass || fallback;

  return (
    <section className={styles.classifyPanel} aria-labelledby="agent-purpose-classify">
      <header className={styles.classifyHeader}>
        <h2 className={styles.classifyTitle} id="agent-purpose-classify">
          归档用途判定
        </h2>
        <span className={styles.classifyHint}>
          判定是<strong>授权工作模板的前置</strong>（它决定取哪份模板、能派哪些采集面）；改判就是改采集范围，所以留判的人与时间
        </span>
      </header>

      {!hasFacts ? (
        <p className={styles.classifyBlocked}>
          这台机器还没上报过事实摘要：网关无法确认它的平台，因此<strong>拒绝</strong>归档判定（不默认放行）。等它上报后再来。
        </p>
      ) : (
        <div className={styles.classifyForm}>
          <label className={styles.classifyField}>
            机器类别
            <select
              className={styles.classifyInput}
              value={value}
              onChange={(event) =>
                setSelected(event.target.value as MachineClass)
              }
            >
              {MACHINE_CLASS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                  {option === suggestedClass ? "（网关建议）" : ""}
                  {option === currentClass ? "（当前判定）" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.classifyField}>
            备注（可留空）
            <input
              className={styles.classifyInput}
              value={note}
              placeholder="例如：这台是开发机，采纳网关建议"
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <button
            type="button"
            className={styles.classifyButton}
            disabled={mutation.isPending}
            onClick={() =>
              mutation.mutate({
                machineClass: value,
                // 与当前建议一致时记下「采纳了哪一次建议」，不一致就是改判/推翻。
                suggestionId: value === suggestedClass ? suggestionId ?? undefined : undefined,
                note: note.trim() ? note.trim() : undefined,
              })
            }
          >
            {mutation.isPending ? "提交中…" : "归档判定"}
          </button>
          {mutation.isError ? (
            <span className={styles.classifyError} role="alert">
              {classifyErrorMessage(mutation.error)}
            </span>
          ) : null}
          {mutation.isSuccess ? (
            <span className={styles.classifyOk} role="status">
              已归档：{mutation.data.machineClass}
            </span>
          ) : null}
        </div>
      )}
    </section>
  );
}

function classifyErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // 400 的两种原因（没事实 / 分类与平台不符）网关都写在正文里，原样透出。
    if (error.status === 400) return error.detail ?? "请求不成立（HTTP 400）。";
    if (error.status === 404) return "未知 Agent（HTTP 404）。";
    return `归档失败（HTTP ${error.status}）：${error.detail ?? "请检查网关日志。"}`;
  }
  return "归档失败：响应不符合当前契约。";
}
