import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Board, type MoveRequest } from '../components/Board';
import {
  Badge, Combo, DataTable, Field, Modal, NumberInput, SearchInput, Segmented, Select,
  StatusBadge, TextInput, type Column,
} from '../components/ui';
import { api, useList } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useViewing } from '../lib/realtime';
import { useCustomers, useFormulas, useProductionLines, useProjects, useUsers } from '../lib/lookups';
import { ProjectLink } from '../components/ProjectLink';
import { compact, dateShort, number, percent, relative } from '../lib/format';
import { PRIORITIES, WORK_ORDER_STAGES, findOption } from '@shared/domain';
import type { WorkOrder } from '../lib/types';

interface BoardResponse {
  columns: { value: string; label: string; tone: string; blurb: string; wipLimit?: number; count: number; overWip: boolean; plannedUnits: number; cards: WorkOrder[] }[];
  cancelled: number;
  total: number;
}

export function Production() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { error, success } = useUi();
  const { can } = useSession();
  const customers = useCustomers();
  const users = useUsers();
  const projects = useProjects();
  const projectForWo = (wo: WorkOrder) => projects.rows.find((p) => p.formulaId && p.formulaId === wo.formulaId);
  const formulas = useFormulas();
  useViewing('the production board');

  const [view, setView] = useState<'board' | 'list'>('board');
  const [search, setSearch] = useState('');
  const [line, setLine] = useState('');
  const [newOpen, setNewOpen] = useState(false);

  const { data, isLoading } = useQuery<BoardResponse>({
    queryKey: ['production', 'board'],
    queryFn: () => api.get<BoardResponse>('/production/board'),
  });

  const allCards = useMemo(() => (data?.columns ?? []).flatMap((column) => column.cards), [data]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allCards.filter((wo) => {
      if (line && wo.line !== line) return false;
      if (!needle) return true;
      return `${wo.woNumber} ${wo.batchNumber} ${wo.productName} ${customers.name(wo.customerId)}`.toLowerCase().includes(needle);
    });
  }, [allCards, search, line, customers]);

  const cardLines = useMemo(() => [...new Set(allCards.map((wo) => wo.line).filter(Boolean))].sort(), [allCards]);
  const lines = useProductionLines(cardLines);

  const move = async (request: MoveRequest) => {
    try {
      await api.post(`/production/${request.id}/move`, {
        stage: request.column,
        beforeOrder: request.beforeOrder,
        afterOrder: request.afterOrder,
      });
      queryClient.invalidateQueries({ queryKey: ['production'] });
    } catch (err) {
      // The card snaps back because the board re-reads from the server.
      queryClient.invalidateQueries({ queryKey: ['production'] });
      error(err, 'That move was refused');
    }
  };

  const columns: Column<WorkOrder>[] = [
    {
      key: 'wo',
      header: 'Work order',
      sortValue: (row) => row.woNumber,
      render: (row) => (
        <div>
          <div className="cell-primary">{row.woNumber}</div>
          <div className="cell-sub">{row.batchNumber}</div>
        </div>
      ),
    },
    { key: 'product', header: 'Product', sortValue: (row) => row.productName, render: (row) => <span className="truncate">{row.productName}</span> },
    { key: 'customer', header: 'Customer', sortValue: (row) => customers.name(row.customerId), render: (row) => customers.name(row.customerId) },
    { key: 'stage', header: 'Stage', sortValue: (row) => row.stage, render: (row) => <StatusBadge list={WORK_ORDER_STAGES} value={row.stage} /> },
    { key: 'line', header: 'Line', sortValue: (row) => row.line, render: (row) => row.line || '—' },
    { key: 'qty', header: 'Planned', numeric: true, sortValue: (row) => row.plannedQty, render: (row) => number(row.plannedQty) },
    { key: 'yield', header: 'Yield', numeric: true, sortValue: (row) => row.yieldPct, render: (row) => (row.yieldPct ? percent(row.yieldPct, 1) : '—') },
    { key: 'start', header: 'Planned start', sortValue: (row) => row.plannedStart ?? '', render: (row) => dateShort(row.plannedStart) },
    { key: 'supervisor', header: 'Supervisor', sortValue: (row) => users.name(row.supervisorId), render: (row) => users.name(row.supervisorId) },
  ];

  return (
    <div className="page page-wide">
      <PageHeader
        title="Production"
        subtitle={data ? `${data.total} work orders · drag a card to move it through the floor` : 'Loading…'}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Work order, batch, product…" />
            {lines.length > 0 && (
              <Select
                value={line}
                onChange={setLine}
                placeholder="All lines"
                allowEmpty
                options={lines.map((l) => ({ value: l, label: l }))}
                style={{ width: 168 }}
              />
            )}
            <Segmented value={view} onChange={setView} options={[{ value: 'board', label: 'Board' }, { value: 'list', label: 'List' }]} />
            {can('production.write') && (
              <button type="button" className="btn btn-primary" onClick={() => setNewOpen(true)}>
                <Icon name="plus" size={14} /> New work order
              </button>
            )}
          </>
        }
      />

      {isLoading && <div className="card"><div className="card-body">Loading the floor…</div></div>}

      {!isLoading && view === 'board' && data && (
        <Board
          columns={data.columns.map((column) => ({
            value: column.value,
            label: column.label,
            tone: column.tone,
            blurb: column.blurb,
            wipLimit: column.wipLimit,
            meta: `${compact(column.cards.filter((c) => filtered.includes(c)).reduce((sum, c) => sum + c.plannedQty, 0))} units planned`,
          }))}
          items={filtered.map((wo) => ({ ...wo, column: wo.stage, order: wo.boardOrder }))}
          onMove={move}
          disabled={!can('production.write')}
          renderCard={(wo) => <WorkOrderCard wo={wo} project={projectForWo(wo)} customerName={customers.name(wo.customerId)} supervisor={users.name(wo.supervisorId)} onOpen={() => navigate(`/production/${wo.id}`)} />}
        />
      )}

      {!isLoading && view === 'list' && (
        <div className="card">
          <DataTable columns={columns} rows={filtered} onRowClick={(row) => navigate(`/production/${row.id}`)} />
        </div>
      )}

      <NewWorkOrder
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(id) => {
          success('Work order created', 'Materials have been exploded from the formula.');
          queryClient.invalidateQueries({ queryKey: ['production'] });
          navigate(`/production/${id}`);
        }}
        formulaOptions={formulas.options}
        userOptions={users.options}
        lines={lines}
      />
    </div>
  );
}

