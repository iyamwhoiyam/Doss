import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import {
  Badge, BarChart, Card, CardHead, EmptyState, Loading, Meter, Section, StatusBadge,
} from '../components/ui';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useRealtime } from '../lib/realtime';
import { useCustomers, useUsers } from '../lib/lookups';
import { compact, dateShort, number, relative } from '../lib/format';
import { PRIORITIES, WORK_ORDER_STAGES } from '@shared/domain';
import type { Dashboard as DashboardData } from '../lib/types';

function Greeting({ name }: { name: string }) {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return <>{part}, {name.split(' ')[0]}</>;
}

export function Dashboard() {
  const { user } = useSession();
  const navigate = useNavigate();
  const { status } = useRealtime();
  const customers = useCustomers();
  const users = useUsers();

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/dashboard'),
  });

  if (isLoading || !data) {
    return <div className="page"><Loading rows={9} /></div>;
  }

  const totalStages = data.production.reduce((sum, stage) => sum + stage.count, 0) || 1;

  return (
    <div className="page">
      <PageHeader
        title={<Greeting name={user?.name ?? 'there'} />}
        subtitle={
          <span className="row-tight">
            {status === 'live' ? <><span className="live-dot" /> Live — everything on this page updates as your colleagues work</> : 'Reconnecting to live updates…'}
          </span>
        }
        actions={<span className="cell-sub">Refreshed {relative(data.generatedAt)}</span>}
      />

      <div className="grid grid-kpi" style={{ marginBottom: 'var(--s-5)' }}>
        {data.kpis.map((kpi) => (
          <Link key={kpi.key} to={kpi.link} className="kpi" data-tone={kpi.tone}>
            <div className="kpi-label">{kpi.label}</div>
            <div className="kpi-value">{kpi.value}</div>
            <div className="kpi-detail">{kpi.detail}</div>
          </Link>
        ))}
      </div>

      <div className="split">
        <div className="col">
          <Section
            title="On the floor"
            subtitle="Work orders by stage"
            icon="factory"
            actions={<Link to="/production" className="btn btn-sm">Open board <Icon name="arrow-right" size={12} /></Link>}
          >
            <div className="col-tight">
              {data.production.map((stage) => (
                <div key={stage.value} className="row" data-tone={stage.tone}>
                  <span style={{ width: 116, fontSize: 'var(--t-sm)' }} className="truncate">{stage.label}</span>
                  <div className="grow"><Meter value={stage.count} max={totalStages} tone={stage.tone} /></div>
                  <span className="mono" style={{ width: 26, textAlign: 'right', fontSize: 'var(--t-sm)' }}>{stage.count}</span>
                  <span className="cell-sub mono" style={{ width: 74, textAlign: 'right' }}>{compact(stage.units)} u</span>
                </div>
              ))}
            </div>
          </Section>

          <Section
            title="Batches released"
            subtitle="Last twelve weeks"
            icon="chart"
          >
            <BarChart
              data={data.throughput.map((week) => ({ label: dateShort(week.weekOf), value: week.batches }))}
              format={(value) => `${value} batches`}
            />
            <div className="row" style={{ marginTop: 'var(--s-3)', justifyContent: 'space-between' }}>
              <span className="cell-sub">{dateShort(data.throughput[0]?.weekOf)}</span>
              <span className="cell-sub">
                {number(data.throughput.reduce((sum, w) => sum + w.units, 0))} units released
              </span>
              <span className="cell-sub">{dateShort(data.throughput.at(-1)?.weekOf)}</span>
            </div>
          </Section>

          <Card>
            <CardHead
              title="Scheduled next"
              subtitle="Open work orders by planned start"
              icon="calendar"
              actions={<Link to="/production" className="btn btn-sm btn-ghost">All</Link>}
            />
            <div className="card-body-flush">
              {data.schedule.length === 0 && <EmptyState icon="calendar" title="Nothing scheduled" body="Work orders will appear here once they have a planned start date." />}
              {data.schedule.map((wo) => (
                <Link key={wo.id} to={`/production/${wo.id}`} className="list-row">
                  <StatusBadge list={WORK_ORDER_STAGES} value={wo.stage} />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="cell-primary truncate" style={{ display: 'block' }}>{wo.woNumber} · {wo.productName}</span>
                    <span className="cell-sub">{wo.customerName || 'Internal'} · {wo.line || 'Line to be assigned'}</span>
                  </span>
                  {wo.priority !== 'normal' && <StatusBadge list={PRIORITIES} value={wo.priority} dot={false} />}
                  <span className="cell-sub nowrap">{dateShort(wo.plannedStart)}</span>
                  <span className="mono cell-sub nowrap">{compact(wo.plannedQty)}</span>
                </Link>
              ))}
            </div>
          </Card>
        </div>

        <div className="col">
          <Card>
            <CardHead
              title="Needs attention"
              subtitle={`${data.alerts.length} open`}
              icon="alert"
            />
            <div className="card-body-flush" style={{ maxHeight: 420, overflowY: 'auto' }}>
              {data.alerts.length === 0 && <EmptyState icon="check-circle" title="Nothing needs you right now" body="Stock is above reorder, no batches are held, and every document is current." />}
              {data.alerts.map((alert, index) => (
                <Link key={index} to={alert.link} className="list-row" style={{ alignItems: 'flex-start' }}>
                  <span data-tone={alert.severity} className="tone-text" style={{ marginTop: 2 }}>
                    <Icon name={alert.severity === 'danger' ? 'alert' : 'info'} size={14} />
                  </span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="row-tight">
                      <span className="cell-primary truncate">{alert.title}</span>
                      <Badge tone="neutral">{alert.module}</Badge>
                    </span>
                    <span className="cell-sub" style={{ display: 'block' }}>{alert.detail}</span>
                  </span>
                </Link>
              ))}
            </div>
          </Card>

          <Card>
            <CardHead
              title="Your work"
              subtitle={`${data.myWork.tasks.length} open task${data.myWork.tasks.length === 1 ? '' : 's'}`}
              icon="check"
              actions={<Link to="/my-work" className="btn btn-sm btn-ghost">Open</Link>}
            />
            <div className="card-body-flush">
              {data.myWork.tasks.slice(0, 6).map((task) => (
                <div key={task.id} className="list-row">
                  <Icon name="check" size={13} className="faint" />
                  <span className="grow truncate">{task.title}</span>
                  <span className="cell-sub nowrap">{task.dueDate ? relative(task.dueDate) : '—'}</span>
                </div>
              ))}
              {data.myWork.tasks.length === 0 && (
                <div className="cell-sub" style={{ padding: 'var(--s-5)', textAlign: 'center' }}>No open tasks assigned to you.</div>
              )}
            </div>
            {(data.myWork.quotes.length > 0 || data.myWork.labelReviews.length > 0 || data.myWork.projects.length > 0) && (
              <div className="card-foot row-wrap" style={{ gap: 'var(--s-2)' }}>
                {data.myWork.projects.length > 0 && <Link to="/my-work"><Badge tone="accent">{data.myWork.projects.length} projects</Badge></Link>}
                {data.myWork.quotes.length > 0 && <Badge tone="info">{data.myWork.quotes.length} quotes</Badge>}
                {data.myWork.labelReviews.length > 0 && <Badge tone="warning">{data.myWork.labelReviews.length} label reviews</Badge>}
              </div>
            )}
          </Card>

          <Card>
            <CardHead title="Activity" subtitle="What everyone is doing" icon="activity" />
            <div className="card-body" style={{ maxHeight: 430, overflowY: 'auto' }}>
              <div className="timeline">
                {data.activity.map((entry) => (
                  <div key={entry.id} className="timeline-item" style={entry.link ? { cursor: 'pointer' } : undefined} onClick={() => { if (entry.link) navigate(entry.link); }} role={entry.link ? 'link' : undefined}>
                    <span className="timeline-mark" data-tone={entry.tone}>
                      <Icon name={
                        entry.type === 'work_order' ? 'factory'
                          : entry.type === 'lot' ? 'boxes'
                            : entry.type === 'quote' ? 'calculator'
                              : entry.type === 'document' ? 'folder'
                                : entry.type === 'label_review' ? 'label'
                                  : entry.type === 'purchase_order' ? 'truck'
                                    : entry.type === 'project' ? 'flask'
                                      : 'activity'
                      } size={12} />
                    </span>
                    <div className="timeline-body">
                      <div className="timeline-title">{entry.title}</div>
                      {entry.detail && <div className="timeline-meta truncate">{entry.detail}</div>}
                      <div className="timeline-meta">
                        {users.name(entry.actorId) !== '—' ? users.name(entry.actorId) : entry.actorName} · {relative(entry.createdAt)}
                      </div>
                    </div>
                  </div>
                ))}
                {data.activity.length === 0 && <div className="cell-sub">Nothing recorded yet.</div>}
              </div>
            </div>
          </Card>

          <Section title="Pipeline" subtitle="Development projects by stage" icon="flask"
            actions={<Link to="/development" className="btn btn-sm btn-ghost">Board</Link>}>
            <div className="col-tight">
              {data.pipeline.filter((stage) => stage.count > 0).map((stage) => (
                <Link key={stage.value} to={`/development?stage=${stage.value}`} className="row list-row" title={`Open the ${stage.label} projects`}>
                  <Badge tone={stage.tone}>{stage.count}</Badge>
                  <span className="grow truncate" style={{ fontSize: 'var(--t-sm)' }}>{stage.label}</span>
                  <Icon name="arrow-right" size={12} className="faint" />
                </Link>
              ))}
              {data.pipeline.every((stage) => stage.count === 0) && <div className="cell-sub">No active projects.</div>}
            </div>
            <div className="cell-sub" style={{ marginTop: 'var(--s-3)' }}>
              {customers.rows.filter((c) => c.status === 'active').length} active customers on the book.
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
