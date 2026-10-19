import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError, isRateLimitedError } from "../api";
import type { AgentUplink } from "../api";
import {
  useAgentAdvertiseUrl,
  useAgentUplink,
  useGatewayLinkdStatus,
  useRegisteredAgents,
  useSetAgentUplink,
} from "../hooks";
import { t } from "../i18n";
import { CopyButton } from "./CopyButton";
import { RateLimitNotice } from "./RateLimitNotice";
import { linkdSummary } from "./linkdStatus";
import {
  shouldWarnAboutTurningOnUplink,
  uplinkDraftHost,
  uplinkDraftPort,
  uplinkFormState,
} from "./uplinkForm";
import styles from "./SubsystemGatewayInfoPage.module.css";

/** 关于「未设置」：不是「用默认值」，而是压根没有上送目标。
 * 文案在函数里取词 —— 模块顶层求值一次的话，切语言不会变。 */
function uplinkUnsetHint(): string {
  return t(
    "未设置时没有上送目标：即使派了活、即使打开了开关，Agent 也只能待命（不向数据面上送）。",
    "With no address set there is no reporting target: even with work assigned and the switch on, agents can only stand by (nothing is reported to the data plane).",
  );
}

/** 读取当前设置失败时的提示。 */
function loadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return t(
        "Admin Token 缺失或无效：请在右上角点钥匙按钮，粘贴 Admin Token 后点击“应用”。",
        'Admin Token missing or invalid: click the key button in the top bar, paste the Admin Token and click "Apply".',
      );
    if (error.status === 429)
      return t("认证失败次数过多，请稍后再试。", "Too many failed authentications — try again later.");
    // 404 特指「路由不存在」：网关进程在应答（否则会是网络错误），只是没有这个接口，
    // 绝大多数情况是在跑旧构建的 gateway，而不是服务未启动。
    if (error.status === 404)
      return t(
        "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。",
        "The gateway has no such endpoint (HTTP 404): the running gateway is probably an old build — rebuild and restart the gateway, then retry.",
      );
    return error.detail
      ? t("网关返回 HTTP {status}：{detail}", "Gateway returned HTTP {status}: {detail}", {
          status: error.status,
          detail: error.detail,
        })
      : t("网关返回 HTTP {status}，请检查网关日志。", "Gateway returned HTTP {status} — check the gateway logs.", {
          status: error.status,
        });
  }
  return t(
    "读取失败：响应不符合当前契约，请检查网关与前端版本。",
    "Load failed: the response does not match the current contract — check the gateway and frontend versions.",
  );
}

function updatedAtText(value: string | null): string {
  if (!value) return "—";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString();
}

