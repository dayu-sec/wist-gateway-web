import { Routes, Route, Navigate } from "react-router-dom";

import { AppLayout } from "./components/AppLayout";
import { SubsystemAdminHomePage } from "./components/SubsystemAdminHomePage";
import { SubsystemAgentControlCenterPage } from "./components/SubsystemAgentControlCenterPage";
import { SubsystemAgentInstallPage } from "./components/SubsystemAgentInstallPage";
import { SubsystemAgentInstallPackagePage } from "./components/SubsystemAgentInstallPackagePage";
import { SubsystemAgentUplinkPage } from "./components/SubsystemAgentUplinkPage";
import { SubsystemGatewayInitializePage } from "./components/SubsystemGatewayInitializePage";
import { SubsystemAgentHostMetricsPage } from "./components/SubsystemAgentHostMetricsPage";
import { SubsystemAgentPurposePage } from "./components/SubsystemAgentPurposePage";
import { SubsystemAgentHostListPage } from "./components/SubsystemAgentHostListPage";
import { SubsystemSoftwareInventoryPage } from "./components/SubsystemSoftwareInventoryPage";
import { SubsystemPipelinePage } from "./components/SubsystemPipelinePage";
import { SubsystemAgentWorkPage } from "./components/SubsystemAgentWorkPage";
import { SubsystemAgentLogsPage } from "./components/SubsystemAgentLogsPage";
import { SubsystemRolloutPlansPage } from "./components/SubsystemRolloutPlansPage";
import { SubsystemRolloutPlanDetailPage } from "./components/SubsystemRolloutPlanDetailPage";

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<SubsystemAdminHomePage />} />
        <Route path="/control" element={<SubsystemAgentControlCenterPage />} />
        <Route path="/install" element={<SubsystemAgentInstallPage />} />
        <Route
          path="/install-package"
          element={<SubsystemAgentInstallPackagePage />}
        />
        <Route path="/uplink" element={<SubsystemAgentUplinkPage />} />
        <Route path="/init" element={<SubsystemGatewayInitializePage />} />
        <Route path="/hosts" element={<SubsystemAgentHostListPage />} />
        <Route path="/software" element={<SubsystemSoftwareInventoryPage />} />
        <Route path="/pipeline" element={<SubsystemPipelinePage />} />
        <Route path="/logs" element={<SubsystemAgentLogsPage />} />
        <Route path="/rollout" element={<SubsystemRolloutPlansPage />} />
        <Route
          path="/rollout/:planId"
          element={<SubsystemRolloutPlanDetailPage />}
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
