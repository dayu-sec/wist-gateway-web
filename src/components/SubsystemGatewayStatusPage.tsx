import { Link } from "react-router-dom";

import { useGatewayLinkdStatus, useGatewaySelfState } from "../hooks";
import type { GatewaySelfStateView } from "../api";
import { linkdSummary } from "./linkdStatus";
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
  if (seconds <= 0) return "0 秒";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分 ${seconds % 60} 秒`;
  return `${seconds} 秒`;
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
 * 自述面**不自带** health 字符串（只有三个原始信号），健康度在此派生 —— 与 gwlinkd 上报中心时的
 * 口径一致（`GatewaySelfState::health`）：存储可查 **且** 数据面上送已启用 **且** 无最近错误 = 健康。
 */
function gatewayHealth(gw: GatewaySelfStateView): {
  tone: "ok" | "crit";
  label: string;
  hint: string;
} {
  const healthy = gw.storeHealthy && gw.uplinkEnabled && !gw.lastError;
  if (healthy) {
    return {
      tone: "ok",
      label: "健康",
      hint: "存储可查、数据面上送已启用、无最近错误。",
    };
  }
  const reasons: string[] = [];
  if (!gw.storeHealthy) reasons.push("存储不可查");
  if (!gw.uplinkEnabled) reasons.push("数据面上送未启用");
  if (gw.lastError) reasons.push(`最近错误：${gw.lastError}`);
  return { tone: "crit", label: "降级", hint: reasons.join("；") + "。" };
}

/**
 * 「网关状态」页（路由 `/gwlinkd`）：**网关两层**的运行状态一页看清。
 *
 * ① **网关（容器）** —— `wist-gateway` 进程自己：版本 / 存储健康 / 已登记 Agent 数 / 数据面上送开关 /
 *    最近错误。这正是 host 侧 gwlinkd 拉自述面后**上报中心**的那份值（设计 `edge/gateway-linkd-status.md`）。
 * ② **接入代理（gwlinkd）** —— 宿主侧常驻进程：把网关接入上级控制中心并维持链路（注册 / 心跳 /
 *    凭据续期 / 升级取指令）。它**纯出站**（无入站面），页面拉不到它 —— 状态靠它周期心跳环回推给网关。
 *
 * 两者的**数据来源不同**，所以分开取：① 走网关 admin 面的自述读口（`/admin/gateway/self-state`），
 * ② 走 gwlinkd 环回推来的心跳（`/admin/gateway/linkd-status`）。① 在 gwlinkd 挂掉时**仍然可读**
 * （网关自己答），② 只在 gwlinkd 活着时新鲜 —— 两栏并排，一眼分清「谁挂了」。
 */
export function SubsystemGatewayStatusPage() {
  const gwQuery = useGatewaySelfState();
  const gw = gwQuery.data;
  const gwHealth = gw ? gatewayHealth(gw) : null;

  const linkdQuery = useGatewayLinkdStatus();
  const linkdView = linkdQuery.data;
  const linkd = linkdSummary(linkdView);

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>网关状态</h1>
          <p className={styles.pageSummary}>
            本机网关分两层：**网关容器**（wist-gateway）自己，以及把网关接入上级控制中心的宿主侧常驻 **wist-gwlinkd**。下面分别是它们的运行状态，每 5 秒自动刷新。
          </p>
        </header>

        {/* ① 网关（容器） */}
        <h2 className={styles.sectionTitle}>网关（容器）</h2>
        <section
          className={`${styles.statusCard} ${styles[`status_${gwHealth?.tone ?? "idle"}`]}`}
          aria-live="polite"
        >
          <span className={styles.statusDot} aria-hidden="true" />
          <div className={styles.statusBody}>
            <div className={styles.statusEyebrow}>运行状态</div>
            <h3 className={styles.statusValue}>{gwHealth?.label ?? "—"}</h3>
            <p className={styles.statusHint}>
              {gwHealth?.hint ?? "正在读取…"}
            </p>
          </div>
        </section>

        {gwQuery.isLoading || gwQuery.isError ? (
          <div className={styles.notice} role="status">
            {gwQuery.isLoading
              ? "正在读取网关自身状态…"
              : "读取失败：请检查本机网关与 Admin Token（顶栏「应用」）。"}
          </div>
        ) : null}

        {gw ? (
          <dl className={styles.grid}>
            <div className={styles.gridItem}>
              <dt>版本</dt>
              <dd>{gw.version || "—"}</dd>
            </div>
            <div className={styles.gridItem}>
              <dt>运行时长</dt>
              <dd>{durationText(gw.uptimeSeconds)}</dd>
            </div>
            <div className={styles.gridItem}>
              <dt>存储</dt>
              <dd>{gw.storeHealthy ? "可查（健康）" : "不可查"}</dd>
            </div>
            <div className={styles.gridItem}>
              <dt>数据面上送</dt>
              <dd>{gw.uplinkEnabled ? "已启用" : "未启用"}</dd>
            </div>
            <div className={styles.gridItem}>
              <dt>Agent 在线 / 离线</dt>
              <dd>
                {gw.onlineAgents} / {gw.offlineAgents}（共 {gw.agentCount}）
              </dd>
            </div>
            <div className={styles.gridItem}>
              <dt>机队最近上报滞后</dt>
              <dd>{gw.lastSeenLagSeconds} 秒</dd>
            </div>
            <div className={styles.gridItem}>
              <dt>CPU（单核口径）</dt>
              <dd>{percentText(gw.cpuPercent)}</dd>
            </div>
            <div className={styles.gridItem}>
              <dt>内存（RSS）</dt>
              <dd>{bytesText(gw.memoryBytes)}</dd>
            </div>
            <div className={styles.gridItem}>
              <dt>主机内存总量</dt>
              <dd>{bytesText(gw.memoryTotalBytes)}</dd>
            </div>
            <div className={styles.gridItem}>
              <dt>负载（1/5/15 分钟）</dt>
              <dd>
                {loadText(gw.load1m)} / {loadText(gw.load5m)} / {loadText(gw.load15m)}
              </dd>
            </div>
            <div className={styles.gridItem}>
              <dt>磁盘</dt>
              <dd>
                {gw.diskUsagePercent === null
                  ? "—"
                  : `${gw.diskUsagePercent.toFixed(0)}%（${bytesText(gw.diskAvailableBytes)} 可用 / ${bytesText(gw.diskTotalBytes)}）`}
              </dd>
            </div>
            <div className={styles.gridItem}>
              <dt>存储大小</dt>
              <dd>{gw.storeBytes > 0 ? bytesText(gw.storeBytes) : "—"}</dd>
            </div>
            <div className={styles.gridItem}>
              <dt>数据面接收（累计）</dt>
              <dd>
                收 {gw.ingestAcceptedTotal} / 拒 {gw.ingestRejectedTotal}
              </dd>
            </div>
            <div className={styles.gridItem}>
              <dt>最近接收事实</dt>
              <dd>{gw.lastIngestAt ? timeText(gw.lastIngestAt) : "—"}</dd>
            </div>
            <div className={styles.gridItem}>
              <dt>采集时刻</dt>
              <dd>{timeText(gw.collectedAt)}</dd>
            </div>
          </dl>
        ) : null}

        {/* ② 接入代理（gwlinkd） */}
        <h2 className={styles.sectionTitle}>接入代理（gwlinkd）</h2>
        <section
          className={`${styles.statusCard} ${styles[`status_${linkd.tone}`]}`}
          aria-live="polite"
        >
          <span className={styles.statusDot} aria-hidden="true" />
          <div className={styles.statusBody}>
            <div className={styles.statusEyebrow}>运行状态</div>
            <h3 className={styles.statusValue}>
              {linkdView ? linkd.label : "—"}
            </h3>
            <p className={styles.statusHint}>
              {linkdView ? linkd.detail : "正在读取…"}
            </p>
            {linkdView?.centerEndpoint ? (
              <div className={styles.statusCenter}>
                <span className={styles.statusCenterLabel}>中心</span>
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
              ? "正在读取 gwlinkd 状态…"
              : "读取失败：请检查本机网关与 Admin Token（顶栏「应用」）。"}
          </div>
        ) : null}

        {linkdView && !linkdView.hasStatus ? (
          <div className={styles.noticeWarn} role="status">
            未检测到 gwlinkd 心跳：宿主侧常驻可能未安装 / 未启动。首次接入请到
            <Link className={styles.inlineLink} to="/link-upstream">
              链接上级
            </Link>
            页提交接入链接。
          </div>
        ) : null}

        {linkdView?.hasStatus ? (
          <>
            <dl className={styles.grid}>
              <div className={styles.gridItem}>
                <dt>版本</dt>
                <dd>{linkdView.version || "—"}</dd>
              </div>
              <div className={styles.gridItem}>
                <dt>实例</dt>
                <dd>{linkdView.instanceId || "—"}</dd>
              </div>
              <div className={styles.gridItem}>
                <dt>最近心跳</dt>
                <dd>
                  {linkdView.ageSeconds} 秒前{linkdView.stale ? "（已失联）" : ""}
                </dd>
              </div>
              <div className={styles.gridItem}>
                <dt>网关收讫</dt>
                <dd>{timeText(linkdView.receivedAt)}</dd>
              </div>
              <div className={styles.gridItem}>
                <dt>客户端证书到期</dt>
                <dd>{timeText(linkdView.credentialExpiresAt)}</dd>
              </div>
              <div className={styles.gridItem}>
                <dt>最近上报中心</dt>
                <dd>{timeText(linkdView.lastCenterReportAt)}</dd>
              </div>
            </dl>
            {linkdView.lastError ? (
              <div className={styles.errorBanner} role="status">
                gwlinkd 最近一次失败：{linkdView.lastError}
              </div>
            ) : null}
          </>
        ) : null}

        <p className={styles.footNote}>
          要重新接入或更换中心？到
          <Link className={styles.inlineLink} to="/link-upstream">
            链接上级
          </Link>
          页提交新的接入链接（接入物先落在本机网关，再由 gwlinkd 拉取执行）。
        </p>
      </main>
    </div>
  );
}
