import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import {
  Badge, Card, CardHead, Field, KeyValue, Loading, Modal, NumberInput,
  Section, StatusBadge, TextArea, TextInput,
} from '../components/ui';
import { api, useRecord } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useViewing } from '../lib/realtime';
import { useItems, useUsers, useVendors } from '../lib/lookups';
import { date, money, number, qty, relative, unitMoney } from '../lib/format';
import { PO_STATUS, VENDOR_STATUS, findOption } from '@shared/domain';
import type { PurchaseOrder, PurchaseOrderLine } from '../lib/types';

export function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { error, success, confirm } = useUi();
  const { can } = useSession();
  const vendors = useVendors();
  const items = useItems();
  const users = useUsers();

  const { data: po, isLoading } = useRecord<PurchaseOrder>('purchaseOrders', id);
  useViewing(po ? po.poNumber : null);

  const [receiving, setReceiving] = useState<{ line: PurchaseOrderLine; index: number } | null>(null);
  const [editing, setEditing] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['record', 'purchaseOrders', id] });
    queryClient.invalidateQueries({ queryKey: ['collection', 'purchaseOrders'] });
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
  };

  if (isLoading || !po) return <div className="page"><Loading rows={8} /></div>;

  const vendor = vendors.get(po.vendorId);
  const writable = can('po.write') && !['received', 'closed', 'cancelled'].includes(po.status);
  const received = po.lines.reduce((sum, line) => sum + (line.received ?? 0), 0);
  const ordered = po.lines.reduce((sum, line) => sum + line.qty, 0);

  const act = async (action: string, body: Record<string, unknown> = {}) => {
    try {
      await api.post(`/purchasing/${po.id}/${action}`, body);
      refresh();
      success(`Purchase order ${action === 'submit' ? 'submitted for approval' : action === 'approve' ? 'approved' : action === 'send' ? 'sent to the vendor' : action}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (action === 'approve' && /override reason/i.test(message)) {
        const reason = await confirm({
          title: 'This vendor is not fully qualified',
          body: message,
          requireReason: 'Why is this order being approved?',
          confirmLabel: 'Approve with override',
          tone: 'warning',
        });
        if (!reason) return;
        try { await api.post(`/purchasing/${po.id}/approve`, { overrideReason: reason }); refresh(); success('Approved with a recorded override'); }
        catch (retryErr) { error(retryErr); }
        return;
      }
      error(err);
    }
  };

  const cancel = async () => {
    const reason = await confirm({
      title: 'Cancel this purchase order',
      body: 'The vendor should be told separately — this only records the cancellation here.',
      requireReason: 'Reason for cancelling',
      confirmLabel: 'Cancel the order',
      tone: 'danger',
    });
    if (!reason) return;
    try { await api.post(`/purchasing/${po.id}/cancel`, { reason }); refresh(); } catch (err) { error(err); }
  };

  return (
    <div className="page">
      <PageHeader
        back={{ to: '/purchasing', label: 'Purchasing' }}
        title={po.poNumber}
        badge={<StatusBadge list={PO_STATUS} value={po.status} large />}
        subtitle={
          <>
            <Link to={`/purchasing/vendors/${po.vendorId}`}>{vendors.name(po.vendorId)}</Link>
            {vendor && vendor.status !== 'approved' && <> · <Badge tone="warning">{findOption(VENDOR_STATUS, vendor.status).label}</Badge></>}
            {' '}· {money(po.total)} · {po.lines.length} line{po.lines.length === 1 ? '' : 's'}
          </>
        }
        actions={
          <>
            {writable && <button type="button" className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={13} /> Edit lines</button>}
            {po.status === 'draft' && can('po.write') && (
              <button type="button" className="btn" onClick={() => act('submit')}>Submit for approval</button>
            )}
            {['draft', 'pending_approval'].includes(po.status) && can('po.approve') && (
              <button type="button" className="btn btn-primary" onClick={() => act('approve')}><Icon name="check" size={13} /> Approve</button>
            )}
            {po.status === 'approved' && can('po.write') && (
              <button type="button" className="btn btn-primary" onClick={() => act('send')}><Icon name="send" size={13} /> Send to vendor</button>
            )}
            {!['received', 'closed', 'cancelled'].includes(po.status) && can('po.approve') && (
              <button type="button" className="btn btn-danger" onClick={cancel}>Cancel</button>
            )}
          </>
        }
      />

      <div className="split">
        <div className="col">
          <Card>
            <CardHead
              title="Lines"
              subtitle={`${number(received)} of ${number(ordered)} units received`}
              icon="clipboard"
            />
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num-cell">Ordered</th>
                    <th className="num-cell">Received</th>
                    <th className="num-cell">Unit cost</th>
                    <th className="num-cell">Extended</th>
                    <th>Expected</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {po.lines.map((line, index) => {
                    const outstanding = Math.max(0, line.qty - (line.received ?? 0));
                    return (
                      <tr key={index}>
                        <td>
                          <div className="cell-primary truncate">{line.description}</div>
                          <div className="cell-sub mono">{line.itemCode ?? items.get(line.itemId)?.itemCode}</div>
                        </td>
                        <td className="num-cell">{qty(line.qty, line.uom)}</td>
                        <td className="num-cell">
                          <span className="tone-text" data-tone={outstanding === 0 ? 'success' : (line.received ?? 0) > 0 ? 'warning' : undefined}>
                            {qty(line.received ?? 0, line.uom)}
                          </span>
                        </td>
                        <td className="num-cell">{unitMoney(line.unitCost)}</td>
                        <td className="num-cell">{money(line.qty * line.unitCost)}</td>
                        <td>{date(line.expectedDate)}</td>
                        <td className="tight">
                          {outstanding > 0 && ['sent', 'approved', 'partial'].includes(po.status) && can('inventory.write') && (
                            <button type="button" className="btn btn-sm" onClick={() => setReceiving({ line, index })}>Receive</button>
                          )}
                          {(line.lotIds ?? []).length > 0 && (
                            <Link to={`/inventory/${line.itemId}`} className="btn btn-sm btn-ghost">Lots</Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="card-foot">
              <div className="row">
                <span className="spacer" />
                <table style={{ width: 260 }}>
                  <tbody>
                    <tr><td className="cell-sub">Subtotal</td><td className="num-cell">{money(po.subtotal)}</td></tr>
                    <tr><td className="cell-sub">Freight</td><td className="num-cell">{money(po.freight)}</td></tr>
                    {po.tax > 0 && <tr><td className="cell-sub">Tax</td><td className="num-cell">{money(po.tax)}</td></tr>}
                    <tr><td className="strong">Total</td><td className="num-cell strong">{money(po.total)}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </Card>

          {po.notes && (
            <Section title="Notes" icon="file">
              <div style={{ whiteSpace: 'pre-wrap' }} className="muted">{po.notes}</div>
            </Section>
          )}
        </div>

        <div className="col">
          <Section title="Order" icon="truck">
            <KeyValue
              items={[
                { label: 'Vendor', value: <Link to={`/purchasing/vendors/${po.vendorId}`}>{vendors.name(po.vendorId)}</Link> },
                { label: 'Buyer', value: users.name(po.buyerId) },
                { label: 'Terms', value: po.terms || '—' },
                { label: 'Ordered', value: date(po.orderedAt) },
                { label: 'Expected', value: date(po.expectedAt) },
                { label: 'Received', value: date(po.receivedAt) },
                { label: 'Approved', value: po.approvedBy ? `${users.name(po.approvedBy)} · ${date(po.approvedAt)}` : 'Not approved' },
                { label: 'Ship to', value: po.shipTo || '—' },
                { label: 'Last change', value: `${relative(po.updatedAt)} by ${users.name(po.updatedBy)}` },
              ]}
            />
          </Section>
        </div>
      </div>

      {receiving && (
        <ReceiveLine
          po={po}
          line={receiving.line}
          onClose={() => setReceiving(null)}
          onDone={() => { setReceiving(null); refresh(); }}
        />
      )}

      <EditLines open={editing} po={po} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); }} />
    </div>
  );
}

function ReceiveLine({ po, line, onClose, onDone }: {
  po: PurchaseOrder; line: PurchaseOrderLine; onClose: () => void; onDone: () => void;
}) {
  const { error, success } = useUi();
  const outstanding = Math.max(0, line.qty - (line.received ?? 0));
  const [amount, setAmount] = useState(outstanding);
  const [vendorLot, setVendorLot] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [coaReceived, setCoaReceived] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const lot = await api.post<{ lotNumber: string; status: string }>('/inventory/receive', {
        itemId: line.itemId,
        qty: amount,
        purchaseOrderId: po.id,
        vendorId: po.vendorId,
        vendorLot,
        expiresAt: expiresAt ? new Date(`${expiresAt}T12:00:00Z`).toISOString() : undefined,
        coaReceived,
        reason: `Received against ${po.poNumber}`,
      });
      success(`Lot ${lot.lotNumber} received`, lot.status === 'quarantine' ? 'Held in quarantine pending QA disposition.' : 'Released to stock.');
      onDone();
    } catch (err) { error(err); } finally { setBusy(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Receive ${line.description}`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy || amount <= 0} onClick={submit}>
            {busy ? <span className="spinner" /> : <Icon name="download" size={14} />} Receive
          </button>
        </>
      }
    >
      <div className="col">
        <KeyValue items={[
          { label: 'Ordered', value: qty(line.qty, line.uom) },
          { label: 'Already received', value: qty(line.received ?? 0, line.uom) },
          { label: 'Outstanding', value: qty(outstanding, line.uom) },
        ]} />
        <div className="field-row">
          <Field label={`Quantity (${line.uom})`}><NumberInput value={amount} onChange={setAmount} min={0} step="0.01" /></Field>
          <Field label="Vendor lot"><TextInput value={vendorLot} onChange={setVendorLot} /></Field>
        </div>
        <Field label="Expiry" hint="Defaults from the item's shelf life if you leave it blank.">
          <TextInput type="date" value={expiresAt} onChange={setExpiresAt} />
        </Field>
        <label className="checkbox">
          <input type="checkbox" checked={coaReceived} onChange={(event) => setCoaReceived(event.target.checked)} />
          The certificate of analysis arrived with this delivery
        </label>
      </div>
    </Modal>
  );
}

