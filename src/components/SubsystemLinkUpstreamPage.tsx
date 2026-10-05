import { useState, type FormEvent } from "react";
import { ApiError } from "../api";
import { useGatewayLinkRequest, useSetGatewayLinkRequest } from "../hooks";
import styles from "./SubsystemLinkUpstreamPage.module.css";

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "管理凭证缺失或无效。";
    if (error.status === 400)
      return "中心地址 / 接入券 / CA 信任锚都不能为空。";
    return `本机网关返回 HTTP ${error.status}。${error.detail ?? ""}`;
  }
  if (error instanceof TypeError) {
    return "无法访问本机网关；若页面与网关不同源，请检查网络与代理配置。";
  }
  return "提交失败，请检查本机网关状态。";
}

const STEPS = [
  "在 Center「连接 Gateway」页生成/轮换接入券，拿到 中心地址 + 接入券 + CA 信任锚",
  "把这三样填到本页提交（只落本机网关，**不直连 Center**）",
  "宿主侧 wist-gwlinkd 自动拉取并完成接入（link-upstream → register），本页显示结果",
];

const STATUS_LABEL: Record<string, string> = {
  Pending: "待 wist-gwlinkd 拉取",
  Connecting: "接入中",
  Connected: "已接入",
  Failed: "接入失败",
};

/**
 * 「链接上级」页（路由 `/link-upstream`）：把本网关接入上级控制中心。
 *
 * 新流程（`wist-design/doc/design/edge/gateway-onboard-request.md`）：本页**不再直连 Center**，
 * 只把 Center 页给的接入物（中心地址 + 一次性接入券 + CA-S）提交给**本机网关**；宿主侧常驻
 * `wist-gwlinkd` 通过环回接口拉取并完成 link-upstream / register（私钥在本机生成）。
 */
export function SubsystemLinkUpstreamPage() {
  const [centerEndpoint, setCenterEndpoint] = useState("");
  const [linkToken, setLinkToken] = useState("");
  const [trustBundle, setTrustBundle] = useState("");
  const setRequest = useSetGatewayLinkRequest();
  const view = useGatewayLinkRequest();
  const canSubmit =
    centerEndpoint.trim().length > 0 &&
    linkToken.trim().length > 0 &&
    trustBundle.trim().length > 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setRequest.mutate(
      {
        centerEndpoint: centerEndpoint.trim(),
        linkToken: linkToken.trim(),
        trustBundlePem: trustBundle,
      },
      {
        // 提交后清掉明文券输入框（本机已落库，页面不保留）。
        onSuccess: () => setLinkToken(""),
      },
    );
  }

  const status = view.data?.hasRequest ? view.data.status : undefined;

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>链接上级</h1>
          {/* 中文长句整句写一行：JSX 里行间换行会折叠成一个可见空格。 */}
          <p className={styles.pageSummary}>
            把本机网关接入上级（即控制中心）。本页只把接入物交给本机网关，真正的接入由宿主侧 wist-gwlinkd 完成。
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
          className={styles.usecaseCard}
          aria-labelledby="gateway-link-usecase"
        >
          <header className={styles.usecaseMeta}>
            <div className={styles.usecaseMetaCopy}>
              <span className={styles.usecaseTag}>一次性操作</span>
              <h2 id="gateway-link-usecase">填入接入材料</h2>
              <p>
                接入券一次性、短命；提交后由宿主侧 wist-gwlinkd 拉取并消费，本页不回显券。
              </p>
            </div>
          </header>

          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={`${styles.field} ${styles.urlField}`}>
              <span>中心接入地址</span>
              <input
                type="url"
                value={centerEndpoint}
                onChange={(event) => setCenterEndpoint(event.target.value)}
                placeholder="https://center.example"
                autoComplete="url"
                required
              />
              <small>
                Center「连接 Gateway」给出的中心基地址（不含路径）。
              </small>
            </label>
            <label className={styles.field}>
              <span>接入券</span>
              <input
                type="password"
                value={linkToken}
                onChange={(event) => setLinkToken(event.target.value)}
                placeholder="link_..."
                autoComplete="off"
                required
              />
              <small>Center 页一次性展示的接入券（仅本机使用）。</small>
            </label>
            <label className={styles.field}>
              <span>CA 信任锚（control-center.pem）</span>
              <textarea
                value={trustBundle}
                onChange={(event) => setTrustBundle(event.target.value)}
                placeholder="-----BEGIN CERTIFICATE-----"
                rows={6}
                required
              />
              <small>Center 页给出的 CA-S 信任锚 PEM；wist-gwlinkd 会落盘后用作信任根。</small>
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
                接入券只能消费一次，请确认地址与实例一致后再提交。
              </span>
            </div>
          </form>
        </section>

        {status ? (
          <section className={styles.result} aria-live="polite">
            <header className={styles.resultHeader}>
              <div>
                <div className={styles.resultEyebrow}>接入状态</div>
                <h2 className={styles.sectionTitle}>
                  {STATUS_LABEL[status] ?? status}
                </h2>
              </div>
            </header>
            {view.data?.resultDetail ? (
              <p className={styles.statusBanner}>{view.data.resultDetail}</p>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
