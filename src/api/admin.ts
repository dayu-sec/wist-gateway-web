import type {
  AgentClassification,
  AgentFactSummary,
  AgentLogRecord,
  AgentLogsView,
  AgentLocalOneShotWorkView,
  AgentLocalStandingWorkView,
  AgentLocalTaskView,
  AgentLocalWorkView,
  AgentPurposeView,
  AgentSoftwareEntry,
  AgentSoftwareInventory,
  AgentWorkView,
  ContentCatalogView,
  ContentTemplateView,
  FamilyReadinessView,
  MachineClass,
  OneShotWork,
  PurposeSignal,
  PurposeSuggestion,
  RolloutPhaseView,
  RolloutPlanDetailView,
  RolloutPlanEntryView,
  RolloutPlanView,
  SoftwareFleetInventory,
  SoftwareHolder,
  SoftwareKeySummary,
  SoftwareKind,
  StandingWork,
  StandingWorkStatus,
  WorkAck,
  WorkKind,
  WorkReceipt,
  WorkResult,
  WorkSpec,
} from "../types";

/**
 * Agent **实际生效**的数据面上送状态（`GET /api/v1/admin/agents/{agent_id}/runtime-status`
 * 的 `uplink_state`）。它与网关下发的「数据面上送授权」是一对：一个说「要它怎样」，
 * 一个说「它实际成了怎样」。
 *
 * 为什么页面需要它：**待命与故障别处长得一样** —— 两种情况都没数据。`enabled` 说开关、
 * `source` 说这份状态是谁定的（控制面 / 本机）、`outputWriteFailing` 说「启用了但发不出去」。
 * `null` = 这台 agent 还没上报过（旧版本 agentd 不发这个字段）。
 */
export interface AgentUplinkStateView {
  /** 生效总闸：false = 待命（不采集、不上送）。 */
  enabled: boolean;
  /** 生效输出类型：`tcp`（上送数据面）| `file`（写本机文件，不是上送）。 */
  kind: string;
  /** 生效目标（`tcp` 且有目标时）；null = 本机文件输出，或 tcp 但没目标。 */
  target: string | null;
  /** 这份状态的来源：`grant`（控制面下发）| `local`（未下发，用本机配置）。 */
  source: string;
  /** 最近的出口写失败是否**尚未恢复**（细节在 agentd 日志：目标与原因）。 */
  outputWriteFailing: boolean;
}

export interface AgentRuntimeStatusView {
  agentId: string;
  instanceId: string;
  version: string;
  status: "online" | "offline";
  health: "healthy" | "degraded" | "unhealthy";
  lastSeenAt: string;
  /** agent 实际生效的数据面上送状态；null = 还没上报过（旧版本 agentd 不发）。 */
  uplinkState: AgentUplinkStateView | null;
  /** agent 上报的客户端证书状态（mTLS）；null = 还没上报过 / 没证书。 */
  certificateStatus: AgentCertificateStatusView | null;
  /** 是否在**拒绝名单**内（被吊销）。true 时它的任何凭据路径都会被 401 `certificate_revoked`。 */
  revoked: boolean;
}

/**
 * agent 上报的**客户端证书状态**（`runtime-status` 的 `certificate_status`，§5.5）。
 *
 * 为什么只有本机能报：服务端在**握手期**就验完证书，过期证书根本进不来，所以
 * 「还剩多久 / 是不是该续了」只能由 agent 自己读 `notAfter` 上报。`null` = 还没报过 / 没证书。
 */
export interface AgentCertificateStatusView {
  /** 证书到期时间（RFC3339）。 */
  notAfter: string;
  /** 距到期的剩余秒数（agent 本地判定）。 */
  remainingSeconds: number;
  /** `valid` | `renew_due`（落在 30 天续期窗内）| `expired`。 */
  state: string;
  /** agent 本机**最近一次续签判定**（§5.5）；null = 老版本 agentd 没报过。 */
  lastRenewal: AgentCredentialRenewalView | null;
}

/**
 * agent 本机**最近一次续签判定**（`certificate_status.last_renewal`，§5.5）。
 *
 * 与 agentd 本地台账 `identity/renewal.json` 同口径：agentd 原样带上来，网关只存/展示。
 */
export interface AgentCredentialRenewalView {
  /** `not_due` / `renewed` / `failed` / `needs_reinstall` / `revoked`。 */
  outcome: string;
  /** 本次判定时刻（RFC3339）。 */
  checkedAt: string;
  /** 人读细节（失败原因 / 续到了什么时候…）；无内容时为空串。 */
  detail: string;
  /** 续签后证书的到期时刻（RFC3339）；无证书时为空串。 */
  notAfter: string;
}

/**
 * 拒绝名单（吊销状态表，§5.6）里的一条：按 `agent_id` 拒绝，续签、重签都还是同一个 id。
 *
 * 对应模型 `Agent.Certificate.AgentCertificateDenylistEntry`（字段与模型一致）。
 */
export interface AgentRevocationView {
  /** 代理主键（`denylist-<agent_id>`）。 */
  entryId: string;
  agentId: string;
  /** 吊销原因（人工填写，可空串）。 */
  reasonCode: string;
  /** 谁吊销的（管理面录入，可空串）。 */
  deniedBy: string;
  /** 加入名单的时刻（RFC3339）。 */
  deniedAt: string;
  /** GC 水位（RFC3339）：条目保留到被吊销证书的自然过期时间为止。 */
  retainUntil: string;
}

/**
 * **已注册** Agent 的一条（`GET /api/v1/admin/agents` = `list_agents`）。
 *
 * 为什么单独有它：机队索引页（升级 / 采集工作）要的是「**注册表里的机器**」，而不是
 * 「有主机指标的机器」—— 后者会把待命/新装的 Agent 漏掉（它们不上送指标），于是那些机器
 * 在页面上彻底不可见。
 */
export interface AgentListEntryView {
  agentId: string;
  instanceId: string;
  hostname: string;
  version: string;
  status: string;
  health: string;
}

export interface AgentOverviewMetrics {
  totalAgents: number;
  onlineAgents: number;
  unhealthyAgents: number;
  lastSeenLagSeconds: number;
}

export interface AgentMetricSample {
  at: string;
  memoryBytes?: number;
  /**
   * 单核口径的进程 CPU 占比（100% = 占满一个核，可能 > 100）。
   * 只统计 agent 进程自身，不代表整机负载。
   */
  cpuPercent?: number;
  /**
   * 整机口径的 CPU 占比（0..100），由网关按「单核占比 ÷ 逻辑核数」派生。
   * 缺省表示后端没测到，页面应当显示「—」而不是 0。
   */
  cpuPercentOfMachine?: number;
  /** agent 所在机器的逻辑核数；缺省表示后端没上报。 */
  cpuCores?: number;
  adminLatencyMs?: number;
}

export interface RecentOnlineRegisteredAgent {
  agentId: string;
  instanceId: string;
  version: string;
  registeredAt: string;
  onlineSince: string;
  onlineDurationSeconds: number;
  source: "real" | "example";
  memoryBytes?: number;
  /**
   * 单核口径的进程 CPU 占比（100% = 占满一个核，可能 > 100）。
   * 只统计 agent 进程自身，**不是**整机 CPU。
   */
  cpuPercent?: number;
  /**
   * 整机口径的 CPU 占比（0..100），由网关按「单核占比 ÷ 逻辑核数」派生。
   * 缺省表示后端没测到，页面显示「—」而不是 0。
   */
  cpuPercentOfMachine?: number;
  /** agent 所在机器的逻辑核数；缺省表示后端没上报。 */
  cpuCores?: number;
  adminLatencyMs?: number;
  metricsHistory?: AgentMetricSample[];
}

export interface AgentOverview {
  metrics: AgentOverviewMetrics;
  recentOnlineAgents: RecentOnlineRegisteredAgent[];
  abnormalAgents: AgentRuntimeStatusView[];
}

export interface AgentHostMetrics {
  agentId: string;
  loadAverage1m?: number;
  loadAverage5m?: number;
  loadAverage15m?: number;
  uptimeSeconds?: number;
  memoryTotalKb?: number;
  memoryAvailableKb?: number;
  diskUsagePercent?: number;
  diskTotalKb?: number;
  diskAvailableKb?: number;
  history?: AgentHostMetricsHistory;
}

export interface AgentHostMetricsHistory {
  loadAverage1m: [number, number][];
  loadAverage5m: [number, number][];
  loadAverage15m: [number, number][];
  memoryTotalKb: [number, number][];
  memoryAvailableKb: [number, number][];
  diskUsagePercent: [number, number][];
}

export interface AgentHostMetricsSummary {
  agentId: string;
  loadAverage1m?: number;
  memoryTotalKb?: number;
  memoryAvailableKb?: number;
  diskUsagePercent?: number;
}

export interface AgentInstallCode {
  x86LinuxInstallCode: string;
  armLinuxInstallCode: string;
  macosInstallCode: string;
  bootstrapEnrollmentToken: string;
}

/**
 * 网关分发的 Agent 安装包地址（管理面设置）。
 *
 * `packageSha256` / `updatedAt` 为 null 表示从未在管理面添加过。地址仍会返回（网关自己的
 * 分端点，与当前生效值无关，便于页面直接展示）；但**没有添加过就没有可用包**。
 */
export interface AgentInstallPackage {
  addressId: string;
  packageUrl: string;
  packageSha256: string | null;
  updatedBy: string;
  updatedAt: string | null;
}

export interface SetAgentInstallPackageCommand {
  packageUrl: string;
  packageSha256?: string;
  requestedBy?: string;
}

/**
 * Agent 的数据面上送目标（生效值）。
 *
 * Agent 通过 TCP 把采集到的日志与指标上送到数据面的 `host:port`。
 * 它现在是**运行期**的目标：网关在 `uplink:poll` 上现算上送授权（是否启用 + 目标），
 * 所以改一次对**已在网**的 Agent 下一个 poll（≤30s）就生效，不需要重装。
 *
 * 目标有两级来源（见网关的 `effective_agent_uplink`）：
 * ① 管理面设过 → 用它（用于“数据面不在网关本机”的部署）；
 * ② 没设过 → 按部署配置派生：与网关对外地址同域 + 数据面端口（一台机器、一个域名）。
 *   此时 `updatedAt` 为 null —— 页面据此显示「来自部署配置」。
 *
 * 是否启用由两道**并集**决定（见网关 `build_agent_uplink_grant`）：
 * ① 该 Agent 有生效工作（派工即启用、撤回即待命）；
 * ② 部署级 `enabled` 开关打开 —— 它回答「这套网关现在收不收数据面数据」，与「这台干什么活」
 *    正交。新装的机器没有活，光靠 ① 会永远待命（注册成功却什么也干不了）。
 * 还有目标（两种来源都算）才能真启用；否则 Agent 待命
 * （不采集日志、也不向数据面上送；但事实摘要仍上报，见待命语义）。
 *
 * `updatedAt` 为 null = 不是管理面录入的值（`host` 可能是派生值）；
 * `host` 为空串才是真的没有目标（连派生都派不出）。
 */
export interface AgentUplink {
  settingId: string;
  host: string;
  port: number;
  /** 部署级启用开关的生效值（见上面的 ②）。 */
  enabled: boolean;
  /**
   * `enabled` 是不是管理面**录入**的（而不是派生的默认 `false`）。
   *
   * 为什么与 `enabled` 分开：页面要能区分「从未录入过」与「录入过一次、开着/关着」。
   * 与 `updatedAt` 同口径（同一个设置行的更新时刻）。
   */
  enabledConfigured: boolean;
  updatedBy: string;
  updatedAt: string | null;
}

export interface SetAgentUplinkCommand {
  host: string;
  port: number;
  /**
   * 部署级启用开关。**必填**：表单总是显式给出当前值。
   *
   * 后端对缺失值是「按 false 处理」（兼容老前端），所以这里不能依赖它 ——
   * 编辑地址时把开关忘了带上去，会被读成「关掉」而不是「不动」。
   */
  enabled: boolean;
  requestedBy?: string;
}

/**
 * 网关对外地址（管理面设置）：控制平台对 Agent **宣告**的地址。
 *
 * 它是「新装 Agent 会连到哪」的唯一来源 —— 渲染成初始配置里的
 * `[control_plane] endpoint`，同时是安装命令 / install.sh / 安装包分发 URL 的基址。
 * 之所以要能从管理面改：配置文件里的 `server.public_base_url` 是启动期值，而对外入口
 * （域名、端口、反代）常由部署侧决定并会随后调整；拿内部地址当 agent 的默认控制面
 * 地址，装出来的 agent 必然连不上。
 *
 * `updatedAt` 为 null 表示管理面从未设置过，此时网关实际用的是配置文件里的值，
 * 也就是 `fallbackUrl`。界面要显示「当前生效地址」，不能只显示一个空值。
 */
export interface AgentAdvertiseUrl {
  settingId: string;
  /** 管理面设置值；未设置时为空串。 */
  url: string;
  /** 未设置时网关**实际**使用的基址（配置文件值）。 */
  fallbackUrl: string;
  updatedBy: string;
  updatedAt: string | null;
}

export interface SetAgentAdvertiseUrlCommand {
  url: string;
  requestedBy?: string;
}

/** 控制中心返回给 Gateway 的初始连接材料，字段与 Gateway 面接口契约一致。 */
export interface ControlCenterTrustBundle {
  trust_bundle_id: string;
  control_endpoint: string;
  ca_bundle: string;
  server_name: string;
  expected_san: string;
  issued_at: string | null;
  expires_at: string | null;
}

/** GET /api/v1/gateway/initial-config 的 config 载荷。 */
export interface GatewayInitialConfig {
  gateway_id: string;
  control_center_endpoint: string;
  trust_bundle: ControlCenterTrustBundle | null;
  server_tls_required: boolean;
  protocol_version: string;
  enrollment_token_id: string;
}

export type GatewayInstanceLifecycleState =
  "Provisioned" | "Initializing" | "Running" | "Failed";

/** Center 侧实例初始化状态；initialized 是 lifecycle_state 的服务端派生值。 */
export interface GatewayInitializationStatus {
  gateway_id: string;
  instance_id: string | null;
  lifecycle_state: GatewayInstanceLifecycleState;
  initialized: boolean;
}

/** 页面完成状态守卫并取得 JSON 初始配置后的结果。 */
export interface GatewayInitializationResult {
  config: GatewayInitialConfig;
  status: GatewayInitializationStatus;
}

export const ADMIN_AUTH_CHANGED_EVENT = "warpInsightAdminAuthChanged";
const ADMIN_API_TOKEN_STORAGE_KEY = "warpInsightAdminApiToken";

// Persist the admin token for the current browser session (survives page
// reloads, but is cleared when the tab/session closes).
let adminApiToken: string | null =
  typeof window !== "undefined"
    ? window.sessionStorage.getItem(ADMIN_API_TOKEN_STORAGE_KEY)
    : null;

export class ApiError extends Error {
  readonly status: number;
  /** Seconds until the per-IP rate-limit block expires, when status is 429. */
  readonly retryAfterSeconds?: number;
  /**
   * 后端返回的错误正文（若有，已截断）。
   *
   * 有些失败只有后端知道原因（例如「摘要与来源内容不符」「来源拉不到」），
   * 只带状态码的话页面只能给出笼统提示，操作者无从下手。
   */
  readonly detail?: string;

  constructor(
    status: number,
    path: string,
    retryAfterSeconds?: number,
    detail?: string,
  ) {
    super(`HTTP ${status} ${path}`);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.detail = detail;
  }
}

/** 初始化 URL 不满足 Center 当前入口契约时抛出，错误由页面作为表单反馈展示。 */
export class GatewayInitializationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayInitializationInputError";
  }
}

/** Center 已记录实例进入初始化态或运行态时抛出，阻止页面再次消费置备凭证。 */
export class GatewayAlreadyInitializedError extends Error {
  readonly status: GatewayInitializationStatus;

  constructor(status: GatewayInitializationStatus) {
    super("gateway is already initialized");
    this.name = "GatewayAlreadyInitializedError";
    this.status = status;
  }
}

