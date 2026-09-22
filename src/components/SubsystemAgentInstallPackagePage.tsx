import { useEffect, useState, type FormEvent } from "react";
import { ApiError, isRateLimitedError } from "../api";
import { useAgentInstallPackage, useSetAgentInstallPackage } from "../hooks";
import { CopyButton } from "./CopyButton";
import { RateLimitNotice } from "./RateLimitNotice";
import styles from "./SubsystemAgentInstallPackagePage.module.css";

const STEPS = [
  "填入安装包来源（https:// 链接，或网关主机上的绝对路径）",
  "保存时网关立即拉取制品到本地，可先填 sha256 做期望值校验",
  "之后新签发的安装命令与 install.sh 改从网关缓存取包",
];

/** 读取当前设置失败时的提示。 */
function loadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击“应用”。";
    if (error.status === 429) return "认证失败次数过多，请稍后再试。";
    // 404 特指「路由不存在」：网关进程在应答（否则会是网络错误），只是没有这个接口，
    // 绝大多数情况是在跑旧构建的 gateway，而不是服务未启动。
    if (error.status === 404)
      return "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。";
    return error.detail
      ? `网关返回 HTTP ${error.status}：${error.detail}`
      : `网关返回 HTTP ${error.status}，请检查网关日志。`;
  }
  return "读取失败：响应不符合当前契约，请检查网关与前端版本。";
}

/** 保存失败时的提示。 */
function saveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击“应用”。";
    if (error.status === 429) return "认证失败次数过多，请稍后再试。";
    // 同 loadErrorMessage：404 是「路由不存在」，指向旧构建而非服务未启动。
    if (error.status === 404)
      return "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。";
    // 400 = 地址/摘要不符合规则，或摘要与来源内容不符；502 = 来源拉不到。
    // 后端已把具体原因写在正文里，优先透出它，操作者才知道该改哪里。
    if (error.detail)
      return `保存失败（HTTP ${error.status}）：${error.detail}`;
    if (error.status === 400)
      return "地址或摘要不符合要求：地址必须是 https:// 链接或本机绝对路径；摘要必须是 64 位十六进制（可带 sha256: 前缀）。";
    return `网关返回 HTTP ${error.status}，请检查网关日志。`;
  }
  return "保存失败：响应不符合当前契约，请检查网关与前端版本。";
}

function updatedAtText(value: string | null): string {
  if (!value) return "—";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString();
}

/**
 * Agent 安装包来源地址设置页。
 *
 * 安装端始终从网关自身的分发端点取包；这里配置的是**网关的取包来源**：
 * 保存时网关立即把制品拉到本地缓存，新签发的安装命令与 install.sh 随后使用这份缓存。
 * 未设置时使用网关内置的安装包。改动只影响之后新签发的安装代码。
 */
