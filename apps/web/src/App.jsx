import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import BlastRadius from './pages/BlastRadius';
import ChangePlan from './pages/ChangePlan';
import RolloutPlan from './pages/RolloutPlan';
import ReleaseTag from './pages/ReleaseTag';
import RdsLifecycle from './pages/RdsLifecycle';
import LifecycleWizard from './pages/LifecycleWizard';
import FinOps from './pages/FinOps';
import Repos from './pages/Repos';
import Observability from './pages/Observability';
import Eol from './pages/Eol';
import Reports from './pages/Reports';
import Audit from './pages/Audit';
import Activity from './pages/Activity';
import Admin from './pages/Admin';
import DependencyHierarchy from './pages/DependencyHierarchy';
import InfraGraph from './pages/InfraGraph';
import ReleaseCompare from './pages/ReleaseCompare';
import { DEFAULT_MODULE_SLUG } from './config/blastRadiusModules';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="impact" element={<Navigate to={`/impact/${DEFAULT_MODULE_SLUG}`} replace />} />
          <Route path="impact/:moduleId" element={<BlastRadius />} />
          <Route path="dependencies" element={<DependencyHierarchy />} />
          <Route path="graph/infra" element={<InfraGraph />} />
          <Route path="graph/org" element={<Navigate to="/graph/infra?tab=patterns" replace />} />
          <Route path="release-compare" element={<ReleaseCompare />} />
          <Route path="plans/change" element={<ChangePlan />} />
          <Route path="plans/rollout" element={<RolloutPlan />} />
          <Route path="releases/:tagId" element={<ReleaseTag />} />
          <Route path="lifecycle/rds" element={<RdsLifecycle />} />
          <Route path="lifecycle/rds/wizard" element={<LifecycleWizard />} />
          <Route path="finops" element={<FinOps />} />
          <Route path="repos" element={<Repos />} />
          <Route path="observability" element={<Observability />} />
          <Route path="eol" element={<Eol />} />
          <Route path="reports" element={<Reports />} />
          <Route path="audit" element={<Audit />} />
          <Route path="activity" element={<Activity />} />
          <Route path="admin" element={<Admin />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
