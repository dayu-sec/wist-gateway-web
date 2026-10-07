import { isValidSha256, sha256Error } from "../src/sha256";

// 契约测试：「期望摘要 sha256」的形态校验。
//
// 页面把摘要按**必填**拦（安装包 / 知识库包 / 中心发布都走同一形态口径），这里钉住：
//   1. 合法形态：64 位十六进制，大小写不限、可带 `sha256:` 前缀、两侧空白容忍；
//   2. 非法形态：空 / 短 / 长 / 非十六进制 / 只有前缀 一律拒；
//   3. 文案：空 → 说「必填」；形态错 → 说「必须 64 位十六进制」。

function check(cond: boolean, message: string) {
  if (!cond) throw new Error(message);
}

const HEX = "3f9a1c0d".repeat(8); // 64 位十六进制

check(isValidSha256(HEX), "64 位小写十六进制必须合法");
check(isValidSha256(HEX.toUpperCase()), "大写也应接受");
check(isValidSha256(`sha256:${HEX}`), "可带 sha256: 前缀");
check(isValidSha256(`SHA256:${HEX}`), "前缀大小写不敏感");
check(isValidSha256(`  sha256: ${HEX}  `), "两侧空白与前缀后空白应容忍");

for (const bad of [
  "",
  "   ",
  "deadbeef",
  HEX.slice(0, 63),
  `${HEX}0`,
  "zz".repeat(32),
  "sha256:",
]) {
  check(!isValidSha256(bad), `应拒绝非法摘要：${JSON.stringify(bad)}`);
}

check(
  sha256Error("") ===
    "期望摘要必填：填发布侧 *.sha256 里那串 64 位十六进制（可带 sha256: 前缀）。",
  "空值必须报「必填」，而不是笼统的形态错",
);
check(sha256Error(HEX) === null, "合法值应返回 null（不拦提交）");
check(
  (sha256Error("deadbeef") ?? "").includes("64 位十六进制"),
  "形态错误文案应点明「64 位十六进制」",
);

console.log("sha256 form validation test passed");
