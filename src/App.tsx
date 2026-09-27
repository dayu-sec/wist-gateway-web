import { Routes, Route, Navigate } from "react-router-dom";

import { AppLayout } from "./components/AppLayout";
import { SubsystemAdminHomePage } from "./components/SubsystemAdminHomePage";
import { SubsystemAgentControlCenterPage } from "./components/SubsystemAgentControlCenterPage";
import { SubsystemAgentInstallPage } from "./components/SubsystemAgentInstallPage";
import { SubsystemLinkUpstreamPage } from "./components/SubsystemLinkUpstreamPage";
import { SubsystemGatewayInitializePage } from "./components/SubsystemGatewayInitializePage";
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
import { SubsystemAgentUpgradeDetailPage } from "./components/SubsystemAgentUpgradeDetailPage";
import { SubsystemWorkListPage } from "./components/SubsystemWorkListPage";

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<SubsystemAdminHomePage />} />
        <Route path="/control" element={<SubsystemAgentControlCenterPage />} />
        <Route path="/install" element={<SubsystemAgentInstallPage />} />
        <Route path="/gateway-init" element={<SubsystemGatewayInitializePage />} />
        <Route path="/install-package" element={<SubsystemAgentPackagePage />} />
        <Route
          path="/link-upstream"
          element={<SubsystemLinkUpstreamPage />}
        />
        {/* 旧入口一律留重定向，外部链接与书签不至于落到 404：
            「数据面上送地址」已并入「Gateway 初始化 / /gateway-init」；
            「初始化 Gateway / /init」已改名「链接上级 / /link-upstream」。
            （安装包已从 Gateway 初始化页拆回独立页 /install-package，见上。） */}
        <Route path="/uplink" element={<Navigate to="/gateway-init" replace />} />
        <Route path="/agent-init" element={<Navigate to="/gateway-init" replace />} />
        <Route path="/init" element={<Navigate to="/link-upstream" replace />} />
        <Route path="/hosts" element={<SubsystemAgentHostListPage />} />
        <Route path="/software" element={<SubsystemSoftwareInventoryPage />} />
        <Route path="/pipeline" element={<SubsystemPipelinePage />} />
        <Route path="/logs" element={<SubsystemAgentLogsPage />} />
        <Route path="/work" element={<SubsystemWorkListPage />} />
        <Route path="/upgrade" element={<SubsystemAgentUpgradePage />} />
        <Route path="/fleet" element={<SubsystemAgentFleetPage />} />
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
