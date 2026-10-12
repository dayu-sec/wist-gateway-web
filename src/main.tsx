import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { initLocale, useLocale } from "./i18n";
import "./index.css";

const queryClient = new QueryClient();

// 启动即把存储的语言偏好装进本 app 与共享口径（`@dayu-sec/wist-web-core`）。
initLocale();

/**
 * 语言变化时**整棵树重挂载**（`<App key={locale} />`）：任何组件里的 `t()` 都会在新语言下重新
 * 求值 —— 不必给每个组件挂订阅。代价是页面内局部状态（筛选、展开的面板）重置；数据在 React Query
 * 缓存里，不会重新拉。取舍见 `src/i18n/index.ts`。
 */
function Root() {
  const locale = useLocale();
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App key={locale} />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
