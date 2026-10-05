// 「接入链接」解析契约：钉住 Center 侧编码（base64url 无填充、UTF-8）与网关侧解析的一致。
//
// Center 侧（`wist-center-web`）用 `btoa(bytes).replace(+/→-,_/→/,去=)` 编码；这里用 Node 的
// `Buffer.toString("base64url")` 复刻同一算法做**跨侧**校验 —— 任一侧换编码即爆。
import { base64UrlDecode, parseLinkUrl } from "../src/linkEnroll";

const pem = "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n";
const ca = Buffer.from(pem, "utf8").toString("base64url");

const url = `https://center.example/api/v1/gateway/link-upstream?gateway_id=gw-002&link_token=link_abc&ca=${ca}`;
const { parsed, error } = parseLinkUrl(url);
if (error) throw new Error(`should parse: ${error}`);
if (!parsed) throw new Error("parse returned neither parsed nor error");
if (parsed.centerEndpoint !== "https://center.example")
  throw new Error(`origin wrong: ${parsed.centerEndpoint}`);
if (parsed.linkToken !== "link_abc") throw new Error("token wrong");
if (parsed.gatewayId !== "gw-002") throw new Error("gateway id wrong");
if (parsed.trustBundlePem !== pem)
  throw new Error("CA PEM did not round-trip through base64url");
if (base64UrlDecode(ca) !== pem) throw new Error("decode round-trip failed");

// 缺项/非法一律报错（页面据此禁用提交并内联提示）。
if (!parseLinkUrl("not a url").error) throw new Error("bad url must error");
if (
  !parseLinkUrl("https://c.example/api/v1/gateway/link-upstream?ca=AAAA").error
)
  throw new Error("missing link_token must error");

// CA 按 scheme 条件必需：https 无 ca → 报错；http 明文无 ca → 通过（pem 为空）。
const httpsNoCa = parseLinkUrl(
  "https://c.example/api/v1/gateway/link-upstream?link_token=t",
);
if (!httpsNoCa.error) throw new Error("https without ca must error");
const httpNoCa = parseLinkUrl(
  "http://c.local:3100/api/v1/gateway/link-upstream?link_token=t",
);
if (httpNoCa.error)
  throw new Error(`http without ca should parse: ${httpNoCa.error}`);
if (!httpNoCa.parsed) throw new Error("http without ca: no parsed");
if (httpNoCa.parsed.centerEndpoint !== "http://c.local:3100")
  throw new Error("http center endpoint wrong");
if (httpNoCa.parsed.trustBundlePem !== "")
  throw new Error("http without ca should yield empty pem");

console.log("link-enroll parse contract test passed");
