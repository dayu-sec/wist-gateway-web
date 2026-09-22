import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ADMIN_AUTH_CHANGED_EVENT,
  fetchAgentHostMetrics,
  fetchAgentInstallCode,
  fetchAgentInstallPackage,
  fetchAgentOverview,
  fetchAgentPurpose,
  fetchAgentUplink,
  fetchAllAgentsHostMetrics,
  fetchPipelineTopology,
  getAdminApiToken,
  initializeGatewayViaUrl,
  setAgentInstallPackage,
  setAgentUplink,
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
 * 不轮询：事实摘要在内容变化时才上报（幂等键是 content_digest，不是 revision），
 * 建议只在事实或规则册变化时重算 —— 刷得比上报更快只会重复读到同一个值。
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
    // 未知 Agent 会回 404：重试只是白撞同一个错误，直接让页面渲染「未知 Agent」。
    retry: false,
  });
}

/** Gateway 初始化页面的显式提交动作；先检查状态，不自动轮询或重复消费一次性凭证。 */
export function useGatewayInitialConfig() {
  return useMutation({
    mutationFn: ({ initUrl, token }: { initUrl: string; token?: string }) =>
      initializeGatewayViaUrl(initUrl, token),
  });
}
