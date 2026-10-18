import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api";
import {
  useGatewayLinkRequest,
  useGatewayLinkdStatus,
  useSetGatewayLinkRequest,
} from "../hooks";
import { parseLinkUrl, type ParsedLink } from "../linkEnroll";
import { linkUpstreamStatus } from "../linkUpstreamStatus";
import { t } from "../i18n";
import { linkdSummary } from "./linkdStatus";
import styles from "./SubsystemLinkUpstreamPage.module.css";

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return t("管理凭证缺失或无效。", "Admin credentials missing or invalid.");
    if (error.status === 400)
      return t(
        "接入物不完整（中心地址 / 接入券 / CA 缺项）。",
        "Incomplete enrollment material (center address / enrollment ticket / CA missing).",
      );
    return t(
      "本机网关返回 HTTP {status}。{detail}",
      "The local gateway returned HTTP {status}. {detail}",
      { status: error.status, detail: error.detail ?? "" },
    );
  }
  if (error instanceof TypeError) {
    return t(
      "无法访问本机网关；若页面与网关不同源，请检查网络与代理配置。",
      "Cannot reach the local gateway; if the page and the gateway are not same-origin, check the network and proxy configuration.",
    );
  }
  return t("提交失败，请检查本机网关状态。", "Submit failed. Check the local gateway status.");
}

/**
 * 三步说明。**必须是函数**：模块级常量里的 `t()` 只会在导入时求值一次，切语言不会变。
 *
 * 内容用节点而不是字符串：文案里要点出「接入链接」「不直连 Center」两个关键处。原先那两句写的是
 * Markdown 的 `**…**`，纯文本不会转成粗体 —— 页面上就真的把星号显示出来了（见 `steps` 的调用处）。
 */
interface Step {
  key: string;
  content: ReactNode;
}

function steps(): Step[] {
  return [
    {
      key: "ticket",
      content: (
        <>
          {t(
            "在 Center「连接 Gateway」页生成/轮换接入券，复制那一条",
            "On the Center \"Connect Gateway\" page, generate or rotate an enrollment ticket and copy that ",
          )}
          <strong>{t("接入链接", "enrollment link")}</strong>
          {t(
            "（含中心地址 + 接入券 + CA）",
            " (center address + enrollment ticket + CA)",
          )}
        </>
      ),
    },
    {
      key: "submit",
      content: (
        <>
          {t("把接入链接粘到本页提交（只落本机网关，", "Paste the enrollment link into this page and submit (it only reaches the local gateway, ")}
          <strong>{t("不直连 Center", "never Center directly")}</strong>
          {t("）", ")")}
        </>
      ),
    },
    {
      key: "linkd",
      content: t(
        "宿主侧 wist-gwlinkd 自动拉取并完成接入（link-upstream → register），本页显示结果",
        "The host-side wist-gwlinkd fetches it automatically and completes enrollment (link-upstream → register); this page shows the result",
      ),
    },
  ];
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
  const meta = linkUpstreamStatus(status, linkdView);

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>{t("链接上级", "Link upstream")}</h1>
          {/* 中文长句整句写一行：JSX 里行间换行会折叠成一个可见空格。 */}
          <p className={styles.pageSummary}>
            {t(
              "把本机网关接入上级（即控制中心）。本页只把接入链接交给本机网关，真正的接入由宿主侧 wist-gwlinkd 完成。",
              "Enroll this gateway with an upstream (the control center). This page only hands the enrollment link to the local gateway; the host-side wist-gwlinkd performs the actual enrollment.",
            )}
          </p>
          <ol className={styles.steps}>
            {steps().map((step, index) => (
              <li key={step.key} className={styles.step}>
                <span className={styles.stepIndex} aria-hidden="true">
                  {index + 1}
                </span>
                <span className={styles.stepText}>{step.content}</span>
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
            <div className={styles.statusEyebrow}>{t("接入状态", "Enrollment status")}</div>
            <h2 className={styles.statusValue}>{meta.label}</h2>
            <p className={styles.statusHint}>{meta.hint}</p>
            {view.data?.centerEndpoint ? (
              <div className={styles.statusCenter}>
                <span className={styles.statusCenterLabel}>{t("中心", "Center")}</span>
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
                {t("详情 →", "Details →")}
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
              <span className={styles.usecaseTag}>{t("一次性操作", "One-shot operation")}</span>
              <h2 id="gateway-link-usecase">{t("粘贴接入链接", "Paste enrollment link")}</h2>
              <p>
                {t(
                  "接入链接一次性、短命；提交后由宿主侧 wist-gwlinkd 拉取并消费，本页不回显。",
                  "The enrollment link is one-shot and short-lived; after submit, the host-side wist-gwlinkd fetches and consumes it, and this page does not echo it back.",
                )}
              </p>
            </div>
          </header>

          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.field}>
              <span>{t("接入链接", "Enrollment link")}</span>
              <textarea
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                placeholder="https://center.example/api/v1/gateway/link-upstream?gateway_id=…&link_token=…&ca=…"
                rows={4}
                required
              />
              <small>
                {t(
                  "Center「连接 Gateway」页生成的一整条接入链接（含中心地址、接入券、CA 信任锚）—— 直接粘贴即可。",
                  "The whole enrollment link generated on the Center \"Connect Gateway\" page (center address, enrollment ticket, CA trust anchor) — just paste it here.",
                )}
                {linkUrl.trim() && parseResult.error ? (
                  <em className={styles.fieldError}> {parseResult.error}</em>
                ) : null}
                {parseResult.parsed ? (
                  <em className={styles.fieldOk}>
                    {" "}
                    {t("将接入中心：{center}", "Will enroll with center: {center}", {
                      center: parseResult.parsed.centerEndpoint,
                    })}
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
                {setRequest.isPending
                  ? t("提交中…", "Submitting…")
                  : t("提交接入请求", "Submit enrollment request")}
              </button>
              <span className={styles.actionHint}>
                {t(
                  "接入券只能消费一次，请确认实例一致后再提交。",
                  "The enrollment ticket can be consumed only once; confirm the instance matches before submitting.",
                )}
              </span>
            </div>
          </form>
        </section>

      </main>
    </div>
  );
}
