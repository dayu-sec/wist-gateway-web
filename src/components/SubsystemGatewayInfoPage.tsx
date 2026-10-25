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

/**
 * 「这一行什么时候、由谁改的」：列为 null = 不是管理面录入的（值来自部署配置）。
 * 与页面上「来源」是同一个判据（`updatedAt`），不另造一套。
 */
function modifiedText(updatedAt: string | null, updatedBy: string): string {
  if (!updatedAt) return t("部署配置 · 未修改", "Deployment config, never edited");
  return updatedBy ? `${updatedAtText(updatedAt)} · ${updatedBy}` : updatedAtText(updatedAt);
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

/** 读取中 / 读取失败的提示条，三处查询共用一个实现。 */
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
 * 「Gateway 信息」页（路由 `/gateway-info`）。
 *
 * 信息按**用途**分三段，不再按「一个设置一张卡」：
 *
 * ① 当前配置（只读，一张两列的表）—— 一眼看清现在用的两个地址与开关状态，
 *    右侧一列是来源/修改时间。两个地址放在同一张表里，是因为它们回答同一个问题
 *    「Agent 连哪、数据送哪」，分开成两张卡只会让读者来回对照。
 * ② 修改上送设置（可写）—— 只有上送目标与开关；对外地址由部署配置决定
 *    （`server.public_base_url`，改它要换域名与证书），管理面没有录入入口。
 * ③ 接入上级（只读状态）—— 宿主侧常驻 gwlinkd 由心跳环回推状态，纯观测。
 *
 * 文本分工（改这一页时别再往回加）：卡头只留一句「这项是什么/由谁决定」，
 * 「两道并集」「≤30s 生效」这类机制说明各自只出现一次 —— 上送机制在上送卡，
 * 地址来源在配置卡，链路机制在状态卡。表单不再重复卡头已经说过的后果。
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
  // 连地址都没有 = 真的没有上送目标（部署配置里也没给），此时 Agent 只能待命。
  const uplinkMissingTarget = Boolean(uplink.data && !uplink.data.host);
  const uplinkEnabled = Boolean(uplink.data?.enabled);

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>{t("Gateway 信息", "Gateway info")}</h1>
          <p className={styles.pageSummary}>
            {t(
              "网关的接入地址、上送目标与开关，以及宿主侧接入代理的运行状态。",
              "The gateway's enrollment address, reporting target and switch, plus the host-side link agent's status.",
            )}
          </p>
        </header>

        <section className={styles.card} aria-labelledby="gateway-info-current">
          <header className={styles.cardHead}>
            <div className={styles.cardTitleRow}>
              <h2 id="gateway-info-current">{t("当前配置", "Current settings")}</h2>
              <span className={styles.cardChip}>{t("只读", "Read-only")}</span>
            </div>
            <p className={styles.cardNote}>
              {t(
                "接入地址由部署配置 server.public_base_url 决定（改它要换域名和证书）；上送目标默认取同一域名加数据面端口，数据面不在本机时才需要改。",
                "The enrollment address is set by server.public_base_url in the deployment config (changing it means a new domain and certificate); the reporting target defaults to the same domain plus the data plane port, and only needs changing when the data plane is not on this host.",
              )}
            </p>
          </header>

          <dl className={styles.configList}>
            <div className={styles.configRow}>
              <dt>{t("接入地址", "Enrollment address")}</dt>
              <dd className={styles.configValue}>
                {effectiveAdvertiseUrl ? (
                  <>
                    <span className={styles.configValueText}>{effectiveAdvertiseUrl}</span>
                    <CopyButton
                      text={effectiveAdvertiseUrl}
                      label={t("复制", "Copy")}
                      className={styles.inlineCopyButton}
                    />
                  </>
                ) : (
                  <span className={styles.configValueEmpty}>—</span>
                )}
              </dd>
              <dd className={styles.configMeta}>
                {advertise.data
                  ? modifiedText(advertise.data.updatedAt, advertise.data.updatedBy)
                  : "—"}
              </dd>
            </div>

            <div className={styles.configRow}>
              <dt>{t("上送地址", "Reporting address")}</dt>
              <dd className={styles.configValue}>
                {!uplinkKnown ? (
                  <span className={styles.configValueEmpty}>—</span>
                ) : currentAddress ? (
                  <>
                    <span className={styles.configValueText}>{currentAddress}</span>
                    <CopyButton
                      text={currentAddress}
                      label={t("复制", "Copy")}
                      className={styles.inlineCopyButton}
                    />
                  </>
                ) : (
                  <span className={styles.configValueWarn}>
                    {t("未设置（还没有上送目标）", "Not set (no reporting target yet)")}
                  </span>
                )}
              </dd>
              <dd className={styles.configMeta}>
                {uplink.data ? modifiedText(uplink.data.updatedAt, uplink.data.updatedBy) : "—"}
              </dd>
            </div>

            <div className={styles.configRow}>
              <dt>{t("上送开关", "Reporting switch")}</dt>
              <dd className={styles.configValue}>
                {uplinkKnown ? (
                  <span className={`${styles.switchState} ${uplinkEnabled ? styles.switchOn : ""}`}>
                    {uplinkEnabled
                      ? t("已打开：所有 Agent 都上送", "On: all agents report")
                      : t("未打开：按派工启用", "Off: enabled when work is assigned")}
                  </span>
                ) : (
                  <span className={styles.configValueEmpty}>—</span>
                )}
              </dd>
              <dd className={styles.configMeta}>
                {uplink.data && !uplink.data.enabledConfigured
                  ? t("默认（未录入）", "Default (not set)")
                  : null}
              </dd>
            </div>
          </dl>

          {advertise.isLoading ||
          advertise.isError ||
          uplink.isLoading ||
          uplink.isError ||
          uplinkMissingTarget ? (
            <div className={styles.notices}>
              {/* 两项设置是同一个页面的同一批请求：都还在读时只提示一次，
                  不要把「正在读取当前设置…」并排叠两条。 */}
              {advertise.isLoading || uplink.isLoading ? (
                <LoadNotice loading error={null} />
              ) : null}
              {advertise.isError || uplink.isError ? (
                <LoadNotice
                  loading={false}
                  error={advertise.isError ? advertise.error : uplink.error}
                />
              ) : null}
              {!uplink.isError && uplinkMissingTarget ? (
                <div className={styles.noticeWarn} role="status">
                  {uplinkUnsetHint()}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* 读不到当前值时整张卡不出现：空表单会让人以为「可以填了」——
            读取失败的原因在上一张卡的提示条里，别在这里再重复一遍。 */}
        {uplink.data && !uplink.isError ? (
          <section className={styles.card} aria-labelledby="gateway-info-uplink">
            <header className={styles.cardHead}>
              <div className={styles.cardTitleRow}>
                <h2 id="gateway-info-uplink">{t("修改上送设置", "Edit reporting settings")}</h2>
                <span className={styles.cardChip}>{t("可改", "Editable")}</span>
              </div>
              <p className={styles.cardNote}>
                {t(
                  "上送按「该 Agent 有生效工作」或「这里的开关打开」二者之一放行 —— 新装的机器没有活，开关就是让它开始干活的动作。保存后对已在网 Agent 的下一个上报周期（≤30s）生效，不需要重装。",
                  "Reporting is allowed when the agent has effective work or when this switch is on — a freshly installed host has no work, so the switch is the explicit action that gets it started. Changes take effect for enrolled agents on their next reporting cycle (≤30s); no reinstall needed.",
                )}
              </p>
            </header>

            {/* 可写区：目标与开关共用一行设置，所以同一次提交。
                `key` 装服务端的当前值 —— 保存后（或别处改了）用重挂载拿到新值，
                而不是 `useEffect` 回写输入框：省掉「正在编辑时被后台刷新冲掉」这类竞态。 */}
            <UplinkForm
              key={`${uplink.data.updatedAt ?? "derived"}:${uplink.data.host}:${uplink.data.port}:${uplink.data.enabled}`}
              setting={uplink.data}
            />
          </section>
        ) : null}

        <section className={styles.card} aria-labelledby="gateway-info-linkd">
          <header className={styles.cardHead}>
            <div className={styles.cardTitleRow}>
              <h2 id="gateway-info-linkd">{t("接入上级", "Upstream link")}</h2>
              <span className={styles.cardChip}>{t("状态", "Status")}</span>
            </div>
            <p className={styles.cardNote}>
              {t(
                "由宿主侧常驻进程 wist-gwlinkd 把本网关接入上级控制中心：它纯出站、页面拉不到它，状态靠它周期心跳环回推来。",
                "The host-side resident process wist-gwlinkd links this gateway to the upstream control center: it is outbound-only and cannot be polled by the page, so its status arrives through periodic heartbeat loopback.",
              )}
            </p>
          </header>

          <div className={styles.linkdBody}>
            <span
              className={`${styles.linkdValue} ${linkdReady ? styles[`linkd_${linkd.tone}`] : ""}`}
              aria-live="polite"
            >
              {linkdReady ? linkd.label : "—"}
            </span>
            {linkdReady ? (
              <span className={styles.linkdDetail}>{linkd.detail}</span>
            ) : null}
            {linkdView?.hasStatus ? (
              <span className={styles.linkdMeta}>
                {t("宿主依赖", "Host tools")} gops {linkdView.gopsVersion || t("未检测到", "not found")} · gx{" "}
                {linkdView.gxVersion || t("未检测到", "not found")}
              </span>
            ) : null}
            <Link className={styles.linkdLink} to="/gwlinkd">
              {t("查看「网关状态」页", "Gateway status page")}
              <span aria-hidden="true"> →</span>
            </Link>
          </div>

          {linkdQuery.isLoading || linkdQuery.isError ? (
            <div className={styles.notices}>
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
 *
 * 这里不再重复卡头已经说过的机制（两道并集 / ≤30s）：同一个后果在一屏里说两遍，
 * 读者会以为它们不是同一件事。
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
        </span>
      </label>

      <div className={styles.formActions}>
        <button type="submit" className={styles.primaryButton} disabled={!canSubmit}>
          {setUplink.isPending ? t("保存中…", "Saving…") : t("保存", "Save")}
        </button>
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
