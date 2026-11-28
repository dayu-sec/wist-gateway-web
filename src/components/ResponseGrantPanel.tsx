import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  ApiError,
  fetchResponseGrant,
  getAdminApiToken,
  type AgentListEntryView,
  type ResponseGrantState,
  type ResponseGrantView,
} from "../api";
import {
  usePutResponseGrant,
  useRegisteredAgents,
  useRevokeResponseGrant,
} from "../hooks";
import { dateLocale, t } from "../i18n";
import { summarizeAddresses } from "../lib/format";
import styles from "./ResponseGrantPanel.module.css";

/** 与采集/调查授权一致：没有机队级聚合接口，一次最多看这么多台。 */
const HOST_LIMIT = 40;

/** 一期授权单能覆盖的最高风险（与网关 `MAX_GRANT_RISK` 对齐）。 */
const MAX_GRANT_RISK = "R2";

const RISK_OPTIONS = ["R0", "R1", "R2"] as const;

/** 时长预设（分钟）。最短 15min、最长 7d —— 与网关的上下界一致。 */
const DURATION_OPTIONS = [15, 60, 24 * 60, 7 * 24 * 60] as const;

function durationLabel(minutes: number): string {
  if (minutes < 60) return t("{n} 分钟", "{n} min", { n: minutes });
  if (minutes < 24 * 60) return t("{n} 小时", "{n} h", { n: minutes / 60 });
  return t("{n} 天", "{n} d", { n: minutes / (24 * 60) });
}

function stateLabel(state: ResponseGrantState): string {
  switch (state) {
    case "active":
      return t("生效中", "Active");
    case "pending":
      return t("未到生效时间", "Not yet valid");
    case "expired":
      return t("已过期", "Expired");
    case "revoked":
      return t("已撤销", "Revoked");
    default:
      return state;
  }
}

function stateClass(state: ResponseGrantState | "none"): string {
  switch (state) {
    case "active":
      return styles.stateOn;
    case "pending":
      return styles.statePending;
    case "expired":
    case "revoked":
      return styles.stateOff;
    default:
      return styles.stateNone;
  }
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(dateLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

/** 授权相关的失败提示。业务码直接翻成人话，别把英文原文抛给运维。 */
function grantErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return t(
        "Admin Token 缺失或无效：请在右上角点钥匙按钮，粘贴 Admin Token 后点击“应用”。",
        "Admin Token missing or invalid: click the key button in the top bar, paste the Admin Token and click “Apply”.",
      );
    }
    if (error.status === 429) {
      return t(
        "认证失败次数过多，请稍后再试。",
        "Too many failed authentication attempts. Try again later.",
      );
    }
    switch (error.code) {
      case "response_grant_invalid":
        return t(
          "参数不合法：风险上限最高 R2，时长必须在 15 分钟到 7 天之间；opcode 白名单不能为空数组。",
          "Invalid parameters: max risk is R2, duration must be 15 minutes to 7 days, and an opcode allow-list must not be empty.",
        );
      case "response_grant_store_failed":
        return t(
          "网关读写授权单失败（可能是磁盘或权限问题）。检查网关日志后重试。",
          "The gateway failed to read or write the grant (likely disk or permission issues). Check the gateway logs and retry.",
        );
      case "agent_not_found":
        return t(
          "这台机器不在册（可能已被删除）。刷新列表后重试。",
          "This agent is not registered (it may have been deleted). Refresh the list and retry.",
        );
      default:
        break;
    }
    if (error.detail) {
      return t(
        "网关返回 HTTP {status}：{detail}",
        "The gateway returned HTTP {status}: {detail}",
        { status: error.status, detail: error.detail },
      );
    }
    return t(
      "网关返回 HTTP {status}，请检查网关日志。",
      "The gateway returned HTTP {status}; check the gateway logs.",
      { status: error.status },
    );
  }
  return t(
    "请求失败：响应不符合当前契约，请检查网关与前端版本。",
    "Request failed: the response does not match the current contract. Check the gateway and front-end versions.",
  );
}

/**
 * 处置授权（时间窗授权）。
 *
 * 为什么需要它：审批是「批了这一份」，一次一审；而看进程、读日志、清已轮转日志
 * 这类动作是重复的。授权单给一台机器一段**有期限**的窗口，窗口内满足风险上限的动作
 * 直接下发 —— 但它必须**有期限**（禁止无限期），否则审批就形同虚设。
 *
 * 页面刻意不自己判断"现在还有效吗"：`state` 与 `remaining_seconds` 都由服务端算
 * （客户端时钟不可信，差一小时就会让人按错误的前提做决定）。
 */
