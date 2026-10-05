import { useEffect, useState } from "react";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ADMIN_AUTH_CHANGED_EVENT,
  ApiError,
  activateKnowledgePackage,
  advanceRolloutPlan,
  approveRolloutPlan,
  classifyAgentPurpose,
  createRolloutPlan,
  deleteAgent,
  fetchAgentAdvertiseUrl,
  fetchAgentHostMetrics,
  fetchAgentInstallCode,
  fetchAgentInstallPackage,
  fetchAgentOverview,
  fetchAgentPurpose,
  fetchAgentRevocations,
  fetchAgentRuntimeStatus,
  fetchAgentSoftwareInventory,
  fetchAgentUplink,
  fetchAgentWork,
  fetchAllAgentsHostMetrics,
  fetchContentCatalog,
  fetchInstallPackages,
  fetchKnowledge,
  fetchKnowledgeLocks,
  fetchKnowledgePackages,
  fetchPipelineTopology,
  fetchRegisteredAgents,
  fetchRolloutPlan,
  fetchRolloutPlans,
  fetchSoftwareFleetInventory,
  getAdminApiToken,
  grantOneShotWork,
  grantStandingWork,
  liftAgentRevocation,
  pauseWork,
  recordKnowledgePackage,
  resumeWork,
  revokeAgent,
  revokeWork,
  setAgentAdvertiseUrl,
  setAgentInstallPackage,
  setAgentUplink,
  setGatewayLinkRequest,
  viewAgentLogs,
  viewGatewayLinkRequest,
  viewGatewayLinkdStatus,
  type ActivateKnowledgePackageCommand,
  type ClassifyAgentPurposeCommand,
  type CreateRolloutPlanCommand,
  type GrantOneShotWorkCommand,
  type GrantStandingWorkCommand,
  type RecordKnowledgePackageCommand,
  type SetAgentAdvertiseUrlCommand,
  type SetAgentInstallPackageCommand,
  type SetAgentUplinkCommand,
  type SetGatewayLinkRequestCommand,
} from "../api";

export function useAgentOverview() {
  // Re-render when the admin token changes so the query can transition from
  // disabled (no token) to enabled (token entered) and fetch immediately.
  const [, setAuthVersion] = useState(0);
  useEffect(() => {
    const onAuthChanged = () => setAuthVersion((version) => version + 1);
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () =>
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);
  // Do not poll before a token is entered: every unauth'ed request would
  // otherwise hit the admin's per-IP rate limiter (5 failures -> 60s block).
  const enabled = Boolean(getAdminApiToken());
  return useQuery({
    queryKey: ["agent-overview"],
    queryFn: fetchAgentOverview,
    enabled,
    refetchInterval: enabled ? 5_000 : false,
  });
}

export function useAgentHostMetrics(agentId: string) {
  const [, setAuthVersion] = useState(0);
  useEffect(() => {
    const onAuthChanged = () => setAuthVersion((version) => version + 1);
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () =>
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);
  const enabled = Boolean(getAdminApiToken()) && Boolean(agentId);
  return useQuery({
    queryKey: ["agent-host-metrics", agentId],
    queryFn: () => fetchAgentHostMetrics(agentId),
    enabled,
    refetchInterval: enabled ? 5_000 : false,
  });
}

export function useAllAgentsHostMetrics() {
  const [, setAuthVersion] = useState(0);
  useEffect(() => {
    const onAuthChanged = () => setAuthVersion((version) => version + 1);
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () =>
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);
  const enabled = Boolean(getAdminApiToken());
  return useQuery({
    queryKey: ["all-agents-host-metrics"],
    queryFn: fetchAllAgentsHostMetrics,
    enabled,
    refetchInterval: enabled ? 5_000 : false,
  });
}

/**
 * **已注册**的 Agent 清单（注册表口径，不是“有指标的 Agent”）。
 *
 * 机队索引页（升级 / 采集工作）用它当机队：待命 / 新装的 Agent 不上送指标，用主机指标列
 * 会让它们从页面上消失（也就无法被升级 / 派活）。所以两个口径要分开用：
 * 看指标用 `useAllAgentsHostMetrics`，选目标用本 hook。
 */
export function useRegisteredAgents() {
  const [, setAuthVersion] = useState(0);
  useEffect(() => {
    const onAuthChanged = () => setAuthVersion((version) => version + 1);
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () =>
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);
  const enabled = Boolean(getAdminApiToken());
  return useQuery({
    queryKey: ["registered-agents"],
    queryFn: () => fetchRegisteredAgents(),
    enabled,
    refetchInterval: enabled ? 5_000 : false,
  });
}

/**
 * 删除一台**离线** Agent（不可恢复）。成功后刷新机队列表 —— 删掉的那台要立刻消失。
 *
 * 只失效 `registered-agents`（机队页的唯一数据源）；没有其它页缓存这份列表的派生量。
 */
export function useDeleteAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => deleteAgent(agentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["registered-agents"] });
    },
  });
}

