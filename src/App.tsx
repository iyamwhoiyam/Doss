import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { Shell } from './components/Shell';
import { Loading } from './components/ui';
import { useSession } from './lib/session';
import { Login } from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const MyWork = lazy(() => import('./pages/MyWork').then((m) => ({ default: m.MyWork })));
const Production = lazy(() => import('./pages/Production').then((m) => ({ default: m.Production })));
const Schedule = lazy(() => import('./pages/Schedule').then((m) => ({ default: m.Schedule })));
const WorkOrderDetail = lazy(() => import('./pages/WorkOrderDetail').then((m) => ({ default: m.WorkOrderDetail })));
const Inventory = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.Inventory })));
const ItemDetail = lazy(() => import('./pages/ItemDetail').then((m) => ({ default: m.ItemDetail })));
const Purchasing = lazy(() => import('./pages/Purchasing').then((m) => ({ default: m.Purchasing })));
const VendorDetail = lazy(() => import('./pages/VendorDetail').then((m) => ({ default: m.VendorDetail })));
const PurchaseOrderDetail = lazy(() => import('./pages/PurchaseOrderDetail').then((m) => ({ default: m.PurchaseOrderDetail })));
const Development = lazy(() => import('./pages/Development').then((m) => ({ default: m.Development })));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail').then((m) => ({ default: m.ProjectDetail })));
const Formulations = lazy(() => import('./pages/Formulations').then((m) => ({ default: m.Formulations })));
const FormulaBuilder = lazy(() => import('./pages/FormulaBuilder').then((m) => ({ default: m.FormulaBuilder })));
const Quotes = lazy(() => import('./pages/Quotes').then((m) => ({ default: m.Quotes })));
const QuoteBuilder = lazy(() => import('./pages/QuoteBuilder').then((m) => ({ default: m.QuoteBuilder })));
const Labels = lazy(() => import('./pages/Labels').then((m) => ({ default: m.Labels })));
const Samples = lazy(() => import('./pages/Samples').then((m) => ({ default: m.Samples })));
const LabelReviewPage = lazy(() => import('./pages/LabelReviewPage').then((m) => ({ default: m.LabelReviewPage })));
const Rfqs = lazy(() => import('./pages/Rfqs').then((m) => ({ default: m.Rfqs })));
const Customers = lazy(() => import('./pages/Customers').then((m) => ({ default: m.Customers })));
const CustomerDetail = lazy(() => import('./pages/CustomerDetail').then((m) => ({ default: m.CustomerDetail })));
const Documents = lazy(() => import('./pages/Documents').then((m) => ({ default: m.Documents })));
const Orders = lazy(() => import('./pages/Orders').then((m) => ({ default: m.Orders })));
const OrderDetail = lazy(() => import('./pages/OrderDetail').then((m) => ({ default: m.OrderDetail })));
const Admin = lazy(() => import('./pages/Admin').then((m) => ({ default: m.Admin })));
const ApprovalPage = lazy(() => import('./pages/ApprovalPage').then((m) => ({ default: m.ApprovalPage })));
const PrintDoc = lazy(() => import('./pages/PrintDoc').then((m) => ({ default: m.PrintDoc })));

function Booting() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
      <div className="col-tight" style={{ alignItems: 'center' }}>
        <span className="spinner" style={{ width: 22, height: 22 }} />
        <span className="cell-sub">Opening Enova Ops…</span>
      </div>
    </div>
  );
}

export function App() {
  return (
    <Suspense fallback={<Booting />}>
      <Routes>
        {/* The customer approval page is public — no login, no app shell. */}
        <Route path="/approve/:token" element={<ApprovalPage />} />
        {/* Printable documents: signed-in, but no app shell so they print clean. */}
        <Route path="/print/:kind/:id" element={<PrintRoute />} />
        <Route path="/*" element={<AuthedApp />} />
      </Routes>
    </Suspense>
  );
}

function PrintRoute() {
  const { user, loading } = useSession();
  if (loading) return <Booting />;
  if (!user) return <Login />;
  return <PrintDoc />;
}

function AuthedApp() {
  const { user, loading } = useSession();

  if (loading) return <Booting />;
  if (!user) return <Login />;

  return (
    <Shell>
      <Suspense fallback={<div className="page"><Loading rows={7} /></div>}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/my-work" element={<MyWork />} />

          <Route path="/production" element={<Production />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/production/:id" element={<WorkOrderDetail />} />

          <Route path="/inventory" element={<Inventory />} />
          <Route path="/inventory/:id" element={<ItemDetail />} />

          <Route path="/purchasing" element={<Purchasing />} />
          <Route path="/purchasing/vendors/:id" element={<VendorDetail />} />
          <Route path="/purchasing/:id" element={<PurchaseOrderDetail />} />

          <Route path="/development" element={<Development />} />
          <Route path="/development/:id" element={<ProjectDetail />} />

          <Route path="/formulations" element={<Formulations />} />
          <Route path="/formulations/new" element={<FormulaBuilder />} />
          <Route path="/formulations/:id" element={<FormulaBuilder />} />

          <Route path="/quotes" element={<Quotes />} />
          <Route path="/quotes/:id" element={<QuoteBuilder />} />

          <Route path="/labels" element={<Labels />} />
          <Route path="/labels/:id" element={<LabelReviewPage />} />

          <Route path="/samples" element={<Samples />} />

          <Route path="/rfqs" element={<Rfqs />} />

          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/:id" element={<CustomerDetail />} />

          <Route path="/documents" element={<Documents />} />

          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:id" element={<OrderDetail />} />

          <Route path="/admin" element={<Admin />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Shell>
  );
}
