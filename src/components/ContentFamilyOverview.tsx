import { Fragment, useMemo, useState } from "react";
import { ApiError } from "../api";
import type { ContentCatalogView } from "../types/views";
import { t } from "../i18n";
import { adminApiErrorMessage } from "./adminApiError";
import { machineClassLabel } from "./SubsystemAgentPurposeView";
import {
  collectionFamilyName,
  collectionFamilySummary,
  indexCollectionFamilies,
} from "./collectionFamilyText";
import {
  buildFamilyOverview,
  familyFilterCounts,
  filterFamilyOverview,
  type FamilyFilter,
  type FamilyOverviewRow,
  type FamilyState,
} from "./familyOverviewRows";
import styles from "./ContentFamilyOverview.module.css";

/**
 * 「采集面」全景（`/knowledge` 的第二个 tab）。
 *
 * 回答三个问题，且**分开回答**（混在一起会把人引向错误的下一步）：
 *   1. 这一版知识库**定义了哪些面** —— 来自词表（`families`），新增面只改知识库；
 *   2. 每个面在哪些平台、**有没有单元** —— `readiness` 只含有单元的面，缺行 = 未建单元；
 *   3. 现在**能不能派下去采** —— 至少一个 `active` 单元（解析就绪是独立信号，不是闸门）。
 *
 * 这是**单台网关**的全景：它反映本机生效的那一版知识库。全机队的聚合在中心，不在这里。
 */
interface ContentFamilyOverviewProps {
  catalog: ContentCatalogView | null;
  loading: boolean;
  error: unknown;
}

const FILTERS: FamilyFilter[] = ["all", "ready", "unready", "unconfigured"];

function filterLabel(filter: FamilyFilter): string {
  switch (filter) {
    case "all":
      return t("全部", "All");
    case "ready":
      return t("已就绪", "Ready");
    case "unready":
      return t("有单元未就绪", "Units, not ready");
    case "unconfigured":
      return t("仅定义", "Defined only");
  }
}

function stateLabel(state: FamilyState): string {
  switch (state) {
    case "ready":
      return t("已就绪", "Ready");
    case "draft":
      return t("未就绪", "Not ready");
    case "unconfigured":
      return t("未建单元", "No units");
  }
}

function stateTone(state: FamilyState): string {
  switch (state) {
    case "ready":
      return styles.toneOk;
    case "draft":
      return styles.toneWarn;
    case "unconfigured":
      return styles.toneUnknown;
  }
}

function capabilityLabel(capability: string): string {
  switch (capability) {
    case "collect_logs":
      return t("采集日志", "Logs");
    case "collect_metrics":
      return t("采集指标", "Metrics");
    default:
      return capability;
  }
}

function privilegeLabel(privilege: string): string {
  switch (privilege) {
    case "none":
      return t("无需提权", "No privilege");
    case "root":
      return "root";
    case "fda":
      return t("完全磁盘访问", "Full disk access");
    default:
      return privilege;
  }
}

