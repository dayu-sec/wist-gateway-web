import {
  ApiError,
  type KnowledgeLocksView,
  type KnowledgePackageView,
  type KnowledgeView,
} from "../api";
import { t } from "../i18n";

/**
 * 「知识库」页（`/knowledge`）的显示口径。
 *
 * 单独成模块而不是塞进组件里：本仓没有组件渲染测试环境（无 jsdom），页面逻辑只能靠
 * **纯函数 + 契约测试**钉住（同 `agentUpgradePackages.ts` / `agentWorkStatus.ts` 的做法）。
 */

/** 包自报版本的显示形式：`v0.1.1`；版本为空时不装作有。 */
export function knowledgeVersionLabel(pkg: KnowledgePackageView): string {
  return pkg.version ? `v${pkg.version}` : t("未知版本", "Unknown version");
}

/**
 * 来源态：`GET …/knowledge` 的 `source` 只有四种取值，页面据此决定「现在生效的是哪一版」
 * 那一行怎么说。
 *
 * `dir` = **出厂初始包**（网关配置里的 `[knowledge] source_dir`）：有内容，但不走管理面 ——
 * 所以它既不是 `package`（没有 `package_id`、不能回滚），也不是 `config-files`（那是过渡态）。
 * 把两者混为一谈会让页面把“已经装着出厂内容”说成“还是过渡态”。
 */
export function knowledgeSourceKind(
  source: string,
): "package" | "initial" | "config-files" | "none" {
  if (source === "package") return "package";
  if (source === "dir") return "initial";
  if (source === "none") return "none";
  // 未知取值（网关比前端新）：当过渡态说比装作“没有内容”安全 —— 内容是有的。
  return "config-files";
}

/** 非 `package` 来源那一行的人话（`package` 走 [`knowledgeVersionLabel`]）。 */
export function knowledgeSourceText(
  kind: "package" | "initial" | "config-files" | "none",
): string {
  switch (kind) {
    case "initial":
      return t(
        "出厂初始包（[knowledge] source_dir）",
        "Factory initial package ([knowledge] source_dir)",
      );
    case "none":
      return t("未配置（空载）", "Not configured (empty)");
    default:
      return t(
        "从配置文件装载（过渡态）",
        "Loaded from config files (transitional)",
      );
  }
}

/** sha256 截短显示：前 12 位 + 省略号（与安装包页 `.metaSha` 同一口径）。 */
export function knowledgeShaLabel(sha256: string): string {
  return sha256 ? `${sha256.slice(0, 12)}…` : "—";
}

/**
 * 验签状态。
 *
 * 空串是**有意义的**（`knowledge_ops` 里 `signed_by: String::new()`）：网关没配验签公钥，
 * 录入时只记了摘要。所以这里分开说，而不是显示一个空的「签发者」。
 */
export function knowledgeSignatureLabel(pkg: KnowledgePackageView): string {
  if (!pkg.signedBy)
    return t("未验签（网关未配公钥）", "Unsigned (no public key on gateway)");
  return t(
    "已验签 · {signer}…",
    "Signed · {signer}…",
    { signer: pkg.signedBy.slice(0, 12) },
  );
}

/**
 * 当前生效的那一条历史记录。
 *
 * `GET …/knowledge` 只带 `package_id`（不带版本 / 摘要），版本要从录入历史里按 id 对齐补出来 ——
 * 与安装包页用**摘要**对齐当前包是同一个理由：生效态与存档是两个来源，得有个公共键。补不出来
 * （历史里没有，比如网关换过库）就回 `null`，页面如实说「未识别」。
 */
export function findActiveKnowledgePackage(
  packages: KnowledgePackageView[],
  activePackageId: string | null,
): KnowledgePackageView | null {
  if (!activePackageId) return null;
  return packages.find((pkg) => pkg.packageId === activePackageId) ?? null;
}

/**
 * 五份数据版本的一行摘要，如 `目录 12 · 模板 12 · 策略 5 · 用途 3`。
 *
 * 取不到的那几份直接省略：`null` 表示「这份数据不在这套内容里」（或网关没装载），
 * 写成 `目录 —` 会让人以为是版本号丢了。
 */
export function knowledgeVersionSummary(knowledge: KnowledgeView): string {
  return versionSummary(knowledge);
}

/** 同上，但取自录入历史里的一版（历史表每一行的内容版本）。 */
export function knowledgePackageVersionSummary(
  pkg: KnowledgePackageView,
): string {
  return versionSummary(pkg);
}

interface ContentVersions {
  catalogVersion: number | null;
  templateVersion: number | null;
  policyVersion: number | null;
  purposeVersion: number | null;
}

function versionSummary(versions: ContentVersions): string {
  const parts: string[] = [];
  if (versions.catalogVersion !== null)
    parts.push(t("目录 {n}", "Catalog {n}", { n: versions.catalogVersion }));
  if (versions.templateVersion !== null)
    parts.push(t("模板 {n}", "Templates {n}", { n: versions.templateVersion }));
  if (versions.policyVersion !== null)
    parts.push(t("策略 {n}", "Policies {n}", { n: versions.policyVersion }));
  if (versions.purposeVersion !== null)
    parts.push(t("用途 {n}", "Purposes {n}", { n: versions.purposeVersion }));
  return parts.join(" · ");
}