export function isRateLimitedError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 429;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const adminToken = getAdminApiToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    if (response.status === 429) {
      const retryAfter = Number.parseInt(
        response.headers.get("Retry-After") ?? "",
        10,
      );
      throw new ApiError(
        response.status,
        path,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60,
        detail,
      );
    }
    throw new ApiError(response.status, path, undefined, detail);
  }
  return (await response.json()) as T;
}

/** 读取错误响应正文（截断）；失败时不影响原始错误。 */
async function readErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const text = (await response.text()).trim();
    if (!text) return undefined;
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
  } catch {
    return undefined;
  }
}

export function getAdminApiToken(): string | null {
  return adminApiToken;
}

export function setAdminApiToken(token: string): void {
  const trimmed = token.trim();
  adminApiToken = trimmed || null;
  if (typeof window !== "undefined") {
    if (adminApiToken) {
      window.sessionStorage.setItem(ADMIN_API_TOKEN_STORAGE_KEY, adminApiToken);
    } else {
      window.sessionStorage.removeItem(ADMIN_API_TOKEN_STORAGE_KEY);
    }
    window.dispatchEvent(new Event(ADMIN_AUTH_CHANGED_EVENT));
  }
}

export function clearAdminApiToken(): void {
  setAdminApiToken("");
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value === "string") return value;
  throw new Error(`Invalid API response: missing ${fieldName}`);
}

function requiredNumber(value: unknown, fieldName: string): number {
  if (typeof value === "number") return value;
  throw new Error(`Invalid API response: missing ${fieldName}`);
}

function requiredBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value === "boolean") return value;
  throw new Error(`Invalid API response: missing ${fieldName}`);
}

function requiredRecord(
  value: unknown,
  fieldName: string,
): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(`Invalid API response: missing ${fieldName}`);
}

function nullableString(value: unknown, fieldName: string): string | null {
  if (value === null) return null;
  return requiredString(value, fieldName);
}

function normalizeTrustBundle(value: unknown): ControlCenterTrustBundle | null {
  if (value === null) return null;
  const bundle = requiredRecord(value, "config.trust_bundle");
  return {
    trust_bundle_id: requiredString(
      bundle.trust_bundle_id,
      "config.trust_bundle.trust_bundle_id",
    ),
    control_endpoint: requiredString(
      bundle.control_endpoint,
      "config.trust_bundle.control_endpoint",
    ),
    ca_bundle: requiredString(
      bundle.ca_bundle,
      "config.trust_bundle.ca_bundle",
    ),
    server_name: requiredString(
      bundle.server_name,
      "config.trust_bundle.server_name",
    ),
    expected_san: requiredString(
      bundle.expected_san,
      "config.trust_bundle.expected_san",
    ),
    issued_at: nullableString(
      bundle.issued_at,
      "config.trust_bundle.issued_at",
    ),
    expires_at: nullableString(
      bundle.expires_at,
      "config.trust_bundle.expires_at",
    ),
  };
}

/** 按当前 JSON 契约收敛初始配置，避免把服务端错误静默成空字段。 */
export function normalizeGatewayInitialConfig(
  payload: unknown,
): GatewayInitialConfig {
  const root = requiredRecord(payload, "response");
  const config = requiredRecord(root.config, "config");
  return {
    gateway_id: requiredString(config.gateway_id, "config.gateway_id"),
    control_center_endpoint: requiredString(
      config.control_center_endpoint,
      "config.control_center_endpoint",
    ),
    trust_bundle: normalizeTrustBundle(config.trust_bundle),
    server_tls_required: requiredBoolean(
      config.server_tls_required,
      "config.server_tls_required",
    ),
    protocol_version: requiredString(
      config.protocol_version,
      "config.protocol_version",
    ),
    enrollment_token_id: requiredString(
      config.enrollment_token_id,
      "config.enrollment_token_id",
    ),
  };
}

function normalizeGatewayLifecycleState(
  value: unknown,
): GatewayInstanceLifecycleState {
  if (
    value === "Provisioned" ||
    value === "Initializing" ||
    value === "Running" ||
    value === "Failed"
  ) {
    return value;
  }
  throw new Error("Invalid API response: invalid lifecycle_state");
}

/** 按 QueryGatewayInitializationStatus 响应契约校验 Center 返回值。 */
export function normalizeGatewayInitializationStatus(
  payload: unknown,
): GatewayInitializationStatus {
  const status = requiredRecord(payload, "response");
  return {
    gateway_id: requiredString(status.gateway_id, "gateway_id"),
    instance_id: nullableString(status.instance_id, "instance_id"),
    lifecycle_state: normalizeGatewayLifecycleState(status.lifecycle_state),
    initialized: requiredBoolean(status.initialized, "initialized"),
  };
}

function requiredArray(value: unknown, fieldName: string): any[] {
  if (Array.isArray(value)) return value;
  throw new Error(`Invalid API response: missing ${fieldName}`);
}

function normalizeAgentStatus(
  value: unknown,
): AgentRuntimeStatusView["status"] {
  if (value === "online" || value === "offline") return value;
  throw new Error("Invalid API response: invalid agent status");
}

function normalizeAgentHealth(
  value: unknown,
): AgentRuntimeStatusView["health"] {
  if (value === "healthy" || value === "degraded" || value === "unhealthy")
    return value;
  throw new Error("Invalid API response: invalid agent health");
}

export function normalizeAgentInstallPackage(payload: any): AgentInstallPackage {
  const setting = payload.install_package ?? payload.installPackage ?? payload;
  return {
    addressId: requiredString(
      setting.address_id ?? setting.addressId,
      "agentInstallPackage.addressId",
    ),
    packageUrl: requiredString(
      setting.package_url ?? setting.packageUrl,
      "agentInstallPackage.packageUrl",
    ),
    packageSha256: nullableString(
      setting.package_sha256 ?? setting.packageSha256 ?? null,
      "agentInstallPackage.packageSha256",
    ),
    updatedBy: requiredString(
      setting.updated_by ?? setting.updatedBy,
      "agentInstallPackage.updatedBy",
    ),
    updatedAt: nullableString(
      setting.updated_at ?? setting.updatedAt ?? null,
      "agentInstallPackage.updatedAt",
    ),
  };
}

function normalizeInstallCode(payload: any): AgentInstallCode {
  const installCode = payload.install_code ?? payload.installCode ?? payload;
  return {
    x86LinuxInstallCode: requiredString(
      installCode.x86_linux_install_code ?? installCode.x86LinuxInstallCode,
      "installCode.x86LinuxInstallCode",
    ),
    armLinuxInstallCode: requiredString(
      installCode.arm_linux_install_code ?? installCode.armLinuxInstallCode,
      "installCode.armLinuxInstallCode",
    ),
    macosInstallCode: requiredString(
      installCode.macos_install_code ?? installCode.macosInstallCode,
      "installCode.macosInstallCode",
    ),
    bootstrapEnrollmentToken: requiredString(
      installCode.bootstrap_enrollment_token ??
        installCode.bootstrapEnrollmentToken,
      "installCode.bootstrapEnrollmentToken",
    ),
  };
}

function normalizeAgentListEntry(payload: any, index: number): AgentListEntryView {
  const at = `agents[${index}]`;
  return {
    agentId: requiredString(
      payload.agent_id ?? payload.agentId,
      `${at}.agentId`,
    ),
    instanceId: requiredString(
      payload.instance_id ?? payload.instanceId ?? "",
      `${at}.instanceId`,
    ),
    hostname: requiredString(payload.hostname ?? "", `${at}.hostname`),
    version: requiredString(payload.version ?? "", `${at}.version`),
    status: requiredString(payload.status ?? "", `${at}.status`),
    health: requiredString(payload.health ?? "", `${at}.health`),
  };
}

function normalizeAgentUplinkState(
  value: unknown,
): AgentUplinkStateView | null {
  // 缺失或 null 都是「还没上报过」：与 `local_work` 同口径，不当作形状错误。
  if (value === null || value === undefined) return null;
  const record = requiredRecord(value, "agent.uplinkState");
  return {
    enabled: requiredBoolean(record.enabled, "agent.uplinkState.enabled"),
    kind: requiredString(record.kind, "agent.uplinkState.kind"),
    target: nullableString(record.target ?? null, "agent.uplinkState.target"),
    source: requiredString(record.source, "agent.uplinkState.source"),
    outputWriteFailing: requiredBoolean(
      record.output_write_failing ?? record.outputWriteFailing,
      "agent.uplinkState.outputWriteFailing",
    ),
  };
}

function normalizeAgentCredentialRenewal(
  value: unknown,
): AgentCredentialRenewalView | null {
  if (value === null || value === undefined) return null;
  const record = requiredRecord(value, "agent.certificateStatus.lastRenewal");
  return {
    outcome: requiredString(
      record.outcome,
      "agent.certificateStatus.lastRenewal.outcome",
    ),
    checkedAt: requiredString(
      record.checked_at ?? record.checkedAt,
      "agent.certificateStatus.lastRenewal.checkedAt",
    ),
    detail: requiredString(
      record.detail ?? "",
      "agent.certificateStatus.lastRenewal.detail",
    ),
    notAfter: requiredString(
      record.not_after ?? record.notAfter ?? "",
      "agent.certificateStatus.lastRenewal.notAfter",
    ),
  };
}

function normalizeAgentCertificateStatus(
  value: unknown,
): AgentCertificateStatusView | null {
  // 缺失或 null 都是「还没上报过 / 没证书」：不当作形状错误。
  if (value === null || value === undefined) return null;
  const record = requiredRecord(value, "agent.certificateStatus");
  return {
    notAfter: requiredString(
      record.not_after ?? record.notAfter,
      "agent.certificateStatus.notAfter",
    ),
    remainingSeconds: requiredNumber(
      record.remaining_seconds ?? record.remainingSeconds,
      "agent.certificateStatus.remainingSeconds",
    ),
    state: requiredString(record.state, "agent.certificateStatus.state"),
    lastRenewal: normalizeAgentCredentialRenewal(
      record.last_renewal ?? record.lastRenewal,
    ),
  };
}

function normalizeAgentRevocation(payload: any): AgentRevocationView {
  const record = requiredRecord(payload, "agentRevocation");
  return {
    entryId: requiredString(record.entry_id ?? record.entryId, "revocation.entryId"),
    agentId: requiredString(record.agent_id ?? record.agentId, "revocation.agentId"),
    reasonCode: requiredString(
      record.reason_code ?? record.reasonCode ?? "",
      "revocation.reasonCode",
    ),
    deniedBy: requiredString(
      record.denied_by ?? record.deniedBy ?? "",
      "revocation.deniedBy",
    ),
    deniedAt: requiredString(
      record.denied_at ?? record.deniedAt,
      "revocation.deniedAt",
    ),
    retainUntil: requiredString(
      record.retain_until ?? record.retainUntil,
      "revocation.retainUntil",
    ),
  };
}

function normalizeRuntimeStatus(payload: any): AgentRuntimeStatusView {
  return {
    agentId: requiredString(
      payload.agent_id ?? payload.agentId,
      "agent.agentId",
    ),
    instanceId: requiredString(
      payload.instance_id ?? payload.instanceId,
      "agent.instanceId",
    ),
    version: requiredString(payload.version, "agent.version"),
    status: normalizeAgentStatus(payload.status),
    health: normalizeAgentHealth(payload.health),
    lastSeenAt: requiredString(
      payload.last_seen_at ?? payload.lastSeenAt,
      "agent.lastSeenAt",
    ),
    uplinkState: normalizeAgentUplinkState(
      payload.uplink_state ?? payload.uplinkState,
    ),
    certificateStatus: normalizeAgentCertificateStatus(
      payload.certificate_status ?? payload.certificateStatus,
    ),
    // 缺字段（旧网关）按「未吊销」：不把自己不知道的事说成「被吊销」。
    revoked: requiredBoolean(payload.revoked ?? false, "agent.revoked"),
  };
}

function normalizeRecentOnlineAgent(payload: any): RecentOnlineRegisteredAgent {
  const source = payload.source ?? "real";
  if (source !== "real" && source !== "example") {
    throw new Error("Invalid API response: invalid recent online agent source");
  }
  const rawHistory = payload.metrics_history ?? payload.metricsHistory ?? [];
  return {
    agentId: requiredString(
      payload.agent_id ?? payload.agentId,
      "recentOnlineAgent.agentId",
    ),
    instanceId: requiredString(
      payload.instance_id ?? payload.instanceId,
      "recentOnlineAgent.instanceId",
    ),
    version: requiredString(payload.version, "recentOnlineAgent.version"),
    registeredAt: requiredString(
      payload.registered_at ?? payload.registeredAt,
      "recentOnlineAgent.registeredAt",
    ),
    onlineSince: requiredString(
      payload.online_since ?? payload.onlineSince,
      "recentOnlineAgent.onlineSince",
    ),
    onlineDurationSeconds: requiredNumber(
      payload.online_duration_seconds ?? payload.onlineDurationSeconds,
      "recentOnlineAgent.onlineDurationSeconds",
    ),
    source,
    memoryBytes: payload.memory_bytes ?? payload.memoryBytes,
    cpuPercent: payload.cpu_percent ?? payload.cpuPercent,
    cpuPercentOfMachine:
      payload.cpu_percent_of_machine ?? payload.cpuPercentOfMachine,
    cpuCores: payload.cpu_cores ?? payload.cpuCores,
    adminLatencyMs: payload.admin_latency_ms ?? payload.adminLatencyMs,
    metricsHistory: rawHistory.map((sample: any) => ({
      at: sample.at,
      memoryBytes: sample.memory_bytes ?? sample.memoryBytes,
      cpuPercent: sample.cpu_percent ?? sample.cpuPercent,
      cpuPercentOfMachine:
        sample.cpu_percent_of_machine ?? sample.cpuPercentOfMachine,
      cpuCores: sample.cpu_cores ?? sample.cpuCores,
      adminLatencyMs: sample.admin_latency_ms ?? sample.adminLatencyMs,
    })),
  };
}

export function normalizeOverview(payload: any): AgentOverview {
  const metrics = payload.metrics;
  const recentOnlineAgents =
    payload.recent_online_agents ?? payload.recentOnlineAgents;
  const abnormalAgents = payload.abnormal_agents ?? payload.abnormalAgents;
  return {
    metrics: {
      totalAgents: requiredNumber(
        metrics?.total_agents ?? metrics?.totalAgents,
        "metrics.totalAgents",
      ),
      onlineAgents: requiredNumber(
        metrics?.online_agents ?? metrics?.onlineAgents,
        "metrics.onlineAgents",
      ),
      unhealthyAgents: requiredNumber(
        metrics?.unhealthy_agents ?? metrics?.unhealthyAgents,
        "metrics.unhealthyAgents",
      ),
      lastSeenLagSeconds: requiredNumber(
        metrics?.last_seen_lag_seconds ?? metrics?.lastSeenLagSeconds,
        "metrics.lastSeenLagSeconds",
      ),
    },
    recentOnlineAgents: requiredArray(
      recentOnlineAgents,
      "overview.recentOnlineAgents",
    ).map(normalizeRecentOnlineAgent),
    abnormalAgents: requiredArray(
      abnormalAgents,
      "overview.abnormalAgents",
    ).map(normalizeRuntimeStatus),
  };
}

function normalizeHostMetrics(payload: any): AgentHostMetrics {
  return {
    agentId: requiredString(payload.agent_id ?? payload.agentId, "host.agentId"),
    loadAverage1m: payload.load_average_1m ?? payload.loadAverage1m,
    loadAverage5m: payload.load_average_5m ?? payload.loadAverage5m,
    loadAverage15m: payload.load_average_15m ?? payload.loadAverage15m,
    uptimeSeconds: payload.uptime_seconds ?? payload.uptimeSeconds,
    memoryTotalKb: payload.memory_total_kb ?? payload.memoryTotalKb,
    memoryAvailableKb: payload.memory_available_kb ?? payload.memoryAvailableKb,
    diskUsagePercent: payload.disk_usage_percent ?? payload.diskUsagePercent,
    diskTotalKb: payload.disk_total_kb ?? payload.diskTotalKb,
    diskAvailableKb: payload.disk_available_kb ?? payload.diskAvailableKb,
    history: payload.history
      ? normalizeHostMetricsHistory(payload.history)
      : undefined,
  };
}

