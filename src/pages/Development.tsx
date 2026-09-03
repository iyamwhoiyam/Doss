import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Board, type MoveRequest } from '../components/Board';
import { ProjectLink } from '../components/ProjectLink';
import {
  Avatar, Badge, Combo, DataTable, Field, Meter, Modal, SearchInput, Segmented,
  Select, StatusBadge, TextArea, TextInput, type Column,
} from '../components/ui';
import { api, useList } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useViewing } from '../lib/realtime';
import { useCustomers, useUsers } from '../lib/lookups';
import { date, relative } from '../lib/format';
import { HEALTH, PRIORITIES, PROJECT_STAGES, PROJECT_TYPES, findOption } from '@shared/domain';
import type { Project, SalesOrder, WorkOrder } from '../lib/types';

export function Development() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { error, confirm, success } = useUi();
  const { can } = useSession();
  const customers = useCustomers();
  const users = useUsers();
  useViewing('the development pipeline');

  const [params, setParams] = useSearchParams();
  // Arriving with ?stage= (from the dashboard pipeline) opens the list filtered to that stage.
  const stageFilter = params.get('stage') ?? '';
  const lockFilter = params.get('lock') ?? '';
  const [view, setView] = useState<'board' | 'list'>(stageFilter || lockFilter ? 'list' : 'board');
  const [search, setSearch] = useState('');
  const [owner, setOwner] = useState('');
  const [newOpen, setNewOpen] = useState(false);

  const { data, isLoading } = useList<Project>('projects', { sort: 'boardOrder', limit: 500 });
  // The reference numbers on every card: the orders and batches behind each project.
  const { data: orders } = useList<SalesOrder>('salesOrders', { limit: 500, select: ['id', 'orderNumber', 'projectId', 'status', 'customerPo'] });
  const { data: batches } = useList<WorkOrder>('workOrders', { limit: 500, select: ['id', 'woNumber', 'projectId', 'formulaId', 'stage'] });
  const numbersFor = useMemo(() => {
    const so = new Map<string, { id: string; number: string }[]>();
    for (const o of orders?.rows ?? []) if (o.projectId) so.set(o.projectId, [...(so.get(o.projectId) ?? []), { id: o.id, number: o.orderNumber }]);
    const mo = new Map<string, { id: string; number: string }[]>();
    for (const b of batches?.rows ?? []) if (b.projectId) mo.set(b.projectId, [...(mo.get(b.projectId) ?? []), { id: b.id, number: b.woNumber }]);
    return (p: Project) => ({ so: so.get(p.id) ?? [], mo: mo.get(p.id) ?? [] });
  }, [orders, batches]);

  const projects = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.rows ?? []).filter((project) => {
      if (stageFilter && project.stage !== stageFilter) return false;
      if (lockFilter && (project.lockState ?? 'open') !== lockFilter) return false;
      if (owner && project.ownerId !== owner) return false;
      if (!needle) return true;
      return `${project.code} ${project.name} ${customers.name(project.customerId)} ${project.brief}`.toLowerCase().includes(needle);
    });
  }, [data, search, owner, stageFilter, lockFilter, customers]);

  const move = async (request: MoveRequest) => {
    const project = projects.find((p) => p.id === request.id);
    try {
      await api.post('/boards/projects/move', {
        id: request.id,
        column: request.column,
        beforeOrder: request.beforeOrder,
        afterOrder: request.afterOrder,
      });
      queryClient.invalidateQueries({ queryKey: ['collection', 'projects'] });
    } catch (err) {
      queryClient.invalidateQueries({ queryKey: ['collection', 'projects'] });
      const message = err instanceof Error ? err.message : 'That move was refused';
      if (/gate check/i.test(message) && project) {
        const reason = await confirm({
          title: 'Gate checks are still open',
          body: message,
          requireReason: 'Why is this moving anyway?',
          confirmLabel: 'Move with override',
          tone: 'warning',
        });
        if (!reason) return;
        try {
          await api.post('/boards/projects/move', {
            id: request.id, column: request.column,
            beforeOrder: request.beforeOrder, afterOrder: request.afterOrder,
            overrideReason: reason,
          });
          queryClient.invalidateQueries({ queryKey: ['collection', 'projects'] });
          success('Moved with a recorded override');
        } catch (retryErr) { error(retryErr); }
      } else {
        error(err, 'That move was refused');
      }
    }
  };

  const columns: Column<Project>[] = [
    { key: 'code', header: 'Project', sortValue: (row) => row.code, render: (row) => (
      <div><div className="cell-primary">{row.name}</div><ProjectLink id={row.id} code={row.code} /></div>
    ) },
    { key: 'customer', header: 'Customer', sortValue: (row) => customers.name(row.customerId), render: (row) => customers.name(row.customerId) },
    { key: 'numbers', header: 'SO# / MO#', render: (row) => <RefNumbers {...numbersFor(row)} /> },
    { key: 'stage', header: 'Stage', sortValue: (row) => row.stage, render: (row) => <StatusBadge list={PROJECT_STAGES} value={row.stage} /> },
    { key: 'type', header: 'Type', sortValue: (row) => row.type, render: (row) => <StatusBadge list={PROJECT_TYPES} value={row.type} dot={false} /> },
    { key: 'health', header: 'Health', sortValue: (row) => row.health, render: (row) => <StatusBadge list={HEALTH} value={row.health} /> },
    { key: 'progress', header: 'Progress', width: '130px', render: (row) => (
      <div className="row-tight"><div className="grow"><Meter value={row.progress} /></div><span className="cell-sub mono">{row.progress}%</span></div>
    ) },
    { key: 'owner', header: 'Owner', sortValue: (row) => users.name(row.ownerId), render: (row) => (
      <span className="row-tight"><Avatar name={users.name(row.ownerId)} size="sm" /> {users.name(row.ownerId)}</span>
    ) },
    { key: 'launch', header: 'Target launch', sortValue: (row) => row.targetLaunch ?? '', render: (row) => date(row.targetLaunch) },
  ];

  return (
    <div className="page page-wide">
      <PageHeader
        title="Projects"
        subtitle={`${projects.length} projects · click one to open it, drag to advance it through the stage gates`}
        actions={
          <>
            {lockFilter && (
              <button type="button" className="btn btn-sm" onClick={() => { params.delete('lock'); setParams(params); }}>
                <Icon name="x" size={12} /> {lockFilter === 'pending_approval' ? 'Awaiting approval' : lockFilter} only
              </button>
            )}
            {stageFilter && (
              <button type="button" className="btn btn-sm" onClick={() => { params.delete('stage'); setParams(params); }}>
                <Icon name="x" size={12} /> {findOption(PROJECT_STAGES, stageFilter).label} only
              </button>
            )}
            <SearchInput value={search} onChange={setSearch} placeholder="Project, customer, brief…" />
            <Combo value={owner} onChange={setOwner} options={users.options} placeholder="All owners" emptyLabel="All owners" />
            <Segmented value={view} onChange={setView} options={[{ value: 'board', label: 'Board' }, { value: 'list', label: 'List' }]} />
            {can('projects.write') && (
              <button type="button" className="btn btn-primary" onClick={() => setNewOpen(true)}>
                <Icon name="plus" size={14} /> New project
              </button>
            )}
          </>
        }
      />

      {view === 'board' ? (
        <Board
          columns={PROJECT_STAGES.map((stage) => ({
            value: stage.value,
            label: stage.label,
            tone: stage.tone,
            blurb: stage.blurb,
            meta: stage.gate ? <span className="row-tight"><Icon name="shield" size={11} /> gate</span> : stage.blurb,
          }))}
          items={projects.map((project) => ({ ...project, column: project.stage, order: project.boardOrder }))}
          onMove={move}
          disabled={!can('projects.write')}
          renderCard={(project) => (
            <ProjectCard
              project={project}
              customerName={customers.name(project.customerId)}
              ownerName={users.name(project.ownerId)}
              numbers={numbersFor(project)}
              onOpen={() => navigate(`/development/${project.id}`)}
            />
          )}
        />
      ) : (
        <div className="card">
          <DataTable columns={columns} rows={projects} loading={isLoading} onRowClick={(row) => navigate(`/development/${row.id}`)} />
        </div>
      )}

      <NewProject
        open={newOpen}
        onClose={() => setNewOpen(false)}
        customerOptions={customers.options}
        userOptions={users.options}
        onCreated={(id) => { setNewOpen(false); queryClient.invalidateQueries({ queryKey: ['collection', 'projects'] }); navigate(`/development/${id}`); }}
      />
    </div>
  );
}

