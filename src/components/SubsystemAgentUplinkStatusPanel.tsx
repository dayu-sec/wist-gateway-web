import type { AgentUplinkStateView } from "../api";
import styles from "./SubsystemAgentUplinkStatusPanel.module.css";

interface SubsystemAgentUplinkStatusPanelProps {
  uplinkState: AgentUplinkStateView | null;
  loading?: boolean;
  loadError?: string | null;
}

type Tone = "ok" | "standby" | "crit" | "unknown";

interface Headline {
  tone: Tone;
  pill: string;
  title: string;
  detail: string;
}

/**
 * 把 agent 上报的**实际生效**上送状态翻成一句人话。
 *
 * 为什么要在页面上说清楚：**待命与故障在别处长一个样**（两种情况都没数据）。
 * 四种「看起来都是不上送」要分开：
 *   * 未上报 —— 旧版本 agentd，或还没成功上报过；
 *   * 待命（grant）—— 控制面明确没启用（没设地址 / 没派活），**正常**；
 *   * 待命（local）—— 没拿到控制面授权，按本机配置待命（网关旧或拉取失败）；
 *   * 已启用但出口失败（`enabled` + `tcp` + `outputWriteFailing`）—— **这才是故障**。
 */
function describe(state: AgentUplinkStateView | null): Headline {
  if (!state) {
    return {
      tone: "unknown",
      pill: "未上报",
      title: "这台 Agent 还没上报生效状态",
      detail:
        "agentd 是旧版本（不发这个字段），或它还没成功上报过。先确认它在机队视图里「在线」。",
    };
  }

  if (state.enabled && state.kind === "tcp") {
    if (state.outputWriteFailing) {
      return {
        tone: "crit",
        pill: "已启用 · 出口失败",
        title: `已启用上送，但出口写失败尚未恢复（目标 ${
          state.target ?? "本机配置"
        }）`,
        detail:
          "去这台机器的 agentd 日志看 `telemetry output write failed` 行的 magnitude/cause（含目标地址与原因）。",
      };
    }
    return {
      tone: "ok",
      pill: "已上送",
      title: state.target
        ? `已启用：日志经 tcp 送往 ${state.target}`
        : "已启用：按本机配置上送",
      detail: "有生效工作且目标可达时，采集日志会出现在「采集日志」页。",
    };
  }

  if (state.enabled && state.kind !== "tcp") {
    return {
      tone: "standby",
      pill: `已启用 · ${state.kind}`,
      title: `生效输出是 ${state.kind}，不是数据面 —— 数据不会到网关`,
      detail:
        "这是本机配置的结果（控制面没给出目标去覆盖它）。设「数据面上送地址」+ 派活后会自动改成 tcp。",
    };
  }

  if (state.source === "grant") {
    // 已经有目标（`tcp` + 地址）= 安装时管理面就配过「数据面上送地址」，否则模板只会给
    // `kind="file"`。所以这两个条件里缺的多半是「生效工作」，直接把话说到那一件。
    if (state.target) {
      return {
        tone: "standby",
        pill: "待命",
        title: "控制面没启用上送（正常待命）",
        detail: `上送地址这边看起来是配过的（Agent 侧记着目标 ${state.target}）。两个条件里缺的多半是「生效工作」—— 到本页下方的「能派什么」派一份常驻工作即可；若确实已派过活，再回 Gateway 初始化页确认「数据面上送地址」没被清空。`,
      };
    }
    return {
      tone: "standby",
      pill: "待命",
      title: "控制面没启用上送（正常待命）",
      detail:
        "Agent 侧还没记下上送目标，缺的多半是「数据面上送地址」—— 先到 Gateway 初始化页设地址，再派活。补齐后 ≤30 秒自动开，无需改配置或重装。",
    };
  }

  return {
    tone: "standby",
    pill: "待命（本机）",
    title: "没拿到控制面授权，按本机配置待命",
    detail:
      "网关旧（`uplink:poll` 回 404）或拉取一直失败。升级 / 修好网关后，这里会变成「由控制面决定」。",
  };
}

/**
 * 数据面上送状态面板（工作页顶部）。
 *
 * 取 `GET /api/v1/admin/agents/{agent_id}/runtime-status` 的 `uplink_state` —— 网关侧的
 * 「数据面上送地址」说「要它怎样」，这块面板说「它实际成了怎样」，两者合看才回答得了
 * 「这台为什么不上送」。
 */
export function SubsystemAgentUplinkStatusPanel({
  uplinkState,
  loading = false,
  loadError = null,
}: SubsystemAgentUplinkStatusPanelProps) {
  const headline = describe(uplinkState);

  return (
    <section
      className={`${styles.container} ${styles[headline.tone]}`}
      aria-label="数据面上送状态"
    >
      <div className={styles.header}>
        <h2 className={styles.title}>数据面上送</h2>
        <span className={styles.pill}>{headline.pill}</span>
      </div>

      {loadError ? (
        <p className={styles.error}>{loadError}</p>
      ) : loading ? (
        <p className={styles.muted}>正在读取…</p>
      ) : (
        <>
          <p className={styles.headline}>{headline.title}</p>
          <p className={styles.detail}>{headline.detail}</p>
          {uplinkState ? (
            <dl className={styles.facts}>
              <div className={styles.fact}>
                <dt>开关</dt>
                <dd>{uplinkState.enabled ? "启用" : "待命"}</dd>
              </div>
              <div className={styles.fact}>
                <dt>输出</dt>
                <dd>
                  {uplinkState.kind}
                  {uplinkState.target ? ` → ${uplinkState.target}` : ""}
                </dd>
              </div>
              <div className={styles.fact}>
                <dt>来源</dt>
                <dd>{sourceLabel(uplinkState.source)}</dd>
              </div>
              <div className={styles.fact}>
                <dt>出口写失败</dt>
                <dd>{uplinkState.outputWriteFailing ? "尚未恢复" : "无"}</dd>
              </div>
            </dl>
          ) : null}
        </>
      )}
    </section>
  );
}

function sourceLabel(source: string): string {
  switch (source) {
    case "grant":
      return "控制面下发";
    case "local":
      return "本机配置";
    default:
      return source;
  }
}
