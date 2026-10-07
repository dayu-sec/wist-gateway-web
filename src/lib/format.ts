/**
 * 指标页通用格式化与阈值判定。
 *
 * 约定：
 * - 缺失值统一渲染为 "—"，绝不用 0 或空白冒充实测数据；
 * - 未知量纲的数值一律不做猜测性换算。
 */

export const EMPTY = "—";

export function formatKiB(kb?: number | null): string {
  if (kb === undefined || kb === null || !Number.isFinite(kb)) return EMPTY;
  const bytes = kb * 1024;
  const units: [number, string][] = [
    [1024 ** 4, "TB"],
    [1024 ** 3, "GB"],
    [1024 ** 2, "MB"],
    [1024, "KB"],
  ];
  for (const [scale, unit] of units) {
    if (Math.abs(bytes) >= scale) {
      const value = bytes / scale;
      return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
    }
  }
  return `${bytes.toFixed(0)} B`;
}

export function formatPercent(
  value?: number | null,
  digits = 1,
): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return EMPTY;
  }
  return `${value.toFixed(digits)}%`;
}

export function formatNumber(value?: number | null, digits = 2): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return EMPTY;
  }
  return value.toFixed(digits);
}

/** 秒 → 人类可读时长，保留两级单位。 */
export function formatUptime(seconds?: number | null): string {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds)) {
    return EMPTY;
  }
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  if (minutes > 0) return `${minutes} 分钟`;
  return `${total} 秒`;
}

/**
 * 秒 → 相对时间描述（"3 天前"）。
 * 用于上报延迟：比"5456 分钟"这种原始数字更好读。
 */
