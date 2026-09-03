import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import {
  Badge, Card, CardHead, CheckBox, DataTable, EmptyState, SearchInput, Select,
  StatusBadge, Tabs, type Column,
} from '../components/ui';
import { api, useList } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useViewing } from '../lib/realtime';
import { useUsers, useVendors } from '../lib/lookups';
import { date, daysUntil, money, number, qty, relative } from '../lib/format';
import { PO_STATUS, VENDOR_CATEGORIES, VENDOR_STATUS } from '@shared/domain';
import type { PurchaseOrder, Vendor } from '../lib/types';

interface Suggestion {
  itemId: string; itemCode: string; name: string; uom: string;
  released: number; onHand: number; onOrder: number; reorderPoint: number;
  suggestedQty: number; unitCost: number; estimatedCost: number; leadTimeDays: number;
  vendorId: string; vendorName: string; vendorStatus: string; covered: boolean;
  severity: 'danger' | 'warning';
}

export function Purchasing() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const { error, success } = useUi();
  const vendors = useVendors();
  const users = useUsers();
  useViewing('vendors and purchasing');

  const [tab, setTab] = useState('orders');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: orders, isLoading } = useList<PurchaseOrder>('purchaseOrders', { sort: '-createdAt', limit: 400 });
  const { data: suggestions } = useQuery<{ rows: Suggestion[]; total: number; estimatedSpend: number }>({
    queryKey: ['purchasing', 'suggestions'],
    queryFn: () => api.get('/purchasing/reorder-suggestions'),
  });

  const filteredOrders = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (orders?.rows ?? []).filter((po) => {
      if (status && po.status !== status) return false;
      if (!needle) return true;
      return `${po.poNumber} ${vendors.name(po.vendorId)}`.toLowerCase().includes(needle);
    });
  }, [orders, search, status, vendors]);

  const filteredVendors = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return vendors.rows.filter((vendor) => (!needle || `${vendor.name} ${vendor.code}`.toLowerCase().includes(needle)));
  }, [vendors.rows, search]);

  const openValue = filteredOrders
    .filter((po) => ['approved', 'sent', 'partial'].includes(po.status))
    .reduce((sum, po) => sum + po.total, 0);

  const orderColumns: Column<PurchaseOrder>[] = [
    { key: 'po', header: 'Purchase order', sortValue: (row) => row.poNumber, render: (row) => (
      <div>
        <div className="cell-primary mono">{row.poNumber}</div>
        <div className="cell-sub">{row.lines.length} line{row.lines.length === 1 ? '' : 's'}</div>
      </div>
    ) },
    { key: 'vendor', header: 'Vendor', sortValue: (row) => vendors.name(row.vendorId), render: (row) => vendors.name(row.vendorId) },
    { key: 'status', header: 'Status', sortValue: (row) => row.status, render: (row) => <StatusBadge list={PO_STATUS} value={row.status} /> },
    { key: 'total', header: 'Total', numeric: true, sortValue: (row) => row.total, render: (row) => money(row.total) },
    { key: 'received', header: 'Received', numeric: true, render: (row) => {
      const total = row.lines.reduce((sum, line) => sum + line.qty, 0);
      const got = row.lines.reduce((sum, line) => sum + (line.received ?? 0), 0);
      return total ? `${Math.round((got / total) * 100)}%` : '—';
    } },
    { key: 'expected', header: 'Expected', sortValue: (row) => row.expectedAt ?? '', render: (row) => {
      const days = daysUntil(row.expectedAt);
      const late = days !== null && days < 0 && !['received', 'closed', 'cancelled'].includes(row.status);
      return <span className={late ? 'tone-text' : ''} data-tone={late ? 'danger' : undefined}>{date(row.expectedAt)}</span>;
    } },
    { key: 'buyer', header: 'Buyer', sortValue: (row) => users.name(row.buyerId), render: (row) => users.name(row.buyerId) },
    { key: 'updated', header: 'Updated', sortValue: (row) => row.updatedAt, render: (row) => relative(row.updatedAt) },
  ];

  const vendorColumns: Column<Vendor>[] = [
    { key: 'vendor', header: 'Vendor', sortValue: (row) => row.name, render: (row) => (
      <div><div className="cell-primary">{row.name}</div><div className="cell-sub mono">{row.code}</div></div>
    ) },
    { key: 'category', header: 'Category', sortValue: (row) => row.category, render: (row) => <StatusBadge list={VENDOR_CATEGORIES} value={row.category} dot={false} /> },
    { key: 'status', header: 'Status', sortValue: (row) => row.status, render: (row) => <StatusBadge list={VENDOR_STATUS} value={row.status} /> },
    { key: 'lead', header: 'Lead time', numeric: true, sortValue: (row) => row.leadTimeDays, render: (row) => `${row.leadTimeDays} d` },
    { key: 'terms', header: 'Terms', render: (row) => row.paymentTerms },
    { key: 'qual', header: 'Qualification', sortValue: (row) => row.qualification?.expiresAt ?? '', render: (row) => {
      const days = daysUntil(row.qualification?.expiresAt);
      if (days === null) return <span className="faint">not on file</span>;
      if (days < 0) return <Badge tone="danger">lapsed</Badge>;
      if (days < 60) return <Badge tone="warning">{days} d</Badge>;
      return date(row.qualification?.expiresAt);
    } },
    { key: 'rating', header: 'Quality', numeric: true, sortValue: (row) => row.rating?.quality ?? 0, render: (row) => (row.rating?.quality ? `${row.rating.quality.toFixed(1)}` : '—') },
    { key: 'buyer', header: 'Buyer', render: (row) => users.name(row.buyerId) },
  ];

  const draftSelected = async () => {
    try {
      const result = await api.post<{ count: number }>('/purchasing/draft-from-suggestions', { itemIds: [...selected] });
      success(`${result.count} purchase order${result.count === 1 ? '' : 's'} drafted`);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['collection', 'purchaseOrders'] });
      queryClient.invalidateQueries({ queryKey: ['purchasing'] });
      setTab('orders');
    } catch (err) { error(err); }
  };

  return (
    <div className="page page-wide">
      <PageHeader
        title="Vendors & purchasing"
        subtitle={`${filteredOrders.filter((po) => ['approved', 'sent', 'partial'].includes(po.status)).length} open orders worth ${money(openValue, 0)} · ${vendors.rows.filter((v) => v.status === 'approved').length} approved vendors`}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="PO number, vendor…" />
            {tab === 'orders' && (
              <Select value={status} onChange={setStatus} allowEmpty placeholder="All statuses" options={PO_STATUS.map((s) => ({ value: s.value, label: s.label }))} style={{ width: 176 }} />
            )}
          </>
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'orders', label: 'Purchase orders', count: filteredOrders.length, icon: 'clipboard' },
          { value: 'suggestions', label: 'Needs ordering', count: suggestions?.total ?? null, icon: 'alert' },
          { value: 'vendors', label: 'Vendors', count: filteredVendors.length, icon: 'truck' },
        ]}
      />

      <div style={{ marginTop: 'var(--s-4)' }}>
        {tab === 'orders' && (
          <Card>
            <DataTable columns={orderColumns} rows={filteredOrders} loading={isLoading} onRowClick={(row) => navigate(`/purchasing/${row.id}`)} />
          </Card>
        )}

        {tab === 'suggestions' && (
          <Card>
            <CardHead
              title="Items at or below their reorder point"
              subtitle={suggestions ? `${money(suggestions.estimatedSpend, 0)} to cover everything not already on order` : ''}
              icon="alert"
              actions={can('po.write') && selected.size > 0 && (
                <button type="button" className="btn btn-primary btn-sm" onClick={draftSelected}>
                  <Icon name="plus" size={12} /> Draft {selected.size} item{selected.size === 1 ? '' : 's'} into POs
                </button>
              )}
            />
            <div className="card-body-flush">
              {(suggestions?.rows ?? []).length === 0 && (
                <EmptyState icon="check-circle" title="Nothing needs ordering" body="Every item is above its reorder point or already covered by an open purchase order." />
              )}
              {(suggestions?.rows ?? []).map((row) => (
                <div key={row.itemId} className="list-row" style={{ alignItems: 'flex-start' }}>
                  {can('po.write') && !row.covered && (
                    <CheckBox
                      checked={selected.has(row.itemId)}
                      onChange={(checked) => setSelected((current) => {
                        const next = new Set(current);
                        if (checked) next.add(row.itemId); else next.delete(row.itemId);
                        return next;
                      })}
                    />
                  )}
                  <span data-tone={row.severity} className="tone-text" style={{ marginTop: 2 }}><Icon name="alert" size={14} /></span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="row-tight">
                      <button type="button" className="link-btn truncate" onClick={() => navigate(`/inventory/${row.itemId}`)}>{row.name}</button>
                      <span className="cell-sub mono">{row.itemCode}</span>
                      {row.covered && <Badge tone="info">on order</Badge>}
                      {row.vendorStatus !== 'approved' && <Badge tone="warning">vendor {row.vendorStatus}</Badge>}
                    </span>
                    <span className="cell-sub" style={{ display: 'block' }}>
                      {qty(row.released, row.uom)} released against a {number(row.reorderPoint)} reorder point ·
                      {' '}{row.onOrder > 0 ? `${qty(row.onOrder, row.uom)} already on order · ` : ''}
                      {row.vendorName} · {row.leadTimeDays} day lead time
                    </span>
                  </span>
                  <span className="right nowrap">
                    <span className="cell-primary mono" style={{ display: 'block' }}>{qty(row.suggestedQty, row.uom)}</span>
                    <span className="cell-sub">{money(row.estimatedCost, 0)}</span>
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {tab === 'vendors' && (
          <Card>
            <DataTable columns={vendorColumns} rows={filteredVendors} onRowClick={(row) => navigate(`/purchasing/vendors/${row.id}`)} />
          </Card>
        )}
      </div>
    </div>
  );
}
