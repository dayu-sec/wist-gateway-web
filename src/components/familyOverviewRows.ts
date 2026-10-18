import type {
  ContentCatalogView,
  ContentFamilyView,
  ContentUnitView,
  MachineClass,
} from "../types/views";

/**
 * 采集面全景的**纯派生**：把词表（`families`）、就绪度（`readiness`，已摊平成一面一条）
 * 与模板覆盖（`templates[].familyScope`）拼成一行一面。
 *
 * 为什么单独放一个纯函数：页面只负责渲染，这里才是「已定义 / 有单元 / 已就绪」的判定规则。
 * 三个状态必须分开，否则会被读成同一件事：
 *   - `unconfigured`：词表里有，但**任何平台都没有单元** —— 面已定义，还没配内容；
 *   - `draft`：有单元，但没有一个 `status = active` —— 还不能派；
 *   - `ready`：至少一个单元采集就绪 —— 可以派下去采。
 *
 * 注意 `readiness` **只包含有单元的面**：刚加、还没配单元的面只出现在 `families` 里。
 */

export type FamilyState = "ready" | "draft" | "unconfigured";

export interface FamilyPlatformReadiness {
  platform: string;
  activeUnits: number;
  parseReadyUnits: number;
  totalUnits: number;
}

export interface FamilyOverviewRow {
  family: ContentFamilyView;
  /** 这个面的采集单元（一个面具体采什么）。可能为空：词表已定义、内容还没配。 */
  units: ContentUnitView[];
  /** 各平台明细（只列 `readiness` 里真有的平台；没有单元的平台不出现）。 */
  perPlatform: FamilyPlatformReadiness[];
  /** 各平台合计。 */
  activeUnits: number;
  parseReadyUnits: number;
  totalUnits: number;
  /** 声明覆盖到这个面的机器类别（`templates[].familyScope`）。 */
  machineClasses: MachineClass[];
  state: FamilyState;
}

export type FamilyFilter = "all" | "ready" | "unready" | "unconfigured";

/** 一行一面；顺序跟词表一致（网关按 ID 排序返回）。 */
export function buildFamilyOverview(
  catalog: ContentCatalogView | null,
): FamilyOverviewRow[] {
  if (!catalog) return [];
  const readiness = catalog.readiness ?? [];
  const templates = catalog.templates ?? [];
  const units = catalog.units ?? [];

  return catalog.families.map((family) => {
    const familyUnits = units.filter((unit) => unit.family === family.id);
    const perPlatform = readiness
      .filter((entry) => entry.family === family.id)
      .map((entry) => ({
        platform: entry.platform,
        activeUnits: entry.activeUnits,
        parseReadyUnits: entry.parseReadyUnits,
        totalUnits: entry.totalUnits,
      }))
      .sort((left, right) => left.platform.localeCompare(right.platform));

    const activeUnits = perPlatform.reduce((sum, entry) => sum + entry.activeUnits, 0);
    const parseReadyUnits = perPlatform.reduce(
      (sum, entry) => sum + entry.parseReadyUnits,
      0,
    );
    const totalUnits = perPlatform.reduce((sum, entry) => sum + entry.totalUnits, 0);

    const machineClasses: MachineClass[] = [];
    for (const template of templates) {
      if (
        template.familyScope.includes(family.id) &&
        !machineClasses.includes(template.machineClass)
      ) {
        machineClasses.push(template.machineClass);
      }
    }

    const state: FamilyState =
      totalUnits === 0 ? "unconfigured" : activeUnits > 0 ? "ready" : "draft";

    return {
      family,
      units: familyUnits,
      perPlatform,
      activeUnits,
      parseReadyUnits,
      totalUnits,
      machineClasses,
      state,
    };
  });
}

export function filterFamilyOverview(
  rows: readonly FamilyOverviewRow[],
  filter: FamilyFilter,
): FamilyOverviewRow[] {
  switch (filter) {
    case "all":
      return [...rows];
    case "ready":
      return rows.filter((row) => row.state === "ready");
    case "unready":
      return rows.filter((row) => row.state === "draft");
    case "unconfigured":
      return rows.filter((row) => row.state === "unconfigured");
  }
}

export function familyFilterCounts(
  rows: readonly FamilyOverviewRow[],
): Record<FamilyFilter, number> {
  return {
    all: rows.length,
    ready: rows.filter((row) => row.state === "ready").length,
    unready: rows.filter((row) => row.state === "draft").length,
    unconfigured: rows.filter((row) => row.state === "unconfigured").length,
  };
}
