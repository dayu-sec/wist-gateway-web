import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ADMIN_AUTH_CHANGED_EVENT,
  ApiError,
  classifyAgentPurpose,
  fetchAgentHostMetrics,
  fetchAgentInstallCode,
  fetchAgentInstallPackage,
  fetchAgentOverview,
  fetchAgentPurpose,
  fetchAgentSoftwareInventory,
  fetchAgentUplink,
  fetchAgentWork,
  fetchAllAgentsHostMetrics,
  fetchContentCatalog,
  fetchPipelineTopology,
  fetchSoftwareFleetInventory,
  getAdminApiToken,
  grantOneShotWork,
  grantStandingWork,
  initializeGatewayViaUrl,
  pauseWork,
  resumeWork,
  revokeWork,
  setAgentInstallPackage,
  setAgentUplink,
  viewAgentLogs,
  type ClassifyAgentPurposeCommand,
  type GrantOneShotWorkCommand,
  type GrantStandingWorkCommand,
  type SetAgentInstallPackageCommand,
  type SetAgentUplinkCommand,
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
 * 当前生效的数据面上送地址。同样不轮询：值只在管理面变更时变化，
 * 保存成功后由 useSetAgentUplink 失效重取。
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

/** 保存数据面上送地址；成功后刷新当前生效值。 */
export function useSetAgentUplink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: SetAgentUplinkCommand) => setAgentUplink(command),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agent-uplink"] });
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

/** Gateway 初始化页面的显式提交动作；先检查状态，不自动轮询或重复消费一次性凭证。 */
export function useGatewayInitialConfig() {
  return useMutation({
    mutationFn: ({ initUrl, token }: { initUrl: string; token?: string }) =>
      initializeGatewayViaUrl(initUrl, token),
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
