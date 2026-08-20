import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import {
  Avatar, Badge, Card, Combo, DataTable, EmptyState, Field, Modal, SearchInput,
  Segmented, Select, StatusBadge, TextInput, type Column,
} from '../components/ui';
import { api, useList } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useViewing } from '../lib/realtime';
import { useUsers } from '../lib/lookups';
import { colorFor, money, number, relative } from '../lib/format';
import { CUSTOMER_STATUS, CUSTOMER_TIERS } from '@shared/domain';
import type { Customer, Formula, Quote, SalesOrder } from '../lib/types';

export function Customers() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const users = useUsers();
  useViewing('customers');

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [newOpen, setNewOpen] = useState(false);

  const { data, isLoading } = useList<Customer>('customers', { sort: 'name', limit: 400 });
  const { data: orders } = useList<SalesOrder>('salesOrders', { limit: 800, select: ['customerId', 'total', 'status'] });
  const { data: quotes } = useList<Quote>('quotes', { limit: 400, select: ['customerId', 'status'] });
  const { data: formulas } = useList<Formula>('formulas', { limit: 400, select: ['customerId'] });

  const stats = useMemo(() => {
    const byCustomer = new Map<string, { revenue: number; orders: number; quotes: number; formulas: number }>();
    const get = (id: string) => {
      if (!byCustomer.has(id)) byCustomer.set(id, { revenue: 0, orders: 0, quotes: 0, formulas: 0 });
      return byCustomer.get(id)!;
    };
    for (const order of orders?.rows ?? []) {
      const entry = get(order.customerId);
      entry.orders += 1;
      if (!['cancelled', 'draft'].includes(order.status)) entry.revenue += order.total ?? 0;
    }
    for (const quote of quotes?.rows ?? []) get(quote.customerId).quotes += 1;
    for (const formula of formulas?.rows ?? []) get(formula.customerId).formulas += 1;
    return byCustomer;
  }, [orders, quotes, formulas]);

  const customers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.rows ?? []).filter((customer) => {
      if (status && customer.status !== status) return false;
      if (!needle) return true;
      return `${customer.name} ${customer.code} ${customer.industry}`.toLowerCase().includes(needle);
    });
  }, [data, search, status]);

  const columns: Column<Customer>[] = [
    { key: 'name', header: 'Customer', sortValue: (row) => row.name, render: (row) => (
      <div className="row-tight">
        <Avatar name={row.name} color={row.logoTint || colorFor(row.name)} />
        <div style={{ minWidth: 0 }}>
          <div className="cell-primary truncate">{row.name}</div>
          <div className="cell-sub mono">{row.code}</div>
        </div>
      </div>
    ) },
    { key: 'status', header: 'Status', sortValue: (row) => row.status, render: (row) => <StatusBadge list={CUSTOMER_STATUS} value={row.status} /> },
    { key: 'tier', header: 'Tier', sortValue: (row) => row.tier, render: (row) => <StatusBadge list={CUSTOMER_TIERS} value={row.tier} dot={false} /> },
    { key: 'industry', header: 'Industry', sortValue: (row) => row.industry, render: (row) => row.industry },
    { key: 'revenue', header: 'Booked', numeric: true, sortValue: (row) => stats.get(row.id)?.revenue ?? 0, render: (row) => money(stats.get(row.id)?.revenue ?? 0, 0) },
    { key: 'orders', header: 'Orders', numeric: true, sortValue: (row) => stats.get(row.id)?.orders ?? 0, render: (row) => number(stats.get(row.id)?.orders ?? 0) },
    { key: 'formulas', header: 'Formulas', numeric: true, sortValue: (row) => stats.get(row.id)?.formulas ?? 0, render: (row) => number(stats.get(row.id)?.formulas ?? 0) },
    { key: 'owner', header: 'Account manager', sortValue: (row) => users.name(row.ownerId), render: (row) => users.name(row.ownerId) },
    { key: 'terms', header: 'Terms', render: (row) => row.paymentTerms },
  ];

  return (
    <div className="page page-wide">
      <PageHeader
        title="Customers"
        subtitle={`${customers.length} accounts · ${money([...stats.values()].reduce((sum, entry) => sum + entry.revenue, 0), 0)} booked across the book`}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Customer, code, industry…" />
            <Select value={status} onChange={setStatus} allowEmpty placeholder="All statuses" options={CUSTOMER_STATUS.map((s) => ({ value: s.value, label: s.label }))} style={{ width: 150 }} />
            <Segmented value={view} onChange={setView} options={[{ value: 'cards', label: 'Cards' }, { value: 'table', label: 'Table' }]} />
            {can('customers.write') && (
              <button type="button" className="btn btn-primary" onClick={() => setNewOpen(true)}>
                <Icon name="plus" size={14} /> New customer
              </button>
            )}
          </>
        }
      />

      {view === 'table' ? (
        <Card>
          <DataTable columns={columns} rows={customers} loading={isLoading} onRowClick={(row) => navigate(`/customers/${row.id}`)} />
        </Card>
      ) : (
        <div className="grid grid-3">
          {customers.map((customer) => {
            const entry = stats.get(customer.id) ?? { revenue: 0, orders: 0, quotes: 0, formulas: 0 };
            return (
              <button
                key={customer.id}
                type="button"
                className="card"
                style={{ textAlign: 'left', padding: 'var(--s-5)', cursor: 'pointer' }}
                onClick={() => navigate(`/customers/${customer.id}`)}
              >
                <div className="row" style={{ marginBottom: 'var(--s-3)' }}>
                  <Avatar name={customer.name} color={customer.logoTint || colorFor(customer.name)} size="lg" />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="cell-primary truncate">{customer.name}</div>
                    <div className="cell-sub mono">{customer.code}</div>
                  </div>
                  <StatusBadge list={CUSTOMER_STATUS} value={customer.status} />
                </div>

                <div className="row-wrap" style={{ gap: 'var(--s-1)', marginBottom: 'var(--s-4)' }}>
                  <StatusBadge list={CUSTOMER_TIERS} value={customer.tier} dot={false} />
                  {customer.industry && <Badge tone="neutral">{customer.industry}</Badge>}
                </div>

                <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--s-2)' }}>
                  {[
                    { label: 'Booked', value: money(entry.revenue, 0) },
                    { label: 'Orders', value: number(entry.orders) },
                    { label: 'Formulas', value: number(entry.formulas) },
                  ].map((tile) => (
                    <div key={tile.label}>
                      <div className="cell-sub">{tile.label}</div>
                      <div className="mono strong">{tile.value}</div>
                    </div>
                  ))}
                </div>

                <div className="row-tight" style={{ marginTop: 'var(--s-4)', paddingTop: 'var(--s-3)', borderTop: '1px solid var(--line-soft)' }}>
                  <Avatar name={users.name(customer.ownerId)} size="sm" />
                  <span className="cell-sub truncate grow">{users.name(customer.ownerId)}</span>
                  <span className="cell-sub nowrap">{relative(customer.updatedAt)}</span>
                </div>
              </button>
            );
          })}
          {customers.length === 0 && !isLoading && (
            <Card><EmptyState icon="building" title="No customers match" body="Adjust the search or the status filter." /></Card>
          )}
        </div>
      )}

      <NewCustomer
        open={newOpen}
        onClose={() => setNewOpen(false)}
        userOptions={users.options}
        onCreated={(id) => { setNewOpen(false); queryClient.invalidateQueries({ queryKey: ['collection', 'customers'] }); navigate(`/customers/${id}`); }}
      />
    </div>
  );
}