export function ResponseGrantPanel() {
  const agentsQuery = useRegisteredAgents();
  const agents = useMemo(
    () =>
      (agentsQuery.data ?? [])
        .slice()
        .sort((a, b) => a.agentId.localeCompare(b.agentId))
        .slice(0, HOST_LIMIT),
    [agentsQuery.data],
  );
  const hasToken = Boolean(getAdminApiToken());

  return (
    <section className={styles.container}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t("处置授权", "Disposition grants")}</h2>
        <p className={styles.summary}>
          {t(
            "给一台机器签发一段有期限的授权窗口。窗口内、风险上限以内的动作可以直接下发，不必逐次审批；窗口一过就重新签发。高风险（R3）不允许走授权单，必须一次一议。",
            "Issue a time-boxed authorization window for one machine. Within the window and under the risk cap, actions can be dispatched without per-action approval; once it expires, re-issue. R3 (destructive) cannot be covered by a grant and must be approved case by case.",
          )}
        </p>
        <p className={styles.note}>
          {t(
            "没有授权单的机器，只读处置也发不出去 —— 这是刻意的：不留「永久免审」。授权单本身请当作一次审批动作对待。",
            "A machine without a grant cannot dispatch even read-only responses — that is intentional: there is no permanent exemption. Treat issuing a grant as an approval action.",
          )}
        </p>
      </header>

      {agentsQuery.isError ? (
        <p className={styles.error}>
          {t(
            "读取主机列表失败，请检查 Admin Token 与网关。",
            "Failed to load hosts; check the Admin Token and the gateway.",
          )}
        </p>
      ) : null}
      {!hasToken ? (
        <p className={styles.note}>
          {t(
            "未设置 Admin Token：先在右上角填入 Token 才能读取和签发授权。",
            "No Admin Token is set: enter one from the top right before reading or issuing grants.",
          )}
        </p>
      ) : null}
      {agentsQuery.isLoading && agents.length === 0 ? (
        <p className={styles.note}>
          {t("正在读取主机列表…", "Loading hosts…")}
        </p>
      ) : null}
      {!agentsQuery.isLoading && agents.length === 0 ? (
        <p className={styles.note}>
          {t("还没有已登记的 Agent。", "No registered agents yet.")}
        </p>
      ) : null}

      {agents.length > 0 ? (
        <GrantTable agents={agents} hasToken={hasToken} />
      ) : null}
    </section>
  );
}

function GrantTable({
  agents,
  hasToken,
}: {
  agents: AgentListEntryView[];
  hasToken: boolean;
}) {
  const queries = useQueries({
    queries: agents.map((agent) => ({
      queryKey: ["response-grant", agent.agentId],
      queryFn: () => fetchResponseGrant(agent.agentId),
      enabled: hasToken && Boolean(agent.agentId),
    })),
  });
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">{t("机器", "Agent")}</th>
          <th scope="col">{t("地址", "Addresses")}</th>
          <th scope="col">{t("授权状态", "Grant state")}</th>
          <th scope="col">{t("风险上限", "Risk cap")}</th>
          <th scope="col">{t("到期", "Expires")}</th>
          <th scope="col">{t("操作", "Actions")}</th>
        </tr>
      </thead>
      <tbody>
        {agents.map((agent, index) => {
          const query = queries[index];
          const grant = query?.data?.grant ?? null;
          const state: ResponseGrantState | "none" = grant
            ? grant.state
            : "none";
          const busy = Boolean(query?.isLoading);
          const addresses = summarizeAddresses(agent.ipAddresses ?? []);
          return (
            <GrantRow
              key={agent.agentId}
              agentId={agent.agentId}
              addressText={
                addresses.primary
                  ? addresses.others > 0
                    ? `${addresses.primary} (+${addresses.others})`
                    : addresses.primary
                  : "—"
              }
              grant={grant}
              state={state}
              loading={busy}
              error={Boolean(query?.isError)}
              editing={editing === agent.agentId}
              onEdit={() =>
                setEditing(editing === agent.agentId ? null : agent.agentId)
              }
              onDoneEditing={() => setEditing(null)}
            />
          );
        })}
      </tbody>
    </table>
  );
}