export function formatRelativeSeconds(seconds?: number | null): {
  text: string;
  seconds: number | null;
} {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds)) {
    return { text: EMPTY, seconds: null };
  }
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return { text: `${s} 秒`, seconds: s };
  if (s < 3600) return { text: `${Math.floor(s / 60)} 分钟`, seconds: s };
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return { text: m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`, seconds: s };
  }
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return { text: h > 0 ? `${d} 天 ${h} 小时` : `${d} 天`, seconds: s };
}

export type Severity = "ok" | "warn" | "crit" | "unknown";

/** 百分比型指标（内存/磁盘使用率）的分级阈值。 */
export function severityForUsage(percent?: number | null): Severity {
  if (percent === undefined || percent === null || !Number.isFinite(percent)) {
    return "unknown";
  }
  if (percent >= 90) return "crit";
  if (percent >= 75) return "warn";
  return "ok";
}

/** 1 分钟负载分级：按逻辑核数归一（缺核数时以 8 核为保守基准）。 */
export function severityForLoad(load?: number | null, cores = 8): Severity {
  if (load === undefined || load === null || !Number.isFinite(load)) {
    return "unknown";
  }
  const ratio = load / Math.max(1, cores);
  if (ratio >= 1) return "crit";
  if (ratio >= 0.7) return "warn";
  return "ok";
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  ok: "正常",
  warn: "偏高",
  crit: "危急",
  unknown: "无数据",
};

/** 序列最后一点的取值，用于卡片上展示"当前值"。 */
export function lastValue(
  points?: [number, number][] | null,
): number | undefined {
  if (!points || points.length === 0) return undefined;
  return points[points.length - 1][1];
}

/** 速率（e/s）：小于 10 保留两位，避免 0.29 被压成 0.3。 */
export function formatRate(value?: number | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return EMPTY;
  }
  if (value === 0) return "0 e/s";
  if (Math.abs(value) < 10) return value.toFixed(2) + " e/s";
  if (Math.abs(value) < 10_000) {
    return value.toLocaleString("zh-CN", { maximumFractionDigits: 1 }) + " e/s";
  }
  return (value / 1000).toFixed(1) + "K e/s";
}

/**
 * 累计计数：按中文习惯用「万 / 亿」分级，而不是 K/M。
 * 运维界面上 12.7 万 比 127.2K 更容易一眼读出量级。
 */
export function formatCount(value?: number | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return EMPTY;
  }
  const abs = Math.abs(value);
  if (abs < 10_000) {
    return value.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
  }
  if (abs < 100_000_000) return (value / 10_000).toFixed(1) + " 万";
  return (value / 100_000_000).toFixed(2) + " 亿";
}

/** 占比：用于「未落存储占入流比例」这类判断。 */
export function formatShare(part: number, whole: number): string {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) {
    return EMPTY;
  }
  const percent = (part / whole) * 100;
  if (percent > 0 && percent < 0.01) return "<0.01%";
  return percent.toFixed(2) + "%";
}

/**
 * 坐标轴标签专用的紧凑数值：不带单位、按量级缩写。
 * 轴宽有限，带千分位和 "e/s" 的长标签会被画布左边缘裁掉。
 */
export function formatAxis(value: number): string {
  const abs = Math.abs(value);
  if (abs === 0) return "0";
  if (abs >= 100_000_000) return (value / 100_000_000).toFixed(1) + "亿";
  if (abs >= 10_000) {
    // 三位数以上的「万」不再留小数 —— "1000.0万" 读起来很别扭。
    const wan = value / 10_000;
    return (Math.abs(wan) >= 100 ? wan.toFixed(0) : wan.toFixed(1)) + "万";
  }
  if (abs >= 1000) return (value / 1000).toFixed(1) + "k";
  if (abs < 10) return value.toFixed(2);
  return value.toFixed(0);
}

/** 采样时刻（unix 秒）→ 本地时钟 "HH:MM:SS"。 */
export function formatClock(seconds?: number | null): string {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds)) {
    return EMPTY;
  }
  return new Date(seconds * 1000).toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * 网卡地址的展示摘要。
 *
 * `ip_addresses` 是注册表里的**原样**记录（agentd 报什么存什么，形如 `en0 192.168.3.178/24`）。
 * 一台多网卡主机一次就能报十几条 —— 大量每卡一条的 IPv6 链路本地（`fe80::`），外加
 * `bridge*` / `utun*` / `llw*` / `awdl*` 这类虚拟网卡。全量铺进表格既读不出重点，又把一行撑爆。
 *
 * 这里只在**展示层**挑出一个「主地址」，并把完整清单留给 tooltip：不改契约、不丢数据。
 * 采集侧（agentd 的 `local_ip_addresses`）现在也会在**源头**滤掉同样的噪声；这里的过滤是
 * **展示层兜底**（老数据 / 旧版本 agent 已经存进注册表的记录）。
 */
export interface AddressSummary {
  /** 挑选出的主地址（不带网卡名/掩码）；没有可用地址时为 null。 */
  primary: string | null;
  /** 除主地址外，仍值得展示的地址条数。 */
  others: number;
  /** 展示清单的换行拼接（含主地址），供 `title` 提示用；无数据时为空串。 */
  full: string;
}

interface ParsedAddress {
  iface: string;
  address: string;
  raw: string;
}

/** 一条记录形如 `<iface> <addr>/<prefix>`；容忍缺网卡名（纯地址）与含空格的多段网卡名。 */
function parseAddressEntry(entry: string): ParsedAddress {
  const raw = entry.trim();
  const tokens = raw.split(/\s+/).filter((token) => token.length > 0);
  // 地址取**最后一段**：网卡名可能带空格，地址（host/prefix）不会。
  const spec = tokens.length > 1 ? tokens[tokens.length - 1] : raw;
  const iface = tokens.length > 1 ? tokens.slice(0, -1).join(" ") : "";
  return { iface, address: spec.split("/")[0], raw };
}

/**
 * 对运维没有信息量的地址：回环、IPv6 链路本地（`fe80::/10`，每张网卡一条）、未指定、IPv4 自分配。
 *
 * 口径与采集侧 agentd 的 `is_meaningless_address` 对齐（都用完整地址段判断，不是只认 `fe80:`）——
 * 这里只是兜底老数据；新数据在采集侧已经过滤过了。
 */
function isNoise(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower.includes(":")) {
    if (lower === "::" || lower === "::1") return true;
    // fe80::/10：首个 hextet 落在 fe80–febf。
    return /^fe[89ab][0-9a-f]:/.test(lower);
  }
  if (lower === "0.0.0.0") return true;
  return lower.startsWith("127.") || lower.startsWith("169.254.");
}

/** 物理网卡（`en0` / `eth0` / `wlan0`…）优先于虚拟网卡（`bridge*` / `utun*` / `docker*`…）。 */
function isPhysicalInterface(iface: string): boolean {
  return /^(en|eth|wl|wlan|ens|enp|eno|em)\d/i.test(iface);
}

/** 越小越优先：先物理网卡、再虚拟网卡；同类里先 IPv4、再 IPv6。 */
function addressRank(parsed: ParsedAddress): number {
  const virtual = isPhysicalInterface(parsed.iface) ? 0 : 1;
  const isV6 = parsed.address.includes(":") ? 1 : 0;
  return virtual * 2 + isV6;
}

export function summarizeAddresses(entries: string[]): AddressSummary {
  const parsed = entries
    .map(parseAddressEntry)
    .filter((item) => item.address.length > 0);
  const usable = parsed.filter((item) => !isNoise(item.address));
  // 全被过滤（例如只剩链路本地）时回退到原始条目，别把「有数据」显示成空。
  const shown = (usable.length > 0 ? usable : parsed).sort(
    (left, right) => addressRank(left) - addressRank(right),
  );
  if (shown.length === 0) {
    return { primary: null, others: 0, full: "" };
  }
  return {
    primary: shown[0].address,
    others: shown.length - 1,
    full: shown.map((item) => item.raw).join("\n"),
  };
}
