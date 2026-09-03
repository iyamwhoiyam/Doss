import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import {
  Badge, Card, CardHead, Combo, DataTable, Field, Flag, KeyValue, Loading, Modal,
  NumberInput, Section, Select, StatusBadge, Tabs, TextArea, type Column,
} from '../components/ui';
import { api } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useLocations, useUsers, useVendors } from '../lib/lookups';
import { date, dateTime, daysUntil, money, number, qty, relative, unitMoney } from '../lib/format';
import { ITEM_TYPES, LOT_STATUS, TXN_TYPES } from '@shared/domain';
import type { InventoryTxn, ItemPosition, Lot } from '../lib/types';

interface PositionDetail extends ItemPosition {
  lots: Lot[];
  transactions: InventoryTxn[];
}

interface Trace {
  lot: Lot;
  item: { name: string; itemCode: string } | null;
  vendor: { id: string; name: string } | null;
  workOrders: { id: string; woNumber: string; batchNumber: string; stage: string; productName: string; actualQty: number }[];
  customers: { id: string; name: string }[];
  shipments: { id: string; shipmentNumber: string; trackingNumber: string; shippedAt: string | null }[];
}

export function ItemDetail() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const vendors = useVendors();
  const locations = useLocations();
  const users = useUsers();

  const [tab, setTab] = useState('lots');
  const [disposition, setDisposition] = useState<Lot | null>(null);
  const [adjusting, setAdjusting] = useState<Lot | null>(null);
  const [transferring, setTransferring] = useState<Lot | null>(null);

  const { data, isLoading } = useQuery<PositionDetail>({
    queryKey: ['inventory', 'item', id],
    queryFn: () => api.get<PositionDetail>(`/inventory/items/${id}/position`),
    enabled: Boolean(id),
  });

  const traceLotId = params.get('lot');
  const { data: trace } = useQuery<Trace>({
    queryKey: ['inventory', 'trace', traceLotId],
    queryFn: () => api.get<Trace>(`/inventory/lots/${traceLotId}/trace`),
    enabled: Boolean(traceLotId),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
    queryClient.invalidateQueries({ queryKey: ['collection', 'lots'] });
  };

  if (isLoading || !data) return <div className="page"><Loading rows={8} /></div>;

  const lotColumns: Column<Lot>[] = [
    { key: 'lot', header: 'Lot', sortValue: (row) => row.lotNumber, render: (row) => (
      <div>
        <div className="mono cell-primary">{row.lotNumber}</div>
        {row.vendorLot && <div className="cell-sub">vendor {row.vendorLot}</div>}
      </div>
    ) },
    { key: 'status', header: 'Status', sortValue: (row) => row.status, render: (row) => <StatusBadge list={LOT_STATUS} value={row.status} /> },
    { key: 'onHand', header: 'On hand', numeric: true, sortValue: (row) => row.qtyOnHand, render: (row) => qty(row.qtyOnHand, row.uom) },
    { key: 'received', header: 'Received', numeric: true, sortValue: (row) => row.qtyReceived, render: (row) => qty(row.qtyReceived, row.uom) },
    { key: 'location', header: 'Location', render: (row) => locations.code(row.locationId) },
    { key: 'expires', header: 'Expires', sortValue: (row) => row.expiresAt ?? '', render: (row) => {
      const days = daysUntil(row.expiresAt);
      return (
        <span data-tone={days !== null && days < 0 ? 'danger' : days !== null && days < 90 ? 'warning' : undefined} className={days !== null && days < 90 ? 'tone-text' : ''}>
          {date(row.expiresAt)}{days !== null && days < 90 ? ` (${days < 0 ? 'expired' : `${days}d`})` : ''}
        </span>
      );
    } },
    { key: 'coa', header: 'COA', render: (row) => (row.coaReceived ? <Badge tone="success">on file</Badge> : <Badge tone="warning">missing</Badge>) },
    { key: 'actions', header: '', align: 'right', render: (row) => (
      <span className="row-tight" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); setParams({ lot: row.id }); }}>Trace</button>
        {can('inventory.dispose') && ['quarantine', 'on_hold'].includes(row.status) && (
          <button type="button" className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setDisposition(row); }}>Disposition</button>
        )}
        {can('inventory.write') && (
          <>
            <button type="button" className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); setAdjusting(row); }}>Adjust</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); setTransferring(row); }}>Move</button>
          </>
        )}
      </span>
    ) },
  ];

  const txnColumns: Column<InventoryTxn>[] = [
    { key: 'txn', header: 'Transaction', render: (row) => <span className="mono">{row.txnNumber}</span> },
    { key: 'type', header: 'Type', render: (row) => <StatusBadge list={TXN_TYPES} value={row.type} dot={false} /> },
    { key: 'qty', header: 'Quantity', numeric: true, render: (row) => (
      <span className="tone-text" data-tone={row.qty < 0 ? 'danger' : 'success'}>{row.qty > 0 ? '+' : ''}{qty(row.qty, row.uom)}</span>
    ) },
    { key: 'balance', header: 'Balance', numeric: true, render: (row) => qty(row.balanceAfter) },
    { key: 'reason', header: 'Reason', render: (row) => <span className="truncate">{row.reason}</span> },
    { key: 'by', header: 'By', render: (row) => users.name(row.createdBy) },
    { key: 'when', header: 'When', render: (row) => relative(row.performedAt) },
  ];

  return (
    <div className="page">
      <PageHeader
        back={{ to: '/inventory', label: 'Inventory' }}
        title={data.name}
        badge={
          <>
            <StatusBadge list={ITEM_TYPES} value={data.type} dot={false} />
            {data.isBranded && <Badge tone="accent" title={data.brandOwner}>branded</Badge>}
          </>
        }
        subtitle={<><span className="mono">{data.itemCode}</span> · {data.category} · {data.form}</>}
      />

      {data.alerts.length > 0 && (
        <div className="col-tight" style={{ marginBottom: 'var(--s-4)' }}>
          {data.alerts.map((alert) => (
            <Flag key={alert.kind} tone={alert.severity} title={alert.message} detail={alert.suggestion} />
          ))}
        </div>
      )}

      <div className="grid grid-4" style={{ marginBottom: 'var(--s-4)' }}>
        {[
          { label: 'Released', value: qty(data.released, data.uom), tone: 'success' },
          { label: 'Quarantine', value: qty(data.quarantined, data.uom), tone: data.quarantined ? 'warning' : 'neutral' },
          { label: 'On order', value: qty(data.onOrder, data.uom), tone: 'info' },
          { label: 'Value on hand', value: money(data.value), tone: 'neutral' },
        ].map((tile) => (
          <div key={tile.label} className="kpi" data-tone={tile.tone}>
            <div className="kpi-label">{tile.label}</div>
            <div className="kpi-value" style={{ fontSize: 'var(--t-xl)' }}>{tile.value}</div>
          </div>
        ))}
      </div>

      <div className="split">
        <div className="col">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'lots', label: 'Lots', count: data.lots.length, icon: 'tag' },
              { value: 'ledger', label: 'Ledger', count: data.transactions.length, icon: 'history' },
              ...(traceLotId ? [{ value: 'trace', label: 'Genealogy', icon: 'git' }] : []),
            ]}
          />

          <div style={{ marginTop: 'var(--s-4)' }}>
            {tab === 'lots' && (
              <Card><DataTable columns={lotColumns} rows={data.lots} /></Card>
            )}
            {tab === 'ledger' && (
              <Card><DataTable columns={txnColumns} rows={data.transactions} /></Card>
            )}
            {tab === 'trace' && trace && (
              <Card>
                <CardHead
                  title={`Lot ${trace.lot.lotNumber}`}
                  subtitle="Where this material came from, and everywhere it went"
                  icon="git"
                  actions={<button type="button" className="btn btn-sm btn-ghost" onClick={() => setParams({})}>Close</button>}
                />
                <div className="card-body col">
                  <KeyValue items={[
                    { label: 'Received from', value: trace.vendor?.name ?? '—' },
                    { label: 'Received', value: date(trace.lot.receivedAt) },
                    { label: 'Expires', value: date(trace.lot.expiresAt) },
                    { label: 'Disposition', value: <StatusBadge list={LOT_STATUS} value={trace.lot.status} /> },
                  ]} />

                  <div>
                    <div className="eyebrow" style={{ marginBottom: 'var(--s-2)' }}>Consumed by</div>
                    {trace.workOrders.length === 0 && <div className="cell-sub">Not yet issued to any batch.</div>}
                    {trace.workOrders.map((wo) => (
                      <Link key={wo.id} to={`/production/${wo.id}`} className="list-row">
                        <Icon name="factory" size={14} className="faint" />
                        <span className="grow truncate">{wo.woNumber} · {wo.productName}</span>
                        <span className="cell-sub">batch {wo.batchNumber}</span>
                      </Link>
                    ))}
                  </div>

                  <div>
                    <div className="eyebrow" style={{ marginBottom: 'var(--s-2)' }}>Reached these customers</div>
                    {trace.customers.length === 0 && <div className="cell-sub">No finished goods from this lot have shipped.</div>}
                    <div className="row-wrap">
                      {trace.customers.map((customer) => (
                        <Link key={customer.id} to={`/customers/${customer.id}`}><Badge tone="accent">{customer.name}</Badge></Link>
                      ))}
                    </div>
                  </div>

                  {trace.shipments.length > 0 && (
                    <div>
                      <div className="eyebrow" style={{ marginBottom: 'var(--s-2)' }}>Shipments</div>
                      {trace.shipments.map((shipment) => (
                        <div key={shipment.id} className="list-row">
                          <Icon name="truck" size={14} className="faint" />
                          <span className="grow">{shipment.shipmentNumber}</span>
                          <span className="mono cell-sub">{shipment.trackingNumber}</span>
                          <span className="cell-sub">{date(shipment.shippedAt)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            )}
          </div>
        </div>

        <div className="col">
          <Section title="Item record" icon="boxes">
            <KeyValue items={[
              { label: 'Unit of measure', value: data.uom },
              { label: 'Standard cost', value: `${unitMoney(data.costPerUom)} / ${data.uom}` },
              { label: 'Price per kg', value: data.pricePerKg ? money(data.pricePerKg) : '—' },
              { label: 'Price source', value: data.priceSource },
              { label: 'Reorder point', value: `${number(data.reorderPoint)} ${data.uom}` },
              { label: 'Reorder quantity', value: `${number(data.reorderQty)} ${data.uom}` },
              { label: 'Safety stock', value: `${number(data.safetyStock)} ${data.uom}` },
              { label: 'Lead time', value: `${data.leadTimeDays} days` },
              { label: 'Preferred vendor', value: data.defaultVendorId ? <Link to={`/purchasing/vendors/${data.defaultVendorId}`}>{vendors.name(data.defaultVendorId)}</Link> : '—' },
              { label: 'Default location', value: locations.name(data.defaultLocationId) },
              { label: 'Shelf life', value: `${data.shelfLifeDays} days` },
              { label: 'Storage', value: data.storageConditions },
              { label: 'Requires COA', value: data.requiresCoa ? 'Yes' : 'No' },
              ...(data.isBranded ? [{ label: 'Trademark owner', value: data.brandOwner }] : []),
              ...(data.allergens.length ? [{ label: 'Allergens', value: data.allergens.join(', ') }] : []),
            ]} />
          </Section>
        </div>
      </div>

      {disposition && (
        <DispositionModal lot={disposition} onClose={() => setDisposition(null)} onDone={() => { setDisposition(null); refresh(); }} />
      )}
      {adjusting && (
        <AdjustModal lot={adjusting} onClose={() => setAdjusting(null)} onDone={() => { setAdjusting(null); refresh(); }} />
      )}
      {transferring && (
        <TransferModal
          lot={transferring}
          locationOptions={locations.options}
          onClose={() => setTransferring(null)}
          onDone={() => { setTransferring(null); refresh(); }}
        />
      )}
    </div>
  );
}

function DispositionModal({ lot, onClose, onDone }: { lot: Lot; onClose: () => void; onDone: () => void }) {
  const { error, success } = useUi();
  const [status, setStatus] = useState('released');
  const [notes, setNotes] = useState('');
  const [coaReceived, setCoaReceived] = useState(lot.coaReceived);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/inventory/lots/${lot.id}/disposition`, { status, notes, coaReceived });
      success(`Lot ${lot.lotNumber} ${status.replace('_', ' ')}`);
      onDone();
    } catch (err) { error(err); } finally { setBusy(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Disposition lot ${lot.lotNumber}`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>
            {busy ? <span className="spinner" /> : <Icon name="check" size={14} />} Record decision
          </button>
        </>
      }
    >
      <div className="col">
        <Field label="Decision">
          <Select
            value={status}
            onChange={setStatus}
            options={[
              { value: 'released', label: 'Release to stock' },
              { value: 'on_hold', label: 'Hold pending investigation' },
              { value: 'rejected', label: 'Reject and scrap' },
              { value: 'quarantine', label: 'Return to quarantine' },
            ]}
          />
        </Field>
        <label className="checkbox">
          <input type="checkbox" checked={coaReceived} onChange={(event) => setCoaReceived(event.target.checked)} />
          The certificate of analysis is on file
        </label>
        <Field label="Notes" hint="Recorded against the lot and in the audit trail.">
          <TextArea value={notes} onChange={setNotes} rows={3} />
        </Field>
        {status === 'rejected' && (
          <Flag tone="danger" title="This scraps the remaining balance" detail={`${qty(lot.qtyOnHand, lot.uom)} will be written off and a scrap transaction posted.`} />
        )}
      </div>
    </Modal>
  );
}

function AdjustModal({ lot, onClose, onDone }: { lot: Lot; onClose: () => void; onDone: () => void }) {
  const { error, success } = useUi();
  const [newQty, setNewQty] = useState(lot.qtyOnHand);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const delta = Number((newQty - lot.qtyOnHand).toFixed(4));

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/inventory/adjust', { lotId: lot.id, newQty, reason });
      success('Adjustment posted', `${delta > 0 ? '+' : ''}${qty(delta, lot.uom)}`);
      onDone();
    } catch (err) { error(err); } finally { setBusy(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Adjust lot ${lot.lotNumber}`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy || reason.trim().length < 4 || delta === 0} onClick={submit}>Post adjustment</button>
        </>
      }
    >
      <div className="col">
        <KeyValue items={[{ label: 'Current on hand', value: qty(lot.qtyOnHand, lot.uom) }]} />
        <Field label={`Counted quantity (${lot.uom})`}>
          <NumberInput value={newQty} onChange={setNewQty} min={0} step="0.001" />
        </Field>
        {delta !== 0 && (
          <div className="row">
            <span className="cell-sub">Variance</span>
            <Badge tone={delta < 0 ? 'danger' : 'success'}>{delta > 0 ? '+' : ''}{qty(delta, lot.uom)}</Badge>
          </div>
        )}
        <Field label="Reason" hint="Every adjustment needs one — it is the only record of why the balance moved.">
          <TextArea value={reason} onChange={setReason} rows={2} placeholder="e.g. Spillage during dispensing, verified by supervisor" />
        </Field>
      </div>
    </Modal>
  );
}

function TransferModal({ lot, locationOptions, onClose, onDone }: {
  lot: Lot; locationOptions: { value: string; label: string; sub?: string }[];
  onClose: () => void; onDone: () => void;
}) {
  const { error, success } = useUi();
  const [toLocationId, setToLocationId] = useState('');
  const [amount, setAmount] = useState(lot.qtyOnHand);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/inventory/transfer', { lotId: lot.id, toLocationId, qty: amount });
      success('Stock moved');
      onDone();
    } catch (err) { error(err); } finally { setBusy(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Move lot ${lot.lotNumber}`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!toLocationId || busy || amount <= 0} onClick={submit}>Move</button>
        </>
      }
    >
      <div className="col">
        <Field label="Destination">
          <Combo value={toLocationId} onChange={setToLocationId} options={locationOptions} placeholder="Choose a location…" allowEmpty={false} />
        </Field>
        <Field label={`Quantity (${lot.uom})`} hint="Moving part of a lot splits it so each location carries its own balance.">
          <NumberInput value={amount} onChange={setAmount} min={0} max={lot.qtyOnHand} step="0.001" />
        </Field>
        <div className="cell-sub">Last moved {dateTime(lot.updatedAt)}</div>
      </div>
    </Modal>
  );
}
