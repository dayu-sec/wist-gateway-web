import { useCallback, useEffect, useState } from "react";
import { ApiError, fetchHarvestSetting, isRateLimitedError, setHarvestEnabled } from "../api";
import type { HarvestSetting } from "../api";
import { dateLocale, t } from "../i18n";
import { RateLimitNotice } from "./RateLimitNotice";
import styles from "./SubsystemHarvestSettingSection.module.css";

/**
 * 云资产采集（wist-harvest）的开关。
 *
 * 为什么开关在网关而在采集器：一个网关只服务一个客户，客户身份由发送通道打标；
 * 采集器自己每 30 秒来问一次「开不开」（`GET /api/v1/harvest/control`），
 * 所以这里改完**下一拍就生效，不用重建容器、也不用重新部署**。
 *
 * 这里只做一件事：把中心的那一行 `harvest_setting` 读出来 / 写回去。凭据（云账号
 * SecretId/Key）不在这里 —— 那些只存在于宿主 `.wist/sec-value.yml`，页面不碰。
 */

function formatTime(value: string | null): string {
  if (!value) return "—";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString(dateLocale(), { hour12: false });
}

/** 确定性错误直接说「怎么办」，不让运维猜。 */
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
        "网关版本太旧：这个网关还没有采集开关接口（需要 wist-gateway ≥ 0.47）。",
        "This gateway is too old: it has no harvest switch endpoint (requires wist-gateway ≥ 0.47).",
      );
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export function SubsystemHarvestSettingSection() {
  const [setting, setSetting] = useState<HarvestSetting | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSetting(await fetchHarvestSetting());
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(async () => {
    if (setting === null) return;
    setBusy(true);
    try {
      setSetting(await setHarvestEnabled(!setting.enabled));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [setting]);

  const enabled = setting?.enabled ?? false;

  return (
    <section className={styles.card} aria-labelledby="harvest-setting">
      <header className={styles.cardHead}>
        <div className={styles.cardTitleRow}>
          <h2 id="harvest-setting">{t("云资产采集", "Cloud asset harvest")}</h2>
          <span className={styles.cardChip}>
            {loading
              ? t("读取中", "Loading")
              : enabled
                ? t("已开启", "On")
                : t("已关闭", "Off")}
          </span>
        </div>
        <p className={styles.cardNote}>
          {t(
            "wist-harvest 去云 API 拉账号资产（主机 / VPC / 子网 / 公网 IP），再交给数据面写进资产拓扑。开关存在网关这一侧，采集器每 30 秒问一次：改完下一拍生效，不重启容器。",
            "wist-harvest pulls cloud account assets (hosts / VPCs / subnets / EIPs) and hands them to the data plane for the asset topology. The switch lives on the gateway; the collector polls every 30s, so a change takes effect on the next tick without restarting the container.",
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

        <div className={styles.row}>
          <button
            type="button"
            className={`${styles.toggle}${enabled ? "" : ` ${styles.toggleOff}`}`}
            onClick={() => void toggle()}
            disabled={busy || loading || setting === null}
            aria-pressed={enabled}
          >
            {busy
              ? t("提交中…", "Saving…")
              : enabled
                ? t("关闭采集", "Turn off")
                : t("开启采集", "Turn on")}
          </button>
          <span className={styles.meta}>
            {setting?.updatedAt
              ? t("最近修改：{time}", "Last changed: {time}", {
                  time: formatTime(setting.updatedAt),
                })
              : t("还没有改过（默认关闭）", "Never changed (off by default)")}
            {setting?.updatedBy ? ` · ${setting.updatedBy}` : ""}
          </span>
        </div>

        <p className={styles.hint}>
          {t(
            "关闭后采集器不再调度（进程保留、容器不重建）；云账号凭据只存在于宿主的 .wist/sec-value.yml，本页不读取也不保存。",
            "When off, the collector stops scheduling (the process stays up and the container is not recreated). Cloud credentials live only in the host's .wist/sec-value.yml — this page neither reads nor stores them.",
          )}
        </p>
      </div>
    </section>
  );
}
