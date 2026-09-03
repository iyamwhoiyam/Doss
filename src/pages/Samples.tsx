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
import { useCustomers, useFormulas, useProjects, useUsers } from '../lib/lookups';
import { dateShort, relative } from '../lib/format';
import { SAMPLE_STATUS, SAMPLE_TYPES, findOption } from '@shared/domain';
import type { Sample } from '../lib/types';

interface BoardResponse {
  columns: { value: string; label: string; tone: string; blurb: string; count: number; cards: Sample[] }[];
  total: number;
}

export function Samples() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { error } = useUi();
  // A sample belongs to a product: open its project, or failing that its formula.
  const openSample = (s: Sample) => {
    if (s.projectId) navigate(`/development/${s.projectId}`);
    else if (s.formulaId) navigate(`/formulations/${s.formulaId}`);
  };
  const { can } = useSession();
  const customers = useCustomers();
  const users = useUsers();
  useViewing('sample tracking');

  const [view, setView] = useState<'board' | 'list'>('board');
  const [search, setSearch] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const writable = can('samples.write');

  const { data, isLoading } = useQuery<BoardResponse>({
    queryKey: ['samples', 'board'],
    queryFn: () => api.get<BoardResponse>('/samples/board'),
  });

  const all = useMemo(() => (data?.columns ?? []).flatMap((c) => c.cards), [data]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((s) => `${s.sampleNumber} ${s.productName} ${s.recipientName} ${s.recipientCompany} ${customers.name(s.customerId)}`.toLowerCase().includes(needle));
  }, [all, search, customers]);

  const move = async (request: MoveRequest) => {
    try {
      await api.post(`/samples/${request.id}/move`, { status: request.column, beforeOrder: request.beforeOrder, afterOrder: request.afterOrder });
      queryClient.invalidateQueries({ queryKey: ['samples'] });
    } catch (err) {
      queryClient.invalidateQueries({ queryKey: ['samples'] });
      error(err, 'That move was refused');
    }
  };

  const columns: Column<Sample>[] = [
    { key: 'num', header: 'Sample', sortValue: (r) => r.sampleNumber, render: (r) => <span className="mono">{r.sampleNumber}</span> },
    { key: 'product', header: 'Product', sortValue: (r) => r.productName, render: (r) => <span className="truncate">{r.productName}</span> },
    { key: 'type', header: 'Type', sortValue: (r) => r.type, render: (r) => <StatusBadge list={SAMPLE_TYPES} value={r.type} dot={false} /> },
    { key: 'customer', header: 'Recipient', sortValue: (r) => r.recipientCompany || customers.name(r.customerId), render: (r) => r.recipientCompany || customers.name(r.customerId) || '—' },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, render: (r) => <StatusBadge list={SAMPLE_STATUS} value={r.status} /> },
    { key: 'tracking', header: 'Tracking', sortValue: (r) => r.trackingNumber, render: (r) => r.trackingNumber || '—' },
    { key: 'due', header: 'Feedback due', sortValue: (r) => r.dueBy ?? '', render: (r) => dateShort(r.dueBy) },
    { key: 'owner', header: 'Owner', sortValue: (r) => users.name(r.ownerId), render: (r) => users.name(r.ownerId) },
  ];

  return (
    <div className="page page-wide">
      <PageHeader
        title="Samples"
        subtitle={data ? `${data.total} samples · drag a card to advance it` : 'Loading…'}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Sample, product, recipient…" />
            <Segmented value={view} onChange={setView} options={[{ value: 'board', label: 'Board' }, { value: 'list', label: 'List' }]} />
            {writable && (
              <button type="button" className="btn btn-primary" onClick={() => setNewOpen(true)}>
                <Icon name="plus" size={14} /> New sample
              </button>
            )}
          </>
        }
      />

      {isLoading && <div className="card"><div className="card-body">Loading samples…</div></div>}

      {!isLoading && view === 'board' && data && (
        <Board
          columns={data.columns.map((c) => ({ value: c.value, label: c.label, tone: c.tone, blurb: c.blurb, meta: `${c.cards.filter((s) => filtered.includes(s)).length} samples` }))}
          items={filtered.map((s) => ({ ...s, column: s.status, order: s.boardOrder }))}
          onMove={move}
          disabled={!writable}
          renderCard={(s) => <SampleCard sample={s} customer={s.recipientCompany || customers.name(s.customerId)} onOpen={() => openSample(s)} />}
        />
      )}

      {!isLoading && view === 'list' && (
        <div className="card"><DataTable columns={columns} rows={filtered} onRowClick={openSample} /></div>
      )}

      <NewSample
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={() => { setNewOpen(false); queryClient.invalidateQueries({ queryKey: ['samples'] }); }}
      />
    </div>
  );
}

