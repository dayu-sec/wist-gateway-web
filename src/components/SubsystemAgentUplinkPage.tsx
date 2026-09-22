import { useEffect, useState, type FormEvent } from "react";
import { ApiError, isRateLimitedError } from "../api";
import { useAgentUplink, useSetAgentUplink } from "../hooks";
import { CopyButton } from "./CopyButton";
import { RateLimitNotice } from "./RateLimitNotice";
import styles from "./SubsystemAgentUplinkPage.module.css";

/** 未设置时后端给的约定默认端口；表单也从这个值起步。 */
const DEFAULT_PORT = 9000;

/** 关于「未设置」：不是「用默认值」，而是压根没有上送目标。 */
const UNSET_HINT =
  "未设置时，Agent 配置里连上送目标都没有（它本来就不上送）。";

/** Agent 的默认语义：待命。这是本页最容易误解的一点 —— 设了地址 ≠ 开始干活。 */
const IDLE_HINT =
  "Agent 默认待命：不采集日志、也不向数据面上送（指标同样不上送）；设上送地址只是把目标记下来。";

/** 采什么不由网关决定：网关只负责「送到哪」。 */
const PLAN_HINT =
  "真正开始上送要等控制面派活（下发采集任务清单）——采集范围不由网关内置。";

const STEPS = [
  "填入数据面（warp-parse）的上送地址：主机与端口，端口默认 9000",
  "保存后，网关把该地址写进之后新签发的 Agent 初始配置（只记录，不启用上送）",
  IDLE_HINT,
  PLAN_HINT,
];

/** 读取当前设置失败时的提示。 */
function loadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击“应用”。";
    if (error.status === 429) return "认证失败次数过多，请稍后再试。";
    // 404 特指「路由不存在」：网关进程在应答（否则会是网络错误），只是没有这个接口，
    // 绝大多数情况是在跑旧构建的 gateway，而不是服务未启动。
    if (error.status === 404)
      return "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。";
    return error.detail
      ? `网关返回 HTTP ${error.status}：${error.detail}`
      : `网关返回 HTTP ${error.status}，请检查网关日志。`;
  }
  return "读取失败：响应不符合当前契约，请检查网关与前端版本。";
}

/** 保存失败时的提示。 */
function saveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击“应用”。";
    if (error.status === 429) return "认证失败次数过多，请稍后再试。";
    // 同 loadErrorMessage：404 是「路由不存在」，指向旧构建而非服务未启动。
    if (error.status === 404)
      return "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。";
    // 400 = 地址不符合规则（主机为空、端口越界）。后端已把具体原因写在正文里，
    // 优先透出它，操作者才知道该改哪里。
    if (error.detail)
      return `保存失败（HTTP ${error.status}）：${error.detail}`;
    if (error.status === 400)
      return "地址不符合要求：主机不能为空，端口必须是 1–65535 之间的整数。";
    return `网关返回 HTTP ${error.status}，请检查网关日志。`;
  }
  return "保存失败：响应不符合当前契约，请检查网关与前端版本。";
}

function updatedAtText(value: string | null): string {
  if (!value) return "—";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString();
}

/** 端口输入 → 端口号；非法返回 null（与后端 400 的口径一致：1–65535 的整数）。 */
function parsePort(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const port = Number.parseInt(trimmed, 10);
  return port >= 1 && port <= 65535 ? port : null;
}

/**
 * 数据面上送地址设置页。
 *
 * 这里配置的是数据面（warp-parse）的上送目标 —— 网关把它记进 Agent 初始配置的
 * `telemetry.logs.output.tcp`（addr/port）。**记录 ≠ 启用**：Agent 默认待命，
 * 不采集日志、也不上送（指标同样不上送）；真正开始上送要等控制面派活。
 * 改动只影响之后新签发的 Agent。
 */
