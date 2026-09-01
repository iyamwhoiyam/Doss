import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Board, type MoveRequest } from '../components/Board';
import {
  Badge, Combo, DataTable, Field, Modal, NumberInput, SearchInput, Segmented, Select,
  StatusBadge, TextArea, TextInput, type Column,
} from '../components/ui';
import { api } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useViewing } from '../lib/realtime';
import { useCustomers, useUsers } from '../lib/lookups';
import { dateShort, money, number, relative } from '../lib/format';
import { FORMULA_FORMATS, PRIORITIES, RFQ_SOURCE, RFQ_STATUS } from '@shared/domain';
import type { Rfq } from '../lib/types';

interface BoardResponse {
  columns: { value: string; label: string; tone: string; blurb: string; count: number; cards: Rfq[] }[];
  total: number;
}

export function Rfqs() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { error, success } = useUi();
  const { can } = useSession();
  const customers = useCustomers();
  const users = useUsers();
  useViewing('quote requests');

  const [view, setView] = useState<'board' | 'list'>('board');
  const [search, setSearch] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const writable = can('quotes.write');

  const { data, isLoading } = useQuery<BoardResponse>({
    queryKey: ['rfqs', 'board'],
    queryFn: () => api.get<BoardResponse>('/rfqs/board'),
  });

  const all = useMemo(() => (data?.columns ?? []).flatMap((c) => c.cards), [data]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((r) => `${r.rfqNumber} ${r.productName} ${r.customerName} ${r.contactName} ${customers.name(r.customerId)}`.toLowerCase().includes(needle));
  }, [all, search, customers]);

  const move = async (request: MoveRequest) => {
    try {
      await api.post(`/rfqs/${request.id}/move`, { status: request.column, beforeOrder: request.beforeOrder, afterOrder: request.afterOrder });
      queryClient.invalidateQueries({ queryKey: ['rfqs'] });
    } catch (err) {
      queryClient.invalidateQueries({ queryKey: ['rfqs'] });
      error(err, 'That move was refused');
    }
  };

  const convert = async (rfq: Rfq) => {
    try {
      const res = await api.post<{ project: { id: string; code: string } }>(`/rfqs/${rfq.id}/convert`);
      success('Converted to a project', `${res.project.code} created with a draft formula. Opening it now.`);
      queryClient.invalidateQueries({ queryKey: ['rfqs'] });
      navigate(`/development/${res.project.id}`);
    } catch (err) { error(err, 'Could not convert this request'); }
  };

  const columns: Column<Rfq>[] = [
    { key: 'num', header: 'Request', sortValue: (r) => r.rfqNumber, render: (r) => <span className="mono">{r.rfqNumber}</span> },
    { key: 'product', header: 'Product', sortValue: (r) => r.productName, render: (r) => <span className="truncate">{r.productName}</span> },
    { key: 'company', header: 'Company', sortValue: (r) => r.customerName || customers.name(r.customerId), render: (r) => r.customerName || customers.name(r.customerId) || '—' },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, render: (r) => <StatusBadge list={RFQ_STATUS} value={r.status} /> },
    { key: 'qty', header: 'Target qty', numeric: true, sortValue: (r) => r.targetQty, render: (r) => (r.targetQty ? number(r.targetQty) : '—') },
    { key: 'due', header: 'Needed by', sortValue: (r) => r.dueDate ?? '', render: (r) => dateShort(r.dueDate) },
    { key: 'owner', header: 'Owner', sortValue: (r) => users.name(r.ownerId), render: (r) => users.name(r.ownerId) },
  ];

  return (
    <div className="page page-wide">
      <PageHeader
        title="Quote requests"
        subtitle={data ? `${data.total} requests · drag to move through the pipeline` : 'Loading…'}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Request, product, company…" />
            <Segmented value={view} onChange={setView} options={[{ value: 'board', label: 'Board' }, { value: 'list', label: 'List' }]} />
            {writable && (
              <button type="button" className="btn btn-primary" onClick={() => setNewOpen(true)}>
                <Icon name="plus" size={14} /> New request
              </button>
            )}
          </>
        }
      />

      {isLoading && <div className="card"><div className="card-body">Loading requests…</div></div>}

      {!isLoading && view === 'board' && data && (
        <Board
          columns={data.columns.map((c) => ({ value: c.value, label: c.label, tone: c.tone, blurb: c.blurb, meta: `${c.cards.filter((r) => filtered.includes(r)).length} requests` }))}
          items={filtered.map((r) => ({ ...r, column: r.status, order: r.boardOrder }))}
          onMove={move}
          disabled={!writable}
          renderCard={(r) => (
            <RfqCard
              rfq={r}
              company={r.customerName || customers.name(r.customerId)}
              canConvert={writable}
              onConvert={() => convert(r)}
              onOpenProject={() => navigate(`/development/${r.projectId}`)}
            />
          )}
        />
      )}

      {!isLoading && view === 'list' && (
        <div className="card"><DataTable columns={columns} rows={filtered} onRowClick={(r) => { if (r.projectId) navigate(`/development/${r.projectId}`); }} /></div>
      )}

      <NewRfq
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={() => { setNewOpen(false); queryClient.invalidateQueries({ queryKey: ['rfqs'] }); }}
      />
    </div>
  );
}

