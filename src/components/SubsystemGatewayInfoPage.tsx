import { ApiError, isRateLimitedError } from "../api";
import { useAgentAdvertiseUrl, useAgentUplink } from "../hooks";
import { CopyButton } from "./CopyButton";
import { RateLimitNotice } from "./RateLimitNotice";
import styles from "./SubsystemGatewayInfoPage.module.css";

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

function updatedAtText(value: string | null): string {
  if (!value) return "—";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString();
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
 * 「Gateway 信息」页（路由 `/gateway-info`）：**只读**展示网关侧的两项。
 *
 * 主体是**网关**，所以名字用 Gateway —— 两项都是网关侧的（Agent 连到哪、数据往哪送），
 * 不是 Agent 端的配置；叫「Agent 信息」会被读成「对 Agent 做的什么」，故不取。
 * 安装包来源已拆回独立页「安装包 / `/install-package`」，不在本页。
 *
 * 两项都**由部署配置决定**，管理面不再提供录入，本页只展示当前生效值：
 * ① 网关对外地址 —— 部署时配的域名（配置文件里的 `server.public_base_url`，与网页同一个域名）。
 *    它是「新装 Agent 会连到哪」的唯一来源：渲染成初始配置的 `[control_plane] endpoint`，
 *    同时是安装命令 / install.sh / 安装包分发 URL 的基址。
 * ② 数据面上送地址 —— 同一个域名加数据面端口（同一台机器，即 `域名:9000`）。Agent 向它建立
 *    TCP 连接上送数据。**记录 ≠ 启用**：Agent 默认待命（初始配置写 `enabled = false`），
 *    控制面派活后下一个 poll（≤30s）自动带上目标并启用 —— 不需要改 Agent 配置，也不需要重装。
 *
 * 一张卡 = 一个设置项：卡头讲该项由什么决定，卡内只读给出当前值（主值折行显示全，不截断）。
 *
 * 文案分工（改这一页时别再往回加）：页头只交代这一页管什么（两项由部署配置决定、本页只读），
 * 卡头一行说明讲该项的来路与语义，细节归值旁的 meta 或提示条 —— 同一机制在一屏里最多出现两次。
 */
export function SubsystemGatewayInfoPage() {
  const advertise = useAgentAdvertiseUrl();
  const uplink = useAgentUplink();

  // 「未设置」（updated_at 为 null）= 这一项由部署配置决定，不是管理面录入过的值。
  const advertiseFromDeployConfig = advertise.data
    ? advertise.data.updatedAt === null
    : false;
  // 只读区给「当前生效地址」：设置过就是设置值，没设置就是部署配置里的那个值。
  const effectiveAdvertiseUrl =
    (advertise.data?.url ?? "") || (advertise.data?.fallbackUrl ?? "");

  const currentAddress =
    uplink.data && uplink.data.host
      ? `${uplink.data.host}:${uplink.data.port}`
      : "";
  // 有地址但没被管理面改过 = 这个地址来自部署配置。
  const uplinkFromDeployConfig = Boolean(
    uplink.data && uplink.data.host && uplink.data.updatedAt === null,
  );
  // 连地址都没有 = 真的没有上送目标（部署配置里也没给），此时 Agent 只能待命。
  const uplinkMissingTarget = Boolean(uplink.data && !uplink.data.host);

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>Gateway 信息</h1>
          <p className={styles.pageSummary}>
            网关侧的两项：Agent 连到哪、数据往哪送。两项都由部署配置决定 —— 对外同一个域名，上送再加数据面端口；本页只展示当前生效值，不提供录入。
          </p>
        </header>

        <section className={styles.card} aria-labelledby="gateway-info-advertise">
          <header className={styles.cardHead}>
            <span className={styles.cardTag}>Agent 接入目标</span>
            <h2 id="gateway-info-advertise">网关对外地址</h2>
            {/* 中文长句整句写一行：JSX 里行间换行会折叠成一个可见空格，折在句号/逗号后也一样。 */}
            <p>
              由部署时配的域名决定（配置文件里的 server.public_base_url）：新签发的 Agent 按它接入控制面，安装命令与安装包也从这里下载。要改地址请改部署配置。
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
                {advertiseFromDeployConfig ? (
                  <span className={styles.summaryMeta}>
                    来自部署配置 server.public_base_url
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
        </section>

        <section className={styles.card} aria-labelledby="gateway-info-uplink">
          <header className={styles.cardHead}>
            <span className={styles.cardTag}>Agent 上送目标</span>
            <h2 id="gateway-info-uplink">数据面上送地址</h2>
            <p>
              与网关对外地址同一个域名，端口换成数据面端口（同一台机器，即 域名:9000）。改动地址请改部署配置。记录 ≠ 启用：Agent 默认待命，不采集日志也不上送（指标同样不上送）；派活后，下一个上报周期（≤30s）Agent 自动带上这个目标开始上送 —— 不需要改 Agent 配置，也不需要重装。
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
                {uplinkFromDeployConfig ? (
                  <span className={styles.summaryMeta}>来自部署配置</span>
                ) : null}
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

          {uplink.isLoading || uplink.isError || uplinkMissingTarget ? (
            <div className={styles.summaryNotices}>
              <LoadNotice
                loading={uplink.isLoading}
                error={uplink.isError ? uplink.error : null}
              />
              {!uplink.isError && uplinkMissingTarget ? (
                <div className={styles.noticeWarn} role="status">
                  {UPLINK_UNSET_HINT}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
