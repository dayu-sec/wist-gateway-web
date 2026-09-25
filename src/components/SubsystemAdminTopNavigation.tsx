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

function IconControl() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M2 4.4h12M2 11.6h12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="6.2" cy="4.4" r="1.9" fill="var(--sidebar-bg)" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="10.4" cy="11.6" r="1.9" fill="var(--sidebar-bg)" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconInit() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M8 1.6v4.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M4.6 3.4a5.4 5.4 0 1 0 6.8 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M8 9.6v4.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
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

/** Agent 初始化：齿轮 —— Agent 端初始配置（取包来源 / 上送目标）的归口。 */
function IconAgentInit() {
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

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "监控",
    items: [
      { to: "/", label: "Agent 总览", icon: <IconOverview />, end: true },
      { to: "/hosts", label: "主机指标", icon: <IconHost /> },
      { to: "/software", label: "资产清单", icon: <IconSoftware /> },
      { to: "/pipeline", label: "数据采集", icon: <IconPipeline /> },
      { to: "/logs", label: "采集日志", icon: <IconLogs /> },
    ],
  },
  {
    label: "运维",
    items: [{ to: "/upgrade", label: "Agent 升级", icon: <IconUpgrade /> }],
  },
  {
    label: "设置",
    items: [
      { to: "/control", label: "控制中心", icon: <IconControl /> },
      // 「链接上级」= 把本网关接入上级控制中心，与上面那项 Agent 远程运维的
      //「控制中心」是两回事，所以名字里点明动作与对象。
      { to: "/link-upstream", label: "链接上级", icon: <IconInit /> },
      // 取包来源与上送目标合成一页：两项都只写进新签发 Agent 的初始配置。
      { to: "/agent-init", label: "Agent 初始化", icon: <IconAgentInit /> },
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
