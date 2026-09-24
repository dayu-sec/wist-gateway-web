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

/**
 * L1a 机械资产清单（管理面）。
 *
 * 这一层**刻意只做归并、不做识别**：网关把每台机器上报的事实摘要里的可执行路径
 * 机械地折成「这台机器上有什么」。条目只有**名字（来自路径）**，没有版本、没有 vendor
 * ——「识别」要在被管机器上读 `Info.plist` / 包管理器（属 L1b，未做）。
 *
 * 明细接口不聚合：同一个 `software_key`（例如一个 `.app` 包）会有**多条路径行**，
 * 页面按 `software_key` 分组展示。
 */

/** 条目来源类别（模型里的闭合 variant）：`app` = macOS `.app` 包，`binary` = 其余可执行路径。 */
export type SoftwareKind = "app" | "binary";

/**
 * 一条清单条目 = 一个可执行路径命中一条规则；**不是**一个「软件」。
 *
 * 清单是事实摘要的投影，随每次上报**覆盖式重建**，不保留历史。
 */
export interface AgentSoftwareEntry {
  /** 归并键：`.app` 是包路径本身，其余是那条可执行路径。 */
  softwareKey: string;
  /** 展示名，**从路径推出来的**（不是从包元数据读的，所以没有版本）。 */
  name: string;
  kind: SoftwareKind;
  /** 命中哪条归并规则（`macos-app-bundle` / `unix-path`）。 */
  matchedRule: string;
  path: string;
}

/** 「按机器看软件」：某台机器上的清单（模型 `ViewAgentSoftware`）。 */
export interface AgentSoftwareInventory {
  agentId: string;
  /**
   * 条目**行数**（去重后的可执行路径条数），**不是**软件个数：
   * 同一个 `.app` 里跑了几个可执行文件就是几行。后端直接算好，前端不重算。
   */
  paths: number;
  /** 其中 `kind = app` 的行数，同样不是「app 个数」。 */
  apps: number;
  /** 按 `kind, software_key, path` 排序；同键多行。 */
  entries: AgentSoftwareEntry[];
}

/** 持有某个键的一台机器。只有 `agent_id` 与 `path`：主机名/状态由页面拿 Agent 台账补。 */
export interface SoftwareHolder {
  agentId: string;
  path: string;
}

/** 「按软件看机器」里的一个归并键（模型 `ViewSoftwareHoldings` 的一项）。 */
export interface SoftwareKeySummary {
  softwareKey: string;
  name: string;
  kind: SoftwareKind;
  /**
   * 持有该键的**机器数**（对 `holders` 的 `agent_id` 去重），可能小于 `holders.length`
   * —— 同一台机器在同一个 `.app` 下有多条可执行路径时就是这种情况。
   */
  agentCount: number;
  holders: SoftwareHolder[];
}

/** 「按软件看机器」：按持有机器数降序的键列表。 */
export interface SoftwareFleetInventory {
  /** 实际键数多于返回条数（`limit` 被顶到上限）时为 true：页面必须明确提示被截断。 */
  truncated: boolean;
  software: SoftwareKeySummary[];
}

/**
 * 工作授权（模型 `Control.Agent.Work`）的视图结构。
 *
 * 对应后端 `GET /api/v1/admin/agents/{agent_id}/work`。后端返回的工作参数 `spec`
 * 是一个**JSON 字符串**（由采集目录的条目物化成「单元清单」），normalizer 会把它解析成
 * `WorkSpec.units`；解析失败不静默成空工作 —— 那是「网关发了坏参数」，页面要能说出来。
 */

/** 工作类型（模型 `WorkKind`）：常驻（持续到被替换或撤回）与一次性（有期限与终态）。 */
export type WorkKind = "Standing" | "OneShot";

/** 采集来源（模型 `CollectionSource` 的物化形态）：`kind` 决定 `target` 的含义。 */
export interface WorkSpecSource {
  /** FileGlob | Exporter | UnifiedLogPredicate | MetricInterval。 */
  kind: string;
  /** 路径通配 / 导出器标识 / 谓词 / 周期。 */
  target: string;
}

/** 工作参数里的一个**已物化**采集单元：agentd 拿着它就能直接采。 */
export interface WorkSpecUnit {
  unitId: string;
  /** collect_logs | collect_metrics。 */
  capability: string;
  /** 数据面 rule/oml 标识。 */
  ruleRef: string;
  /** none | root | fda —— 缺权限时说清缺什么，而不是安静地采不到。 */
  requiresPrivilege: string;
  sources: WorkSpecSource[];
}