function RfqCard({ rfq, company, canConvert, onConvert, onOpenProject }: {
  rfq: Rfq; company: string; canConvert: boolean; onConvert: () => void; onOpenProject: () => void;
}) {
  return (
    <div>
      <div className="row-tight" style={{ marginBottom: 4 }}>
        <span className="mono cell-sub">{rfq.rfqNumber}</span>
        <span className="spacer" />
        {rfq.priority !== 'normal' && <StatusBadge list={PRIORITIES} value={rfq.priority} dot={false} />}
      </div>
      <div className="board-card-title truncate">{rfq.productName}</div>
      <div className="board-card-meta"><span className="truncate">{company || 'New prospect'}</span></div>
      <div className="board-card-foot">
        {rfq.targetQty ? <Badge tone="neutral">{number(rfq.targetQty)} u</Badge> : null}
        {rfq.targetPrice ? <Badge tone="info">{money(rfq.targetPrice, 2)}/u</Badge> : null}
        <span className="spacer" />
        {rfq.dueDate ? <span className="cell-sub nowrap">by {dateShort(rfq.dueDate)}</span> : <span className="cell-sub nowrap">{relative(rfq.stageEnteredAt)}</span>}
      </div>
      {rfq.projectId ? (
        <button type="button" className="btn btn-sm btn-ghost btn-block" style={{ marginTop: 6 }} onClick={onOpenProject}>
          Open project <Icon name="arrow-right" size={12} />
        </button>
      ) : canConvert && rfq.status !== 'lost' ? (
        <button type="button" className="btn btn-sm btn-block" style={{ marginTop: 6 }} onClick={onConvert}>
          <Icon name="flask" size={12} /> Convert to project
        </button>
      ) : null}
    </div>
  );
}

function NewRfq({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { error, success } = useUi();
  const customers = useCustomers();
  const [productName, setProductName] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [source, setSource] = useState('email');
  const [format, setFormat] = useState('');
  const [desiredActives, setDesiredActives] = useState('');
  const [targetQty, setTargetQty] = useState(0);
  const [targetPrice, setTargetPrice] = useState(0);
  const [priority, setPriority] = useState('normal');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      await api.post('/rfqs', {
        productName, customerId, customerName, contactName, contactEmail, source, format,
        desiredActives, targetQty, targetPrice, priority,
        dueDate: dueDate ? new Date(`${dueDate}T12:00:00Z`).toISOString() : null,
        notes,
      });
      success('Request logged', 'Triage it on the board and convert it when you’re ready to quote.');
      setProductName(''); setCustomerName(''); setContactName(''); setContactEmail(''); setDesiredActives(''); setNotes('');
      onCreated();
    } catch (err) { error(err, 'Could not log the request'); } finally { setBusy(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      large
      title="New quote request"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!productName || busy} onClick={create}>
            {busy ? <span className="spinner" /> : <Icon name="plus" size={14} />} Log request
          </button>
        </>
      }
    >
      <div className="col">
        <Field label="What do they want?" hint="A short product description."><TextInput value={productName} onChange={setProductName} autoFocus placeholder="e.g. 60-count vitamin D3 + K2 gummy" /></Field>
        <div className="field-row">
          <Field label="Existing customer" hint="Leave blank for a new prospect."><Combo value={customerId} onChange={setCustomerId} options={customers.options} placeholder="None / prospect" /></Field>
          <Field label="Company (if a prospect)"><TextInput value={customerName} onChange={setCustomerName} /></Field>
        </div>
        <div className="field-row">
          <Field label="Contact name"><TextInput value={contactName} onChange={setContactName} /></Field>
          <Field label="Contact email"><TextInput type="email" value={contactEmail} onChange={setContactEmail} /></Field>
        </div>
        <div className="field-row">
          <Field label="Format"><Select value={format} onChange={setFormat} allowEmpty placeholder="Undecided" options={FORMULA_FORMATS.map((f) => ({ value: f.value, label: f.label }))} /></Field>
          <Field label="How did they find us?"><Select value={source} onChange={setSource} options={RFQ_SOURCE.map((s) => ({ value: s.value, label: s.label }))} /></Field>
        </div>
        <Field label="Desired ingredients / actives" hint="Free text — we’ll build the real formula later."><TextArea value={desiredActives} onChange={setDesiredActives} rows={2} placeholder="e.g. Vitamin D3 2000 IU, Vitamin K2 100 mcg, elderberry" /></Field>
        <div className="field-row">
          <Field label="Target quantity"><NumberInput value={targetQty} onChange={setTargetQty} min={0} /></Field>
          <Field label="Target price / unit"><NumberInput value={targetPrice} onChange={setTargetPrice} min={0} dp={2} /></Field>
        </div>
        <div className="field-row">
          <Field label="Priority"><Select value={priority} onChange={setPriority} options={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))} /></Field>
          <Field label="Quote needed by"><TextInput type="date" value={dueDate} onChange={setDueDate} /></Field>
        </div>
        <Field label="Notes"><TextArea value={notes} onChange={setNotes} rows={2} /></Field>
      </div>
    </Modal>
  );
}
