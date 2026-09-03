import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import {
  Badge, Card, CardHead, Combo, DataTable, EmptyState, Field, Modal, NumberInput,
  SearchInput, Select, StatusBadge, Tabs, TextInput, type Column,
} from '../components/ui';
import { api, qs, useList } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useViewing } from '../lib/realtime';
import { useItems, useLocations, useUsers, useVendors } from '../lib/lookups';
import { date, daysUntil, money, number, qty, relative } from '../lib/format';
import { ITEM_TYPES, LOT_STATUS, TXN_TYPES } from '@shared/domain';
import type { CycleCount, InventoryTxn, ItemPosition, Lot } from '../lib/types';

interface PositionsResponse {
  rows: ItemPosition[];
  total: number;
  totals: { value: number; items: number; withAlerts: number };
}

interface AlertsResponse {
  rows: (ItemPosition['alerts'][number] & { itemId: string; itemCode: string; itemName: string; uom: string; onHand: number; released: number; reorderPoint: number })[];
  total: number;
  bySeverity: { danger: number; warning: number; info: number };
}

export function Inventory() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { can } = useSession();
  const locations = useLocations();
  const items = useItems();
  const vendors = useVendors();
  const users = useUsers();
  useViewing('inventory');

  const [tab, setTab] = useState(params.get('tab') ?? (params.get('alert') ? 'alerts' : 'positions'));
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [countOpen, setCountOpen] = useState(false);

  const { data: positions, isLoading } = useQuery<PositionsResponse>({
    queryKey: ['inventory', 'positions'],
    queryFn: () => api.get<PositionsResponse>(`/inventory/positions${qs({ limit: 1000 })}`),
  });

  const { data: alerts } = useQuery<AlertsResponse>({
    queryKey: ['inventory', 'alerts'],
    queryFn: () => api.get<AlertsResponse>('/inventory/alerts'),
  });

  const { data: lots } = useList<Lot>('lots', { sort: 'expiresAt', limit: 1000 });
  const { data: txns } = useList<InventoryTxn>('inventoryTxns', { sort: '-performedAt', limit: 200 });
  const { data: counts } = useList<CycleCount>('cycleCounts', { sort: '-scheduledFor', limit: 50 });

  const filteredPositions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const alertFilter = params.get('alert');
    return (positions?.rows ?? []).filter((row) => {
      if (type && row.type !== type) return false;
      if (alertFilter && !row.alerts.some((a) => a.kind === alertFilter)) return false;
      if (!needle) return true;
      return `${row.name} ${row.itemCode} ${row.category} ${row.form}`.toLowerCase().includes(needle);
    });
  }, [positions, search, type, params]);

  const positionColumns: Column<ItemPosition>[] = [
    {
      key: 'item', header: 'Item', sortValue: (row) => row.name,
      render: (row) => (
        <div>
          <div className="cell-primary truncate">{row.name}</div>
          <div className="cell-sub mono">{row.itemCode} · {row.category}</div>
        </div>
      ),
    },
    { key: 'type', header: 'Type', sortValue: (row) => row.type, render: (row) => <StatusBadge list={ITEM_TYPES} value={row.type} dot={false} /> },
    { key: 'released', header: 'Released', numeric: true, sortValue: (row) => row.released, render: (row) => qty(row.released, row.uom) },
    { key: 'quarantine', header: 'Quarantine', numeric: true, sortValue: (row) => row.quarantined, render: (row) => (row.quarantined ? <span className="tone-text" data-tone="warning">{qty(row.quarantined)}</span> : <span className="faint">—</span>) },
    { key: 'onOrder', header: 'On order', numeric: true, sortValue: (row) => row.onOrder, render: (row) => (row.onOrder ? qty(row.onOrder) : <span className="faint">—</span>) },
    { key: 'reorder', header: 'Reorder at', numeric: true, sortValue: (row) => row.reorderPoint, render: (row) => number(row.reorderPoint) },
    { key: 'value', header: 'Value', numeric: true, sortValue: (row) => row.value, render: (row) => money(row.value) },
    { key: 'expiry', header: 'Next expiry', sortValue: (row) => row.nextExpiry ?? '', render: (row) => {
      const days = daysUntil(row.nextExpiry);
      if (days === null) return <span className="faint">—</span>;
      return <span className={days < 0 ? 'tone-text' : days < 90 ? 'tone-text' : ''} data-tone={days < 0 ? 'danger' : days < 90 ? 'warning' : undefined}>{date(row.nextExpiry)}</span>;
    } },
    { key: 'alerts', header: '', align: 'right', render: (row) => (
      row.alerts.length ? (
        <span className="row-tight" style={{ justifyContent: 'flex-end' }}>
          {row.alerts.slice(0, 2).map((alert) => (
            <span key={alert.kind} data-tone={alert.severity} className="tone-text" title={alert.message}>
              <Icon name={alert.severity === 'danger' ? 'alert' : 'info'} size={14} />
            </span>
          ))}
        </span>
      ) : null
    ) },
  ];

  const lotColumns: Column<Lot>[] = [
    { key: 'lot', header: 'Lot', sortValue: (row) => row.lotNumber, render: (row) => <span className="mono cell-primary">{row.lotNumber}</span> },
    { key: 'item', header: 'Item', sortValue: (row) => items.name(row.itemId), render: (row) => <span className="truncate">{items.name(row.itemId)}</span> },
    { key: 'status', header: 'Status', sortValue: (row) => row.status, render: (row) => <StatusBadge list={LOT_STATUS} value={row.status} /> },
    { key: 'onHand', header: 'On hand', numeric: true, sortValue: (row) => row.qtyOnHand, render: (row) => qty(row.qtyOnHand, row.uom) },
    { key: 'location', header: 'Location', sortValue: (row) => locations.code(row.locationId), render: (row) => locations.code(row.locationId) },
    { key: 'vendor', header: 'Vendor', sortValue: (row) => vendors.name(row.vendorId), render: (row) => <span className="truncate">{vendors.name(row.vendorId)}</span> },
    { key: 'received', header: 'Received', sortValue: (row) => row.receivedAt ?? '', render: (row) => date(row.receivedAt) },
    { key: 'expires', header: 'Expires', sortValue: (row) => row.expiresAt ?? '', render: (row) => {
      const days = daysUntil(row.expiresAt);
      return <span data-tone={days !== null && days < 0 ? 'danger' : days !== null && days < 90 ? 'warning' : undefined} className={days !== null && days < 90 ? 'tone-text' : ''}>{date(row.expiresAt)}</span>;
    } },
    { key: 'coa', header: 'COA', render: (row) => (row.coaReceived ? <Icon name="check" size={13} /> : <span className="tone-text" data-tone="warning" title="No COA on file"><Icon name="alert" size={13} /></span>) },
  ];

  const txnColumns: Column<InventoryTxn>[] = [
    { key: 'txn', header: 'Transaction', sortValue: (row) => row.txnNumber, render: (row) => <span className="mono">{row.txnNumber}</span> },
    { key: 'type', header: 'Type', sortValue: (row) => row.type, render: (row) => <StatusBadge list={TXN_TYPES} value={row.type} dot={false} /> },
    { key: 'item', header: 'Item', sortValue: (row) => items.name(row.itemId), render: (row) => <span className="truncate">{items.name(row.itemId)}</span> },
    { key: 'qty', header: 'Quantity', numeric: true, sortValue: (row) => row.qty, render: (row) => (
      <span className="tone-text" data-tone={row.qty < 0 ? 'danger' : 'success'}>{row.qty > 0 ? '+' : ''}{qty(row.qty, row.uom)}</span>
    ) },
    { key: 'reason', header: 'Reason', render: (row) => <span className="truncate">{row.reason}</span> },
    { key: 'who', header: 'By', render: (row) => users.name(row.createdBy) },
    { key: 'when', header: 'When', sortValue: (row) => row.performedAt ?? '', render: (row) => relative(row.performedAt) },
  ];

  const countTone = (status: string) => (status === 'closed' ? 'success' : status === 'counting' ? 'progress' : status === 'review' ? 'warning' : status === 'cancelled' ? 'danger' : 'neutral');

  return (
    <div className="page page-wide">
      <PageHeader
        title="Inventory"
        subtitle={
          positions
            ? `${number(positions.totals.items)} active items · ${money(positions.totals.value)} on hand · ${positions.totals.withAlerts} needing attention`
            : 'Loading…'
        }
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Item, code, category…" />
            <Select
              value={type}
              onChange={setType}
              allowEmpty
              placeholder="All types"
              options={ITEM_TYPES.map((t) => ({ value: t.value, label: t.label }))}
              style={{ width: 160 }}
            />
            {can('inventory.write') && (
              <button type="button" className="btn btn-primary" onClick={() => setReceiveOpen(true)}>
                <Icon name="download" size={14} /> Receive stock
              </button>
            )}
          </>
        }
      />

      {params.get('alert') && (
        <div className="row" style={{ marginBottom: 'var(--s-3)' }}>
          <Badge tone="warning">Filtered: {params.get('alert')?.replace('_', ' ')}</Badge>
          <button type="button" className="link-btn" onClick={() => setParams({})}>Clear</button>
        </div>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'positions', label: 'Stock positions', count: filteredPositions.length, icon: 'boxes' },
          { value: 'alerts', label: 'Alerts', count: alerts?.total ?? null, icon: 'alert' },
          { value: 'lots', label: 'Lots', count: lots?.total ?? null, icon: 'tag' },
          { value: 'ledger', label: 'Ledger', count: txns?.total ?? null, icon: 'history' },
          { value: 'counts', label: 'Cycle counts', count: counts?.total ?? null, icon: 'clipboard' },
        ]}
      />

      <div style={{ marginTop: 'var(--s-4)' }}>
        {tab === 'positions' && (
          <Card>
            <DataTable
              columns={positionColumns}
              rows={filteredPositions}
              loading={isLoading}
              onRowClick={(row) => navigate(`/inventory/${row.id}`)}
              empty={<EmptyState icon="boxes" title="No items match" body="Adjust the search or type filter." />}
            />
          </Card>
        )}

        {tab === 'alerts' && (
          <Card>
            <CardHead
              title="What needs attention"
              subtitle={alerts ? `${alerts.bySeverity.danger} urgent · ${alerts.bySeverity.warning} warnings · ${alerts.bySeverity.info} for information` : ''}
              icon="alert"
            />
            <div className="card-body-flush">
              {(alerts?.rows ?? []).length === 0 && (
                <EmptyState icon="check-circle" title="Everything is in order" body="Every item is above its reorder point, nothing is expiring, and every lot has its COA." />
              )}
              {(alerts?.rows ?? []).map((alert, index) => (
                <button
                  key={`${alert.itemId}-${alert.kind}-${index}`}
                  type="button"
                  className="list-row"
                  style={{ width: '100%', border: 0, background: 'none', textAlign: 'left', alignItems: 'flex-start' }}
                  onClick={() => navigate(`/inventory/${alert.itemId}`)}
                >
                  <span data-tone={alert.severity} className="tone-text" style={{ marginTop: 2 }}>
                    <Icon name={alert.severity === 'danger' ? 'alert' : 'info'} size={15} />
                  </span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="row-tight">
                      <span className="cell-primary truncate">{alert.itemName}</span>
                      <span className="cell-sub mono">{alert.itemCode}</span>
                    </span>
                    <span className="cell-sub" style={{ display: 'block' }}>{alert.message}</span>
                    <span className="cell-sub" style={{ display: 'block', color: 'var(--accent-text)' }}>{alert.suggestion}</span>
                  </span>
                  <Icon name="chevron-right" size={14} className="faint" />
                </button>
              ))}
            </div>
          </Card>
        )}

        {tab === 'lots' && (
          <Card>
            <DataTable
              columns={lotColumns}
              rows={lots?.rows ?? []}
              onRowClick={(row) => navigate(`/inventory/${row.itemId}?lot=${row.id}`)}
            />
          </Card>
        )}

        {tab === 'ledger' && (
          <Card>
            <CardHead title="Transaction ledger" subtitle="Every quantity change, newest first" icon="history" />
            <DataTable columns={txnColumns} rows={txns?.rows ?? []} />
          </Card>
        )}

        {tab === 'counts' && (
          <div className="col">
            {can('inventory.write') && (
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-primary" onClick={() => setCountOpen(true)}><Icon name="plus" size={14} /> Schedule a count</button>
              </div>
            )}
            {(counts?.rows ?? []).length === 0 ? (
              <Card><EmptyState icon="clipboard" title="No counts yet" body="Schedule a cycle count of a location, a set of items, or the whole warehouse. Counters work the sheet, review flags anything outside tolerance, and posting adjusts the lots with a full audit trail." action={can('inventory.write') ? <button type="button" className="btn btn-primary" onClick={() => setCountOpen(true)}><Icon name="plus" size={14} /> Schedule a count</button> : undefined} /></Card>
            ) : (
              <Card>
                <DataTable
                  columns={[
                    { key: 'count', header: 'Count', sortValue: (c) => c.countNumber, render: (c) => <span className="mono">{c.countNumber}</span> },
                    { key: 'scope', header: 'Scope', sortValue: (c) => c.scope ?? 'location', render: (c) => (c.scope === 'all' ? 'Whole warehouse' : c.scope === 'items' ? `${c.itemIds?.length ?? 0} items` : locations.name(c.locationId)) },
                    { key: 'status', header: 'Status', sortValue: (c) => c.status, render: (c) => <Badge tone={countTone(c.status)}>{c.status}</Badge> },
                    { key: 'when', header: 'Scheduled', sortValue: (c) => c.scheduledFor ?? '', render: (c) => date(c.scheduledFor) },
                    { key: 'lines', header: 'Lots', numeric: true, sortValue: (c) => c.lines.length, render: (c) => `${c.lines.filter((l) => l.countedQty !== null && l.countedQty !== undefined).length}/${c.lines.length}` },
                    { key: 'var', header: 'Variances', numeric: true, sortValue: (c) => c.lines.filter((l) => l.variance).length, render: (c) => {
                      const n = c.lines.filter((l) => l.variance !== null && l.variance !== 0).length;
                      return <span className="tone-text" data-tone={n ? 'warning' : 'success'}>{n}</span>;
                    } },
                    { key: 'value', header: 'Net adjustment', numeric: true, sortValue: (c) => c.postedValue ?? 0, render: (c) => (c.status === 'closed' ? <span className="tone-text" data-tone={(c.postedValue ?? 0) < 0 ? 'danger' : 'success'}>{(c.postedValue ?? 0) < 0 ? '−' : '+'}{money(Math.abs(c.postedValue ?? 0), 2)}</span> : <span className="faint">—</span>) },
                    { key: 'by', header: 'Counted by', render: (c) => users.name(c.countedBy) },
                  ] as Column<CycleCount>[]}
                  rows={counts?.rows ?? []}
                  onRowClick={(c) => navigate(`/inventory/counts/${c.id}`)}
                />
              </Card>
            )}
          </div>
        )}
      </div>

      <ScheduleCount
        open={countOpen}
        onClose={() => setCountOpen(false)}
        itemOptions={items.options}
        locationOptions={locations.options}
        onCreated={(id) => { setCountOpen(false); queryClient.invalidateQueries({ queryKey: ['collection', 'cycleCounts'] }); navigate(`/inventory/counts/${id}`); }}
      />

      <ReceiveStock
        open={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        itemOptions={items.options}
        locationOptions={locations.options}
        vendorOptions={vendors.options}
        onDone={() => {
          setReceiveOpen(false);
          queryClient.invalidateQueries({ queryKey: ['inventory'] });
          queryClient.invalidateQueries({ queryKey: ['collection', 'lots'] });
        }}
      />
    </div>
  );
}