/** 工作参数（`spec` 的解析结果）。 */
export interface WorkSpec {
  units: WorkSpecUnit[];
  /** 原始字符串：解析失败时页面把它原样露出来，便于对账。 */
  raw: string;
  /** 解析/形状错误的原因；`null` = 解析成功。 */
  error: string | null;
}

/** 常驻工作状态（模型 `StandingWork.status`）。 */
export type StandingWorkStatus = "active" | "paused" | "superseded" | "revoked";

/**
 * Agent 对某份工作的确认回执（网关侧留痕）。
 *
 * `null` = **从没确认过**：期望版本发了、Agent 一直没回 —— 这就是漂移，
 * 页面上必须与「已确认但版本旧了」分开呈现。
 */
export interface WorkAck {
  workId: string;
  agentId: string;
  workKind: WorkKind;
  planVersion: number;
  acknowledgedAt: string;
}

/** 一份常驻工作（一个采集面一份）。 */
export interface StandingWork {
  workId: string;
  agentId: string;
  /** 采集面（`CollectionFamily`）。 */
  family: string;
  spec: WorkSpec;
  /** 本工作按哪一版采集目录展开（目录换版不追改已授权工作）。 */
  catalogVersion: number;
  /** 生效依据：指向已批准的提案；人工直填时为 null。 */
  proposalId: string | null;
  /** 期望版本：网关每次改动 +1。 */
  planVersion: number;
  effectiveFrom: string;
  status: StandingWorkStatus;
  updatedBy: string;
  updatedAt: string;
  ack: WorkAck | null;
}

/** 一份一次性工作（按动作授权，有期限与终态）。 */
export interface OneShotWork {
  workId: string;
  agentId: string;
  /** 动作面：upgrade / snapshot / exec / …。 */
  action: string;
  spec: string;
  scheduledAt: string;
  /** 绝对截止：暂停也照走。 */
  deadlineAt: string;
  /** 执行预算（秒）：只在实际执行时消耗。 */
  timeoutSeconds: number;
  interruptible: boolean;
  /** dispatched | accepted | running | paused | succeeded | failed | timed_out | canceled | expired。 */
  status: string;
  pausedAt: string | null;
  pausedTotalSeconds: number;
  attempt: number;
  issuedBy: string;
  issuedAt: string;
  ack: WorkAck | null;
}

/** 管理面「Agent 工作」视图（模型 `WorkGrant` + 历史留痕）。 */
export interface AgentWorkView {
  agentId: string;
  /** 授权序号：Agent 据此判断快照有没有变（不承诺「指令重放」）。 */
  sequence: number;
  /** 当前生效的（active / paused）—— 这些才在下发的快照里。 */
  standing: StandingWork[];
  /** 未了结的一次性工作。 */
  oneShot: OneShotWork[];
  /** 已撤回 / 被取代的常驻工作（审计用，不下发）。 */
  retiredStanding: StandingWork[];
  /** 已了结的一次性工作（审计用，不下发）。 */
  settledOneShot: OneShotWork[];
  generatedAt: string;
}

/** 管理面授权/撤回工作的回执（模型 `WorkReceipt`）。 */
export interface WorkReceipt {
  workId: string;
  agentId: string;
  workKind: WorkKind;
  /** 操作结果：accepted | paused | resumed | revoked | rejected。 */
  status: string;
  planVersion: number;
  createdAt: string;
}

/**
 * 采集内容目录的**就绪度与模板**视图（管理面 `GET /api/v1/admin/content`）。
 *
 * 派活的取值空间就来自这里：能派哪个面，取决于该面在该平台上**有没有采集就绪的单元**
 * （授权闸门是面就绪度，不是模板的策展状态，也不是“解析规则写好了没有”）。
 * 页面用它把「不能派的面」挡在提交之前，而不是让网关回一个 409。
 *
 * **两个轴分开**：`ready` 是采集就绪（能不能派下去把原文拿回来），
 * `parseReady` 是解析就绪（拿回来的能不能归类、抽字段 —— 不参与闸门）。
 * 只报前者，会把「采到了但认不出是谁」看着像已就绪。
 *
 * 注意后端返回的就绪度是**按平台分组**的（`readiness: [{platform, families: […]}]`），
 * `src/api/admin.ts` 的 normalizer 会摊平成一面一条 —— 页面只需要「这个面能不能派」。
 */