function SampleCard({ sample, customer, onOpen }: { sample: Sample; customer: string; onOpen: () => void }) {
  const type = findOption(SAMPLE_TYPES, sample.type);
  const hasHome = Boolean(sample.projectId || sample.formulaId);
  return (
    <div onDoubleClick={hasHome ? onOpen : undefined}>
      <div className="board-card-accent" data-tone={type.tone} />
      <div className="row-tight" style={{ marginBottom: 4 }}>
        <span className="mono cell-sub">{sample.sampleNumber}</span>
        <span className="spacer" />
        <StatusBadge list={SAMPLE_TYPES} value={sample.type} dot={false} />
      </div>
      <div className="board-card-title truncate">{sample.productName}</div>
      <div className="board-card-meta"><span className="truncate">{customer || 'Internal'}</span></div>
      <div className="board-card-foot">
        <Badge tone="neutral">{sample.quantity} {sample.uom}</Badge>
        {sample.trackingNumber && <Badge tone="info">{sample.carrier || 'tracked'}</Badge>}
        <span className="spacer" />
        {sample.status === 'reviewing' && sample.dueBy
          ? <span className="cell-sub nowrap">due {relative(sample.dueBy)}</span>
          : <span className="cell-sub nowrap">{relative(sample.stageEnteredAt)}</span>}
      </div>
      {hasHome && (
        <button type="button" className="btn btn-sm btn-ghost btn-block" style={{ marginTop: 6 }} onClick={onOpen}>
          Open {sample.projectId ? 'project' : 'formula'} <Icon name="arrow-right" size={12} />
        </button>
      )}
    </div>
  );
}

function NewSample({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { error, success } = useUi();
  const customers = useCustomers();
  const formulas = useFormulas();
  const projects = useProjects();
  const [productName, setProductName] = useState('');
  const [type, setType] = useState('customer');
  const [customerId, setCustomerId] = useState('');
  const [formulaId, setFormulaId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [quantity, setQuantity] = useState(3);
  const [recipientName, setRecipientName] = useState('');
  const [recipientCompany, setRecipientCompany] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      await api.post('/samples', { productName, type, customerId, formulaId, projectId, quantity, recipientName, recipientCompany, notes });
      success('Sample logged', 'Track it on the board as it ships and comes back.');
      setProductName(''); setRecipientName(''); setRecipientCompany(''); setNotes('');
      onCreated();
    } catch (err) { error(err, 'Could not log the sample'); } finally { setBusy(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New sample"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!productName || busy} onClick={create}>
            {busy ? <span className="spinner" /> : <Icon name="plus" size={14} />} Log sample
          </button>
        </>
      }
    >
      <div className="col">
        <Field label="Product / description"><TextInput value={productName} onChange={setProductName} autoFocus placeholder="e.g. Elderberry gummy — cherry flavour" /></Field>
        <div className="field-row">
          <Field label="Type"><Select value={type} onChange={setType} options={SAMPLE_TYPES.map((t) => ({ value: t.value, label: t.label }))} /></Field>
          <Field label="Quantity"><NumberInput value={quantity} onChange={setQuantity} min={1} /></Field>
        </div>
        <div className="field-row">
          <Field label="Customer"><Combo value={customerId} onChange={setCustomerId} options={customers.options} placeholder="Optional" /></Field>
          <Field label="Project"><Combo value={projectId} onChange={setProjectId} options={projects.options} placeholder="Optional" /></Field>
        </div>
        <Field label="Formula" hint="Link the formula this sample was made from."><Combo value={formulaId} onChange={setFormulaId} options={formulas.options} placeholder="Optional" /></Field>
        <div className="field-row">
          <Field label="Recipient name"><TextInput value={recipientName} onChange={setRecipientName} /></Field>
          <Field label="Recipient company"><TextInput value={recipientCompany} onChange={setRecipientCompany} /></Field>
        </div>
        <Field label="Notes"><TextArea value={notes} onChange={setNotes} rows={2} /></Field>
      </div>
    </Modal>
  );
}
