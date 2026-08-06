import { Routes, Route, Navigate } from 'react-router-dom';
import { useSession } from './lib/session';
import Shell from './components/Shell';
import Login from './pages/Login';
import MyDay from './pages/MyDay';
import Orders from './pages/Orders';
import OrderDetail from './pages/OrderDetail';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import DataQuality from './pages/DataQuality';
import Inventory from './pages/Inventory';
import Shipments from './pages/Shipments';
import Activity from './pages/Activity';

export default function App() {
  const { session, loading } = useSession();

  if (loading) {
    return (
      <div className="boot">
        <div className="boot__mark">E</div>
        Loading Enova AMP…
      </div>
    );
  }

  if (!session) return <Login />;

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<MyDay />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/:ref" element={<OrderDetail />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:pn" element={<ProjectDetail />} />
        <Route path="/data-quality" element={<DataQuality />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/shipments" element={<Shipments />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
