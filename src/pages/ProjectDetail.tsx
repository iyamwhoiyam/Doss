import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import {
  Avatar, AvatarStack, Badge, Card, CardHead, Field, KeyValue, Loading, Meter,
  Section, Select, StatusBadge, Tabs, TextArea, Toggle,
} from '../components/ui';
import { api, useList, useRecord } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useViewing } from '../lib/realtime';
import { useCustomers, useUsers } from '../lib/lookups';
import { date, relative, toDateInput } from '../lib/format';
import { HEALTH, PRIORITIES, PROJECT_STAGES, PROJECT_TYPES, findOption } from '@shared/domain';
import type { Formula, LabelReview, Project, Quote, Task } from '../lib/types';

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { error, success } = useUi();
  const { can } = useSession();
  const customers = useCustomers();
  const users = useUsers();
  const [tab, setTab] = useState('plan');

  const { data: project, isLoading } = useRecord<Project>('projects', id);
  useViewing(project ? project.code : null);

  const { data: formulas } = useList<Formula>('formulas', { where: { projectId: id ?? '' } }, { enabled: Boolean(id) });
  const { data: quotes } = useList<Quote>('quotes', { where: { projectId: id ?? '' } }, { enabled: Boolean(id) });
  const { data: labels } = useList<LabelReview>('labelReviews', { where: { projectId: id ?? '' } }, { enabled: Boolean(id) });
  const { data: tasks } = useList<Task>('tasks', { where: { refId: id ?? '' }, sort: 'boardOrder' }, { enabled: Boolean(id) });

  const writable = can('projects.write');

  const patch = async (body: Partial<Project>) => {
    try {
      await api.patch(`/data/projects/${id}`, body);
      queryClient.invalidateQueries({ queryKey: ['record', 'projects', id] });
      queryClient.invalidateQueries({ queryKey: ['collection', 'projects'] });
    } catch (err) { error(err); }
  };

  if (isLoading || !project) return <div className="page"><Loading rows={8} /></div>;

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
        back={{ to: '/development', label: 'Development pipeline' }}
        title={project.name}
        badge={
          <>
            <StatusBadge list={PROJECT_STAGES} value={project.stage} large />
            <StatusBadge list={HEALTH} value={project.health} />
            {project.priority !== 'normal' && <StatusBadge list={PRIORITIES} value={project.priority} dot={false} />}
          </>
        }
        subtitle={
          <>
            <span className="mono">{project.code}</span> · {customers.name(project.customerId)} ·
            {' '}{findOption(PROJECT_TYPES, project.type).label} · in {stage.label} since {relative(project.stageEnteredAt)}
          </>
        }
        actions={
          writable && (
            <>
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
              { value: 'linked', label: 'Linked records', count: (formulas?.total ?? 0) + (quotes?.total ?? 0) + (labels?.total ?? 0), icon: 'link' },
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
                    actions={<div style={{ width: 120 }}><Meter value={doneMilestones} max={Math.max(1, project.milestones.length)} /></div>}
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
                  <CardHead title="Stage gates" subtitle="A gate is signed before the project leaves its stage" icon="shield" />
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

                {project.requirements.length > 0 && (
                  <Card>
                    <CardHead title="Customer requirements" icon="clipboard" />
                    <div className="card-body-flush">
                      {project.requirements.map((requirement, index) => (
                        <div key={requirement.label} className="list-row">
                          <span className="grow">{requirement.label}</span>
                          <Badge tone={requirement.met ? 'success' : 'neutral'}>{requirement.met ? 'met' : 'open'}</Badge>
                          <Toggle checked={requirement.met} disabled={!writable} onChange={() => toggleRequirement(index)} />
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {project.risks.length > 0 && (
                  <Section title="Risks" icon="alert">
                    <div className="col-tight">
                      {project.risks.map((risk) => (
                        <div key={risk.label} className="row">
                          <Badge tone={risk.severity === 'high' ? 'danger' : 'warning'}>{risk.severity}</Badge>
                          <span className="grow">{risk.label}</span>
                          {risk.owner && <span className="cell-sub">{users.name(risk.owner)}</span>}
                        </div>
                      ))}
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
              </div>
            )}

            {tab === 'tasks' && (
              <Card>
                <CardHead title="Tasks on this project" icon="check" />
                <div className="card-body-flush">
                  {(tasks?.rows ?? []).map((task) => (
                    <div key={task.id} className="list-row">
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
          <Section title="Project" icon="flask">
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
