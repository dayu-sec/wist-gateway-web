import { useEffect, useState } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { matchPath, useLocation } from "react-router-dom";
import { ADMIN_AUTH_CHANGED_EVENT, getAdminApiToken } from "../api";
import { dateLocale, setAppLocale, t, useLocale } from "../i18n";
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
    case "/install":
      return { section: "settings", crumbs: [t("安装 Agent", "Install agent")] };
    case "/gateway-info":
      return { section: "settings", crumbs: [t("Gateway 信息", "Gateway info")] };
    case "/install-package":
      return { section: "settings", crumbs: [t("安装包管理", "Install packages")] };
    case "/install-package/add":
      return {
        section: "settings",
        crumbs: [
          t("安装包管理", "Install packages"),
          t("安装包录入", "Install package entry"),
        ],
      };
    case "/knowledge":
      return { section: "settings", crumbs: [t("知识库", "Knowledge base")] };
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
export function AppStatusBar() {
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const fetching = useIsFetching();
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [hasToken, setHasToken] = useState(() => Boolean(getAdminApiToken()));
  // 界面语言：开关就放在这条常驻状态条的右上角（每页都在，不用去侧边栏找）。
  const locale = useLocale();

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
        {/* 中英切换：右上角（常驻、每页可见）。切语言会整棵树重挂载，见 src/i18n/index.ts。 */}
        <div
          className={styles.localeToggle}
          role="group"
          aria-label={t("界面语言", "Interface language")}
        >
          <button
            type="button"
            className={
              locale === "zh"
                ? `${styles.localeButton} ${styles.localeButtonActive}`
                : styles.localeButton
            }
            aria-pressed={locale === "zh"}
            onClick={() => setAppLocale("zh")}
          >
            中文
          </button>
          <button
            type="button"
            className={
              locale === "en"
                ? `${styles.localeButton} ${styles.localeButtonActive}`
                : styles.localeButton
            }
            aria-pressed={locale === "en"}
            onClick={() => setAppLocale("en")}
          >
            English
          </button>
        </div>

        <span
          className={
            hasToken
              ? `${styles.pill} ${styles.pillLive}`
              : `${styles.pill} ${styles.pillIdle}`
          }
          title={
            hasToken
              ? t(
                  "每 5 秒自动拉取一次 Agent 与指标数据",
                  "Agent and metric data is fetched automatically every 5 seconds",
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
        </span>

        <span className={styles.stamp}>
          {t("最近同步", "Last synced")}
          <strong className={styles.stampValue}>
            {lastSyncedAt
              ? new Intl.DateTimeFormat(dateLocale(), {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: false,
                }).format(new Date(lastSyncedAt))
              : "—"}
          </strong>
        </span>

        <button
          type="button"
          className={styles.refresh}
          onClick={() => void queryClient.invalidateQueries()}
          disabled={!hasToken}
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
          {t("刷新", "Refresh")}
        </button>
      </div>
    </div>
  );
}
