import { Routes, Route, Navigate } from "react-router-dom";

import { AppLayout } from "./components/AppLayout";
import { SubsystemAdminHomePage } from "./components/SubsystemAdminHomePage";
import { SubsystemAgentInstallPage } from "./components/SubsystemAgentInstallPage";
import { SubsystemLinkUpstreamPage } from "./components/SubsystemLinkUpstreamPage";
import { SubsystemGatewayInfoPage } from "./components/SubsystemGatewayInfoPage";
import { SubsystemAgentPackagePage } from "./components/SubsystemAgentPackagePage";
import { SubsystemAgentHostMetricsPage } from "./components/SubsystemAgentHostMetricsPage";
import { SubsystemAgentPurposePage } from "./components/SubsystemAgentPurposePage";
import { SubsystemAgentHostListPage } from "./components/SubsystemAgentHostListPage";
import { SubsystemSoftwareInventoryPage } from "./components/SubsystemSoftwareInventoryPage";
import { SubsystemPipelinePage } from "./components/SubsystemPipelinePage";
import { SubsystemAgentWorkPage } from "./components/SubsystemAgentWorkPage";
import { SubsystemAgentLogsPage } from "./components/SubsystemAgentLogsPage";
import { SubsystemAgentUpgradePage } from "./components/SubsystemAgentUpgradePage";
import { SubsystemAgentFleetPage } from "./components/SubsystemAgentFleetPage";
import { SubsystemAgentRevocationPage } from "./components/SubsystemAgentRevocationPage";
import { SubsystemAgentUpgradeDetailPage } from "./components/SubsystemAgentUpgradeDetailPage";
import { SubsystemWorkListPage } from "./components/SubsystemWorkListPage";

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<SubsystemAdminHomePage />} />
        <Route path="/install" element={<SubsystemAgentInstallPage />} />
        <Route path="/gateway-info" element={<SubsystemGatewayInfoPage />} />
        <Route path="/install-package" element={<SubsystemAgentPackagePage />} />
        <Route
          path="/link-upstream"
          element={<SubsystemLinkUpstreamPage />}
        />
        {/* 旧入口一律留重定向，外部链接与书签不至于落到 404：
            「Gateway 初始化 / /gateway-init」（与已并入它的 /uplink、/agent-init）已改名
            「Gateway 信息 / /gateway-info」—— 它现在是**只读展示**，不再有录入动作；
            「初始化 Gateway / /init」已改名「链接上级 / /link-upstream」。
            （安装包已从该页拆回独立页 /install-package，见上。）
            （已去掉的 /control 页落到下方的 `*` → 回首页。） */}
        <Route path="/gateway-init" element={<Navigate to="/gateway-info" replace />} />
        <Route path="/uplink" element={<Navigate to="/gateway-info" replace />} />
        <Route path="/agent-init" element={<Navigate to="/gateway-info" replace />} />
        <Route path="/init" element={<Navigate to="/link-upstream" replace />} />
        <Route path="/hosts" element={<SubsystemAgentHostListPage />} />
        <Route path="/software" element={<SubsystemSoftwareInventoryPage />} />
        <Route path="/pipeline" element={<SubsystemPipelinePage />} />
        <Route path="/logs" element={<SubsystemAgentLogsPage />} />
        <Route path="/work" element={<SubsystemWorkListPage />} />
        <Route path="/upgrade" element={<SubsystemAgentUpgradePage />} />
        <Route path="/fleet" element={<SubsystemAgentFleetPage />} />
        <Route path="/revocations" element={<SubsystemAgentRevocationPage />} />
        <Route
          path="/upgrade/:planId"
          element={<SubsystemAgentUpgradeDetailPage />}
        />
        <Route
          path="/agents/:agentId/metrics"
          element={<SubsystemAgentHostMetricsPage />}
        />
        <Route
          path="/agents/:agentId/purpose"
          element={<SubsystemAgentPurposePage />}
        />
        <Route
          path="/agents/:agentId/work"
          element={<SubsystemAgentWorkPage />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
