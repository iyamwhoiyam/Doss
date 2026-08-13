import { Navigate, Route, Routes } from 'react-router-dom';
import Shell from './components/Shell';
import { SessionProvider, useSession } from './lib/session';
import CannedJobs from './pages/CannedJobs';
import Customers from './pages/Customers';
import Login from './pages/Login';
import ProjectDetail from './pages/ProjectDetail';
import Projects from './pages/Projects';

function Gate() {
  const { session, loading } = useSession();
  if (loading) return <div className="boot">Loading…</div>;
  if (!session) return <Login />;
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/canned-jobs" element={<CannedJobs />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
    </Shell>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <Gate />
    </SessionProvider>
  );
}