function normalizeHostMetricsHistory(payload: any): AgentHostMetricsHistory {
  return {
    loadAverage1m: normalizeSeries(payload.load_average_1m ?? payload.loadAverage1m),
    loadAverage5m: normalizeSeries(payload.load_average_5m ?? payload.loadAverage5m),
    loadAverage15m: normalizeSeries(payload.load_average_15m ?? payload.loadAverage15m),
    memoryTotalKb: normalizeSeries(payload.memory_total_kb ?? payload.memoryTotalKb),
    memoryAvailableKb: normalizeSeries(
      payload.memory_available_kb ?? payload.memoryAvailableKb,
    ),
    diskUsagePercent: normalizeSeries(
      payload.disk_usage_percent ?? payload.diskUsagePercent,
    ),
  };
}

function normalizeSeries(payload: any): [number, number][] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((point: any) => {
    if (!Array.isArray(point) || point.length < 2) return [];
    const timestamp = Number(point[0]);
    const value = Number(point[1]);
    if (!Number.isFinite(timestamp) || !Number.isFinite(value)) return [];
    return [[timestamp, value] as [number, number]];
  });
}

function normalizeHostMetricsSummaries(payload: any): AgentHostMetricsSummary[] {
  if (!Array.isArray(payload)) return [];
  return payload.map(normalizeHostMetricsSummary);
}

function normalizeHostMetricsSummary(payload: any): AgentHostMetricsSummary {
  return {
    agentId: requiredString(payload.agent_id ?? payload.agentId, "host.agentId"),
    loadAverage1m: payload.load_average_1m ?? payload.loadAverage1m,
    memoryTotalKb: payload.memory_total_kb ?? payload.memoryTotalKb,
    memoryAvailableKb: payload.memory_available_kb ?? payload.memoryAvailableKb,
    diskUsagePercent: payload.disk_usage_percent ?? payload.diskUsagePercent,
  };
}

export async function fetchAgentOverview(): Promise<AgentOverview> {
  const payload = await requestJson<unknown>("/api/v1/admin/agents/overview");
  return normalizeOverview(payload);
}

export async function fetchAgentHostMetrics(
  agentId: string,
): Promise<AgentHostMetrics> {
  const payload = await requestJson<unknown>(
    `/api/v1/admin/agents/${encodeURIComponent(agentId)}/host-metrics`,
  );
  return normalizeHostMetrics(payload);
}

export async function fetchAllAgentsHostMetrics(): Promise<
  AgentHostMetricsSummary[]
> {
  const payload = await requestJson<unknown>(
    "/api/v1/admin/agents/host-metrics",
  );
  return normalizeHostMetricsSummaries(payload);
}

/**
 * 单台 Agent 的运行态视图（`GET /api/v1/admin/agents/{agent_id}/runtime-status`）。
 *
 * 页面用它回答「这台为什么不上送」：`uplinkState` 是 agent **实际生效**的输出状态
 * （待命 / 已启用 / 出口失败），而不只是「网关下发了什么」。
 */
export async function fetchAgentRuntimeStatus(
  agentId: string,
): Promise<AgentRuntimeStatusView> {
  const payload = await requestJson<unknown>(
    `/api/v1/admin/agents/${encodeURIComponent(agentId)}/runtime-status`,
  );
  return normalizeRuntimeStatus(payload);
}

/**
 * 把一个 `agent_id` 加入**拒绝名单**（吊销，§5.6）。
 *
 * 与「吊销凭据」不同：那个吊销的是一份凭据（可换凭据 / 证书自续绕开），这个拒的是
 * **agent_id** 本身 —— 续签、重签同 id 仍被拒，也不管它是否还在续签。
 * 条目会在被吊销证书自然过期后被 GC（`retainUntil`）。
 */
export async function revokeAgent(
  agentId: string,
  reasonCode: string,
): Promise<AgentRevocationView> {
  const payload = await requestJson<unknown>(
    `/api/v1/admin/agents/${encodeURIComponent(agentId)}/revocation`,
    { method: "POST", body: JSON.stringify({ reason_code: reasonCode }) },
  );
  return normalizeAgentRevocation(payload);
}

/** 从拒绝名单移除（解除吊销）；不在名单里时返回 404。 */
export async function liftAgentRevocation(agentId: string): Promise<void> {
  await requestJson<unknown>(
    `/api/v1/admin/agents/${encodeURIComponent(agentId)}/revocation`,
    { method: "DELETE" },
  );
}

/** 列出拒绝名单（管理面）。 */
export async function fetchAgentRevocations(): Promise<AgentRevocationView[]> {
  const payload = await requestJson<unknown>("/api/v1/admin/agent-revocations");
  const record = requiredRecord(payload, "agentRevocations");
  const items = record.revocations;
  if (!Array.isArray(items)) {
    throw new Error("Invalid API response: agentRevocations.revocations");
  }
  return items.map((item) => normalizeAgentRevocation(item));
}

/**
 * **已注册**的 Agent 清单（`GET /api/v1/admin/agents`）。
 *
 * 机队索引页（升级 / 采集工作）用它，而不是拿「有主机指标的 Agent」当机队：待命或新装的
 * Agent 不上送指标，用指标列表会让它们彻底从页面上消失（也就无法被升级 / 派活）。
 *
 * `limit` 封顶 500（网关侧 `MAX_AGENT_PAGE_LIMIT`）；超出得翻页 —— 当前页面只需要 id。
 */
export async function fetchRegisteredAgents(
  limit = 500,
): Promise<AgentListEntryView[]> {
  const payload = await requestJson<unknown>(
    `/api/v1/admin/agents?limit=${limit}`,
  );
  const root = requiredRecord(payload, "agents");
  return requiredArray(root.agents, "agents.agents").map(
    normalizeAgentListEntry,
  );
}

/** 删除一台离线 Agent 的结果（`DELETE /api/v1/admin/agents/{id}`）。 */
export interface AgentDeletionResult {
  agentId: string;
  deletedAt: string;
}

/**
 * 删除一台**离线** Agent —— **不可恢复**（连同实例、凭据与所有派生态数据）。
 *
 * 后端只允许离线：在线 → 409（判据与列表/运行态同一处）。调用方必须先把「不可恢复」讲清楚，
 * 并在拿到 409 时把原因如实转达，而不是报一句通用的“删除失败”。
 */
export async function deleteAgent(
  agentId: string,
): Promise<AgentDeletionResult> {
  const payload = await requestJson<unknown>(
    `/api/v1/admin/agents/${encodeURIComponent(agentId)}`,
    { method: "DELETE" },
  );
  const record = requiredRecord(payload, "agentDeletion");
  return {
    agentId: requiredString(
      record.agent_id ?? record.agentId,
      "agentDeletion.agentId",
    ),
    deletedAt: requiredString(
      record.deleted_at ?? record.deletedAt,
      "agentDeletion.deletedAt",
    ),
  };
}

/** 网关**已录入**的一个安装包（`GET /api/v1/admin/agent/install-packages` 的一项）。 */
export interface InstallPackageView {
  /** 网关在包目录里分配的 id，`agentPackageUrl` 也由它派生。 */
  packageId: string;
  /** 录入时给网关的取包来源：本机绝对路径或 https 链接（人读用）。 */
  source: string;
  /** 制品摘要，形如 `sha256:<64 hex>`。 */
  packageSha256: string;
  /** 包内 agentd 自报的版本。 */
  version: string;
  /** 目标架构（如 `aarch64-apple-darwin`）。 */
  arch: string;
  /** 网关**派生好**的、可直接给 agent 下载的地址（前端不要自己拼）。 */
  agentPackageUrl: string;
  createdBy: string;
  createdAt: string;
}

function normalizeInstallPackage(
  payload: unknown,
  index: number,
): InstallPackageView {
  const at = `packages[${index}]`;
  const record = requiredRecord(payload, at);
  return {
    packageId: requiredString(
      record.package_id ?? record.packageId,
      `${at}.packageId`,
    ),
    source: requiredString(record.source, `${at}.source`),
    packageSha256: requiredString(
      record.package_sha256 ?? record.packageSha256,
      `${at}.packageSha256`,
    ),
    version: requiredString(record.version, `${at}.version`),
    arch: requiredString(record.arch, `${at}.arch`),
    agentPackageUrl: requiredString(
      record.agent_package_url ?? record.agentPackageUrl,
      `${at}.agentPackageUrl`,
    ),
    createdBy: requiredString(
      record.created_by ?? record.createdBy,
      `${at}.createdBy`,
    ),
    createdAt: requiredString(
      record.created_at ?? record.createdAt,
      `${at}.createdAt`,
    ),
  };
}

/**
 * 网关**已录入**的安装包历史（`GET /api/v1/admin/agent/install-packages`）。
 *
 * 升级页从这里选包，而不是让操作者手输地址 + 摘要：来源在「安装包」页录入时由网关
 * 存进自己的包目录，`agent_package_url` 是网关派生好的下载地址。缺 `packages` 数组或某项缺
 * 必填字段都**显式抛错**，不静默成空列表 —— 那会让页面说“一个包都没录入”，比报错更难查。
 */
export async function fetchInstallPackages(): Promise<InstallPackageView[]> {
  const payload = await requestJson<unknown>(
    "/api/v1/admin/agent/install-packages",
  );
  const root = requiredRecord(payload, "packages");
  return requiredArray(root.packages, "packages.packages").map(
    normalizeInstallPackage,
  );
}

export function normalizeAgentUplink(payload: any): AgentUplink {
  const setting = payload.uplink ?? payload;
  return {
    settingId: requiredString(
      setting.setting_id ?? setting.settingId,
      "agentUplink.settingId",
    ),
    host: requiredString(setting.host, "agentUplink.host"),
    port: requiredNumber(setting.port, "agentUplink.port"),
    enabled: requiredBoolean(setting.enabled, "agentUplink.enabled"),
    enabledConfigured: requiredBoolean(
      setting.enabled_configured ?? setting.enabledConfigured,
      "agentUplink.enabledConfigured",
    ),
    updatedBy: requiredString(
      setting.updated_by ?? setting.updatedBy,
      "agentUplink.updatedBy",
    ),
    updatedAt: nullableString(
      setting.updated_at ?? setting.updatedAt ?? null,
      "agentUplink.updatedAt",
    ),
  };
}

export function normalizeAgentAdvertiseUrl(payload: any): AgentAdvertiseUrl {
  const setting = payload.advertise_url ?? payload.advertiseUrl ?? payload;
  return {
    settingId: requiredString(
      setting.setting_id ?? setting.settingId,
      "agentAdvertiseUrl.settingId",
    ),
    // 未设置过时后端回空串（不是缺字段）：空串 = 没设置，与「设置成空」同义，
    // 真正的回落值在 fallbackUrl 里。
    url: requiredString(setting.url, "agentAdvertiseUrl.url"),
    fallbackUrl: requiredString(
      setting.fallback_url ?? setting.fallbackUrl,
      "agentAdvertiseUrl.fallbackUrl",
    ),
    updatedBy: requiredString(
      setting.updated_by ?? setting.updatedBy,
      "agentAdvertiseUrl.updatedBy",
    ),
    updatedAt: nullableString(
      setting.updated_at ?? setting.updatedAt ?? null,
      "agentAdvertiseUrl.updatedAt",
    ),
  };
}

export async function fetchAgentInstallCode(): Promise<AgentInstallCode> {
  const payload = await requestJson<unknown>("/api/v1/agent/install-code");
  return normalizeInstallCode(payload);
}

export async function fetchAgentInstallPackage(): Promise<AgentInstallPackage> {
  const payload = await requestJson<unknown>(
    "/api/v1/admin/agent/install-package",
  );
  return normalizeAgentInstallPackage(payload);
}

/**
 * 设置网关分发的 Agent 安装包地址（管理面）。
 *
 * 地址必须是 https:// 链接或主机上的绝对路径（网关拒绝明文 http），
 * 摘要为可选，填写时必须是 64 位十六进制（可带 `sha256:` 前缀）。
 * 设置只影响之后新签发的安装代码与 install.sh，不影响已分发的安装命令。
 */
export async function setAgentInstallPackage(
  command: SetAgentInstallPackageCommand,
): Promise<AgentInstallPackage> {
  const payload = await requestJson<unknown>(
    "/api/v1/admin/agent/install-package",
    {
      method: "POST",
      body: JSON.stringify({
        package_url: command.packageUrl,
        package_sha256: command.packageSha256,
        requested_by: command.requestedBy,
      }),
    },
  );
  return normalizeAgentInstallPackage(payload);
}

export async function fetchAgentUplink(): Promise<AgentUplink> {
  const payload = await requestJson<unknown>("/api/v1/admin/agent/uplink");
  return normalizeAgentUplink(payload);
}

/**
 * 设置 Agent 的数据面上送目标与启用开关（管理面）。
 *
 * 主机不能为空，端口必须是 1–65535 的整数；不符合要求时后端返回 400 纯文本。
 *
 * 它是**运行期**值：网关在 `uplink:poll` 上现算上送授权，所以保存后对**已在网**的 Agent
 * 下一个 poll（≤30s）就生效，不需要重装、也不需要重跑安装脚本。只有网关签发的初始配置
 * 始终是待命（安装脚本是死数据，开关必须是运行期的）。
 */
export async function setAgentUplink(
  command: SetAgentUplinkCommand,
): Promise<AgentUplink> {
  const payload = await requestJson<unknown>("/api/v1/admin/agent/uplink", {
    method: "POST",
    body: JSON.stringify({
      host: command.host,
      port: command.port,
      enabled: command.enabled,
      requested_by: command.requestedBy,
    }),
  });
  return normalizeAgentUplink(payload);
}

export async function fetchAgentAdvertiseUrl(): Promise<AgentAdvertiseUrl> {
  const payload = await requestJson<unknown>(
    "/api/v1/admin/agent/advertise-url",
  );
  return normalizeAgentAdvertiseUrl(payload);
}

/**
 * 设置网关对外地址（管理面）。
 *
 * 必须是 https 基址 —— 它会被拼进安装命令与 install.sh 的 URL，并写成 Agent 的
 * 控制面 endpoint；后端拒绝明文 http、非 URL 以及含 shell 元字符的写法（400 纯文本）。
 * 尾斜杠由后端裁掉。设置只影响之后签发的安装代码与新装 Agent：已安装的 agent
 * 要重跑安装脚本才会拿到新值（初始配置只在安装时拉一次）。
 */
export async function setAgentAdvertiseUrl(
  command: SetAgentAdvertiseUrlCommand,
): Promise<AgentAdvertiseUrl> {
  const payload = await requestJson<unknown>(
    "/api/v1/admin/agent/advertise-url",
    {
      method: "POST",
      body: JSON.stringify({
        url: command.url,
        requested_by: command.requestedBy,
      }),
    },
  );
  return normalizeAgentAdvertiseUrl(payload);
}

/**
 * 从 Gateway 页面调用控制中心的网关面初始化接口。
 * initUrl 由 Center 创建实例时下发，**不携带凭证**（token 不进 URL）；
 * 网关凭证由操作者单独输入，只放入 Authorization Header。
 * 返回 Center 当前实现的 `application/json` 响应中的 `config` 对象。
 */