/**
 * 网关**已录入**的安装包历史。升级页从这里选包（而不是手输地址 + 摘要）；
 * 包只在「安装包」页录入时变化，所以不轮询。
 */
export function useInstallPackages() {
  const [, setAuthVersion] = useState(0);
  useEffect(() => {
    const onAuthChanged = () => setAuthVersion((version) => version + 1);
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () =>
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);
  const enabled = Boolean(getAdminApiToken());
  return useQuery({
    queryKey: ["install-packages"],
    queryFn: fetchInstallPackages,
    enabled,
    // 401（token 无效）是确定性的，重试只是白撞同一个错误，直接让页面提示重新填 token。
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 401) return false;
      return failureCount < 3;
    },
  });
}

export function useAgentInstallCode() {
  return useQuery({
    queryKey: ["agent-install-code"],
    queryFn: fetchAgentInstallCode,
  });
}

/**
 * 数据采集吞吐。轮询 30s —— 数据面写入 VM 的粒度实测是 60 秒，
 * 刷得比它更快只会重复读到同一个值。
 */
export function usePipelineTopology(windowSeconds = 1800) {
  const [, setAuthVersion] = useState(0);
  useEffect(() => {
    const onAuthChanged = () => setAuthVersion((version) => version + 1);
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () =>
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);
  const enabled = Boolean(getAdminApiToken());
  return useQuery({
    queryKey: ["pipeline-topology", windowSeconds],
    queryFn: () => fetchPipelineTopology(windowSeconds),
    enabled,
    refetchInterval: enabled ? 30_000 : false,
  });
}

/**
 * 当前生效的 Agent 安装包地址。设置项不轮询：值只在管理面变更时变化，
 * 保存成功后由 useSetAgentInstallPackage 失效重取。
 */
export function useAgentInstallPackage() {
  const [, setAuthVersion] = useState(0);
  useEffect(() => {
    const onAuthChanged = () => setAuthVersion((version) => version + 1);
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () =>
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);
  const enabled = Boolean(getAdminApiToken());
  return useQuery({
    queryKey: ["agent-install-package"],
    queryFn: fetchAgentInstallPackage,
    enabled,
  });
}

/** 保存 Agent 安装包地址；成功后刷新当前生效值。 */
export function useSetAgentInstallPackage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: SetAgentInstallPackageCommand) =>
      setAgentInstallPackage(command),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agent-install-package"] });
    },
  });
}

/**
 * 当前生效的数据面上送目标（管理面设置值，没设过则是部署配置派生的值）。
 * 同样不轮询：值只在管理面变更时变化，保存成功后由 useSetAgentUplink 失效重取。
 */
export function useAgentUplink() {
  const [, setAuthVersion] = useState(0);
  useEffect(() => {
    const onAuthChanged = () => setAuthVersion((version) => version + 1);
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () =>
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);
  const enabled = Boolean(getAdminApiToken());
  return useQuery({
    queryKey: ["agent-uplink"],
    queryFn: fetchAgentUplink,
    enabled,
  });
}

/**
 * 保存数据面上送目标与开关（覆盖派生值）；成功后刷新当前生效值。
 *
 * **失败也要刷新**：失败不等于没生效 —— 服务端可能已经写了、只是响应没回来，
 * 或者响应不合当前契约而解析报错。不刷的话，页面上方那张只读卡会一直显示旧值
 * （且“已保存”的提示与它并排），人就会以为没改成 —— 而开关是个影响全队的动作，
 * 它的真实值必须以服务端为准。
 */
export function useSetAgentUplink() {
  const queryClient = useQueryClient();
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["agent-uplink"] });
  return useMutation({
    mutationFn: (command: SetAgentUplinkCommand) => setAgentUplink(command),
    onSuccess: refresh,
    onError: refresh,
  });
}

/**
 * 当前生效的网关对外地址（管理面设置值 + 未设置时的配置文件回落值）。
 * 同样不轮询：值只在管理面变更时变化，保存成功后由 useSetAgentAdvertiseUrl 失效重取。
 */