function GrantRow({
  agentId,
  addressText,
  grant,
  state,
  loading,
  error,
  editing,
  onEdit,
  onDoneEditing,
}: {
  agentId: string;
  addressText: string;
  grant: ResponseGrantView | null;
  state: ResponseGrantState | "none";
  loading: boolean;
  error: boolean;
  editing: boolean;
  onEdit: () => void;
  onDoneEditing: () => void;
}) {
  const put = usePutResponseGrant();
  const revoke = useRevokeResponseGrant();
  const [maxRisk, setMaxRisk] = useState<string>(MAX_GRANT_RISK);
  const [durationMinutes, setDurationMinutes] = useState<number>(24 * 60);
  const [opcodesText, setOpcodesText] = useState("");
  const [reason, setReason] = useState("");
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const actionError = put.error ?? revoke.error;

  function submit() {
    setFormError(null);
    const opcodes = opcodesText
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    put.mutate(
      {
        agentId,
        maxRisk,
        opcodes: opcodes.length > 0 ? opcodes : undefined,
        durationMinutes,
        reason,
      },
      {
        onSuccess: () => {
          setEditingResolved();
        },
        onError: (error) => setFormError(grantErrorMessage(error)),
      },
    );

    function setEditingResolved() {
      setOpcodesText("");
      setReason("");
      onDoneEditing();
    }
  }

  return (
    <>
      <tr>
        <td className={styles.mono}>{agentId}</td>
        <td className={styles.muted}>{addressText}</td>
        <td>
          {loading ? (
            <span className={styles.muted}>{t("读取中…", "Loading…")}</span>
          ) : error ? (
            <span className={styles.stateOff}>
              {t("读取失败", "Read failed")}
            </span>
          ) : (
            <>
              <span className={`${styles.badge} ${stateClass(state)}`}>
                {state === "none"
                  ? t("未签发", "Not issued")
                  : stateLabel(state as ResponseGrantState)}
              </span>
              {grant && grant.state === "active" ? (
                <span className={styles.remaining}>
                  {t("剩 {time}", "{time} left", {
                    time: durationLabel(
                      Math.max(1, Math.round(grant.remainingSeconds / 60)),
                    ),
                  })}
                </span>
              ) : null}
            </>
          )}
        </td>
        <td className={styles.mono}>{grant?.maxRisk ?? "—"}</td>
        <td className={styles.mono} title={grant?.notAfter ?? ""}>
          {grant ? formatTimestamp(grant.notAfter) : "—"}
        </td>
        <td className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            disabled={loading || put.isPending || revoke.isPending}
            onClick={onEdit}
          >
            {state === "active"
              ? t("重新签发", "Re-issue")
              : grant
                ? t("再签发", "Issue again")
                : t("签发", "Issue")}
          </button>
          {grant && grant.state === "active" ? (
            confirmingRevoke ? (
              <>
                <button
                  type="button"
                  className={styles.danger}
                  disabled={revoke.isPending}
                  onClick={() =>
                    revoke.mutate(agentId, {
                      onSuccess: () => setConfirmingRevoke(false),
                    })
                  }
                >
                  {t("确认撤销", "Confirm revoke")}
                </button>
                <button
                  type="button"
                  disabled={revoke.isPending}
                  onClick={() => setConfirmingRevoke(false)}
                >
                  {t("取消", "Cancel")}
                </button>
              </>
            ) : (
              <button
                type="button"
                className={styles.danger}
                disabled={revoke.isPending}
                onClick={() => setConfirmingRevoke(true)}
              >
                {t("撤销", "Revoke")}
              </button>
            )
          ) : null}
        </td>
      </tr>
      {actionError ? (
        <tr>
          <td colSpan={6}>
            <p className={styles.error} role="alert">
              {grantErrorMessage(actionError)}
            </p>
          </td>
        </tr>
      ) : null}
      {editing ? (
        <tr className={styles.editorRow}>
          <td colSpan={6}>
            <div className={styles.editor}>
              <label className={styles.field}>
                <span>{t("风险上限", "Risk cap")}</span>
                <select
                  value={maxRisk}
                  onChange={(event) => setMaxRisk(event.target.value)}
                >
                  {RISK_OPTIONS.map((risk) => (
                    <option key={risk} value={risk}>
                      {risk}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>{t("有效期", "Duration")}</span>
                <select
                  value={durationMinutes}
                  onChange={(event) =>
                    setDurationMinutes(Number(event.target.value))
                  }
                >
                  {DURATION_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {durationLabel(option)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`${styles.field} ${styles.fieldWide}`}>
                <span>
                  {t(
                    "opcode 白名单（可选，逗号分隔）",
                    "Opcode allow-list (optional, comma separated)",
                  )}
                </span>
                <input
                  type="text"
                  placeholder="log.rotate, log.archive"
                  value={opcodesText}
                  onChange={(event) => setOpcodesText(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span>{t("理由（可选）", "Reason (optional)")}</span>
                <input
                  type="text"
                  maxLength={200}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <div className={styles.editorActions}>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={put.isPending}
                  onClick={submit}
                >
                  {t("确认签发", "Confirm issue")}
                </button>
                <button
                  type="button"
                  disabled={put.isPending}
                  onClick={onDoneEditing}
                >
                  {t("取消", "Cancel")}
                </button>
              </div>
              <p className={styles.hint}>
                {t(
                  "窗口从签发时刻开始，不能无限期；白名单留空 = 只受风险上限约束。",
                  "The window starts now and can never be open-ended. An empty allow-list means only the risk cap applies.",
                )}
              </p>
              {formError ? (
                <p className={styles.error} role="alert">
                  {formError}
                </p>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
