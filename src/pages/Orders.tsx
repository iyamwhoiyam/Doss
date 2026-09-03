import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '../components/Shell';
import { Card, DataTable, SearchInput, Select, StatusBadge, Tabs, type Column, Badge } from '../components/ui';
import { useList } from '../lib/api';
import { useViewing } from '../lib/realtime';
import { useCustomers, useProjects, useUsers } from '../lib/lookups';
import { ProjectLink } from '../components/ProjectLink';
import { date, daysUntil, money, number, relative, unitMoney } from '../lib/format';
import { PRIORITIES, SO_STATUS } from '@shared/domain';
import type { SalesOrder, Shipment } from '../lib/types';

export function Orders() {
  const navigate = useNavigate();
  const customers = useCustomers();
  const users = useUsers();
  const projects = useProjects();
  useViewing('customer orders');

  const [tab, setTab] = useState('orders');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const { data, isLoading } = useList<SalesOrder>('salesOrders', { sort: '-createdAt', limit: 500 });
  const { data: shipments } = useList<Shipment>('shipments', { sort: '-shippedAt', limit: 300 });

  const orders = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.rows ?? []).filter((order) => {
      if (status && order.status !== status) return false;
      if (!needle) return true;
      return `${order.orderNumber} ${order.customerPo} ${customers.name(order.customerId)} ${order.lines[0]?.description ?? ''}`
        .toLowerCase().includes(needle);
    });
  }, [data, search, status, customers]);

  const open = orders.filter((order) => !['closed', 'cancelled', 'invoiced'].includes(order.status));
  const backlog = open.reduce((sum, order) => sum + order.total, 0);
  const late = open.filter((order) => {
    const days = daysUntil(order.promisedShipDate);
    return days !== null && days < 0 && !order.shippedAt;
  });

  const orderColumns: Column<SalesOrder>[] = [
    { key: 'order', header: 'Order', sortValue: (row) => row.orderNumber, render: (row) => (
      <div>
        <div className="cell-primary mono">{row.orderNumber}</div>
        {row.customerPo && <div className="cell-sub">their PO {row.customerPo}</div>}
      </div>
    ) },
    { key: 'customer', header: 'Customer', sortValue: (row) => customers.name(row.customerId), render: (row) => customers.name(row.customerId) },
    { key: 'product', header: 'Product', render: (row) => <span className="truncate">{row.lines[0]?.description ?? '—'}</span> },
    { key: 'project', header: 'Project', sortValue: (row) => projects.byId.get(row.projectId ?? '')?.code ?? '', render: (row) => { const p = row.projectId ? projects.byId.get(row.projectId) : undefined; return <ProjectLink id={p?.id} code={p?.code} />; } },
    { key: 'status', header: 'Status', sortValue: (row) => row.status, render: (row) => <StatusBadge list={SO_STATUS} value={row.status} /> },
    { key: 'priority', header: '', render: (row) => (row.priority !== 'normal' ? <StatusBadge list={PRIORITIES} value={row.priority} dot={false} /> : null) },
    { key: 'qty', header: 'Units', numeric: true, sortValue: (row) => row.lines[0]?.qty ?? 0, render: (row) => number(row.lines[0]?.qty ?? 0) },
    { key: 'price', header: 'Unit price', numeric: true, render: (row) => unitMoney(row.lines[0]?.unitPrice ?? 0) },
    { key: 'total', header: 'Total', numeric: true, sortValue: (row) => row.total, render: (row) => money(row.total, 0) },
    { key: 'promised', header: 'Promised', sortValue: (row) => row.promisedShipDate ?? '', render: (row) => {
      const days = daysUntil(row.promisedShipDate);
      const isLate = days !== null && days < 0 && !row.shippedAt;
      return <span className={isLate ? 'tone-text' : ''} data-tone={isLate ? 'danger' : undefined}>{date(row.promisedShipDate)}</span>;
    } },
    { key: 'owner', header: 'Owner', sortValue: (row) => users.name(row.ownerId), render: (row) => users.name(row.ownerId) },
  ];

  const shipmentColumns: Column<Shipment>[] = [
    { key: 'shipment', header: 'Shipment', sortValue: (row) => row.shipmentNumber, render: (row) => <span className="mono cell-primary">{row.shipmentNumber}</span> },
    { key: 'customer', header: 'Customer', render: (row) => customers.name(row.customerId) },
    { key: 'status', header: 'Status', sortValue: (row) => row.status, render: (row) => (
      <Badge tone={row.status === 'delivered' ? 'success' : row.status === 'exception' ? 'danger' : 'progress'}>{row.status.replace('_', ' ')}</Badge>
    ) },
    { key: 'carrier', header: 'Carrier', sortValue: (row) => row.carrier, render: (row) => `${row.carrier}${row.service ? ` · ${row.service}` : ''}` },
    { key: 'tracking', header: 'Tracking', render: (row) => <span className="mono cell-sub">{row.trackingNumber}</span> },
    { key: 'cartons', header: 'Cartons', numeric: true, sortValue: (row) => row.cartons, render: (row) => number(row.cartons) },
    { key: 'weight', header: 'Weight', numeric: true, sortValue: (row) => row.weightLb, render: (row) => `${number(row.weightLb)} lb` },
    { key: 'cost', header: 'Freight', numeric: true, sortValue: (row) => row.cost, render: (row) => money(row.cost) },
    { key: 'shipped', header: 'Shipped', sortValue: (row) => row.shippedAt ?? '', render: (row) => relative(row.shippedAt) },
  ];

  return (
    <div className="page page-wide">
      <PageHeader
        title="Orders"
        subtitle={`${open.length} open worth ${money(backlog, 0)}${late.length ? ` · ${late.length} past the promised ship date` : ''}`}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Order, customer PO, product…" />
            {tab === 'orders' && (
              <Select value={status} onChange={setStatus} allowEmpty placeholder="All statuses" options={SO_STATUS.map((s) => ({ value: s.value, label: s.label }))} style={{ width: 176 }} />
            )}
          </>
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'orders', label: 'Sales orders', count: orders.length, icon: 'cart' },
          { value: 'shipments', label: 'Shipments', count: shipments?.total ?? null, icon: 'truck' },
        ]}
      />

      <div style={{ marginTop: 'var(--s-4)' }}>
        {tab === 'orders' && (
          <Card>
            <DataTable columns={orderColumns} rows={orders} loading={isLoading} onRowClick={(row) => navigate(`/orders/${row.id}`)} />
          </Card>
        )}
        {tab === 'shipments' && (
          <Card>
            <DataTable columns={shipmentColumns} rows={shipments?.rows ?? []} onRowClick={(row) => row.salesOrderId && navigate(`/orders/${row.salesOrderId}`)} />
          </Card>
        )}
      </div>
    </div>
  );
}
