import type {
  AgentClassification,
  AgentFactSummary,
  AgentLogRecord,
  AgentLogsView,
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

export interface AgentRuntimeStatusView {
  agentId: string;
  instanceId: string;
  version: string;
  status: "online" | "offline";
  health: "healthy" | "degraded" | "unhealthy";
  lastSeenAt: string;
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
 * `packageSha256` / `updatedAt` 为 null 表示从未在管理面设置过，
 * 此时生效的是网关内置的默认分发地址（地址仍会返回，便于页面直接展示）。
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
 * Agent 的数据面上送地址（管理面设置）。
 *
 * Agent 通过 TCP 把采集到的日志与指标上送到数据面的 `host:port`，
 * 网关把它渲染进之后新签发的 Agent 初始配置。
 *
 * `updatedAt` 为 null 表示从未在管理面设置过（此时 `host` 为空串），
 * 新安装的 Agent 只上报自身状态、不采集日志、也不向数据面上送；
 * `port` 始终有值，未设置时是约定的默认端口。
 */
export interface AgentUplink {
  settingId: string;
  host: string;
  port: number;
  updatedBy: string;
  updatedAt: string | null;
}

export interface SetAgentUplinkCommand {
  host: string;
  port: number;
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

export function normalizeAgentUplink(payload: any): AgentUplink {
  const setting = payload.uplink ?? payload;
  return {
    settingId: requiredString(
      setting.setting_id ?? setting.settingId,
      "agentUplink.settingId",
    ),
    host: requiredString(setting.host, "agentUplink.host"),
    port: requiredNumber(setting.port, "agentUplink.port"),
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
 * 设置 Agent 的数据面上送地址（管理面）。
 *
 * 主机不能为空，端口必须是 1–65535 的整数；不符合要求时后端返回 400 纯文本。
 * 设置只影响之后新签发的 Agent 初始配置，不影响已分发的 Agent。
 */
export async function setAgentUplink(
  command: SetAgentUplinkCommand,
): Promise<AgentUplink> {
  const payload = await requestJson<unknown>("/api/v1/admin/agent/uplink", {
    method: "POST",
    body: JSON.stringify({
      host: command.host,
      port: command.port,
      requested_by: command.requestedBy,
    }),
  });
  return normalizeAgentUplink(payload);
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

function requiredStringArray(value: unknown, fieldName: string): string[] {
  return requiredArray(value, fieldName).map((item, index) =>
    requiredString(item, `${fieldName}[${index}]`),
  );
}

/**
 * 机器类别是**闭合**取值（模型里的 variant）：认不出来就抛错，
 * 不静默渲染成一个没见过的类别名。
 */
function requiredMachineClass(value: unknown, fieldName: string): MachineClass {
  if (
    value === "MacDaily" ||
    value === "MacDev" ||
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

/** 规范化 `AgentWorkView`（`GET /api/v1/admin/agents/{agent_id}/work`）。 */
export function normalizeAgentWorkView(payload: any): AgentWorkView {
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
