import { useEffect, useState } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { matchPath, useLocation } from "react-router-dom";
import { ADMIN_AUTH_CHANGED_EVENT, getAdminApiToken } from "../api";
import { dateLocale, setAppLocale, t, useLocale } from "../i18n";
import { toggleAppTheme, useAppTheme } from "../theme";
import { AdminTokenControl } from "./AdminTokenControl";
import styles from "./AppStatusBar.module.css";

/** 一级分组。文案表必须是**函数**：模块级常量只在导入时求值一次，切语言不会变。 */
type RouteSection = "monitoring" | "ops" | "settings";

function sectionLabels(): Record<RouteSection, string> {
  return {
    monitoring: t("监控", "Monitoring"),
    ops: t("运维", "Operations"),
    settings: t("设置", "Settings"),
  };
}

interface RouteMeta {
  section: RouteSection;
  crumbs: string[];
}

/** 路由 → 面包屑。detail 段由页面自身补充，这里只负责到二级。
 * `t()` 在这里（渲染期）求值 —— 本函数每次渲染都调，切语言才会跟着变。 */
function describeRoute(pathname: string): RouteMeta {
  if (matchPath("/agents/:agentId/metrics", pathname)) {
    return {
      section: "monitoring",
      crumbs: [t("主机指标", "Host metrics"), t("主机详情", "Host detail")],
    };
  }
  if (matchPath("/agents/:agentId/purpose", pathname)) {
    return {
      section: "monitoring",
      crumbs: [t("主机指标", "Host metrics"), t("Agent 用途", "Agent purpose")],
    };
  }
  if (matchPath("/agents/:agentId/work", pathname)) {
    return {
      section: "monitoring",
      crumbs: [
        t("采集工作", "Collection work"),
        t("工作清单", "Work list"),
      ],
    };
  }
  if (matchPath("/upgrade/:planId", pathname)) {
    return {
      section: "ops",
      crumbs: [t("Agent 升级", "Agent upgrade"), t("升级计划", "Upgrade plan")],
    };
  }
  switch (pathname) {
    case "/hosts":
      return { section: "monitoring", crumbs: [t("主机指标", "Host metrics")] };
    case "/software":
      return {
        section: "monitoring",
        crumbs: [t("资产清单", "Software inventory")],
      };
    case "/pipeline":
      return { section: "monitoring", crumbs: [t("数据采集", "Data pipeline")] };
    case "/logs":
      return { section: "monitoring", crumbs: [t("采集日志", "Collection logs")] };
    case "/work":
      return { section: "monitoring", crumbs: [t("采集工作", "Collection work")] };
    case "/upgrade":
      return { section: "ops", crumbs: [t("Agent 升级", "Agent upgrade")] };
    case "/fleet":
      return { section: "ops", crumbs: [t("Agent 机队", "Agent fleet")] };
    case "/revocations":
      return { section: "ops", crumbs: [t("吊销名单", "Revocations")] };
    case "/install":
      return { section: "ops", crumbs: [t("安装 Agent", "Install agent")] };
    case "/gateway-info":
      return { section: "settings", crumbs: [t("Gateway 信息", "Gateway info")] };
    case "/gwlinkd":
      // 与侧边栏「监控」组一致：这一页看的是「网关两层谁活着」，属于观测。
      return { section: "monitoring", crumbs: [t("网关状态", "Gateway status")] };
    case "/install-package":
      return { section: "ops", crumbs: [t("安装包管理", "Install packages")] };
    case "/install-package/add":
      return {
        section: "ops",
        crumbs: [
          t("安装包管理", "Install packages"),
          t("安装包录入", "Install package entry"),
        ],
      };
    case "/knowledge":
      return { section: "ops", crumbs: [t("知识库", "Knowledge base")] };
    case "/link-upstream":
      return { section: "settings", crumbs: [t("链接上级", "Link upstream")] };
    case "/":
      return { section: "monitoring", crumbs: [t("Agent 总览", "Agent overview")] };
    default:
      return { section: "monitoring", crumbs: [t("未知页面", "Unknown page")] };
  }
}