function ReceiveStock({ open, onClose, onDone, itemOptions, locationOptions, vendorOptions }: {
  open: boolean; onClose: () => void; onDone: () => void;
  itemOptions: { value: string; label: string; sub?: string }[];
  locationOptions: { value: string; label: string; sub?: string }[];
  vendorOptions: { value: string; label: string; sub?: string }[];
}) {
  const { error, success } = useUi();
  const [itemId, setItemId] = useState('');
  const [amount, setAmount] = useState(0);
  const [lotNumber, setLotNumber] = useState('');
  const [vendorLot, setVendorLot] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [coaReceived, setCoaReceived] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const lot = await api.post<Lot>('/inventory/receive', {
        itemId, qty: amount, lotNumber: lotNumber || undefined, vendorLot, vendorId, locationId,
        expiresAt: expiresAt ? new Date(`${expiresAt}T12:00:00Z`).toISOString() : undefined,
        coaReceived,
      });
      success(`Lot ${lot.lotNumber} received`, lot.status === 'quarantine' ? 'Held in quarantine until quality dispositions it.' : 'Released to stock.');
      setItemId(''); setAmount(0); setLotNumber(''); setVendorLot(''); setExpiresAt(''); setCoaReceived(false);
      onDone();
    } catch (err) { error(err); } finally { setBusy(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Receive stock"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!itemId || amount <= 0 || busy} onClick={submit}>
            {busy ? <span className="spinner" /> : <Icon name="download" size={14} />} Receive
          </button>
        </>
      }
    >
      <div className="col">
        <Field label="Item">
          <Combo value={itemId} onChange={setItemId} options={itemOptions} placeholder="Search the catalogue…" />
        </Field>
        <div className="field-row">
          <Field label="Quantity received"><NumberInput value={amount} onChange={setAmount} min={0} step="0.01" /></Field>
          <Field label="Lot number" hint="Leave blank to mint one."><TextInput value={lotNumber} onChange={setLotNumber} placeholder="Auto" /></Field>
        </div>
        <div className="field-row">
          <Field label="Vendor"><Combo value={vendorId} onChange={setVendorId} options={vendorOptions} placeholder="Preferred vendor" /></Field>
          <Field label="Vendor lot"><TextInput value={vendorLot} onChange={setVendorLot} /></Field>
        </div>
        <div className="field-row">
          <Field label="Location" hint="Items requiring a COA land in quarantine regardless.">
            <Combo value={locationId} onChange={setLocationId} options={locationOptions} placeholder="Default location" />
          </Field>
          <Field label="Expiry" hint="Defaults from the item's shelf life."><TextInput type="date" value={expiresAt} onChange={setExpiresAt} /></Field>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={coaReceived} onChange={(event) => setCoaReceived(event.target.checked)} />
          The certificate of analysis is on file for this lot
        </label>
      </div>
    </Modal>
  );
}