/** 「回滚到上一版」的目标与它的可用性。 */
export interface KnowledgeRollbackTarget {
  packageId: string;
  /** 在录入历史里找到的那一版；找不到为 `null`（页面只报 id）。 */
  pkg: KnowledgePackageView | null;
  /** 不能回滚的原因；`null` = 可以回滚。 */
  blockedReason: string | null;
}

/**
 * 「回滚到上一版」的目标 = 最近一次切换的 `from_package`（设计 §8.4：回滚就是"把指针指回上一版"）。
 *
 * 为什么先取历史校验：`from_package` 只是**当时**被切走的那一版，它事后可能不在录入历史里，
 * 或副本被删（`available: false`）。那种情况按钮要置灰并当场说明原因，而不是让操作者点了才吃
 * 一个 422「装载失败」—— 那看不出是「包没了」还是「包坏了」。
 */
export function rollbackTarget(
  knowledge: KnowledgeView,
  packages: KnowledgePackageView[],
): KnowledgeRollbackTarget | null {
  const latest = knowledge.activations[0];
  if (!latest || !latest.fromPackage) return null;
  const packageId = latest.fromPackage;
  const pkg = packages.find((entry) => entry.packageId === packageId) ?? null;
  if (!pkg) {
    return {
      packageId,
      pkg: null,
      blockedReason: t(
        "上一版不在录入历史里（网关换过库，或记录被清）",
        "The previous version is not in the record history (the gateway switched stores, or records were cleared)",
      ),
    };
  }
  if (!pkg.available) {
    return {
      packageId,
      pkg,
      blockedReason: t(
        "上一版的副本已不在网关（包目录被手工清过，或备份还原不完整）",
        "The previous version's copy is no longer on the gateway (package dir cleared by hand, or an incomplete restore)",
      ),
    };
  }
  return { packageId, pkg, blockedReason: null };
}

/** 锁在旧版目录上的工作总数（设计 §8.3）：换版不追改在跑的工作，这是它们剩下的量。 */
export function lockedWorkTotal(locks: KnowledgeLocksView): number {
  return locks.locks.reduce((sum, entry) => sum + entry.works, 0);
}

/**
 * 「这批工作锁在**当前生效**的目录版本上」之外的锁（设计 §8.3）。
 *
 * 生效版本那一条不是问题（它就是现在装的），只有**别的**版本号才说明「有工作还没跟着走」。
 */
export function staleLocks(
  locks: KnowledgeLocksView,
): KnowledgeLocksView["locks"] {
  return locks.locks.filter(
    (entry) => entry.catalogVersion !== locks.activeCatalogVersion,
  );
}

/**
 * 「网关没应答」的提示：**空的 5xx 正文**。
 *
 * 为什么敢这么判：知识库这几条路由自己抛出的 5xx **一定**带 `{code, message}` 正文
 * （`knowledge_ops::knowledge_error`）。所以一个没有正文的 5xx 只可能来自别处 ——
 * 最典型的是 dev 代理（Vite）连不上网关时回的那个无正文 500。
 *
 * 不分这一步的代价：页面会把「网关根本没在跑」说成「请检查网关日志」，
 * 让人跑到日志里去找一个不存在的错误（2026-09-30 现场真踩了：`/api/v1/admin/agents`
 * 同时 500，因为代理目标 `https://127.0.0.1:443` 没人监听）。
 */
function gatewayNoAnswerMessage(status: number): string {
  return t(
    `网关没有应答（HTTP {status}，响应体为空）—— 请求很可能根本没到网关：` +
      "先确认网关在跑，再看前端 dev 代理（WARP_INSIGHT_WEB_PROXY_TARGET）指的地址有没有服务监听。" +
      "（知识库这几个接口自己的 5xx 都会带 {code, message} 正文。）",
    `Gateway did not answer (HTTP {status}, empty body) — the request most likely never reached it: ` +
      "first make sure the gateway is running, then check that something is listening at the address the web dev proxy (WARP_INSIGHT_WEB_PROXY_TARGET) points to. " +
      "(The knowledge routes' own 5xx responses always carry a {code, message} body.)",
    { status },
  );
}

/**
 * 知识库接口的 `code` → 处置建议。
 *
 * 只补**这一页一眼看不出**的那部分：正文已经说清「是什么」，这里说「去改哪里」。
 * 网关侧的口径见 `KnowledgeRecordError::code`（`wist-gateway/src/app/knowledge.rs`）。
 */
