import { useSyncExternalStore } from "react";

/**
 * 主题（浅色 / 深色）—— 与 `src/i18n/index.ts` 同一套写法：模块持有唯一状态，组件用
 * `useAppTheme()` 订阅；具体颜色全在 `src/index.css` 的两套 token 里，这里只管「当前用哪套」。
 *
 * 三条约定：
 * 1. **落点是 `<html data-theme>`**：CSS 侧 `:root[data-theme="light"]` 覆盖配色，顺带把
 *    `color-scheme` 也切了（原生下拉、滚动条、日期选择器跟着走）；深色是默认值，不写 data-theme。
 * 2. **首次进入跟随系统**（`prefers-color-scheme`）；用户点过开关之后就以**用户的选择**为准，
 *    不再跟着系统变 —— 否则「我选了浅色，系统一入夜就被改回深色」会很难查。
 * 3. 选择存 `localStorage`（键 `wistGatewayWeb.theme`），与本 app 其它偏好一致。
 *
 * 与语言不同的地方：**切主题不需要重挂载组件树**。颜色走 CSS 变量，改一个 attribute 全站即变；
 * 只有需要重画的东西（画布里读到的颜色）才需要订阅，所以 `useAppTheme()` 是给「开关按钮」和图表用的。
 */

export type AppTheme = "light" | "dark";

/** localStorage 键：与语言开关的命名风格一致。 */
const STORAGE_KEY = "wistGatewayWeb.theme";

const LIGHT_QUERY = "(prefers-color-scheme: light)";

/** 深色是默认值（与 `:root` 的默认配色一致）。 */
let current: AppTheme = "dark";
let initialized = false;
const listeners = new Set<() => void>();

function systemTheme(): AppTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia(LIGHT_QUERY).matches ? "light" : "dark";
}

function readStored(): AppTheme | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === "light" || raw === "dark" ? raw : null;
  } catch {
    // 隐私模式 / 存储被禁：当作「没选过」，跟随系统即可，不抛。
    return null;
  }
}

/** 把主题落到 `<html>`、`<meta name="theme-color">`，并通知订阅者。 */
function apply(theme: AppTheme, notify: boolean): void {
  current = theme;
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    if (theme === "light") {
      root.dataset.theme = "light";
    } else {
      // 深色是默认：删掉属性而不是写 "dark"，这样默认态与「从没设置过」完全一致。
      delete root.dataset.theme;
    }
    // 移动端地址栏 / 状态栏的底色：跟着主题走，否则浅色页面顶上会挂一条深色。
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", theme === "light" ? "#f5f7fb" : "#101a2e");
    }
  }
  if (notify) {
    for (const listener of listeners) listener();
  }
}

/**
 * 启动时调用一次（`main.tsx`，早于渲染）：定下初始主题。
 * 之后系统偏好变化**只在用户还没自己选过**时被采纳。
 */
export function initTheme(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const stored = readStored();
  apply(stored ?? systemTheme(), false);

  if (!stored && window.matchMedia) {
    const query = window.matchMedia(LIGHT_QUERY);
    // 只跟到用户第一次动手为止：setAppTheme 之后不再采纳系统变化。
    query.addEventListener?.("change", () => {
      if (readStored() === null) apply(systemTheme(), true);
    });
  }
}

/** 当前主题（渲染期调用；`useAppTheme()` 是它的订阅版）。 */
export function getAppTheme(): AppTheme {
  return current;
}

/** 切换/设置主题：写存储 + 立刻生效 + 通知订阅者。 */
export function setAppTheme(next: AppTheme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 存不下也要在当前会话生效（只影响下次进入的默认值）。
  }
  apply(next, true);
}

/** 反转当前主题（给开关按钮用）。 */
export function toggleAppTheme(): void {
  setAppTheme(current === "light" ? "dark" : "light");
}

/** 订阅主题：任何组件都能拿到「现在是浅色还是深色」。 */
export function useAppTheme(): AppTheme {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => current,
  );
}
