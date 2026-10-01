import { ApiError } from "../api";

/**
 * 管理接口**读取失败** → 给运维的一句话。
 *
 * 为什么要有这个模块：Agent 总览 / 主机指标 / 安装 Agent 这三个页面以前各自把"取数失败"
 * 一律说成「请确认 warp-insight-admin 已启动」—— 而服务端**已经返回了能照着做的正文**
 * （例如「没有可用的 agent 安装包：… 到「安装包」页看一眼」）。把正文丢掉，等于让运维去查一个
 * 根本不存在的问题：2026-10-01 真踩到一次 —— 装 Agent 报"请确认服务已启动"，实际是管理面
 * 没录入安装包。
 *
 * 单独成模块而不是塞进组件：本仓没有组件渲染测试环境（无 jsdom），页面逻辑只能靠
 * **纯函数 + 契约测试**钉住（同 `knowledgeContent.ts` / `agentWorkStatus.ts` 的做法）。
 */
export function adminApiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "Admin Token 缺失或无效：请在 Admin Token 输入框里填入正确的令牌并点“应用”。";
    }
    if (error.status === 404) {
      return "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。";
    }
    // 服务端正文优先：它才是**能照着做**的那一句（比任何通用提示都准）。
    const detail = unwrapDetail(error.detail);
    if (detail) return `网关返回 HTTP ${error.status}：${detail}`;
    if (error.status >= 500) {
      return (
        `网关没有应答（HTTP ${error.status}，响应体为空）—— 请求很可能根本没到网关：` +
        "先确认网关在跑，再看前端 dev 代理（WARP_INSIGHT_WEB_PROXY_TARGET）指的地址有没有服务监听。"
      );
    }
    return `网关返回 HTTP ${error.status}，请检查网关日志。`;
  }
  return "读取失败：响应不符合当前契约，请检查网关与前端版本。";
}

/**
 * 正文可能被包成 `{"code":…,"message":…}`（管理面的错误体）：解得出 `message` 就用它，
 * 免得页面上摊一坨 JSON。解不出（纯文本，或截断了的 JSON）就照原样用。
 */
function unwrapDetail(detail: string | undefined): string | null {
  if (!detail) return null;
  const text = detail.trim();
  if (!text) return null;
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as { message?: unknown };
      const message = parsed.message;
      if (typeof message === "string" && message.trim()) return message.trim();
    } catch {
      // 不是完整 JSON（`ApiError.detail` 会截断到 300 字符）：按纯文本处理。
    }
  }
  return text;
}
