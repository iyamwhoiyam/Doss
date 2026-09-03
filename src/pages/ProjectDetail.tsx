import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { ProjectEditor, type ProjectSection } from '../components/ProjectEditor';
import { ProductJourney } from '../components/ProductJourney';
import { TaskDrawer } from '../components/TaskDrawer';
import { ReferenceNumbers } from '../components/ReferenceNumbers';
import { Icon } from '../components/Icon';
import {
  Avatar, AvatarStack, Badge, Card, CardHead, CopyButton, Field, Flag, KeyValue, Loading, Meter,
  Modal, NumberInput, Section, Select, StatusBadge, Tabs, TextArea, TextInput, Toggle,
} from '../components/ui';
import { api, useRecord, type ListResult } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useViewing } from '../lib/realtime';
import { useCustomers, useProductionLines, useUsers } from '../lib/lookups';
import { date, dateTime, relative, toDateInput } from '../lib/format';
import { HEALTH, PRIORITIES, PRODUCT_LOCK_STATES, PROJECT_STAGES, PROJECT_TYPES, SAMPLE_STATUS, WORK_ORDER_STAGES, findOption } from '@shared/domain';
import type { Formula, Journey, LabelReview, Project, ProjectNumbers, Quote, SalesOrder, Sample, Task, WorkOrder } from '../lib/types';

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { error, success } = useUi();
  const { can } = useSession();
  const customers = useCustomers();
  const users = useUsers();
  const [tab, setTab] = useState('plan');
  const [batchOpen, setBatchOpen] = useState(false);
  const [editSection, setEditSection] = useState<ProjectSection | null>(null);

  const { data: project, isLoading } = useRecord<Project>('projects', id);
  useViewing(project ? project.code : null);

  // Everything linked to the project arrives in one request.
  const { data: related } = useQuery<{
    formulas: ListResult<Formula>; quotes: ListResult<Quote>; labelReviews: ListResult<LabelReview>;
    workOrders: ListResult<WorkOrder>; salesOrders: ListResult<SalesOrder>; samples: ListResult<Sample>; tasks: ListResult<Task>; journey: Journey; numbers: ProjectNumbers;
  }>({ queryKey: ['projects', 'related', id], queryFn: () => api.get(`/projects/${id}/related`), enabled: Boolean(id) });
  const formulas = related?.formulas;
  const quotes = related?.quotes;
  const labels = related?.labelReviews;
  const workOrders = related?.workOrders;
  const samples = related?.samples;
  const tasks = related?.tasks;
  const salesOrders = related?.salesOrders;
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const refreshRelated = () => queryClient.invalidateQueries({ queryKey: ['projects', 'related', id] });

  // A customer-approved product is frozen: the UI disables editing to match the
  // server, which refuses the writes anyway.
  let writable = can('projects.write');

  const patch = async (body: Partial<Project>) => {
    try {
      await api.patch(`/data/projects/${id}`, body);
      queryClient.invalidateQueries({ queryKey: ['record', 'projects', id] });
      queryClient.invalidateQueries({ queryKey: ['collection', 'projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects', 'related', id] });
    } catch (err) { error(err); }
  };

  if (isLoading || !project) return <div className="page"><Loading rows={8} /></div>;

  const lockState = project.lockState ?? 'open';
  if (lockState === 'locked') writable = false;

  const stage = findOption(PROJECT_STAGES, project.stage);
  const doneMilestones = project.milestones.filter((m) => m.done).length;
  const openGates = project.gateChecks.filter((g) => g.gate === project.stage && !g.passed);

  const toggleMilestone = (index: number) => {
    const milestones = project.milestones.map((milestone, i) => (i === index ? {
      ...milestone,
      done: !milestone.done,
      doneAt: !milestone.done ? new Date().toISOString() : null,
    } : milestone));
    void patch({ milestones });
  };

  const toggleGate = (index: number) => {
    const gateChecks = project.gateChecks.map((gate, i) => (i === index ? { ...gate, passed: !gate.passed, by: gate.passed ? '' : users.rows[0]?.id } : gate));
    void patch({ gateChecks });
  };

  const toggleRequirement = (index: number) => {
    const requirements = project.requirements.map((requirement, i) => (i === index ? { ...requirement, met: !requirement.met } : requirement));
    void patch({ requirements });
  };

  return (
    <div className="page">
      <PageHeader
        back={{ to: '/development', label: 'Projects' }}
        title={project.name}
        badge={
          <>
            <StatusBadge list={PROJECT_STAGES} value={project.stage} large />
            <StatusBadge list={HEALTH} value={project.health} />
            {project.priority !== 'normal' && <StatusBadge list={PRIORITIES} value={project.priority} dot={false} />}
            <StatusBadge list={PRODUCT_LOCK_STATES} value={lockState} />
            {(project.productRevision ?? 1) > 1 && <Badge tone="neutral">rev {project.productRevision}</Badge>}
          </>
        }
        subtitle={
          <>
            <span className="mono">{project.code}</span> · {customers.name(project.customerId)} ·
            {' '}{findOption(PROJECT_TYPES, project.type).label} · in {stage.label} since {relative(project.stageEnteredAt)}
            {related?.numbers && (related.numbers.salesOrders.length > 0 || related.numbers.workOrders.length > 0) && (
              <span className="row-wrap" style={{ gap: 4, marginLeft: 8, display: 'inline-flex', verticalAlign: 'middle' }}>
                {related.numbers.salesOrders.map((so) => <Link key={so.id} to={`/orders/${so.id}`} className="ref-chip" data-kind="so" title={`Sales order · ${so.status}${so.customerPo ? ` · PO ${so.customerPo}` : ''}`}>{so.number}</Link>)}
                {related.numbers.workOrders.map((wo) => <Link key={wo.id} to={`/production/${wo.id}`} className="ref-chip" data-kind="mo" title={`Manufacturing order · ${wo.stage.replace(/_/g, ' ')}`}>{wo.number}</Link>)}
              </span>
            )}
          </>
        }
        actions={
          writable && (
            <>
              <button type="button" className="btn" onClick={() => setEditSection('details')}><Icon name="edit" size={14} /> Edit project</button>
              <Select
                value={project.health}
                onChange={(value) => patch({ health: value })}
                options={HEALTH.map((h) => ({ value: h.value, label: h.label }))}
                style={{ width: 150 }}
              />
              <Select
                value={project.stage}
                onChange={(value) => patch({ stage: value })}
                options={[...PROJECT_STAGES, { value: 'on_hold', label: 'On hold' }, { value: 'cancelled', label: 'Cancelled' }].map((s) => ({ value: s.value, label: s.label }))}
                style={{ width: 170 }}
              />
            </>
          )
        }
      />

      <ProductJourney
        journey={related?.journey}
        onAction={(kind) => {
          if (kind === 'batch') setBatchOpen(true);
          else if (kind === 'approval') document.getElementById('product-approval')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }}
      />

      <ProductLockPanel
        project={project}
        onChanged={() => {
          queryClient.invalidateQueries({ queryKey: ['record', 'projects', id] });
          queryClient.invalidateQueries({ queryKey: ['collection', 'projects'] });
        }}
      />

      <ProjectEditor
        open={editSection != null}
        project={project}
        section={editSection ?? 'details'}
        onClose={() => setEditSection(null)}
        onSave={async (body) => { await patch(body); success('Project saved'); }}
      />

      <TaskDrawer task={openTask} onClose={() => setOpenTask(null)} onChanged={refreshRelated} />

      <StartBatchModal
        open={batchOpen}
        project={project}
        onClose={() => setBatchOpen(false)}
        onCreated={(woId) => {
          setBatchOpen(false);
          success('Batch started', 'Materials have been exploded from the formula. Opening the work order.');
          queryClient.invalidateQueries({ queryKey: ['collection', 'workOrders'] });
          queryClient.invalidateQueries({ queryKey: ['production'] });
          navigate(`/production/${woId}`);
        }}
      />

      {openGates.length > 0 && (
        <div className="flag" data-tone="warning" style={{ marginBottom: 'var(--s-4)' }}>
          <span className="flag-mark"><Icon name="shield" size={15} /></span>
          <div>
            <div className="flag-title">{stage.label} gate is open</div>
            <div className="flag-detail">
              {openGates.map((gate) => gate.label).join(' · ')} — record the decision before this project moves forward.
            </div>
          </div>
        </div>
      )}

      <div className="split">
        <div className="col">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'plan', label: 'Plan', count: `${doneMilestones}/${project.milestones.length}`, icon: 'target' },
              { value: 'brief', label: 'Brief', icon: 'file' },
              { value: 'linked', label: 'Linked records', count: (formulas?.total ?? 0) + (quotes?.total ?? 0) + (labels?.total ?? 0) + (workOrders?.total ?? 0) + (samples?.total ?? 0), icon: 'link' },
              { value: 'tasks', label: 'Tasks', count: tasks?.total ?? null, icon: 'check' },
            ]}
          />

          <div style={{ marginTop: 'var(--s-4)' }}>
            {tab === 'plan' && (
              <div className="col">
                <Card>
                  <CardHead
                    title="Milestones"
                    subtitle={`${doneMilestones} of ${project.milestones.length} complete`}
                    icon="target"
                    actions={<div className="row-tight"><div style={{ width: 120 }}><Meter value={doneMilestones} max={Math.max(1, project.milestones.length)} /></div>{writable && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditSection('milestones')}><Icon name="edit" size={12} /> Edit</button>}</div>}
                  />
                  <div className="card-body">
                    <div className="stepper">
                      {project.milestones.map((milestone, index) => (
                        <div key={milestone.name} className="step" data-done={milestone.done ? 'true' : 'false'}>
                          <button type="button" className="step-mark" disabled={!writable} onClick={() => toggleMilestone(index)} aria-label={milestone.name}>
                            {milestone.done ? <Icon name="check" size={12} /> : <span style={{ fontSize: 10 }}>{index + 1}</span>}
                          </button>
                          <div className="grow">
                            <div className="step-name">{milestone.name}</div>
                            <div className="step-meta">
                              {milestone.done ? `Completed ${relative(milestone.doneAt)}` : milestone.due ? `Due ${date(milestone.due)}` : 'No date set'}
                            </div>
                          </div>
                          {!milestone.done && milestone.due && new Date(milestone.due) < new Date() && <Badge tone="danger">overdue</Badge>}
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>

                <Card>
                  <CardHead title="Stage gates" subtitle="A gate is signed before the project leaves its stage" icon="shield" actions={writable ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditSection('gates')}><Icon name="edit" size={12} /> Edit</button> : undefined} />
                  <div className="card-body-flush">
                    {project.gateChecks.map((gate, index) => (
                      <div key={`${gate.gate}-${gate.label}`} className="list-row">
                        <Badge tone={findOption(PROJECT_STAGES, gate.gate).tone}>{findOption(PROJECT_STAGES, gate.gate).label}</Badge>
                        <span className="grow">{gate.label}</span>
                        {gate.by && <span className="cell-sub">{users.name(gate.by)}</span>}
                        <Toggle checked={gate.passed} disabled={!writable} onChange={() => toggleGate(index)} />
                      </div>
                    ))}
                  </div>
                </Card>

                {(project.requirements.length > 0 || writable) && (
                  <Card>
                    <CardHead title="Customer requirements" icon="clipboard" actions={writable ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditSection('requirements')}><Icon name="edit" size={12} /> {project.requirements.length ? 'Edit' : 'Add'}</button> : undefined} />
                    <div className="card-body-flush">
                      {project.requirements.map((requirement, index) => (
                        <div key={requirement.label} className="list-row">
                          <span className="grow">{requirement.label}</span>
                          <Badge tone={requirement.met ? 'success' : 'neutral'}>{requirement.met ? 'met' : 'open'}</Badge>
                          <Toggle checked={requirement.met} disabled={!writable} onChange={() => toggleRequirement(index)} />
                        </div>
                      ))}
                      {project.requirements.length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-4)' }}>No customer requirements captured yet.</div>}
                    </div>
                  </Card>
                )}

                {(project.risks.length > 0 || writable) && (
                  <Section title="Risks" icon="alert" actions={writable ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditSection('risks')}><Icon name="edit" size={12} /> {project.risks.length ? 'Edit' : 'Add'}</button> : undefined}>
                    <div className="col-tight">
                      {project.risks.map((risk) => (
                        <div key={risk.label} className="row">
                          <Badge tone={risk.severity === 'high' ? 'danger' : 'warning'}>{risk.severity}</Badge>
                          <span className="grow">{risk.label}</span>
                          {risk.owner && <span className="cell-sub">{users.name(risk.owner)}</span>}
                        </div>
                      ))}
                      {project.risks.length === 0 && <div className="cell-sub">No risks logged.</div>}
                    </div>
                  </Section>
                )}
              </div>
            )}

            {tab === 'brief' && (
              <Card>
                <CardHead title="Brief" icon="file" />
                <div className="card-body col">
                  {writable ? (
                    <BriefEditor
                      value={project.brief}
                      onSave={async (value) => { await patch({ brief: value }); success('Brief saved'); }}
                    />
                  ) : (
                    <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{project.brief || 'No brief recorded.'}</p>
                  )}
                </div>
              </Card>
            )}

            {tab === 'linked' && (
              <div className="col">
                <Card>
                  <CardHead title="Formulas" icon="beaker" />
                  <div className="card-body-flush">
                    {(formulas?.rows ?? []).map((formula) => (
                      <Link key={formula.id} to={`/formulations/${formula.id}`} className="list-row">
                        <Icon name="beaker" size={14} className="faint" />
                        <span className="grow truncate">{formula.code} · {formula.name}</span>
                        <Badge tone="neutral">rev {formula.revision}</Badge>
                      </Link>
                    ))}
                    {(formulas?.rows ?? []).length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-4)' }}>No formula linked yet.</div>}
                  </div>
                </Card>
                <Card>
                  <CardHead title="Quotes" icon="calculator" />
                  <div className="card-body-flush">
                    {(quotes?.rows ?? []).map((quote) => (
                      <Link key={quote.id} to={`/quotes/${quote.id}`} className="list-row">
                        <Icon name="calculator" size={14} className="faint" />
                        <span className="grow truncate">{quote.quoteNumber} · {quote.title}</span>
                        <Badge tone="neutral">{quote.status}</Badge>
                      </Link>
                    ))}
                    {(quotes?.rows ?? []).length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-4)' }}>No quote raised yet.</div>}
                  </div>
                </Card>
                <Card>
                  <CardHead title="Label reviews" icon="label" />
                  <div className="card-body-flush">
                    {(labels?.rows ?? []).map((label) => (
                      <Link key={label.id} to={`/labels/${label.id}`} className="list-row">
                        <Icon name="label" size={14} className="faint" />
                        <span className="grow truncate">{label.reviewNumber} · {label.productName}</span>
                        <Badge tone={label.metrics?.requiredCorrections ? 'warning' : 'success'}>
                          {label.metrics?.requiredCorrections ?? 0} corrections
                        </Badge>
                      </Link>
                    ))}
                    {(labels?.rows ?? []).length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-4)' }}>No label review opened yet.</div>}
                  </div>
                </Card>
                <Card>
                  <CardHead title="Sales orders" subtitle="SO# — what the customer ordered" icon="cart" />
                  <div className="card-body-flush">
                    {(salesOrders?.rows ?? []).map((so) => (
                      <Link key={so.id} to={`/orders/${so.id}`} className="list-row">
                        <Icon name="cart" size={14} className="faint" />
                        <span className="grow truncate"><span className="mono">{so.orderNumber}</span>{so.customerPo ? ` · PO ${so.customerPo}` : ''} · {so.lines?.[0]?.qty?.toLocaleString() ?? '—'} units</span>
                        <Badge tone="neutral">{so.status.replace(/_/g, ' ')}</Badge>
                      </Link>
                    ))}
                    {(salesOrders?.rows ?? []).length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-4)' }}>No order yet. Orders are created from an accepted quote, or link an existing one under Reference numbers.</div>}
                  </div>
                </Card>
                <Card>
                  <CardHead
                    title="Production"
                    subtitle="MO# — batches run for this product"
                    icon="factory"
                    actions={can('production.write') && project.formulaId ? (
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => setBatchOpen(true)}>
                        <Icon name="play" size={13} /> Start a batch
                      </button>
                    ) : null}
                  />
                  <div className="card-body-flush">
                    {(workOrders?.rows ?? []).map((wo) => (
                      <Link key={wo.id} to={`/production/${wo.id}`} className="list-row">
                        <Icon name="factory" size={14} className="faint" />
                        <span className="grow truncate"><span className="mono">{wo.woNumber}</span> · {wo.plannedQty.toLocaleString()} {wo.uom}{wo.line ? ` · ${wo.line}` : ''}</span>
                        <StatusBadge list={WORK_ORDER_STAGES} value={wo.stage} />
                      </Link>
                    ))}
                    {(workOrders?.rows ?? []).length === 0 && (
                      <div className="cell-sub" style={{ padding: 'var(--s-4)' }}>
                        {project.formulaId ? 'No batch has been run yet — Start a batch to explode the formula into a work order.' : 'Link a formula first, then production can start from here.'}
                      </div>
                    )}
                  </div>
                </Card>
                <Card>
                  <CardHead title="Samples" icon="send" actions={<Link to="/samples" className="btn btn-sm">Sample board</Link>} />
                  <div className="card-body-flush">
                    {(samples?.rows ?? []).map((s) => (
                      <Link key={s.id} to="/samples" className="list-row">
                        <Icon name="send" size={14} className="faint" />
                        <span className="grow truncate"><span className="mono">{s.sampleNumber}</span> · {s.recipientCompany || s.productName}</span>
                        <StatusBadge list={SAMPLE_STATUS} value={s.status} />
                      </Link>
                    ))}
                    {(samples?.rows ?? []).length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-4)' }}>No samples sent for this product yet.</div>}
                  </div>
                </Card>
              </div>
            )}

            {tab === 'tasks' && (
              <Card>
                <CardHead title="Tasks on this project" icon="check" />
                <div className="card-body-flush">
                  {(tasks?.rows ?? []).map((task) => (
                    <div key={task.id} className="list-row" style={{ cursor: 'pointer' }} role="button" tabIndex={0} onClick={() => setOpenTask(task)} onKeyDown={(e) => { if (e.key === 'Enter') setOpenTask(task); }}>
                      <Badge tone={task.status === 'done' ? 'success' : task.status === 'blocked' ? 'danger' : 'neutral'}>{task.status}</Badge>
                      <span className="grow truncate">{task.title}</span>
                      <Avatar name={users.name(task.assigneeId)} size="sm" />
                      <span className="cell-sub nowrap">{task.dueDate ? relative(task.dueDate) : '—'}</span>
                    </div>
                  ))}
                  {(tasks?.rows ?? []).length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-4)' }}>No tasks linked to this project.</div>}
                </div>
              </Card>
            )}
          </div>
        </div>

        <div className="col">
          <ReferenceNumbers projectId={project.id} numbers={related?.numbers} writable={writable} onChanged={refreshRelated} />

          <Section title="Project" icon="flask" actions={writable ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditSection('details')}><Icon name="edit" size={12} /> Edit</button> : undefined}>
            <KeyValue
              items={[
                { label: 'Customer', value: project.customerId ? <Link to={`/customers/${project.customerId}`}>{customers.name(project.customerId)}</Link> : 'Internal' },
                { label: 'Type', value: findOption(PROJECT_TYPES, project.type).label },
                { label: 'Format', value: project.format || '—' },
                { label: 'Owner', value: <span className="row-tight"><Avatar name={users.name(project.ownerId)} size="sm" /> {users.name(project.ownerId)}</span> },
                { label: 'Team', value: <AvatarStack people={project.teamIds.map((teamId) => ({ id: teamId, name: users.name(teamId) }))} /> },
                { label: 'Target launch', value: date(project.targetLaunch) },
                { label: 'Progress', value: <div style={{ width: 130 }}><Meter value={project.progress} /></div> },
                { label: 'Created', value: `${date(project.createdAt)} by ${users.name(project.createdBy)}` },
                { label: 'Last change', value: `${relative(project.updatedAt)} by ${users.name(project.updatedBy)}` },
              ]}
            />
          </Section>

          {writable && (
            <Section title="Schedule" icon="calendar">
              <Field label="Target launch">
                <input
                  className="input"
                  type="date"
                  value={toDateInput(project.targetLaunch)}
                  onChange={(event) => patch({ targetLaunch: event.target.value ? new Date(`${event.target.value}T12:00:00Z`).toISOString() : null })}
                />
              </Field>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function BriefEditor({ value, onSave }: { value: string; onSave: (value: string) => Promise<void> }) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const dirty = draft !== value;

  return (
    <>
      <TextArea value={draft} onChange={setDraft} rows={12} placeholder="What the customer asked for, the format, the channel and any constraints." />
      <div className="row">
        <span className="spacer" />
        {dirty && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(value)}>Discard</button>}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!dirty || busy}
          onClick={async () => { setBusy(true); await onSave(draft); setBusy(false); }}
        >
          {busy ? <span className="spinner" /> : <Icon name="save" size={13} />} Save brief
        </button>
      </div>
    </>
  );
}