function NewCustomer({ open, onClose, onCreated, userOptions }: {
  open: boolean; onClose: () => void; onCreated: (id: string) => void;
  userOptions: { value: string; label: string; sub?: string }[];
}) {
  const { error } = useUi();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [industry, setIndustry] = useState('');
  const [tier, setTier] = useState('standard');
  const [ownerId, setOwnerId] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const customer = await api.post<Customer>('/data/customers', {
        name,
        code: code || `C-${Date.now().toString().slice(-5)}`,
        industry, tier, ownerId, status: 'prospect',
      });
      onCreated(customer.id);
    } catch (err) { error(err); } finally { setBusy(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New customer"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!name || busy} onClick={create}>Create</button>
        </>
      }
    >
      <div className="col">
        <Field label="Company name"><TextInput value={name} onChange={setName} autoFocus /></Field>
        <div className="field-row">
          <Field label="Customer code" hint="Leave blank to generate one."><TextInput value={code} onChange={setCode} placeholder="Auto" /></Field>
          <Field label="Tier"><Select value={tier} onChange={setTier} options={CUSTOMER_TIERS.map((t) => ({ value: t.value, label: t.label }))} /></Field>
        </div>
        <div className="field-row">
          <Field label="Industry"><TextInput value={industry} onChange={setIndustry} placeholder="e.g. Sports nutrition" /></Field>
          <Field label="Account manager"><Combo value={ownerId} onChange={setOwnerId} options={userOptions} placeholder="Assign later" /></Field>
        </div>
      </div>
    </Modal>
  );
}
