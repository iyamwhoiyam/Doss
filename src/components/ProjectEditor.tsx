import { useEffect, useState } from 'react';

import { Icon } from './Icon';
import { Badge, CheckBox, Combo, Drawer, Field, NumberInput, Select, TextArea, TextInput, Toggle } from './ui';
import { useCustomers, useFormulas, useUsers } from '../lib/lookups';
import { useList } from '../lib/api';
import { toDateInput } from '../lib/format';
import { FORMULA_FORMATS, HEALTH, PRIORITIES, PROJECT_STAGES, PROJECT_TYPES } from '@shared/domain';
import type { GateCheck, Milestone, Project, Quote, Requirement, Risk } from '../lib/types';

export type ProjectSection = 'details' | 'milestones' | 'gates' | 'requirements' | 'risks';

const SECTIONS: { value: ProjectSection; label: string; icon: string }[] = [
  { value: 'details', label: 'Details', icon: 'flask' },
  { value: 'milestones', label: 'Milestones', icon: 'target' },
  { value: 'gates', label: 'Stage gates', icon: 'shield' },
  { value: 'requirements', label: 'Requirements', icon: 'clipboard' },
  { value: 'risks', label: 'Risks', icon: 'alert' },
];

const toIso = (value: string) => (value ? new Date(`${value}T12:00:00Z`).toISOString() : null);

/**
 * Everything on a project, editable in one place. Opens on the section that
 * was clicked, saves as a single patch. The server still refuses writes to a
 * locked product, and the caller only opens this when the project is writable.
 */
