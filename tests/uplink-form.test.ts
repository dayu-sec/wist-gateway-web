import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentUplink } from "../src/api";
import {
  shouldWarnAboutTurningOnUplink,
  uplinkDraftHost,
  uplinkDraftPort,
  uplinkFormState,
} from "../src/components/uplinkForm";

// 「数据面上送地址与开关」表单的**决策测试**。
//
// 为什么单独有这么一份：本仓没有组件渲染环境（无 jsdom），表单里那几条判断如果不抽成纯函数
// 就只能靠人眼 review —— 而它们每一条都对应一个**已经写错过**的点：
//   1. 没改动也能提交 → 在派生值上按一下「保存」就把地址从「来自部署配置」静默变成
//      「管理面录入的」（`updated_at` 从 null 写成 now），而实际什么都没改；
//   2. 保存成功后重取到位之前，「全队动作」警告与成功提示同时出现，读起来像又改了一次；
//   3. 输入非法时只有「保存」灰着，**没有任何可见原因**，人只能猜。
// 参考范式：`tests/rollout-contract.test.ts`（`tsx` 跑的纯 node 脚本，失败即非零退出）。

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

function check(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

/** 一份「管理面录入过、开关关着」的设置（最常被编辑的形状）。 */
function savedSetting(overrides: Partial<AgentUplink> = {}): AgentUplink {
  return {
    settingId: "default",
    host: "10.0.1.9",
    port: 9100,
    enabled: false,
    enabledConfigured: true,
    updatedBy: "ops",
    updatedAt: "2026-09-26T00:00:00+00:00",
    ...overrides,
  };
}

// ── ① 没改动就不许提交（防「静默捕获派生值」）────────────────────────────────
{
  const setting = savedSetting();
  const untouched = uplinkFormState(
    setting,
    { host: setting.host, port: String(setting.port), enabled: setting.enabled },
    false,
  );
  check(!untouched.dirty, "没改动就不该算 dirty");
  check(
    !untouched.canSubmit,
    "没改动必须不能提交 —— 否则派生值会被静默「捕获」成管理面录入的",
  );
  check(untouched.validationError === null, "合法输入不该报校验错");

  // 只改开关、不改地址也要算改动（开关是同一行设置里的另一半）。
  const switchOnly = uplinkFormState(
    setting,
    { host: setting.host, port: String(setting.port), enabled: true },
    false,
  );
  check(switchOnly.dirty && switchOnly.canSubmit, "只改开关也要能提交");

  // 前后空白不算改动：提交前会被裁掉，用户看不出来的差异不该解锁「保存」。
  const padded = uplinkFormState(
    setting,
    { host: `  ${setting.host}  `, port: ` ${setting.port} `, enabled: setting.enabled },
    false,
  );
  check(!padded.dirty, "只多了空白不算改动");

  // 派生值（host 由部署配置派生、updated_at 为 null）同样按「没改动不许存」处理。
  const derived = savedSetting({
    updatedAt: null,
    enabledConfigured: false,
    updatedBy: "",
    enabled: false,
  });
  const derivedUntouched = uplinkFormState(
    derived,
    { host: derived.host, port: String(derived.port), enabled: derived.enabled },
    false,
  );
  check(
    !derivedUntouched.canSubmit,
    "派生值上「保存」必须也是灰的：按一下就会把它变成管理面录入的",
  );
}

// ── ② 校验文案必须可见、且与网关同口径 ─────────────────────────────────────
{
  const setting = savedSetting();
  const cases: Array<{ draft: Parameters<typeof uplinkFormState>[1]; message: string }> = [
    {
      draft: { host: "   ", port: "9100", enabled: false },
      message: "主机不能为空。",
    },
    {
      draft: { host: "10.0.1.9", port: "0", enabled: false },
      message: "端口必须是 1–65535 的整数。",
    },
    {
      draft: { host: "10.0.1.9", port: "70000", enabled: false },
      message: "端口必须是 1–65535 的整数。",
    },
    {
      // 中间态：端口先清空再输入时不该立刻骂人（空串不报错，但不能提交）。
      draft: { host: "10.0.1.9", port: "", enabled: false },
      message: "端口必须是 1–65535 的整数。",
    },
    {
      draft: { host: "10.0.1.9", port: "9a", enabled: false },
      message: "端口必须是 1–65535 的整数。",
    },
  ];
  for (const { draft, message } of cases) {
    const state = uplinkFormState(setting, draft, false);
    check(!state.canSubmit, `非法输入必须不能提交：${JSON.stringify(draft)}`);
    const expected =
      draft.port === ""
        ? null // 空端口是输入中间态：不给可见错误，但依然不能提交。
        : message;
    check(
      state.validationError === expected,
      `校验文案不对：${JSON.stringify(draft)} → ${String(state.validationError)}（期望 ${String(expected)}）`,
    );
  }

  // 空端口只靠「保存灰着」表达（不报错），但它确实不该放行。
  const emptyPort = uplinkFormState(setting, { host: "10.0.1.9", port: "", enabled: false }, false);
  check(!emptyPort.portOk && !emptyPort.canSubmit, "空端口不能提交");
}

// ── ③ 提交中不许重复提交 ────────────────────────────────────────────────────
{
  const setting = savedSetting();
  const pending = uplinkFormState(
    setting,
    { host: "10.0.1.10", port: "9200", enabled: false },
    true,
  );
  check(pending.canSubmit === false, "保存中必须不能再提交");
}

// ── ④ 「全队动作」警告的时机 ────────────────────────────────────────────────
{
  const setting = savedSetting({ enabled: false });
  check(
    shouldWarnAboutTurningOnUplink(setting, { host: setting.host, port: String(setting.port), enabled: true }, false),
    "从关到开必须警告（这是全队动作）",
  );
  check(
    !shouldWarnAboutTurningOnUplink(setting, { host: setting.host, port: String(setting.port), enabled: true }, true),
    "刚保存成功后不该再警告：重取到位前它会与成功提示同时出现，读起来像又改了一次",
  );
  check(
    !shouldWarnAboutTurningOnUplink(setting, { host: setting.host, port: String(setting.port), enabled: false }, false),
    "没打算打开就不该警告",
  );
  check(
    !shouldWarnAboutTurningOnUplink(
      savedSetting({ enabled: true }),
      { host: "10.0.1.9", port: "9100", enabled: true },
      false,
    ),
    "本来就是开的（只是改了地址）不该警告",
  );
}

// ── ⑤ 提交体：裁空白 / 端口是数字 ───────────────────────────────────────────
{
  const draft = { host: "  10.0.1.9  ", port: " 9200 ", enabled: false };
  check(uplinkDraftHost(draft) === "10.0.1.9", "主机要裁掉两端空白");
  check(uplinkDraftPort(draft) === 9200, "端口要以数字提交");
  check(typeof uplinkDraftPort(draft) === "number", "端口必须是 number");
}

// ── ⑥ 源码守卫：两条渲染层行为（本仓没有 jsdom，只能守卫源码）────────────────
{
  const page = read("src/components/SubsystemGatewayInfoPage.tsx");
  // 把换行/缩进压平再匹配：守卫要卡的是**结构**，不是某一行的排版。
  const compactPage = page.replace(/\s+/g, " ");
  // 「数据还没取到就不下结论」：卡片顶部那两行（当前地址 / 开关）必须先看这个门。
  // 回归形态：`uplink.data?.enabled ? … : "未打开…"` —— 读取中会先闪一句假状态。
  // 只查「文件里出现过 uplinkKnown」不够：开关那行还在，门拆了也查不出来（已验证）。
  check(
    compactPage.includes("!uplinkKnown ?"),
    "当前地址那行缺少「数据未取到就不下结论」的门（读取中会闪「未设置」）",
  );
  check(
    compactPage.indexOf("!uplinkKnown ?") <
      compactPage.indexOf("未设置（还没有上送目标）"),
    "空态文案必须在那道门之后，否则读取中就会显示「未设置」",
  );

  // 保存**失败**也要刷新：失败不等于没生效（服务端可能已写、只是响应没回来或解析报错），
  // 不刷的话只读卡会一直是旧值，而人以为没改成 —— 开关是个影响全队的动作。
  const hooks = read("src/hooks/index.ts");
  const setUplinkBlock = hooks.slice(
    hooks.indexOf("export function useSetAgentUplink"),
    hooks.indexOf("export function useAgentAdvertiseUrl"),
  );
  check(setUplinkBlock.length > 0, "找不到 useSetAgentUplink");
  check(
    setUplinkBlock.includes("onError"),
    "useSetAgentUplink 少了 onError 刷新：保存失败时页面会与真实状态不一致",
  );
}

console.log("agent uplink form test passed");