export function SubsystemAgentUplinkPage() {
  const current = useAgentUplink();
  const save = useSetAgentUplink();
  const [host, setHost] = useState("");
  // 端口用字符串保存输入过程（"09"、"900" 之类的中间态不该被规范化掉），提交时再解析。
  const [port, setPort] = useState(String(DEFAULT_PORT));

  // 读到当前地址后回填：只改端口、或微调主机时不必重新输入。
  // 未设置时服务端返回空主机与默认端口，表单也照此留空/填默认值。
  useEffect(() => {
    if (!current.data) return;
    setHost(current.data.host);
    setPort(String(current.data.port));
  }, [current.data]);

  const portValue = parsePort(port);
  const canSubmit =
    host.trim().length > 0 && portValue !== null && !save.isPending;

  const isUnset = current.data ? current.data.updatedAt === null : false;
  const currentHost = current.data?.host ?? "";
  const currentPort = current.data?.port ?? DEFAULT_PORT;
  const currentAddress = currentHost ? `${currentHost}:${currentPort}` : "";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || portValue === null) return;
    save.mutate({ host: host.trim(), port: portValue });
  }

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>数据面上送地址</h1>
          <p className={styles.pageSummary}>
            数据面（warp-parse）的上送目标；网关把它记进之后新签发的 Agent 初始配置。
            Agent 默认待命：不采集日志、也不上送（指标同样不上送）—— 真正开始上送要等
            控制面派活。
          </p>
          <ol className={styles.steps}>
            {STEPS.map((step, index) => (
              <li key={step} className={styles.step}>
                <span className={styles.stepIndex} aria-hidden="true">
                  {index + 1}
                </span>
                <span className={styles.stepText}>{step}</span>
              </li>
            ))}
          </ol>
        </header>

        <section
          className={styles.usecaseCard}
          aria-labelledby="agent-uplink-current"
        >
          <header className={styles.usecaseMeta}>
            <div className={styles.usecaseMetaCopy}>
              <span className={styles.usecaseTag}>当前生效</span>
              <h2 id="agent-uplink-current">Agent 上送数据的目的地址</h2>
              <p>
                网关把它写进之后新签发 Agent 的初始配置；已分发的 Agent
                不会因为这里改动而改变。
              </p>
            </div>
          </header>
          <div className={styles.cardBody}>
            <dl className={styles.summaryList}>
              <div
                className={`${styles.summaryRow} ${styles.summaryRowPrimary}`}
              >
                <dt>上送地址</dt>
                <dd>
                  {currentAddress ? (
                    <>
                      <span className={styles.summaryValuePrimary}>
                        {currentAddress}
                      </span>
                      <CopyButton
                        text={currentAddress}
                        label="复制"
                        className={styles.inlineCopyButton}
                      />
                    </>
                  ) : (
                    <span className={styles.summaryValueEmpty}>
                      未设置（还没有上送目标）
                    </span>
                  )}
                </dd>
              </div>
              <div className={styles.summaryRow}>
                <dt>主机</dt>
                <dd>
                  <span className={styles.summaryValueMono}>
                    {currentHost || "—"}
                  </span>
                </dd>
              </div>
              <div className={styles.summaryRow}>
                <dt>端口</dt>
                <dd>
                  <span className={styles.summaryValueMono}>{currentPort}</span>
                </dd>
              </div>
              <div className={styles.summaryRow}>
                <dt>最后修改</dt>
                <dd>
                  {/* dt 问的是「什么时候改的」，时间才是这个值；修改人是附带的元信息。 */}
                  <span className={styles.summaryValueMono}>
                    {updatedAtText(current.data?.updatedAt ?? null)}
                  </span>
                  {current.data?.updatedBy ? (
                    <span className={styles.summaryMeta}>
                      {current.data.updatedBy}
                    </span>
                  ) : null}
                </dd>
              </div>
            </dl>
            {current.isLoading ? (
              <div className={styles.notice} role="status">
                正在读取当前设置…
              </div>
            ) : null}
            {current.isError ? (
              isRateLimitedError(current.error) ? (
                <RateLimitNotice error={current.error} />
              ) : (
                <div className={styles.noticeDanger} role="alert">
                  {loadErrorMessage(current.error)}
                </div>
              )
            ) : null}
            {!current.isError && isUnset ? (
              <div className={styles.noticeWarn} role="status">
                {UNSET_HINT}
              </div>
            ) : null}
          </div>
        </section>

        <section
          className={styles.usecaseCard}
          aria-labelledby="agent-uplink-form"
        >
          <header className={styles.usecaseMeta}>
            <div className={styles.usecaseMetaCopy}>
              <span className={styles.usecaseTag}>平台维护操作</span>
              <h2 id="agent-uplink-form">修改上送地址</h2>
              <p>
                保存后新签发的 Agent 才使用该地址；已在运行的 Agent
                需要重新安装或重新签发才会生效。
              </p>
            </div>
          </header>
          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.field}>
              <span>主机</span>
              <input
                type="text"
                value={host}
                onChange={(event) => setHost(event.target.value)}
                placeholder="数据面主机名或 IP，如 127.0.0.1"
                autoComplete="off"
                spellCheck={false}
                required
              />
              <small>
                Agent 向该主机建立 TCP 连接；填主机名或 IP 均可，不要带 tcp://
                前缀或端口。
              </small>
            </label>
            <label className={styles.field}>
              <span>端口</span>
              <input
                type="number"
                min={1}
                max={65535}
                step={1}
                value={port}
                onChange={(event) => setPort(event.target.value)}
                placeholder={String(DEFAULT_PORT)}
                autoComplete="off"
                required
              />
              <small>
                数据面接收上送的 TCP 端口，取值
                1–65535；未设置过时为约定的默认端口 {DEFAULT_PORT}。
              </small>
            </label>
            {save.isError ? (
              <div className={styles.errorBanner} role="alert">
                {saveErrorMessage(save.error)}
              </div>
            ) : null}
            {save.isSuccess ? (
              <div className={styles.formNotice} role="status">
                {`已保存：之后新签发的 Agent 配置会记录该地址 ${save.data.host}:${save.data.port}；Agent 仍处于待命（不采集、不上送），派活后才启用。`}
              </div>
            ) : null}
            <div className={styles.formActions}>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={!canSubmit}
              >
                {save.isPending ? "正在保存…" : "保存"}
              </button>
              <span className={styles.actionHint}>
                只影响之后新签发的 Agent；已分发的 Agent 不会改变。
              </span>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