export function useAgentAdvertiseUrl() {
  const [, setAuthVersion] = useState(0);
  useEffect(() => {
    const onAuthChanged = () => setAuthVersion((version) => version + 1);
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () =>
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);
  const enabled = Boolean(getAdminApiToken());
  return useQuery({
    queryKey: ["agent-advertise-url"],
    queryFn: fetchAgentAdvertiseUrl,
    enabled,
  });
}

/** 保存网关对外地址；成功后刷新当前生效值。 */
export function useSetAgentAdvertiseUrl() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: SetAgentAdvertiseUrlCommand) =>
      setAgentAdvertiseUrl(command),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agent-advertise-url"] });
    },
  });
}

/**
 * 某台 Agent 的用途（事实 / 推断 / 判定三分并列）。
 *
 * 不轮询：事实摘要由 agentd 按周期上报（`duplicate` 时只刷留痕，内容与幂等键不动），
 * 建议只在内容或规则册变化时重算 —— 刷得比上报更快只会重复读到同一个值。
 * 需要重取时用右上角的「刷新」。
 */
export function useAgentPurpose(agentId: string) {
  const [, setAuthVersion] = useState(0);
  useEffect(() => {
    const onAuthChanged = () => setAuthVersion((version) => version + 1);
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () =>
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);
  const enabled = Boolean(getAdminApiToken()) && Boolean(agentId);
  return useQuery({
    queryKey: ["agent-purpose", agentId],
    queryFn: () => fetchAgentPurpose(agentId),
    enabled,
    // 401（token 无效）与 404（未知 Agent）是确定性的，重试只是白撞同一个错误，
    // 直接让页面渲染「未知 Agent / 请重新填 token」。
    // 其它错误（500、网络抖动）沿用仓库默认的重试策略（3 次 + 指数退避），
    // 不要把瞬时故障也变成立刻报错、必须手点刷新。
    retry: (failureCount, error) => {
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 404)
      ) {
        return false;
      }
      return failureCount < 3;
    },
  });
}

/** 提交「接入请求」到本机网关（页面发起接入）。 */
export function useSetGatewayLinkRequest() {
  const queryClient = useQueryClient();
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["gateway-link-request"] });
  return useMutation({
    mutationFn: (command: SetGatewayLinkRequestCommand) =>
      setGatewayLinkRequest(command),
    onSuccess: refresh,
    onError: refresh,
  });
}

/** 轮询接入请求状态（页面显示进度；仅在有管理凭证时）。 */
export function useGatewayLinkRequest() {
  const [, setAuthVersion] = useState(0);
  useEffect(() => {
    const onAuthChanged = () => setAuthVersion((version) => version + 1);
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () =>
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);
  const enabled = Boolean(getAdminApiToken());
  return useQuery({
    queryKey: ["gateway-link-request"],
    queryFn: viewGatewayLinkRequest,
    enabled,
    // 非终态才轮询；Connected / Failed 后停（避免白跑）。
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "Connected" || status === "Failed") return false;
      return enabled ? 5000 : false;
    },
  });
}

/** 轮询 gwlinkd 状态（宿主侧常驻是否在跑；**持续观测**，永远轮询）。 */
export function useGatewayLinkdStatus() {
  const [, setAuthVersion] = useState(0);
  useEffect(() => {
    const onAuthChanged = () => setAuthVersion((version) => version + 1);
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () =>
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);
  const enabled = Boolean(getAdminApiToken());
  return useQuery({
    queryKey: ["gateway-linkd-status"],
    queryFn: viewGatewayLinkdStatus,
    enabled,
    refetchInterval: enabled ? 5000 : false,
  });
}

/**
 * 某台机器的 L1a 机械资产清单。
 *
 * 不轮询：清单是事实摘要的投影，只在 Agent 重新上报摘要时**覆盖式重建**。
 * 需要重取时用右上角「刷新」。404（未知 Agent）是确定性的，重试只是白撞。
 */
export function useAgentSoftwareInventory(agentId: string) {
  const [, setAuthVersion] = useState(0);
  useEffect(() => {
    const onAuthChanged = () => setAuthVersion((version) => version + 1);
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () =>
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);
  const enabled = Boolean(getAdminApiToken()) && Boolean(agentId);
  return useQuery({
    queryKey: ["agent-software", agentId],
    queryFn: () => fetchAgentSoftwareInventory(agentId),
    enabled,
    retry: (failureCount, error) => {
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 404)
      ) {
        return false;
      }
      return failureCount < 3;
    },
  });
}

