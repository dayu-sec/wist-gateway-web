import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /api 代理目标用 WARP_INSIGHT_WEB_PROXY_TARGET 覆盖（默认网关本机 API https://localhost:3000）。

/**
 * 仅 dev：从网关 home 的 `wist-gateway.toml` 读 `admin_api_token`。
 *
 * 页面「链接上级」的接入状态查询（以及其余管理接口）都要求 Bearer；浏览器没手填 token 时
 * 查询直接 `enabled=false`，**状态区整块不渲染**（看着像“没结果”，其实是从没查）。dev 代理
 * 在读到时自动补 `Authorization`，页面一打开就能看到真实状态；token 不进前端包。
 * 路径可用 `WIST_GATEWAY_CONFIG` 覆盖；默认指向同工作区的 gateway-stack 开发态 home。
 */
function devAdminToken(): string {
  const path =
    process.env.WIST_GATEWAY_CONFIG ??
    resolve(
      process.cwd(),
      "../wist-gateway-stack/dev/configs/gateway/wist-gateway.toml",
    );
  try {
    const match = readFileSync(path, "utf8").match(
      /^\s*admin_api_token\s*=\s*"([^"]*)"/m,
    );
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

export default defineConfig(({ command }) => {
  const devToken = command === "serve" ? devAdminToken() : "";
  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": {
          target:
            process.env.WARP_INSIGHT_WEB_PROXY_TARGET ??
            "https://localhost:3000",
          changeOrigin: true,
          secure: false,
          // 仅在请求没带 Authorization 时补；已手填的优先（不覆盖）。
          configure: (proxy) => {
            if (!devToken) return;
            proxy.on("proxyReq", (proxyReq) => {
              if (!proxyReq.getHeader("authorization")) {
                proxyReq.setHeader("authorization", `Bearer ${devToken}`);
              }
            });
          },
        },
      },
    },
  };
});
