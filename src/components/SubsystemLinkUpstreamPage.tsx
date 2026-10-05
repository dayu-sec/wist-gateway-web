import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api";
import {
  useGatewayLinkRequest,
  useGatewayLinkdStatus,
  useSetGatewayLinkRequest,
} from "../hooks";
import { parseLinkUrl, type ParsedLink } from "../linkEnroll";
import { linkdSummary } from "./linkdStatus";
import styles from "./SubsystemLinkUpstreamPage.module.css";

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "管理凭证缺失或无效。";
    if (error.status === 400) return "接入物不完整（中心地址 / 接入券 / CA 缺项）。";
    return `本机网关返回 HTTP ${error.status}。${error.detail ?? ""}`;
  }
  if (error instanceof TypeError) {
    return "无法访问本机网关；若页面与网关不同源，请检查网络与代理配置。";
  }
  return "提交失败，请检查本机网关状态。";
}

const STEPS = [
  "在 Center「连接 Gateway」页生成/轮换接入券，复制那一条**接入链接**（含中心地址 + 接入券 + CA）",
  "把接入链接粘到本页提交（只落本机网关，**不直连 Center**）",
  "宿主侧 wist-gwlinkd 自动拉取并完成接入（link-upstream → register），本页显示结果",
];

type StatusTone = "idle" | "warn" | "info" | "ok" | "crit";

/** 接入状态 → 顶部醒目卡片的色调 + 文案。 */
function statusMeta(status: string | undefined): {
  tone: StatusTone;
  label: string;
  hint: string;
} {
  switch (status) {
    case "Pending":
      return {
        tone: "warn",
        label: "待 wist-gwlinkd 拉取",
        hint: "接入物已交给本机网关；等宿主侧 gwlinkd 拉取后自动接入。",
      };
    case "Connecting":
      return {
        tone: "info",
        label: "接入中",
        hint: "gwlinkd 正在 link-upstream / register…",
      };
    case "Connected":
      return {
        tone: "ok",
        label: "已接入",
        hint: "已换回客户端证书，此后与中心走 mTLS。",
      };
    case "Failed":
      return {
        tone: "crit",
        label: "接入失败",
        hint: "见下方原因；修正后重新提交接入物。",
      };
    default:
      return {
        tone: "idle",
        label: "尚未接入",
        hint: "把 Center「连接 Gateway」页生成的接入链接粘到下方提交。",
      };
  }
}

/**
 * 「链接上级」页（路由 `/link-upstream`）：把本网关接入上级控制中心。
 *
 * 新流程（`wist-design/doc/design/edge/gateway-onboard-request.md`）：本页**不再直连 Center**，
 * 只把 Center 页给的**一条接入链接**（含中心地址 + 一次性接入券 + CA-S）粘贴后提交给**本机网关**；
 * 宿主侧常驻 `wist-gwlinkd` 通过环回接口拉取并完成 link-upstream / register（私钥在本机生成）。
 */
