import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Board, type MoveRequest } from '../components/Board';
import { TaskDrawer, TASK_REF_LINK } from '../components/TaskDrawer';
import { ProjectLink } from '../components/ProjectLink';
import {
  Avatar, Badge, Card, CardHead, Combo, Field, Modal, Section, Segmented,
  StatusBadge, TextArea, TextInput, Toggle,
} from '../components/ui';
import { api, useList } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useViewing } from '../lib/realtime';
import { useProjects, useUsers } from '../lib/lookups';
import { date, daysUntil, relative } from '../lib/format';
import { PRIORITIES, TASK_STATUS, WORK_ORDER_STAGES, findOption } from '@shared/domain';
import type { Dashboard, Task } from '../lib/types';

const REF_LINK = TASK_REF_LINK;

export function MyWork() {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const { error, success } = useUi();
  const users = useUsers();
  const projects = useProjects();
  const [params, setParams] = useSearchParams();
  useViewing('their own work');

  const [view, setView] = useState<'board' | 'list'>('board');
  const [everyone, setEveryone] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const { data: tasks } = useList<Task>('tasks', { sort: 'boardOrder', limit: 500 });
  // The open task lives in the URL, so a card, a dashboard row or a shared link all land on it.
  const openId = params.get('task');
  const openTask = openId ? tasks?.rows.find((t) => t.id === openId) ?? null : null;
  const openTaskCard = (id: string | null) => { if (id) params.set('task', id); else params.delete('task'); setParams(params, { replace: true }); };
  const { data: dashboard } = useQuery<Dashboard>({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/dashboard') });

  const mine = useMemo(
    () => (tasks?.rows ?? []).filter((task) => everyone || task.assigneeId === user?.id),
    [tasks, everyone, user],
  );

  const overdue = mine.filter((task) => {
    const days = daysUntil(task.dueDate);
    return task.status !== 'done' && days !== null && days < 0;
  });

  const move = async (request: MoveRequest) => {
    try {
      await api.post('/boards/tasks/move', {
        id: request.id,
        column: request.column,
        beforeOrder: request.beforeOrder,
        afterOrder: request.afterOrder,
      });
      queryClient.invalidateQueries({ queryKey: ['collection', 'tasks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      queryClient.invalidateQueries({ queryKey: ['collection', 'tasks'] });
      error(err);
    }
  };

  const markRead = async () => {
    try {
      await api.post('/notifications/read', {});
      queryClient.invalidateQueries({ queryKey: ['collection', 'notifications'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) { error(err); }
  };

  return (
    <div className="page page-wide">
      <PageHeader
        title="My work"
        subtitle={
          <>
            {mine.filter((task) => task.status !== 'done').length} open task{mine.filter((task) => task.status !== 'done').length === 1 ? '' : 's'}
            {overdue.length > 0 && <> · <span className="tone-text" data-tone="danger">{overdue.length} overdue</span></>}
            {' '}· drag a card to change its state
          </>
        }
        actions={
          <>
            <Toggle checked={everyone} onChange={setEveryone} label="Everyone's tasks" />
            <Segmented value={view} onChange={setView} options={[{ value: 'board', label: 'Board' }, { value: 'list', label: 'List' }]} />
            <button type="button" className="btn btn-primary" onClick={() => setNewOpen(true)}>
              <Icon name="plus" size={14} /> New task
            </button>
          </>
        }
      />

      <div className="split">
        <div className="col">
          {view === 'board' ? (
            <Board
              columns={TASK_STATUS.map((status) => ({ value: status.value, label: status.label, tone: status.tone }))}
              items={mine.map((task) => ({ ...task, column: task.status, order: task.boardOrder }))}
              onMove={move}
              renderCard={(task) => <TaskCard task={task} assigneeName={users.name(task.assigneeId)} showAssignee={everyone} project={task.refType === 'project' ? projects.byId.get(task.refId) : undefined} onOpen={() => openTaskCard(task.id)} />}
            />
          ) : (
            <Card>
              <div className="card-body-flush">
                {mine.map((task) => (
                  <div key={task.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => openTaskCard(task.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') openTaskCard(task.id); }}>
                    <StatusBadge list={TASK_STATUS} value={task.status} />
                    <span className="grow truncate">{task.title}</span>
                    {task.priority !== 'normal' && <StatusBadge list={PRIORITIES} value={task.priority} dot={false} />}
                    {everyone && <Avatar name={users.name(task.assigneeId)} size="sm" />}
                    <span className="cell-sub nowrap">{task.dueDate ? relative(task.dueDate) : '—'}</span>
                  </div>
                ))}
                {mine.length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-6)', textAlign: 'center' }}>Nothing assigned to you.</div>}
              </div>
            </Card>
          )}

          {dashboard && (
            <div className="grid grid-2">
              <Card>
                <CardHead title="Batches you supervise" icon="factory" />
                <div className="card-body-flush">
                  {dashboard.myWork.workOrders.map((wo) => (
                    <Link key={wo.id} to={`/production/${wo.id}`} className="list-row">
                      <StatusBadge list={WORK_ORDER_STAGES} value={wo.stage} />
                      <span className="grow truncate">{wo.woNumber} · {wo.productName}</span>
                    </Link>
                  ))}
                  {dashboard.myWork.workOrders.length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-4)' }}>None.</div>}
                </div>
              </Card>

              <Card>
                <CardHead title="Projects you own" icon="flask" />
                <div className="card-body-flush">
                  {dashboard.myWork.projects.map((project) => (
                    <Link key={project.id} to={`/development/${project.id}`} className="list-row">
                      <Badge tone="neutral">{project.stage.replace('_', ' ')}</Badge>
                      <span className="grow truncate">{project.name}</span>
                    </Link>
                  ))}
                  {dashboard.myWork.projects.length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-4)' }}>None.</div>}
                </div>
              </Card>

              <Card>
                <CardHead title="Quotes you own" icon="calculator" />
                <div className="card-body-flush">
                  {dashboard.myWork.quotes.map((quote) => (
                    <Link key={quote.id} to={`/quotes/${quote.id}`} className="list-row">
                      <Badge tone="neutral">{quote.status}</Badge>
                      <span className="grow truncate">{quote.quoteNumber} · {quote.title}</span>
                    </Link>
                  ))}
                  {dashboard.myWork.quotes.length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-4)' }}>None.</div>}
                </div>
              </Card>

              <Card>
                <CardHead title="Label reviews with you" icon="label" />
                <div className="card-body-flush">
                  {dashboard.myWork.labelReviews.map((review) => (
                    <Link key={review.id} to={`/labels/${review.id}`} className="list-row">
                      <Badge tone={review.metrics?.requiredCorrections ? 'danger' : 'success'}>{review.metrics?.requiredCorrections ?? 0}</Badge>
                      <span className="grow truncate">{review.reviewNumber} · {review.productName}</span>
                    </Link>
                  ))}
                  {dashboard.myWork.labelReviews.length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-4)' }}>None.</div>}
                </div>
              </Card>
            </div>
          )}
        </div>

        <div className="col">
          <Card>
            <CardHead
              title="Notifications"
              subtitle={`${dashboard?.myWork.notifications.length ?? 0} unread`}
              icon="bell"
              actions={(dashboard?.myWork.notifications.length ?? 0) > 0 && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={markRead}>Mark all read</button>
              )}
            />
            <div className="card-body-flush">
              {(dashboard?.myWork.notifications ?? []).map((notification) => (
                <Link key={notification.id} to={notification.link || '/'} className="list-row" style={{ alignItems: 'flex-start' }}>
                  <span data-tone={notification.severity} className="tone-text" style={{ marginTop: 2 }}>
                    <Icon name={notification.severity === 'warning' ? 'alert' : 'info'} size={14} />
                  </span>
                  <span className="grow">
                    <span className="cell-primary" style={{ display: 'block' }}>{notification.title}</span>
                    {notification.body && <span className="cell-sub" style={{ display: 'block' }}>{notification.body}</span>}
                    <span className="cell-sub">{relative(notification.createdAt)}</span>
                  </span>
                </Link>
              ))}
              {(dashboard?.myWork.notifications ?? []).length === 0 && (
                <div className="cell-sub" style={{ padding: 'var(--s-5)', textAlign: 'center' }}>Nothing unread.</div>
              )}
            </div>
          </Card>

          {overdue.length > 0 && (
            <Section title="Overdue" icon="clock" subtitle={`${overdue.length} past their due date`}>
              <div className="col-tight">
                {overdue.map((task) => (
                  <div key={task.id} className="row-tight">
                    <span className="tone-text" data-tone="danger"><Icon name="alert" size={13} /></span>
                    <span className="grow truncate" style={{ fontSize: 'var(--t-sm)' }}>{task.title}</span>
                    <span className="cell-sub nowrap">{date(task.dueDate)}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>

      <TaskDrawer task={openTask} onClose={() => openTaskCard(null)} />


      <NewTask
        open={newOpen}
        onClose={() => setNewOpen(false)}
        userOptions={users.options}
        defaultAssignee={user?.id ?? ''}
        onCreated={() => {
          setNewOpen(false);
          queryClient.invalidateQueries({ queryKey: ['collection', 'tasks'] });
          success('Task created');
        }}
      />
    </div>
  );
}

function TaskCard({ task, assigneeName, showAssignee, project, onOpen }: {
  task: Task; assigneeName: string; showAssignee: boolean; project?: { id: string; code: string; name: string }; onOpen: () => void;
}) {
  const days = daysUntil(task.dueDate);
  const status = findOption(TASK_STATUS, task.status);
  const link = task.refType && task.refId && task.refType !== 'project' ? REF_LINK[task.refType]?.(task.refId) : null;
  // A click opens the task; a drag (pointer moved before release) does not.
  const pressed = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      style={{ cursor: 'pointer' }}
      onPointerDown={(e) => { pressed.current = { x: e.clientX, y: e.clientY }; }}
      onClick={(e) => { const s = pressed.current; pressed.current = null; if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 5) return; onOpen(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      role="button"
      tabIndex={0}
      aria-label={`Open task ${task.title}`}
    >
      <div className="board-card-accent" data-tone={status.tone} />
      <div className="board-card-title">{task.title}</div>
      {task.description && <div className="cell-sub" style={{ marginTop: 4 }}>{task.description}</div>}
      {project && <div style={{ marginTop: 6 }}><ProjectLink id={project.id} code={project.code} name={project.name} /></div>}
      <div className="board-card-foot">
        {task.priority !== 'normal' && <StatusBadge list={PRIORITIES} value={task.priority} dot={false} />}
        {link && <Link to={link} className="cell-sub row-tight" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}><Icon name="link" size={11} /> {task.refLabel || 'linked'}</Link>}
        <span className="spacer" />
        {showAssignee && <Avatar name={assigneeName} size="sm" />}
        {task.dueDate && (
          <span className={days !== null && days < 0 && task.status !== 'done' ? 'tone-text' : 'cell-sub'} data-tone={days !== null && days < 0 ? 'danger' : undefined}>
            {relative(task.dueDate)}
          </span>
        )}
      </div>
    </div>
  );
}

function NewTask({ open, onClose, onCreated, userOptions, defaultAssignee }: {
  open: boolean; onClose: () => void; onCreated: () => void;
  userOptions: { value: string; label: string; sub?: string }[];
  defaultAssignee: string;
}) {
  const { error } = useUi();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState(defaultAssignee);
  const [priority, setPriority] = useState('normal');
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      await api.post('/data/tasks', {
        title, description, assigneeId, priority,
        status: 'todo',
        dueDate: dueDate ? new Date(`${dueDate}T12:00:00Z`).toISOString() : null,
      });
      setTitle(''); setDescription(''); setDueDate('');
      onCreated();
    } catch (err) { error(err); } finally { setBusy(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New task"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!title || busy} onClick={create}>Create</button>
        </>
      }
    >
      <div className="col">
        <Field label="What needs doing"><TextInput value={title} onChange={setTitle} autoFocus /></Field>
        <Field label="Detail"><TextArea value={description} onChange={setDescription} rows={3} /></Field>
        <div className="field-row">
          <Field label="Assignee"><Combo value={assigneeId} onChange={setAssigneeId} options={userOptions} placeholder="Unassigned" /></Field>
          <Field label="Priority">
            <select className="select" value={priority} onChange={(event) => setPriority(event.target.value)}>
              {PRIORITIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Due date"><TextInput type="date" value={dueDate} onChange={setDueDate} /></Field>
      </div>
    </Modal>
  );
}
