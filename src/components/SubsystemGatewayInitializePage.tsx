import { useEffect, useState, type FormEvent } from "react";
import { ApiError, isRateLimitedError } from "../api";
import {
  useAgentAdvertiseUrl,
  useAgentInstallPackage,
  useAgentUplink,
  useSetAgentAdvertiseUrl,
  useSetAgentInstallPackage,
  useSetAgentUplink,
} from "../hooks";
import { CopyButton } from "./CopyButton";
import { RateLimitNotice } from "./RateLimitNotice";
import styles from "./SubsystemGatewayInitializePage.module.css";

/** 未设置时后端给的约定上送端口；表单也从这个值起步。 */
const DEFAULT_PORT = 9000;

/** 关于「未设置」：不是「用默认值」，而是压根没有上送目标。 */
const UPLINK_UNSET_HINT =
  "未设置时没有上送目标：即使派了活，Agent 也只能待命（不向数据面上送）。";

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

/** 安装包来源保存失败时的提示（400 = 地址/摘要不合规，或摘要与来源内容不符；502 = 来源拉不到）。 */
function packageSaveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击“应用”。";
    if (error.status === 429) return "认证失败次数过多，请稍后再试。";
    if (error.status === 404)
      return "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。";
    // 后端已把具体原因写在正文里，优先透出它，操作者才知道该改哪里。
    if (error.detail) return `保存失败（HTTP ${error.status}）：${error.detail}`;
    if (error.status === 400)
      return "地址或摘要不符合要求：地址必须是 https:// 链接或本机绝对路径；摘要必须是 64 位十六进制（可带 sha256: 前缀）。";
    return `网关返回 HTTP ${error.status}，请检查网关日志。`;
  }
  return "保存失败：响应不符合当前契约，请检查网关与前端版本。";
}

/** 上送地址保存失败时的提示（400 = 主机为空或端口越界）。 */
function uplinkSaveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击“应用”。";
    if (error.status === 429) return "认证失败次数过多，请稍后再试。";
    if (error.status === 404)
      return "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。";
    if (error.detail) return `保存失败（HTTP ${error.status}）：${error.detail}`;
    if (error.status === 400)
      return "地址不符合要求：主机不能为空，端口必须是 1–65535 之间的整数。";
    return `网关返回 HTTP ${error.status}，请检查网关日志。`;
  }
  return "保存失败：响应不符合当前契约，请检查网关与前端版本。";
}

/** 网关对外地址保存失败时的提示（400 = 不是 https / 含空白或 shell 元字符 / 超长）。 */
function advertiseSaveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Admin Token 缺失或无效：请在左侧输入正确的 Admin Token 并点击“应用”。";
    if (error.status === 429) return "认证失败次数过多，请稍后再试。";
    if (error.status === 404)
      return "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。";
    if (error.detail) return `保存失败（HTTP ${error.status}）：${error.detail}`;
    if (error.status === 400)
      return "地址不符合要求：必须是 https:// 开头的完整地址（含主机名），且不能含空格、引号、$ 等字符。";
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

/** 端口输入 → 端口号；非法返回 null（与后端 400 的口径一致：1–65535 的整数）。 */
function parsePort(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const port = Number.parseInt(trimmed, 10);
  return port >= 1 && port <= 65535 ? port : null;
}

/** 读取中 / 读取失败的提示条，两项设置共用一个实现。 */
function LoadNotice({
  loading,
  error,
}: {
  loading: boolean;
  error: unknown;
}) {
  if (loading) {
    return (
      <div className={styles.notice} role="status">
        正在读取当前设置…
      </div>
    );
  }
  if (!error) return null;
  if (isRateLimitedError(error)) return <RateLimitNotice error={error} />;
  return (
    <div className={styles.noticeDanger} role="alert">
      {loadErrorMessage(error)}
    </div>
  );
}

