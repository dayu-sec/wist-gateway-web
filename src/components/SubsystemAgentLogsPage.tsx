import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, getAdminApiToken, isRateLimitedError } from "../api";
import { useDataPlaneOutputs, useDataPlaneOutputTail } from "../hooks";
import { t } from "../i18n";
import { filterLogLines } from "../lib/logFilter";
import { CopyButton } from "./CopyButton";
import { RateLimitNotice } from "./RateLimitNotice";
import styles from "./SubsystemAgentLogsPage.module.css";

interface SubsystemAgentLogsPageProps {
  children?: React.ReactNode;
}

/** `ApiError` 的稳定错误码（网关侧 `codes` 词表）。 */
function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/** 读取失败时的提示（与其它管理面页面同一口径）。 */
function loadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const code = errorCode(error);
    if (error.status === 401)
      return t(
        "Admin Token 缺失或无效：请在右上角点钥匙按钮，粘贴 Admin Token 后点击「应用」。",
        "Admin Token missing or invalid: click the key button in the top bar, paste the Admin Token and click “Apply”.",
      );
    if (error.status === 429)
      return t(
        "认证失败次数过多，请稍后再试。",
        "Too many failed authentication attempts. Try again later.",
      );
    if (code === "data_plane_unavailable" || error.status === 503)
      return t(
        "网关没有可用的数据面工作目录：需要 wist-gateway-stack 把宿主 data-plane-run 下的 work 与 data 只读挂进 gateway 容器（本地进程部署则要配 [data_plane] work_dir），并重新 localize / 起栈。",
        "The gateway has no usable data-plane work dir: wist-gateway-stack must mount work and data under host data-plane-run read-only into the gateway container (for a local process, configure [data_plane] work_dir), then re-localize / restart the stack.",
      );
    if (code === "data_plane_file_not_text")
      return t(
        "这个文件不是可读文本（可能是二进制 sink 的产物）：页面只 tail *.log / *.json 等文本文件。",
        "This file is not readable text (it may come from a binary sink): the page only tails text files such as *.log / *.json.",
      );
    if (code === "data_plane_file_not_found" || error.status === 404) {
      if (code === "data_plane_file_not_found")
        return t(
          "输出文件不存在：可能刚被轮转或删除。刷新文件列表后重新选择。",
          "The output file does not exist: it may have just been rotated or removed. Refresh the file list and select again.",
        );
      return t(
        "网关没有这个接口（HTTP 404）：正在运行的 gateway 很可能是旧构建，请重新构建并重启网关后重试。",
        "The gateway has no such endpoint (HTTP 404): the running gateway is most likely an old build. Rebuild and restart it, then retry.",
      );
    }
    return error.detail
      ? t("网关返回 HTTP {status}：{detail}", "Gateway returned HTTP {status}: {detail}", {
          status: error.status,
          detail: error.detail,
        })
      : t(
          "网关返回 HTTP {status}，请检查网关日志。",
          "Gateway returned HTTP {status}. Check the gateway logs.",
          { status: error.status },
        );
  }
  return t(
    "读取失败：响应不符合当前契约，请检查网关与前端版本。",
    "Load failed: the response does not match the current contract. Check the gateway and frontend versions.",
  );
}

/** 文件大小：页面只需要「大概多大」，不追求逐字节精确。 */
function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * 时间戳按本地时区、固定成 `YYYY-MM-DD HH:mm:ss`；解析不了就原样透出。
 *
 * 与输出文件里的时间对得上，比 `toLocaleString` 更适合并排看「多久没写了」。
 */
function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(
    at.getHours(),
  )}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

/**
 * 采集日志页：**tail -f wparse 的输出文件**。
 *
 * 链路是 agentd → 数据面（warp-parse）→ file sink 落盘到
 * 宿主 `data-plane-run/data/out_dat/*.json`。页面不再读网关自己那份 NDJSON 接入日志，
 * 而是直接跟随数据面的输出 —— 这样「采集出来的日志长什么样」不用 SSH 到宿主。
 *
 * 行为约定：
 *   - 只列 / 只 tail 文本扩展名（`*.log` / `*.json` / `*.jsonl` 等），二进制 sink 不出现；
 *   - 首次打开取文件尾部窗口（不把整份日志拉进浏览器），以后按字节偏移增量追加；
 *   - 文件被轮转 / 截断（大小小于已读偏移）时，服务端回 `reset`，页面清空后从新文件开头继续；
 *   - 「暂停」只停页面轮询，不动服务端；「清空」只清屏，不删文件。
 *
 * 选中的文件走 URL（`?file=`），链接贴给别人打开的是同一份输出。
 */