/**
 * 全局状态条：跨页面常驻，回答三个运维最常问的问题
 * —— 我在哪儿、数据是不是在自动刷新、上一次成功同步是什么时候。
 */
/**
 * 「多久以前同步的」：粗粒度、像一句话（`刚刚` / `12 秒前` / `2 分钟前` / `1 小时前`）。
 *
 * 用相对时间而不是绝对时钟：状态胶囊要回答的是「数据新不新」，不是「现在几点」。判据是**渲染期**
 * 调用的，所以 `t()` 跟着语言走（函数定义在模块级，取值在渲染期）。
 */
function freshnessLabel(ageMs: number | null): string | null {
  if (ageMs === null) return null;
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 10) return t("刚刚", "just now");
  if (seconds < 60) return t("{n} 秒前", "{n}s ago", { n: seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("{n} 分钟前", "{n}m ago", { n: minutes });
  const hours = Math.round(minutes / 60);
  return t("{n} 小时前", "{n}h ago", { n: hours });
}

export function AppStatusBar() {
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const fetching = useIsFetching();
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [hasToken, setHasToken] = useState(() => Boolean(getAdminApiToken()));
  // 界面语言：开关就放在这条常驻状态条的右上角（每页都在，不用去侧边栏找）。
  const locale = useLocale();
  // 主题：图标画的是「点下去会切到的那种」（当前深色显示太阳、浅色显示月亮），与语言开关同一套约定。
  const theme = useAppTheme();
  // 最近同步的具体时刻（tooltip / aria-label 用，跟界面语言走）。
  const lastSyncedText = lastSyncedAt
    ? new Intl.DateTimeFormat(dateLocale(), {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(new Date(lastSyncedAt))
    : null;

  // 「多久以前同步的」用**相对时间**读起来才像一句话。绝对时钟（23:16:47）摆在状态胶囊里既像钟表、
  // 又要先解释那是什么时刻 —— 改成「刚刚 / 12 秒前 / 2 分钟前」，短、且自带含义。
  // 刻度 5 秒（与轮询同频）：粗粒度的标签不需要每秒重算，也避免整条状态条每秒重渲染。
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const syncedAgoMs = lastSyncedAt === null ? null : nowTick - lastSyncedAt;

  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event?.type === "updated" && event.query.state.dataUpdatedAt) {
        setLastSyncedAt(event.query.state.dataUpdatedAt);
      }
    });
    return unsubscribe;
  }, [queryClient]);

  useEffect(() => {
    const onAuthChanged = () => setHasToken(Boolean(getAdminApiToken()));
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () =>
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);

  const route = describeRoute(pathname);
  const labels = sectionLabels();
  const syncing = fetching > 0;
  // 自动刷新是 5 秒一次：明显超过这个间隔还没更新，说明轮询卡住了（或页面被挂起），
  // 这时候「自动刷新 5s」这句话就是**假的** —— 胶囊转成琥珀色并照实说「N 分钟前」。
  const syncStale =
    hasToken && !syncing && syncedAgoMs !== null && syncedAgoMs > 30_000;

  return (
    <div className={styles.bar}>
      <nav className={styles.crumbs} aria-label={t("面包屑", "Breadcrumbs")}>
        <span className={styles.crumbRoot}>{labels[route.section]}</span>
        {route.crumbs.map((crumb, index) => (
          <span key={crumb} className={styles.crumbGroup}>
            <span className={styles.sep} aria-hidden="true">
              /
            </span>
            <span
              className={
                index === route.crumbs.length - 1
                  ? styles.crumbCurrent
                  : styles.crumb
              }
            >
              {crumb}
            </span>
          </span>
        ))}
      </nav>

      <div className={styles.right}>
        {/* 中英切换：一个按钮，标签写**点下去会切到的那种语言**（中文界面显示 `EN`，英文界面显示
            `中文`）—— 比两格分段控件省一半宽度，也不用先看清哪一格是「当前」。
            切语言会整棵树重挂载，见 src/i18n/index.ts。 */}
        <button
          type="button"
          className={styles.localeToggleButton}
          onClick={() => setAppLocale(locale === "zh" ? "en" : "zh")}
          title={
            locale === "zh"
              ? t("切换到 English", "Switch to English")
              : t("切换到中文", "Switch to Chinese")
          }
          aria-label={
            locale === "zh"
              ? t("界面语言：中文，点击切换到 English", "Interface language: Chinese, click to switch to English")
              : t("界面语言：English，点击切换到中文", "Interface language: English, click to switch to Chinese")
          }
        >
          <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
            <circle
              cx="8"
              cy="8"
              r="6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path
              d="M2 8h12M8 2c1.7 1.8 2.6 3.8 2.6 6S9.7 12.2 8 14c-1.7-1.8-2.6-3.8-2.6-6S6.3 3.8 8 2Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
            />
          </svg>
          {locale === "zh" ? "EN" : "中文"}
        </button>

        {/* 浅色 / 深色：图标是「点下去会切到的那种」（当前深色 → 太阳；当前浅色 → 月亮）。 */}
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => toggleAppTheme()}
          title={
            theme === "light"
              ? t("切换到深色主题", "Switch to dark theme")
              : t("切换到浅色主题", "Switch to light theme")
          }
          aria-label={
            theme === "light"
              ? t("当前浅色主题，点击切换到深色", "Light theme; click to switch to dark")
              : t("当前深色主题，点击切换到浅色", "Dark theme; click to switch to light")
          }
        >
          {theme === "light" ? (
            // 月亮：点它切成深色
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <path
                d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            // 太阳：点它切成浅色
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <circle
                cx="8"
                cy="8"
                r="3.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                <path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6" />
                <path d="M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1" />
              </g>
            </svg>
          )}
        </button>

        {/* 同步状态与「多久以前同步的」**合成一个胶囊**：这俩说的本来就是一件事（数据新不新鲜）。
            相对时间在前、绝对时刻进 tooltip；轮询卡住时转琥珀色照实说，不继续宣称「自动刷新 5s」。 */}
        <span
          className={
            !hasToken
              ? `${styles.pill} ${styles.pillIdle}`
              : syncStale
                ? `${styles.pill} ${styles.pillStale}`
                : `${styles.pill} ${styles.pillLive}`
          }
          title={
            hasToken
              ? t(
                  "每 5 秒自动拉取一次 Agent 与指标数据；最近同步 {at}",
                  "Agent and metric data is fetched automatically every 5 seconds; last synced {at}",
                  { at: lastSyncedText ?? "—" },
                )
              : t(
                  "未设置 Admin Token，数据不会自动拉取",
                  "No Admin Token set — data is not fetched automatically",
                )
          }
        >
          <span
            className={syncing ? styles.dotSyncing : styles.dot}
            aria-hidden="true"
          />
          {hasToken
            ? syncing
              ? t("同步中", "Syncing")
              : t("自动刷新 5s", "Auto-refresh 5s")
            : t("未授权", "Not granted")}
          {hasToken && freshnessLabel(syncedAgoMs) ? (
            <>
              <span className={styles.pillDivider} aria-hidden="true" />
              <span className={styles.pillFreshness}>
                {freshnessLabel(syncedAgoMs)}
              </span>
            </>
          ) : null}
        </span>

        <button
          type="button"
          className={`${styles.refresh} ${styles.refreshIconOnly}`}
          onClick={() => void queryClient.invalidateQueries()}
          disabled={!hasToken}
          title={t("刷新", "Refresh")}
          aria-label={t("刷新", "Refresh")}
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path
              d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5V5H10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {/* 管理令牌：会话语境的凭证，归状态条管（面板贴在它下面）。 */}
        <AdminTokenControl />
      </div>
    </div>
  );
}