/**
 * 按软件聚合的机队清单。
 *
 * 同样不轮询：这份视图完全由各机器的上报派生，刷新频率跟着 Agent 上报走
 * （其余视图每 5 秒拉一次是看实时负载，这张清单没有那个语义）。
 */
export function useSoftwareFleetInventory(limit = 100) {
  const [, setAuthVersion] = useState(0);
  useEffect(() => {
    const onAuthChanged = () => setAuthVersion((version) => version + 1);
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () =>
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);
  const enabled = Boolean(getAdminApiToken());
  return useQuery({
    queryKey: ["software-fleet", limit],
    queryFn: () => fetchSoftwareFleetInventory(limit),
    enabled,
  });
}

/**
 * 某台 Agent 手上的工作（生效中的常驻工作 + 未了结的一次性工作 + 历史留痕）。
 *
 * 不轮询：工作由管理面**人工**授权/暂停/撤回，值只在这些操作时变化；
 * 但 Agent 的确认（ack）随后才到（它按 30s 的节拍拉快照），所以每个操作成功后
 * 都失效这份查询 —— 让「派下去的活到了没有」在页面上可见。
 */
export function useAgentWork(agentId: string) {
  const [, setAuthVersion] = useState(0);
  useEffect(() => {
    const onAuthChanged = () => setAuthVersion((version) => version + 1);
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () =>
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);
  const enabled = Boolean(getAdminApiToken()) && Boolean(agentId);
  return useQuery({
    queryKey: ["agent-work", agentId],
    queryFn: () => fetchAgentWork(agentId),
    enabled,
    retry: (failureCount, error) => {
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 404)
      ) {
        return false;
      }
      return failureCount < 3;
    },
  });
}

/**
 * 单台 Agent 的运行态（含**实际生效**的数据面上送状态）。
 *
 * 与工作页其它查询同一口径：401（token 无效）与 404（未知 Agent）是确定性的，不重试。
 * 数据是 agent 按节拍上报后落库的（网关现算不了），所以只读一次、靠右上角「刷新」重取。
 */
export function useAgentRuntimeStatus(agentId: string) {
  const [, setAuthVersion] = useState(0);
  useEffect(() => {
    const onAuthChanged = () => setAuthVersion((version) => version + 1);
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () =>
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);
  const enabled = Boolean(getAdminApiToken()) && Boolean(agentId);
  return useQuery({
    queryKey: ["agent-runtime-status", agentId],
    queryFn: () => fetchAgentRuntimeStatus(agentId),
    enabled,
    retry: (failureCount, error) => {
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 404)
      ) {
        return false;
      }
      return failureCount < 3;
    },
  });
}

/** 拒绝名单（吊销状态表，§5.6）：哪些 `agent_id` 被切断。 */
export function useAgentRevocations() {
  const [, setAuthVersion] = useState(0);
  useEffect(() => {
    const onAuthChanged = () => setAuthVersion((version) => version + 1);
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () =>
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);
  const enabled = Boolean(getAdminApiToken());
  return useQuery({
    queryKey: ["agent-revocations"],
    queryFn: fetchAgentRevocations,
    enabled,
    // 401（token 无效）是确定性的，重试只是白撞同一个错误，直接让页面提示重新填 token。
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 401) return false;
      return failureCount < 3;
    },
  });
}

/** 把一台 Agent 加入拒绝名单（吊销）。
 *
 * 以 `{ agentId, reasonCode }` 为变量（而不是在 hook 上绑定 agentId）：单台面板与
 * 拒绝名单列表页共用同一个 hook。
 */
export function useRevokeAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: { agentId: string; reasonCode: string }) =>
      revokeAgent(command.agentId, command.reasonCode),
    onSuccess: (_created, command) => {
      invalidateRevocationState(queryClient, command.agentId);
    },
  });
}

/** 从拒绝名单移除（解除吊销）。变量是 `agentId`。 */
export function useLiftAgentRevocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => liftAgentRevocation(agentId),
    onSuccess: (_lifted, agentId) => {
      invalidateRevocationState(queryClient, agentId);
    },
  });
}

/** 吊销状态一变，这三份查询都要重取：名单、该台的运行态（`revoked` 布尔）、机队列表。 */
function invalidateRevocationState(queryClient: QueryClient, agentId: string) {
  void queryClient.invalidateQueries({ queryKey: ["agent-revocations"] });
  void queryClient.invalidateQueries({
    queryKey: ["agent-runtime-status", agentId],
  });
  void queryClient.invalidateQueries({ queryKey: ["registered-agents"] });
}