function ScheduleCount({ open, onClose, onCreated, itemOptions, locationOptions }: {
  open: boolean; onClose: () => void; onCreated: (id: string) => void;
  itemOptions: { value: string; label: string; sub?: string }[];
  locationOptions: { value: string; label: string; sub?: string }[];
}) {
  const { error, success } = useUi();
  const [scope, setScope] = useState<'location' | 'items' | 'all'>('location');
  const [locationId, setLocationId] = useState('');
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [itemPick, setItemPick] = useState('');
  const [scheduledFor, setScheduledFor] = useState(new Date().toISOString().slice(0, 10));
  const [blind, setBlind] = useState(true);
  const [tolerancePct, setTolerancePct] = useState(2);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const created = await api.post<CycleCount>('/inventory/counts', { scope, locationId, itemIds, scheduledFor: `${scheduledFor}T08:00:00.000Z`, blind, tolerancePct, notes });
      success(`${created.countNumber} scheduled`, `${created.lines.length} lots to count`);
      onCreated(created.id);
    } catch (err) { error(err); } finally { setBusy(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedule a cycle count"
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || (scope === 'location' && !locationId) || (scope === 'items' && !itemIds.length)}>
            <Icon name="clipboard" size={14} /> Create count sheet
          </button>
        </>
      )}
    >
      <div className="col">
        <Field label="What to count">
          <Select value={scope} onChange={(v) => setScope(v as 'location' | 'items' | 'all')} options={[
            { value: 'location', label: 'One location' },
            { value: 'items', label: 'Selected items, wherever they are' },
            { value: 'all', label: 'Everything on hand (physical inventory)' },
          ]} />
        </Field>
        {scope === 'location' && (
          <Field label="Location"><Combo value={locationId} onChange={setLocationId} options={locationOptions} placeholder="Pick a location" /></Field>
        )}
        {scope === 'items' && (
          <Field label="Items" hint={itemIds.length ? `${itemIds.length} selected` : 'Add items one at a time'}>
            <div className="col-tight">
              <Combo value={itemPick} onChange={(v) => { if (v && !itemIds.includes(v)) setItemIds([...itemIds, v]); setItemPick(''); }} options={itemOptions.filter((o) => !itemIds.includes(o.value))} placeholder="Add an item" />
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {itemIds.map((id) => (
                  <Badge key={id} tone="neutral">{itemOptions.find((o) => o.value === id)?.label ?? id} <button type="button" className="btn btn-sm btn-ghost" onClick={() => setItemIds(itemIds.filter((x) => x !== id))} aria-label="Remove">×</button></Badge>
                ))}
              </div>
            </div>
          </Field>
        )}
        <div className="field-row">
          <Field label="Count date"><TextInput type="date" value={scheduledFor} onChange={setScheduledFor} /></Field>
          <Field label="Tolerance %" hint="Lines further out than this must be recounted or explicitly accepted.">
            <NumberInput value={tolerancePct} onChange={setTolerancePct} min={0} max={100} />
          </Field>
        </div>
        <label className="row-tight" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
          <span>Blind count — counters do not see the book quantity until the sheet is in review</span>
        </label>
        <Field label="Notes"><TextInput value={notes} onChange={setNotes} placeholder="Quarter-end physical, rack A only…" /></Field>
      </div>
    </Modal>
  );
}
