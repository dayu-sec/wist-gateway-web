import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ADMIN_AUTH_CHANGED_EVENT,
  clearAdminApiToken,
  getAdminApiToken,
  setAdminApiToken,
} from "../api";
import { t } from "../i18n";
import styles from "./AdminTokenControl.module.css";

/**
 * 管理令牌的入口 + 控制面板。
 *
 * **位置**：常驻状态条的右上角（与语言开关同一条 chrome 区）。它以前占着左侧边栏底部一整块 ——
 * 但令牌是**会话语境**的凭证：只存本标签页、回答的问题是「现在能不能调管理接口、数据是不是真的」。
 * 那正是状态条在回答的问题（同步胶囊、最近同步、示例数据都在这条上），所以它属于这里；侧边栏留给
 * 「我是谁、我能去哪」（品牌 + 导航 + 版本）。
 *
 * **手感**：收起时只是一个按钮（`Admin Token · 已设置/未设置`），点开才出现输入框 —— 凭证是低频
 * 操作，不该常驻占一块。点面板外、按 Esc、点「收起」都关闭；关闭时**丢弃**输入框里的内容（半截
 * 密钥不该留在 DOM 里）。
 *
 * **输入框不预填已存 token**：曾经它预填旧值（还是密码框），粘新 token 容易拼成「旧+新」，结果
 * 「明明输了新 token 却一直 401（继而触发限流 429）」。现在空框起步，粘贴即整体替换。
 */
export function AdminTokenControl() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  // 「已设置」以**实际存储**为准（经变更事件刷新），不拿输入框内容当判据 —— 输入框是空框起步的。
  const [hasStoredToken, setHasStoredToken] = useState(() =>
    Boolean(getAdminApiToken()),
  );
  const [applied, setApplied] = useState(false);
  const appliedTimer = useRef<number | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => window.clearTimeout(appliedTimer.current), []);

  useEffect(() => {
    function onAuthChanged() {
      const hasToken = Boolean(getAdminApiToken());
      setHasStoredToken(hasToken);
      // token 变了：设了 → 重新取；清了 → **丢弃**缓存（含上一条 401/429）。
      // 不丢的话，清完页面上还挂着旧错误横幅，看起来就像「点了清除没生效」。
      if (hasToken) {
        void queryClient.invalidateQueries();
      } else {
        queryClient.removeQueries();
      }
    }

    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () => {
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    };
  }, [queryClient]);

  // 展开后：清空 + 聚焦全选（让浏览器密码管理器自动填充的内容被下一次粘贴整体替换）；
  // 同时挂上「点外面 / 按 Esc 收起」。
  useEffect(() => {
    if (!open) return;
    setToken("");
    window.setTimeout(() => inputRef.current?.select(), 0);

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) closePanel();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closePanel();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  /** 关闭并丢弃草稿（半截密钥不留在 DOM 里）。 */
  function closePanel() {
    window.clearTimeout(appliedTimer.current);
    setToken("");
    setApplied(false);
    setOpen(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdminApiToken(token);
    setToken(""); // 不把密钥留在输入框
    setApplied(true);
    window.clearTimeout(appliedTimer.current);
    // 「已应用」反馈展示完顺手把面板收回去。
    appliedTimer.current = window.setTimeout(() => {
      setApplied(false);
      setOpen(false);
    }, 1600);
    // 查询的刷新交给上面监听 `ADMIN_AUTH_CHANGED_EVENT` 的 onAuthChanged（设/清走同一处）。
  }

  function handleClear() {
    clearAdminApiToken();
    setToken("");
  }

  return (
    <div className={styles.wrap} ref={rootRef}>
      <button
        type="button"
        className={
          hasStoredToken
            ? `${styles.trigger} ${styles.triggerOn}`
            : `${styles.trigger} ${styles.triggerOff}`
        }
        aria-expanded={open}
        aria-controls="admin-token-panel"
        onClick={() => (open ? closePanel() : setOpen(true))}
        title={
          hasStoredToken
            ? t(
                "Admin Token 已设置：点击可更换或清除（仅存于本会话标签页）",
                "Admin Token is set: click to change or clear it (kept in this tab only)",
              )
            : t(
                "Admin Token 未设置：点击粘贴管理令牌，否则数据不会自动拉取",
                "Admin Token is not set: click to paste the admin token, otherwise data is not fetched",
              )
        }
        aria-label={t(
          "Admin Token（管理接口令牌）",
          "Admin Token (admin API token)",
        )}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path
            d="M9.6 2.6a3.6 3.6 0 1 0-3.1 5.4c.3 0 .5 0 .8-.1l.5.5v1.2h1.2v1.2h1.2l1-1V8.4l-.9-.9c.1-.3.1-.6.1-.9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="10.7" cy="5.3" r="0.9" fill="currentColor" />
        </svg>
        {/* 纯图标太不显眼（现场反馈）：改成「钥匙 + 短标签 + 折叠箭头」的胶囊。
            两种状态各说各的话：**未设置** = 行动号召（`设置令牌`，琥珀色，数据不会自动拉取）；
            **已设置** = 安静的状态（`令牌`，绿色）。 */}
        <span className={styles.triggerLabel}>
          {hasStoredToken ? t("令牌", "Token") : t("设置令牌", "Set token")}
        </span>
        <svg
          className={open ? `${styles.caret} ${styles.caretOpen}` : styles.caret}
          viewBox="0 0 10 10"
          width="9"
          height="9"
          aria-hidden="true"
        >
          <path
            d="M2 3.6 5 6.6l3-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

      </button>

      {open ? (
        <form
          id="admin-token-panel"
          className={styles.panel}
          onSubmit={handleSubmit}
        >
          <div className={styles.panelHead}>
            <strong className={styles.panelTitle}>Admin Token</strong>
            <span
              className={hasStoredToken ? styles.panelStateOn : styles.panelState}
            >
              {hasStoredToken ? t("已设置", "Set") : t("未设置", "Not set")}
            </span>
          </div>
          <input
            ref={inputRef}
            className={styles.input}
            type="password"
            autoComplete="off"
            aria-label={t("管理令牌", "Admin token")}
            placeholder={t("粘贴管理令牌", "Paste admin token")}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
          />
          <p className={styles.hint}>
            {t(
              "仅存于本会话标签页，用于调用 Gateway 管理接口。",
              "Kept in this browser tab only; used to call the Gateway admin API.",
            )}
          </p>
          <div className={styles.actions}>
            <button
              className={`${styles.button} ${styles.buttonPrimary}`}
              type="submit"
              disabled={!token}
            >
              {applied ? t("已应用", "Applied") : t("应用", "Apply")}
            </button>
            <button
              className={styles.button}
              type="button"
              onClick={handleClear}
              disabled={!hasStoredToken}
            >
              {t("清除", "Clear")}
            </button>
            <button
              className={`${styles.button} ${styles.buttonGhost}`}
              type="button"
              onClick={closePanel}
            >
              {t("收起", "Collapse")}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
