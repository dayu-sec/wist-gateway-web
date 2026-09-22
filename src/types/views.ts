/**
 * 管理面「Agent 用途」视图（模型 `AdminViewAgentPurpose` → 视图结构 `AgentPurposeView`）。
 *
 * 三分**并列**：事实（agentd 报）/ 推断（网关按规则表算，可变可过期）/ 判定（人定，留痕）。
 * 冲突时以判定为准，但推断仍然并列展示 —— 不是谁盖掉谁。
 *
 * 字段对应后端 `GET /api/v1/admin/agents/{agent_id}/purpose` 的 snake_case 载荷；
 * 与其它 admin 视图一致，在 `src/api/admin.ts` 的 normalizer 里转成 camelCase，
 * 缺字段/类型不符时抛错，不把服务端契约漂移静默成空值。
 */

/** 机器类别（模型 `Content.MachineClass`，闭合取值）。 */
export type MachineClass = "MacDaily" | "MacDev" | "LinuxCompute" | "LinuxData";

/**
 * 事实摘要（模型 `AgentFactSummary`）。
 *
 * 不是原文：agentd 在采集完后**机械压缩**（去重 + 只留推断要用的字段），
 * 覆盖式一台一条；原文快照走数据面，网关只留这一份小摘要。
 */
export interface AgentFactSummary {
  agentId: string;
  /** 内容摘要：**幂等键**。事实上报按内容变化触发，不按 revision 前进。 */
  contentDigest: string;
  /** 仅留痕，不参与判重。 */
  revision: number;
  observedAt: string;
  os: string;
  arch: string;
  /** 去重**前**的进程条数（去重会毁掉基数，留一个原始计数备查）。 */
  processCount: number;
  /** 去重后的进程可执行标识；macOS 是完整路径，Linux 只是 basename。 */
  processExecutables: string[];
  /** 已装包名（当前只有 linux 侧采集）。 */
  packages: string[];
  listenPorts: string[];
  /**
   * 主机标识（发现方向 `host` 的 `host.id`）。
   *
   * 这是**展示用留痕**：不进内容摘要，所以改机器名、换网（DHCP）不会触发重报与重算。
   * 空串表示这台还没上报过 —— 旧版 agentd 根本不带这些字段，不是「标识就是空」。
   */
  hostId: string;
  /** 主机名（`host.name`）。同样只作留痕。 */
  hostName: string;
  /** 网卡地址，每块网卡一条，形如 `en0 192.168.1.5/24`。同样只作留痕。 */
  networkAddresses: string[];
  receivedAt: string;
}

/** 一条命中依据（模型 `PurposeSignal`）：回答「凭什么这么判」。没有依据的建议不给人工看。 */
export interface PurposeSignal {
  ruleId: string;
  /** process | process_path | listen_port | package | unit（模型里是开放字符串）。 */
  kind: string;
  /** 实际命中规则的那个信号值。 */
  value: string;
  /** 该规则给类别加的分；**可为负**，表示反向证据。 */
  weight: number;
}

/** 用途建议（模型 `PurposeSuggestion`）：可变化、可过期，不直接决定采集内容。 */
export interface PurposeSuggestion {
  suggestionId: string;
  agentId: string;
  suggestedClass: MachineClass;
  /**
   * 0..100：最高分相对次高分的优势；总分低于规则册的 `weak_score` 时打对折。
   * **0 表示只有基线类别兜底**（无有效规则命中），不是「非常确定」。
   */
  confidence: number;
  /** rule | model（模型里是开放字符串：模型线在中心）。 */
  method: string;
  /** 取的是哪一册规则；平台无规则册时不会有建议，所以有建议时通常非空。 */
  ruleSetId: string | null;
  /** 逐条命中依据；基线兜底时为空。 */
  signals: PurposeSignal[];
  /** 依据哪一版事实算的。 */
  observedAt: string;
  computedAt: string;
}

/**
 * 人工判定（模型 `AgentClassification`）：一台机器一条，改判即更新并留痕。
 *
 * 当前管理面的写入端点还没实现，`AgentPurposeView.classification` 恒为 `null`；
 * 这里按模型如实声明，写入端点落地后页面无需再改结构。
 */
export interface AgentClassification {
  agentId: string;
  machineClass: MachineClass;
  /** 采纳了哪次建议；人工直接判定/推翻建议时为空。 */
  suggestionId: string | null;
  decidedBy: string;
  decidedAt: string;
  note: string | null;
}

/** 管理面「Agent 用途」视图（模型 `AgentPurposeView`）：事实 / 推断 / 判定三分并列。 */
export interface AgentPurposeView {
  agentId: string;
  /** 还没上报过事实时为空（新注册的 Agent）；与 HTTP 404「未知 Agent」是两回事。 */
  factSummary: AgentFactSummary | null;
  suggestion: PurposeSuggestion | null;
  /** 人工判定：写入端点未实现，当前恒为 null。 */
  classification: AgentClassification | null;
  generatedAt: string;
}