function WorkOrderCard({ wo, customerName, supervisor, onOpen, project }: {
  wo: WorkOrder; customerName: string; supervisor: string; onOpen: () => void; project?: { id: string; code: string } | null;
}) {
  const stage = findOption(WORK_ORDER_STAGES, wo.stage);
  const issued = wo.materials.filter((m) => m.issuedQty > 0).length;
  const steps = wo.steps.filter((s) => s.done).length;
  // A click opens the batch; a drag (pointer moved before release) does not.
  const pressed = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      style={{ cursor: 'pointer' }}
      onPointerDown={(e) => { pressed.current = { x: e.clientX, y: e.clientY }; }}
      onClick={(e) => {
        const start = pressed.current; pressed.current = null;
        if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) return;
        onOpen();
      }}
    >
      <div className="board-card-accent" data-tone={stage.tone} />
      <div className="row-tight" style={{ marginBottom: 4 }}>
        <span className="mono cell-sub">{wo.woNumber}</span>
        <span className="spacer" />
        {wo.priority !== 'normal' && <StatusBadge list={PRIORITIES} value={wo.priority} dot={false} />}
      </div>
      <div className="board-card-title truncate">{wo.productName}</div>
      <div className="board-card-meta">
        <span className="truncate">{customerName}</span>
        {wo.line && <><span>·</span><span>{wo.line}</span></>}
        {project && <><span>·</span><ProjectLink id={project.id} code={project.code} /></>}
      </div>

      {wo.stage === 'qc_hold' && wo.holdReason && (
        <div className="flag" data-tone="danger" style={{ marginTop: 'var(--s-2)', padding: 'var(--s-2)' }}>
          <div className="flag-detail" style={{ fontSize: 'var(--t-xs)' }}>{wo.holdReason}</div>
        </div>
      )}

      <div className="board-card-foot">
        <Badge tone="neutral">{compact(wo.plannedQty)} u</Badge>
        {wo.stage !== 'planned' && <Badge tone={issued === wo.materials.length ? 'success' : 'warning'}>{issued}/{wo.materials.length} staged</Badge>}
        {['in_process', 'qa_review', 'complete'].includes(wo.stage) && <Badge tone="progress">{steps}/{wo.steps.length} steps</Badge>}
        <span className="spacer" />
        <span className="cell-sub nowrap" title={`Supervisor: ${supervisor}`}>{relative(wo.stageEnteredAt)}</span>
      </div>
      <button type="button" className="btn btn-sm btn-ghost btn-block" style={{ marginTop: 6 }} onClick={onOpen}>
        Open batch record <Icon name="arrow-right" size={12} />
      </button>
    </div>
  );
}

