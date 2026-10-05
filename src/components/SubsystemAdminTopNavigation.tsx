import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import {
  ADMIN_AUTH_CHANGED_EVENT,
  clearAdminApiToken,
  getAdminApiToken,
  setAdminApiToken,
} from "../api";
import styles from "./SubsystemAdminTopNavigation.module.css";

interface SubsystemAdminTopNavigationProps {
  children?: React.ReactNode;
}

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  end?: boolean;
}

function IconOverview() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <rect x="1.6" y="1.6" width="5.2" height="5.2" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9.2" y="1.6" width="5.2" height="5.2" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="1.6" y="9.2" width="5.2" height="5.2" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9.2" y="9.2" width="5.2" height="5.2" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconHost() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <rect x="1.8" y="2.4" width="12.4" height="4.6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="1.8" y="9" width="12.4" height="4.6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="4.6" cy="4.7" r="0.9" fill="currentColor" />
      <circle cx="4.6" cy="11.3" r="0.9" fill="currentColor" />
    </svg>
  );
}

function IconPipeline() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <circle cx="3.4" cy="8" r="1.7" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.1 8h2.1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="9.2" cy="4.4" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="9.2" cy="11.6" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7.2 8 9.2 5.6M7.2 8l2 2.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.7 4.4h2.2M10.7 11.6h2.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * 链接上级：本机向上接入上级控制中心 —— 上面那圈是**上级侧的插槽**（开口朝下），
 * 下面实心圆点是本网关，中间一截须把两者接上。
 *
 * 为什么不用箭头：运维组已有「Agent 升级 ↑」、设置组已有「安装 Agent ↓」，
 * 再加一支向上的箭头，三项在 15px 下会读成同一个东西。所以这里只留「凹槽 + 节点」
 * （2026-09-26 先试过带箭头的版本，就是被这条否掉的，见产物目录里的候选对照图）。
 * 此前用的电源符号（IconInit）是历史遗留：那图形的语义是「通电/开关」，
 * 与本页「把网关挂到上级」是两件事。
 */
function IconLinkUpstream() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M3.3 7V4.2a1.6 1.6 0 0 1 1.6-1.6h6.2a1.6 1.6 0 0 1 1.6 1.6V7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M8 9.6V7.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.6" r="1.9" fill="currentColor" />
    </svg>
  );
}

function IconInstall() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M8 1.8v7.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M4.9 6.4 8 9.5l3.1-3.1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.6 12.6h10.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** 网关信息：齿轮 —— 网关侧两项（网关对外地址 / 数据面上送目标）的归口。 */
function IconGatewayInfo() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <circle cx="8" cy="8" r="5.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 1.2v1.8M8 13v1.8M1.2 8h1.8M13 8h1.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 安装包：包裹 / 箱子外形 —— 网关包目录里的安装制品。 */
function IconPackage() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M2 5.1 8 2.2l6 2.9v5.8L8 13.8 2 10.9Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M2 5.1 8 8l6-2.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8 8v5.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/** 资产清单：归档箱外形 —— 「这台机器上有什么」的机械归并结果。 */
function IconSoftware() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <rect x="1.8" y="2.2" width="12.4" height="3.2" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.2 5.4v7.2a1.2 1.2 0 0 0 1.2 1.2h7.2a1.2 1.2 0 0 0 1.2-1.2V5.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M6.2 8.6h3.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** 采集日志：日志文件外形 —— Agent 采集原文在网关侧落盘的结果。 */
function IconLogs() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <rect x="2.6" y="1.8" width="10.8" height="12.4" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.4 5.2h5.2M5.4 8h5.2M5.4 10.8h3.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** Agent 升级：向上的箭头 + 底托 —— 把机器上的 agentd 升到更高版本。 */
function IconUpgrade() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M8 12.4V3.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M4.7 6.7 8 3.4l3.3 3.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 14.2h10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** 采集工作：带勾选的行列表形 —— 「这台机器在干什么」的清单。 */
function IconWork() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M3 2.6h10v10.8H3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M5.4 6h5.2M5.4 8.6h5.2M5.4 11.2h3.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** Agent 机队：三节点网格 —— 注册在册的一批机器（含离线）。 */
function IconFleet() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <circle cx="4" cy="4" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="4" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="12" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M5.7 5.3 6.9 10.3M10.3 5.3 9.1 10.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}

