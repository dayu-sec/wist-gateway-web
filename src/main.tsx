import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { seedDevAdminToken } from "./api";
import "./index.css";

// 仅 dev：把 vite 注入的开发态 admin token 种上，页面一打开就能看到管理数据（已手填的优先）。
// 生产构建里 __DEV_ADMIN_TOKEN__ 为空串、import.meta.env.DEV 为 false → no-op。
seedDevAdminToken(window.__DEV_ADMIN_TOKEN__ ?? "", import.meta.env.DEV);

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