/** 采集内容目录（模板 + 各平台各面的就绪度）：派活表单的取值空间来自它。 */
export function useContentCatalog() {
  const [, setAuthVersion] = useState(0);
  useEffect(() => {
    const onAuthChanged = () => setAuthVersion((version) => version + 1);
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () =>
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);
  const enabled = Boolean(getAdminApiToken());
  return useQuery({
    queryKey: ["content-catalog"],
    queryFn: fetchContentCatalog,
    enabled,
    // 内容目录是启动时装载的策展数据（改内容要重启网关），没必要轮询。
    retry: (failureCount, error) => {
      // 503 = 未配 `[content]`：这是「未装载」而不是故障，别重试。
      if (error instanceof ApiError && error.status === 503) return false;
      return failureCount < 3;
    },
  });
}

/**
 * 网关主机上的采集日志（文件尾部窗口，最新 N 条）。
 *
 * 不轮询：日志由数据面写入 NDJSON 文件后由网关读出来，刷新频率跟着采集走，
 * 而 `refetchInterval` 只会重复读到同一窗内容。需要重取时用右上角「刷新」
 * （它会失效所有查询）。
 *
 * `family`（采集面）与 `agentId` 一样进 queryKey：换面就是换一份数据，不能拿上一个面的
 * 缓存顶替。两者都参与缓存键，任一变化都要重新读文件尾窗。
 */
export function useAgentLogs(
  agentId: string | undefined,
  family: string | undefined,
  limit: number,
) {
  const [, setAuthVersion] = useState(0);
  useEffect(() => {
    const onAuthChanged = () => setAuthVersion((version) => version + 1);
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () =>
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);
  const enabled = Boolean(getAdminApiToken());
  return useQuery({
    queryKey: ["agent-logs", agentId ?? "", family ?? "", limit],
    queryFn: () =>
      viewAgentLogs({
        agentId: agentId || undefined,
        family: family || undefined,
        limit,
      }),
    enabled,
  });
}

/** 授权/更新一份常驻工作；成功后刷新这台机器的工作视图。 */
export function useGrantStandingWork(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: GrantStandingWorkCommand) =>
      grantStandingWork(agentId, command),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agent-work", agentId] });
    },
  });
}

/** 派一件一次性工作；成功后刷新工作视图。 */
export function useGrantOneShotWork(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: GrantOneShotWorkCommand) =>
      grantOneShotWork(agentId, command),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agent-work", agentId] });
    },
  });
}

/**
 * 对一份工作做暂停/恢复/撤回。
 *
 * 三个动作合成一个 mutation（而不是三个 hook）：它们在页面上是**同一组按钮**，
 * 失败提示与刷新策略也完全一样，拆开只会让调用方多写三份重复样板。
 */
export function useWorkAction(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: {
      kind: "pause" | "resume" | "revoke";
      workId: string;
      reasonCode?: string;
    }) => {
      switch (action.kind) {
        case "pause":
          return pauseWork(agentId, action.workId);
        case "resume":
          return resumeWork(agentId, action.workId);
        case "revoke":
          return revokeWork(agentId, action.workId, action.reasonCode ?? "");
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agent-work", agentId] });
    },
  });
}

/** 归档用途判定（采集范围变更的前置）；成功后刷新用途视图。 */
export function useClassifyAgentPurpose(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: ClassifyAgentPurposeCommand) =>
      classifyAgentPurpose(agentId, command),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agent-purpose", agentId] });
      // 判定是派活的前置：判完这台机器「能不能派活」就变了，一并刷新。
      void queryClient.invalidateQueries({ queryKey: ["agent-work", agentId] });
    },
  });
}

/**
 * 灰度发布计划列表（模型 `Control.Rollout`）。
 *
 * 不轮询：计划只在管理面操作（创建/批准/推进）时变化，而这些操作的 mutation
 * 会失效这份查询。需要重取时用右上角「刷新」。
 */