export function SubsystemAgentLogsPage({}: SubsystemAgentLogsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("file") ?? "";
  const [follow, setFollow] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [clearKey, setClearKey] = useState(0);
  // 行过滤：`filter` 是输入框里的原文，应用是**即时**的（等价 `tail -f | grep`）；
  // 默认忽略大小写，`caseSensitive` 打开后按原样比较。
  const [filter, setFilter] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);

  const {
    data: outputs,
    error: listError,
    isLoading: listLoading,
    refetch: refetchOutputs,
  } = useDataPlaneOutputs();

  const files = outputs?.files ?? [];
  // URL 里的文件可能已被轮转掉：这时回落到列表第一项（最近写过的那个）。
  const activePath = useMemo(() => {
    if (requested && files.some((file) => file.path === requested)) {
      return requested;
    }
    return files[0]?.path ?? "";
  }, [requested, files]);

  // 首次进页 / 选中的文件被轮转掉时，把回落结果**写回 URL**。
  //
  // 为什么必须写回：文件列表按修改时间排序，10s 刷新一次；如果只靠 `files[0]` 当默认值，
  // 另一个 sink 变活跃时页面会自己跳到别的文件，偏移与已显示内容跟着清空 —— 用户看到
  // “看着看着换了份日志”。固定住选择后，只有点击文件才会切换。
  useEffect(() => {
    if (files.length === 0) return;
    if (requested && files.some((file) => file.path === requested)) return;
    const next = files[0]?.path;
    if (!next) return;
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        params.set("file", next);
        return params;
      },
      { replace: true },
    );
  }, [requested, files, setSearchParams]);

  const tail = useDataPlaneOutputTail(
    activePath || null,
    follow && Boolean(activePath),
    refreshKey,
    clearKey,
  );

  // 过滤只作用于**已加载窗口**：首屏尾部窗口 + 之后增量。更早的内容本来就不在页面里。
  const filtered = useMemo(
    () => filterLogLines(tail.text, filter, caseSensitive),
    [tail.text, filter, caseSensitive],
  );
  const terminalText = filtered.text;
  const filterActive = filter !== "";

  const terminalRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    if (!autoScroll) return;
    const node = terminalRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [terminalText, autoScroll]);

  const activeFile = files.find((file) => file.path === activePath) ?? null;
  const activeDir = outputs?.dir ?? "";
  const fullPath = activePath
    ? `${activeDir.replace(/\/$/, "")}/${activePath}`
    : activeDir;
  const pendingAfter = Math.max(0, tail.size - tail.nextOffset);
  const error = listError ?? tail.error;

  function selectFile(path: string) {
    const params = new URLSearchParams(searchParams);
    params.set("file", path);
    setSearchParams(params);
  }

  function refreshAll() {
    void refetchOutputs();
    setRefreshKey((key) => key + 1);
  }

  function clearScreen() {
    // 只清屏，不删文件：偏移不动，下一次轮询从当前偏移继续。
    setClearKey((key) => key + 1);
  }

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t("采集日志", "Collection logs")}</h1>
        <p className={styles.pageSummary}>
          {t(
            "数据面（warp-parse）写出的日志文件，按 ",
            "Log files written by the data plane (warp-parse), followed like ",
          )}
          <code className={styles.code}>tail -f</code>
          {t(
            " 的方式跟随。链路是 agentd → 数据面 → file sink 落盘，最终文件在 ",
            ". The path is agentd → data plane → file sink, ending up in ",
          )}
          <strong>{t("宿主 data-plane-run/data/out_dat", "host data-plane-run/data/out_dat")}</strong>
          {t(
            "（没有数据库表）—— 这里直接读文件，看到的就是采集输出的原文。",
            " (no database table) — this page reads the file directly, so what you see is exactly what was collected.",
          )}
        </p>
        <p className={styles.pageThresholds}>
          {t("只列可读文本：", "Only readable text is listed: ")}
          <code className={styles.code}>*.log</code>
          {" / "}
          <code className={styles.code}>*.json</code>
          {" / "}
          <code className={styles.code}>*.jsonl</code>
          {t(
            " 等；二进制 sink 的产物不出现。首次打开只取文件尾部窗口（不会把整份日志拉进浏览器），之后每次只追加新写入的字节。",
            " and similar; binary sink outputs are excluded. The first load takes a tail window (the whole file is not pulled into the browser); after that only newly written bytes are appended.",
          )}
          {" "}
          {t(
            "「暂停」只停页面轮询，不动数据面；文件被轮转 / 截断时页面会自动从头重新跟随。顶部下拉选择要跟随的输出文件（数量有限，不占侧栏），过滤输入框按行做字面包含匹配（等价 ",
            "“Pause” only stops page polling, not the data plane; when the file is rotated or truncated the page automatically restarts from the top of the new file. Pick the output file to follow from the dropdown at the top (a small finite set, no sidebar), and use the filter input for a per-line literal substring match (equivalent to ",
          )}
          <code className={styles.code}>tail -f … | grep "xxx"</code>
          {t(
            "），只在已加载窗口内生效。",
            "), within the loaded window only.",
          )}
        </p>
      </header>

      {error ? (
        isRateLimitedError(error) ? (
          <RateLimitNotice error={error} />
        ) : (
          <div className={styles.errorBanner} role="alert">
            {loadErrorMessage(error)}
          </div>
        )
      ) : null}

      {listLoading && !outputs ? <SkeletonRows count={2} /> : null}

      {!listLoading && !outputs && !listError ? (
        <div className={styles.idleNotice} role="status">
          {getAdminApiToken()
            ? t(
                "尚未取到输出文件列表，用「刷新」重试。",
                "The output file list is not loaded yet. Use “Refresh” to retry.",
              )
            : t(
                "未设置 Admin Token：在右上角钥匙按钮里填入后才向管理面请求，这里不会显示数据。",
                "No Admin Token set: data is requested from the admin API only after you fill it in via the key button in the top bar, so nothing is shown here.",
              )}
        </div>
      ) : null}

      {outputs && !outputs.available ? (
        <div className={styles.empty} role="status">
          <strong className={styles.emptyTitle}>
            {t("还没有输出目录", "No output directory yet")}
          </strong>
          <span className={styles.emptyText}>
            {t("网关没有看到 ", "The gateway cannot see ")} <code className={styles.code}>{outputs.dir}</code>
            {t(
              "。如果数据面刚启动、还没有写出过任何记录，这是正常状态；如果一直如此，请确认栈已把宿主 data-plane-run/data 挂进 gateway 容器，且 wparse 的 file sink 确实在往这里写。",
              ". This is normal right after the data plane starts and before any record is written; if it persists, make sure the stack mounts host data-plane-run/data into the gateway container and that wparse's file sink is writing here.",
            )}
          </span>
        </div>
      ) : null}

      {outputs?.available && files.length === 0 ? (
        <div className={styles.empty} role="status">
          <strong className={styles.emptyTitle}>
            {t("输出目录里还没有文本文件", "No text files in the output directory")}
          </strong>
          <span className={styles.emptyText}>
            {t("目录 ", "The directory ")} <code className={styles.code}>{outputs.dir}</code>
            {t(
              " 是空的（或只有二进制输出）。确认数据面在运行、已有 Agent 上报，并检查 file sink 是否配置为往 data/out_dat 写。",
              " is empty (or only contains binary output). Make sure the data plane is running, agents are reporting, and the file sink writes to data/out_dat.",
            )}
          </span>
        </div>
      ) : null}

      {outputs?.available && files.length > 0 ? (
        <section className={styles.tailPanel}>
          <div className={styles.tailToolbar}>
            <div className={styles.filePicker}>
              <label className={styles.tailLabel} htmlFor="log-file-select">
                {t("文件", "File")}
              </label>
              <select
                id="log-file-select"
                className={styles.fileSelect}
                value={activePath}
                title={fullPath}
                onChange={(event) => selectFile(event.target.value)}
              >
                {files.map((file) => (
                  <option key={file.path} value={file.path}>
                    {file.path} · {formatBytes(file.size)}
                  </option>
                ))}
              </select>
              <CopyButton
                className={styles.copyButton}
                text={fullPath}
                label={t("复制路径", "Copy path")}
              />
            </div>
            <div className={styles.tailActions}>
              <span
                className={
                  follow
                    ? `${styles.statusBadge} ${styles.statusLive}`
                    : styles.statusBadge
                }
                role="status"
              >
                {follow ? t("跟随中", "Live") : t("已暂停", "Paused")}
              </span>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => setFollow((value) => !value)}
              >
                {follow ? t("暂停", "Pause") : t("继续", "Resume")}
              </button>
              <button
                type="button"
                className={styles.actionButton}
                onClick={refreshAll}
              >
                {t("刷新", "Refresh")}
              </button>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => setAutoScroll((value) => !value)}
                aria-pressed={autoScroll}
              >
                {autoScroll
                  ? t("自动滚动：开", "Auto-scroll: on")
                  : t("自动滚动：关", "Auto-scroll: off")}
              </button>
              <button
                type="button"
                className={styles.actionButton}
                onClick={clearScreen}
              >
                {t("清空", "Clear")}
              </button>
            </div>
          </div>

          <div className={styles.filterBar}>
            <label className={styles.filterLabel} htmlFor="log-filter">
              {t("过滤", "Filter")}
            </label>
            <input
              id="log-filter"
              className={styles.filterInput}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t(
                '按行包含匹配，如 grep "xxx"；输入即生效',
                'Per-line substring match, like grep "xxx"; applies as you type',
              )}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className={
                caseSensitive
                  ? `${styles.filterToggle} ${styles.filterToggleActive}`
                  : styles.filterToggle
              }
              aria-pressed={caseSensitive}
              title={t("区分大小写", "Case-sensitive")}
              onClick={() => setCaseSensitive((value) => !value)}
            >
              Aa
            </button>
            {filterActive ? (
              <button
                type="button"
                className={styles.filterClear}
                onClick={() => setFilter("")}
              >
                {t("清除过滤", "Clear filter")}
              </button>
            ) : null}
            <span className={styles.filterCount} role="status">
              {filterActive
                ? t(
                    "匹配 {matched} / 共 {total} 行（仅已加载窗口）",
                    "{matched} of {total} lines (loaded window only)",
                    { matched: filtered.lines.length, total: filtered.totalLines },
                  )
                : t("共 {total} 行", "{total} lines", {
                    total: filtered.totalLines,
                  })}
            </span>
          </div>

          <div className={styles.tailMeta} role="status">
            <span>
              {t("大小", "Size")} <strong>{formatBytes(tail.size)}</strong>
            </span>
            <span>
              {t("读至偏移", "Read offset")}{" "}
              <strong>{formatBytes(tail.nextOffset)}</strong>
              {pendingAfter > 0 ? (
                <span className={styles.tailPending}>
                  {" · "}
                  {t("待读 {bytes}", "{bytes} pending", {
                    bytes: formatBytes(pendingAfter),
                  })}
                </span>
              ) : null}
            </span>
            <span>
              {t("修改", "Modified")}{" "}
              <strong>{formatTimestamp(tail.modified ?? activeFile?.modified ?? null)}</strong>
            </span>
            <span>
              {t("显示", "Showing")} <strong>{filtered.lines.length}</strong>{" "}
              {t("行", "lines")}
            </span>
            {outputs.truncated ? (
              <span className={styles.fileSelectNote}>
                {t(
                  "文件选择已截断（最多 512 个）",
                  "File choices truncated (at most 512)",
                )}
              </span>
            ) : null}
          </div>

            {tail.skippedBefore > 0 && tail.text ? (
              <div className={styles.truncatedNotice} role="status">
                <span>
                  {t(
                    "只载入了文件尾部：更早的 {bytes} 没有加载，",
                    "Only the tail of the file is loaded: the earlier {bytes} were not loaded. ",
                    { bytes: formatBytes(tail.skippedBefore) },
                  )}
                  <strong>
                    {t(
                      "页面不会把整份日志拉进浏览器",
                      "The page does not pull the whole log into the browser",
                    )}
                  </strong>
                  {t(
                    "；需要完整历史时去宿主上 tail / grep 该文件。",
                    "; for the full history, tail / grep the file on the host.",
                  )}
                </span>
              </div>
            ) : null}

            {tail.resetCount > 0 ? (
              <div className={styles.resetNotice} role="status">
                {t(
                  "检测到文件被轮转 / 截断（{count} 次）：已清空旧内容，从新文件开头继续跟随。",
                  "The file was rotated / truncated ({count} times): old content was cleared and following restarted from the top of the new file.",
                  { count: tail.resetCount },
                )}
              </div>
            ) : null}

            <pre
              ref={terminalRef}
              className={styles.terminal}
              aria-label={t("输出内容", "Output content")}
              tabIndex={0}
            >
              {terminalText ? (
                terminalText
              ) : tail.isLoading ? (
                <span className={styles.terminalIdle}>
                  {t("读取中…", "Reading…")}
                </span>
              ) : filterActive && tail.text ? (
                // 过滤后为空与“文件为空”是两回事：说清楚是没匹配到，给出命中口径。
                <span className={styles.terminalIdle}>
                  {t(
                    "没有匹配「{filter}」的行（窗口内共 {total} 行）",
                    "No line matches “{filter}” ({total} lines in the window)",
                    { filter, total: filtered.totalLines },
                  )}
                </span>
              ) : tail.size > 0 ? (
                // 文件有内容、但一屏里没有完整的行（例如尾部只有半行）：
                // 不能说“文件为空”，否则人会以为 wparse 没写东西。
                <span className={styles.terminalIdle}>
                  {t(
                    "已到文件末尾：当前窗口内没有完整的行，等待新内容…",
                    "At end of file: no complete line in the current window; waiting for new content…",
                  )}
                </span>
              ) : (
                <span className={styles.terminalIdle}>
                  {t(
                    "文件暂时为空，等待数据面写入…",
                    "The file is empty for now; waiting for the data plane to write…",
                  )}
                </span>
              )}
            </pre>
        </section>
      ) : null}
    </div>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className={styles.skeletonWrap}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={styles.skeletonRow} />
      ))}
    </div>
  );
}