/**
 * 「Gateway 初始化」页（路由 `/gateway-init`）：在网关上为后续落地的 Agent 备好三项初始设置。
 *
 * 主体是**网关**，所以名字用 Gateway —— 三项都是网关侧的设置（Agent 连到哪、网关自己从哪
 * 取包、网关给新签发 Agent 预置什么上送目标），不是 Agent 端的配置；
 * 叫「Agent 初始化」会被读成「对 Agent 做初始化」，故不取。
 *
 * ① 网关对外地址 —— 控制平台对目标主机**宣告**的地址，是「新装 Agent 会连到哪」的唯一来源：
 *    渲染成初始配置的 `[control_plane] endpoint`，同时是安装命令 / install.sh / 安装包分发
 *    URL 的基址。未设置时回落配置文件里的 `server.public_base_url`。
 *    放在最前是有意的：地址不对，后面两项 agent 根本看不到。
 * ② 安装包来源 —— 安装端始终从网关自身的分发端点取包，这里配的是**网关的取包来源**：
 *    保存时网关立即把制品拉到本地缓存，新签发的安装命令与 install.sh 随后用这份缓存。
 *    未设置时使用网关内置的安装包。
 * ③ 数据面上送地址 —— Agent 向数据面上送的**目标**（`host:port`），也是网关现算
 *    `uplink:poll` 上送授权时的目标来源。**记录 ≠ 启用**：Agent 默认待命（初始配置写
 *    `enabled = false`），控制面派活后下一个 poll（≤30s）自动带上目标并启用 ——
 *    不需要改 Agent 配置，也不需要重装。
 *
 * ①② 只影响之后新签发的 Agent；③ 是**运行期**的：改一次，已在网的 Agent 下一个 poll
 * （≤30s）就换目标。
 * 一张卡 = 一个设置项：卡头讲状态语义，卡内先给只读的当前值（主值折行显示全，不截断），
 * 再给修改表单。
 *
 * 文案分工（改这一页时别再往回加）：页头只交代这一页管什么，卡头一行说明讲该项的状态语义，
 * 影响面归按钮旁的 hint，细节归字段自己的小字 —— 同一机制在一屏里最多出现两次。
 */