/** SO# and MO# chips — each opens its record without opening the project. */
function RefNumbers({ so, mo }: { so: { id: string; number: string }[]; mo: { id: string; number: string }[] }) {
  if (!so.length && !mo.length) return <span className="faint">—</span>;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <span className="row-wrap" style={{ gap: 4 }}>
      {so.map((o) => <Link key={o.id} to={`/orders/${o.id}`} className="ref-chip" data-kind="so" onClick={stop} onPointerDown={stop} title="Sales order">{o.number}</Link>)}
      {mo.map((b) => <Link key={b.id} to={`/production/${b.id}`} className="ref-chip" data-kind="mo" onClick={stop} onPointerDown={stop} title="Manufacturing order (batch)">{b.number}</Link>)}
    </span>
  );
}

function ProjectCard({ project, customerName, ownerName, numbers, onOpen }: {
  project: Project; customerName: string; ownerName: string; numbers: { so: { id: string; number: string }[]; mo: { id: string; number: string }[] }; onOpen: () => void;
}) {
  const stage = findOption(PROJECT_STAGES, project.stage);
  const openGates = project.gateChecks.filter((gate) => gate.gate === project.stage && !gate.passed);
  const nextMilestone = project.milestones.find((milestone) => !milestone.done);

  // A click opens the project; a drag (pointer moved before release) does not.
  const pressed = useRef<{ x: number; y: number } | null>(null);
  return (
    <div
      style={{ position: 'relative', cursor: 'pointer' }}
      onPointerDown={(e) => { pressed.current = { x: e.clientX, y: e.clientY }; }}
      onClick={(e) => {
        const start = pressed.current; pressed.current = null;
        if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) return;
        onOpen();
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${project.code} ${project.name}`}
    >
      <div className="board-card-accent" data-tone={stage.tone} />
      <div className="row-tight" style={{ marginBottom: 4 }}>
        <ProjectLink id={project.id} code={project.code} />
        <span className="spacer" />
        <StatusBadge list={HEALTH} value={project.health} />
      </div>
      <div className="board-card-title truncate">{project.name}</div>
      <div className="board-card-meta">
        <span className="truncate">{customerName}</span>
        {project.priority !== 'normal' && <StatusBadge list={PRIORITIES} value={project.priority} dot={false} />}
      </div>

      <div style={{ marginTop: 'var(--s-3)' }}>
        <Meter value={project.progress} tone={stage.tone} />
      </div>

      {(numbers.so.length > 0 || numbers.mo.length > 0) && (
        <div style={{ marginTop: 6 }}><RefNumbers {...numbers} /></div>
      )}

      {nextMilestone && (
        <div className="cell-sub" style={{ marginTop: 6 }}>
          Next: {nextMilestone.name} · {nextMilestone.due ? relative(nextMilestone.due) : 'no date'}
        </div>
      )}

      {openGates.length > 0 && (
        <div className="row-tight" style={{ marginTop: 6 }}>
          <Badge tone="warning"><Icon name="shield" size={10} /> {openGates.length} gate check{openGates.length > 1 ? 's' : ''} open</Badge>
        </div>
      )}

      <div className="board-card-foot">
        <Avatar name={ownerName} size="sm" />
        <span className="cell-sub truncate">{ownerName}</span>
        <span className="spacer" />
        <span className="cell-sub nowrap">{date(project.targetLaunch)}</span>
      </div>
    </div>
  );
}

function NewProject({ open, onClose, onCreated, customerOptions, userOptions }: {
  open: boolean; onClose: () => void; onCreated: (id: string) => void;
  customerOptions: { value: string; label: string; sub?: string }[];
  userOptions: { value: string; label: string; sub?: string }[];
}) {
  const { error } = useUi();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [type, setType] = useState('new_product');
  const [ownerId, setOwnerId] = useState('');
  const [targetLaunch, setTargetLaunch] = useState('');
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const project = await api.post<Project>('/data/projects', {
        name, code: code || `P-${Date.now().toString().slice(-5)}`, customerId, type, ownerId, brief,
        stage: 'intake',
        targetLaunch: targetLaunch ? new Date(`${targetLaunch}T12:00:00Z`).toISOString() : null,
        milestones: [
          { name: 'Brief signed off', due: null, done: false, doneAt: null },
          { name: 'Bench sample to customer', due: null, done: false, doneAt: null },
          { name: 'Pilot batch', due: null, done: false, doneAt: null },
          { name: 'Label approved', due: null, done: false, doneAt: null },
          { name: 'First commercial run', due: null, done: false, doneAt: null },
        ],
        gateChecks: [
          { gate: 'feasibility', label: 'Cost target achievable', passed: false },
          { gate: 'pilot', label: 'Pilot yield ≥ 92%', passed: false },
          { gate: 'validation', label: 'Stability study initiated', passed: false },
        ],
      });
      onCreated(project.id);
    } catch (err) { error(err); } finally { setBusy(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New development project"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!name || busy} onClick={create}>Create</button>
        </>
      }
    >
      <div className="col">
        <Field label="Project name"><TextInput value={name} onChange={setName} placeholder="e.g. Nordvita sleep gummy" autoFocus /></Field>
        <div className="field-row">
          <Field label="Project code" hint="Leave blank to generate one."><TextInput value={code} onChange={setCode} placeholder="Auto" /></Field>
          <Field label="Type"><Select value={type} onChange={setType} options={PROJECT_TYPES.map((t) => ({ value: t.value, label: t.label }))} /></Field>
        </div>
        <div className="field-row">
          <Field label="Customer"><Combo value={customerId} onChange={setCustomerId} options={customerOptions} placeholder="Internal" /></Field>
          <Field label="Owner"><Combo value={ownerId} onChange={setOwnerId} options={userOptions} placeholder="Assign later" /></Field>
        </div>
        <Field label="Target launch"><TextInput type="date" value={targetLaunch} onChange={setTargetLaunch} /></Field>
        <Field label="Brief"><TextArea value={brief} onChange={setBrief} rows={4} placeholder="What the customer asked for, the format, the channel and any constraints." /></Field>
      </div>
    </Modal>
  );
}
