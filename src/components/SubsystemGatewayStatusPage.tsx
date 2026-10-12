import { useState } from "react";
import { Link } from "react-router-dom";

import {
  useGatewayLinkdHistory,
  useGatewayLinkdStatus,
  useGatewaySelfState,
  useGatewaySelfStateHistory,
} from "../hooks";
import type { GatewaySelfStateView } from "../api";
import { t } from "../i18n";
import { linkdSummary } from "./linkdStatus";
import { GatewayMetricTrends } from "./GatewayMetricTrends";
import { LinkdHeartbeatTrend } from "./LinkdHeartbeatTrend";
import styles from "./SubsystemGatewayStatusPage.module.css";

/** ISO 时间 → 本地可读；空串 → `—`。 */
function timeText(value: string): string {
  if (!value) return "—";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString();
}

/** 字节 → 人类可读（B/KB/MB/GB）；`null`（量不出）→ `—`。 */
function bytesText(value: number | null): string {
  if (value === null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = value;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${i === 0 || n >= 100 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

/** 秒 → 「N 天 N 小时 / N 小时 N 分 / N 分 N 秒 / N 秒」。 */
function durationText(seconds: number): string {
  if (seconds <= 0) return t("0 秒", "0 s");
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0)
    return t("{days} 天 {hours} 小时", "{days} d {hours} h", { days, hours });
  if (hours > 0)
    return t("{hours} 小时 {minutes} 分", "{hours} h {minutes} m", {
      hours,
      minutes,
    });
  if (minutes > 0)
    return t("{minutes} 分 {seconds} 秒", "{minutes} m {seconds} s", {
      minutes,
      seconds: seconds % 60,
    });
  return t("{seconds} 秒", "{seconds} s", { seconds });
}

/** 单核口径 CPU 占比；`null`（量不出）→ `—`。 */
function percentText(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

/** 负载值；`null` → `—`。 */
function loadText(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

/**
 * 网关（容器）自身健康 → 色调 + 文案。
 *
 * 只看**网关自身**能不能干活：存储可查 **且** 无最近错误 = 健康。
 * **不看**「数据面上送」—— 那是「配没配数据面上送地址 / 开没开开关」，属**机队侧**的事，
 * 与网关进程自身是否健康无关；没配地址不该把一台好网关判成降级。
 */
function gatewayHealth(gw: GatewaySelfStateView): {
  tone: "ok" | "crit";
  label: string;
  hint: string;
} {
  const healthy = gw.storeHealthy && !gw.lastError;
  if (healthy) {
    return {
      tone: "ok",
      label: t("健康", "Healthy"),
      hint: t("存储可查、无最近错误。", "Store reachable, no recent errors."),
    };
  }
  const reasons: string[] = [];
  if (!gw.storeHealthy) reasons.push(t("存储不可查", "Store unreachable"));
  if (gw.lastError)
    reasons.push(t("最近错误：{error}", "Recent error: {error}", { error: gw.lastError }));
  return {
    tone: "crit",
    label: t("降级", "Degraded"),
    hint: t("{reasons}。", "{reasons}.", { reasons: reasons.join(t("；", "; ")) }),
  };
}

type GatewayLayerTab = "container" | "linkd";

/**
 * 「网关状态」页（路由 `/gwlinkd`）：**网关两层**的运行状态。
 *
 * ① **网关（容器）** —— `wist-gateway` 进程自己：版本 / 存储健康 / 已登记 Agent 数 /
 *    最近错误。这正是 host 侧 gwlinkd 拉自述面后**上报中心**的那份值（设计 `edge/gateway-linkd-status.md`）。
 * ② **接入代理（gwlinkd）** —— 宿主侧常驻进程：把网关接入上级控制中心并维持链路（注册 / 心跳 /
 *    凭据续期 / 升级取指令）。它**纯出站**（无入站面），页面拉不到它 —— 状态靠它周期心跳环回推给网关。
 *
 * 两者的**数据来源不同**，所以分开取：① 走网关 admin 面的自述读口（`/admin/gateway/self-state`），
 * ② 走 gwlinkd 环回推来的心跳（`/admin/gateway/linkd-status`）。① 在 gwlinkd 挂掉时**仍然可读**
 * （网关自己答），② 只在 gwlinkd 活着时新鲜 —— 两层各占一个 **tab**，同时只展开一层，
 * 免得两块长明细把页面拉成一条看不到底的长龙；两个 tab 都常驻挂载（切回来不重新取数）。
 */
export function SubsystemGatewayStatusPage() {
  const [activeTab, setActiveTab] = useState<GatewayLayerTab>("container");

  const gwQuery = useGatewaySelfState();
  const gw = gwQuery.data;
  const gwHealth = gw ? gatewayHealth(gw) : null;

  const linkdQuery = useGatewayLinkdStatus();
  const linkdView = linkdQuery.data;
  const linkd = linkdSummary(linkdView);

  const historyQuery = useGatewayLinkdHistory();
  const gwHistoryQuery = useGatewaySelfStateHistory();

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>{t("网关状态", "Gateway status")}</h1>
          <p className={styles.pageSummary}>
            {t(
              "本机网关分两层：**网关容器**（wist-gateway）自己，以及把网关接入上级控制中心的宿主侧常驻 **wist-gwlinkd**。两层各占一个标签页，每 5 秒自动刷新。",
              "The gateway on this host has two layers: the **gateway container** (wist-gateway) itself, and the host-side resident **wist-gwlinkd** that links the gateway to the upstream control center. Each layer has its own tab; both refresh every 5 seconds.",
            )}
          </p>
        </header>

        <div
          className={styles.tabs}
          role="tablist"
          aria-label={t("网关两层", "Gateway layers")}
        >
          <button
            type="button"
            role="tab"
            id="gw-tab-container"
            aria-selected={activeTab === "container"}
            aria-controls="gw-panel"
            className={
              activeTab === "container"
                ? `${styles.tab} ${styles.tabActive}`
                : styles.tab
            }
            onClick={() => setActiveTab("container")}
          >
            <strong>{t("网关（容器）", "Gateway (container)")}</strong>
            <span>wist-gateway</span>
          </button>
          <button
            type="button"
            role="tab"
            id="gw-tab-linkd"
            aria-selected={activeTab === "linkd"}
            aria-controls="gw-panel-linkd"
            className={
              activeTab === "linkd"
                ? `${styles.tab} ${styles.tabActive}`
                : styles.tab
            }
            onClick={() => setActiveTab("linkd")}
          >
            <strong>{t("接入代理", "Link daemon")}</strong>
            <span>wist-gwlinkd</span>
          </button>
        </div>

        {/*
          两个 panel 都渲染、只隐藏非活动的那个：切回去时保留滚动与查询缓存，不重新取数；
          隐藏用 `hidden` 属性，屏幕阅读器也不会读到没展开的那层。
        */}
        <div
          id="gw-panel"
          role="tabpanel"
          aria-labelledby="gw-tab-container"
          className={styles.tabPanel}
          hidden={activeTab !== "container"}
        >
          <section
            className={`${styles.statusCard} ${styles[`status_${gwHealth?.tone ?? "idle"}`]}`}
            aria-live="polite"
          >
            <span className={styles.statusDot} aria-hidden="true" />
            <div className={styles.statusBody}>
              <div className={styles.statusEyebrow}>{t("运行状态", "Runtime status")}</div>
              <h3 className={styles.statusValue}>{gwHealth?.label ?? "—"}</h3>
              <p className={styles.statusHint}>
                {gwHealth?.hint ?? t("正在读取…", "Loading…")}
              </p>
            </div>
          </section>

          {gwQuery.isLoading || gwQuery.isError ? (
            <div className={styles.notice} role="status">
              {gwQuery.isLoading
                ? t("正在读取网关自身状态…", "Loading gateway self state…")
                : t(
                    "读取失败：请检查本机网关与 Admin Token（顶栏「应用」）。",
                    "Load failed: check the local gateway and the Admin Token (Apply in the top bar).",
                  )}
            </div>
          ) : null}

          <GatewayMetricTrends history={gwHistoryQuery.data} />

          {gw ? (
            <dl className={styles.grid}>
              <div className={styles.gridItem}>
                <dt>{t("版本", "Version")}</dt>
                <dd>{gw.version || "—"}</dd>
              </div>
              <div className={styles.gridItem}>
                <dt>{t("运行时长", "Uptime")}</dt>
                <dd>{durationText(gw.uptimeSeconds)}</dd>
              </div>
              <div className={styles.gridItem}>
                <dt>{t("存储", "Store")}</dt>
                <dd>
                  {gw.storeHealthy
                    ? t("可查（健康）", "Reachable (healthy)")
                    : t("不可查", "Unreachable")}
                </dd>
              </div>

              <div className={styles.gridItem}>
                <dt>{t("Agent 在线 / 离线", "Agents online / offline")}</dt>
                <dd>
                  {gw.onlineAgents} / {gw.offlineAgents}
                  {t("（共 {n}）", " ({n} total)", { n: gw.agentCount })}
                </dd>
              </div>
              <div className={styles.gridItem}>
                <dt>{t("机队最近上报滞后", "Fleet last-report lag")}</dt>
                <dd>{t("{n} 秒", "{n} s", { n: gw.lastSeenLagSeconds })}</dd>
              </div>
              <div className={styles.gridItem}>
                <dt>{t("CPU（单核口径）", "CPU (per core)")}</dt>
                <dd>{percentText(gw.cpuPercent)}</dd>
              </div>
              <div className={styles.gridItem}>
                <dt>{t("内存（RSS）", "Memory (RSS)")}</dt>
                <dd>{bytesText(gw.memoryBytes)}</dd>
              </div>
              <div className={styles.gridItem}>
                <dt>{t("主机内存总量", "Host memory total")}</dt>
                <dd>{bytesText(gw.memoryTotalBytes)}</dd>
              </div>
              <div className={styles.gridItem}>
                <dt>{t("负载（1/5/15 分钟）", "Load (1/5/15 min)")}</dt>
                <dd>
                  {loadText(gw.load1m)} / {loadText(gw.load5m)} /{" "}
                  {loadText(gw.load15m)}
                </dd>
              </div>
              <div className={styles.gridItem}>
                <dt>{t("磁盘", "Disk")}</dt>
                <dd>
                  {gw.diskUsagePercent === null
                    ? "—"
                    : t(
                        "{percent}%（{available} 可用 / {total}）",
                        "{percent}% ({available} available / {total})",
                        {
                          percent: gw.diskUsagePercent.toFixed(0),
                          available: bytesText(gw.diskAvailableBytes),
                          total: bytesText(gw.diskTotalBytes),
                        },
                      )}
                </dd>
              </div>
              <div className={styles.gridItem}>
                <dt>{t("存储大小", "Store size")}</dt>
                <dd>{gw.storeBytes > 0 ? bytesText(gw.storeBytes) : "—"}</dd>
              </div>
              <div className={styles.gridItem}>
                <dt>{t("数据面接收（累计）", "Data plane ingest (cumulative)")}</dt>
                <dd>
                  {t(
                    "收 {accepted} / 拒 {rejected}",
                    "Accepted {accepted} / rejected {rejected}",
                    {
                      accepted: gw.ingestAcceptedTotal,
                      rejected: gw.ingestRejectedTotal,
                    },
                  )}
                </dd>
              </div>
              <div className={styles.gridItem}>
                <dt>{t("最近接收事实", "Last ingested fact")}</dt>
                <dd>{gw.lastIngestAt ? timeText(gw.lastIngestAt) : "—"}</dd>
              </div>
              <div className={styles.gridItem}>
                <dt>{t("采集时刻", "Collected at")}</dt>
                <dd>{timeText(gw.collectedAt)}</dd>
              </div>
            </dl>
          ) : null}
        </div>

        <div
          id="gw-panel-linkd"
          role="tabpanel"
          aria-labelledby="gw-tab-linkd"
          className={styles.tabPanel}
          hidden={activeTab !== "linkd"}
        >
          <section
            className={`${styles.statusCard} ${styles[`status_${linkd.tone}`]}`}
            aria-live="polite"
          >
            <span className={styles.statusDot} aria-hidden="true" />
            <div className={styles.statusBody}>
              <div className={styles.statusEyebrow}>{t("运行状态", "Runtime status")}</div>
              <h3 className={styles.statusValue}>
                {linkdView ? linkd.label : "—"}
              </h3>
              <p className={styles.statusHint}>
                {linkdView ? linkd.detail : t("正在读取…", "Loading…")}
              </p>
              {linkdView?.centerEndpoint ? (
                <div className={styles.statusCenter}>
                  <span className={styles.statusCenterLabel}>
                    {t("中心", "Center")}
                  </span>
                  <code className={styles.statusCenterValue}>
                    {linkdView.centerEndpoint}
                  </code>
                  {linkdView.gatewayId ? (
                    <span className={styles.statusCenterId}>
                      · {linkdView.gatewayId}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>

          {linkdQuery.isLoading || linkdQuery.isError ? (
            <div className={styles.notice} role="status">
              {linkdQuery.isLoading
                ? t("正在读取 gwlinkd 状态…", "Loading gwlinkd status…")
                : t(
                    "读取失败：请检查本机网关与 Admin Token（顶栏「应用」）。",
                    "Load failed: check the local gateway and the Admin Token (Apply in the top bar).",
                  )}
            </div>
          ) : null}

          {/* 心跳轨迹：即使当前拍已失联（hasStatus=false）也要看 —— 那正是「什么时候掉的」。 */}
          <LinkdHeartbeatTrend
            history={historyQuery.data}
            loading={historyQuery.isLoading}
          />

          {linkdView && !linkdView.hasStatus ? (
            <div className={styles.noticeWarn} role="status">
              {t(
                "未检测到 gwlinkd 心跳：宿主侧常驻可能未安装 / 未启动。首次接入请到",
                "No gwlinkd heartbeat detected: the host-side daemon may not be installed or started. To enroll for the first time, go to the ",
              )}
              <Link className={styles.inlineLink} to="/link-upstream">
                {t("链接上级", "Link upstream")}
              </Link>
              {t("页提交接入链接。", " page and submit an enrollment link.")}
            </div>
          ) : null}

          {linkdView?.hasStatus ? (
            <>
              <dl className={styles.grid}>
                <div className={styles.gridItem}>
                  <dt>{t("版本", "Version")}</dt>
                  <dd>{linkdView.version || "—"}</dd>
                </div>
                <div className={styles.gridItem}>
                  <dt>{t("实例", "Instance")}</dt>
                  <dd>{linkdView.instanceId || "—"}</dd>
                </div>
                <div className={styles.gridItem}>
                  <dt>{t("最近心跳", "Last heartbeat")}</dt>
                  <dd>
                    {t("{n} 秒前", "{n} s ago", { n: linkdView.ageSeconds })}
                    {linkdView.stale ? t("（已失联）", " (stale)") : ""}
                  </dd>
                </div>
                <div className={styles.gridItem}>
                  <dt>{t("网关收讫", "Received by gateway")}</dt>
                  <dd>{timeText(linkdView.receivedAt)}</dd>
                </div>
                <div className={styles.gridItem}>
                  <dt>{t("客户端证书到期", "Client certificate expires")}</dt>
                  <dd>{timeText(linkdView.credentialExpiresAt)}</dd>
                </div>
                <div className={styles.gridItem}>
                  <dt>{t("最近上报中心", "Last reported to center")}</dt>
                  <dd>{timeText(linkdView.lastCenterReportAt)}</dd>
                </div>
              </dl>
              {linkdView.lastError ? (
                <div className={styles.errorBanner} role="status">
                  {t("gwlinkd 最近一次失败：{error}", "gwlinkd last failure: {error}", {
                    error: linkdView.lastError,
                  })}
                </div>
              ) : null}
            </>
          ) : null}

        </div>

        <p className={styles.footNote}>
          {t(
            "要重新接入或更换中心？到",
            "Need to re-enroll or switch centers? Submit a new enrollment link on the ",
          )}
          <Link className={styles.inlineLink} to="/link-upstream">
            {t("链接上级", "Link upstream")}
          </Link>
          {t(
            "页提交新的接入链接（接入物先落在本机网关，再由 gwlinkd 拉取执行）。",
            "page (the enrollment lands on this gateway first, then gwlinkd pulls and applies it).",
          )}
        </p>
      </main>
    </div>
  );
}
