import { summarizeAddresses } from "../src/lib/format";

// 单元测试：网卡地址的展示口径（主地址挑选 + 噪声过滤）。
//
// 用一条真实的 macOS 记录当样本：19 条地址里 8 条是 IPv6 链路本地（每张网卡一条），
// 还有 bridge/utun/llw/awdl 这些虚拟网卡 —— 全量铺进表格既没重点又把行撑爆。
// 这里锁住：噪声被滤掉、物理网卡 + IPv4 胜出、其余折叠成计数、全量仍在 tooltip 里。

const SAMPLE = [
  "awdl0 fe80::303b:c4ff:fe6b:406e/64",
  "bridge100 192.168.139.3/23",
  "bridge100 fe80::603e:5fff:fef3:3364/64",
  "bridge100 fd07:b51a:cc66:0:a617:db5e:ab7:e9f1/64",
  "bridge101 192.168.117.0/24",
  "bridge101 fe80::603e:5fff:fef3:3365/64",
  "bridge102 192.168.107.0/24",
  "bridge102 fe80::603e:5fff:fef3:3366/64",
  "en0 fe80::1857:ec5:fe03:af06/64",
  "en0 192.168.3.178/24",
  "llw0 fe80::303b:c4ff:fe6b:406e/64",
  "utun0 fe80::19c3:bef7:1b4f:f4f5/64",
  "utun1 fe80::3de5:8507:afee:5945/64",
  "utun100 100.121.111.48/8",
  "utun100 fe80::845:a9a4:a00a:8bcd/64",
  "utun100 fe80::/64",
  "utun2 fe80::4aef:bbdd:5acd:f782/64",
  "utun3 fe80::ce81:b1c:bd2c:69e/64",
];

const summary = summarizeAddresses(SAMPLE);

// en0 的物理 IPv4 应当是主地址。
if (summary.primary !== "192.168.3.178") {
  throw new Error(`expected en0 IPv4 as primary, got ${summary.primary}`);
}
// 可用地址共 6 条（bridge100/101/102 的 IPv4 + bridge100 的 ULA v6 + en0 v4 + utun100 v4），主地址之外还有 5 条。
if (summary.others !== 5) {
  throw new Error(`expected 5 secondary addresses, got ${summary.others}`);
}
if (summary.full.includes("fe80")) {
  throw new Error("link-local IPv6 must not leak into the displayed list");
}
if (!summary.full.includes("en0 192.168.3.178/24")) {
  throw new Error("the full tooltip list must keep the primary entry verbatim");
}
if (summary.full.split("\n").length !== summary.others + 1) {
  throw new Error("full list length must match primary + others");
}

// 全是噪声（只剩链路本地）时回退到首条，别把「有数据」显示成空。
const onlyLinkLocal = summarizeAddresses([
  "en0 fe80::1/64",
  "utun0 fe80::2/64",
]);
if (onlyLinkLocal.primary !== "fe80::1" || onlyLinkLocal.others !== 1) {
  throw new Error("all-noise input must fall back to the first raw entry");
}

// 回环 / IPv4 自分配也要滤掉。
const loopback = summarizeAddresses(["lo0 127.0.0.1/8", "en0 169.254.10.20/16"]);
if (loopback.primary === null) {
  throw new Error("loopback/self-assigned must be filtered, leaving nothing");
}

// 空输入 → null，页面渲染 "—"。
const empty = summarizeAddresses([]);
if (empty.primary !== null || empty.others !== 0 || empty.full !== "") {
  throw new Error("empty input must summarize to null/0/\"\"");
}

// 缺网卡名（纯地址）也要能解析；粘贴里那种「网卡名与地址黏在一起」的异常串也不能崩。
if (summarizeAddresses(["10.0.0.9"]).primary !== "10.0.0.9") {
  throw new Error("bare address without interface name must parse");
}
if (
  summarizeAddresses([
    "agent-host-6b9ccb88512bawdl0 fe80::303b:c4ff:fe6b:406e/64",
  ]).primary !== "fe80::303b:c4ff:fe6b:406e"
) {
  throw new Error("garbled interface token must still parse the address");
}

// --- 噪声口径与采集侧对齐：整个 fe80::/10（不只是 fe80:）+ 未指定 -----------------
if (
  summarizeAddresses(["en0 febf::1/64", "en0 192.168.1.5/24"]).primary !== "192.168.1.5"
) {
  throw new Error("fe80::/10 upper bound (febf) must be filtered like fe80");
}
if (summarizeAddresses(["en0 fec0::1/64"]).primary !== "fec0::1") {
  throw new Error("site-local fec0:: is not link-local and must be kept");
}
if (
  summarizeAddresses(["en0 0.0.0.0/0", "en0 192.168.1.5/24"]).primary !== "192.168.1.5"
) {
  throw new Error("unspecified 0.0.0.0 must be filtered");
}

// --- 多段网卡名 / 多余 token：地址取最后一段，不崩也不误判 ---------------------
if (summarizeAddresses(["weird iface name 10.0.0.9"]).primary !== "10.0.0.9") {
  throw new Error("address must be taken from the last token");
}

// --- 样本的 full 里不允许出现任何噪声行 ---------------------------------------
if (
  summary.full
    .split("\n")
    .some((line) => /fe[89ab][0-9a-f]:|^127\.|^0\.0\.0\.0/.test(line))
) {
  throw new Error(`full list must not contain noise: ${summary.full}`);
}

// --- 排序规则：物理网卡优先于虚拟网卡（与输入顺序无关） ----------------------
if (
  summarizeAddresses(["utun100 100.64.0.9/32", "en0 10.0.0.5/24"]).primary !== "10.0.0.5"
) {
  throw new Error("physical IPv4 must beat virtual IPv4 regardless of input order");
}
if (
  summarizeAddresses(["en0 2001:db8::1/64", "utun100 100.64.0.9/32"]).primary !==
  "2001:db8::1"
) {
  throw new Error("physical interface must outrank virtual even across IP families");
}

console.log("address summary test passed");