export interface FamilyReadinessView {
  family: string;
  platform: string;
  /** 该面上采集就绪（`status = active`）的单元数。 */
  activeUnits: number;
  /** 采集就绪**且**解析就绪（`rule_ref` 非空）的单元数。 */
  parseReadyUnits: number;
  totalUnits: number;
  /** 至少一个采集就绪的单元 = 这个面能展开成工作。 */
  ready: boolean;
  /** 该面采下来的记录能被归类、抽字段（**不参与闸门**）。 */
  parseReady: boolean;
}

/** 常驻工作模板（模型 `WorkTemplate`）：这类机器该采什么。 */
export interface ContentTemplateView {
  templateId: string;
  machineClass: MachineClass;
  platform: string;
  /** 策展成熟度：active / draft / deprecated（**不是**授权闸门）。 */
  status: string;
  /** 按 `pack_refs` 展开后的面集。 */
  familyScope: string[];
  capabilityScope: string[];
}

/** 已装载的采集内容目录。 */
export interface ContentCatalogView {
  catalogVersion: number;
  /** 已被新版取代时非空（引用式版本锁：多版并存，不追改已授权工作）。 */
  supersededBy: number | null;
  templates: ContentTemplateView[];
  readiness: FamilyReadinessView[];
}

/**
 * 采集日志里的一条记录（管理面视图，无对应数据库表）。
 *
 * 日志链路是 agentd → warp-parse（数据面）→ 网关内部接入端点 → 网关主机上的
 * **本地 NDJSON 文件**。所以这一条不是查询出来的行，而是网关写盘时留下的原文剪影。
 *
 * - `observedAt` 是 **agentd 自己的观测时刻**，`receivedAt` 是**网关写入磁盘的时刻**
 *   —— 两者不是一回事，中间隔着上行链路与数据面处理，页面上必须分开标注。
 * - `raw` 是记录**原文**：一条多行日志在 NDJSON 里仍是一行（换行被转义），
 *   渲染时要保留换行，否则多行记录会被压成一行读错。
 * - `family` / `unit` 是这条来自**哪个采集面**、**哪个采集单元**（闭集，见
 *   `doc/design/center/collection-families.md`）；空串 = 不是平台派活来的（本机手工配置的输入）。
 * - `category` 是日志**类别**，当前恒为泛化的 `agent.log`（正文规则未就绪）。它**不是**采集面：
 *   两个面一起跑时正文规则还没就绪，只有 `family` 能把它们分开。
 * - `seq` 是 Agent 上行帧的序号。
 */
export interface AgentLogRecord {
  agentId: string;
  /** **采集面**（闭集，如 `ServiceLifecycle`）；空串 = 非派活来源。 */
  family: string;
  /** **采集单元 id**（如 `mac-launchd-service`）；空串 = 非派活来源。 */
  unit: string;
  /** agentd 自己的观测时刻（RFC3339）。 */
  observedAt: string;
  /** Agent 上行帧序号。 */
  seq: number;
  /** 日志类别；正文规则未就绪时恒为 `agent.log`。 */
  category: string;
  /** 记录来源描述（当前恒为「Agent 日志-原文」）。 */
  logDesc: string;
  /** 记录原文，**可能含换行**。 */
  raw: string;
  /** 网关把这条写入磁盘的时刻（RFC3339）。 */
  receivedAt: string;
}

/**
 * 管理面「采集日志」视图（对应后端 `GET /api/v1/admin/logs`）。
 *
 * 服务端读的是**文件尾部窗口**，返回最新的 N 条（写入顺序，旧 → 新）：
 * - `truncated = true` 表示窗口被截断 —— **更早的记录存在但没返回**，
 *   页面必须显式提示，否则操作者会把「这一窗」读成「全部」。
 * - `file` 是网关主机上 NDJSON 文件的绝对路径：操作者需要它去 `tail` / `grep` 原文。
 */
export interface AgentLogsView {
  /** 按写入顺序（旧 → 新）返回的最新 N 条。 */
  logs: AgentLogRecord[];
  /** 服务端本次生效的条数上限（夹到 1..1000）。 */
  limit: number;
  /** 尾部窗口被裁剪（更早的记录存在但未返回）。 */
  truncated: boolean;
  /** 网关主机上 NDJSON 文件的绝对路径。 */
  file: string;
}
