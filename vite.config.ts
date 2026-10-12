import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /api 代理目标用 WARP_INSIGHT_WEB_PROXY_TARGET 覆盖（默认网关本机 API https://localhost:3000）。
//
// **不做任何 admin token 注入**：管理 token 是机密，由使用者在管理页面手填（存浏览器
// sessionStorage，请求时作为 Bearer 发出）。前端与 dev server 都不碰任何后端 secret 来源
// —— 读网关 home 的 `wist-gateway.toml`、读 env 抠 token、把 token 注入页面（`__DEV_ADMIN_TOKEN__`）
// 这类全去掉：既越界（前端不该依赖后端配置路径/格式），又容易出「发错 token → 401 → 限流」。

// 前端版本号（`import.meta.env.VITE_APP_VERSION`）在**运行态**由 Docker 构建注入
// （`build-arg APP_VERSION=<发布 tag>` → `ENV VITE_APP_VERSION`，见 Dockerfile / release.yml）。
// **dev server 不注入它**，页面左下角那行会显示 `—`。这里在缺该环境变量时，用仓库根 `version.txt`
// 补上：dev 与本地 `npm run build` 都能看到版本号；运行态仍以 APP_VERSION 为准（它优先）。
// 想临时覆盖：`VITE_APP_VERSION=x.y.z npm run dev`。
if (!process.env.VITE_APP_VERSION) {
  try {
    process.env.VITE_APP_VERSION =
      readFileSync(resolve(process.cwd(), "version.txt"), "utf8").trim() || "dev";
  } catch {
    process.env.VITE_APP_VERSION = "dev";
  }
}

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: process.env.WARP_INSIGHT_WEB_PROXY_TARGET ?? "https://localhost:3000",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
