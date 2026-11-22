/**
 * agentd 版本 → 能不能执行响应计划。
 *
 * 为什么这件事要单独一个纯函数：它决定**按钮是否可点**。判错一次就会把一台能跑的机器
 * 挡住（或者让一台永远不执行的机器照常下发，页面只能一直等）。抽出来之后
 * `tests/agentd-version.test.ts` 用现有 `tsx` 就能锁住边界。
 */

/**
 * 认识 `kind = action_plan` 的最低 agentd 版本。
 *
 * 执行器内核 + 本地终审（`exec/plan_review.rs`）在 **0.37.0** 引入；更老的 agentd
 * **不认识这条命令**，会静默忽略 —— 计划照常入队、能力闸也可能放行（库里那份
 * `exec_capabilities` 可能是更早某个新版本写下的，旧心跳不会擦掉它），
 * 于是页面只能一直等。
 */
export const MIN_EXEC_AGENTD = "0.37.0";

/** `v0.37.1` / `0.37.1-beta` / `0.37` → `[0,37,1]`；解析不了返回 `null`。 */
export function parseVersion(value: string): [number, number, number] | null {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(value ?? "");
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

/** 语义化版本的「至少」比较（只比前三位，预发布后缀不参与）。 */
export function versionAtLeast(value: string, minimum: string): boolean {
  const have = parseVersion(value);
  const want = parseVersion(minimum);
  if (!have || !want) return false;
  for (let i = 0; i < 3; i += 1) {
    if (have[i] !== want[i]) return have[i] > want[i];
  }
  return true;
}

export type ExecGate =
  /** 版本够，可以发起。 */
  | "ok"
  /** 版本太旧：挡住（计划永远不会被执行）。 */
  | "old"
  /** 读不到版本：不挡，但要提示排查路径。 */
  | "unknown";

/**
 * 版本闸。
 *
 * 「读不到版本」**不挡**：注册表里 version 可能是空串（刚注册 / 旧上报），
 * 挡掉会让一台其实能跑的机器不能用；提示比静默拒绝好。
 */
export function execGate(agentVersion: string): ExecGate {
  if (parseVersion(agentVersion) === null) return "unknown";
  return versionAtLeast(agentVersion, MIN_EXEC_AGENTD) ? "ok" : "old";
}
