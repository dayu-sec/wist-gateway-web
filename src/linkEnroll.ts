// 「接入链接」的解析：Center「连接 Gateway」页生成、网关「链接上级」页消费。
//
// 链接形态（一条 URL 带全）：
//   <中心>/api/v1/gateway/link-upstream?gateway_id=<id>&link_token=<券>&ca=<base64url(PEM)>
// 解出：origin → 中心地址；`link_token` → 接入券；`ca` → CA 信任锚；`gateway_id` → 实例标识。
//
// 这是**复制粘贴的凭据串**（不点开、不进地址栏），故容忍券/CA 在 URL 里。见设计
// `wist-design/doc/design/edge/gateway-onboard-request.md`。

export interface ParsedLink {
  centerEndpoint: string;
  linkToken: string;
  trustBundlePem: string;
  gatewayId: string;
}

/** base64url（无填充）解码为 UTF-8 文本：还原链接里塞的 CA PEM。 */
export function base64UrlDecode(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** 解析接入链接；缺项/非法即回 `error`（供页面内联提示）。
 * CA 信任锚仅对 **https** 中心必需（要校服务器证书）；http 明文无 TLS 可校，可省。 */
export function parseLinkUrl(input: string): {
  parsed?: ParsedLink;
  error?: string;
} {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { error: "不是合法的 URL。" };
  }
  const linkToken = url.searchParams.get("link_token") ?? "";
  if (!linkToken) return { error: "链接里缺少 link_token（接入券）。" };
  const ca = url.searchParams.get("ca") ?? "";
  if (url.protocol === "https:" && !ca) {
    return { error: "https 中心的链接必须带 ca（CA 信任锚）。" };
  }
  let trustBundlePem = "";
  if (ca) {
    try {
      trustBundlePem = base64UrlDecode(ca);
    } catch {
      return { error: "ca 不是合法的 base64url。" };
    }
  }
  return {
    parsed: {
      centerEndpoint: url.origin,
      linkToken,
      trustBundlePem,
      gatewayId: url.searchParams.get("gateway_id") ?? "",
    },
  };
}
