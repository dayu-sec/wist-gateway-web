import { useParams } from "react-router-dom";
import { AgentPageHeader } from "./AgentPageHeader";
import { ResponseLaunchPanel } from "./ResponseLaunchPanel";
import { t } from "../i18n";

/**
 * 单机「响应」页：`/agents/:agentId/response`。
 *
 * 为什么在这一页也放一份（主机列表的「发起响应」已经有了）：处置的**起点是一台具体的机器** ——
 * 在「主机指标」看到盘满了，下一步就该在同一页头下点「响应」，而不是回列表再找回这台机器。
 * 两处共用同一个面板，参数与流程只有一套。
 */
export function SubsystemAgentResponsePage() {
  const { agentId = "" } = useParams();
  return (
    <>
      <AgentPageHeader agentId={agentId} active="response">
        {t(
          "先预览（只读）扫出要清理的东西，再提交清理进审批。预览也走响应授权，所以这台机器需要有生效中的授权单。",
          "Preview (read-only) lists what would be removed; then submit the cleanup for approval. Preview is a response too, so the agent needs an active response grant.",
        )}
      </AgentPageHeader>
      <ResponseLaunchPanel agentId={agentId} embedded />
    </>
  );
}
