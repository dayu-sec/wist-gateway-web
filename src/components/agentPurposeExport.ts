import type { AgentFactSummary } from "../types";

/**
 * 「复制为 JSON」用的载荷：**与后端 `fact_summary` 同形**（snake_case、同一组字段）。
 *
 * 为什么不用视图模型的 camelCase 原样 `JSON.stringify`：
 *   粘出去的东西多半是给别人做比对/入库用的，字段名应当能与 `GET /api/v1/admin/agents/{id}/purpose`
 *   的响应、以及数据库 `agent_fact_summary` 的列对得上 —— 少一层「页面用的名字」的翻译。
 *
 * 为什么显式列字段、并固定顺序：`JSON.stringify` 的顺序取决于对象构造顺序，显式写死才稳定，
 * 也顺便把「哪些字段算这份摘要」这件事收在一处（新增字段时会在这里被看见）。
 *
 * 空值如实保留（旧版 agentd 不带 host_id / host_name / network_addresses，它们的值为 `""` / `[]`），
 * 不 omit：省略会让人分不清「没有这项」和「这项是空」。
 */
export function factSummaryExport(factSummary: AgentFactSummary): string {
  return JSON.stringify(
    {
      agent_id: factSummary.agentId,
      content_digest: factSummary.contentDigest,
      revision: factSummary.revision,
      observed_at: factSummary.observedAt,
      received_at: factSummary.receivedAt,
      os: factSummary.os,
      arch: factSummary.arch,
      process_count: factSummary.processCount,
      process_executables: factSummary.processExecutables,
      packages: factSummary.packages,
      listen_ports: factSummary.listenPorts,
      host_id: factSummary.hostId,
      host_name: factSummary.hostName,
      network_addresses: factSummary.networkAddresses,
    },
    null,
    2,
  );
}