export function useRolloutPlans() {
  const [, setAuthVersion] = useState(0);
  useEffect(() => {
    const onAuthChanged = () => setAuthVersion((version) => version + 1);
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () =>
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);
  const enabled = Boolean(getAdminApiToken());
  return useQuery({
    queryKey: ["rollout-plans"],
    queryFn: fetchRolloutPlans,
    enabled,
  });
}

/**
 * 一份计划及其逐台进度。
 *
 * 不轮询：条目状态由 agentd 上报回填（`ReportWorkResult`），而 Agent 按 30 秒的
 * 节拍拉快照 —— 提交批准/推进后会失效重取；要看最新进度用右上角「刷新」。
 * 404（未知计划）是确定性的，重试只是白撞同一个错误。
 */
export function useRolloutPlan(planId: string) {
  const [, setAuthVersion] = useState(0);
  useEffect(() => {
    const onAuthChanged = () => setAuthVersion((version) => version + 1);
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () =>
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);
  const enabled = Boolean(getAdminApiToken()) && Boolean(planId);
  return useQuery({
    queryKey: ["rollout-plan", planId],
    queryFn: () => fetchRolloutPlan(planId),
    enabled,
    retry: (failureCount, error) => {
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 404)
      ) {
        return false;
      }
      return failureCount < 3;
    },
  });
}

/** 创建一份计划；成功后刷新计划列表。 */
export function useCreateRolloutPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: CreateRolloutPlanCommand) => createRolloutPlan(command),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rollout-plans"] });
    },
  });
}

/**
 * 批准 / 推进一份计划。
 *
 * 两个动作合成一个 mutation（而不是两个 hook）：它们在详情页上是**相邻的两个按钮**，
 * 失败提示与刷新策略完全一样，拆开只会让调用方多写两份重复样板。
 */
export function useRolloutPlanAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: { kind: "approve" | "advance"; planId: string }) =>
      action.kind === "approve"
        ? approveRolloutPlan(action.planId)
        : advanceRolloutPlan(action.planId),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["rollout-plans"] });
      void queryClient.invalidateQueries({
        queryKey: ["rollout-plan", variables.planId],
      });
    },
  });
}

/**
 * 知识库三张查询（生效态 / 录入历史 / 锁旧版）共用的一段准备。
 *
 * 三者都是**管理面状态**：只在录入或激活时变化，不轮询；401（token 无效）是确定性错误，
 * 重试只是白撞同一个错误，直接让页面提示重新填 token。
 */
function useKnowledgeQueryEnabled(): boolean {
  const [, setAuthVersion] = useState(0);
  useEffect(() => {
    const onAuthChanged = () => setAuthVersion((version) => version + 1);
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
    return () =>
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);
  return Boolean(getAdminApiToken());
}

function knowledgeRetry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status === 401) return false;
  return failureCount < 3;
}

/**
 * 当前生效的知识库内容。**空载不是错误**：回 `configured: false` + `hint`，页面据此给「怎么办」。
 */
export function useKnowledge() {
  const enabled = useKnowledgeQueryEnabled();
  return useQuery({
    queryKey: ["knowledge"],
    queryFn: fetchKnowledge,
    enabled,
    retry: knowledgeRetry,
  });
}

/** 录入过的知识库包（最近优先）。页面从这份存档里激活 / 回滚。 */
export function useKnowledgePackages() {
  const enabled = useKnowledgeQueryEnabled();
  return useQuery({
    queryKey: ["knowledge-packages"],
    queryFn: fetchKnowledgePackages,
    enabled,
    retry: knowledgeRetry,
  });
}

/** **谁还锁在旧版目录**：换版不追改在跑的工作，所以要看得见。 */
export function useKnowledgeLocks() {
  const enabled = useKnowledgeQueryEnabled();
  return useQuery({
    queryKey: ["knowledge-locks"],
    queryFn: fetchKnowledgeLocks,
    enabled,
    retry: knowledgeRetry,
  });
}

/**
 * 录入一个知识库包（缺省**不激活**）。
 *
 * 三个 key 一起失效：录入会落一个新包（历史 +1），`activate: true` 时还会连带切换生效态
 * 与锁旧版的分组；即使这次没激活，空载提示也不变，多失效一次只是白跑一趟查询。
 */
export function useRecordKnowledgePackage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: RecordKnowledgePackageCommand) =>
      recordKnowledgePackage(command),
    onSuccess: () => invalidateKnowledge(queryClient),
  });
}

/** 激活 / 回滚到某一版（`reason` 区分，两者同一条接口）。 */
export function useActivateKnowledgePackage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      packageId: string;
      command?: ActivateKnowledgePackageCommand;
    }) => activateKnowledgePackage(variables.packageId, variables.command),
    onSuccess: () => invalidateKnowledge(queryClient),
  });
}

function invalidateKnowledge(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["knowledge"] });
  void queryClient.invalidateQueries({ queryKey: ["knowledge-packages"] });
  void queryClient.invalidateQueries({ queryKey: ["knowledge-locks"] });
}
