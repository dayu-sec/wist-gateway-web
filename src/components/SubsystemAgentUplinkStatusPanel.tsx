import type { AgentUplinkStateView } from "../api";
import { t } from "../i18n";
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
 *
 * 文案在调用那一刻取（`t()`）：本函数在渲染期被调用，切语言会重新求值。
 */
function describe(state: AgentUplinkStateView | null): Headline {
  if (!state) {
    return {
      tone: "unknown",
      pill: t("未上报", "Not reported"),
      title: t(
        "这台 Agent 还没上报生效状态",
        "This agent has not reported its effective status yet",
      ),
      detail: t(
        "agentd 是旧版本（不发这个字段），或它还没成功上报过。先确认它在机队视图里「在线」。",
        "Either agentd is an old build (it does not send this field) or it has never reported successfully. First check that it is online in the fleet view.",
      ),
    };
  }

  if (state.enabled && state.kind === "tcp") {
    if (state.outputWriteFailing) {
      return {
        tone: "crit",
        pill: t("已启用 · 出口失败", "Enabled · output failing"),
        title: t(
          "已启用上送，但出口写失败尚未恢复（目标 {target}）",
          "Uplink is enabled, but the output write failure has not recovered (target {target})",
          { target: state.target ?? t("本机配置", "local config") },
        ),
        detail: t(
          "去这台机器的 agentd 日志看 `telemetry output write failed` 行的 magnitude/cause（含目标地址与原因）。",
          "Check this machine's agentd log for the magnitude/cause on the `telemetry output write failed` line (it carries the target address and the reason).",
        ),
      };
    }
    return {
      tone: "ok",
      pill: t("已上送", "Reporting"),
      title: state.target
        ? t(
            "已启用：日志经 tcp 送往 {target}",
            "Enabled: logs are sent over tcp to {target}",
            { target: state.target },
          )
        : t("已启用：按本机配置上送", "Enabled: sending per local config"),
      detail: t(
        "有生效工作且目标可达时，采集日志会出现在「采集日志」页。",
        "When effective work exists and the target is reachable, collection logs show up on the Collection logs page.",
      ),
    };
  }

  if (state.enabled && state.kind !== "tcp") {
    return {
      tone: "standby",
      pill: t("已启用 · {kind}", "Enabled · {kind}", { kind: state.kind }),
      title: t(
        "生效输出是 {kind}，不是数据面 —— 数据不会到网关",
        "The effective output is {kind}, not the data plane — data will not reach the gateway",
        { kind: state.kind },
      ),
      detail: t(
        "这是本机配置的结果（控制面没给出目标去覆盖它）。派活后控制面会下发目标并切到 tcp —— 目标是部署配置派生的，不需要人工录地址。",
        "This is the result of local config (the control plane has not issued a target to override it). Once work is assigned, the control plane sends a target and switches to tcp — the target is derived from the deployment config, so no address has to be entered by hand.",
      ),
    };
  }

  if (state.source === "grant") {
    // 已经有目标（`tcp` + 地址）= 目标来自管理面设置或部署配置派生，所以这两个条件里
    // 缺的多半是「生效工作」，直接把话说到那一件。
    if (state.target) {
      return {
        tone: "standby",
        pill: t("待命", "Standby"),
        title: t(
          "控制面没启用上送（正常待命）",
          "Uplink is not enabled by the control plane (normal standby)",
        ),
        detail: t(
          "上送目标这边看起来是有的（Agent 侧记着 {target}）。两个条件里缺的多半是「生效工作」—— 到本页下方的「能派什么」派一份常驻工作即可；若确实已派过活，再回 Gateway 信息页看「数据面上送地址」一眼。",
          "The uplink target appears to be in place (the agent has {target} on record). What is most likely missing is effective work — assign a piece of standing work from “What can be assigned” below. If work really has been assigned, take another look at “Data plane uplink address” on the Gateway info page.",
          { target: state.target },
        ),
      };
    }
    return {
      tone: "standby",
      pill: t("待命", "Standby"),
      title: t(
        "控制面没启用上送（正常待命）",
        "Uplink is not enabled by the control plane (normal standby)",
      ),
      detail: t(
        "Agent 侧还没记下上送目标 —— 网关没能给出目标（对外基址里取不出主机名，或本机拿的配置被改过）。到 Gateway 信息页看「数据面上送地址」一眼；派活后 ≤30 秒自动开，无需改配置或重装。",
        "The agent has no uplink target on record — the gateway could not provide one (no host name can be derived from the external base URL, or the config it received has been changed). Take a look at “Data plane uplink address” on the Gateway info page; after work is assigned it turns on within 30 seconds, with no config change or reinstall.",
      ),
    };
  }

  return {
    tone: "standby",
    pill: t("待命（本机）", "Standby (local)"),
    title: t(
      "没拿到控制面授权，按本机配置待命",
      "No control-plane grant; standing by on local config",
    ),
    detail: t(
      "网关旧（`uplink:poll` 回 404）或拉取一直失败。升级 / 修好网关后，这里会变成「由控制面决定」。",
      "Either the gateway is old (`uplink:poll` returns 404) or the poll keeps failing. After the gateway is upgraded or fixed, this becomes “decided by the control plane”.",
    ),
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
      aria-label={t("数据面上送状态", "Data plane uplink status")}
    >
      <div className={styles.header}>
        <h2 className={styles.title}>{t("数据面上送", "Data plane uplink")}</h2>
        <span className={styles.pill}>{headline.pill}</span>
      </div>

      {loadError ? (
        <p className={styles.error}>{loadError}</p>
      ) : loading ? (
        <p className={styles.muted}>{t("正在读取…", "Loading…")}</p>
      ) : (
        <>
          <p className={styles.headline}>{headline.title}</p>
          <p className={styles.detail}>{headline.detail}</p>
          {uplinkState ? (
            <dl className={styles.facts}>
              <div className={styles.fact}>
                <dt>{t("开关", "Switch")}</dt>
                <dd>
                  {uplinkState.enabled
                    ? t("启用", "Enabled")
                    : t("待命", "Standby")}
                </dd>
              </div>
              <div className={styles.fact}>
                <dt>{t("输出", "Output")}</dt>
                <dd>
                  {uplinkState.kind}
                  {uplinkState.target ? ` → ${uplinkState.target}` : ""}
                </dd>
              </div>
              <div className={styles.fact}>
                <dt>{t("来源", "Source")}</dt>
                <dd>{sourceLabel(uplinkState.source)}</dd>
              </div>
              <div className={styles.fact}>
                <dt>{t("出口写失败", "Output write failure")}</dt>
                <dd>
                  {uplinkState.outputWriteFailing
                    ? t("尚未恢复", "Not recovered")
                    : t("无", "None")}
                </dd>
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
      return t("控制面下发", "From control plane");
    case "local":
      return t("本机配置", "Local config");
    default:
      return source;
  }
}