function EditLines({ open, po, onClose, onSaved }: {
  open: boolean; po: PurchaseOrder; onClose: () => void; onSaved: () => void;
}) {
  const { error } = useUi();
  const [lines, setLines] = useState<PurchaseOrderLine[]>(po.lines);
  const [freight, setFreight] = useState(po.freight);
  const [notes, setNotes] = useState(po.notes);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/purchasing/${po.id}/lines`, { lines, freight });
      if (notes !== po.notes) await api.patch(`/data/purchaseOrders/${po.id}`, { notes });
      onSaved();
    } catch (err) { error(err); } finally { setBusy(false); }
  };

  const subtotal = lines.reduce((sum, line) => sum + line.qty * line.unitCost, 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      large
      title={`Edit ${po.poNumber}`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>Save</button>
        </>
      }
    >
      <div className="col">
        {lines.map((line, index) => (
          <div key={index} className="row">
            <span className="grow truncate">{line.description}</span>
            <NumberInput
              className="input input-sm input-mono right"
              style={{ width: 108 }}
              value={line.qty}
              onChange={(value) => setLines((current) => current.map((l, i) => (i === index ? { ...l, qty: value } : l)))}
            />
            <NumberInput
              className="input input-sm input-mono right"
              style={{ width: 108 }}
              value={line.unitCost}
              step="0.001"
              onChange={(value) => setLines((current) => current.map((l, i) => (i === index ? { ...l, unitCost: value } : l)))}
            />
            <span className="mono nowrap" style={{ width: 96, textAlign: 'right' }}>{money(line.qty * line.unitCost)}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon"
              onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
              aria-label="Remove line"
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        ))}
        <div className="row">
          <span className="spacer" />
          <Field label="Freight"><NumberInput value={freight} onChange={setFreight} step="0.01" style={{ width: 120 }} /></Field>
        </div>
        <div className="row">
          <span className="spacer" />
          <span className="cell-sub">Subtotal {money(subtotal)} · Total {money(subtotal + freight)}</span>
        </div>
        <Field label="Notes"><TextArea value={notes} onChange={setNotes} rows={3} /></Field>
      </div>
    </Modal>
  );
}
