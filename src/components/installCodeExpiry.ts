/**
 * 批量安装码的倒计时计算（纯函数：组件与契约测试共用一份口径）。
 *
 * 返回值：
 * - `undefined`：没有到期时间，或字符串不是可解析的时间 —— 页面显示「以网关为准」，
 *   **不要**自己按常量编一个窗口（真实有效期由网关的 `bootstrap_bundle.expires_at` 决定）；
 * - `>= 0`：剩余整秒（向上取整：还剩 0.4s 也算 1s）；`0` 表示已过期，不出现负数。
 */
export function remainingSeconds(
  expiresAt: string | undefined,
  now: number = Date.now(),
): number | undefined {
  if (!expiresAt) return undefined;
  const deadline = Date.parse(expiresAt);
  if (Number.isNaN(deadline)) return undefined;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
