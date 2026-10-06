// 把 version.txt 的版本写进 package.json。
// 用法：node _gal/sync_version.mjs <package.json 路径> <版本>
//
// 为什么不直接 `ver.syn_file`（`#@gxl:set(version)` 标记）：package.json 是严格 JSON，
// 注释会让 npm / Vite 解析失败（`gx.patch_file` 的 set 要求标记就落在被改那一行上）。
// 所以这里走 JSON 安全写入：解析 → 改 version → 按 2 空格缩进回写。
import { readFileSync, writeFileSync } from "node:fs";

const [, , pkgPath, version] = process.argv;
if (!pkgPath || !version) {
  console.error("usage: node _gal/sync_version.mjs <package.json> <version>");
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
if (pkg.version === version) process.exit(0);
pkg.version = version;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