export function ProjectEditor({ open, project, section = 'details', onClose, onSave }: {
  open: boolean; project: Project; section?: ProjectSection; onClose: () => void;
  onSave: (patch: Partial<Project>) => Promise<void>;
}) {
  const customers = useCustomers();
  const users = useUsers();
  const formulas = useFormulas();
  const { data: quotes } = useList<Quote>('quotes', { where: { projectId: project.id }, limit: 100 }, { enabled: open });

  const [tab, setTab] = useState<ProjectSection>(section);
  const [draft, setDraft] = useState<Partial<Project>>({});
  const [busy, setBusy] = useState(false);
  const [teamPick, setTeamPick] = useState('');

  // Re-seed the draft each time the drawer opens for a (possibly changed) project.
  useEffect(() => {
    if (!open) return;
    setTab(section);
    setDraft({
      name: project.name, code: project.code, customerId: project.customerId, type: project.type, format: project.format,
      priority: project.priority, health: project.health, stage: project.stage, ownerId: project.ownerId,
      teamIds: [...(project.teamIds ?? [])], formulaId: project.formulaId, quoteId: project.quoteId,
      targetLaunch: project.targetLaunch, progress: project.progress, tags: [...(project.tags ?? [])], notes: project.notes,
      milestones: (project.milestones ?? []).map((m) => ({ ...m })),
      gateChecks: (project.gateChecks ?? []).map((g) => ({ ...g })),
      requirements: (project.requirements ?? []).map((r) => ({ ...r })),
      risks: (project.risks ?? []).map((r) => ({ ...r })),
    });
  }, [open, project, section]);

  const set = (patch: Partial<Project>) => setDraft((cur) => ({ ...cur, ...patch }));
  const list = <T,>(key: 'milestones' | 'gateChecks' | 'requirements' | 'risks') => (draft[key] ?? []) as unknown as T[];
  const setList = <T,>(key: 'milestones' | 'gateChecks' | 'requirements' | 'risks', rows: T[]) => set({ [key]: rows } as Partial<Project>);
  const updateAt = <T,>(key: 'milestones' | 'gateChecks' | 'requirements' | 'risks', index: number, patch: Partial<T>) =>
    setList<T>(key, list<T>(key).map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const removeAt = (key: 'milestones' | 'gateChecks' | 'requirements' | 'risks', index: number) =>
    setList(key, list(key).filter((_, i) => i !== index));
  const moveAt = (key: 'milestones' | 'gateChecks' | 'requirements' | 'risks', index: number, dir: -1 | 1) => {
    const rows = [...list<unknown>(key)];
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    [rows[index], rows[target]] = [rows[target], rows[index]];
    setList(key, rows);
  };

  const save = async () => {
    setBusy(true);
    try {
      const patch: Partial<Project> = {
        ...draft,
        name: (draft.name ?? '').trim(),
        code: (draft.code ?? '').trim().toUpperCase(),
        progress: Math.max(0, Math.min(100, Number(draft.progress) || 0)),
        milestones: list<Milestone>('milestones').filter((m) => m.name.trim()),
        gateChecks: list<GateCheck>('gateChecks').filter((g) => g.label.trim()),
        requirements: list<Requirement>('requirements').filter((r) => r.label.trim()),
        risks: list<Risk>('risks').filter((r) => r.label.trim()),
      };
      await onSave(patch);
      onClose();
    } finally { setBusy(false); }
  };

  const valid = Boolean(draft.name?.trim() && draft.code?.trim());
  const rowBtn = (label: string, onClick: () => void, disabled = false) => (
    <button type="button" className="btn btn-sm btn-ghost" onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      {label === 'Remove' ? <Icon name="trash" size={13} /> : label === 'Up' ? '↑' : '↓'}
    </button>
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      wide
      title={`Edit ${project.code}`}
      subtitle="Every field on the project. Changes save together when you press Save."
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!valid || busy}><Icon name="save" size={14} /> Save project</button>
        </>
      )}
    >
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 'var(--s-4)' }}>
        {SECTIONS.map((s) => (
          <button key={s.value} type="button" className={`btn btn-sm ${tab === s.value ? 'btn-primary' : ''}`} onClick={() => setTab(s.value)}>
            <Icon name={s.icon} size={12} /> {s.label}
            {s.value !== 'details' && <Badge tone="neutral">{list(s.value === 'gates' ? 'gateChecks' : s.value).length}</Badge>}
          </button>
        ))}
      </div>

      {tab === 'details' && (
        <div className="col">
          <div className="field-row">
            <Field label="Project name"><TextInput value={draft.name ?? ''} onChange={(v) => set({ name: v })} /></Field>
            <Field label="Code" hint="Must be unique."><TextInput value={draft.code ?? ''} onChange={(v) => set({ code: v.toUpperCase() })} /></Field>
          </div>
          <div className="field-row">
            <Field label="Customer"><Combo value={draft.customerId ?? ''} onChange={(v) => set({ customerId: v })} options={customers.options} placeholder="Internal" emptyLabel="Internal" /></Field>
            <Field label="Type"><Select value={draft.type ?? ''} onChange={(v) => set({ type: v })} options={PROJECT_TYPES.map((t) => ({ value: t.value, label: t.label }))} /></Field>
          </div>
          <div className="field-row">
            <Field label="Format"><Select value={draft.format ?? ''} onChange={(v) => set({ format: v })} allowEmpty placeholder="—" options={FORMULA_FORMATS.map((f) => ({ value: f.value, label: f.label }))} /></Field>
            <Field label="Priority"><Select value={draft.priority ?? 'normal'} onChange={(v) => set({ priority: v })} options={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))} /></Field>
          </div>
          <div className="field-row">
            <Field label="Stage"><Select value={draft.stage ?? ''} onChange={(v) => set({ stage: v })} options={[...PROJECT_STAGES, { value: 'on_hold', label: 'On hold' }, { value: 'cancelled', label: 'Cancelled' }].map((s) => ({ value: s.value, label: s.label }))} /></Field>
            <Field label="Health"><Select value={draft.health ?? ''} onChange={(v) => set({ health: v })} options={HEALTH.map((h) => ({ value: h.value, label: h.label }))} /></Field>
          </div>
          <div className="field-row">
            <Field label="Owner"><Combo value={draft.ownerId ?? ''} onChange={(v) => set({ ownerId: v })} options={users.options} placeholder="Pick an owner" /></Field>
            <Field label="Target launch"><TextInput type="date" value={toDateInput(draft.targetLaunch ?? null)} onChange={(v) => set({ targetLaunch: toIso(v) })} /></Field>
          </div>
          <Field label="Team" hint={draft.teamIds?.length ? `${draft.teamIds.length} on the team` : 'Add people one at a time.'}>
            <div className="col-tight">
              <Combo value={teamPick} onChange={(v) => { if (v && !(draft.teamIds ?? []).includes(v)) set({ teamIds: [...(draft.teamIds ?? []), v] }); setTeamPick(''); }} options={users.options.filter((o) => !(draft.teamIds ?? []).includes(o.value))} placeholder="Add a team member" />
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {(draft.teamIds ?? []).map((id) => (
                  <Badge key={id} tone="neutral">{users.name(id)} <button type="button" className="btn btn-sm btn-ghost" onClick={() => set({ teamIds: (draft.teamIds ?? []).filter((x) => x !== id) })} aria-label={`Remove ${users.name(id)}`}>×</button></Badge>
                ))}
              </div>
            </div>
          </Field>
          <div className="field-row">
            <Field label="Formula" hint="The formula this product runs on."><Combo value={draft.formulaId ?? ''} onChange={(v) => set({ formulaId: v })} options={formulas.options} placeholder="None yet" emptyLabel="None" /></Field>
            <Field label="Quote"><Combo value={draft.quoteId ?? ''} onChange={(v) => set({ quoteId: v })} options={(quotes?.rows ?? []).map((q) => ({ value: q.id, label: `${q.quoteNumber} · ${q.title}` }))} placeholder="None yet" emptyLabel="None" /></Field>
          </div>
          <div className="field-row">
            <Field label="Progress %"><NumberInput value={draft.progress ?? 0} onChange={(v) => set({ progress: v })} min={0} max={100} /></Field>
            <Field label="Tags" hint="Comma separated."><TextInput value={(draft.tags ?? []).join(', ')} onChange={(v) => set({ tags: v.split(',').map((t) => t.trim()).filter(Boolean) })} placeholder="gummy, launch-q4" /></Field>
          </div>
          <Field label="Notes"><TextArea value={draft.notes ?? ''} onChange={(v) => set({ notes: v })} rows={4} /></Field>
        </div>
      )}

      {tab === 'milestones' && (
        <div className="col">
          {list<Milestone>('milestones').map((m, i) => (
            <div key={i} className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
              <Field label={i === 0 ? 'Milestone' : undefined} className="grow"><TextInput value={m.name} onChange={(v) => updateAt<Milestone>('milestones', i, { name: v })} placeholder="e.g. Pilot batch" /></Field>
              <Field label={i === 0 ? 'Due' : undefined}><TextInput type="date" value={toDateInput(m.due)} onChange={(v) => updateAt<Milestone>('milestones', i, { due: toIso(v) })} /></Field>
              <Field label={i === 0 ? 'Done' : undefined}><Toggle checked={m.done} onChange={(v) => updateAt<Milestone>('milestones', i, { done: v, doneAt: v ? (m.doneAt ?? new Date().toISOString()) : null })} /></Field>
              <div className="row-tight">{rowBtn('Up', () => moveAt('milestones', i, -1), i === 0)}{rowBtn('Down', () => moveAt('milestones', i, 1), i === list('milestones').length - 1)}{rowBtn('Remove', () => removeAt('milestones', i))}</div>
            </div>
          ))}
          <div><button type="button" className="btn btn-sm" onClick={() => setList<Milestone>('milestones', [...list<Milestone>('milestones'), { name: '', due: null, done: false, doneAt: null }])}><Icon name="plus" size={12} /> Add milestone</button></div>
        </div>
      )}

      {tab === 'gates' && (
        <div className="col">
          <p className="cell-sub">A gate must be passed before the project can leave that stage on the board.</p>
          {list<GateCheck>('gateChecks').map((g, i) => (
            <div key={i} className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
              <Field label={i === 0 ? 'Stage' : undefined}><Select value={g.gate} onChange={(v) => updateAt<GateCheck>('gateChecks', i, { gate: v })} options={PROJECT_STAGES.map((s) => ({ value: s.value, label: s.label }))} /></Field>
              <Field label={i === 0 ? 'Check' : undefined} className="grow"><TextInput value={g.label} onChange={(v) => updateAt<GateCheck>('gateChecks', i, { label: v })} placeholder="e.g. Customer signed off on spec" /></Field>
              <Field label={i === 0 ? 'Passed' : undefined}><Toggle checked={g.passed} onChange={(v) => updateAt<GateCheck>('gateChecks', i, { passed: v })} /></Field>
              <div className="row-tight">{rowBtn('Up', () => moveAt('gateChecks', i, -1), i === 0)}{rowBtn('Down', () => moveAt('gateChecks', i, 1), i === list('gateChecks').length - 1)}{rowBtn('Remove', () => removeAt('gateChecks', i))}</div>
            </div>
          ))}
          <div><button type="button" className="btn btn-sm" onClick={() => setList<GateCheck>('gateChecks', [...list<GateCheck>('gateChecks'), { gate: draft.stage ?? PROJECT_STAGES[0].value, label: '', passed: false }])}><Icon name="plus" size={12} /> Add gate check</button></div>
        </div>
      )}

      {tab === 'requirements' && (
        <div className="col">
          {list<Requirement>('requirements').map((r, i) => (
            <div key={i} className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
              <Field label={i === 0 ? 'Customer requirement' : undefined} className="grow"><TextInput value={r.label} onChange={(v) => updateAt<Requirement>('requirements', i, { label: v })} placeholder="e.g. Vegan, no gelatin" /></Field>
              <Field label={i === 0 ? 'Met' : undefined}><CheckBox checked={r.met} onChange={(v) => updateAt<Requirement>('requirements', i, { met: v })} /></Field>
              <div className="row-tight">{rowBtn('Up', () => moveAt('requirements', i, -1), i === 0)}{rowBtn('Down', () => moveAt('requirements', i, 1), i === list('requirements').length - 1)}{rowBtn('Remove', () => removeAt('requirements', i))}</div>
            </div>
          ))}
          <div><button type="button" className="btn btn-sm" onClick={() => setList<Requirement>('requirements', [...list<Requirement>('requirements'), { label: '', met: false }])}><Icon name="plus" size={12} /> Add requirement</button></div>
        </div>
      )}

      {tab === 'risks' && (
        <div className="col">
          {list<Risk>('risks').map((r, i) => (
            <div key={i} className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
              <Field label={i === 0 ? 'Risk' : undefined} className="grow"><TextInput value={r.label} onChange={(v) => updateAt<Risk>('risks', i, { label: v })} placeholder="e.g. Single-source active with 12-week lead time" /></Field>
              <Field label={i === 0 ? 'Severity' : undefined}><Select value={r.severity} onChange={(v) => updateAt<Risk>('risks', i, { severity: v })} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} /></Field>
              <Field label={i === 0 ? 'Owner' : undefined}><Combo value={r.owner ?? ''} onChange={(v) => updateAt<Risk>('risks', i, { owner: v })} options={users.options} placeholder="—" /></Field>
              <div className="row-tight">{rowBtn('Remove', () => removeAt('risks', i))}</div>
            </div>
          ))}
          <div><button type="button" className="btn btn-sm" onClick={() => setList<Risk>('risks', [...list<Risk>('risks'), { label: '', severity: 'medium', owner: '' }])}><Icon name="plus" size={12} /> Add risk</button></div>
        </div>
      )}
    </Drawer>
  );
}