export function SubsystemLinkUpstreamPage() {
  const [linkUrl, setLinkUrl] = useState("");
  const setRequest = useSetGatewayLinkRequest();
  const view = useGatewayLinkRequest();
  const linkdView = useGatewayLinkdStatus().data;
  const linkd = linkdSummary(linkdView);
  const parseResult: { parsed?: ParsedLink; error?: string } = linkUrl.trim()
    ? parseLinkUrl(linkUrl)
    : {};
  const canSubmit = Boolean(parseResult.parsed);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!parseResult.parsed) return;
    setRequest.mutate(parseResult.parsed, {
      // 提交后清掉接入链接输入框（含券，本机已落库，页面不保留）。
      onSuccess: () => setLinkUrl(""),
    });
  }

  const status = view.data?.hasRequest ? view.data.status : undefined;
  const meta = statusMeta(status);

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>链接上级</h1>
          {/* 中文长句整句写一行：JSX 里行间换行会折叠成一个可见空格。 */}
          <p className={styles.pageSummary}>
            把本机网关接入上级（即控制中心）。本页只把接入链接交给本机网关，真正的接入由宿主侧 wist-gwlinkd 完成。
          </p>
          <ol className={styles.steps}>
            {STEPS.map((step, index) => (
              <li key={step} className={styles.step}>
                <span className={styles.stepIndex} aria-hidden="true">
                  {index + 1}
                </span>
                <span className={styles.stepText}>{step}</span>
              </li>
            ))}
          </ol>
        </header>

        <section
          className={`${styles.statusCard} ${styles[`status_${meta.tone}`]}`}
          aria-live="polite"
        >
          <span className={styles.statusDot} aria-hidden="true" />
          <div className={styles.statusBody}>
            <div className={styles.statusEyebrow}>接入状态</div>
            <h2 className={styles.statusValue}>{meta.label}</h2>
            <p className={styles.statusHint}>{meta.hint}</p>
            {view.data?.centerEndpoint ? (
              <div className={styles.statusCenter}>
                <span className={styles.statusCenterLabel}>中心</span>
                <code className={styles.statusCenterValue}>
                  {view.data.centerEndpoint}
                </code>
                {view.data.gatewayId ? (
                  <span className={styles.statusCenterId}>
                    · {view.data.gatewayId}
                  </span>
                ) : null}
              </div>
            ) : null}
            <div className={styles.statusCenter}>
              <span className={styles.statusCenterLabel}>gwlinkd</span>
              <span
                className={`${styles.linkdValue} ${styles[`linkd_${linkd.tone}`]}`}
              >
                {linkd.label}
              </span>
              <span className={styles.statusCenterId}>{linkd.detail}</span>
              <Link className={styles.linkdMore} to="/gwlinkd">
                详情 →
              </Link>
            </div>
            {view.data?.hasRequest && view.data.resultDetail ? (
              <p className={styles.statusDetail}>{view.data.resultDetail}</p>
            ) : null}
          </div>
        </section>

        <section
          className={styles.usecaseCard}
          aria-labelledby="gateway-link-usecase"
        >
          <header className={styles.usecaseMeta}>
            <div className={styles.usecaseMetaCopy}>
              <span className={styles.usecaseTag}>一次性操作</span>
              <h2 id="gateway-link-usecase">粘贴接入链接</h2>
              <p>
                接入链接一次性、短命；提交后由宿主侧 wist-gwlinkd 拉取并消费，本页不回显。
              </p>
            </div>
          </header>

          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.field}>
              <span>接入链接</span>
              <textarea
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                placeholder="https://center.example/api/v1/gateway/link-upstream?gateway_id=…&link_token=…&ca=…"
                rows={4}
                required
              />
              <small>
                Center「连接 Gateway」页生成的一整条接入链接（含中心地址、接入券、CA 信任锚）—— 直接粘贴即可。
                {linkUrl.trim() && parseResult.error ? (
                  <em className={styles.fieldError}> {parseResult.error}</em>
                ) : null}
                {parseResult.parsed ? (
                  <em className={styles.fieldOk}>
                    {" "}
                    将接入中心：{parseResult.parsed.centerEndpoint}
                    {parseResult.parsed.gatewayId
                      ? ` · ${parseResult.parsed.gatewayId}`
                      : ""}
                  </em>
                ) : null}
              </small>
            </label>
            {setRequest.isError ? (
              <div className={styles.errorBanner} role="alert">
                {errorMessage(setRequest.error)}
              </div>
            ) : null}
            <div className={styles.formActions}>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={!canSubmit || setRequest.isPending}
              >
                {setRequest.isPending ? "提交中…" : "提交接入请求"}
              </button>
              <span className={styles.actionHint}>
                接入券只能消费一次，请确认实例一致后再提交。
              </span>
            </div>
          </form>
        </section>

      </main>
    </div>
  );
}
