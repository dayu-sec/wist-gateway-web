import { type ReactNode, useEffect, useMemo, useState } from "react";
import styles from "./SubsystemDataPlaneConfig.module.css";
import { isRateLimitedError } from "../api";
import type { DataPlaneEntry } from "../api";
import { useDataPlaneFile, useDataPlaneTree } from "../hooks";
import { t } from "../i18n";
import { RateLimitNotice } from "./RateLimitNotice";

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

interface TreeNode {
  path: string;
  name: string;
  kind: "dir" | "file";
  size: number;
  modified: string | null;
  children: TreeNode[];
  /** 目录下的文件总数（含子孙）；文件恒为 1。 */
  fileCount: number;
}

/**
 * 把后端的扁平路径表还原成树。
 *
 * 后端保证先父后子（目录先入栈再递归），但这里仍按路径「按需补父节点」——
 * 树是纯展示结构，不该因为某一层少发一个目录就丢整棵子树。
 */
function buildTree(entries: DataPlaneEntry[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  const makeDir = (path: string): TreeNode => {
    const existing = nodes.get(path);
    if (existing) return existing;
    const parts = path.split("/");
    const node: TreeNode = {
      path,
      name: parts[parts.length - 1] ?? path,
      kind: "dir",
      size: 0,
      modified: null,
      children: [],
      fileCount: 0,
    };
    nodes.set(path, node);
    const parentPath = parts.slice(0, -1).join("/");
    if (parentPath === "") roots.push(node);
    else makeDir(parentPath).children.push(node);
    return node;
  };

  for (const entry of entries) {
    if (entry.kind === "dir") {
      const node = makeDir(entry.path);
      node.modified = entry.modified;
      continue;
    }
    const parts = entry.path.split("/");
    const node: TreeNode = {
      path: entry.path,
      name: parts[parts.length - 1] ?? entry.path,
      kind: "file",
      size: entry.size,
      modified: entry.modified,
      children: [],
      fileCount: 1,
    };
    nodes.set(entry.path, node);
    const parentPath = parts.slice(0, -1).join("/");
    if (parentPath === "") roots.push(node);
    else makeDir(parentPath).children.push(node);
  }

  const countFiles = (node: TreeNode): number => {
    if (node.kind === "file") return 1;
    node.fileCount = node.children.reduce(
      (sum, child) => sum + countFiles(child),
      0,
    );
    return node.fileCount;
  };
  const sortTree = (list: TreeNode[]) => {
    list.sort((left, right) =>
      left.kind === right.kind
        ? left.name.localeCompare(right.name)
        : left.kind === "dir"
          ? -1
          : 1,
    );
    for (const node of list) sortTree(node.children);
  };
  for (const root of roots) countFiles(root);
  sortTree(roots);
  return roots;
}

function collectDirs(nodes: TreeNode[], into: Set<string>): Set<string> {
  for (const node of nodes) {
    if (node.kind !== "dir") continue;
    into.add(node.path);
    collectDirs(node.children, into);
  }
  return into;
}

/**
 * 数据面（wparse）**实际在用**的配置与规则。
 *
 * 数据来自宿主 `data-plane-run/work`（compose 只读挂到网关容器的 `/data-plane`），
 * 网关只开放 conf / topology / connectors / models 与 `wparse.local.toml`。
 * 这里只读展示：不做编辑，也不解释规则语义（规则含义看 wp-rules 仓）。
 */
export function SubsystemDataPlaneConfigPanel() {
  const tree = useDataPlaneTree();
  const entries = tree.data?.entries;
  const nodes = useMemo(() => buildTree(entries ?? []), [entries]);
  const files = useMemo(
    () => (entries ?? []).filter((entry) => entry.kind === "file"),
    [entries],
  );

  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);
  const [copied, setCopied] = useState(false);

  // 换文件后不要继续显示上一个文件的「已复制」。
  useEffect(() => {
    setCopied(false);
  }, [selected]);

  // 默认落在数据面主配置上；换包 / 重建目录后若选中的文件没了，也回落到它。
  useEffect(() => {
    if (selected && files.some((file) => file.path === selected)) return;
    const preferred =
      files.find((file) => file.path === "conf/wparse.toml") ?? files[0];
    setSelected(preferred?.path ?? null);
  }, [files, selected]);

  // 首次拿到目录树时只展开顶层；之后不覆盖用户手动展开/收起的状态。
  useEffect(() => {
    if (initialized || nodes.length === 0) return;
    const topLevel = new Set<string>();
    for (const node of nodes) {
      if (node.kind === "dir") topLevel.add(node.path);
    }
    setExpanded(topLevel);
    setInitialized(true);
  }, [initialized, nodes]);

  const file = useDataPlaneFile(selected);

  const copy = () => {
    const content = file.data?.content;
    if (content === null || content === undefined) return;
    const written = navigator.clipboard?.writeText(content);
    if (!written) return;
    void written.then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const toggle = (path: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  /** 选中文件时顺带展开祖先目录（「收起全部」之后点文件也能看见它在树里的位置）。 */
  const selectFile = (path: string) => {
    setSelected(path);
    setExpanded((previous) => {
      const next = new Set(previous);
      const parts = path.split("/");
      for (let index = 1; index < parts.length; index += 1) {
        next.add(parts.slice(0, index).join("/"));
      }
      return next;
    });
  };

  const treeUnavailable =
    errorCode(tree.error) === "data_plane_unavailable" ||
    errorStatus(tree.error) === 503;
  const treeMissingEndpoint = errorStatus(tree.error) === 404;
  const fileMissing = errorStatus(file.error) === 404;
  const fileUnavailable =
    errorCode(file.error) === "data_plane_unavailable" ||
    errorStatus(file.error) === 503;

  const renderNodes = (items: TreeNode[], depth: number): ReactNode =>
    items.map((node) => {
      if (node.kind === "dir") {
        const open = expanded.has(node.path);
        return (
          <div key={node.path} className={styles.node}>
            <button
              type="button"
              className={depth === 0 ? styles.dirRoot : styles.dir}
              style={{ paddingLeft: 6 + depth * 14 }}
              onClick={() => toggle(node.path)}
              aria-expanded={open}
              title={node.path}
            >
              <span className={styles.caret} aria-hidden="true">
                {open ? "▾" : "▸"}
              </span>
              <span className={styles.dirName}>{node.name}</span>
              <span className={styles.count}>{node.fileCount}</span>
            </button>
            {open ? renderNodes(node.children, depth + 1) : null}
          </div>
        );
      }
      const active = node.path === selected;
      return (
        <button
          key={node.path}
          type="button"
          className={active ? styles.fileActive : styles.file}
          style={{ paddingLeft: 6 + depth * 14 + 16 }}
          onClick={() => selectFile(node.path)}
          title={node.path}
        >
          <span className={styles.fileName}>{node.name}</span>
          <span className={styles.fileSize}>{formatBytes(node.size)}</span>
        </button>
      );
    });

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarText}>
          <span className={styles.workDir}>
            {tree.data?.workDir || t("数据面工作目录", "Data plane work dir")}
          </span>
          <span className={styles.toolbarHint}>
            {t(
              "只读 · 宿主 data-plane-run/work → 容器 /data-plane · conf / topology / connectors / models",
              "Read-only · host data-plane-run/work → container /data-plane · conf / topology / connectors / models",
            )}
            {files.length > 0
              ? t(" · 共 {count} 个文件", " · {count} files", {
                  count: String(files.length),
                })
              : null}
          </span>
        </div>
        <div className={styles.toolbarActions}>
          <button
            type="button"
            className={styles.refreshButton}
            onClick={() => {
              void tree.refetch();
              if (selected) void file.refetch();
            }}
            disabled={tree.isFetching}
          >
            {tree.isFetching
              ? t("刷新中…", "Refreshing…")
              : t("刷新", "Refresh")}
          </button>
        </div>
      </div>

      {tree.isLoading ? (
        <div className={styles.notice}>
          {t("正在读取配置…", "Loading config…")}
        </div>
      ) : null}

      {tree.isError ? (
        treeUnavailable ? (
          <div className={styles.noticeWarn}>
            {t(
              "网关没有挂载数据面工作目录（/data-plane），因此看不到配置与规则。需要 wist-gateway-stack ≥ 0.2.24 并重新 localize/起栈。",
              "The gateway has no data-plane work dir mounted (/data-plane), so config and rules are unavailable. Requires wist-gateway-stack ≥ 0.2.24 and a re-localize/restart.",
            )}
          </div>
        ) : treeMissingEndpoint ? (
          <div className={styles.noticeWarn}>
            {t(
              "网关版本较旧，还没有「配置与规则」接口。升级网关后即可看到数据面配置。",
              "This gateway is too old to expose config and rules. Upgrade it to see the data plane config.",
            )}
          </div>
        ) : isRateLimitedError(tree.error) ? (
          <RateLimitNotice error={tree.error} />
        ) : (
          <div className={styles.noticeError}>
            {t("无法读取数据面配置。", "Cannot read the data plane config.")}
          </div>
        )
      ) : null}

      {!tree.isLoading && !tree.isError && files.length === 0 ? (
        <div className={styles.notice}>
          {t(
            "工作目录里没有可浏览的配置或规则文件。",
            "No browsable config or rule files in the work dir.",
          )}
        </div>
      ) : null}

      {files.length > 0 ? (
        <div className={styles.layout}>
          <div className={styles.treePane}>
            <div className={styles.treeTools}>
              <span className={styles.treeTitle}>{t("文件", "Files")}</span>
              <span className={styles.treeActions}>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() =>
                    setExpanded(collectDirs(nodes, new Set<string>()))
                  }
                >
                  {t("展开全部", "Expand all")}
                </button>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => setExpanded(new Set<string>())}
                >
                  {t("收起全部", "Collapse all")}
                </button>
              </span>
            </div>
            <nav
              className={styles.tree}
              aria-label={t("配置文件", "Config files")}
            >
              {renderNodes(nodes, 0)}
              {tree.data?.truncated ? (
                <div className={styles.truncated}>
                  {t(
                    "文件过多，只列出了前 4096 条。",
                    "Too many files; only the first 4096 are listed.",
                  )}
                </div>
              ) : null}
            </nav>
          </div>

          <section className={styles.viewer}>
            {selected === null ? (
              <div className={styles.notice}>
                {t("在左侧选择一个文件。", "Pick a file on the left.")}
              </div>
            ) : file.isLoading ? (
              <div className={styles.notice}>
                {t("正在读取文件…", "Loading file…")}
              </div>
            ) : file.isError ? (
              fileUnavailable ? (
                <div className={styles.noticeWarn}>
                  {t(
                    "网关没有挂载数据面工作目录（/data-plane）。",
                    "The gateway has no data-plane work dir mounted (/data-plane).",
                  )}
                </div>
              ) : fileMissing ? (
                <div className={styles.noticeWarn}>
                  {t(
                    "文件已不存在（可能刚被发布流程替换），请刷新目录树。",
                    "The file no longer exists (it may have just been replaced by a publish); refresh the tree.",
                  )}
                </div>
              ) : isRateLimitedError(file.error) ? (
                <RateLimitNotice error={file.error} />
              ) : (
                <div className={styles.noticeError}>
                  {t("读取文件失败。", "Failed to read the file.")}
                </div>
              )
            ) : file.data ? (
              <>
                <header className={styles.viewerHead}>
                  <span className={styles.viewerPath}>{file.data.path}</span>
                  <span className={styles.viewerMeta}>
                    {formatBytes(file.data.size)} ·{" "}
                    {formatTime(file.data.modified)}
                  </span>
                  <button
                    type="button"
                    className={styles.copyButton}
                    onClick={copy}
                    disabled={file.data.content === null}
                  >
                    {copied ? t("已复制", "Copied") : t("复制", "Copy")}
                  </button>
                </header>
                {file.data.truncated ? (
                  <div className={styles.noticeWarn}>
                    {t(
                      "文件超过 1 MiB，这里只显示前 1 MiB。",
                      "File is larger than 1 MiB; only the first 1 MiB is shown.",
                    )}
                  </div>
                ) : null}
                {file.data.binary ? (
                  <div className={styles.noticeWarn}>
                    {t(
                      "不是文本文件（非 UTF-8），不展示内容。",
                      "Not a text file (invalid UTF-8); content is not shown.",
                    )}
                  </div>
                ) : file.data.content === "" ? (
                  <div className={styles.notice}>
                    {t("（空文件）", "(empty file)")}
                  </div>
                ) : (
                  <pre className={styles.code}>{file.data.content}</pre>
                )}
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