function ProductLockPanel({ project, onChanged }: { project: Project; onChanged: () => void }) {
  const { can } = useSession();
  const { success, error, confirm } = useUi();
  const [recordOpen, setRecordOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const state = project.lockState ?? 'open';
  const rev = project.productRevision ?? 1;
  const canLock = can('product.lock');
  const canRevise = can('product.revise');

  const act = async (path: string, body?: unknown, done?: () => void) => {
    setBusy(true);
    try { await api.post(`/projects/${project.id}/${path}`, body); onChanged(); done?.(); }
    catch (err) { error(err); } finally { setBusy(false); }
  };

  const requestApproval = () => act('request-approval', {}, () => success('Sent for customer approval', 'A signing link has been generated below.'));
  const cancelRequest = () => act('cancel-approval', {}, () => success('Approval request withdrawn'));
  const revise = async () => {
    const ok = await confirm({
      title: `Open revision ${rev + 1}?`,
      body: 'This reopens the product for editing. The current customer-approved spec is frozen in the approval history and stays the production-of-record until a new approval is recorded.',
      confirmLabel: 'Open a revision',
      tone: 'warning',
    });
    if (ok) act('revise', { reason: typeof ok === 'string' ? ok : '' }, () => success(`Revision ${rev + 1} opened`, 'The product is editable again.'));
  };

  const link = project.approvalToken ? `${window.location.origin}/approve/${project.approvalToken}` : '';

  return (
    <div id="product-approval">
      {state === 'locked' ? (
        <Card className="lock-banner" style={{ marginBottom: 'var(--s-4)' }}>
          <div className="card-body row" style={{ alignItems: 'center', gap: 'var(--s-4)' }}>
            <span className="tone-text" data-tone="success"><Icon name="lock" size={22} /></span>
            <div className="grow">
              <div className="cell-primary">Customer-approved — locked as the production-of-record (revision {rev})</div>
              <div className="cell-sub">
                Signed by <strong>{project.approval?.signedName}</strong>{project.approval?.signedTitle ? `, ${project.approval.signedTitle}` : ''}
                {project.approval?.at ? ` · ${dateTime(project.approval.at)}` : ''}
                {project.approval?.byName ? ` · recorded by ${project.approval.byName}` : ''}
                {' '}· the formula, label, packaging and price are frozen.
              </div>
            </div>
            {canRevise && (
              <button type="button" className="btn" disabled={busy} onClick={revise}>
                <Icon name="edit" size={14} /> Open a revision
              </button>
            )}
          </div>
        </Card>
      ) : (
        <Card style={{ marginBottom: 'var(--s-4)' }}>
          <CardHead
            title="Product approval"
            subtitle={state === 'pending_approval'
              ? 'Awaiting the customer’s sign-off — still editable until they approve'
              : 'Fully editable. Lock it as the production-of-record when the customer approves.'}
            icon={state === 'pending_approval' ? 'clock' : 'edit'}
            actions={<StatusBadge list={PRODUCT_LOCK_STATES} value={state} />}
          />
          <div className="card-body col" style={{ gap: 'var(--s-3)' }}>
            {state === 'pending_approval' && link && (
              <Flag
                tone="info"
                title="Customer signing link"
                detail={
                  <span className="row" style={{ alignItems: 'center', gap: 'var(--s-2)' }}>
                    <code className="mono truncate" style={{ maxWidth: 420 }}>{link}</code>
                    <CopyButton text={link} />
                  </span>
                }
              />
            )}
            {canLock && (
              <div className="row-tight">
                {state === 'open' && (
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={requestApproval}>
                    <Icon name="send" size={14} /> Request customer approval
                  </button>
                )}
                {state === 'pending_approval' && (
                  <button type="button" className="btn" disabled={busy} onClick={cancelRequest}>
                    Withdraw request
                  </button>
                )}
                <button type="button" className="btn" disabled={busy} onClick={() => setRecordOpen(true)}>
                  <Icon name="check" size={14} /> Record approval &amp; lock
                </button>
              </div>
            )}
            {!canLock && <div className="cell-sub">Only sales, quality, executive or admin can send a product for approval.</div>}
          </div>
        </Card>
      )}

      {(project.approvalHistory ?? []).length > 0 && (
        <Card style={{ marginBottom: 'var(--s-4)' }}>
          <CardHead title="Approval history" icon="history" />
          <div className="card-body-flush">
            {(project.approvalHistory ?? []).slice().reverse().map((a, i) => (
              <div key={i} className="list-row">
                <Badge tone="success">rev {a.revision}</Badge>
                <span className="grow">
                  <span className="cell-primary">{a.signedName}{a.signedTitle ? `, ${a.signedTitle}` : ''}</span>
                  {a.note && <span className="cell-sub" style={{ display: 'block' }}>{a.note}</span>}
                </span>
                <span className="cell-sub nowrap">{a.method === 'customer-signature' ? 'signed in app' : 'recorded'}</span>
                <span className="cell-sub nowrap" title={a.at}>{date(a.at)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <RecordApprovalModal
        open={recordOpen}
        project={project}
        onClose={() => setRecordOpen(false)}
        onDone={() => { setRecordOpen(false); onChanged(); }}
      />
    </div>
  );
}

function RecordApprovalModal({ open, project, onClose, onDone }: {
  open: boolean; project: Project; onClose: () => void; onDone: () => void;
}) {
  const { error, success } = useUi();
  const [signedName, setSignedName] = useState('');
  const [signedTitle, setSignedTitle] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/projects/${project.id}/record-approval`, { signedName, signedTitle, note });
      success('Product locked', `${project.name} is now the customer-approved production-of-record.`);
      setSignedName(''); setSignedTitle(''); setNote('');
      onDone();
    } catch (err) { error(err); } finally { setBusy(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record customer approval"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!signedName.trim() || busy} onClick={submit}>
            {busy ? <span className="spinner" /> : <Icon name="lock" size={14} />} Approve &amp; lock
          </button>
        </>
      }
    >
      <div className="col">
        <Flag tone="warning" title="This locks the whole product package" detail="The formula, label, packaging and approved price freeze as the production-of-record. Changes afterward require a revision." />
        <div className="field-row">
          <Field label="Approved by (customer name)"><TextInput value={signedName} onChange={setSignedName} autoFocus placeholder="Name of the person who approved" /></Field>
          <Field label="Title"><TextInput value={signedTitle} onChange={setSignedTitle} placeholder="e.g. VP Product" /></Field>
        </div>
        <Field label="Note / reference" hint="Optional — PO number, email date, or where the signed approval is filed.">
          <TextArea value={note} onChange={setNote} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}

/**
 * The bridge from a product to the floor: explode the project's formula into a
 * work order (materials, steps, QC checks) and go straight to the batch record.
 */
function StartBatchModal({ open, project, onClose, onCreated }: {
  open: boolean; project: Project; onClose: () => void; onCreated: (workOrderId: string) => void;
}) {
  const { error } = useUi();
  const [plannedQty, setPlannedQty] = useState(10000);
  const [line, setLine] = useState('');
  const [busy, setBusy] = useState(false);
  const lines = useProductionLines();

  const start = async () => {
    setBusy(true);
    try {
      const created = await api.post<{ id: string }>('/production/from-formula', {
        formulaId: project.formulaId, plannedQty, line, priority: project.priority ?? 'normal',
      });
      onCreated(created.id);
    } catch (err) { error(err, 'Could not start the batch'); } finally { setBusy(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Start a batch — ${project.name}`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy || plannedQty <= 0} onClick={start}>
            {busy ? <span className="spinner" /> : <Icon name="play" size={14} />} Create work order
          </button>
        </>
      }
    >
      <div className="col">
        <Flag tone="info" title="This explodes the formula into a work order" detail="Every ingredient and packaging line becomes a material to stage, with overage applied, plus the batch steps and in-process QC checks for this format." />
        <div className="field-row">
          <Field label="Planned quantity (units)"><NumberInput value={plannedQty} onChange={setPlannedQty} min={1} /></Field>
          <Field label="Production line">
            <Select value={line} onChange={setLine} allowEmpty placeholder="Assign later" options={lines.map((l) => ({ value: l, label: l }))} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