export async function fetchGatewayInitialConfig(
  initUrl: string,
  token?: string,
): Promise<GatewayInitialConfig> {
  // 去掉可能残留的 fragment（如手工复制带 # 的链接）。
  const path = initUrl.split("#", 1)[0];
  const response = await fetch(path, {
    headers: {
      accept: "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    throw new ApiError(response.status, path);
  }
  return normalizeGatewayInitialConfig(await response.json());
}

/** 初始化 URL 校验后得到的请求目标，供页面 Service 串联状态查询与配置请求。 */
export interface GatewayInitializationTarget {
  initUrl: string;
  instanceId: string;
  statusUrl: string;
}

/**
 * 校验 Center 交付的初始化 URL，并派生同一 Center 上的初始化状态查询地址。
 * URL 只允许 instance_id 查询参数；Bearer 凭证必须由调用方另行放入 Header。
 */
export function parseGatewayInitializationUrl(
  input: string,
): GatewayInitializationTarget {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new GatewayInitializationInputError(
      "请输入完整、有效的控制中心初始化 URL。",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new GatewayInitializationInputError(
      "初始化 URL 只支持 HTTP 或 HTTPS 协议。",
    );
  }
  if (url.username || url.password || url.hash) {
    throw new GatewayInitializationInputError(
      "初始化 URL 不能携带用户信息、凭证或 fragment。",
    );
  }
  if (!url.pathname.endsWith("/api/v1/gateway/initial-config")) {
    throw new GatewayInitializationInputError(
      "初始化 URL 必须指向 /api/v1/gateway/initial-config。",
    );
  }
  const queryNames = [...url.searchParams.keys()];
  if (queryNames.length !== 1 || queryNames[0] !== "instance_id") {
    throw new GatewayInitializationInputError(
      "初始化 URL 只能包含 instance_id；Bearer 凭证请填写到独立凭证输入框。",
    );
  }
  const instanceId = url.searchParams.get("instance_id")?.trim();
  if (!instanceId) {
    throw new GatewayInitializationInputError("初始化 URL 缺少 instance_id。");
  }

  const statusUrl = new URL(url);
  statusUrl.pathname = statusUrl.pathname.replace(
    /\/initial-config$/,
    "/initialization-status",
  );
  statusUrl.search = "";
  statusUrl.searchParams.set("instance_id", instanceId);
  return {
    initUrl: url.toString(),
    instanceId,
    statusUrl: statusUrl.toString(),
  };
}

/** 查询 Center 侧实例状态；可选 Bearer 仍只通过 Authorization Header 发送。 */
export async function fetchGatewayInitializationStatus(
  statusUrl: string,
  token?: string,
): Promise<GatewayInitializationStatus> {
  const response = await fetch(statusUrl, {
    headers: {
      accept: "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    throw new ApiError(response.status, statusUrl);
  }
  return normalizeGatewayInitializationStatus(await response.json());
}

/**
 * 页面初始化业务 Service：解析 URL → 查询状态 → 拦截重复初始化 → 获取 JSON 配置。
 * 状态检查不替代 Center 的服务端守卫，只用于在消费一次性凭证前提供明确反馈。
 */
export async function initializeGatewayViaUrl(
  initUrl: string,
  token?: string,
): Promise<GatewayInitializationResult> {
  const target = parseGatewayInitializationUrl(initUrl);
  const status = await fetchGatewayInitializationStatus(
    target.statusUrl,
    token,
  );
  if (status.initialized) {
    throw new GatewayAlreadyInitializedError(status);
  }
  const config = await fetchGatewayInitialConfig(target.initUrl, token);
  return { config, status };
}

/* ------------------------------------------------------------------ *
 * 数据采集吞吐视图（/api/v1/admin/pipeline/topology）
 *
 * 口径提醒：后端返回的是 wparse 三层计数器的 1 分钟粒度速率，
 * 不是逐秒实时值（数据面写入 VictoriaMetrics 的粒度实测为 60 秒）。
 * ------------------------------------------------------------------ */

/** 采集单层里的一个节点（来源 / 解析规则 / 单个输出口）。 */
export interface PipelineNode {
  id: string;
  label: string;
  /** 当前速率（e/s） */
  rate: number;
  /** 进程启动至今累计 */
  total: number;
  /** `[unix 毫秒, e/s]` */
  series: [number, number][];
  /** `[unix 毫秒, 累计量]`，供「数量」视图切换 */
  totalSeries: [number, number][];
  /** `loss` 表示未落存储的出口（miss / residue / error） */
  kind?: string;
}

/** 解析层 / 输出层的分组（父级速率取自组输入，不等同于子项求和）。 */
export interface PipelineGroup {
  id: string;
  label: string;
  rate: number;
  total: number;
  series: [number, number][];
  totalSeries: [number, number][];
  children: PipelineNode[];
  kind?: string;
}

export interface PipelineSummary {
  ingressRate: number;
  parseRate: number;
  egressRate: number;
  lossRate: number;
  totalReceived: number;
  /** 入流合计曲线（各来源求和），供「接入与输出」节的汇总图 */
  ingressSeries: [number, number][];
  /** 落存储合计曲线（非 loss 输出口求和） */
  egressSeries: [number, number][];
  /** 解析合计曲线 */
  parseSeries: [number, number][];
}

export interface PipelineTopology {
  generatedAt: number;
  /** 所有序列里最新采样点（unix 秒）；窗口内无任何数据时为 undefined */
  latestSampleAt?: number;
  windowSeconds: number;
  stepSeconds: number;
  summary: PipelineSummary;
  sources: PipelineNode[];
  parses: PipelineGroup[];
  sinks: PipelineGroup[];
}

function normalizeSeriesPoints(payload: unknown): [number, number][] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((point) => {
    if (!Array.isArray(point) || point.length < 2) return [];
    const timestamp = Number(point[0]);
    const value = Number(point[1]);
    if (!Number.isFinite(timestamp) || !Number.isFinite(value)) return [];
    return [[timestamp, value] as [number, number]];
  });
}

function normalizePipelineNode(payload: any): PipelineNode {
  return {
    id: String(payload?.id ?? ""),
    label: String(payload?.label ?? payload?.id ?? ""),
    rate: Number(payload?.rate ?? 0),
    total: Number(payload?.total ?? 0),
    series: normalizeSeriesPoints(payload?.series),
    totalSeries: normalizeSeriesPoints(payload?.totalSeries),
    ...(payload?.kind ? { kind: String(payload.kind) } : {}),
  };
}

function normalizePipelineGroup(payload: any): PipelineGroup {
  const children = Array.isArray(payload?.children)
    ? payload.children.map(normalizePipelineNode)
    : [];
  return {
    id: String(payload?.id ?? ""),
    label: String(payload?.label ?? payload?.id ?? ""),
    rate: Number(payload?.rate ?? 0),
    total: Number(payload?.total ?? 0),
    series: normalizeSeriesPoints(payload?.series),
    totalSeries: normalizeSeriesPoints(payload?.totalSeries),
    children,
    ...(payload?.kind ? { kind: String(payload.kind) } : {}),
  };
}

function normalizePipelineTopology(payload: any): PipelineTopology {
  const summary = payload?.summary ?? {};
  const latestSampleAt = Number(payload?.latestSampleAt);
  return {
    generatedAt: Number(payload?.generatedAt ?? 0),
    ...(Number.isFinite(latestSampleAt) ? { latestSampleAt } : {}),
    windowSeconds: Number(payload?.windowSeconds ?? 0),
    stepSeconds: Number(payload?.stepSeconds ?? 60),
    summary: {
      ingressRate: Number(summary.ingressRate ?? 0),
      parseRate: Number(summary.parseRate ?? 0),
      egressRate: Number(summary.egressRate ?? 0),
      lossRate: Number(summary.lossRate ?? 0),
      totalReceived: Number(summary.totalReceived ?? 0),
      ingressSeries: normalizeSeriesPoints(summary.ingressSeries),
      egressSeries: normalizeSeriesPoints(summary.egressSeries),
      parseSeries: normalizeSeriesPoints(summary.parseSeries),
    },
    sources: Array.isArray(payload?.sources)
      ? payload.sources.map(normalizePipelineNode)
      : [],
    parses: Array.isArray(payload?.parses)
      ? payload.parses.map(normalizePipelineGroup)
      : [],
    sinks: Array.isArray(payload?.sinks)
      ? payload.sinks.map(normalizePipelineGroup)
      : [],
  };
}

export async function fetchPipelineTopology(
  windowSeconds = 1800,
): Promise<PipelineTopology> {
  const payload = await requestJson<unknown>(
    `/api/v1/admin/pipeline/topology?window=${windowSeconds}`,
  );
  return normalizePipelineTopology(payload);
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent 用途（管理面）：事实 / 推断 / 判定三分并列
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 取一个「键必须存在」的字段。
 *
 * `?? null` 对 `undefined` 也返回 `null`，会把**键缺失/被改名**这个契约漂移
 * 静默成一个合法的空值 —— 而本页最忌讳的就是把「未知」与「空」混成一回事
 * （这与 `install-package-contract.test.ts` 的 `in` 断言同一口径）。
 */
function presentField(
  record: Record<string, unknown>,
  keys: string[],
  fieldName: string,
): unknown {
  const key = keys.find((candidate) =>
    Object.prototype.hasOwnProperty.call(record, candidate),
  );
  if (key === undefined) {
    throw new Error(`Invalid API response: missing ${fieldName}`);
  }
  return record[key];
}

/** 键必须存在、值可为 `null` 的对象字段（`null` 与「缺失」不同）。 */
function nullableRecordField(
  record: Record<string, unknown>,
  keys: string[],
  fieldName: string,
): Record<string, unknown> | null {
  const value = presentField(record, keys, fieldName);
  if (value === null) return null;
  return requiredRecord(value, fieldName);
}

/** 键必须存在、值可为 `null` 的字符串字段（`null` 与「缺失」不同）。 */
function nullableStringField(
  record: Record<string, unknown>,
  keys: string[],
  fieldName: string,
): string | null {
  const value = presentField(record, keys, fieldName);
  if (value === null) return null;
  return requiredString(value, fieldName);
}

/** 键必须存在、值可为 `null` 的数值字段（`null` 与「缺失」不同）。 */
function nullableNumberField(
  record: Record<string, unknown>,
  keys: string[],
  fieldName: string,
): number | null {
  const value = presentField(record, keys, fieldName);
  if (value === null) return null;
  return requiredNumber(value, fieldName);
}

/**
 * 键**可以不存在**的字符串字段：缺失 / `null` 都返回 `null`。
 *
 * 用于契约里**可省**的字段（如升级 spec 的 `target_version`）—— 那种字段用
 * `presentField` 会把「没写」误判成契约漂移。
 */
function optionalStringField(
  record: Record<string, unknown>,
  keys: string[],
  fieldName: string,
): string | null {
  const key = keys.find((candidate) =>
    Object.prototype.hasOwnProperty.call(record, candidate),
  );
  if (key === undefined) return null;
  const value = record[key];
  if (value === null || value === undefined) return null;
  return requiredString(value, fieldName);
}

function requiredStringArray(value: unknown, fieldName: string): string[] {
  return requiredArray(value, fieldName).map((item, index) =>
    requiredString(item, `${fieldName}[${index}]`),
  );
}

/**
 * 键**可以不存在**的布尔字段：缺失 / `null` 都返回 `false`。
 *
 * 用于契约里**可省**且缺省即关的字段（如升级 spec 的 `allow_downgrade`）。写成开关语义 ——
 * 没写就是默认的「不开启」，与 `optionalStringField` 把缺省读成 `null` 是同一套口径。
 */
function optionalBooleanField(
  record: Record<string, unknown>,
  keys: string[],
  fieldName: string,
): boolean {
  const key = keys.find((candidate) =>
    Object.prototype.hasOwnProperty.call(record, candidate),
  );
  if (key === undefined) return false;
  const value = record[key];
  if (value === null || value === undefined) return false;
  return requiredBoolean(value, fieldName);
}

/**
 * 机器类别是**闭合**取值（模型里的 variant）：认不出来就抛错，
 * 不静默渲染成一个没见过的类别名。
 */
function requiredMachineClass(value: unknown, fieldName: string): MachineClass {
  if (
    value === "MacDaily" ||
    value === "MacDev" ||
    value === "LinuxHost" ||
    value === "LinuxCompute" ||
    value === "LinuxData"
  ) {
    return value;
  }
  throw new Error(`Invalid API response: invalid ${fieldName}`);
}

function normalizeAgentFactSummary(payload: any): AgentFactSummary {
  return {
    agentId: requiredString(
      payload.agent_id ?? payload.agentId,
      "agentFactSummary.agentId",
    ),
    contentDigest: requiredString(
      payload.content_digest ?? payload.contentDigest,
      "agentFactSummary.contentDigest",
    ),
    revision: requiredNumber(payload.revision, "agentFactSummary.revision"),
    observedAt: requiredString(
      payload.observed_at ?? payload.observedAt,
      "agentFactSummary.observedAt",
    ),
    os: requiredString(payload.os, "agentFactSummary.os"),
    arch: requiredString(payload.arch, "agentFactSummary.arch"),
    processCount: requiredNumber(
      payload.process_count ?? payload.processCount,
      "agentFactSummary.processCount",
    ),
    // 空列表与「该字段缺失」是两回事：数组本身必须存在。
    processExecutables: requiredStringArray(
      payload.process_executables ?? payload.processExecutables,
      "agentFactSummary.processExecutables",
    ),
    packages: requiredStringArray(
      payload.packages,
      "agentFactSummary.packages",
    ),
    listenPorts: requiredStringArray(
      payload.listen_ports ?? payload.listenPorts,
      "agentFactSummary.listenPorts",
    ),
    // 展示字段：旧 agentd 不带它们，但网关侧是 NOT NULL DEFAULT，
    // 所以「没上报」以空串 / 空数组到达这里，而不是缺键。
    hostId: requiredString(
      payload.host_id ?? payload.hostId,
      "agentFactSummary.hostId",
    ),
    hostName: requiredString(
      payload.host_name ?? payload.hostName,
      "agentFactSummary.hostName",
    ),
    networkAddresses: requiredStringArray(
      payload.network_addresses ?? payload.networkAddresses,
      "agentFactSummary.networkAddresses",
    ),
    receivedAt: requiredString(
      payload.received_at ?? payload.receivedAt,
      "agentFactSummary.receivedAt",
    ),
  };
}

function normalizePurposeSignal(payload: any): PurposeSignal {
  return {
    ruleId: requiredString(payload.rule_id ?? payload.ruleId, "purposeSignal.ruleId"),
    // kind 在模型里是开放字符串（process / process_path / ...），不校验枚举。
    kind: requiredString(payload.kind, "purposeSignal.kind"),
    value: requiredString(payload.value, "purposeSignal.value"),
    weight: requiredNumber(payload.weight, "purposeSignal.weight"),
  };
}

function normalizePurposeSuggestion(payload: any): PurposeSuggestion {
  return {
    suggestionId: requiredString(
      payload.suggestion_id ?? payload.suggestionId,
      "purposeSuggestion.suggestionId",
    ),
    agentId: requiredString(
      payload.agent_id ?? payload.agentId,
      "purposeSuggestion.agentId",
    ),
    suggestedClass: requiredMachineClass(
      payload.suggested_class ?? payload.suggestedClass,
      "purposeSuggestion.suggestedClass",
    ),
    confidence: requiredNumber(payload.confidence, "purposeSuggestion.confidence"),
    // method 也是开放字符串（rule | model），同样不校验枚举。
    method: requiredString(payload.method, "purposeSuggestion.method"),
    ruleSetId: nullableStringField(
      payload,
      ["rule_set_id", "ruleSetId"],
      "purposeSuggestion.ruleSetId",
    ),
    signals: requiredArray(payload.signals, "purposeSuggestion.signals").map(
      normalizePurposeSignal,
    ),
    observedAt: requiredString(
      payload.observed_at ?? payload.observedAt,
      "purposeSuggestion.observedAt",
    ),
    computedAt: requiredString(
      payload.computed_at ?? payload.computedAt,
      "purposeSuggestion.computedAt",
    ),
  };
}

function normalizeAgentClassification(payload: any): AgentClassification {
  return {
    agentId: requiredString(
      payload.agent_id ?? payload.agentId,
      "agentClassification.agentId",
    ),
    machineClass: requiredMachineClass(
      payload.machine_class ?? payload.machineClass,
      "agentClassification.machineClass",
    ),
    // 采纳了哪次建议；人工直接判定/推翻建议时为空（不是 undefined）。
    suggestionId: nullableStringField(
      payload,
      ["suggestion_id", "suggestionId"],
      "agentClassification.suggestionId",
    ),
    decidedBy: requiredString(
      payload.decided_by ?? payload.decidedBy,
      "agentClassification.decidedBy",
    ),
    decidedAt: requiredString(
      payload.decided_at ?? payload.decidedAt,
      "agentClassification.decidedAt",
    ),
    note: nullableStringField(payload, ["note"], "agentClassification.note"),
  };
}

/**
 * 规范化 `AgentPurposeView`：`fact_summary` / `suggestion` / `classification`
 * 都可能为 `null`，且 **null 与缺失不同**（缺失说明契约漂移，要抛错）。
 */
export function normalizeAgentPurposeView(payload: any): AgentPurposeView {
  // 后端 admin_ops.rs 直接返回**扁平**载荷（不额外包一层 `{purpose: ...}`）。
  const root = requiredRecord(payload, "agentPurpose");
  const factSummary = nullableRecordField(
    root,
    ["fact_summary", "factSummary"],
    "agentPurpose.factSummary",
  );
  const suggestion = nullableRecordField(
    root,
    ["suggestion"],
    "agentPurpose.suggestion",
  );
  const classification = nullableRecordField(
    root,
    ["classification"],
    "agentPurpose.classification",
  );
  return {
    agentId: requiredString(root.agent_id ?? root.agentId, "agentPurpose.agentId"),
    factSummary: factSummary ? normalizeAgentFactSummary(factSummary) : null,
    suggestion: suggestion ? normalizePurposeSuggestion(suggestion) : null,
    // 管理面还没实现判定的写入端点，服务端恒为 null；真出现时按模型如实解析。
    classification: classification
      ? normalizeAgentClassification(classification)
      : null,
    generatedAt: requiredString(
      root.generated_at ?? root.generatedAt,
      "agentPurpose.generatedAt",
    ),
  };
}

/**
 * 查看某台 Agent 的用途（对应模型 `AdminViewAgentPurpose`）。
 *
 * 未知 agent 由后端回 404（不是空视图）：调用方要用 `ApiError.status === 404`
 * 区分「这台机器不存在」与「它还没报过事实」。
 */
export async function fetchAgentPurpose(
  agentId: string,
): Promise<AgentPurposeView> {
  const payload = await requestJson<unknown>(
    `/api/v1/admin/agents/${encodeURIComponent(agentId)}/purpose`,
  );
  return normalizeAgentPurposeView(payload);
}

// ─────────────────────────────────────────────────────────────────────────────
// L1a 机械资产清单（管理面）：从事实摘要机械归并出的「这台机器上有什么」
// ─────────────────────────────────────────────────────────────────────────────

/** 键必须存在的字符串字段（`presentField` + `requiredString` 的合体，省去层层转写）。 */
function presentStringField(
  record: Record<string, unknown>,
  keys: string[],
  fieldName: string,
): string {
  return requiredString(presentField(record, keys, fieldName), fieldName);
}

function presentNumberField(
  record: Record<string, unknown>,
  keys: string[],
  fieldName: string,
): number {
  return requiredNumber(presentField(record, keys, fieldName), fieldName);
}

function presentBooleanField(
  record: Record<string, unknown>,
  keys: string[],
  fieldName: string,
): boolean {
  return requiredBoolean(presentField(record, keys, fieldName), fieldName);
}

/**
 * 条目类别是**闭合**取值（模型里的 variant）：认不出来就抛错，
 * 不把没见过的类别名当成第三类静默渲染（与 `requiredMachineClass` 同一口径）。
 */
function requiredSoftwareKind(value: unknown, fieldName: string): SoftwareKind {
  if (value === "app" || value === "binary") return value;
  throw new Error(`Invalid API response: invalid ${fieldName}`);
}

function normalizeSoftwareEntry(
  value: unknown,
  fieldName: string,
): AgentSoftwareEntry {
  const entry = requiredRecord(value, fieldName);
  return {
    softwareKey: presentStringField(
      entry,
      ["software_key", "softwareKey"],
      `${fieldName}.softwareKey`,
    ),
    name: presentStringField(entry, ["name"], `${fieldName}.name`),
    kind: requiredSoftwareKind(
      presentField(entry, ["kind"], `${fieldName}.kind`),
      `${fieldName}.kind`,
    ),
    matchedRule: presentStringField(
      entry,
      ["matched_rule", "matchedRule"],
      `${fieldName}.matchedRule`,
    ),
    path: presentStringField(entry, ["path"], `${fieldName}.path`),
  };
}

function normalizeSoftwareHolder(
  value: unknown,
  fieldName: string,
): SoftwareHolder {
  const holder = requiredRecord(value, fieldName);
  return {
    agentId: presentStringField(
      holder,
      ["agent_id", "agentId"],
      `${fieldName}.agentId`,
    ),
    path: presentStringField(holder, ["path"], `${fieldName}.path`),
  };
}

function normalizeSoftwareKeySummary(
  value: unknown,
  fieldName: string,
): SoftwareKeySummary {
  const summary = requiredRecord(value, fieldName);
  return {
    softwareKey: presentStringField(
      summary,
      ["software_key", "softwareKey"],
      `${fieldName}.softwareKey`,
    ),
    name: presentStringField(summary, ["name"], `${fieldName}.name`),
    kind: requiredSoftwareKind(
      presentField(summary, ["kind"], `${fieldName}.kind`),
      `${fieldName}.kind`,
    ),
    // 机器数由后端对 holders 的 agent_id 去重算出；前端不复算，避免两处真相。
    agentCount: presentNumberField(
      summary,
      ["agent_count", "agentCount"],
      `${fieldName}.agentCount`,
    ),
    holders: requiredArray(
      presentField(summary, ["holders"], `${fieldName}.holders`),
      `${fieldName}.holders`,
    ).map((holder, index) =>
      normalizeSoftwareHolder(holder, `${fieldName}.holders[${index}]`),
    ),
  };
}

/**
 * 规范化「按机器看软件」的清单。
 *
 * `paths` / `apps` 是**行数**，由后端算好：前端**原样透出**，不按 `entries` 重算
 * —— 重算会掩盖两侧口径漂移，而这两列的语义（行数 ≠ 软件个数）本页要显式讲清楚。
 */
export function normalizeAgentSoftwareInventory(
  payload: unknown,
): AgentSoftwareInventory {
  const root = requiredRecord(payload, "agentSoftwareInventory");
  return {
    agentId: presentStringField(
      root,
      ["agent_id", "agentId"],
      "agentSoftwareInventory.agentId",
    ),
    paths: presentNumberField(root, ["paths"], "agentSoftwareInventory.paths"),
    apps: presentNumberField(root, ["apps"], "agentSoftwareInventory.apps"),
    // 空清单（存在但没上报过）与「字段缺失」是两回事：数组本身必须存在。
    entries: requiredArray(
      presentField(root, ["entries"], "agentSoftwareInventory.entries"),
      "agentSoftwareInventory.entries",
    ).map((entry, index) =>
      normalizeSoftwareEntry(
        entry,
        `agentSoftwareInventory.entries[${index}]`,
      ),
    ),
  };
}

/** 规范化「按软件看机器」的机队清单（含 `truncated`，不能静默丢掉）。 */
export function normalizeSoftwareFleetInventory(
  payload: unknown,
): SoftwareFleetInventory {
  const root = requiredRecord(payload, "softwareFleetInventory");
  return {
    truncated: presentBooleanField(
      root,
      ["truncated"],
      "softwareFleetInventory.truncated",
    ),
    software: requiredArray(
      presentField(root, ["software"], "softwareFleetInventory.software"),
      "softwareFleetInventory.software",
    ).map((summary, index) =>
      normalizeSoftwareKeySummary(
        summary,
        `softwareFleetInventory.software[${index}]`,
      ),
    ),
  };
}

/**
 * 某台机器的 L1a 机械资产清单（对应模型 `ViewAgentSoftware`）。
 *
 * 未知 agent 由后端回 404（正文 `unknown agent {id}`）：调用方要用
 * `ApiError.status === 404` 区分「这台机器不存在」与「它存在、但还没上报过清单」
 * —— 后者是 200 + `paths: 0` + `entries: []`。
 */
export async function fetchAgentSoftwareInventory(
  agentId: string,
): Promise<AgentSoftwareInventory> {
  const payload = await requestJson<unknown>(
    `/api/v1/admin/agents/${encodeURIComponent(agentId)}/software`,
  );
  return normalizeAgentSoftwareInventory(payload);
}

/**
 * 按软件聚合的机队清单（「按软件看机器」，按持有机器数降序）。
 *
 * `limit` 指定键数上限；后端把它夹到 1..500（默认 100），前端**不重复夹取**
 * —— 夹取口径只留一处真相，页面据响应里的 `truncated` 明确提示被截断。
 */
export async function fetchSoftwareFleetInventory(
  limit = 100,
): Promise<SoftwareFleetInventory> {
  const payload = await requestJson<unknown>(
    `/api/v1/admin/software?limit=${limit}`,
  );
  return normalizeSoftwareFleetInventory(payload);
}

// ─────────────────────────────────────────────────────────────────────────────
// 工作授权（模型 `Control.Agent.Work`）
//
// 网关授权 → Agent 拉快照 → 按版本确认。页面上要能回答三个问题：
//   这台机器**在采什么**（生效中的工作与它们的采集单元）、
//   **派下去的东西到了没有**（期望版本 vs 确认版本 = 漂移）、
//   以及**谁改的**（撤回/被取代的历史留在 retired/settled 里）。
// ─────────────────────────────────────────────────────────────────────────────

/** 授权一份常驻工作（按采集面）。`spec` 留空 = 网关按事实从采集目录展开。 */
export interface GrantStandingWorkCommand {
  family: string;
  /** 留空由网关展开；写了必须是该面上的目录单元（逗号分隔）。 */
  spec?: string;
  /** 可选：期望版本，必须**大于**当前版本（网关拒绝回退）。 */
  planVersion?: number;
}

/** 派一件一次性工作（按动作）。 */
export interface GrantOneShotWorkCommand {
  action: string;
  spec: string;
  /** RFC3339 绝对截止；必填（没有截止的一次性工作与常驻工作无从分辨）。 */
  deadlineAt: string;
  /** 执行预算（秒），必须为正。 */
  timeoutSeconds: number;
  /** 计划开始时间（RFC3339）；留空 = 立即。 */
  scheduledAt?: string;
}

/** 归档用途判定（模型 `AdminClassifyAgent`）。分类必须与机器平台一致，校验在网关。 */
export interface ClassifyAgentPurposeCommand {
  machineClass: MachineClass;
  /** 采纳了哪条建议；人工直判/推翻建议时留空。 */
  suggestionId?: string;
  note?: string;
}

/**
 * 解析工作参数（`StandingWork.spec` 的内容）。
 *
 * 解析失败**不抛错、也不当空工作**：那会把「网关发了坏参数」静默成「没什么可采的」，
 * 两种情形的处置完全不同。这里保留原文与原因，交给页面如实呈现。
 */
export function parseWorkSpec(raw: string): WorkSpec {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (error) {
    return {
      units: [],
      raw,
      error: `工作参数不是合法 JSON：${(error as Error).message}`,
    };
  }
  try {
    const record = requiredRecord(decoded, "workSpec");
    const units = presentField(record, ["units"], "workSpec.units");
    return {
      units: requiredArray(units, "workSpec.units").map((item, index) => {
        const unit = requiredRecord(item, `workSpec.units[${index}]`);
        return {
          unitId: requiredString(
            unit.unit_id ?? unit.unitId,
            `workSpec.units[${index}].unitId`,
          ),
          capability: requiredString(
            unit.capability,
            `workSpec.units[${index}].capability`,
          ),
          ruleRef: requiredString(
            unit.rule_ref ?? unit.ruleRef,
            `workSpec.units[${index}].ruleRef`,
          ),
          requiresPrivilege: requiredString(
            unit.requires_privilege ?? unit.requiresPrivilege,
            `workSpec.units[${index}].requiresPrivilege`,
          ),
          sources: presentField(
            unit,
            ["sources"],
            `workSpec.units[${index}].sources`,
          ) === undefined
            ? []
            : requiredArray(
                presentField(unit, ["sources"], `workSpec.units[${index}].sources`),
                `workSpec.units[${index}].sources`,
              ).map((source, sourceIndex) => {
                const entry = requiredRecord(
                  source,
                  `workSpec.units[${index}].sources[${sourceIndex}]`,
                );
                return {
                  kind: requiredString(
                    entry.kind,
                    `workSpec.units[${index}].sources[${sourceIndex}].kind`,
                  ),
                  target: requiredString(
                    entry.target,
                    `workSpec.units[${index}].sources[${sourceIndex}].target`,
                  ),
                };
              }),
        };
      }),
      raw,
      error: null,
    };
  } catch (error) {
    return { units: [], raw, error: (error as Error).message };
  }
}

/** 确认回执：`null` = 从没确认过（那就是漂移，与「版本旧了」分开）。 */
function normalizeWorkAck(payload: unknown): WorkAck | null {
  if (payload === null || payload === undefined) return null;
  const record = requiredRecord(payload, "workAck");
  return {
    workId: requiredString(record.work_id ?? record.workId, "workAck.workId"),
    agentId: requiredString(record.agent_id ?? record.agentId, "workAck.agentId"),
    workKind: requiredWorkKind(
      record.work_kind ?? record.workKind,
      "workAck.workKind",
    ),
    planVersion: requiredNumber(
      record.plan_version ?? record.planVersion,
      "workAck.planVersion",
    ),
    acknowledgedAt: requiredString(
      record.acknowledged_at ?? record.acknowledgedAt,
      "workAck.acknowledgedAt",
    ),
  };
}

/** 工作类型是闭合取值（模型里的 variant）：认不出来就抛错。 */
function requiredWorkKind(value: unknown, fieldName: string): WorkKind {
  if (value === "Standing" || value === "OneShot") return value;
  throw new Error(`Invalid API response: invalid ${fieldName}`);
}

function requiredStandingWorkStatus(
  value: unknown,
  fieldName: string,
): StandingWorkStatus {
  if (
    value === "active" ||
    value === "paused" ||
    value === "superseded" ||
    value === "revoked"
  ) {
    return value;
  }
  throw new Error(`Invalid API response: invalid ${fieldName}`);
}

function normalizeStandingWork(payload: any): StandingWork {
  return {
    workId: requiredString(payload.work_id ?? payload.workId, "standingWork.workId"),
    agentId: requiredString(payload.agent_id ?? payload.agentId, "standingWork.agentId"),
    family: requiredString(payload.family, "standingWork.family"),
    spec: parseWorkSpec(requiredString(payload.spec, "standingWork.spec")),
    catalogVersion: requiredNumber(
      payload.catalog_version ?? payload.catalogVersion,
      "standingWork.catalogVersion",
    ),
    proposalId: nullableStringField(
      payload,
      ["proposal_id", "proposalId"],
      "standingWork.proposalId",
    ),
    planVersion: requiredNumber(
      payload.plan_version ?? payload.planVersion,
      "standingWork.planVersion",
    ),
    effectiveFrom: requiredString(
      payload.effective_from ?? payload.effectiveFrom,
      "standingWork.effectiveFrom",
    ),
    status: requiredStandingWorkStatus(payload.status, "standingWork.status"),
    updatedBy: requiredString(payload.updated_by ?? payload.updatedBy, "standingWork.updatedBy"),
    updatedAt: requiredString(payload.updated_at ?? payload.updatedAt, "standingWork.updatedAt"),
    ack: normalizeWorkAck(payload.ack),
  };
}

function normalizeWorkResult(payload: unknown): WorkResult | null {
  if (payload === null || payload === undefined) return null;
  const record = requiredRecord(payload, "workResult");
  return {
    workId: requiredString(record.work_id ?? record.workId, "workResult.workId"),
    agentId: requiredString(record.agent_id ?? record.agentId, "workResult.agentId"),
    status: requiredString(record.status, "workResult.status"),
    detail: requiredString(record.detail, "workResult.detail"),
    reportedAt: requiredString(
      record.reported_at ?? record.reportedAt,
      "workResult.reportedAt",
    ),
  };
}

function normalizeOneShotWork(payload: any): OneShotWork {
  return {
    workId: requiredString(payload.work_id ?? payload.workId, "oneShotWork.workId"),
    agentId: requiredString(payload.agent_id ?? payload.agentId, "oneShotWork.agentId"),
    action: requiredString(payload.action, "oneShotWork.action"),
    spec: requiredString(payload.spec, "oneShotWork.spec"),
    scheduledAt: requiredString(
      payload.scheduled_at ?? payload.scheduledAt,
      "oneShotWork.scheduledAt",
    ),
    deadlineAt: requiredString(
      payload.deadline_at ?? payload.deadlineAt,
      "oneShotWork.deadlineAt",
    ),
    timeoutSeconds: requiredNumber(
      payload.timeout_seconds ?? payload.timeoutSeconds,
      "oneShotWork.timeoutSeconds",
    ),
    interruptible: requiredBoolean(payload.interruptible, "oneShotWork.interruptible"),
    status: requiredString(payload.status, "oneShotWork.status"),
    pausedAt: nullableStringField(payload, ["paused_at", "pausedAt"], "oneShotWork.pausedAt"),
    pausedTotalSeconds: requiredNumber(
      payload.paused_total_seconds ?? payload.pausedTotalSeconds,
      "oneShotWork.pausedTotalSeconds",
    ),
    attempt: requiredNumber(payload.attempt, "oneShotWork.attempt"),
    issuedBy: requiredString(payload.issued_by ?? payload.issuedBy, "oneShotWork.issuedBy"),
    issuedAt: requiredString(payload.issued_at ?? payload.issuedAt, "oneShotWork.issuedAt"),
    ack: normalizeWorkAck(payload.ack),
    result: normalizeWorkResult(payload.result),
  };
}

/** 本机上报的一个采集任务 / 手工输入（两者形状相同）。 */
function normalizeAgentLocalTask(payload: any): AgentLocalTaskView {
  return {
    inputId: requiredString(
      payload.input_id ?? payload.inputId,
      "agentLocalTask.inputId",
    ),
    path: requiredString(payload.path, "agentLocalTask.path"),
    startupPosition: requiredString(
      payload.startup_position ?? payload.startupPosition,
      "agentLocalTask.startupPosition",
    ),
  };
}

function normalizeAgentLocalStandingWork(payload: any): AgentLocalStandingWorkView {
  return {
    workId: requiredString(
      payload.work_id ?? payload.workId,
      "agentLocalStandingWork.workId",
    ),
    family: requiredString(payload.family, "agentLocalStandingWork.family"),
    // 本机状态是 agent 自报的开放值：认不出来不编造，但也不因此把整块判成坏数据。
    status: requiredString(payload.status, "agentLocalStandingWork.status"),
    planVersion: requiredNumber(
      payload.plan_version ?? payload.planVersion,
      "agentLocalStandingWork.planVersion",
    ),
    acknowledgedVersion: requiredNumber(
      payload.acknowledged_version ?? payload.acknowledgedVersion,
      "agentLocalStandingWork.acknowledgedVersion",
    ),
    effectiveFrom: requiredString(
      payload.effective_from ?? payload.effectiveFrom,
      "agentLocalStandingWork.effectiveFrom",
    ),
    tasks: requiredArray(payload.tasks, "agentLocalStandingWork.tasks").map(
      normalizeAgentLocalTask,
    ),
  };
}

function normalizeAgentLocalOneShotWork(payload: any): AgentLocalOneShotWorkView {
  return {
    workId: requiredString(
      payload.work_id ?? payload.workId,
      "agentLocalOneShotWork.workId",
    ),
    action: requiredString(payload.action, "agentLocalOneShotWork.action"),
    status: requiredString(payload.status, "agentLocalOneShotWork.status"),
    execution: requiredString(payload.execution, "agentLocalOneShotWork.execution"),
    scheduledAt: requiredString(
      payload.scheduled_at ?? payload.scheduledAt,
      "agentLocalOneShotWork.scheduledAt",
    ),
    deadlineAt: requiredString(
      payload.deadline_at ?? payload.deadlineAt,
      "agentLocalOneShotWork.deadlineAt",
    ),
    timeoutSeconds: requiredNumber(
      payload.timeout_seconds ?? payload.timeoutSeconds,
      "agentLocalOneShotWork.timeoutSeconds",
    ),
  };
}

/**
 * 规范化 `AgentLocalWorkView`（`AgentWorkView.local`）。
 *
 * 与 `local` 缺失/为 `null` **分开**：这里只在字段确实存在时调用。形状不对时
 * **不抛错**（那会把一个整页视图弄挂），而是把原因放进 `error` 并返回空骨架 ——
 * 与 `parseWorkSpec` 同一口径：「上报了但对不上契约」要能说出来，不能静默成「没上报」。
 */
function normalizeAgentLocalWorkView(payload: any): AgentLocalWorkView {
  try {
    const record = requiredRecord(payload, "agentWork.local");
    return {
      recordedAt: requiredString(
        record.recorded_at ?? record.recordedAt,
        "agentWork.local.recordedAt",
      ),
      gatewaySequence: requiredNumber(
        record.gateway_sequence ?? record.gatewaySequence,
        "agentWork.local.gatewaySequence",
      ),
      standing: requiredArray(record.standing, "agentWork.local.standing").map(
        normalizeAgentLocalStandingWork,
      ),
      oneShot: requiredArray(
        record.one_shot ?? record.oneShot,
        "agentWork.local.oneShot",
      ).map(normalizeAgentLocalOneShotWork),
      localInputs: requiredArray(
        record.local_inputs ?? record.localInputs,
        "agentWork.local.localInputs",
      ).map(normalizeAgentLocalTask),
      metricsIntervalSeconds: nullableNumberField(
        record,
        ["metrics_interval_seconds", "metricsIntervalSeconds"],
        "agentWork.local.metricsIntervalSeconds",
      ),
      error: null,
    };
  } catch (error) {
    return {
      recordedAt: "",
      gatewaySequence: 0,
      standing: [],
      oneShot: [],
      localInputs: [],
      metricsIntervalSeconds: null,
      error: (error as Error).message,
    };
  }
}

/** 规范化 `AgentWorkView`（`GET /api/v1/admin/agents/{agent_id}/work`）。 */
export function normalizeAgentWorkView(payload: any): AgentWorkView {
  const hasLocal = Object.prototype.hasOwnProperty.call(payload, "local");
  return {
    agentId: requiredString(payload.agent_id ?? payload.agentId, "agentWork.agentId"),
    sequence: requiredNumber(payload.sequence, "agentWork.sequence"),
    standing: requiredArray(payload.standing ?? [], "agentWork.standing").map(
      normalizeStandingWork,
    ),
    oneShot: requiredArray(payload.one_shot ?? payload.oneShot ?? [], "agentWork.oneShot").map(
      normalizeOneShotWork,
    ),
    retiredStanding: requiredArray(
      payload.retired_standing ?? payload.retiredStanding ?? [],
      "agentWork.retiredStanding",
    ).map(normalizeStandingWork),
    settledOneShot: requiredArray(
      payload.settled_one_shot ?? payload.settledOneShot ?? [],
      "agentWork.settledOneShot",
    ).map(normalizeOneShotWork),
    generatedAt: requiredString(
      payload.generated_at ?? payload.generatedAt,
      "agentWork.generatedAt",
    ),
    // 缺键 / `null` 都当 `null`：旧网关/旧 agent 没这个字段是正常的，不能抛错。
    local:
      hasLocal && payload.local !== null && payload.local !== undefined
        ? normalizeAgentLocalWorkView(payload.local)
        : null,
  };
}

/** 规范化 `WorkReceipt`。 */
export function normalizeWorkReceipt(payload: any): WorkReceipt {
  return {
    workId: requiredString(payload.work_id ?? payload.workId, "workReceipt.workId"),
    agentId: requiredString(payload.agent_id ?? payload.agentId, "workReceipt.agentId"),
    workKind: requiredWorkKind(payload.work_kind ?? payload.workKind, "workReceipt.workKind"),
    status: requiredString(payload.status, "workReceipt.status"),
    planVersion: requiredNumber(
      payload.plan_version ?? payload.planVersion,
      "workReceipt.planVersion",
    ),
    createdAt: requiredString(payload.created_at ?? payload.createdAt, "workReceipt.createdAt"),
  };
}

/**
 * 某台 Agent 手上的工作（生效中的 + 未了结的一次性 + 历史留痕）。
 *
 * 不轮询：授权是**人工声明**，只在管理面操作时变化；但 Agent 的确认会随后到达
 * （它按 30s 的节拍拉快照），所以页面在提交操作后会主动失效重取，让「确认到了没有」可见。
 */
export async function fetchAgentWork(agentId: string): Promise<AgentWorkView> {
  const payload = await requestJson<unknown>(
    `/api/v1/admin/agents/${encodeURIComponent(agentId)}/work`,
  );
  return normalizeAgentWorkView(payload);
}

/** 授权/更新一份常驻工作。同一面再授一次 = 改这一份（版本 +1），不是多出一份。 */
export async function grantStandingWork(
  agentId: string,
  command: GrantStandingWorkCommand,
): Promise<WorkReceipt> {
  const payload = await requestJson<unknown>(
    `/api/v1/admin/agents/${encodeURIComponent(agentId)}/work`,
    {
      method: "POST",
      body: JSON.stringify({
        work_kind: "Standing",
        family: command.family,
        spec: command.spec ?? "",
        ...(command.planVersion === undefined
          ? {}
          : { plan_version: command.planVersion }),
      }),
    },
  );
  return normalizeWorkReceipt(payload);
}

/** 派一件一次性工作（有期限与终态；agentd 侧的执行尚未实现）。 */
export async function grantOneShotWork(
  agentId: string,
  command: GrantOneShotWorkCommand,
): Promise<WorkReceipt> {
  const payload = await requestJson<unknown>(
    `/api/v1/admin/agents/${encodeURIComponent(agentId)}/work`,
    {
      method: "POST",
      body: JSON.stringify({
        work_kind: "OneShot",
        action: command.action,
        spec: command.spec,
        deadline_at: command.deadlineAt,
        timeout_seconds: command.timeoutSeconds,
        ...(command.scheduledAt ? { scheduled_at: command.scheduledAt } : {}),
      }),
    },
  );
  return normalizeWorkReceipt(payload);
}

/**
 * 撤回一份工作：常驻 → revoked（撤销授权），一次性 → canceled（取消未了结的活）。
 *
 * `reason_code` 是留痕用的（当前网关只收下、还没落库）。
 */
export async function revokeWork(
  agentId: string,
  workId: string,
  reasonCode: string,
): Promise<WorkReceipt> {
  const payload = await requestJson<unknown>(
    `/api/v1/admin/agents/${encodeURIComponent(agentId)}/work/${encodeURIComponent(workId)}/revoke`,
    { method: "POST", body: JSON.stringify({ reason_code: reasonCode }) },
  );
  return normalizeWorkReceipt(payload);
}

/** 暂停一份工作：保留授权与版本，Agent「暂不做但仍持有」。 */
export async function pauseWork(
  agentId: string,
  workId: string,
): Promise<WorkReceipt> {
  const payload = await requestJson<unknown>(
    `/api/v1/admin/agents/${encodeURIComponent(agentId)}/work/${encodeURIComponent(workId)}/pause`,
    { method: "POST" },
  );
  return normalizeWorkReceipt(payload);
}

/** 恢复一份被暂停的工作：仍用暂停前的同一版本，不重新审定。 */
export async function resumeWork(
  agentId: string,
  workId: string,
): Promise<WorkReceipt> {
  const payload = await requestJson<unknown>(
    `/api/v1/admin/agents/${encodeURIComponent(agentId)}/work/${encodeURIComponent(workId)}/resume`,
    { method: "POST" },
  );
  return normalizeWorkReceipt(payload);
}

/**
 * 归档某台 Agent 的用途判定（采集范围变更的前置）。
 *
 * 分类必须与该机器**已观测到的平台**一致：网关在没上报过事实时回 400（不默认放行）。
 */
export async function classifyAgentPurpose(
  agentId: string,
  command: ClassifyAgentPurposeCommand,
): Promise<AgentClassification> {
  const payload = await requestJson<unknown>(
    `/api/v1/admin/agents/${encodeURIComponent(agentId)}/classification`,
    {
      method: "POST",
      body: JSON.stringify({
        machine_class: command.machineClass,
        ...(command.suggestionId ? { suggestion_id: command.suggestionId } : {}),
        ...(command.note ? { note: command.note } : {}),
      }),
    },
  );
  return normalizeAgentClassification(payload);
}

// ─────────────────────────────────────────────────────────────────────────────
// 采集内容目录（管理面 `GET /api/v1/admin/content`）
// ─────────────────────────────────────────────────────────────────────────────

function normalizeFamilyReadiness(
  platform: string,
  payload: any,
): FamilyReadinessView {
  return {
    family: requiredString(payload.family, "familyReadiness.family"),
    // 平台在**父级**（网关的 readiness 是按平台分组的），这里摊平到每一条上，
    // 页面侧就只需要一份扁平清单（按平台筛选是取用方的事）。
    platform,
    activeUnits: requiredNumber(
      payload.active_units ?? payload.activeUnits,
      "familyReadiness.activeUnits",
    ),
    parseReadyUnits: requiredNumber(
      payload.parse_ready_units ?? payload.parseReadyUnits,
      "familyReadiness.parseReadyUnits",
    ),
    totalUnits: requiredNumber(
      payload.total_units ?? payload.totalUnits,
      "familyReadiness.totalUnits",
    ),
    ready: requiredBoolean(payload.ready, "familyReadiness.ready"),
    // 解析就绪是**独立**的一轴（不参与闸门）：缺字段时不当 false 默认，
    // 否则服务端一漂移，页面就会把“不知道能不能归类”默默说成“不能归类”。
    parseReady: requiredBoolean(payload.parse_ready, "familyReadiness.parseReady"),
  };
}

function normalizeContentTemplate(payload: any): ContentTemplateView {
  return {
    templateId: requiredString(
      payload.template_id ?? payload.templateId,
      "contentTemplate.templateId",
    ),
    machineClass: requiredMachineClass(
      payload.machine_class ?? payload.machineClass,
      "contentTemplate.machineClass",
    ),
    platform: requiredString(payload.platform, "contentTemplate.platform"),
    status: requiredString(payload.status, "contentTemplate.status"),
    familyScope: requiredStringArray(
      payload.family_scope ?? payload.familyScope ?? [],
      "contentTemplate.familyScope",
    ),
    capabilityScope: requiredStringArray(
      payload.capability_scope ?? payload.capabilityScope ?? [],
      "contentTemplate.capabilityScope",
    ),
  };
}

export function normalizeContentCatalog(payload: any): ContentCatalogView {
  return {
    catalogVersion: requiredNumber(
      payload.catalog_version ?? payload.catalogVersion,
      "contentCatalog.catalogVersion",
    ),
    supersededBy: (() => {
      const value = presentField(
        payload,
        ["superseded_by", "supersededBy"],
        "contentCatalog.supersededBy",
      );
      if (value === null) return null;
      return requiredNumber(value, "contentCatalog.supersededBy");
    })(),
    templates: requiredArray(payload.templates ?? [], "contentCatalog.templates").map(
      normalizeContentTemplate,
    ),
    // 网关的 readiness 是**按平台分组**的（`[{platform, families:[…]}]`）；
    // 摊平成一条一面，因为页面的问题是「这个面能不能派」，而不是「有哪些平台」。
    readiness: requiredArray(payload.readiness ?? [], "contentCatalog.readiness").flatMap(
      (group, index) => {
        const record = requiredRecord(group, `contentCatalog.readiness[${index}]`);
        const platform = requiredString(
          record.platform,
          `contentCatalog.readiness[${index}].platform`,
        );
        return requiredArray(
          record.families ?? [],
          `contentCatalog.readiness[${index}].families`,
        ).map((entry) => normalizeFamilyReadiness(platform, entry));
      },
    ),
  };
}

/**
 * 已装载的采集内容目录（模板 + 各平台各面的就绪度）。
 *
 * 关闭内容目录（未配 `[content]`）时网关回 503 —— 页面据此说「内容目录未装载」，
 * 而不是把它渲染成「一个面都不能派」。
 */
export async function fetchContentCatalog(): Promise<ContentCatalogView> {
  const payload = await requestJson<unknown>("/api/v1/admin/content");
  return normalizeContentCatalog(payload);
}

// ─────────────────────────────────────────────────────────────────────────────
// 采集日志（管理面 `GET /api/v1/admin/logs`）
//
// 日志链路：agentd → warp-parse（数据面）→ 网关内部接入端点 → 网关主机上的
// **本地 NDJSON 文件**（没有数据库表）。服务端读的是文件尾部窗口，返回最新的
// N 条（写入顺序，旧 → 新）；`truncated` 表示窗口被裁剪，`file` 指向原文文件。
// ─────────────────────────────────────────────────────────────────────────────

function normalizeAgentLogRecord(
  value: unknown,
  fieldName: string,
): AgentLogRecord {
  const record = requiredRecord(value, fieldName);
  return {
    agentId: presentStringField(
      record,
      ["agent_id", "agentId"],
      `${fieldName}.agentId`,
    ),
    // 采集面 / 采集单元：**由网关补齐**（落盘时就是字符串，本机手工输入的输入是空串），
    // 所以这两个键必须在响应里 —— 缺了说明对面不是当前契约，别默认成空值糊过去。
    family: presentStringField(record, ["family"], `${fieldName}.family`),
    unit: presentStringField(record, ["unit"], `${fieldName}.unit`),
    observedAt: presentStringField(
      record,
      ["observed_at", "observedAt"],
      `${fieldName}.observedAt`,
    ),
    seq: presentNumberField(record, ["seq"], `${fieldName}.seq`),
    category: presentStringField(record, ["category"], `${fieldName}.category`),
    logDesc: presentStringField(
      record,
      ["log_desc", "logDesc"],
      `${fieldName}.logDesc`,
    ),
    // 原文**可以含换行**：它是一个完整的字符串，不是「一行」。
    raw: presentStringField(record, ["raw"], `${fieldName}.raw`),
    receivedAt: presentStringField(
      record,
      ["received_at", "receivedAt"],
      `${fieldName}.receivedAt`,
    ),
  };
}

/**
 * 规范化「采集日志」视图。
 *
 * `logs` 数组本身必须存在 —— 与「暂时没有日志」是两回事：后者是 200 + 空数组，
 * 不是缺字段。`truncated` / `file` 是这一页判断「是不是全集」与「去哪个文件取原文」
 * 的两个依据，不能静默丢掉。
 */
export function normalizeAgentLogs(payload: unknown): AgentLogsView {
  const root = requiredRecord(payload, "agentLogs");
  return {
    logs: requiredArray(
      presentField(root, ["logs"], "agentLogs.logs"),
      "agentLogs.logs",
    ).map((entry, index) =>
      normalizeAgentLogRecord(entry, `agentLogs.logs[${index}]`),
    ),
    limit: presentNumberField(root, ["limit"], "agentLogs.limit"),
    truncated: presentBooleanField(root, ["truncated"], "agentLogs.truncated"),
    file: presentStringField(root, ["file"], "agentLogs.file"),
  };
}

/** 「采集日志」查询参数：三者都可选，省略即不约束。 */
export interface ViewAgentLogsQuery {
  /** 按 agent_id 过滤；省略 = 返回所有 Agent 的记录。 */
  agentId?: string;
  /**
   * 按**采集面**过滤（闭集，如 `ServiceLifecycle`）；省略 = 所有面。
   *
   * 为什么需要它：正文规则未就绪时 `category` 恒为泛化的 `agent.log`，
   * 面是唯一能把「这些是 launchd 的、那些是 wifi 的」分开的字段。
   * 值大小写敏感、原样透传 —— 它按面名逐字比对（不是模糊匹配）。
   */
  family?: string;
  /** 条数上限；后端夹到 1..1000（默认 200）。 */
  limit?: number;
}

/**
 * 读取网关主机上的采集日志（文件尾部窗口，最新 N 条）。
 *
 * `agent_id` / `family` / `limit` 都是可选查询参数：省略 agent_id 返回所有 Agent 的记录，
 * 省略 family 返回所有采集面的记录；limit 由后端夹到 1..1000（默认 200），前端**不重复夹取**
 * —— 夹取口径只留一处真相，页面据响应里的 `limit` / `truncated` 如实呈现。
 */
export async function viewAgentLogs(
  query: ViewAgentLogsQuery = {},
): Promise<AgentLogsView> {
  const params = new URLSearchParams();
  if (query.agentId) params.set("agent_id", query.agentId);
  if (query.family) params.set("family", query.family);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const search = params.toString();
  const payload = await requestJson<unknown>(
    `/api/v1/admin/logs${search ? `?${search}` : ""}`,
  );
  return normalizeAgentLogs(payload);
}

// ─────────────────────────────────────────────────────────────────────────────
// 灰度发布计划（模型 `Control.Rollout`）
//
// 计划是**编排层**：把升级（今天唯一的动作）按阶段铺到机队。管理面要能回答：这份计划
// 铺到谁、铺到第几阶段、每台成没成、失败/回滚的原因。计划本身不存工作内容 —— `spec`
// 只在计划这一行，逐目标条目只记 work_id 与结果（由 agentd 上报回填，网关折算成条目状态）。
// ─────────────────────────────────────────────────────────────────────────────

/** 新建计划里的一个阶段（模型 `RolloutPhase`）。 */
export interface CreateRolloutPhaseCommand {
  /** 本阶段的目标范围（agent_id）。 */
  targetIds: string[];
  /** manual | all_succeeded | success_rate:<NN>。 */
  advanceRule: string;
}

/** 新建一份灰度发布计划（模型 `AdminCreateRolloutPlan`）。 */
export interface CreateRolloutPlanCommand {
  /** 动作面：今天只有 `upgrade`。 */
  action: string;
  /** 动作参数（JSON 字符串）；`upgrade` 用 `jsonUpgradeSpec` 从结构化字段拼。 */
  spec: string;
  phases: CreateRolloutPhaseCommand[];
  /** RFC3339 绝对截止。 */
  deadlineAt: string;
  /** 执行预算（秒），必须为正。 */
  timeoutSeconds: number;
  /** 每个阶段内同时执行的台数（0 = 不节流、全量同时）。 */
  batchSize: number;
}

/**
 * 拼 `upgrade` 动作的 spec（与 agentd 侧 `UpgradeSpec` 同形）。
 *
 * `target_version` **可省**（留空就不写）：新 agentd 会从包内 agentd 自报的版本取。
 * 但**旧 agentd 要求这个键必须存在**，所以升级一批还没跟上的旧 Agent 时要把目标版本填上。
 * 页面上不暴露这个键（版本以包内 agentd 自报为单一事实来源），需要时由调用方在此传入。
 * `package_url` 必须是 `https://…` 或**目标 Agent 主机上的绝对路径**；`package_sha256` 必须是
 * 64 位 hex（可带 `sha256:` 前缀）。这两个键永远写。
 *
 * `allow_downgrade` **可选**：agentd 默认只允许更新（版本必须更高），只有显式置 `true` 才允许
 * 同版本 / 降级。`true` 才写进 JSON —— 不给 / `false` 都不写这个键，这样产物与旧 spec 字节一致，
 * 还没认这个字段的旧 agentd 也能照常解析。
 */
export function jsonUpgradeSpec(input: {
  targetVersion?: string;
  packageUrl: string;
  packageSha256: string;
  allowDowngrade?: boolean;
}): string {
  const target = input.targetVersion?.trim();
  return JSON.stringify({
    ...(target ? { target_version: target } : {}),
    package_url: input.packageUrl.trim(),
    package_sha256: input.packageSha256.trim(),
    ...(input.allowDowngrade === true ? { allow_downgrade: true } : {}),
  });
}

/**
 * 解析 `upgrade` 计划的 `spec`（与 `jsonUpgradeSpec` 反向）。
 *
 * `target_version` 是**可省**的（版本由包内 agentd 自报决定），所以它缺省时返回 `null`、
 * 不当成错误；`package_url` / `package_sha256` 必须存在。`allow_downgrade` 也是**可省**的，
 * 缺省读作 `false`（旧 spec 没这个键 —— 那就是默认的「只允许更新」）。解析失败**不抛错**，
 * 而是把原文与原因交给页面如实呈现。
 */
export function parseUpgradeSpec(raw: string): {
  targetVersion: string | null;
  packageUrl: string | null;
  packageSha256: string | null;
  allowDowngrade: boolean;
  raw: string;
  error: string | null;
} {
  try {
    const record = requiredRecord(JSON.parse(raw), "upgradeSpec");
    return {
      targetVersion: optionalStringField(
        record,
        ["target_version", "targetVersion"],
        "upgradeSpec.targetVersion",
      ),
      packageUrl: nullableStringField(
        record,
        ["package_url", "packageUrl"],
        "upgradeSpec.packageUrl",
      ),
      packageSha256: nullableStringField(
        record,
        ["package_sha256", "packageSha256"],
        "upgradeSpec.packageSha256",
      ),
      allowDowngrade: optionalBooleanField(
        record,
        ["allow_downgrade", "allowDowngrade"],
        "upgradeSpec.allowDowngrade",
      ),
      raw,
      error: null,
    };
  } catch (error) {
    return {
      targetVersion: null,
      packageUrl: null,
      packageSha256: null,
      allowDowngrade: false,
      raw,
      error: (error as Error).message,
    };
  }
}

function normalizeRolloutPhase(payload: unknown): RolloutPhaseView {
  const record = requiredRecord(payload, "rolloutPhase");
  return {
    phaseIndex: requiredNumber(
      presentField(record, ["phase_index", "phaseIndex"], "rolloutPhase.phaseIndex"),
      "rolloutPhase.phaseIndex",
    ),
    targetIds: requiredArray(
      presentField(record, ["target_ids", "targetIds"], "rolloutPhase.targetIds"),
      "rolloutPhase.targetIds",
    ).map((target, index) =>
      requiredString(target, `rolloutPhase.targetIds[${index}]`),
    ),
    advanceRule: requiredString(
      presentField(record, ["advance_rule", "advanceRule"], "rolloutPhase.advanceRule"),
      "rolloutPhase.advanceRule",
    ),
    status: requiredString(record.status, "rolloutPhase.status"),
  };
}

/** 规范化一份计划（`/rollout-plans` 列表项与单份返回同一形状）。 */
export function normalizeRolloutPlan(payload: unknown): RolloutPlanView {
  const record = requiredRecord(payload, "rolloutPlan");
  return {
    planId: requiredString(
      presentField(record, ["plan_id", "planId"], "rolloutPlan.planId"),
      "rolloutPlan.planId",
    ),
    action: requiredString(record.action, "rolloutPlan.action"),
    spec: requiredString(record.spec, "rolloutPlan.spec"),
    deadlineAt: requiredString(
      presentField(record, ["deadline_at", "deadlineAt"], "rolloutPlan.deadlineAt"),
      "rolloutPlan.deadlineAt",
    ),
    timeoutSeconds: requiredNumber(
      presentField(record, ["timeout_seconds", "timeoutSeconds"], "rolloutPlan.timeoutSeconds"),
      "rolloutPlan.timeoutSeconds",
    ),
    phases: requiredArray(record.phases, "rolloutPlan.phases").map(normalizeRolloutPhase),
    batchSize: requiredNumber(
      presentField(record, ["batch_size", "batchSize"], "rolloutPlan.batchSize"),
      "rolloutPlan.batchSize",
    ),
    currentPhase: requiredNumber(
      presentField(record, ["current_phase", "currentPhase"], "rolloutPlan.currentPhase"),
      "rolloutPlan.currentPhase",
    ),
    status: requiredString(record.status, "rolloutPlan.status"),
    createdBy: requiredString(
      presentField(record, ["created_by", "createdBy"], "rolloutPlan.createdBy"),
      "rolloutPlan.createdBy",
    ),
    createdAt: requiredString(
      presentField(record, ["created_at", "createdAt"], "rolloutPlan.createdAt"),
      "rolloutPlan.createdAt",
    ),
    approvedBy: nullableStringField(
      record,
      ["approved_by", "approvedBy"],
      "rolloutPlan.approvedBy",
    ),
    approvedAt: nullableStringField(
      record,
      ["approved_at", "approvedAt"],
      "rolloutPlan.approvedAt",
    ),
  };
}

function normalizeRolloutPlanEntry(payload: unknown): RolloutPlanEntryView {
  const record = requiredRecord(payload, "rolloutEntry");
  return {
    targetId: requiredString(
      presentField(record, ["target_id", "targetId"], "rolloutEntry.targetId"),
      "rolloutEntry.targetId",
    ),
    workId: nullableStringField(record, ["work_id", "workId"], "rolloutEntry.workId"),
    status: requiredString(record.status, "rolloutEntry.status"),
    detail: requiredString(record.detail, "rolloutEntry.detail"),
    updatedAt: requiredString(
      presentField(record, ["updated_at", "updatedAt"], "rolloutEntry.updatedAt"),
      "rolloutEntry.updatedAt",
    ),
  };
}

/** 规范化一份计划详情（`GET /api/v1/admin/rollout-plans/{plan_id}`）。 */
export function normalizeRolloutPlanDetail(payload: unknown): RolloutPlanDetailView {
  const record = requiredRecord(payload, "rolloutPlanDetail");
  return {
    plan: normalizeRolloutPlan(record.plan),
    entries: requiredArray(record.entries, "rolloutPlanDetail.entries").map(
      normalizeRolloutPlanEntry,
    ),
  };
}

/** 列出网关下的灰度发布计划（读投影，不轮询：只在管理面操作时变化）。 */
export async function fetchRolloutPlans(): Promise<RolloutPlanView[]> {
  const payload = await requestJson<unknown>("/api/v1/admin/rollout-plans");
  return requiredArray(payload, "rolloutPlans").map(normalizeRolloutPlan);
}

/** 查看一份计划及其逐台进度。 */
export async function fetchRolloutPlan(
  planId: string,
): Promise<RolloutPlanDetailView> {
  const payload = await requestJson<unknown>(
    `/api/v1/admin/rollout-plans/${encodeURIComponent(planId)}`,
  );
  return normalizeRolloutPlanDetail(payload);
}

/** 创建一份计划（落成 `draft`，等批准后才展开成工作）。 */
export async function createRolloutPlan(
  command: CreateRolloutPlanCommand,
): Promise<RolloutPlanView> {
  const payload = await requestJson<unknown>("/api/v1/admin/rollout-plans", {
    method: "POST",
    body: JSON.stringify({
      action: command.action,
      spec: command.spec,
      phases: command.phases.map((phase) => ({
        target_ids: phase.targetIds,
        advance_rule: phase.advanceRule,
      })),
      deadline_at: command.deadlineAt,
      timeout_seconds: command.timeoutSeconds,
      batch_size: command.batchSize,
    }),
  });
  return normalizeRolloutPlan(payload);
}

/** 批准一份计划：进入第一阶段，为阶段内每个 target 生成一件一次性工作。 */
export async function approveRolloutPlan(planId: string): Promise<RolloutPlanView> {
  const payload = await requestJson<unknown>(
    "/api/v1/admin/rollout-plans/approve",
    { method: "POST", body: JSON.stringify({ plan_id: planId }) },
  );
  return normalizeRolloutPlan(payload);
}

/** 推进到下一阶段（`advance_rule = manual` 的阶段由人工确认后点这个）。 */
export async function advanceRolloutPlan(planId: string): Promise<RolloutPlanView> {
  const payload = await requestJson<unknown>(
    "/api/v1/admin/rollout-plans/advance",
    { method: "POST", body: JSON.stringify({ plan_id: planId }) },
  );
  return normalizeRolloutPlan(payload);
}

// ── 知识库内容（策展数据）的管理与发布 ───────────────────────────────────────
//
// 网关的「知识库」= 采集目录 / 采集包 / 采集模板 + 用途规则 + 发现策略这五份策展数据。
// 它们**不再**从配置文件装载（`[content]` / `[purpose]` / `[discovery]` 的 `*_file` 已退役），
// 而是像 Agent 安装包一样由管理面录入、激活、回滚，且**不重启热加载**（设计
// `wist-gateway/docs/design/knowledge-content-management.md` §8.1）。
//
// 三件事在这里被钉住：
//   1. **录入 ≠ 生效**：`POST …/packages` 只落盘登记，`POST …/packages/{id}/activate` 才切指针；
//   2. **空载不是错误**：`GET …/knowledge` 回 `configured: false` + `hint`，页面据此给「怎么办」；
//   3. **错误正文是 `{code, message}`**（`knowledge_ops::KnowledgeErrorBody`），页面靠 `code`
//      分辨「包不对」与「网关换了库」，所以 `parseKnowledgeErrorDetail` 把它解出来。

/** 网关**当前生效**的知识库内容（`GET /api/v1/admin/knowledge`）。 */
export interface KnowledgeView {
  /**
   * `none`（空载）| `config-files`（从配置文件装载，过渡态）| `package`（管理面登记的包）
   * | `dir`（**出厂初始包**：`[knowledge] source_dir`，有内容但不走管理面）。
   */
  source: string;
  /** `false` = 空载。**不是错误**：此时不产「系统类型」与用途建议，发现策略用 agentd 内建默认值。 */
  configured: boolean;
  /** 生效包的 id（`kbp-<tarball sha256 前 16>`）；空载 / 过渡态为 `null`。 */
  packageId: string | null;
  /** 世代号：每次激活 +1。派生结果「算自哪一版」的表级锚。 */
  generation: number;
  /** 五份数据各自声明的版本（取得到就报）。 */
  catalogVersion: number | null;
  templateVersion: number | null;
  policyVersion: number | null;
  purposeVersion: number | null;
  /** 生效包的登记信息（谁、什么时候切的）；空载或过渡态为 `null`。 */
  active: KnowledgeActiveView | null;
  /** 空载时给运维看的「为什么 + 怎么办」；有配置时为 `null`。 */
  hint: string | null;
  /** 最近几次切换（激活 / 回滚），最近优先。 */
  activations: KnowledgeActivationView[];
}

/** 生效包的登记信息（`GET …/knowledge` 的 `active`）。 */
export interface KnowledgeActiveView {
  packageId: string;
  activatedBy: string;
  activatedAt: string;
}

/** 一次切换（激活 / 回滚）的审计记录。 */
export interface KnowledgeActivationView {
  /** 切之前生效的是哪一版；首次激活为 `null` —— 它也就是「回滚到上一版」的目标。 */
  fromPackage: string | null;
  toPackage: string;
  generation: number;
  /** `activate` | `rollback` | `repair`。 */
  reason: string;
  requestedBy: string;
  createdAt: string;
}

/** 网关**已录入**的一个知识库包（`packages[]` 的一项 / 录入与激活的响应）。 */
export interface KnowledgePackageView {
  /** 内容寻址 id：`kbp-<来源 tarball 的 sha256 前 16>`。 */
  packageId: string;
  /** 录入时给的来源（只留痕）。 */
  source: string;
  /** 来源 tarball 的 sha256（**不带** `sha256:` 前缀）。 */
  packageSha256: string;
  /** 包自报版本（`wist-knowledge` 的 `version.txt`）。 */
  version: string;
  catalogVersion: number | null;
  templateVersion: number | null;
  policyVersion: number | null;
  purposeVersion: number | null;
  /** 验签通过时是公钥指纹；空串 = 网关**没配验签公钥**（只记了摘要，未验签）。 */
  signedBy: string;
  /** 网关侧副本目录（容器内路径）。 */
  cachedPath: string;
  createdBy: string;
  createdAt: string;
  /** 是不是**当前生效**的那一版。 */
  active: boolean;
  /** 副本还在不在（被手工删过 / 备份还原不完整时为 `false`）。 */
  available: boolean;
  /** 副本里实际有哪些文件（逐条 sha256）；副本不在时为空。 */
  files: KnowledgeFileView[];
}

/** 包副本里的一个文件。 */
export interface KnowledgeFileView {
  name: string;
  sha256: string;
  bytes: number;
}

/** **谁还锁在旧版目录**（`GET …/knowledge/locks`）。 */
export interface KnowledgeLocksView {
  /** 当前生效包声明的目录版本；切新版后，旧版工作仍锁在旧号上。 */
  activeCatalogVersion: number | null;
  /** 按 `catalog_version` 分组的**在跑**常驻工作数。 */
  locks: KnowledgeLockView[];
}

/** 一组锁在同一个目录版本上的工作数。 */
export interface KnowledgeLockView {
  catalogVersion: number;
  works: number;
}

/** 录入一个知识库包。`activate` 缺省 `false`（录入 ≠ 生效）。 */
export interface RecordKnowledgePackageCommand {
  /** `https://…` 链接，或**容器内**绝对路径（宿主路径容器里看不见）。 */
  source: string;
  /** 可选的期望摘要（发布侧 `*.sha256` 里那串），与来源字节核对。 */
  sha256?: string;
  /** 录入成功后是否立即激活。缺省 `false`。 */
  activate?: boolean;
  requestedBy?: string;
}

/** 切换生效指针。`reason` 缺省 `activate`；回滚就是「把指针指回上一版」。 */
export interface ActivateKnowledgePackageCommand {
  reason?: "activate" | "rollback" | "repair";
  requestedBy?: string;
}

function normalizeKnowledgeActivation(
  payload: unknown,
  index: number,
): KnowledgeActivationView {
  const at = `knowledge.activations[${index}]`;
  const record = requiredRecord(payload, at);
  return {
    fromPackage: nullableStringField(
      record,
      ["from_package", "fromPackage"],
      `${at}.fromPackage`,
    ),
    toPackage: requiredString(
      presentField(record, ["to_package", "toPackage"], `${at}.toPackage`),
      `${at}.toPackage`,
    ),
    generation: requiredNumber(
      presentField(record, ["generation"], `${at}.generation`),
      `${at}.generation`,
    ),
    reason: requiredString(
      presentField(record, ["reason"], `${at}.reason`),
      `${at}.reason`,
    ),
    requestedBy: requiredString(
      presentField(
        record,
        ["requested_by", "requestedBy"],
        `${at}.requestedBy`,
      ),
      `${at}.requestedBy`,
    ),
    createdAt: requiredString(
      presentField(record, ["created_at", "createdAt"], `${at}.createdAt`),
      `${at}.createdAt`,
    ),
  };
}

/** `GET /api/v1/admin/knowledge` 的解析。空载（`configured: false`）是**合法结果**，不是错误。 */
export function normalizeKnowledge(payload: unknown): KnowledgeView {
  const record = requiredRecord(payload, "knowledge");
  const active = nullableRecordField(record, ["active"], "knowledge.active");
  return {
    source: requiredString(
      presentField(record, ["source"], "knowledge.source"),
      "knowledge.source",
    ),
    configured: requiredBoolean(
      presentField(record, ["configured"], "knowledge.configured"),
      "knowledge.configured",
    ),
    packageId: nullableStringField(
      record,
      ["package_id", "packageId"],
      "knowledge.packageId",
    ),
    generation: requiredNumber(
      presentField(record, ["generation"], "knowledge.generation"),
      "knowledge.generation",
    ),
    catalogVersion: nullableNumberField(
      record,
      ["catalog_version", "catalogVersion"],
      "knowledge.catalogVersion",
    ),
    templateVersion: nullableNumberField(
      record,
      ["template_version", "templateVersion"],
      "knowledge.templateVersion",
    ),
    policyVersion: nullableNumberField(
      record,
      ["policy_version", "policyVersion"],
      "knowledge.policyVersion",
    ),
    purposeVersion: nullableNumberField(
      record,
      ["purpose_version", "purposeVersion"],
      "knowledge.purposeVersion",
    ),
    active: active
      ? {
          packageId: requiredString(
            presentField(
              active,
              ["package_id", "packageId"],
              "knowledge.active.packageId",
            ),
            "knowledge.active.packageId",
          ),
          activatedBy: requiredString(
            presentField(
              active,
              ["activated_by", "activatedBy"],
              "knowledge.active.activatedBy",
            ),
            "knowledge.active.activatedBy",
          ),
          activatedAt: requiredString(
            presentField(
              active,
              ["activated_at", "activatedAt"],
              "knowledge.active.activatedAt",
            ),
            "knowledge.active.activatedAt",
          ),
        }
      : null,
    hint: nullableStringField(record, ["hint"], "knowledge.hint"),
    activations: requiredArray(
      presentField(record, ["activations"], "knowledge.activations"),
      "knowledge.activations",
    ).map(normalizeKnowledgeActivation),
  };
}

function normalizeKnowledgeFile(
  payload: unknown,
  index: number,
): KnowledgeFileView {
  const at = `knowledgePackage.files[${index}]`;
  const record = requiredRecord(payload, at);
  return {
    name: requiredString(
      presentField(record, ["name"], `${at}.name`),
      `${at}.name`,
    ),
    sha256: requiredString(
      presentField(record, ["sha256"], `${at}.sha256`),
      `${at}.sha256`,
    ),
    bytes: requiredNumber(
      presentField(record, ["bytes"], `${at}.bytes`),
      `${at}.bytes`,
    ),
  };
}

/** 已录入包一项的解析（列表项、录入响应、激活响应都是这个形状）。 */
export function normalizeKnowledgePackage(
  payload: unknown,
): KnowledgePackageView {
  const record = requiredRecord(payload, "knowledgePackage");
  return {
    packageId: requiredString(
      presentField(
        record,
        ["package_id", "packageId"],
        "knowledgePackage.packageId",
      ),
      "knowledgePackage.packageId",
    ),
    source: requiredString(
      presentField(record, ["source"], "knowledgePackage.source"),
      "knowledgePackage.source",
    ),
    packageSha256: requiredString(
      presentField(
        record,
        ["package_sha256", "packageSha256"],
        "knowledgePackage.packageSha256",
      ),
      "knowledgePackage.packageSha256",
    ),
    version: requiredString(
      presentField(record, ["version"], "knowledgePackage.version"),
      "knowledgePackage.version",
    ),
    catalogVersion: nullableNumberField(
      record,
      ["catalog_version", "catalogVersion"],
      "knowledgePackage.catalogVersion",
    ),
    templateVersion: nullableNumberField(
      record,
      ["template_version", "templateVersion"],
      "knowledgePackage.templateVersion",
    ),
    policyVersion: nullableNumberField(
      record,
      ["policy_version", "policyVersion"],
      "knowledgePackage.policyVersion",
    ),
    purposeVersion: nullableNumberField(
      record,
      ["purpose_version", "purposeVersion"],
      "knowledgePackage.purposeVersion",
    ),
    signedBy: requiredString(
      presentField(
        record,
        ["signed_by", "signedBy"],
        "knowledgePackage.signedBy",
      ),
      "knowledgePackage.signedBy",
    ),
    cachedPath: requiredString(
      presentField(
        record,
        ["cached_path", "cachedPath"],
        "knowledgePackage.cachedPath",
      ),
      "knowledgePackage.cachedPath",
    ),
    createdBy: requiredString(
      presentField(
        record,
        ["created_by", "createdBy"],
        "knowledgePackage.createdBy",
      ),
      "knowledgePackage.createdBy",
    ),
    createdAt: requiredString(
      presentField(
        record,
        ["created_at", "createdAt"],
        "knowledgePackage.createdAt",
      ),
      "knowledgePackage.createdAt",
    ),
    active: requiredBoolean(
      presentField(record, ["active"], "knowledgePackage.active"),
      "knowledgePackage.active",
    ),
    available: requiredBoolean(
      presentField(record, ["available"], "knowledgePackage.available"),
      "knowledgePackage.available",
    ),
    files: requiredArray(
      presentField(record, ["files"], "knowledgePackage.files"),
      "knowledgePackage.files",
    ).map(normalizeKnowledgeFile),
  };
}

/** `GET …/knowledge/locks` 的解析。 */
export function normalizeKnowledgeLocks(payload: unknown): KnowledgeLocksView {
  const record = requiredRecord(payload, "knowledgeLocks");
  return {
    activeCatalogVersion: nullableNumberField(
      record,
      ["active_catalog_version", "activeCatalogVersion"],
      "knowledgeLocks.activeCatalogVersion",
    ),
    locks: requiredArray(
      presentField(record, ["locks"], "knowledgeLocks.locks"),
      "knowledgeLocks.locks",
    ).map((entry, index) => {
      const at = `knowledgeLocks.locks[${index}]`;
      const lock = requiredRecord(entry, at);
      return {
        catalogVersion: requiredNumber(
          presentField(
            lock,
            ["catalog_version", "catalogVersion"],
            `${at}.catalogVersion`,
          ),
          `${at}.catalogVersion`,
        ),
        works: requiredNumber(
          presentField(lock, ["works"], `${at}.works`),
          `${at}.works`,
        ),
      };
    }),
  };
}

/**
 * 网关知识库接口的错误正文是 `{code, message}`（不是自由文本），把它解出来。
 *
 * 为什么要 `code`：`package_not_found`（包没了）与 `unknown_credential` 一类**谁能修**完全不同，
 * 页面得照着给处置建议。解不出来（网关换了构建、正文被代理截断）就回 `null`，原文照常展示。
 */
export function parseKnowledgeErrorDetail(
  detail: string | undefined,
): { code: string; message: string } | null {
  if (!detail) return null;
  try {
    const parsed: unknown = JSON.parse(detail);
    if (typeof parsed !== "object" || parsed === null) return null;
    const body = parsed as Record<string, unknown>;
    if (typeof body.message !== "string") return null;
    return {
      code: typeof body.code === "string" ? body.code : "",
      message: body.message,
    };
  } catch {
    return null;
  }
}

/** 当前生效的知识库内容（空载时回 `configured: false`，**不是 503**）。 */
export async function fetchKnowledge(): Promise<KnowledgeView> {
  const payload = await requestJson<unknown>("/api/v1/admin/knowledge");
  return normalizeKnowledge(payload);
}

/** 录入过的知识库包（最近优先）。接口回的是**裸数组**（与安装包那条 `{packages:[]}` 不同）。 */
export async function fetchKnowledgePackages(): Promise<
  KnowledgePackageView[]
> {
  const payload = await requestJson<unknown>(
    "/api/v1/admin/knowledge/packages",
  );
  return requiredArray(payload, "knowledgePackages").map(
    normalizeKnowledgePackage,
  );
}

/** 单个包的明细（含副本里实际有哪些文件、是否还在）。 */
export async function fetchKnowledgePackage(
  packageId: string,
): Promise<KnowledgePackageView> {
  const payload = await requestJson<unknown>(
    `/api/v1/admin/knowledge/packages/${encodeURIComponent(packageId)}`,
  );
  return normalizeKnowledgePackage(payload);
}

/**
 * 录入一个知识库包。**不激活**，除非 `activate: true`。
 *
 * 网关先取包、再跑完整校验链（sha256 → manifest 自洽 → 装载器校验 → 签名），
 * 任一不过整次录入都不生效 —— 既不落库也不覆盖已有副本。
 */
export async function recordKnowledgePackage(
  command: RecordKnowledgePackageCommand,
): Promise<KnowledgePackageView> {
  const payload = await requestJson<unknown>(
    "/api/v1/admin/knowledge/packages",
    {
      method: "POST",
      body: JSON.stringify({
        source: command.source,
        sha256: command.sha256,
        activate: command.activate ?? false,
        requested_by: command.requestedBy,
      }),
    },
  );
  return normalizeKnowledgePackage(payload);
}

/** 切换生效指针（激活 / 回滚）。**先验后切**：装载校验失败就完全不动现状。 */
export async function activateKnowledgePackage(
  packageId: string,
  command: ActivateKnowledgePackageCommand = {},
): Promise<KnowledgePackageView> {
  const payload = await requestJson<unknown>(
    `/api/v1/admin/knowledge/packages/${encodeURIComponent(packageId)}/activate`,
    {
      method: "POST",
      body: JSON.stringify({
        reason: command.reason,
        requested_by: command.requestedBy,
      }),
    },
  );
  return normalizeKnowledgePackage(payload);
}

/** **谁还锁在旧版目录**：换版不追改在跑的工作，所以要看得见。 */
export async function fetchKnowledgeLocks(): Promise<KnowledgeLocksView> {
  const payload = await requestJson<unknown>("/api/v1/admin/knowledge/locks");
  return normalizeKnowledgeLocks(payload);
}
