import {
  clearAdminApiToken,
  getAdminApiToken,
  seedDevAdminToken,
} from "../src/api";

// 「页面什么也没有显示」的根因回归。
//
// 所有管理查询都以 `getAdminApiToken()` 作为 `enabled`：浏览器没手填 token（sessionStorage
// 关标签即清）时，查询**压根不发**，页面整块空白 —— dev 代理虽会自动补 `Authorization`，
// 请求不发也白搭。修法：启动时把 vite 注入的 dev token 播种上。本测试钉住播种的四条语义。
//
// 本仓无 jsdom：`setAdminApiToken` 在 node 下只改模块级状态（不碰 sessionStorage），
// 因此可用「清空 → 播种 → 断言」直接验。

function check(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

// ① dev + 有 devToken + 当前无 token → 种上（页面得以发请求）。
clearAdminApiToken();
seedDevAdminToken("dev-token-abc", true);
check(
  getAdminApiToken() === "dev-token-abc",
  "dev 下应把注入的 token 种上，否则管理查询 enabled=false、页面空白",
);

// ② 已手填的优先：不覆盖（人填的 token 才是准的）。
seedDevAdminToken("another-token", true);
check(
  getAdminApiToken() === "dev-token-abc",
  "已有 token 时不该被 dev 播种覆盖",
);

// ③ 非 dev（生产构建）→ no-op。
clearAdminApiToken();
seedDevAdminToken("dev-token-abc", false);
check(getAdminApiToken() === null, "非 dev 环境不该播种（生产靠人手填）");

// ④ dev 但没取到 devToken（没配到 toml）→ no-op：不制造未鉴权的请求（会触发限流）。
//    （若这里种了空串/回车，enabled 仍为 false，但语义要挡住。）
seedDevAdminToken("", true);
check(
  getAdminApiToken() === null,
  "没有 devToken 时不该播种 —— 免得发未鉴权请求撞限流",
);

console.log("gateway dev admin token test passed");