/** 保存失败时的提示。400 的原因由网关写在正文里（主机/端口的形状要求），原样透出。 */
function saveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400)
      return error.detail ?? t("输入不成立（HTTP 400）。", "Invalid input (HTTP 400).");
    if (error.status === 401)
      return t(
        "Admin Token 缺失或无效：请在右上角点钥匙按钮，粘贴 Admin Token 后点击“应用”。",
        'Admin Token missing or invalid: click the key button in the top bar, paste the Admin Token and click "Apply".',
      );
    if (error.status === 429)
      return t("认证失败次数过多，请稍后再试。", "Too many failed authentications — try again later.");
    if (error.status === 404)
      return t(
        "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。",
        "The gateway has no such endpoint (HTTP 404): the running gateway is probably an old build — rebuild and restart the gateway, then retry.",
      );
    return error.detail
      ? t("网关返回 HTTP {status}：{detail}", "Gateway returned HTTP {status}: {detail}", {
          status: error.status,
          detail: error.detail,
        })
      : t("网关返回 HTTP {status}，请检查网关日志。", "Gateway returned HTTP {status} — check the gateway logs.", {
          status: error.status,
        });
  }
  return t(
    "保存失败：响应不符合当前契约，请检查网关与前端版本。",
    "Save failed: the response does not match the current contract — check the gateway and frontend versions.",
  );
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
        {t("正在读取当前设置…", "Reading current settings…")}
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
 * 「Gateway 信息」页（路由 `/gateway-info`）：网关侧的两项设置 + 宿主侧接入代理状态。
 *
 * 主体是**网关**，所以名字用 Gateway —— 前两项都是网关侧的（Agent 连到哪、数据往哪送），
 * 不是 Agent 端的配置；叫「Agent 信息」会被读成「对 Agent 做的什么」，故不取。
 * 安装包来源已拆回独立页「安装包 / `/install-package`」，不在本页。
 *
 * ① 网关对外地址 —— **只读**：它是部署时配的域名（配置文件里的 `server.public_base_url`，
 *    与网页同一个域名）。它是「新装 Agent 会连到哪」的唯一来源：渲染成初始配置的
 *    `[control_plane] endpoint`，同时是安装命令 / install.sh / 安装包分发 URL 的基址。
 * ② 数据面上送地址 + **启用开关** —— **可写**：Agent 向它建立 TCP 连接上送数据。
 *    两道并集决定「上不上送」：① 该 Agent 有生效工作；② 这里的部署级开关打开。
 *    新装的机器没有活，光靠 ① 会永远待命（注册成功却什么也干不了）——开关就是那个
 *    「开始干活」的明确动作（`docs/design/agent-uplink-enablement.md` §4.1）。
 *    两者都是**运行期**生效：保存后已入网的 Agent 下一个 poll（≤30s）就换目标/换开关，
 *    不需要重装。**记录 ≠ 启用**：网关签发的初始配置永远是待命。
 * ③ 宿主侧接入代理 gwlinkd —— **只读状态**：接入上级由宿主侧常驻 wist-gwlinkd 完成，
 *    它纯出站、页面拉不到它，只能靠它把心跳环回推给网关。与 ①② 不同，这项**不是设置**，
 *    是观测（见设计 `edge/gateway-linkd-status.md` §7）：给证书到期 / 最近上报中心时刻，
 *    失联时予提示。
 *
 * 前两张卡 = 一个设置项（卡头讲该项由什么决定，卡内先给当前生效值（只读），再给可写的表单）；
 * 第三张卡是 gwlinkd 的只读状态，没有可写区。
 *
 * 文本分工（改这一页时别再往回加）：页头只交代这一页管什么（两项设置 + 一项状态），
 * 卡头一行说明讲该项的来路与语义，细节归值旁的 meta 或提示条 —— 同一机制在一屏里最多出现两次。
 */