/** 吹销名单：禁止符号（圆 + 斜杠）—— 被拒绝接入的一批 Agent。 */
function IconRevocation() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M4.1 4.1 11.9 11.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 知识库：书本外形 —— 网关装载的策展内容（目录 / 包 / 模板 + 规则 + 策略）。 */
function IconKnowledge() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M8 3.5C6.6 2.6 4.6 2.5 2.6 3v9.4c2-.5 4-.4 5.4.5 1.4-.9 3.4-1 5.4-.5V3c-2-.5-4-.4-5.4.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8 3.5v9.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconGwlinkd() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M6.6 9.4 9.4 6.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M6 10.5 4.9 11.6a2.2 2.2 0 0 1-3.1-3.1L3 7.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M10 5.5 11.1 4.4a2.2 2.2 0 0 1 3.1 3.1L13 8.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "监控",
    items: [
      { to: "/", label: "Agent 总览", icon: <IconOverview />, end: true },
      { to: "/hosts", label: "主机指标", icon: <IconHost /> },
      { to: "/work", label: "采集工作", icon: <IconWork /> },
      { to: "/software", label: "资产清单", icon: <IconSoftware /> },
      { to: "/pipeline", label: "数据采集", icon: <IconPipeline /> },
      { to: "/logs", label: "采集日志", icon: <IconLogs /> },
    ],
  },
  {
    label: "运维",
    items: [
      // 机队 = 注册在册的机器（含离线）。删除离线机器在这里（不可恢复，两次确认）。
      { to: "/fleet", label: "Agent 机队", icon: <IconFleet /> },
      // 被按 agent_id 封锁的一批机器（拒绝名单）：机队页看「在册」，这里看「被封」。
      { to: "/revocations", label: "吹销名单", icon: <IconRevocation /> },
      { to: "/upgrade", label: "Agent 升级", icon: <IconUpgrade /> },
    ],
  },
  {
    label: "设置",
    items: [
      // 「链接上级」= 把本网关接入**上级控制中心**（Center 那一侧）—— 页名点明动作与对象。
      { to: "/link-upstream", label: "链接上级", icon: <IconLinkUpstream /> },
      // gwlinkd（宿主侧常驻）专用观测页：一页看清网关两层 —— 「网关容器」与「接入代理 gwlinkd」
      // 的运行状态。「接入成没成」在链接上级页，「谁活着」归这里。
      { to: "/gwlinkd", label: "网关状态", icon: <IconGwlinkd /> },
      // 网关对外地址（只读，由部署配置派生）与数据面上送目标 + 启用开关（可改）合成一页。
      { to: "/gateway-info", label: "Gateway 信息", icon: <IconGatewayInfo /> },
      // 取包来源单独一页（从该页拆回）：配网关从哪取件 + 看已录入的包历史。
      { to: "/install-package", label: "安装包", icon: <IconPackage /> },
      // 策展内容（知识库）单独一页：录入包 + 切生效版本 + 看谁还锁在旧版目录。
      { to: "/knowledge", label: "知识库", icon: <IconKnowledge /> },
      { to: "/install", label: "安装 Agent", icon: <IconInstall /> },
    ],
  },
];

export function SubsystemAdminTopNavigation({
  children,
}: SubsystemAdminTopNavigationProps) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState(() => getAdminApiToken() ?? "");
  const [applied, setApplied] = useState(false);
  // 已设置时表单折叠成一行状态条，点「更换」才展开 —— 凭证是低频操作，
  // 不该常驻占据侧边栏底部一整块。
  const [editing, setEditing] = useState(false);
  const appliedTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(appliedTimer.current), []);

  useEffect(() => {
    function refreshToken() {
      setToken(getAdminApiToken() ?? "");
    }

    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, refreshToken);
    return () => {
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, refreshToken);
    };
  }, []);

  const hasToken = Boolean(token);
  const collapsed = hasToken && !editing;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdminApiToken(token);
    setToken(getAdminApiToken() ?? "");
    setApplied(true);
    window.clearTimeout(appliedTimer.current);
    // 「已应用」反馈展示完顺手收回表单，回到一行状态条。
    appliedTimer.current = window.setTimeout(() => {
      setApplied(false);
      setEditing(false);
    }, 1600);
    void queryClient.invalidateQueries();
  }

  function handleClear() {
    clearAdminApiToken();
    setToken("");
    void queryClient.invalidateQueries();
  }

  return (
    <aside className={styles.container}>
      {children ?? (
        <>
          <div className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">
              <svg viewBox="0 0 20 20" width="17" height="17">
                <path
                  d="M10 2.4 17 6.2v7.6L10 17.6 3 13.8V6.2Z"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <circle cx="10" cy="10" r="2.1" fill="#fff" />
              </svg>
            </span>
            <span className={styles.brandCopy}>
              <span className={styles.brandText}>WarpGateway</span>
              <span className={styles.brandSub}>主机与 Agent 管理台</span>
            </span>
          </div>

          <nav className={styles.links} aria-label="主导航">
            {NAV_GROUPS.map((group) => (
              <div key={group.label} className={styles.navGroup}>
                <span className={styles.navLabel}>{group.label}</span>
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      isActive ? `${styles.link} ${styles.active}` : styles.link
                    }
                  >
                    <span className={styles.linkIcon}>{item.icon}</span>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>

          {collapsed ? (
            <div className={styles.authCollapsed}>
              <span
                className={`${styles.authLabel} ${styles.authCollapsedLabel}`}
              >
                Admin Token
              </span>
              <span className={`${styles.authState} ${styles.authStateOn}`}>
                已设置
              </span>
              <button
                type="button"
                className={styles.authChange}
                onClick={() => setEditing(true)}
              >
                更换
              </button>
            </div>
          ) : (
            <form className={styles.authForm} onSubmit={handleSubmit}>
              <div className={styles.authHead}>
                <label
                  className={styles.authLabel}
                  htmlFor="warp-insight-admin-token"
                >
                  Admin Token
                </label>
                <span
                  className={
                    hasToken
                      ? `${styles.authState} ${styles.authStateOn}`
                      : styles.authState
                  }
                >
                  {hasToken ? "已设置" : "未设置"}
                </span>
              </div>
              <input
                id="warp-insight-admin-token"
                className={styles.authInput}
                type="password"
                autoComplete="off"
                placeholder="粘贴管理令牌"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
              <p className={styles.authHint}>
                仅存于本会话标签页，用于调用 Gateway 管理接口。
              </p>
              <div className={styles.authActions}>
                <button
                  className={`${styles.authButton} ${styles.authPrimary}`}
                  type="submit"
                  disabled={!token || token === getAdminApiToken()}
                >
                  {applied ? "已应用" : "应用"}
                </button>
                <button
                  className={styles.authButton}
                  type="button"
                  onClick={handleClear}
                  disabled={!hasToken}
                >
                  清除
                </button>
                {hasToken ? (
                  <button
                    className={`${styles.authButton} ${styles.authGhost}`}
                    type="button"
                    onClick={() => setEditing(false)}
                  >
                    收起
                  </button>
                ) : null}
              </div>
            </form>
          )}
        </>
      )}
    </aside>
  );
}
