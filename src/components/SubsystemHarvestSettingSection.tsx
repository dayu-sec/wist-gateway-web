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
              "还没有 worker 接入。同栈部署不需要人工介入：harvest-bootstrap 会在十几秒内自己换取证书并出现在这里；表一直是空的，先看采集器日志（容器没起来 / 连不上网关 / CA 不匹配），别急着签券。只有跨机部署、或采集器身份丢了，才用下面的接入券。",
              "No worker enrolled yet. A same-stack deployment needs no manual step: harvest-bootstrap enrolls by itself within seconds and shows up here. If this table stays empty, read the collector log first (container not up / cannot reach the gateway / CA mismatch) instead of issuing a ticket. The ticket below is only for cross-host deployments or a lost collector identity.",
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
          <p className={styles.guideTitle}>{t("什么时候需要这张券", "When you need a ticket")}</p>
          <ul className={styles.guideList}>
            <li>
              {t(
                "不需要：这台采集器已经在上面的表里 —— 身份就是 state/identity/ 里的证书，重启、重建容器都不丢。",
                "Not needed when the collector is already in the table above: its identity is the certificate under state/identity/, which survives restarts and container rebuilds.",
              )}
            </li>
            <li>
              {t(
                "需要：跨机第一次接入，或 state/identity/ 被删 / 换了机器。判据只有一条 —— 采集器手上还没有网关签发的客户端证书。",
                "Needed for a first cross-host enrollment, or after state/identity/ was deleted / the host was replaced. One test: the collector does not hold a client certificate issued by the gateway yet.",
              )}
            </li>
          </ul>

          <p className={styles.guideTitle}>{t("怎么用", "How to use it")}</p>
          <ol className={styles.guideList}>
            <li>
              {t(
                "在上面填 source_code，点「签发接入券」，复制券（只显示这一次）。",
                "Fill in source_code above, press Issue enrollment ticket, copy the ticket (shown only once).",
              )}
            </li>
            <li>
              {t(
                "在采集器那台机器上落成一个 0600 的文件 —— 属主必须是容器的运行身份（本栈是 999:999），否则采集器读不到会当成「没有券」。本栈的宿主路径是 <栈根>/harvest-run/state/enroll.ticket（容器内 /var/lib/wist-harvest/state/enroll.ticket）；其他部署换成采集器的 state_dir 与它自己的 uid:gid。下一拍（≤30 秒）就读到，换到证书后文件自动删除，不用重启容器：",
                "Drop it as a 0600 file on the collector host, owned by the container's runtime uid (999:999 in this stack) — otherwise the collector silently treats it as missing. In this stack the host path is <stack root>/harvest-run/state/enroll.ticket (container: /var/lib/wist-harvest/state/enroll.ticket); for other deployments use the collector's state_dir and its own uid:gid. The next attempt (≤30s) picks it up, the file is deleted once the certificate is obtained, and no restart is needed:",
              )}
              <pre className={styles.guideCode}>
                {"install -m 600 -o 999 -g 999 /dev/stdin \\\n  <栈根>/harvest-run/state/enroll.ticket <<'EOF'\nhwt_…\nEOF"}
              </pre>
            </li>
            <li>
              {t(
                "成功的样子：上面的表出现该 source_code 的 worker，状态 pending → active，plan/ack 版本出现，「最近心跳」开始走。",
                "Success looks like: a worker with that source_code shows up above, goes pending → active, plan/ack versions appear and Last seen starts moving.",
              )}
            </li>
          </ol>

          <p className={styles.hint}>
            {t(
              "券一次一用、默认 24 小时（最长 7 天）：换证失败（网络不通 / 时钟偏差 / CA 不匹配）或过期，就重新签一张，不要拿同一张重试。也可以一次性地用环境变量 HARVEST_ENROLL_TICKET=… 传，但它会留在 shell 历史与 docker inspect 里，不如文件。券不进 .wist/sec-value.yml —— 那里放的是 admin token 与云账号凭据这类要轮换、要进备份的长期密钥。",
              "A ticket is single-use and expires in 24h by default (7d max): if enrollment fails (gateway unreachable / clock skew / CA mismatch) or it expires, issue a new one instead of retrying the same. You can also pass it once via HARVEST_ENROLL_TICKET=…, but that lingers in shell history and docker inspect — the file is better. Tickets never go into .wist/sec-value.yml: that file holds long-lived secrets that must be rotated and backed up (admin token, cloud credentials).",
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
