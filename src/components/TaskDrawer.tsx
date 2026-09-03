import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { Icon } from './Icon';
import { Badge, Combo, Drawer, Field, Select, TextArea, TextInput } from './ui';
import { api, useList } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useProjects, useUsers } from '../lib/lookups';
import { dateTime, relative, toDateInput } from '../lib/format';
import { PRIORITIES, TASK_STATUS } from '@shared/domain';
import type { Task, WorkOrder } from '../lib/types';

export const TASK_REF_LINK: Record<string, (id: string) => string> = {
  workOrder: (id) => `/production/${id}`,
  project: (id) => `/development/${id}`,
  purchaseOrder: (id) => `/purchasing/${id}`,
  labelReview: (id) => `/labels/${id}`,
  quote: (id) => `/quotes/${id}`,
  salesOrder: (id) => `/orders/${id}`,
};

/**
 * A task, opened from any card or row: everything on it is editable in place,
 * and the record it belongs to (a project, a batch) is one click away. Saves
 * field by field, the way a job card does, so nothing is lost mid-edit.
 */
export function TaskDrawer({ task, onClose, onChanged }: { task: Task | null; onClose: () => void; onChanged?: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { error, success, confirm } = useUi();
  const { can } = useSession();
  const users = useUsers();
  const projects = useProjects();
  const { data: batches } = useList<WorkOrder>('workOrders', { sort: '-createdAt', limit: 300, select: ['id', 'woNumber', 'productName', 'stage'] }, { enabled: Boolean(task) });
  const writable = can('tasks.write');

  const [draft, setDraft] = useState<Partial<Task>>({});
  const [refKind, setRefKind] = useState<'project' | 'workOrder' | ''>('');
  useEffect(() => {
    if (!task) return;
    setDraft({ title: task.title, description: task.description, status: task.status, priority: task.priority, assigneeId: task.assigneeId, dueDate: task.dueDate, refType: task.refType, refId: task.refId, refLabel: task.refLabel, tags: task.tags });
    setRefKind(task.refType === 'project' || task.refType === 'workOrder' ? task.refType : '');
  }, [task]);

  if (!task) return null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['collection', 'tasks'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['projects', 'related'] });
    onChanged?.();
  };
  const save = async (patch: Partial<Task>) => {
    try {
      await api.patch(`/data/tasks/${task.id}`, patch);
      setDraft((cur) => ({ ...cur, ...patch }));
      refresh();
    } catch (err) { error(err); }
  };
  const commitText = (key: 'title' | 'description') => {
    const value = (draft[key] ?? '').trim();
    if (value === (task[key] ?? '')) return;
    if (key === 'title' && !value) { setDraft((c) => ({ ...c, title: task.title })); return; }
    void save({ [key]: value } as Partial<Task>);
  };
  const link = (kind: 'project' | 'workOrder', id: string) => {
    if (!id) return save({ refType: '', refId: '', refLabel: '' });
    const label = kind === 'project' ? (projects.byId.get(id)?.code ?? '') : (batches?.rows.find((b) => b.id === id)?.woNumber ?? '');
    return save({ refType: kind, refId: id, refLabel: label });
  };
  const remove = async () => {
    const ok = await confirm({ title: 'Delete this task?', body: task.title, confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    try { await api.del(`/data/tasks/${task.id}`); refresh(); success('Task deleted'); onClose(); } catch (err) { error(err); }
  };

  const target = draft.refType && draft.refId ? TASK_REF_LINK[draft.refType]?.(draft.refId) : null;
  const project = draft.refType === 'project' && draft.refId ? projects.byId.get(draft.refId) : null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={<span className="row-tight"><Icon name="check" size={16} /> Task</span>}
      subtitle={<>Created {dateTime(task.createdAt)} · last change {relative(task.updatedAt)}</>}
      badge={<Badge tone={task.status === 'done' ? 'success' : task.status === 'blocked' ? 'danger' : 'neutral'}>{task.status.replace(/_/g, ' ')}</Badge>}
      footer={(
        <>
          {writable && <button type="button" className="btn btn-ghost" onClick={remove}><Icon name="trash" size={14} /> Delete</button>}
          <span className="spacer" />
          {target && <button type="button" className="btn btn-primary" onClick={() => { onClose(); navigate(target); }}><Icon name={draft.refType === 'project' ? 'flask' : 'link'} size={14} /> Open {draft.refType === 'project' ? 'project' : draft.refType === 'workOrder' ? 'batch' : 'linked record'}</button>}
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </>
      )}
    >
      <div className="col">
        <Field label="Title">
          <TextInput value={draft.title ?? ''} onChange={(v) => setDraft((c) => ({ ...c, title: v }))} onBlur={() => commitText('title')} disabled={!writable} />
        </Field>
        <Field label="Details">
          <TextArea value={draft.description ?? ''} onChange={(v) => setDraft((c) => ({ ...c, description: v }))} onBlur={() => commitText('description')} rows={4} disabled={!writable} placeholder="What needs doing, and anything the next person should know." />
        </Field>
        <div className="field-row">
          <Field label="State"><Select value={draft.status ?? 'todo'} onChange={(v) => save({ status: v, completedAt: v === 'done' ? new Date().toISOString() : null })} options={TASK_STATUS.map((s) => ({ value: s.value, label: s.label }))} disabled={!writable} /></Field>
          <Field label="Priority"><Select value={draft.priority ?? 'normal'} onChange={(v) => save({ priority: v })} options={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))} disabled={!writable} /></Field>
        </div>
        <div className="field-row">
          <Field label="Assigned to"><Combo value={draft.assigneeId ?? ''} onChange={(v) => save({ assigneeId: v })} options={users.options} placeholder="Unassigned" disabled={!writable} /></Field>
          <Field label="Due"><TextInput type="date" value={toDateInput(draft.dueDate ?? null)} onChange={(v) => save({ dueDate: v ? new Date(`${v}T12:00:00Z`).toISOString() : null })} disabled={!writable} /></Field>
        </div>

        <Field label="Belongs to" hint="Link the task to the project or batch it is about; the card then opens straight into it.">
          <div className="field-row">
            <Select value={refKind} onChange={(v) => { setRefKind(v as 'project' | 'workOrder' | ''); if (!v) void link('project', ''); }} allowEmpty placeholder="Nothing" options={[{ value: 'project', label: 'A project / product' }, { value: 'workOrder', label: 'A batch (MO)' }]} disabled={!writable} />
            {refKind === 'project' && <Combo value={draft.refType === 'project' ? draft.refId ?? '' : ''} onChange={(v) => link('project', v)} options={projects.options} placeholder="Pick the project" disabled={!writable} />}
            {refKind === 'workOrder' && <Combo value={draft.refType === 'workOrder' ? draft.refId ?? '' : ''} onChange={(v) => link('workOrder', v)} options={(batches?.rows ?? []).map((b) => ({ value: b.id, label: `${b.woNumber} · ${b.productName}`, sub: b.stage }))} placeholder="Pick the batch" disabled={!writable} />}
          </div>
        </Field>
        {project && (
          <div className="flag" data-tone="info">
            <span className="flag-mark"><Icon name="flask" size={14} /></span>
            <div>
              <div className="flag-title">{project.code} · {project.name}</div>
              <div className="flag-detail">{project.stage.replace(/_/g, ' ')} · open the project for its SO#, MO#, formula, quote and approval.</div>
            </div>
          </div>
        )}
        <Field label="Tags" hint="Comma separated.">
          <TextInput value={(draft.tags ?? []).join(', ')} onChange={(v) => setDraft((c) => ({ ...c, tags: v.split(',').map((t) => t.trim()).filter(Boolean) }))} onBlur={() => save({ tags: draft.tags ?? [] })} disabled={!writable} />
        </Field>
      </div>
    </Drawer>
  );
}