export function SubsystemAgentInstallPackagePage() {
  const current = useAgentInstallPackage();
  const save = useSetAgentInstallPackage();
  const [packageUrl, setPackageUrl] = useState("");
  // 摘要框恒为「可选的期望值」，默认留空；当前实测摘要只在「当前生效」里只读展示。
  // 不预填实测值是刻意的：把结果值当期望值提交，会在「同一 URL 内容更新」时必然报 400。
  const [packageSha256, setPackageSha256] = useState("");

  // 读到当前来源地址后回填：改摘要不改地址、或在现有地址上微调时不必重新粘贴。
  // 未设置来源地址时服务端返回空串，表单也留空（不要填分发端点 —— 那不是可用的来源）。
  useEffect(() => {
    if (!current.data) return;
    setPackageUrl(current.data.packageUrl);
  }, [current.data]);

  const canSubmit = packageUrl.trim().length > 0 && !save.isPending;
  const currentUrl = current.data?.packageUrl ?? "";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    save.mutate(
      {
        packageUrl: packageUrl.trim(),
        packageSha256: packageSha256.trim() || undefined,
      },
      // 期望值是「这一次保存」的输入：成功后即已用掉，清空以免下次保存又拿旧摘要去校验新内容。
      { onSuccess: () => setPackageSha256("") },
    );
  }

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>安装包设置</h1>
          <p className={styles.pageSummary}>
            安装端始终从网关取包；这里设置网关自己从哪儿取包。保存时网关立即把制品拉到本地缓存，
            只影响之后新签发的安装代码。
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
          aria-labelledby="agent-install-package-current"
        >
          <header className={styles.usecaseMeta}>
            <div className={styles.usecaseMetaCopy}>
              <span className={styles.usecaseTag}>当前生效</span>
              <h2 id="agent-install-package-current">网关当前的取包来源</h2>
              <p>
                安装命令与 install.sh 指向的始终是网关自身；
                未设置来源地址时，网关分发的是它内置的安装包。
              </p>
            </div>
          </header>
          <div className={styles.cardBody}>
            <dl className={styles.summaryList}>
              <div
                className={`${styles.summaryRow} ${styles.summaryRowPrimary}`}
              >
                <dt>来源地址</dt>
                <dd>
                  {currentUrl ? (
                    <>
                      <span className={styles.summaryValuePrimary}>
                        {currentUrl}
                      </span>
                      <CopyButton
                        text={currentUrl}
                        label="复制"
                        className={styles.inlineCopyButton}
                      />
                    </>
                  ) : (
                    <span className={styles.summaryValueEmpty}>
                      未设置（使用网关内置包）
                    </span>
                  )}
                </dd>
              </div>
              <div className={styles.summaryRow}>
                <dt>制品摘要</dt>
                <dd>
                  <span className={styles.summaryValueMono}>
                    {current.data?.packageSha256 ?? "—"}
                  </span>
                </dd>
              </div>
              <div className={styles.summaryRow}>
                <dt>最后修改</dt>
                <dd>
                  {/* dt 问的是「什么时候改的」，时间才是这个值；修改人是附带的元信息。 */}
                  <span className={styles.summaryValueMono}>
                    {updatedAtText(current.data?.updatedAt ?? null)}
                  </span>
                  {current.data?.updatedBy ? (
                    <span className={styles.summaryMeta}>
                      {current.data.updatedBy}
                    </span>
                  ) : null}
                </dd>
              </div>
            </dl>
            {current.isLoading ? (
              <div className={styles.notice} role="status">
                正在读取当前设置…
              </div>
            ) : null}
            {current.isError ? (
              isRateLimitedError(current.error) ? (
                <RateLimitNotice error={current.error} />
              ) : (
                <div className={styles.noticeDanger} role="alert">
                  {loadErrorMessage(current.error)}
                </div>
              )
            ) : null}
          </div>
        </section>

        <section
          className={styles.usecaseCard}
          aria-labelledby="agent-install-package-form"
        >
          <header className={styles.usecaseMeta}>
            <div className={styles.usecaseMetaCopy}>
              <span className={styles.usecaseTag}>平台维护操作</span>
              <h2 id="agent-install-package-form">修改来源地址</h2>
              <p>
                保存时网关立即从该地址拉取制品，失败或摘要不符则整体拒绝、不改变现有设置。
              </p>
            </div>
          </header>
          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.field}>
              <span>来源地址</span>
              <input
                type="text"
                value={packageUrl}
                onChange={(event) => setPackageUrl(event.target.value)}
                placeholder="https://mirror.example.com/wist/wist-agentd-<版本>-<arch>.tar.gz"
                autoComplete="off"
                required
              />
              <small>
                https:// 链接，或网关主机上的绝对路径（如
                /srv/wist/agentd.tar.gz）； 网关拒绝明文 http。发布产物是
                tarball（内含 wist-agentd 与 wist-exec）， install.sh
                会自动解包安装。
              </small>
            </label>
            <label className={styles.field}>
              <span>期望摘要 sha256（可选）</span>
              <input
                type="text"
                value={packageSha256}
                onChange={(event) => setPackageSha256(event.target.value)}
                placeholder="64 位十六进制，可带 sha256: 前缀"
                autoComplete="off"
                spellCheck={false}
              />
              <small>
                留空即由网关按拉取到的内容计算并落库；填写则先按此值校验，不符直接拒绝保存。
              </small>
            </label>
            {save.isError ? (
              <div className={styles.errorBanner} role="alert">
                {saveErrorMessage(save.error)}
              </div>
            ) : null}
            {save.isSuccess ? (
              <div className={styles.formNotice} role="status">
                已保存：网关已从该来源拉取到本地
                {save.data.packageSha256
                  ? `，制品摘要 ${save.data.packageSha256}。`
                  : "。"}
              </div>
            ) : null}
            <div className={styles.formActions}>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={!canSubmit}
              >
                {save.isPending ? "正在保存…" : "保存"}
              </button>
              <span className={styles.actionHint}>
                只影响之后新签发的安装代码；已分发的安装命令不会改变。
              </span>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
