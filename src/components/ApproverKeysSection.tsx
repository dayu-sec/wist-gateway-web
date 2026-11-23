import { useState } from "react";
import { ApiError } from "../api";
import {
  useApproverKeys,
  useRegisterApproverKey,
  useRevokeApproverKey,
} from "../hooks";
import { t } from "../i18n";
import styles from "./ApproverKeysSection.module.css";

/**
 * 「审批公钥」：把审批机（`wist-approve`）的公钥登记到网关。
 *
 * 这里**不签名、不投票**。公钥的两个用途：
 *   1. 网关收到 attestation 时验一遍（挡垃圾，不是授权）；
 *   2. 把指纹显示出来，让人和审批机上的 `wist-approve key show` 对一眼。
 *
 * 真正的授权在机器那一侧（agentd 的 `[attestation] trusted_keys`），所以吊销一把公钥
 * 只影响"以后不再接受这把钥匙签的单"，已经签发的计划不受影响 —— 这句话也写在页面上，
 * 否则吊销会被当成"撤回已下发的动作"。
 */
export function ApproverKeysSection() {
  const query = useApproverKeys();
  const register = useRegisterApproverKey();
  const revoke = useRevokeApproverKey();

  const [keyId, setKeyId] = useState("");
  const [owner, setOwner] = useState("role:approver");
  const [publicKey, setPublicKey] = useState("");
  const [reactivate, setReactivate] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const keys = query.data ?? [];
  const busy = register.isPending || revoke.isPending;

  function errorText(error: unknown): string {
    if (error instanceof ApiError) {
      return error.detail
        ? `${error.code}：${error.detail}`
        : `${error.code}（HTTP ${error.status}）`;
    }
    return t(
      "请求失败：响应不符合当前契约。",
      "Request failed: the response does not match the current contract.",
    );
  }

  const actionError = register.error ?? revoke.error;

  return (
    <section className={styles.section}>
      <h2 className={styles.title}>{t("审批公钥", "Approver keys")}</h2>
      <p className={styles.hint}>
        {t(
          "签名发生在审批机（wist-approve）上，这里只登记它的公钥。导入后请把显示的指纹与审批机上 `wist-approve key show` 的指纹核对一致；agentd 侧还要把同一份公钥钉到 [attestation] trusted_keys，否则机器只会记录「不认识这把钥匙」。",
          "Signing happens on the approval machine (wist-approve); this page only registers its public key. After importing, compare the fingerprint shown here with `wist-approve key show`. The same PEM must also be pinned in agentd's [attestation] trusted_keys, otherwise the agent only records “unknown signing key”.",
        )}
      </p>

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          register.mutate(
            {
              keyId: keyId.trim(),
              owner: owner.trim(),
              publicKey,
              reactivate,
            },
            {
              onSuccess: () => {
                setKeyId("");
                setPublicKey("");
                setReactivate(false);
              },
            },
          );
        }}
      >
        <label className={styles.field}>
          <span>{t("key_id", "key_id")}</span>
          <input
            value={keyId}
            onChange={(event) => setKeyId(event.target.value)}
            placeholder="ed25519-0123456789abcdef"
            required
            maxLength={64}
            pattern="[A-Za-z0-9._-]+"
          />
        </label>
        <label className={styles.field}>
          <span>{t("属主（审计用）", "Owner (audit)")}</span>
          <input
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            placeholder="role:approver"
            required
          />
        </label>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span>{t("公钥（SPKI PEM）", "Public key (SPKI PEM)")}</span>
          <textarea
            value={publicKey}
            onChange={(event) => setPublicKey(event.target.value)}
            rows={3}
            placeholder="-----BEGIN PUBLIC KEY-----"
            required
          />
        </label>
        <button type="submit" className={styles.primary} disabled={busy}>
          {register.isPending
            ? t("正在登记…", "Registering…")
            : t("登记公钥", "Register key")}
        </button>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={reactivate}
            onChange={(event) => setReactivate(event.target.checked)}
          />
          <span>
            {t(
              "重新启用已吊销的钥匙（吊销常源于安全事件，确认再用才勾）",
              "Re-enable a revoked key (revocation usually follows a security incident)",
            )}
          </span>
        </label>
      </form>

      {actionError ? (
        <p className={styles.error} role="alert">
          {errorText(actionError)}
        </p>
      ) : null}
      {register.isSuccess ? (
        <p className={styles.notice}>
          {t(
            "已登记。下一步：把同一份 PEM 钉到 agentd 的 trusted_keys。",
            "Registered. Next: pin the same PEM in agentd's trusted_keys.",
          )}
        </p>
      ) : null}

      {query.isError ? (
        <p className={styles.error} role="alert">
          {errorText(query.error)}
        </p>
      ) : null}

      {keys.length === 0 ? (
        <p className={styles.hint}>
          {t(
            "还没有登记任何审批公钥。此时外部签发不可用（网关会回 approver_key_unregistered）。",
            "No approver key registered yet. External signing is unavailable (the gateway returns approver_key_unregistered).",
          )}
        </p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">key_id</th>
              <th scope="col">{t("属主", "Owner")}</th>
              <th scope="col">{t("指纹", "Fingerprint")}</th>
              <th scope="col">{t("状态", "Status")}</th>
              <th scope="col">{t("操作", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.keyId}>
                <td className={styles.mono}>{key.keyId}</td>
                <td className={styles.mono}>{key.owner}</td>
                <td className={styles.mono}>{key.fingerprint}</td>
                <td>
                  {key.revokedAt
                    ? t("已吊销", "Revoked")
                    : t("生效中", "Active")}
                </td>
                <td>
                  {key.revokedAt ? (
                    <span className={styles.muted}>—</span>
                  ) : confirmRevoke === key.keyId ? (
                    <>
                      <button
                        type="button"
                        className={styles.danger}
                        disabled={busy}
                        onClick={() =>
                          revoke.mutate(key.keyId, {
                            onSuccess: () => setConfirmRevoke(null),
                          })
                        }
                      >
                        {t("确认吊销", "Confirm revoke")}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmRevoke(null)}
                      >
                        {t("取消", "Cancel")}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={styles.danger}
                      disabled={busy}
                      onClick={() => setConfirmRevoke(key.keyId)}
                    >
                      {t("吊销", "Revoke")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