function NewWorkOrder({ open, onClose, onCreated, formulaOptions, userOptions, lines }: {
  open: boolean; onClose: () => void; onCreated: (id: string) => void;
  formulaOptions: { value: string; label: string; sub?: string }[];
  userOptions: { value: string; label: string; sub?: string }[];
  lines: string[];
}) {
  const { error } = useUi();
  const [formulaId, setFormulaId] = useState('');
  const [plannedQty, setPlannedQty] = useState(10000);
  const [line, setLine] = useState('');
  const [priority, setPriority] = useState('normal');
  const [supervisorId, setSupervisorId] = useState('');
  const [plannedStart, setPlannedStart] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: orders } = useList<{ id: string; orderNumber: string; customerId: string }>('salesOrders', {
    where: { status: { $in: ['confirmed', 'in_production'] } }, sort: '-createdAt', limit: 60,
  }, { enabled: open });
  const [salesOrderId, setSalesOrderId] = useState('');

  const create = async () => {
    setBusy(true);
    try {
      const created = await api.post<{ id: string }>('/production/from-formula', {
        formulaId, plannedQty, line, priority, supervisorId, salesOrderId,
        plannedStart: plannedStart ? new Date(`${plannedStart}T08:00:00`).toISOString() : null,
      });
      onCreated(created.id);
      onClose();
    } catch (err) {
      error(err, 'Could not create the work order');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New work order"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!formulaId || plannedQty <= 0 || busy} onClick={create}>
            {busy ? <span className="spinner" /> : <Icon name="plus" size={14} />} Create
          </button>
        </>
      }
    >
      <div className="col">
        <Field label="Formula" hint="The bill of materials is exploded from this formula, with overage applied.">
          <Combo value={formulaId} onChange={setFormulaId} options={formulaOptions} placeholder="Choose a formula…" />
        </Field>
        <div className="field-row">
          <Field label="Planned quantity (units)">
            <NumberInput value={plannedQty} onChange={setPlannedQty} min={1} />
          </Field>
          <Field label="Priority">
            <Select value={priority} onChange={setPriority} options={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))} />
          </Field>
        </div>
        <div className="field-row">
          <Field label="Production line">
            <Select
              value={line}
              onChange={setLine}
              allowEmpty
              placeholder="Assign later"
              options={lines.map((l) => ({ value: l, label: l }))}
            />
          </Field>
          <Field label="Planned start">
            <TextInput type="date" value={plannedStart} onChange={setPlannedStart} />
          </Field>
        </div>
        <div className="field-row">
          <Field label="Supervisor">
            <Combo value={supervisorId} onChange={setSupervisorId} options={userOptions} placeholder="Assign later" />
          </Field>
          <Field label="Against sales order" hint="Optional — links the batch to a customer order.">
            <Combo
              value={salesOrderId}
              onChange={setSalesOrderId}
              options={(orders?.rows ?? []).map((o) => ({ value: o.id, label: o.orderNumber }))}
              placeholder="None"
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
