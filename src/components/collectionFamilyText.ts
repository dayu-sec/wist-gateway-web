import { t } from "../i18n";
import type { ContentFamilyView } from "../types/views";

/**
 * 采集面（`CollectionFamily`）的**工作名**与**说明文字**。
 *
 * 面名本身（`LoginSession` 这类）是协议值：进数据帧、进接口、大小写敏感，**不翻译**。
 * 页面上讲给人听的名称与说明来自**知识库**（`catalog.toml` 的 `[[families]]`），由网关
 * `GET /api/v1/admin/content` 随内容目录一起返回 —— 新增面只改知识库，**前端不发版**。
 *
 * 缺项（旧网关不返回词表 / 词表里没有这个面 / 文案为空）时回落成面 ID，且**不编造**说明。
 */
export type CollectionFamilyTextIndex = ReadonlyMap<string, ContentFamilyView>;

/** 把网关返回的词表做成按 ID 查的索引；`null` / 未返回 = 空索引（全部回落成面 ID）。 */
export function indexCollectionFamilies(
  families: readonly ContentFamilyView[] | null | undefined,
): CollectionFamilyTextIndex {
  const index = new Map<string, ContentFamilyView>();
  for (const family of families ?? []) {
    index.set(family.id, family);
  }
  return index;
}

/**
 * 面的人类可读工作名。未知面回落成面名本身（协议值仍然可读）。
 *
 * `t()` 必须在**渲染期**求值：调用方在组件体内调用本函数，不要放进模块顶层常量。
 */
export function collectionFamilyName(
  family: string,
  index: CollectionFamilyTextIndex,
): string {
  const text = index.get(family);
  if (!text) return family;
  const zh = text.nameZh.trim();
  const en = text.nameEn.trim();
  if (!zh && !en) return family;
  return t(zh || en, en || zh);
}

/** 面的说明文字。缺项返回 `null` —— 不编造它采什么。 */
export function collectionFamilySummary(
  family: string,
  index: CollectionFamilyTextIndex,
): string | null {
  const text = index.get(family);
  if (!text) return null;
  const zh = text.summaryZh.trim();
  const en = text.summaryEn.trim();
  if (!zh && !en) return null;
  return t(zh || en, en || zh);
}
