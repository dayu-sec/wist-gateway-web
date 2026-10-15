/**
 * 安装页的两种用途，以及它们在 URL 上的表达（`/install?mode=reinstall`）。
 *
 * 为什么走 URL 而不是组件内状态：身份面板在证书过期时要把运维**直接送到**「重装（替换证书）」
 * 模式（见 `SubsystemAgentIdentityPanel` 的链接）。这条链接载着"意图"——落到 URL 上才对：
 * 刷新、转发给同事、收藏都还是同一个模式。只放在路由 state 里，刷新就丢了，会静默落回
 * 「首次安装」模式；而那个模式生成的命令**不会替换证书**（已注册的机器注册会被跳过）。
 *
 * 解析与生成放同一处：链接目标与解析口径一旦分家，就会出现"点过去还是默认模式"这种
 * 只看代码看不出来的漂移。
 */

export type InstallMode = "install" | "reinstall";

/** URL 参数名与取值：`/install?mode=reinstall`。 */
export const INSTALL_MODE_PARAM = "mode";
export const REINSTALL_MODE: InstallMode = "reinstall";

/** 从 URL 参数读用途；没带 / 认不出 → 「首次安装」（默认态，不猜别的）。 */
export function readInstallMode(params: URLSearchParams): InstallMode {
  return params.get(INSTALL_MODE_PARAM) === REINSTALL_MODE ? REINSTALL_MODE : "install";
}

/** 把用途写回 URL 参数：「首次安装」是默认态，不占参数（其余参数原样保留）。 */
export function writeInstallMode(
  params: URLSearchParams,
  mode: InstallMode,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (mode === REINSTALL_MODE) next.set(INSTALL_MODE_PARAM, REINSTALL_MODE);
  else next.delete(INSTALL_MODE_PARAM);
  return next;
}

/** 深链目标：安装页 + 预选「重装（替换证书）」。 */
export const REINSTALL_PAGE_PATH = `/install?${INSTALL_MODE_PARAM}=${REINSTALL_MODE}`;