export function SubsystemGatewayInfoPage() {
  const advertise = useAgentAdvertiseUrl();
  const uplink = useAgentUplink();
  // 宿主侧常驻 gwlinkd 的心跳（由它环回推来）—— 只读观测，与「链接上级」页同一口径。
  const linkdQuery = useGatewayLinkdStatus();
  const linkdView = linkdQuery.data;
  const linkd = linkdSummary(linkdView);
  // 与 ①② 同纪律：**没取到就不下结论**（不能先闪一句「未检测到 gwlinkd」）。
  const linkdReady = Boolean(linkdView);

  // 「未设置」（updated_at 为 null）= 这一项由部署配置决定，不是管理面录入过的值。
  const advertiseFromDeployConfig = advertise.data
    ? advertise.data.updatedAt === null
    : false;
  // 只读区给「当前生效地址」：设置过就是设置值，没设置就是部署配置里的那个值。
  const effectiveAdvertiseUrl =
    (advertise.data?.url ?? "") || (advertise.data?.fallbackUrl ?? "");

  // 还没取到时（读取中 / 读失败）**不下结论**：`undefined` 不等于「未设置」，
  // 也不等于「开关关着」。下面的行一律给 `—`，否则页面会先闪一句假状态。
  const uplinkKnown = Boolean(uplink.data);
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
          <h1 className={styles.pageTitle}>{t("Gateway 信息", "Gateway info")}</h1>
          <p className={styles.pageSummary}>
            {t(
              "网关侧的两项设置：Agent 连到哪（只读，由部署配置决定），以及数据往哪送、收不收（可改，运行期生效）。下方另附宿主侧接入代理 gwlinkd 的运行状态。",
              "Two settings on the gateway side: where agents connect (read-only, determined by the deployment config), and where data is reported and whether it is accepted (editable, effective at runtime). The runtime status of the host-side link agent gwlinkd is shown below.",
            )}
          </p>
        </header>

        <section className={styles.card} aria-labelledby="gateway-info-advertise">
          <header className={styles.cardHead}>
            <span className={styles.cardTag}>{t("Agent 接入目标", "Agent enrollment target")}</span>
            <h2 id="gateway-info-advertise">{t("网关对外地址", "Gateway public address")}</h2>
            {/* 中文长句整句写一行：JSX 里行间换行会折叠成一个可见空格，折在句号/逗号后也一样。 */}
            <p>
              {t(
                "由部署时配的域名决定（配置文件里的 server.public_base_url）：新签发的 Agent 按它接入控制面，安装命令与安装包也从这里下载。要改地址请改部署配置。",
                "Determined by the domain configured at deployment time (server.public_base_url in the config file): newly issued agents use it to enroll with the control plane, and install commands and install packages are downloaded from it. To change the address, change the deployment config.",
              )}
            </p>
          </header>

          <dl className={styles.summaryList}>
            <div className={`${styles.summaryRow} ${styles.summaryRowPrimary}`}>
              <dt>{t("当前生效", "Currently effective")}</dt>
              <dd>
                {effectiveAdvertiseUrl ? (
                  <>
                    <span className={styles.summaryValuePrimary}>
                      {effectiveAdvertiseUrl}
                    </span>
                    <CopyButton
                      text={effectiveAdvertiseUrl}
                      label={t("复制", "Copy")}
                      className={styles.inlineCopyButton}
                    />
                  </>
                ) : (
                  <span className={styles.summaryValueEmpty}>—</span>
                )}
                {advertiseFromDeployConfig ? (
                  <span className={styles.summaryMeta}>
                    {t("来自部署配置 server.public_base_url", "From deployment config server.public_base_url")}
                  </span>
                ) : null}
              </dd>
            </div>
            <div className={styles.summaryRow}>
              <dt>{t("最后修改", "Last modified")}</dt>
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
            <span className={styles.cardTag}>{t("Agent 上送目标", "Agent reporting target")}</span>
            <h2 id="gateway-info-uplink">{t("数据面上送地址与开关", "Data plane reporting address and switch")}</h2>
            <p>
              {t(
                "默认与网关对外地址同一个域名，端口换成数据面端口（同一台机器，即 域名:9000）；数据面不在本机时才需要改。上送由两道并集决定：该 Agent 有生效工作，或这里的开关打开。新装的机器没有活，开关就是那个让它开始干活的明确动作 —— 改动对已在网的 Agent 下一个上报周期（≤30s）生效，不需要重装。",
                "By default it uses the same domain as the gateway public address with the data plane port (on the same host, i.e. domain:9000); it only needs changing when the data plane is not on this host. Reporting is decided by either of two conditions: the agent has effective work, or the switch here is on. A freshly installed host has no work, so this switch is the explicit action that gets it started — changes take effect for enrolled agents on their next reporting cycle (≤30s); no reinstall needed.",
              )}
            </p>
          </header>

          <dl className={styles.summaryList}>
            <div className={`${styles.summaryRow} ${styles.summaryRowPrimary}`}>
              <dt>{t("当前地址", "Current address")}</dt>
              <dd>
                {!uplinkKnown ? (
                  <span className={styles.summaryValueMono}>—</span>
                ) : currentAddress ? (
                  <>
                    <span className={styles.summaryValuePrimary}>
                      {currentAddress}
                    </span>
                    <CopyButton
                      text={currentAddress}
                      label={t("复制", "Copy")}
                      className={styles.inlineCopyButton}
                    />
                  </>
                ) : (
                  <span className={styles.summaryValueEmpty}>
                    {t("未设置（还没有上送目标）", "Not set (no reporting target yet)")}
                  </span>
                )}
                {uplinkFromDeployConfig ? (
                  <span className={styles.summaryMeta}>{t("来自部署配置", "From deployment config")}</span>
                ) : null}
              </dd>
            </div>
            <div className={styles.summaryRow}>
              <dt>{t("开关", "Switch")}</dt>
              <dd>
                {uplinkKnown ? (
                  <span className={styles.summaryValueMono}>
                    {uplink.data?.enabled
                      ? t("已打开：所有 Agent 都上送", "On: all agents report")
                      : t("未打开：按派工启用", "Off: enabled when work is assigned")}
                  </span>
                ) : (
                  <span className={styles.summaryValueMono}>—</span>
                )}
                {uplink.data && !uplink.data.enabledConfigured ? (
                  <span className={styles.summaryMeta}>{t("默认", "Default")}</span>
                ) : null}
              </dd>
            </div>
            <div className={styles.summaryRow}>
              <dt>{t("最后修改", "Last modified")}</dt>
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
                  {uplinkUnsetHint()}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* 可写区：目标与开关共用一行设置，所以同一次提交。
              `key` 装服务端的当前值 —— 保存后（或别处改了）用重挂载拿到新值，
              而不是 `useEffect` 回写输入框：省掉「正在编辑时被后台刷新冲掉」这类竞态。 */}
          {uplink.data && !uplink.isError ? (
            <UplinkForm
              key={`${uplink.data.updatedAt ?? "derived"}:${uplink.data.host}:${uplink.data.port}:${uplink.data.enabled}`}
              setting={uplink.data}
            />
          ) : null}
        </section>

        <section className={styles.card} aria-labelledby="gateway-info-linkd">
          <header className={styles.cardHead}>
            <span className={styles.cardTag}>{t("宿主侧接入代理", "Host-side link agent")}</span>
            <h2 id="gateway-info-linkd">gwlinkd</h2>
            <p>
              {t(
                "把本网关接入上级控制中心的是宿主侧常驻进程 wist-gwlinkd；它纯出站、页面拉不到它，状态由它周期心跳环回推来。完整状态、证书到期与排障见",
                "The host-side resident process wist-gwlinkd links this gateway to the upstream control center; it is outbound-only and cannot be polled by the page, so its status arrives through periodic heartbeat loopback. For full status, certificate expiry and troubleshooting, see the ",
              )}
              <Link className={styles.inlineCardLink} to="/gwlinkd">
                {t("「网关状态」页", "Gateway status page")}
              </Link>
              {t("。", ".")}
            </p>
          </header>

          <dl className={styles.summaryList}>
            <div className={`${styles.summaryRow} ${styles.summaryRowPrimary}`}>
              <dt>{t("状态", "Status")}</dt>
              <dd>
                {linkdReady ? (
                  <span
                    className={`${styles.linkdValue} ${styles[`linkd_${linkd.tone}`]}`}
                    aria-live="polite"
                  >
                    {linkd.label}
                  </span>
                ) : (
                  <span className={styles.summaryValueMono}>—</span>
                )}
              </dd>
            </div>
            <div className={styles.summaryRow}>
              <dt>{t("宿主依赖工具", "Host dependencies")}</dt>
              <dd>
                {linkdView?.hasStatus ? (
                  <span className={styles.summaryValueMono}>
                    gops {linkdView.gopsVersion || t("未检测到", "not found")} · gx{" "}
                    {linkdView.gxVersion || t("未检测到", "not found")}
                  </span>
                ) : (
                  <span className={styles.summaryValueMono}>—</span>
                )}
              </dd>
            </div>
          </dl>

          {linkdQuery.isLoading || linkdQuery.isError ? (
            <div className={styles.summaryNotices}>
              <LoadNotice
                loading={linkdQuery.isLoading}
                error={linkdQuery.isError ? linkdQuery.error : null}
              />
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}

/**
 * 上送目标 + 开关的录入表单。
 *
 * 与「安装包」页那张「添加」表单刻意不同：那张卡是**追加一样新东西**，所以不预填；
 * 这一张是**编辑当前生效的设置** —— 不预填，运维就不知道自己在改什么、改前是什么。
 */
function UplinkForm({ setting }: { setting: AgentUplink }) {
  const setUplink = useSetAgentUplink();
  // 影响面要靠「已注册的 Agent」数：打开开关是全队动作，保存前得把台数说出来。
  const agents = useRegisteredAgents();

  const [host, setHost] = useState(setting.host);
  const [port, setPort] = useState(String(setting.port));
  const [enabled, setEnabled] = useState(setting.enabled);

  const draft = { host, port, enabled };
  // 全部判断都在 `uplinkForm.ts`（纯函数、有单测）：dirty / 校验文案 / 能否提交。
  const { hostOk, portOk, canSubmit, validationError } = uplinkFormState(
    setting,
    draft,
    setUplink.isPending,
  );
  const turningOn = shouldWarnAboutTurningOnUplink(
    setting,
    draft,
    setUplink.isSuccess,
  );
  const affectedAgents = agents.data?.length ?? null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setUplink.mutate({
      host: uplinkDraftHost(draft),
      port: uplinkDraftPort(draft),
      enabled,
    });
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.fieldRow}>
        <label className={styles.field}>
          {t("数据面主机", "Data plane host")}
          <input
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder={t("gw.example.com 或 10.0.0.1", "gw.example.com or 10.0.0.1")}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            // 主机唯一的错就是「空」——所以不与端口同形（端口可以是「非空但非法」）。
            aria-invalid={!hostOk}
          />
          <small>{t("主机名或 IP，不带 scheme、不带端口。", "Host name or IP, without scheme or port.")}</small>
        </label>
        <label className={styles.field}>
          {t("端口", "Port")}
          <input
            value={port}
            onChange={(event) => setPort(event.target.value)}
            placeholder="9000"
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={!portOk && port.length > 0}
          />
          <small>{t("数据面 TCP 入口（wparse 的 tcp source）。", "Data plane TCP entry point (wparse tcp source).")}</small>
        </label>
      </div>

      {/* 校验提示必须**可见**：「保存」被禁用时应让人知道为什么，而不是叫人猜。 */}
      {validationError ? (
        <div className={styles.formHint} role="alert">
          {validationError}
        </div>
      ) : null}

      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <span>
          {t("启用数据面上送（本网关授权的所有 Agent）", "Enable data plane reporting (all agents authorized by this gateway)")}
          <small>
            {t(
              "打开后不必先派工就会上送日志与指标；关掉则回到「派工即启用」。",
              "When on, logs and metrics are reported without assigned work; when off, reporting follows work assignment again.",
            )}
          </small>
        </span>
      </label>

      <div className={styles.formActions}>
        <button type="submit" className={styles.primaryButton} disabled={!canSubmit}>
          {setUplink.isPending ? t("保存中…", "Saving…") : t("保存", "Save")}
        </button>
        <span className={styles.actionHint}>
          {t(
            "保存后对已在网的 Agent 下一个上报周期（≤30s）生效，不需要重装。",
            "Takes effect for enrolled agents on their next reporting cycle (≤30s); no reinstall needed.",
          )}
        </span>
      </div>

      {turningOn ? (
        <div className={styles.noticeWarn} role="status">
          {t(
            "这是一次全队动作：{targets}都会开始上送日志与指标。",
            "This is a fleet-wide action: {targets} will start reporting logs and metrics.",
            {
              targets:
                affectedAgents === null
                  ? t("本网关授权的所有 Agent", "all agents authorized by this gateway")
                  : t(
                      "当前已注册的 {n} 台 Agent",
                      "the {n} agents currently enrolled",
                      { n: affectedAgents },
                    ),
            },
          )}
        </div>
      ) : null}

      {setUplink.isError ? (
        <div className={styles.errorBanner} role="alert">
          {saveErrorMessage(setUplink.error)}
        </div>
      ) : null}
      {setUplink.isSuccess ? (
        <div className={styles.formNotice} role="status">
          {t(
            "已保存：{address}（{state}）",
            "Saved: {address} ({state})",
            {
              address: `${setUplink.data.host}:${setUplink.data.port}`,
              state: setUplink.data.enabled
                ? t("开关已打开", "switch on")
                : t("开关未打开", "switch off"),
            },
          )}
        </div>
      ) : null}
    </form>
  );
}
