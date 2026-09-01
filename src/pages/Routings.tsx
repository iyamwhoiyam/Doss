import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import {
  Badge, Card, CardHead, CheckBox, Drawer, EmptyState, Field, Loading, NumberInput, Select, TextInput, Toggle,
} from '../components/ui';
import { api, useList, useSave } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useViewing } from '../lib/realtime';
import { money, number } from '../lib/format';
import { FORMULA_FORMATS, findOption } from '@shared/domain';
import type { Routing, RoutingOperation } from '../lib/types';

/** Minutes an operation takes at a batch size — mirrors the server's routing math. */
function opMinutes(op: RoutingOperation, qty: number) {
  const run = op.runRatePerHour > 0 ? (qty / op.runRatePerHour) * 60 : (op.runMin ?? 0);
  return (op.setupMin || 0) + run;
}
function opCost(op: RoutingOperation, minutes: number) {
  return (minutes / 60) * (op.laborRate || 0) * (op.crew || 0);
}
const minutesLabel = (m: number) => (m >= 90 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m)} min`);

const blankOp = (seq: number): RoutingOperation => ({
  seq, name: '', workCenter: '', setupMin: 0, runRatePerHour: 0, runMin: 0, crew: 1, laborRate: 28, requiresSignature: false,
});

const blankRouting = (): Partial<Routing> => ({
  code: '', name: '', format: 'capsule', isDefault: false, hoursPerShift: 8, operations: [blankOp(1)], notes: '', tags: [],
});

export function Routings() {
  useViewing('routings');
  const queryClient = useQueryClient();
  const { error, success, confirm } = useUi();
  const { can } = useSession();
  const writable = can('production.write');

  const { data, isLoading } = useList<Routing>('routings', { sort: 'code', limit: 200 });
  const { data: linesSetting } = useList<{ key: string; value: string[] }>('settings', { where: { key: 'production.lines' }, limit: 1 });
  const lines = useMemo(() => {
    const configured = linesSetting?.rows?.[0]?.value ?? [];
    const used = (data?.rows ?? []).flatMap((r) => r.operations.map((o) => o.workCenter)).filter(Boolean);
    return [...new Set([...configured, ...used])];
  }, [linesSetting, data]);

  const save = useSave<Routing>('routings');
  const [editing, setEditing] = useState<Partial<Routing> | null>(null);
  const [previewQty, setPreviewQty] = useState(10000);
  const [busy, setBusy] = useState(false);

  const rows = data?.rows ?? [];

  const addStandard = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ added: number }>('/production/routings/defaults');
      queryClient.invalidateQueries({ queryKey: ['collection', 'routings'] });
      success(result.added ? `${result.added} standard routing${result.added === 1 ? '' : 's'} added` : 'All standard routings are already here');
    } catch (err) { error(err); } finally { setBusy(false); }
  };

  const persist = async () => {
    if (!editing) return;
    if (!editing.code?.trim() || !editing.name?.trim()) { error('A routing needs a code and a name'); return; }
    const operations = (editing.operations ?? []).filter((o) => o.name.trim()).map((o, i) => ({ ...o, seq: i + 1 }));
    if (!operations.length) { error('Add at least one operation'); return; }
    try {
      await save.mutateAsync({ ...editing, operations });
      success('Routing saved');
      setEditing(null);
    } catch (err) { error(err); }
  };

  const archive = async (routing: Routing) => {
    const ok = await confirm({ title: `Archive ${routing.code}?`, body: 'Batches already planned keep their steps; new batches fall back to the format default.', confirmLabel: 'Archive', tone: 'danger' });
    if (!ok) return;
    try {
      await api.del(`/data/routings/${routing.id}`);
      queryClient.invalidateQueries({ queryKey: ['collection', 'routings'] });
      success('Routing archived');
    } catch (err) { error(err); }
  };

  const updateOp = (index: number, patch: Partial<RoutingOperation>) => {
    setEditing((cur) => cur ? { ...cur, operations: (cur.operations ?? []).map((o, i) => (i === index ? { ...o, ...patch } : o)) } : cur);
  };
  const moveOp = (index: number, dir: -1 | 1) => {
    setEditing((cur) => {
      if (!cur) return cur;
      const ops = [...(cur.operations ?? [])];
      const target = index + dir;
      if (target < 0 || target >= ops.length) return cur;
      [ops[index], ops[target]] = [ops[target], ops[index]];
      return { ...cur, operations: ops.map((o, i) => ({ ...o, seq: i + 1 })) };
    });
  };

  if (isLoading) return <div className="page"><Loading rows={6} /></div>;

  const byFormat = new Map<string, Routing[]>();
  for (const r of rows) byFormat.set(r.format, [...(byFormat.get(r.format) ?? []), r]);

  return (
    <div className="page page-wide">
      <PageHeader
        title="Routings"
        subtitle="How each dosage format runs: the operations in order, the line they run on, setup and run rates, and the crew. A batch copies its routing when it is planned, which sets its standard labor and how long it holds the line."
        actions={writable ? (
          <>
            <button type="button" className="btn" onClick={addStandard} disabled={busy}><Icon name="sparkles" size={14} /> Add Enova standard routings</button>
            <button type="button" className="btn btn-primary" onClick={() => setEditing(blankRouting())}><Icon name="plus" size={14} /> New routing</button>
          </>
        ) : undefined}
      />

      <div className="row" style={{ alignItems: 'center', gap: 'var(--s-3)', marginBottom: 'var(--s-4)' }}>
        <span className="cell-sub">Preview timings at a batch of</span>
        <div style={{ width: 130 }}><NumberInput value={previewQty} onChange={(v) => setPreviewQty(Math.max(1, v || 1))} min={1} /></div>
        <span className="cell-sub">units</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="sliders"
          title="No routings yet"
          body="Batches will start with a generic step list until a routing exists for their format. Add Enova's standard routings to begin, then tune the rates to your lines."
          action={writable ? <button type="button" className="btn btn-primary" onClick={addStandard} disabled={busy}><Icon name="sparkles" size={14} /> Add Enova standard routings</button> : undefined}
        />
      ) : (
        <div className="col">
          {[...byFormat.entries()].map(([format, list]) => (
            <div key={format}>
              <div className="cell-sub" style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 'var(--t-xs)', margin: 'var(--s-3) 0 var(--s-2)' }}>
                {findOption(FORMULA_FORMATS, format)?.label ?? format}
              </div>
              <div className="col">
                {list.map((routing) => {
                  const totalMin = routing.operations.reduce((s, o) => s + opMinutes(o, previewQty), 0);
                  const totalCost = routing.operations.reduce((s, o) => s + opCost(o, opMinutes(o, previewQty)), 0);
                  const days = Math.max(1, Math.ceil(totalMin / ((routing.hoursPerShift || 8) * 60)));
                  return (
                    <Card key={routing.id}>
                      <CardHead
                        icon="sliders"
                        title={<span className="row-tight"><span className="mono">{routing.code}</span><span>{routing.name}</span>{routing.isDefault && <Badge tone="accent">default</Badge>}</span>}
                        subtitle={`${routing.operations.length} operations · ${minutesLabel(totalMin)} · ${days} working day${days === 1 ? '' : 's'} on a ${routing.hoursPerShift || 8} h shift · ${money(totalCost, 0)} standard labor · ${money(totalCost / previewQty, 4)} per unit`}
                        actions={writable ? (
                          <div className="row-tight">
                            <button type="button" className="btn btn-sm" onClick={() => setEditing({ ...routing, operations: routing.operations.map((o) => ({ ...o })) })}><Icon name="edit" size={13} /> Edit</button>
                            <button type="button" className="btn btn-sm" onClick={() => archive(routing)} aria-label={`Archive ${routing.code}`}><Icon name="archive" size={13} /></button>
                          </div>
                        ) : undefined}
                      />
                      <div className="table-wrap">
                        <table className="table">
                          <thead>
                            <tr>
                              <th style={{ width: 40 }}>#</th><th>Operation</th><th>Work center</th>
                              <th className="num">Setup</th><th className="num">Run rate</th><th className="num">Crew</th><th className="num">Rate</th>
                              <th className="num">Planned</th><th className="num">Labor</th>
                            </tr>
                          </thead>
                          <tbody>
                            {routing.operations.map((op) => {
                              const mins = opMinutes(op, previewQty);
                              return (
                                <tr key={op.seq}>
                                  <td className="cell-sub">{op.seq}</td>
                                  <td><span className="cell-primary">{op.name}</span>{op.requiresSignature && <Badge tone="warning">signature</Badge>}</td>
                                  <td className="cell-sub">{op.workCenter || '—'}</td>
                                  <td className="num">{op.setupMin ? `${op.setupMin} min` : '—'}</td>
                                  <td className="num">{op.runRatePerHour ? `${number(op.runRatePerHour)}/h` : op.runMin ? `${minutesLabel(op.runMin)} fixed` : '—'}</td>
                                  <td className="num">{op.crew || '—'}</td>
                                  <td className="num">{op.laborRate ? `${money(op.laborRate, 0)}/h` : '—'}</td>
                                  <td className="num">{minutesLabel(mins)}</td>
                                  <td className="num">{money(opCost(op, mins), 0)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Drawer
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        wide
        title={editing?.id ? `Edit ${editing.code}` : 'New routing'}
        subtitle="Operations run in order. A run rate is finished units per hour; leave it at zero and give fixed minutes for steps that take the same time whatever the batch size."
        footer={(
          <>
            <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={persist} disabled={save.isPending}><Icon name="save" size={14} /> Save routing</button>
          </>
        )}
      >
        {editing && (
          <div className="col">
            <div className="field-row">
              <Field label="Code"><TextInput value={editing.code ?? ''} onChange={(v) => setEditing({ ...editing, code: v.toUpperCase() })} placeholder="RT-CAPSULE-2" /></Field>
              <Field label="Name"><TextInput value={editing.name ?? ''} onChange={(v) => setEditing({ ...editing, name: v })} placeholder="Capsule — high-speed line" /></Field>
            </div>
            <div className="field-row">
              <Field label="Format">
                <Select value={editing.format ?? 'capsule'} onChange={(v) => setEditing({ ...editing, format: v })} options={FORMULA_FORMATS.map((f) => ({ value: f.value, label: f.label }))} />
              </Field>
              <Field label="Hours per shift" hint="Sets how many working days a batch holds the line.">
                <NumberInput value={editing.hoursPerShift ?? 8} onChange={(v) => setEditing({ ...editing, hoursPerShift: v })} min={1} max={24} />
              </Field>
              <Field label=" ">
                <Toggle checked={Boolean(editing.isDefault)} onChange={(v) => setEditing({ ...editing, isDefault: v })} label="Default for this format" />
              </Field>
            </div>

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 70 }}>Order</th><th>Operation</th><th>Work center</th>
                    <th className="num">Setup min</th><th className="num">Units / h</th><th className="num">Fixed min</th>
                    <th className="num">Crew</th><th className="num">$ / h</th><th>Sign</th><th />
                  </tr>
                </thead>
                <tbody>
                  {(editing.operations ?? []).map((op, index) => (
                    <tr key={index}>
                      <td>
                        <div className="row-tight">
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => moveOp(index, -1)} disabled={index === 0} aria-label="Move up">↑</button>
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => moveOp(index, 1)} disabled={index === (editing.operations?.length ?? 1) - 1} aria-label="Move down">↓</button>
                        </div>
                      </td>
                      <td><TextInput value={op.name} onChange={(v) => updateOp(index, { name: v })} placeholder="Blending" /></td>
                      <td>
                        <Select value={op.workCenter} onChange={(v) => updateOp(index, { workCenter: v })} allowEmpty placeholder="—" options={lines.map((l) => ({ value: l, label: l }))} />
                      </td>
                      <td><NumberInput value={op.setupMin} onChange={(v) => updateOp(index, { setupMin: v })} min={0} /></td>
                      <td><NumberInput value={op.runRatePerHour} onChange={(v) => updateOp(index, { runRatePerHour: v })} min={0} /></td>
                      <td><NumberInput value={op.runMin ?? 0} onChange={(v) => updateOp(index, { runMin: v })} min={0} /></td>
                      <td><NumberInput value={op.crew} onChange={(v) => updateOp(index, { crew: v })} min={0} /></td>
                      <td><NumberInput value={op.laborRate} onChange={(v) => updateOp(index, { laborRate: v })} min={0} /></td>
                      <td><CheckBox checked={op.requiresSignature} onChange={(v) => updateOp(index, { requiresSignature: v })} /></td>
                      <td>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing({ ...editing, operations: (editing.operations ?? []).filter((_, i) => i !== index) })} aria-label="Remove operation"><Icon name="trash" size={13} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <button type="button" className="btn btn-sm" onClick={() => setEditing({ ...editing, operations: [...(editing.operations ?? []), blankOp((editing.operations?.length ?? 0) + 1)] })}>
                <Icon name="plus" size={13} /> Add operation
              </button>
            </div>
            <Field label="Notes"><TextInput value={editing.notes ?? ''} onChange={(v) => setEditing({ ...editing, notes: v })} placeholder="Line-specific notes, changeover reminders…" /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}
