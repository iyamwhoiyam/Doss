import { Suspense, lazy, useEffect } from 'react';

import { page, preloadAllRoutes } from './lib/routes';
import { Navigate, Route, Routes } from 'react-router-dom';

import { Shell } from './components/Shell';
import { Loading } from './components/ui';
import { useSession } from './lib/session';
import { Login } from './pages/Login';

const Dashboard = page('/', (m) => m.Dashboard as typeof import('./pages/Dashboard').Dashboard);
const MyWork = page('/my-work', (m) => m.MyWork as typeof import('./pages/MyWork').MyWork);
const Reports = page('/reports', (m) => m.Reports as typeof import('./pages/Reports').Reports);
const Activity = page('/activity', (m) => m.Activity as typeof import('./pages/Activity').Activity);
const Production = page('/production', (m) => m.Production as typeof import('./pages/Production').Production);
const Schedule = page('/schedule', (m) => m.Schedule as typeof import('./pages/Schedule').Schedule);
const Planning = page('/planning', (m) => m.Planning as typeof import('./pages/Planning').Planning);
const Routings = page('/routings', (m) => m.Routings as typeof import('./pages/Routings').Routings);
const WorkOrderDetail = page('/production/:id', (m) => m.WorkOrderDetail as typeof import('./pages/WorkOrderDetail').WorkOrderDetail);
const Inventory = page('/inventory', (m) => m.Inventory as typeof import('./pages/Inventory').Inventory);
const ItemDetail = page('/inventory/:id', (m) => m.ItemDetail as typeof import('./pages/ItemDetail').ItemDetail);
const CountSheet = page('/inventory/counts/:id', (m) => m.CountSheet as typeof import('./pages/CountSheet').CountSheet);
const Purchasing = page('/purchasing', (m) => m.Purchasing as typeof import('./pages/Purchasing').Purchasing);
const VendorDetail = page('/purchasing/vendors/:id', (m) => m.VendorDetail as typeof import('./pages/VendorDetail').VendorDetail);
const PurchaseOrderDetail = page('/purchasing/:id', (m) => m.PurchaseOrderDetail as typeof import('./pages/PurchaseOrderDetail').PurchaseOrderDetail);
const Development = page('/development', (m) => m.Development as typeof import('./pages/Development').Development);
const ProjectDetail = page('/development/:id', (m) => m.ProjectDetail as typeof import('./pages/ProjectDetail').ProjectDetail);
const Formulations = page('/formulations', (m) => m.Formulations as typeof import('./pages/Formulations').Formulations);
const FormulaBuilder = page('/formulations/:id', (m) => m.FormulaBuilder as typeof import('./pages/FormulaBuilder').FormulaBuilder);
const Quotes = page('/quotes', (m) => m.Quotes as typeof import('./pages/Quotes').Quotes);
const QuoteBuilder = page('/quotes/:id', (m) => m.QuoteBuilder as typeof import('./pages/QuoteBuilder').QuoteBuilder);
const Labels = page('/labels', (m) => m.Labels as typeof import('./pages/Labels').Labels);
const Samples = page('/samples', (m) => m.Samples as typeof import('./pages/Samples').Samples);
const LabelReviewPage = page('/labels/:id', (m) => m.LabelReviewPage as typeof import('./pages/LabelReviewPage').LabelReviewPage);
const Rfqs = page('/rfqs', (m) => m.Rfqs as typeof import('./pages/Rfqs').Rfqs);
const Customers = page('/customers', (m) => m.Customers as typeof import('./pages/Customers').Customers);
const CustomerDetail = page('/customers/:id', (m) => m.CustomerDetail as typeof import('./pages/CustomerDetail').CustomerDetail);
const Documents = page('/documents', (m) => m.Documents as typeof import('./pages/Documents').Documents);
const Orders = page('/orders', (m) => m.Orders as typeof import('./pages/Orders').Orders);
const OrderDetail = page('/orders/:id', (m) => m.OrderDetail as typeof import('./pages/OrderDetail').OrderDetail);
const Admin = page('/admin', (m) => m.Admin as typeof import('./pages/Admin').Admin);
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
  // Warm every page's code once the shell is up, so page switches never wait on a download.
  useEffect(() => { preloadAllRoutes(); }, []);
  const { user, loading } = useSession();

  if (loading) return <Booting />;
  if (!user) return <Login />;

  return (
    <Shell>
      <Suspense fallback={<div className="page"><Loading rows={7} /></div>}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/my-work" element={<MyWork />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/activity" element={<Activity />} />

          <Route path="/production" element={<Production />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/planning" element={<Planning />} />
          <Route path="/routings" element={<Routings />} />
          <Route path="/production/:id" element={<WorkOrderDetail />} />

          <Route path="/inventory" element={<Inventory />} />
          <Route path="/inventory/counts/:id" element={<CountSheet />} />
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
