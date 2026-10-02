import { factSummaryExport } from "../src/components/agentPurposeExport";
import type { AgentFactSummary } from "../src/types";

// 契约测试：事实摘要页「复制 JSON」粘出去的载荷。
//
// 锁住四件容易漂移的事：
//   1. 是**合法 JSON**（粘到别处能被解析），不是给人看的渲染文本；
//   2. 字段名与后端 `fact_summary` / 库表列同形（snake_case），而不是视图模型的 camelCase；
//   3. 那几个 JSON 数组列（进程清单 / 包 / 端口 / 网卡）原样是**数组**，不被压成字符串；
//   4. 空值**如实保留**（旧版 agentd 不带 host_id / host_name / network_addresses），
//      不 omit —— 否则读的人分不清「没有这项」和「这项是空」。
//
// Usage: npm run test:agent-purpose-export

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const summary: AgentFactSummary = {
  agentId: "agent-host-9660eb694f0b",
  contentDigest: `fact-v1:sha256:${"a".repeat(64)}`,
  revision: 38127,
  observedAt: "2026-09-30T03:57:22Z",
  receivedAt: "2026-09-30T03:57:30.123456789+00:00",
  os: "macos",
  arch: "aarch64",
  processCount: 763,
  processExecutables: [
    "/bin/zsh",
    "/Applications/Zed.app/Contents/MacOS/zed",
  ],
  packages: [],
  listenPorts: ["0.0.0.0:7000"],
  hostId: "mid-abc123",
  hostName: "macbook-pro",
  networkAddresses: ["en0 192.168.1.5/24"],
};

const text = factSummaryExport(summary);
const parsed = JSON.parse(text) as Record<string, unknown>;

// 1) 多行缩进 JSON（人能读、机器也能解析）
assert(text.includes("\n"), "应是缩进过的多行 JSON");
assert(parsed.agent_id === summary.agentId, "agent_id 应取自 agentId");

// 2) 契约字段名与顺序固定（顺序写死才不随对象构造而变）
const expectedKeys = [
  "agent_id",
  "content_digest",
  "revision",
  "observed_at",
  "received_at",
  "os",
  "arch",
  "process_count",
  "process_executables",
  "packages",
  "listen_ports",
  "host_id",
  "host_name",
  "network_addresses",
];
assert(
  JSON.stringify(Object.keys(parsed)) === JSON.stringify(expectedKeys),
  `字段集合/顺序不符：${Object.keys(parsed).join(",")}`,
);

// 3) 值与模型一一对应：数字仍是数字、数组仍是数组、摘要逐字保留
assert(parsed.content_digest === summary.contentDigest, "content_digest 应逐字保留");
assert(
  parsed.revision === summary.revision &&
    parsed.process_count === summary.processCount,
  "数字字段不应被转成字符串",
);
assert(
  Array.isArray(parsed.process_executables) &&
    (parsed.process_executables as string[])[1] === summary.processExecutables[1],
  "进程清单应是数组且元素逐字保留",
);
assert(
  Array.isArray(parsed.packages) && (parsed.packages as string[]).length === 0,
  "空数组应保留为空数组",
);
assert(
  Array.isArray(parsed.listen_ports) &&
    (parsed.listen_ports as string[])[0] === "0.0.0.0:7000",
  "监听端口应是数组",
);
assert(Array.isArray(parsed.network_addresses), "网卡地址应是数组");

// 4) 空值如实保留（旧版 agentd 的报文里没有这三项）
const legacy = JSON.parse(
  factSummaryExport({ ...summary, hostId: "", hostName: "", networkAddresses: [] }),
) as Record<string, unknown>;
assert(
  "host_id" in legacy && legacy.host_id === "",
  "host_id 的空值应保留而不是省掉",
);
assert("host_name" in legacy, "host_name 的空值应保留");
assert(
  "network_addresses" in legacy && (legacy.network_addresses as string[]).length === 0,
  "空的网卡列表也应保留",
);

// 5) 确定性：同一份摘要两次导出逐字节一致
assert(
  factSummaryExport(summary) === factSummaryExport({ ...summary }),
  "导出应当是确定性的",
);

console.log("agent-purpose-export: 全部通过");
