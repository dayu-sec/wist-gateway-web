/**
 * 安装 / 重装命令的拼装（三个平台的命令组件共用）。
 *
 * 页面把一次性 token 与命令**分开**展示（token 单独一张卡），所以这里按用途拼两份：
 * 展示用的（不含 token）与可复制的（可含 token）。
 *
 * 重装模式（`WIST_AGENTD_REINSTALL=1`）必须写在命令行里：install.sh 读到它才会走「替换本机
 * 客户端证书」那条路（先停旧服务 → `enroll --force` 换新证书 → 重建服务）。install.sh 是被
 * `sh` 当子进程起来的，所以只能靠**导出的环境变量**传进去 —— 它得排在命令前面。
 */

/** 一次性 token 的环境变量行：网关生成的安装命令导出的是旧命名 `WARP_INSIGHT_...`。 */
export function enrollmentTokenEnvLine(token: string): string {
  return `export WARP_INSIGHT_ENROLLMENT_TOKEN=${token}`;
}

/** 重装标记：install.sh 见到它就替换本机客户端证书，而不是只重跑一遍安装。 */
export const REINSTALL_ENV_LINE = "export WIST_AGENTD_REINSTALL=1";

/**
 * 展示用命令：重装模式下把重装标记一并显出来 —— 否则用户看不出这条命令会替换证书
 * （非重装模式返回原命令，与引入本模块前逐字节一致）。
 */
export function displayInstallCommand(
  command?: string,
  reinstall?: boolean,
): string | undefined {
  if (!command || !reinstall) return command;
  return `${REINSTALL_ENV_LINE}\n${command}`;
}

/**
 * 可复制命令：给了 token 就拼上 token 行。
 *
 * 重装标记在**两份**里都要出现 —— 只带 token 的那份（页面另给了「复制 Token」）同样要能替换
 * 证书，否则用户粘过去只会静默地做一次普通安装。
 */
export function copyableInstallCommand(
  command?: string,
  token?: string,
  reinstall?: boolean,
): string | undefined {
  const body = displayInstallCommand(command, reinstall);
  if (!body || !token) return body;
  return `${enrollmentTokenEnvLine(token)}\n${body}`;
}