/** 一个面展开后的单元明细：具体从哪拿、什么条件、用什么规则、要不要提权。 */
function UnitDetails({ row }: { row: FamilyOverviewRow }) {
  if (row.units.length === 0) {
    return (
      <p className={styles.detailEmpty}>
        {t(
          "这个词表项还没有采集单元 —— 面已定义，内容还没配；配置单元并激活后，这里会列出具体采什么。",
          "This family has no collection units yet — it is defined, but no content has been configured. Once units exist and are activated, they will be listed here.",
        )}
      </p>
    );
  }
  return (
    <div className={styles.unitList}>
      {row.units.map((unit) => (
        <div key={unit.unitId} className={styles.unit}>
          <div className={styles.unitHead}>
            <span className={styles.unitId}>{unit.unitId}</span>
            <span className={styles.unitMeta}>{unit.platform}</span>
            <span className={styles.unitMeta}>{capabilityLabel(unit.capability)}</span>
            <span className={styles.unitMeta}>{privilegeLabel(unit.requiresPrivilege)}</span>
            <span
              className={`${styles.badge} ${
                unit.collectReady ? styles.toneOk : styles.toneUnknown
              }`}
            >
              {unit.collectReady
                ? t("采集就绪", "Collect ready")
                : t("非 active（{status}）", "Not active ({status})", {
                    status: unit.status,
                  })}
            </span>
            {unit.executable ? null : (
              <span className={`${styles.badge} ${styles.toneWarn}`}>
                {t("来源不可执行", "No runnable source")}
              </span>
            )}
            {unit.parseReady ? null : (
              <span className={`${styles.badge} ${styles.toneUnknown}`}>
                {t("仅原文", "Raw only")}
              </span>
            )}
          </div>

          <div className={styles.unitLine}>
            <span className={styles.unitLabel}>{t("前提", "Match")}</span>
            <code className={styles.unitValue}>
              {unit.match.trim() || t("无条件", "(none)")}
            </code>
          </div>
          <div className={styles.unitLine}>
            <span className={styles.unitLabel}>{t("规则", "Rule")}</span>
            <code className={styles.unitValue}>
              {unit.ruleRef.trim() || t("无（只落原文）", "(none — raw only)")}
            </code>
          </div>

          <ul className={styles.sourceList}>
            {unit.sources.map((source, index) => (
              <li key={`${unit.unitId}-${index}`} className={styles.source}>
                <span className={styles.sourceKind}>{source.kind}</span>
                <code className={styles.sourceTarget}>{source.target}</code>
                {source.multiline !== "none" ? (
                  <span className={styles.sourceMeta}>{source.multiline}</span>
                ) : null}
                {source.executable ? null : (
                  <span className={`${styles.badge} ${styles.toneWarn}`}>
                    {t("不可执行", "Not executable")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** 平台列：空 = 全平台（词表约定），不展开成具体平台。 */
function platformsText(row: FamilyOverviewRow): string {
  return row.family.platforms.length === 0
    ? t("全平台", "All platforms")
    : row.family.platforms.join(" / ");
}

/** 采集列的悬浮明细：每个平台各多少（只在有单元的平台上出现）。 */
function perPlatformTitle(row: FamilyOverviewRow): string | undefined {
  if (row.perPlatform.length === 0) return undefined;
  return row.perPlatform
    .map(
      (entry) =>
        `${entry.platform}: ${entry.activeUnits}/${entry.totalUnits}` +
        (entry.parseReadyUnits > 0
          ? t("（可解析 {n}）", " (parsable {n})", { n: entry.parseReadyUnits })
          : ""),
    )
    .join(" · ");
}

export function ContentFamilyOverview({
  catalog,
  loading,
  error,
}: ContentFamilyOverviewProps) {
  const [filter, setFilter] = useState<FamilyFilter>("all");
  // 展开的详情：按面记住（可以同时展开多个，方便对比两个面各自采什么）。
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  function toggleFamily(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const familyText = useMemo(
    () => indexCollectionFamilies(catalog?.families),
    [catalog],
  );
  const rows = useMemo(() => buildFamilyOverview(catalog), [catalog]);
  const counts = useMemo(() => familyFilterCounts(rows), [rows]);
  const visible = useMemo(
    () => filterFamilyOverview(rows, filter),
    [rows, filter],
  );

  return (
    <section className={styles.card} aria-labelledby="content-families">
      <header className={styles.cardHead}>
        <h2 id="content-families">{t("采集面", "Collection families")}</h2>
        <p>
          {t(
            "这一版知识库定义了哪些面、每个面在哪些平台上有单元、现在能不能派下去采。面的名称与说明来自知识库，新增面不需要发前端。",
            "Which families this knowledge version defines, on which platforms they have units, and whether they can be collected right now. Names and summaries come from the knowledge base — adding a family needs no frontend release.",
          )}
        </p>
        <p className={styles.scopeHint}>
          {t(
            "这是目录全貌：目录里 macOS 与 Linux 的单元都会列出来，不按本机平台过滤 —— 「平台」列才是适用范围。",
            "This is the catalog as a whole: both macOS and Linux units are listed, not filtered by this host's platform — the “Platforms” column is what says where they apply.",
          )}
        </p>
      </header>

      {loading ? (
        <div className={styles.notice} role="status">
          {t("正在读取采集内容目录…", "Loading the content catalog…")}
        </div>
      ) : null}

      {error ? (
        <div className={styles.noticeBlock}>
          <div className={styles.noticeDanger} role="alert">
            {error instanceof ApiError && error.status === 503
              ? t(
                  "网关没有装载采集内容目录（知识库空载 / 未配 [content]），这一版没有任何面。录入并激活知识包后即可看到。",
                  "The gateway has no content catalog loaded (empty knowledge base / no [content] configured), so there are no families. Record and activate a knowledge package to see them.",
                )
              : adminApiErrorMessage(error)}
          </div>
        </div>
      ) : null}

      {!loading && !error && catalog !== null && rows.length === 0 ? (
        <div className={styles.empty}>
          <strong>
            {t(
              "这一版知识库没有面词表",
              "This knowledge version has no family vocabulary",
            )}
          </strong>
          <span>
            {t(
              "旧版知识包（还没有 [[families]]）只能回落成内置基线。录入并激活新版知识库后，这里会按词表显示全部面。",
              "Older packages (without [[families]]) fall back to the built-in baseline. Record and activate a newer knowledge package to list every family from the vocabulary.",
            )}
          </span>
        </div>
      ) : null}

      {!loading && !error && rows.length > 0 ? (
        <>
          <div className={styles.summary}>
            <span>
              {t("目录 v{v}", "Catalog v{v}", {
                v: catalog?.catalogVersion ?? "—",
              })}
            </span>
            <span>{t("共 {n} 个面", "{n} families", { n: counts.all })}</span>
          </div>

          <div
            className={styles.filters}
            role="group"
            aria-label={t("筛选采集面", "Filter collection families")}
          >
            {FILTERS.map((item) => (
              <button
                key={item}
                type="button"
                className={`${styles.filterChip} ${
                  filter === item ? styles.filterChipActive : ""
                }`}
                aria-pressed={filter === item}
                onClick={() => setFilter(item)}
              >
                {filterLabel(item)}
                <span className={styles.filterCount}>{counts[item]}</span>
              </button>
            ))}
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t("采集面", "Family")}</th>
                  <th>{t("平台", "Platforms")}</th>
                  <th>{t("说明", "Summary")}</th>
                  <th>{t("采集就绪", "Collect ready")}</th>
                  <th>{t("解析就绪", "Parse ready")}</th>
                  <th>{t("覆盖机型", "Machine classes")}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const open = expanded.has(row.family.id);
                  return (
                    <Fragment key={row.family.id}>
                      <tr>
                        <td>
                          <button
                            type="button"
                            className={styles.expandButton}
                            aria-expanded={open}
                            onClick={() => toggleFamily(row.family.id)}
                          >
                            <span className={styles.chevron} aria-hidden>
                              {open ? "▾" : "▸"}
                            </span>
                            {/* 两行固定分工：第一行「面名 + 面 id」，第二行「状态 + 单元数」。
                                原先四个 span 一起 flex-wrap，名字长短不同就把状态徽标挤上挤下 ——
                                同一列里徽标不在一条竖线上，扫读时要逐行找。 */}
                            <span className={styles.nameCell}>
                              <span className={styles.nameLine}>
                                <span className={styles.workName}>
                                  {collectionFamilyName(row.family.id, familyText)}
                                </span>
                                <span className={styles.code}>{row.family.id}</span>
                              </span>
                              <span className={styles.metaLine}>
                                <span
                                  className={`${styles.badge} ${stateTone(row.state)}`}
                                >
                                  {stateLabel(row.state)}
                                </span>
                                <span className={styles.unitCount}>
                                  {t("{n} 个单元", "{n} units", {
                                    n: row.units.length,
                                  })}
                                </span>
                              </span>
                            </span>
                          </button>
                        </td>
                        <td className={styles.mono}>{platformsText(row)}</td>
                        <td className={styles.summaryCell}>
                          {collectionFamilySummary(row.family.id, familyText) ?? "—"}
                        </td>
                        <td className={styles.mono} title={perPlatformTitle(row)}>
                          {row.state === "unconfigured"
                            ? "—"
                            : `${row.activeUnits} / ${row.totalUnits}`}
                        </td>
                        <td className={styles.mono}>
                          {row.state === "unconfigured" || row.activeUnits === 0
                            ? "—"
                            : `${row.parseReadyUnits} / ${row.activeUnits}`}
                        </td>
                        <td className={styles.classesCell}>
                          {row.machineClasses.map(machineClassLabel).join("、") || "—"}
                        </td>
                      </tr>
                      {open ? (
                        <tr className={styles.detailRow}>
                          <td colSpan={6}>
                            <UnitDetails row={row} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {visible.length === 0 ? (
            <p className={styles.emptyFilter}>
              {t("这个筛选下没有面。", "No families match this filter.")}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