export function knowledgeErrorAdvice(code: string): string | null {
  switch (code) {
    case "package_source_invalid":
      return t(
        "地址必须是 https:// 链接，或「容器内」的绝对路径（宿主路径容器里看不见）",
        "The address must be an https:// URL, or an absolute path inside the container (host paths are not visible there)",
      );
    case "package_source_unavailable":
      return t(
        "网关拉不到来源：核对地址、网络，以及离线投放时文件确实挂进了容器",
        "The gateway cannot fetch the source: check the address and network, and that the file really is mounted into the container for offline delivery",
      );
    case "package_sha256_mismatch":
      return t(
        "摘要与来源字节不符：核对发布侧的 *.sha256（它算的是来源 tarball 的字节）",
        "Digest does not match the source bytes: check the *.sha256 on the release side (it covers the source tarball's bytes)",
      );
    case "package_manifest_inconsistent":
      return t(
        "包自相矛盾（manifest 与内容对不上）：重新从 wist-knowledge 的 Release 取一份",
        "The package contradicts itself (manifest does not match the content): fetch a fresh copy from the wist-knowledge Release",
      );
    case "package_content_invalid":
      return t(
        "内容本身不合法：先让 wist-knowledge 修内容再重发，网关不会将就装载",
        "The content itself is invalid: have wist-knowledge fix it and republish; the gateway will not load it as-is",
      );
    case "package_signature_invalid":
      return t(
        "包被动过，或签名不是这套发布私钥签的",
        "The package was modified, or it was not signed with this release private key",
      );
    case "package_not_found":
      return t(
        "这个包不在网关库里（换过库，或从备份还原过）",
        "This package is not in the gateway store (the store was switched, or restored from backup)",
      );
    default:
      return null;
  }
}

/** 读取（生效态 / 历史 / 锁旧版）失败的提示。401 / 404 / 空正文 5xx 各自有明确下一步。 */
export function knowledgeLoadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return t(
        "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击“应用”。",
        "Admin Token is missing or invalid: enter the correct Admin Token on the left and click “Apply”.",
      );
    if (error.status === 429)
      return t(
        "认证失败次数过多，请稍后再试。",
        "Too many failed authentication attempts. Try again later.",
      );
    // 404 特指「路由不存在」：网关进程在应答，只是没有这个接口 —— 多半在跑旧构建。
    if (error.status === 404)
      return t(
        "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。",
        "The gateway has no such endpoint (HTTP 404): the running gateway is most likely an old build. Rebuild and restart it, then retry.",
      );
    if (error.detail)
      return t(
        "网关返回 HTTP {status}：{detail}",
        "Gateway returned HTTP {status}: {detail}",
        { status: error.status, detail: error.detail },
      );
    if (error.status >= 500) return gatewayNoAnswerMessage(error.status);
    return t(
      "网关返回 HTTP {status}，请检查网关日志。",
      "Gateway returned HTTP {status}. Check the gateway logs.",
      { status: error.status },
    );
  }
  return t(
    "读取失败：响应不符合当前契约，请检查网关与前端版本。",
    "Load failed: the response does not match the current contract. Check the gateway and web versions.",
  );
}

/** 录入 / 切换失败的提示。正文是 `{error:{code, message}}`，能解出 `code` 就顺带给处置建议。 */
export function knowledgeActionErrorMessage(
  error: unknown,
  action: string,
): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return t(
        "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击“应用”。",
        "Admin Token is missing or invalid: enter the correct Admin Token on the left and click “Apply”.",
      );
    if (error.status === 429)
      return t(
        "认证失败次数过多，请稍后再试。",
        "Too many failed authentication attempts. Try again later.",
      );
    if (error.status === 404)
      return t(
        "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。",
        "The gateway has no such endpoint (HTTP 404): the running gateway is most likely an old build. Rebuild and restart it, then retry.",
      );
    if (error.detail) {
      const advice = error.code ? knowledgeErrorAdvice(error.code) : null;
      const code = error.code ? ` · ${error.code}` : "";
      const head = t(
        "{action}失败（HTTP {status}{code}）：{detail}",
        "{action} failed (HTTP {status}{code}): {detail}",
        {
          action: actionLabel(action),
          status: error.status,
          code,
          detail: error.detail,
        },
      );
      return advice
        ? t("{head} —— {advice}", "{head} — {advice}", { head, advice })
        : head;
    }
    if (error.status >= 500)
      return t(
        "{action}失败：{reason}",
        "{action} failed: {reason}",
        {
          action: actionLabel(action),
          reason: gatewayNoAnswerMessage(error.status),
        },
      );
    return t(
      "{action}失败（HTTP {status}），请检查网关日志。",
      "{action} failed (HTTP {status}). Check the gateway logs.",
      { action: actionLabel(action), status: error.status },
    );
  }
  return t(
    "{action}失败：响应不符合当前契约，请检查网关与前端版本。",
    "{action} failed: the response does not match the current contract. Check the gateway and web versions.",
    { action: actionLabel(action) },
  );
}

/**
 * 动作名的当前语言取词。
 *
 * 调用方传进来的 `action` 是**中文原文**（`"录入"` / `"切换"`）—— 它同时是这段话的中文用词，
 * 所以这里按它取英文；认不出的动作（调用方自带文案）原样回。
 */
function actionLabel(action: string): string {
  switch (action) {
    case "录入":
      return t("录入", "Record");
    case "切换":
      return t("切换", "Activate");
    default:
      return action;
  }
}
