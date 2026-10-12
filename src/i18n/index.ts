import { useSyncExternalStore } from "react";
import {
  getLocale,
  pickTemplate,
  setLocale as setCoreLocale,
  type Locale,
} from "@dayu-sec/wist-web-core/i18n";

/**
 * 本 app 的界面语言（zh 源语言 / en 英文）。
 *
 * 分工：
 * - **共享口径**（计划 / 阶段 / 条目状态、闸门与筛选文案…）的取词在 `@dayu-sec/wist-web-core` 的
 *   `i18n` 里，`setCoreLocale` 一调，那些 `xxxLabel()` 全跟着变 —— 这里只负责**应用层**的事：
 *   持久化、`<html lang>` / 标题、以及**通知 React 重渲染**。
 * - 本模块是共享包那次 `setLocale` 的**唯一调用点**：别在别处再调一次，否则两处状态会打架。
 *
 * 组件怎么写文案（约定，全站统一）：
 * ```tsx
 * import { t } from "../i18n";
 * <span>{t("已接入", "Enrolled")}</span>
 * <span>{t("已选 {n} 台", "{n} selected", { n: 3 })}</span>
 * ```
 * **中文原文写在第一个参数上**：它既是中文界面的文案，也是这段文案的「身份」—— 不另立 key 表，
 * 免得文案一改就要同步两张表。
 *
 * ⚠️ `t()` 必须在**渲染期**求值（组件体内、JSX 里、或渲染期调用的函数里）。
 * 模块顶层的常量对象里**不要**放 `t(...)`：那只会求值一次，切语言时不会变 ——
 * 这类表要么写成函数（渲染期调用），要么挪进组件。
 *
 * 切语言会**整棵树重挂载**（`main.tsx` 里 `<App key={locale} />`）：这样任何组件里的 `t()`
 * 都会在新语言下重新求值，不必给每个组件都挂一个订阅。代价是页面内的局部状态（筛选、展开的
 * 面板）会重置 —— 数据在 React Query 缓存里，不会重新拉。
 */

const STORAGE_KEY = "wistGatewayWeb.locale";

const listeners = new Set<() => void>();

/** 当前语言（模块级）：`t()` 与订阅者都读它。初始 zh；`initLocale()` 会按存储值设一次。 */
let current: Locale = getLocale();

/** 读存储的偏好；没有 / 读不出 → `zh`（默认中文，与切换功能的引入前一致）。 */
function readStored(): Locale {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
}

function apply(next: Locale, persist: boolean): void {
  current = setCoreLocale(next);
  if (persist) {
    try {
      window.localStorage.setItem(STORAGE_KEY, current);
    } catch {
      // 隐私模式 / 存储被禁：语言本次会话内仍然生效，只是记不住。
    }
  }
  document.documentElement.lang = current === "en" ? "en" : "zh-CN";
  document.title = pickTemplate(
    "WarpGateway · 主机与 Agent 管理台",
    "WarpGateway · Host & Agent Console",
  );
  listeners.forEach((notify) => notify());
}

/** 启动时调一次（`main.tsx`）：把存储的语言装进共享包与本模块。 */
export function initLocale(): void {
  apply(readStored(), false);
}

/** 切换语言（右侧那颗 中文 / EN 开关调它）。 */
export function setAppLocale(next: Locale): void {
  apply(next, true);
}

/** 当前语言；组件订阅它（切语言时重渲染）。 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, () => current, () => current);
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/**
 * 取词：`zh` 是中文原文（也是这段文案的身份），`en` 是英文；`params` 填 `{name}` 占位符。
 * 当前语言由共享包的 `getLocale()` 决定（本模块已保证它与 `current` 一致）。
 */
export function t(
  zh: string,
  en: string,
  params?: Record<string, string | number>,
): string {
  return pickTemplate(zh, en, params);
}

/**
 * `Intl` / `toLocaleString` 用的语言标签：**日期时间也跟界面语言走**。
 *
 * 界面是英文时还按 `zh-CN` 格式化日期，会得到 `2026/10/11 09:47:32` 这种中式写法 —— 能读，
 * 但不是英文界面的习惯（`en-US` 是 `10/11/2026, 09:47:32`）。写法：
 * `at.toLocaleString(dateLocale(), { hour12: false })`。
 */
export function dateLocale(): string {
  return current === "en" ? "en-US" : "zh-CN";
}
