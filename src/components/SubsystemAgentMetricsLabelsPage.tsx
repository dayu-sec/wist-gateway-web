import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, getAdminApiToken, isRateLimitedError } from "../api";
import {
  useAgentMetricsLabels,
  useAgentOverview,
  useClearAgentMetricsLabels,
  useSetAgentMetricsLabels,
} from "../hooks";
import { t } from "../i18n";
import { RateLimitNotice } from "./RateLimitNotice";
import { SubsystemMetricsLabelsForm } from "./SubsystemMetricsLabelsForm";
import { SubsystemMetricsLabelsResult } from "./SubsystemMetricsLabelsResult";
import styles from "./SubsystemAgentMetricsLabelsPage.module.css";

interface SubsystemAgentMetricsLabelsPageProps {
  children?: React.ReactNode;
}

/** 读取失败的口径与其它管理面页面一致（401 最常发生，先说它）。 */
function loadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return t(
        "Admin Token 缺失或无效：请在右上角点钥匙按钮，粘贴 Admin Token 后点击「应用」。",
        "Admin Token missing or invalid: click the key button in the top bar, paste the Admin Token and click “Apply”.",
      );
    }
    if (error.status === 404) {
      return t(
        "网关没有这台 Agent，或网关没有标签接口（HTTP 404）：先确认 agent_id，再检查网关是否为最新构建。",
        "The gateway has no such agent, or no labels endpoint (HTTP 404): check the agent_id, then whether the gateway is a current build.",
      );
    }
    return error.detail
      ? t(
          "读取失败：HTTP {status}（{detail}）",
          "Load failed: HTTP {status} ({detail})",
          { status: error.status, detail: error.detail },
        )
      : t("读取失败：HTTP {status}", "Load failed: HTTP {status}", {
          status: error.status,
        });
  }
  return t(
    "读取失败：响应不符合当前契约，请检查网关与前端版本。",
    "Load failed: the response does not match the current contract; check the gateway and frontend versions.",
  );
}

/**
 * 每机指标标签（选择类 label）。
 *
 * 放在「主机指标」页的下游而不是独立菜单：label 的用途就是**让别人按它查这台机器的指标**，
 * 离开指标语境它只是一张键值表。
 */
export function SubsystemAgentMetricsLabelsPage({}: SubsystemAgentMetricsLabelsPageProps) {
  const { agentId = "" } = useParams<{ agentId: string }>();
  const { data: overview } = useAgentOverview();
  const query = useAgentMetricsLabels(agentId);
  const setMutation = useSetAgentMetricsLabels(agentId);
  const clearMutation = useClearAgentMetricsLabels(agentId);

  const agent = useMemo(
    () => overview?.recentOnlineAgents.find((item) => item.agentId === agentId),
    [agentId, overview],
  );

  const { reset: resetSet } = setMutation;
  const { reset: resetClear } = clearMutation;
  // 换一台机器（路由参数变）就丢掉上一台的保存错误，否则 A 的 400 会挂在 B 的页面上。
  useEffect(() => {
    resetSet();
    resetClear();
  }, [agentId, resetSet, resetClear]);

  const { data, isLoading, isError, error } = query;

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <Link
          className={styles.back}
          to={`/agents/${encodeURIComponent(agentId)}/metrics`}
        >
          <span aria-hidden="true">←</span>{" "}
          {t("返回主机指标", "Back to host metrics")}
        </Link>
        <div className={styles.titleRow}>
          <h1 className={styles.pageTitle}>
            {t("{host} · 指标标签", "{host} · metric labels", {
              host: agent?.hostname || agentId,
            })}
          </h1>
          <Link
            className={styles.crossLink}
            to={`/agents/${encodeURIComponent(agentId)}/work`}
          >
            {t("采集工作", "Collection work")} <span aria-hidden="true">→</span>
          </Link>
          <span className={styles.crossDivider} aria-hidden="true" />
          <Link
            className={styles.crossLink}
            to={`/agents/${encodeURIComponent(agentId)}/purpose`}
          >
            {t("用途", "Purpose")} <span aria-hidden="true">→</span>
          </Link>
        </div>
        <p className={styles.pageSummary}>
          {t(
            '选择类 label 让同一组机器能被一条查询取到：给三台 Kafka 填同一个 cluster、各自的 role，就能用 cluster="kafka-prod" 一次看整组，而不是一台一台查。生效值是三层合并的结果 —— 网关按事实推断（app / role）、部署默认（env 等）、这里的手工覆盖，越靠后优先级越高。',
            'Selection labels let one query reach a whole set of machines: give three Kafka hosts the same cluster and their own role, and cluster="kafka-prod" returns the group at once instead of one host at a time. The effective value merges three layers — gateway inference (app / role), deployment defaults (env etc.) and the manual overrides here, later winning.',
          )}
        </p>
        <p className={styles.metaNote}>
          {t(
            "不自动轮询：标签只在管理面写入时变化，保存后由接口响应直接回填 —— 需要重取用右上角「刷新」。",
            "No automatic polling: labels change only when written from the admin plane, and saves are reflected by the response — refetch with “Refresh” in the top-right corner.",
          )}
        </p>
      </header>

      {isError ? (
        isRateLimitedError(error) ? (
          <div className={styles.noticeWrap}>
            <RateLimitNotice error={error} />
          </div>
        ) : (
          <div className={styles.errorBanner} role="alert">
            {loadErrorMessage(error)}
          </div>
        )
      ) : null}

      {!isError && !isLoading && !data ? (
        <div className={styles.idleNotice} role="status">
          {getAdminApiToken()
            ? t(
                "尚未取到标签数据，用右上角「刷新」重试。",
                "No label data yet; retry with “Refresh” in the top-right corner.",
              )
            : t(
                "未设置 Admin Token：在右上角钥匙按钮里填入后才向管理面请求，这里不会显示数据。",
                "No Admin Token set: the admin plane is only queried once it is entered via the key button in the top bar, so no data is shown here.",
              )}
        </div>
      ) : null}

      {isLoading ? (
        <div className={styles.skeletonWrap}>
          {[0, 1].map((index) => (
            <div key={index} className={styles.skeletonPanel} />
          ))}
        </div>
      ) : null}

      {data ? (
        <div className={styles.body}>
          <SubsystemMetricsLabelsForm
            view={data}
            submitting={setMutation.isPending || clearMutation.isPending}
            error={setMutation.error ?? clearMutation.error ?? undefined}
            onSubmit={(overrides) => setMutation.mutate(overrides)}
            onClear={() => clearMutation.mutate()}
          />
          <SubsystemMetricsLabelsResult view={data} />
        </div>
      ) : null}
    </div>
  );
}