export function SubsystemGatewayInitializePage() {
  const advertise = useAgentAdvertiseUrl();
  const setAdvertise = useSetAgentAdvertiseUrl();
  const installPackage = useAgentInstallPackage();
  const setInstallPackage = useSetAgentInstallPackage();
  const uplink = useAgentUplink();
  const setUplink = useSetAgentUplink();

  const [advertiseUrl, setAdvertiseUrl] = useState("");
  const [packageUrl, setPackageUrl] = useState("");
  // 摘要框恒为「可选的期望值」，默认留空；当前实测摘要只在当前值区只读展示。
  // 不预填实测值是刻意的：把结果值当期望值提交，会在「同一 URL 内容更新」时必然报 400。
  const [packageSha256, setPackageSha256] = useState("");
  const [host, setHost] = useState("");
  // 端口用字符串保存输入过程（"09"、"900" 之类的中间态不该被规范化掉），提交时再解析。
  const [port, setPort] = useState(String(DEFAULT_PORT));

  // 读到管理面设置值后回填。刻意**不**回填 fallback（配置文件里的那个值）：
  // 它代表「没设置」，填进表单再保存会把它钉成显式设置，从此回不到「跟随配置文件」。
  useEffect(() => {
    if (!advertise.data) return;
    setAdvertiseUrl(advertise.data.url);
  }, [advertise.data]);

  // 读到当前来源地址后回填：改摘要不改地址、或在现有地址上微调时不必重新粘贴。
  // 未设置来源地址时服务端返回空串，表单也留空（不要填分发端点 —— 那不是可用的来源）。
  useEffect(() => {
    if (!installPackage.data) return;
    setPackageUrl(installPackage.data.packageUrl);
  }, [installPackage.data]);

  // 读到当前上送地址后回填：只改端口、或微调主机时不必重新输入。
  useEffect(() => {
    if (!uplink.data) return;
    setHost(uplink.data.host);
    setPort(String(uplink.data.port));
  }, [uplink.data]);

  const advertiseUnset = advertise.data ? advertise.data.updatedAt === null : false;
  const currentAdvertiseUrl = advertise.data?.url ?? "";
  // 只读区给「当前生效地址」：设置过就是设置值，没设置就是配置文件里的回落值。
  const effectiveAdvertiseUrl =
    currentAdvertiseUrl || advertise.data?.fallbackUrl || "";
  const canSubmitAdvertise =
    advertiseUrl.trim().length > 0 && !setAdvertise.isPending;

  const currentPackageUrl = installPackage.data?.packageUrl ?? "";
  const canSubmitPackage =
    packageUrl.trim().length > 0 && !setInstallPackage.isPending;

  const portValue = parsePort(port);
  const canSubmitUplink =
    host.trim().length > 0 && portValue !== null && !setUplink.isPending;

  const uplinkUnset = uplink.data ? uplink.data.updatedAt === null : false;
  const currentHost = uplink.data?.host ?? "";
  const currentPort = uplink.data?.port ?? DEFAULT_PORT;
  const currentAddress = currentHost ? `${currentHost}:${currentPort}` : "";

  function handleAdvertiseSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmitAdvertise) return;
    setAdvertise.mutate({ url: advertiseUrl.trim() });
  }

  function handlePackageSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmitPackage) return;
    setInstallPackage.mutate(
      {
        packageUrl: packageUrl.trim(),
        packageSha256: packageSha256.trim() || undefined,
      },
      // 期望值是「这一次保存」的输入：成功后即已用掉，清空以免下次保存又拿旧摘要去校验新内容。
      { onSuccess: () => setPackageSha256("") },
    );
  }

  function handleUplinkSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmitUplink || portValue === null) return;
    setUplink.mutate({ host: host.trim(), port: portValue });
  }

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>Gateway 初始化</h1>
          <p className={styles.pageSummary}>
            网关侧的三项初始设置：Agent 连到哪、安装包从哪取、数据往哪送。三项互相独立，改一项不动另一项。
          </p>
        </header>

        <section className={styles.card} aria-labelledby="gateway-init-advertise">
          <header className={styles.cardHead}>
            <span className={styles.cardTag}>Agent 接入目标</span>
            <h2 id="gateway-init-advertise">网关对外地址</h2>
            <p>
              控制平台对目标主机宣告的地址：新签发的 Agent 按它接入控制面，安装命令与安装包也从这里下载。
            </p>
          </header>

          <dl className={styles.summaryList}>
            <div className={`${styles.summaryRow} ${styles.summaryRowPrimary}`}>
              <dt>当前生效</dt>
              <dd>
                {effectiveAdvertiseUrl ? (
                  <>
                    <span className={styles.summaryValuePrimary}>
                      {effectiveAdvertiseUrl}
                    </span>
                    <CopyButton
                      text={effectiveAdvertiseUrl}
                      label="复制"
                      className={styles.inlineCopyButton}
                    />
                  </>
                ) : (
                  <span className={styles.summaryValueEmpty}>—</span>
                )}
                {advertiseUnset ? (
                  <span className={styles.summaryMeta}>
                    未设置，取自配置文件 server.public_base_url
                  </span>
                ) : null}
              </dd>
            </div>
            <div className={styles.summaryRow}>
              <dt>最后修改</dt>
              <dd>
                <span className={styles.summaryValueMono}>
                  {updatedAtText(advertise.data?.updatedAt ?? null)}
                </span>
                {advertise.data?.updatedBy ? (
                  <span className={styles.summaryMeta}>
                    {advertise.data.updatedBy}
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>

          {advertise.isLoading || advertise.isError ? (
            <div className={styles.summaryNotices}>
              <LoadNotice
                loading={advertise.isLoading}
                error={advertise.isError ? advertise.error : null}
              />
            </div>
          ) : null}

          <form className={styles.form} onSubmit={handleAdvertiseSubmit}>
            <label className={styles.field}>
              <span>对外地址</span>
              <input
                type="text"
                value={advertiseUrl}
                onChange={(event) => setAdvertiseUrl(event.target.value)}
                placeholder="https://gateway.example.com"
                autoComplete="off"
                spellCheck={false}
                required
              />
              <small>
                必须 https，且目标主机能访问到；它会写进 Agent 的控制面配置。填配置文件里的那个值等于显式钉住它。
              </small>
            </label>
            {setAdvertise.isError ? (
              <div className={styles.errorBanner} role="alert">
                {advertiseSaveErrorMessage(setAdvertise.error)}
              </div>
            ) : null}
            {setAdvertise.isSuccess ? (
              <div className={styles.formNotice} role="status">
                {`已保存：之后新签发的安装命令与新装 Agent 都会用 ${setAdvertise.data.url}；已分发的不会改变。`}
              </div>
            ) : null}
            <div className={styles.formActions}>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={!canSubmitAdvertise}
              >
                {setAdvertise.isPending ? "正在保存…" : "保存"}
              </button>
              <span className={styles.actionHint}>
                只影响之后新签发的安装命令与 Agent 配置；已在运行的 Agent 不会改变。
              </span>
            </div>
          </form>
        </section>

        <section className={styles.card} aria-labelledby="gateway-init-package">
          <header className={styles.cardHead}>
            <span className={styles.cardTag}>网关取包来源</span>
            <h2 id="gateway-init-package">安装包来源</h2>
            <p>
              未设置时，网关分发它内置的安装包；设置后，保存时网关立即从该地址拉取制品，失败或摘要不符则整体拒绝。
            </p>
          </header>

          <dl className={styles.summaryList}>
            <div className={`${styles.summaryRow} ${styles.summaryRowPrimary}`}>
              <dt>当前来源</dt>
              <dd>
                {currentPackageUrl ? (
                  <>
                    <span className={styles.summaryValuePrimary}>
                      {currentPackageUrl}
                    </span>
                    <CopyButton
                      text={currentPackageUrl}
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
                  {installPackage.data?.packageSha256 ?? "—"}
                </span>
              </dd>
            </div>
            <div className={styles.summaryRow}>
              <dt>最后修改</dt>
              <dd>
                {/* dt 问的是「什么时候改的」，时间才是这个值；修改人是附带的元信息。 */}
                <span className={styles.summaryValueMono}>
                  {updatedAtText(installPackage.data?.updatedAt ?? null)}
                </span>
                {installPackage.data?.updatedBy ? (
                  <span className={styles.summaryMeta}>
                    {installPackage.data.updatedBy}
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>

          {installPackage.isLoading || installPackage.isError ? (
            <div className={styles.summaryNotices}>
              <LoadNotice
                loading={installPackage.isLoading}
                error={installPackage.isError ? installPackage.error : null}
              />
            </div>
          ) : null}

          <form className={styles.form} onSubmit={handlePackageSubmit}>
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
                /srv/wist/agentd.tar.gz）；网关拒绝明文 http。发布产物是
                tarball（内含 wist-agentd 与 wist-exec），install.sh
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
            {setInstallPackage.isError ? (
              <div className={styles.errorBanner} role="alert">
                {packageSaveErrorMessage(setInstallPackage.error)}
              </div>
            ) : null}
            {setInstallPackage.isSuccess ? (
              <div className={styles.formNotice} role="status">
                已保存：网关已从该来源拉取到本地
                {setInstallPackage.data.packageSha256
                  ? `，制品摘要 ${setInstallPackage.data.packageSha256}。`
                  : "。"}
              </div>
            ) : null}
            <div className={styles.formActions}>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={!canSubmitPackage}
              >
                {setInstallPackage.isPending ? "正在保存…" : "保存"}
              </button>
              <span className={styles.actionHint}>
                只影响之后新签发的安装命令；已分发的不会改变。
              </span>
            </div>
          </form>
        </section>

        <section className={styles.card} aria-labelledby="gateway-init-uplink">
          <header className={styles.cardHead}>
            <span className={styles.cardTag}>Agent 上送目标</span>
            <h2 id="gateway-init-uplink">数据面上送地址</h2>
            <p>
              记录 ≠ 启用：Agent 默认待命，不采集日志也不上送（指标同样不上送）。派活后，
              下一个上报周期（≤30s）Agent 自动带上这个目标开始上送 —— 不需要改 Agent 配置，也不需要重装。
              改这里的地址对**已在网**的 Agent 立即生效。
            </p>
          </header>

          <dl className={styles.summaryList}>
            <div className={`${styles.summaryRow} ${styles.summaryRowPrimary}`}>
              <dt>当前地址</dt>
              <dd>
                {currentAddress ? (
                  <>
                    <span className={styles.summaryValuePrimary}>
                      {currentAddress}
                    </span>
                    <CopyButton
                      text={currentAddress}
                      label="复制"
                      className={styles.inlineCopyButton}
                    />
                  </>
                ) : (
                  <span className={styles.summaryValueEmpty}>
                    未设置（还没有上送目标）
                  </span>
                )}
              </dd>
            </div>
            <div className={styles.summaryRow}>
              <dt>最后修改</dt>
              <dd>
                <span className={styles.summaryValueMono}>
                  {updatedAtText(uplink.data?.updatedAt ?? null)}
                </span>
                {uplink.data?.updatedBy ? (
                  <span className={styles.summaryMeta}>
                    {uplink.data.updatedBy}
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>

          {uplink.isLoading ||
          uplink.isError ||
          (!uplink.isError && uplinkUnset) ? (
            <div className={styles.summaryNotices}>
              <LoadNotice
                loading={uplink.isLoading}
                error={uplink.isError ? uplink.error : null}
              />
              {!uplink.isError && uplinkUnset ? (
                <div className={styles.noticeWarn} role="status">
                  {UPLINK_UNSET_HINT}
                </div>
              ) : null}
            </div>
          ) : null}

          <form className={styles.form} onSubmit={handleUplinkSubmit}>
            <div className={styles.fieldRow}>
              <label className={styles.field}>
                <span>主机</span>
                <input
                  type="text"
                  value={host}
                  onChange={(event) => setHost(event.target.value)}
                  placeholder="数据面主机名或 IP，如 127.0.0.1"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
                <small>
                  Agent 向该主机建立 TCP 连接；填主机名或 IP 均可，不要带 tcp://
                  前缀或端口。
                </small>
              </label>
              <label className={styles.field}>
                <span>端口</span>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  step={1}
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                  placeholder={String(DEFAULT_PORT)}
                  autoComplete="off"
                  required
                />
                <small>数据面接收上送的 TCP 端口，取值 1–65535。</small>
              </label>
            </div>
            {setUplink.isError ? (
              <div className={styles.errorBanner} role="alert">
                {uplinkSaveErrorMessage(setUplink.error)}
              </div>
            ) : null}
            {setUplink.isSuccess ? (
              <div className={styles.formNotice} role="status">
                {`已保存：之后新签发的 Agent 配置会记录该地址 ${setUplink.data.host}:${setUplink.data.port}；Agent 仍处于待命（不采集、不上送），派活后才启用。`}
              </div>
            ) : null}
            <div className={styles.formActions}>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={!canSubmitUplink}
              >
                {setUplink.isPending ? "正在保存…" : "保存"}
              </button>
              <span className={styles.actionHint}>
                只影响之后新签发的 Agent 配置；已在运行的 Agent 不会改变。
              </span>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
