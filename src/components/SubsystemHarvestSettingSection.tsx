import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  cancelHarvestOneShot,
  createHarvestTicket,
  dispatchHarvestOneShot,
  fetchHarvestOneShots,
  fetchHarvestWorkers,
  fetchHarvestWorks,
  isRateLimitedError,
} from "../api";
import type {
  HarvestOneShot,
  HarvestTicket,
  HarvestWorker,
  HarvestWork,
} from "../api";
import { dateLocale, t } from "../i18n";
import { RateLimitNotice } from "./RateLimitNotice";
import { CopyButton } from "./CopyButton";
import styles from "./SubsystemHarvestSettingSection.module.css";

/**
 * 云资产采集（wist-harvest）的**工作授权**视图。
 *
 * 采集指令不再是一个共享的布尔开关：网关下发 `standing`（采什么 / 什么节奏 / 用哪个凭据引用），
 * 采集器每次 `work:poll` 拉一份、应用后 `ack`；页面上「漂移」= 采集器确认过的版本落后于期望。
 * 云账号凭据**不在这里**（只在宿主 `.wist/sec-value.yml`），本页只签发接入券。
 *
 * 设计：网关仓 `docs/design/harvest-work-grant.md`。
 */

const REFRESH_MS = 30_000;

function formatTime(value: string | null): string {
  if (!value) return "—";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString(dateLocale(), { hour12: false });
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return t(
        "Admin Token 缺失或无效：请在右上角点钥匙按钮，粘贴 Admin Token 后点击“应用”。",
        'Admin Token missing or invalid: click the key button in the top bar, paste the Admin Token and click "Apply".',
      );
    }
    if (error.status === 404) {
      return t(
        "网关版本太旧：还没有 harvest 工作授权接口（需要 wist-gateway ≥ 0.48）。",
        "This gateway is too old: it has no harvest work-grant endpoint (requires wist-gateway ≥ 0.48).",
      );
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function statusLabel(status: string): string {
  switch (status) {
    case "active":
      return t("已接入", "Active");
    case "pending":
      return t("待首次拉取", "Pending");
    case "revoked":
      return t("已吊销", "Revoked");
    case "paused":
      return t("已暂停", "Paused");
    default:
      return status || "—";
  }
}

function ackStateLabel(state: string): string {
  switch (state) {
    case "in_sync":
      return t("已同步", "In sync");
    case "awaiting_ack":
      return t("下发中", "Awaiting ack");
    case "drift":
      return t("漂移", "Drift");
    case "inactive":
      return t("未生效", "Inactive");
    default:
      return state || "—";
  }
}

function cadenceLabel(cadence: HarvestWork["spec"]["cadence"]): string {
  const mode = cadence.mode;
  if (mode === "daily") {
    return t(`每天 ${cadence.at ?? "—"}`, `Daily at ${cadence.at ?? "—"}`);
  }
  if (mode === "interval") {
    return t(`每 ${cadence.seconds ?? 0} 秒`, `Every ${cadence.seconds ?? 0}s`);
  }
  if (mode === "on_demand") {
    return t("仅手动触发", "On demand only");
  }
  return mode || "—";
}

function assetsLabel(assets: string[]): string {
  return assets.length > 0 ? assets.join(" / ") : t("（未选采集面）", "(no asset selected)");
}

function oneShotStatusLabel(status: string): string {
  switch (status) {
    case "dispatched":
      return t("已下发", "Dispatched");
    case "running":
      return t("运行中", "Running");
    case "succeeded":
      return t("成功", "Succeeded");
    case "failed":
      return t("失败", "Failed");
    case "timed_out":
      return t("超时", "Timed out");
    case "canceled":
      return t("已撤回", "Canceled");
    case "expired":
      return t("已过期", "Expired");
    default:
      return status || "—";
  }
}

function oneShotActionLabel(action: string): string {
  if (action === "inventory.rescan") return t("忽略缓存重扫", "Rescan (ignore cache)");
  if (action === "inventory.run") return t("立即采集", "Run now");
  return action || "—";
}

/** 终态：不再变化，也只能读。 */
function oneShotSettled(status: string): boolean {
  return ["succeeded", "failed", "timed_out", "canceled", "expired"].includes(status);
}

export function SubsystemHarvestSettingSection() {
  const [workers, setWorkers] = useState<HarvestWorker[] | null>(null);
  const [works, setWorks] = useState<HarvestWork[] | null>(null);
  const [oneShots, setOneShots] = useState<HarvestOneShot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sourceCode, setSourceCode] = useState("");
  const [ticket, setTicket] = useState<HarvestTicket | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [workerRows, workRows, oneShotRows] = await Promise.all([
        fetchHarvestWorkers(),
        fetchHarvestWorks(),
        fetchHarvestOneShots(),
      ]);
      setWorkers(workerRows);
      setWorks(workRows);
      // 新的在上面：这一栏是「我刚才点的那个跑得怎么样了」，不是归档。
      setOneShots([...oneShotRows].reverse());
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const issueTicket = useCallback(async () => {
    const value = sourceCode.trim();
    if (!value) return;
    setBusy(true);
    try {
      setTicket(await createHarvestTicket(value));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [sourceCode]);

  /** 派一件一次性工作；`key` 让同一时刻只禁用被点的那颗按钮。 */
  const dispatch = useCallback(
    async (workerId: string, action: "inventory.run" | "inventory.rescan") => {
      setPendingAction(`${workerId}:${action}`);
      try {
        await dispatchHarvestOneShot(workerId, action);
        setError(null);
        await load();
      } catch (err) {
        setError(err);
      } finally {
        setPendingAction(null);
      }
    },
    [load],
  );

  const cancel = useCallback(
    async (workId: string) => {
      setPendingAction(workId);
      try {
        await cancelHarvestOneShot(workId);
        setError(null);
        await load();
      } catch (err) {
        setError(err);
      } finally {
        setPendingAction(null);
      }
    },
    [load],
  );

  const workByWorker = new Map((works ?? []).map((work) => [work.workerId, work]));
  const activeWorkers = (workers ?? []).filter((worker) => worker.status === "active").length;

  return (
    <section className={styles.card} aria-labelledby="harvest-setting">
      <header className={styles.cardHead}>
        <div className={styles.cardTitleRow}>
          <h2 id="harvest-setting">{t("云资产采集", "Cloud asset harvest")}</h2>
          <span className={styles.cardChip}>
            {loading
              ? t("读取中", "Loading")
              : t(`${activeWorkers} 个 worker`, `${activeWorkers} worker(s)`)}
          </span>
        </div>
        <p className={styles.cardNote}>
          {t(
            "采集指令由网关下发：worker 拉取 standing（采集面 / 区域 / 节奏 / 凭据引用），应用后确认；「漂移」= 确认过的版本落后于期望。云账号凭据只存在于宿主 .wist/sec-value.yml，本页不读取也不保存。",
            "Work instructions come from the gateway: a worker polls its standing (assets / regions / cadence / credential reference), applies it and acks. Drift means the acknowledged version lags the desired one. Cloud credentials live only in the host's .wist/sec-value.yml — this page neither reads nor stores them.",
          )}
        </p>
      </header>

      <div className={styles.body}>
        {error ? (
          isRateLimitedError(error) ? (
            <RateLimitNotice error={error} />
          ) : (
            <div className={styles.noticeDanger} role="alert">
              {errorMessage(error)}
            </div>
          )
        ) : null}

        {(workers ?? []).length === 0 && !loading ? (
          <p className={styles.hint}>
            {t(
              "还没有 worker 接入。接入是自动的：栈起来时 harvest-bootstrap 会现签一张券、当场换成证书，十几秒内就该出现在这里。表一直是空的，看 docker logs wist-gateway-stack-harvest-bootstrap（下面写了怎么修），不要手工往容器里投券。",
              "No worker enrolled yet. Enrollment is automatic: on stack start harvest-bootstrap mints a ticket and immediately exchanges it for a certificate, so the worker should appear here within seconds. If this table stays empty, read docker logs wist-gateway-stack-harvest-bootstrap (see below) — do not hand-deliver a ticket into the container.",
            )}
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Worker</th>
                <th className={styles.th}>{t("状态", "Status")}</th>
                <th className={styles.th}>{t("采集面 / 节奏", "Assets / cadence")}</th>
                <th className={styles.th}>{t("版本", "Version")}</th>
                <th className={styles.th}>{t("最近心跳", "Last seen")}</th>
                <th className={styles.th}>{t("手动触发", "Manual")}</th>
              </tr>
            </thead>
            <tbody>
              {(workers ?? []).map((worker) => {
                const work = workByWorker.get(worker.workerId);
                return (
                  <tr key={worker.workerId}>
                    <td className={styles.td}>
                      <div>{worker.sourceCode}</div>
                      <div className={styles.meta}>{worker.workerId}</div>
                    </td>
                    <td className={styles.td}>
                      <span className={styles.badge}>{statusLabel(worker.status)}</span>
                      {work ? (
                        <span
                          className={
                            work.ackState === "drift"
                              ? `${styles.badge} ${styles.badgeWarn}`
                              : styles.badge
                          }
                        >
                          {ackStateLabel(work.ackState)}
                        </span>
                      ) : null}
                    </td>
                    <td className={styles.td}>
                      {work ? (
                        <>
                          <div>{assetsLabel(work.spec.assets)}</div>
                          <div className={styles.meta}>
                            {cadenceLabel(work.spec.cadence)} ·{" "}
                            {typeof work.spec.regions === "string"
                              ? work.spec.regions
                              : work.spec.regions.join(", ")}
                            {work.spec.credentialRef
                              ? ` · ${t("凭据", "credential")} ${work.spec.credentialRef}`
                              : ""}
                          </div>
                          {work.spec.assets.length === 0 ? (
                            <div className={styles.meta}>
                              {t("⚠ 没有选采集面，这一轮什么也不会采", "⚠ no asset selected — this grant collects nothing")}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <span className={styles.meta}>{t("未授权", "Not granted")}</span>
                      )}
                    </td>
                    <td className={styles.td}>
                      {work ? (
                        <>
                          <div>
                            plan v{work.planVersion}
                            {work.ack ? ` · ack v${work.ack.planVersion}` : ` · ${t("未确认", "No ack")}`}
                          </div>
                          <div className={styles.meta}>{statusLabel(work.status)}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={styles.td}>{formatTime(worker.lastSeenAt)}</td>
                    <td className={styles.td}>
                      {worker.status === "revoked" ? (
                        <span className={styles.meta}>{t("已吊销", "Revoked")}</span>
                      ) : (
                        <div className={styles.row}>
                          <button
                            type="button"
                            className={styles.toggle}
                            disabled={pendingAction !== null}
                            onClick={() => void dispatch(worker.workerId, "inventory.run")}
                            title={t(
                              "按当前授权跑一轮（增量，可续跑）",
                              "Run one round with the current grant (incremental, resumable)",
                            )}
                          >
                            {pendingAction === `${worker.workerId}:inventory.run`
                              ? t("下发中…", "Dispatching…")
                              : t("立即采集", "Run now")}
                          </button>
                          <button
                            type="button"
                            className={styles.toggle}
                            disabled={pendingAction !== null}
                            onClick={() => void dispatch(worker.workerId, "inventory.rescan")}
                            title={t(
                              "忽略可续跑缓存，强制开新快照（下游按幂等键去重）",
                              "Ignore the resumable cache and start a fresh snapshot (downstream dedupes by key)",
                            )}
                          >
                            {pendingAction === `${worker.workerId}:inventory.rescan`
                              ? t("下发中…", "Dispatching…")
                              : t("忽略缓存重扫", "Rescan")}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {oneShots.length > 0 ? (
          <>
            <div className={styles.cardTitleRow}>
              <h2>{t("手动触发记录", "Manual runs")}</h2>
            </div>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>{t("动作", "Action")}</th>
                  <th className={styles.th}>{t("状态", "Status")}</th>
                  <th className={styles.th}>{t("结果说明", "Detail")}</th>
                  <th className={styles.th}>{t("下发时间", "Issued")}</th>
                  <th className={styles.th}>{t("截止", "Deadline")}</th>
                  <th className={styles.th}>{t("操作", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {oneShots.map((entry) => {
                  const settled = oneShotSettled(entry.status);
                  return (
                    <tr key={entry.workId}>
                      <td className={styles.td}>
                        <div>{oneShotActionLabel(entry.action)}</div>
                        <div className={styles.meta}>{entry.workerId}</div>
                      </td>
                      <td className={styles.td}>
                        <span
                          className={
                            entry.status === "failed" || entry.status === "expired"
                              ? `${styles.badge} ${styles.badgeWarn}`
                              : styles.badge
                          }
                        >
                          {oneShotStatusLabel(entry.status)}
                        </span>
                      </td>
                      <td className={styles.td}>
                        {entry.result?.detail ? (
                          <span className={styles.meta}>{entry.result.detail}</span>
                        ) : (
                          <span className={styles.meta}>
                            {settled
                              ? "—"
                              : t("等待采集器上报", "Waiting for the collector")}
                          </span>
                        )}
                      </td>
                      <td className={styles.td}>{formatTime(entry.issuedAt)}</td>
                      <td className={styles.td}>{formatTime(entry.deadlineAt)}</td>
                      <td className={styles.td}>
                        {settled ? (
                          <span className={styles.meta}>{t("已结束", "Settled")}</span>
                        ) : (
                          <button
                            type="button"
                            className={styles.toggle}
                            disabled={pendingAction !== null}
                            onClick={() => void cancel(entry.workId)}
                          >
                            {pendingAction === entry.workId
                              ? t("撤回中…", "Canceling…")
                              : t("撤回", "Cancel")}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : null}

        <div className={styles.row}>
          <input
            className={styles.input}
            value={sourceCode}
            onChange={(event) => setSourceCode(event.target.value)}
            placeholder={t("source_code（如 tencent-cloud-prod）", "source_code (e.g. tencent-cloud-prod)")}
            aria-label={t("数据源标识", "Source code")}
          />
          <button
            type="button"
            className={styles.toggle}
            onClick={() => void issueTicket()}
            disabled={busy || sourceCode.trim().length === 0}
          >
            {busy ? t("签发中…", "Issuing…") : t("签发接入券", "Issue enrollment ticket")}
          </button>
        </div>

        <div className={styles.guide}>
          <p className={styles.guideTitle}>{t("这张券是什么，什么时候用", "What this ticket is, and when it matters")}</p>
          <ul className={styles.guideList}>
            <li>
              {t(
                "正常不用你管：栈起来时 harvest-bootstrap 会用管理面 token 现签一张券、当场换成客户端证书（券只在内存里活几秒，不落盘），换取成功后才拉起采集器。",
                "Normally nothing for you to do: on stack start, harvest-bootstrap mints a ticket with the admin token and immediately exchanges it for a client certificate (the ticket lives in memory for seconds and never touches disk); the collector is only started after that succeeds.",
              )}
            </li>
            <li>
              {t(
                "在这里签发只为两件事：留痕（库里只存券的 sha256，能查谁在何时给哪个 source_code 签过）与排障核对。它不是你要投给采集器的凭据 —— 栈内没有人工投券这条路。",
                "Issuing here is only for audit (the store keeps just the sha256, so you can see who signed a ticket for which source_code and when) and for troubleshooting. It is not a credential you deliver to the collector — inside the stack there is no manual delivery path.",
              )}
            </li>
          </ul>

          <p className={styles.guideTitle}>{t("表一直是空的怎么查", "If the worker table stays empty")}</p>
          <ol className={styles.guideList}>
            <li>
              {t(
                "看接入那一步的日志：docker logs wist-gateway-stack-harvest-bootstrap —— 成功会打「已接入网关」与「已建立初始 standing」。",
                "Read the enrollment step's log: docker logs wist-gateway-stack-harvest-bootstrap — success prints 已接入网关 and 已建立初始 standing.",
              )}
              <pre className={styles.guideCode}>{"docker logs wist-gateway-stack-harvest-bootstrap"}</pre>
            </li>
            <li>
              {t(
                "按日志修输入，三样里基本是其一：管理面 token（栈根 .wist/sec-value.yml 的 admin_token）、网关地址（由 WEB_DOMAIN 推导）、服务端信任锚（identity/gateway/public）。",
                "Fix the input the log points at — almost always one of three: the admin token (admin_token in the stack root's .wist/sec-value.yml), the gateway endpoint (derived from WEB_DOMAIN), or the server trust anchor (identity/gateway/public).",
              )}
            </li>
            <li>
              {t(
                "改完 gops run start：harvest-bootstrap 每次启动都会重新接入，不用重启整栈，也不用投券。",
                "Then gops run start: harvest-bootstrap re-enrolls on every start — no need to restart the whole stack, and no ticket to deliver.",
              )}
            </li>
          </ol>

          <p className={styles.hint}>
            {t(
              "券一次一用、默认 24 小时（最长 7 天）：过期就重签一张。券不进 .wist/sec-value.yml —— 那里放的是 admin token 与云账号凭据这类要轮换、要进备份的长期密钥。",
              "A ticket is single-use and expires in 24h by default (7d max): issue a new one when it expires. Tickets never go into .wist/sec-value.yml — that file holds long-lived secrets that must be rotated and backed up (admin token, cloud credentials).",
            )}
          </p>
        </div>

        {ticket ? (
          <div className={styles.ticketBox}>
            <div className={styles.meta}>
              {t(
                "只能看这一次：离开本页就不再有，需要再用请重新签发。",
                "Shown only once: it is gone when you leave this page — issue a new one if you need it again.",
              )}
            </div>
            <div className={styles.row}>
              <code className={styles.code}>{ticket.ticket}</code>
              <CopyButton
                text={ticket.ticket}
                label={t("复制券", "Copy ticket")}
                className={styles.toggle}
              />
            </div>
            <div className={styles.meta}>
              {ticket.workerId} · {t("到期", "expires")} {formatTime(ticket.expiresAt)}
            </div>
            <div className={styles.meta}>
              {t(
                "这张券对应 bootstrap 要用的那张一次性凭据：库里只存 sha256（留痕可核对），明文只在这里显示一次。",
                "This is the one-shot credential bootstrap uses: only its sha256 is stored (for audit), and the plaintext is shown here once.",
              )}
            </div>
          </div>
        ) : null}

        <p className={styles.hint}>
          {t(
            "一次性动作由网关派发、采集器执行并上报结果：「立即采集」按当前授权跑一轮（可续跑），「忽略缓存重扫」强制开新快照。两者只影响这一轮，不改常驻授权。",
            "One-shot actions are dispatched by the gateway, executed by the collector and reported back. Run now collects one round with the current grant (resumable); Rescan forces a fresh snapshot. Neither changes the standing grant.",
          )}
        </p>
      </div>
    </section>
  );
}
