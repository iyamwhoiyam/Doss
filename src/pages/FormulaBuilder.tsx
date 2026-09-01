import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import { SortableList } from '../components/Board';
import {
  Badge, Card, CardHead, Combo, CopyButton, Field, Flag, KeyValue, Loading, Modal,
  NumberInput, Section, Select, StackBar, StatusBadge, Tabs, TextArea, TextInput, Toggle,
} from '../components/ui';
import { api, qs, useList, useRecord } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useViewing, useAlsoHere } from '../lib/realtime';
import { Avatar } from '../components/ui';
import { useCustomers, useProjects, useUsers } from '../lib/lookups';
import { date, mg, money, number, percent, unitMoney } from '../lib/format';
import { CAPSULE_SHELLS, FORMULA_FORMATS, FORMULA_STATUS } from '@shared/domain';
import type { Formula, IngredientLine, PackagingLine, QuoteResult, Routing, ServiceLine } from '../lib/types';

interface CatalogueItem {
  id: string; itemCode: string; name: string; type: string; category: string; form: string;
  uom: string; pricePerKg: number; costPerUom: number; priceSource: string;
  isBranded: boolean; brandOwner: string; allergens: string[]; labelName: string;
}

const COST_COLORS = {
  raw: 'var(--tone-info-fg)',
  packaging: 'var(--tone-accent-fg)',
  services: 'var(--tone-progress-fg)',
  labour: 'var(--tone-warning-fg)',
  overhead: 'var(--tone-danger-fg)',
  coa: 'var(--tone-success-fg)',
};

function blankFormula(): Partial<Formula> {
  return {
    code: '',
    name: '',
    revision: 1,
    status: 'draft',
    format: 'capsule',
    isBulk: false,
    servingSize: '2 capsules',
    servingsPerUnit: 30,
    unitsPerBatch: 10000,
    totalFormatWeightMg: 1200,
    capsuleShellSize: '00',
    overagePct: 5,
    actives: [],
    excipients: [],
    packaging: [],
    services: [],
    claims: [],
    allergens: [],
    tags: [],
    notes: '',
  };
}

export function FormulaBuilder() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { error, success, confirm } = useUi();
  const { can, user } = useSession();
  const customers = useCustomers();
  const projects = useProjects();
  const users = useUsers();

  const { data: saved, isLoading } = useRecord<Formula>('formulas', isNew ? undefined : id);
  const [draft, setDraft] = useState<Partial<Formula>>(blankFormula);
  const { data: routings } = useList<Routing>('routings', { sort: 'code', limit: 200 });
  const routingHint = (() => {
    const own = draft.routingId ? routings?.rows.find((r) => r.id === draft.routingId) : null;
    if (own) return `${own.operations.length} operations · batches start on ${own.operations.find((o) => o.workCenter)?.workCenter ?? 'the routing\'s work center'}`;
    const fallback = routings?.rows.find((r) => r.format === draft.format && r.isDefault) ?? routings?.rows.find((r) => r.format === draft.format);
    return fallback ? `Batches will follow ${fallback.code} unless you pick one.` : 'No routing for this format yet — add one under Make › Routings.';
  })();
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState('build');
  const [pickerFor, setPickerFor] = useState<'actives' | 'excipients' | 'packaging' | null>(null);
  const [saving, setSaving] = useState(false);

  useViewing(saved ? saved.code : isNew ? 'a new formula' : null);
  const alsoHere = useAlsoHere(saved ? saved.code : null);

  useEffect(() => {
    if (saved) { setDraft(saved); setDirty(false); }
  }, [saved]);

  const update = useCallback((patch: Partial<Formula>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
  }, []);

  // Live cost preview. The engine on the server is the only thing that does the
  // arithmetic, so the on-screen numbers are the same ones a quote would carry.
  const [debounced, setDebounced] = useState(draft);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(draft), 320);
    return () => window.clearTimeout(timer);
  }, [draft]);

  const { data: preview, isFetching: costing } = useQuery<QuoteResult>({
    queryKey: ['formula-preview', debounced],
    queryFn: () => api.post<QuoteResult>('/commerce/formulas/preview', {
      formula: debounced,
      qty: debounced.unitsPerBatch ?? 10000,
    }),
    enabled: Boolean(debounced.format),
    staleTime: 0,
  });

  const formatDef = FORMULA_FORMATS.find((f) => f.value === draft.format);
  const writable = can('formulas.write');
  const tier = preview?.tiers?.[0];

  const save = async () => {
    setSaving(true);
    try {
      const body = { ...draft };
      delete (body as Record<string, unknown>).id;
      delete (body as Record<string, unknown>).version;
      const result = isNew
        ? await api.post<Formula>('/data/formulas', { ...body, code: body.code || `F-${Date.now().toString().slice(-4)}` })
        : await api.patch<Formula>(`/data/formulas/${id}`, body);
      queryClient.invalidateQueries({ queryKey: ['collection', 'formulas'] });
      queryClient.invalidateQueries({ queryKey: ['record', 'formulas', result.id] });
      setDirty(false);
      success(isNew ? 'Formula created' : 'Formula saved');
      if (isNew) navigate(`/formulations/${result.id}`, { replace: true });
    } catch (err) { error(err); } finally { setSaving(false); }
  };

  const approve = async () => {
    const blocking = (preview?.compliance ?? []).filter((flag) => flag.status === 'BLOCK');
    let overrideReason: string | undefined;
    if (blocking.length) {
      const reason = await confirm({
        title: `${blocking.length} blocking compliance finding${blocking.length > 1 ? 's' : ''}`,
        body: blocking.map((flag) => flag.check).join(' · '),
        requireReason: 'Why is this approved anyway?',
        confirmLabel: 'Approve with override',
        tone: 'danger',
      });
      if (!reason) return;
      overrideReason = reason;
    }
    try {
      await api.post(`/commerce/formulas/${id}/approve`, { overrideReason });
      queryClient.invalidateQueries({ queryKey: ['record', 'formulas', id] });
      success('Formula approved');
    } catch (err) { error(err); }
  };

  const revise = async () => {
    try {
      const next = await api.post<Formula>(`/commerce/formulas/${id}/revise`, {});
      queryClient.invalidateQueries({ queryKey: ['collection', 'formulas'] });
      success(`Revision ${next.revision} created`, 'The previous revision is now superseded.');
      navigate(`/formulations/${next.id}`);
    } catch (err) { error(err); }
  };

  const addLine = (target: 'actives' | 'excipients' | 'packaging', item: CatalogueItem) => {
    if (target === 'packaging') {
      const line: PackagingLine = {
        itemId: item.id, code: item.itemCode, name: item.name,
        costPerUnit: item.costPerUom, priceSource: item.priceSource,
      };
      update({ packaging: [...(draft.packaging ?? []), line] });
      return;
    }
    const line: IngredientLine = {
      itemId: item.id, code: item.itemCode, name: item.name, form: item.form,
      targetMg: target === 'actives' ? 100 : 5,
      inputMg: target === 'excipients' ? 5 : null,
      isBaseFill: false,
      pricePerKg: item.pricePerKg,
      priceSource: item.priceSource,
      brandOwner: item.brandOwner,
      labelClaim: null,
      labelUnit: 'mg',
    };
    update({ [target]: [...(draft[target] ?? []), line] } as Partial<Formula>);
  };

  const patchLine = (target: 'actives' | 'excipients', index: number, patch: Partial<IngredientLine>) => {
    const lines = [...(draft[target] ?? [])];
    lines[index] = { ...lines[index], ...patch };
    update({ [target]: lines } as Partial<Formula>);
  };

  const removeLine = (target: 'actives' | 'excipients' | 'packaging' | 'services', index: number) => {
    const lines = [...((draft[target] ?? []) as unknown[])];
    lines.splice(index, 1);
    update({ [target]: lines } as Partial<Formula>);
  };

  const reorder = (target: 'actives' | 'excipients', from: number, to: number) => {
    const lines = [...(draft[target] ?? [])];
    const [moved] = lines.splice(from, 1);
    lines.splice(to, 0, moved);
    update({ [target]: lines } as Partial<Formula>);
  };

  const setBaseFill = (index: number) => {
    const lines = (draft.excipients ?? []).map((line, i) => ({
      ...line,
      isBaseFill: i === index ? !line.isBaseFill : false,
      inputMg: i === index && !line.isBaseFill ? null : line.inputMg,
    }));
    update({ excipients: lines });
  };

  if (!isNew && isLoading) return <div className="page"><Loading rows={8} /></div>;

  const costSegments = tier ? [
    { label: 'Raw materials', value: Number(tier.rawMaterialsPerUnit), color: COST_COLORS.raw },
    { label: 'Packaging', value: Number(tier.packagingPerUnit), color: COST_COLORS.packaging },
    { label: 'Services', value: Number(tier.servicesPerUnit), color: COST_COLORS.services },
    { label: 'Labour', value: Number(tier.laborPerUnit), color: COST_COLORS.labour },
    { label: 'Overhead', value: Number(tier.overheadPerUnit), color: COST_COLORS.overhead },
    { label: 'COA', value: Number(tier.coaPerUnit), color: COST_COLORS.coa },
  ] : [];

  return (
    <div className="page page-wide">
      <PageHeader
        back={{ to: '/formulations', label: 'Formulations' }}
        title={draft.name || 'New formula'}
        badge={
          <>
            <StatusBadge list={FORMULA_STATUS} value={draft.status} large />
            {!isNew && <Badge tone="neutral">rev {draft.revision}</Badge>}
            {dirty && <Badge tone="warning" dot>unsaved</Badge>}
            {costing && <span className="spinner" />}
            {alsoHere.length > 0 && (
              <span className="row-tight cell-sub">
                {alsoHere.slice(0, 3).map((person) => <Avatar key={person.id} name={person.name} color={person.accentColor} size="sm" />)}
                also editing
              </span>
            )}
          </>
        }
        subtitle={
          <>
            <span className="mono">{draft.code || 'unsaved'}</span> · {formatDef?.label} ·
            {' '}{draft.servingSize} · {number(draft.servingsPerUnit)} servings per unit
            {preview && ` · ${preview.product.fillUtilisationPct}% of the fill weight used`}
          </>
        }
        actions={
          writable && (
            <>
              {!isNew && (draft.projectId || projects.rows.find((p) => p.formulaId === id)?.id) && (
                <button type="button" className="btn" onClick={() => navigate(`/development/${draft.projectId || projects.rows.find((p) => p.formulaId === id)?.id}`)}><Icon name="flask" size={13} /> Open project</button>
              )}
              {!isNew && <button type="button" className="btn" onClick={() => window.open(`/print/spec/${id}`, '_blank')}><Icon name="printer" size={13} /> Spec PDF</button>}
              {!isNew && draft.status === 'approved' && (
                <button type="button" className="btn" onClick={revise}><Icon name="git" size={13} /> New revision</button>
              )}
              {!isNew && draft.status !== 'approved' && can('formulas.approve') && (
                <button type="button" className="btn" onClick={approve}><Icon name="check-circle" size={13} /> Approve</button>
              )}
              {!isNew && (
                <button type="button" className="btn" onClick={() => navigate(`/quotes/new?formulaId=${id}`)}>
                  <Icon name="calculator" size={13} /> Build quote
                </button>
              )}
              <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={save}>
                {saving ? <span className="spinner" /> : <Icon name="save" size={14} />} {isNew ? 'Create' : 'Save'}
              </button>
            </>
          )
        }
      />

      <div className="split">
        <div className="col">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'build', label: 'Formula', count: (draft.actives?.length ?? 0) + (draft.excipients?.length ?? 0), icon: 'beaker' },
              { value: 'packaging', label: 'Packaging & services', count: (draft.packaging?.length ?? 0) + (draft.services?.length ?? 0), icon: 'boxes' },
              { value: 'compliance', label: 'Compliance', count: preview?.compliance.length ?? null, icon: 'shield' },
              { value: 'panel', label: 'Supplement Facts', icon: 'label' },
              { value: 'settings', label: 'Settings', icon: 'sliders' },
            ]}
          />

          <div style={{ marginTop: 'var(--s-4)' }} className="col">
            {tab === 'build' && (
              <>
                <Card>
                  <CardHead
                    title="Active ingredients"
                    subtitle={`Label claim before overage · ${draft.overagePct ?? 5}% is added to what gets weighed`}
                    icon="sparkles"
                    actions={writable && (
                      <button type="button" className="btn btn-sm" onClick={() => setPickerFor('actives')}>
                        <Icon name="plus" size={12} /> Add active
                      </button>
                    )}
                  />
                  <div className="card-body-flush">
                    <div className="ing-head">
                      <span />
                      <span>Ingredient</span>
                      <span className="right">Target</span>
                      <span className="right">Input (+OA)</span>
                      <span className="right">$/kg</span>
                      <span className="right">$/unit</span>
                      <span />
                    </div>
                    {(draft.actives ?? []).length === 0 && (
                      <div className="cell-sub" style={{ padding: 'var(--s-5)', textAlign: 'center' }}>
                        No actives yet. Add one from the catalogue to start costing.
                      </div>
                    )}
                    <SortableList
                      items={draft.actives ?? []}
                      getId={(line, index) => `active-${line.code}-${index}`}
                      onReorder={(from, to) => reorder('actives', from, to)}
                      renderRow={(line, index, handle) => (
                        <IngredientRow
                          line={line}
                          costed={preview?.ingredients.actives[index]}
                          handle={handle}
                          writable={writable}
                          onChange={(patch) => patchLine('actives', index, patch)}
                          onRemove={() => removeLine('actives', index)}
                        />
                      )}
                    />
                  </div>
                </Card>

                <Card>
                  <CardHead
                    title="Excipients"
                    subtitle="Exact weights, except the one line marked as the base fill — that takes the remainder"
                    icon="layers"
                    actions={writable && (
                      <button type="button" className="btn btn-sm" onClick={() => setPickerFor('excipients')}>
                        <Icon name="plus" size={12} /> Add excipient
                      </button>
                    )}
                  />
                  <div className="card-body-flush">
                    <div className="ing-head">
                      <span />
                      <span>Ingredient</span>
                      <span className="right">Base fill</span>
                      <span className="right">Input mg</span>
                      <span className="right">$/kg</span>
                      <span className="right">$/unit</span>
                      <span />
                    </div>
                    {(draft.excipients ?? []).length === 0 && (
                      <div className="cell-sub" style={{ padding: 'var(--s-5)', textAlign: 'center' }}>
                        No excipients yet. Most formats need one line marked as the base fill.
                      </div>
                    )}
                    <SortableList
                      items={draft.excipients ?? []}
                      getId={(line, index) => `exc-${line.code}-${index}`}
                      onReorder={(from, to) => reorder('excipients', from, to)}
                      renderRow={(line, index, handle) => (
                        <ExcipientRow
                          line={line}
                          costed={preview?.ingredients.excipients.find((c) => c.code === line.code && c.name === line.name)}
                          handle={handle}
                          writable={writable}
                          onChange={(patch) => patchLine('excipients', index, patch)}
                          onToggleBase={() => setBaseFill(index)}
                          onRemove={() => removeLine('excipients', index)}
                        />
                      )}
                    />
                  </div>
                </Card>
              </>
            )}

            {tab === 'packaging' && (
              <>
                <Card>
                  <CardHead
                    title="Packaging components"
                    subtitle={draft.isBulk ? 'This formula is bulk — packaging lines are excluded from the cost' : 'Cost per finished unit'}
                    icon="boxes"
                    actions={writable && (
                      <button type="button" className="btn btn-sm" onClick={() => setPickerFor('packaging')}>
                        <Icon name="plus" size={12} /> Add component
                      </button>
                    )}
                  />
                  <div className="card-body-flush">
                    {(draft.packaging ?? []).map((line, index) => (
                      <div key={`${line.code}-${index}`} className="list-row">
                        <span className="mono cell-sub" style={{ width: 108 }}>{line.code}</span>
                        <span className="grow truncate">{line.name}</span>
                        <span style={{ width: 110 }}>
                          <NumberInput
                            className="input input-sm input-mono right"
                            value={line.costPerUnit}
                            disabled={!writable}
                            step="0.001"
                            onChange={(value) => {
                              const lines = [...(draft.packaging ?? [])];
                              lines[index] = { ...lines[index], costPerUnit: value };
                              update({ packaging: lines });
                            }}
                          />
                        </span>
                        {writable && (
                          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => removeLine('packaging', index)} aria-label="Remove">
                            <Icon name="trash" size={13} />
                          </button>
                        )}
                      </div>
                    ))}
                    {(draft.packaging ?? []).length === 0 && (
                      <div className="cell-sub" style={{ padding: 'var(--s-5)', textAlign: 'center' }}>No packaging components.</div>
                    )}
                  </div>
                </Card>

                <Card>
                  <CardHead
                    title="Manufacturing services"
                    subtitle="Per-unit service fees charged by the plant"
                    icon="factory"
                    actions={writable && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => update({ services: [...(draft.services ?? []), { name: formatDef?.service ?? 'Manufacturing', costPerUnit: 0.01, basis: '' }] })}
                      >
                        <Icon name="plus" size={12} /> Add service
                      </button>
                    )}
                  />
                  <div className="card-body-flush">
                    {(draft.services ?? []).map((line: ServiceLine, index) => (
                      <div key={index} className="list-row">
                        <span className="grow">
                          <TextInput
                            className="input input-sm"
                            value={line.name}
                            disabled={!writable}
                            onChange={(value) => {
                              const lines = [...(draft.services ?? [])];
                              lines[index] = { ...lines[index], name: value };
                              update({ services: lines });
                            }}
                          />
                        </span>
                        <span style={{ width: 110 }}>
                          <NumberInput
                            className="input input-sm input-mono right"
                            value={line.costPerUnit}
                            disabled={!writable}
                            step="0.0001"
                            onChange={(value) => {
                              const lines = [...(draft.services ?? [])];
                              lines[index] = { ...lines[index], costPerUnit: value };
                              update({ services: lines });
                            }}
                          />
                        </span>
                        {writable && (
                          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => removeLine('services', index)} aria-label="Remove">
                            <Icon name="trash" size={13} />
                          </button>
                        )}
                      </div>
                    ))}
                    {(draft.services ?? []).length === 0 && (
                      <div className="cell-sub" style={{ padding: 'var(--s-5)', textAlign: 'center' }}>No service fees on this formula.</div>
                    )}
                  </div>
                </Card>
              </>
            )}

            {tab === 'compliance' && (
              <Card>
                <CardHead
                  title="Compliance checks"
                  subtitle="Run on every change — the same gates a quote has to pass"
                  icon="shield"
                  actions={preview && <Badge tone={preview.complianceWorst === 'BLOCK' ? 'danger' : preview.complianceWorst === 'WARN' ? 'warning' : 'success'} large>{preview.complianceWorst}</Badge>}
                />
                <div className="card-body col-tight">
                  {(preview?.compliance ?? []).map((flag, index) => (
                    <Flag
                      key={`${flag.check}-${index}`}
                      tone={flag.status === 'BLOCK' ? 'danger' : flag.status === 'WARN' ? 'warning' : 'success'}
                      title={flag.check}
                      detail={flag.detail}
                      authority={flag.authority}
                    />
                  ))}
                  {(preview?.compliance ?? []).length === 0 && (
                    <div className="cell-sub">Nothing to check yet — add an active ingredient.</div>
                  )}
                </div>
              </Card>
            )}

            {tab === 'panel' && <SupplementFactsPanel formulaId={isNew ? null : id!} draft={draft} />}

            {tab === 'settings' && (
              <Card>
                <CardHead title="Formula settings" icon="sliders" />
                <div className="card-body col">
                  <div className="field-row">
                    <Field label="Formula name"><TextInput value={draft.name ?? ''} onChange={(value) => update({ name: value })} disabled={!writable} /></Field>
                    <Field label="Formula code" hint={isNew ? 'Leave blank to generate one.' : undefined}>
                      <TextInput value={draft.code ?? ''} onChange={(value) => update({ code: value })} disabled={!writable} />
                    </Field>
                  </div>
                  <div className="field-row">
                    <Field label="Customer"><Combo value={draft.customerId ?? ''} onChange={(value) => update({ customerId: value })} options={customers.options} placeholder="Internal" disabled={!writable} /></Field>
                    <Field label="Project"><Combo value={draft.projectId ?? ''} onChange={(value) => update({ projectId: value })} options={projects.options} placeholder="None" disabled={!writable} /></Field>
                  </div>
                  <div className="field-row">
                    <Field label="Format">
                      <Select
                        value={draft.format ?? 'capsule'}
                        disabled={!writable}
                        onChange={(value) => {
                          const def = FORMULA_FORMATS.find((f) => f.value === value);
                          update({ format: value, totalFormatWeightMg: def?.defaultWeightMg ?? draft.totalFormatWeightMg });
                        }}
                        options={FORMULA_FORMATS.map((f) => ({ value: f.value, label: f.label }))}
                      />
                    </Field>
                    <Field label="Serving size"><TextInput value={draft.servingSize ?? ''} onChange={(value) => update({ servingSize: value })} disabled={!writable} placeholder="2 capsules" /></Field>
                  </div>
                  <div className="field-row">
                    <Field label="Servings per unit"><NumberInput value={draft.servingsPerUnit} onChange={(value) => update({ servingsPerUnit: value })} disabled={!writable} min={1} /></Field>
                    <Field label="Total fill weight per serving (mg)" hint={preview ? `${preview.product.perPieceWeightMg} mg per piece across ${preview.product.unitsPerServing}` : undefined}>
                      <NumberInput value={draft.totalFormatWeightMg} onChange={(value) => update({ totalFormatWeightMg: value })} disabled={!writable} min={0} />
                    </Field>
                  </div>
                  <div className="field-row">
                    <Field label="Overage %" hint="Enova standard is 5%.">
                      <NumberInput value={draft.overagePct} onChange={(value) => update({ overagePct: value })} disabled={!writable} min={0} max={25} />
                    </Field>
                    <Field label="Units per batch" hint="Used for the cost preview on this page.">
                      <NumberInput value={draft.unitsPerBatch} onChange={(value) => update({ unitsPerBatch: value })} disabled={!writable} min={1} />
                    </Field>
                  </div>
                  <Field label="Routing" hint={routingHint}>
                    <Select
                      value={draft.routingId ?? ''}
                      onChange={(value) => update({ routingId: value })}
                      disabled={!writable}
                      allowEmpty
                      placeholder="Default routing for this format"
                      options={(routings?.rows ?? []).map((r) => ({ value: r.id, label: `${r.code} · ${r.name}${r.format !== draft.format ? ` (${r.format})` : ''}` }))}
                    />
                  </Field>
                  {draft.format === 'capsule' && (
                    <Field label="Capsule shell size">
                      <Select
                        value={draft.capsuleShellSize ?? ''}
                        onChange={(value) => update({ capsuleShellSize: value })}
                        disabled={!writable}
                        allowEmpty
                        placeholder="Not chosen"
                        options={Object.entries(CAPSULE_SHELLS).map(([size, range]) => ({ value: size, label: `Size ${size} — ${range.min}–${range.max} mg` }))}
                      />
                    </Field>
                  )}
                  <Toggle
                    checked={Boolean(draft.isBulk)}
                    disabled={!writable}
                    onChange={(value) => update({ isBulk: value })}
                    label="Bulk (unpackaged) — excludes every packaging line from the cost"
                  />
                  <Field label="Notes"><TextArea value={draft.notes ?? ''} onChange={(value) => update({ notes: value })} disabled={!writable} rows={4} /></Field>
                </div>
              </Card>
            )}
          </div>
        </div>

        <div className="col">
          <Card>
            <CardHead
              title="Cost per unit"
              subtitle={`At ${number(draft.unitsPerBatch ?? 10000)} units`}
              icon="calculator"
              actions={costing ? <span className="spinner" /> : null}
            />
            <div className="card-body col">
              {tier ? (
                <>
                  <div>
                    <div className="kpi-value" style={{ fontSize: 'var(--t-2xl)' }}>{unitMoney(tier.cogsPerUnit)}</div>
                    <div className="cell-sub">Total COGS per unit · {money(tier.batchCogs)} for the batch</div>
                  </div>

                  <StackBar segments={costSegments} />

                  <div className="table-wrap">
                    <table className="data">
                      <tbody>
                        <tr><td>Raw materials</td><td className="num-cell">{unitMoney(tier.rawMaterialsPerUnit)}</td></tr>
                        <tr><td>Packaging</td><td className="num-cell">{unitMoney(tier.packagingPerUnit)}</td></tr>
                        <tr><td>Manufacturing services</td><td className="num-cell">{unitMoney(tier.servicesPerUnit)}</td></tr>
                        <tr><td>Labour</td><td className="num-cell">{unitMoney(tier.laborPerUnit)}</td></tr>
                        <tr><td>Overhead ({percent(tier.overheadRate * 100, 1)} of labour)</td><td className="num-cell">{unitMoney(tier.overheadPerUnit)}</td></tr>
                        <tr><td>COA (amortised)</td><td className="num-cell">{unitMoney(tier.coaPerUnit)}</td></tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="cell-sub">
                    Labour and overhead are benchmark rates until the MASTER BID tier page is loaded.
                  </div>
                </>
              ) : (
                <div className="cell-sub">Add an ingredient to see the cost build.</div>
              )}
            </div>
          </Card>

          {preview && (
            <Section title="Fill check" icon="scale">
              <KeyValue
                items={[
                  { label: 'Format weight', value: `${preview.product.totalFormatWeightMg} mg per serving` },
                  { label: 'Per piece', value: `${preview.product.perPieceWeightMg} mg × ${preview.product.unitsPerServing}` },
                  { label: 'Weighed in', value: `${preview.product.totalInputMg} mg` },
                  { label: 'Utilisation', value: <Badge tone={Number(preview.product.fillUtilisationPct) > 100 ? 'danger' : Number(preview.product.fillUtilisationPct) > 97 ? 'success' : 'warning'}>{preview.product.fillUtilisationPct}%</Badge> },
                  { label: 'Overage', value: `${preview.product.overagePct}%` },
                ]}
              />
            </Section>
          )}

          {preview && preview.compliance.length > 0 && (
            <Section
              title="Compliance"
              icon="shield"
              subtitle={`${preview.compliance.filter((f) => f.status === 'BLOCK').length} blocking · ${preview.compliance.filter((f) => f.status === 'WARN').length} warnings`}
              actions={<Badge tone={preview.complianceWorst === 'BLOCK' ? 'danger' : preview.complianceWorst === 'WARN' ? 'warning' : 'success'}>{preview.complianceWorst}</Badge>}
            >
              <div className="col-tight">
                {preview.compliance.slice(0, 4).map((flag, index) => (
                  <div key={index} className="row-tight" data-tone={flag.status === 'BLOCK' ? 'danger' : flag.status === 'WARN' ? 'warning' : 'success'}>
                    <span className="tone-text"><Icon name={flag.status === 'PASS' ? 'check-circle' : 'alert'} size={13} /></span>
                    <span className="grow truncate" style={{ fontSize: 'var(--t-sm)' }}>{flag.check}</span>
                  </div>
                ))}
                {preview.compliance.length > 4 && (
                  <button type="button" className="link-btn" onClick={() => setTab('compliance')}>
                    See all {preview.compliance.length} findings
                  </button>
                )}
              </div>
            </Section>
          )}

          {!isNew && saved && (
            <Section title="Record" icon="file">
              <KeyValue
                items={[
                  { label: 'Status', value: <StatusBadge list={FORMULA_STATUS} value={saved.status} /> },
                  { label: 'Revision', value: saved.revision },
                  { label: 'Owner', value: users.name(saved.ownerId || user?.id) },
                  { label: 'Approved', value: saved.approvedAt ? `${users.name(saved.approvedBy)} · ${date(saved.approvedAt)}` : 'Not approved' },
                  { label: 'Created', value: date(saved.createdAt) },
                  { label: 'Version', value: `v${saved.version}` },
                ]}
              />
            </Section>
          )}
        </div>
      </div>

      <IngredientPicker
        target={pickerFor}
        onClose={() => setPickerFor(null)}
        onPick={(item) => { addLine(pickerFor!, item); setPickerFor(null); }}
      />
    </div>
  );
}

function IngredientRow({ line, costed, handle, writable, onChange, onRemove }: {
  line: IngredientLine;
  costed?: QuoteResult['ingredients']['actives'][number];
  handle: React.ReactNode;
  writable: boolean;
  onChange: (patch: Partial<IngredientLine>) => void;
  onRemove: () => void;
}) {
  return (
    <>
      {handle}
      <div style={{ minWidth: 0 }}>
        <div className="row-tight">
          <span className="cell-primary truncate">{line.name}</span>
          {line.brandOwner && <Badge tone="accent" title={line.brandOwner}>®</Badge>}
        </div>
        <div className="cell-sub mono truncate">{line.code}{line.form ? ` · ${line.form}` : ''}</div>
      </div>
      <NumberInput className="input input-sm input-mono right" value={line.targetMg ?? 0} disabled={!writable} step="0.001" onChange={(value) => onChange({ targetMg: value })} />
      <span className="right mono cell-sub">{costed ? mg(costed.inputMg) : '—'}</span>
      <NumberInput className="input input-sm input-mono right" value={line.pricePerKg} disabled={!writable} step="0.01" onChange={(value) => onChange({ pricePerKg: value })} />
      <span className="right mono">{costed ? unitMoney(costed.costPerUnit) : '—'}</span>
      {writable ? (
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onRemove} aria-label={`Remove ${line.name}`}>
          <Icon name="trash" size={13} />
        </button>
      ) : <span />}
    </>
  );
}

function ExcipientRow({ line, costed, handle, writable, onChange, onToggleBase, onRemove }: {
  line: IngredientLine;
  costed?: QuoteResult['ingredients']['excipients'][number];
  handle: React.ReactNode;
  writable: boolean;
  onChange: (patch: Partial<IngredientLine>) => void;
  onToggleBase: () => void;
  onRemove: () => void;
}) {
  return (
    <>
      {handle}
      <div style={{ minWidth: 0 }}>
        <div className="cell-primary truncate">{line.name}</div>
        <div className="cell-sub mono truncate">{line.code}</div>
      </div>
      <span className="right">
        <Toggle checked={Boolean(line.isBaseFill)} disabled={!writable} onChange={onToggleBase} />
      </span>
      {line.isBaseFill ? (
        <span className="right mono cell-sub" title="Computed as the remainder of the fill weight">
          {costed ? mg(costed.inputMg) : '—'}
        </span>
      ) : (
        <NumberInput className="input input-sm input-mono right" value={line.inputMg ?? line.targetMg ?? 0} disabled={!writable} step="0.001" onChange={(value) => onChange({ inputMg: value })} />
      )}
      <NumberInput className="input input-sm input-mono right" value={line.pricePerKg} disabled={!writable} step="0.01" onChange={(value) => onChange({ pricePerKg: value })} />
      <span className="right mono">{costed ? unitMoney(costed.costPerUnit) : '—'}</span>
      {writable ? (
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onRemove} aria-label={`Remove ${line.name}`}>
          <Icon name="trash" size={13} />
        </button>
      ) : <span />}
    </>
  );
}

function IngredientPicker({ target, onClose, onPick }: {
  target: 'actives' | 'excipients' | 'packaging' | null;
  onClose: () => void;
  onPick: (item: CatalogueItem) => void;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  const { data, isFetching } = useQuery<{ rows: CatalogueItem[] }>({
    queryKey: ['ingredients', target, debounced],
    queryFn: () => api.get<{ rows: CatalogueItem[] }>(`/commerce/ingredients${qs({
      q: debounced,
      type: target === 'packaging' ? 'packaging' : 'raw_material',
      limit: 80,
    })}`),
    enabled: Boolean(target),
  });

  const rows = useMemo(() => {
    if (!data) return [];
    if (target === 'excipients') return data.rows.filter((row) => !/vitamin|mineral|botanical|amino|specialty/i.test(row.category));
    if (target === 'actives') return data.rows.filter((row) => /vitamin|mineral|botanical|amino|specialty/i.test(row.category) || debounced);
    return data.rows;
  }, [data, target, debounced]);

  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      large
      title={target === 'packaging' ? 'Add a packaging component' : target === 'excipients' ? 'Add an excipient' : 'Add an active ingredient'}
    >
      <div className="col">
        <TextInput value={query} onChange={setQuery} placeholder="Search by name, item code, form or trademark owner…" autoFocus />
        <div style={{ maxHeight: 420, overflowY: 'auto', margin: '0 calc(var(--s-5) * -1)' }}>
          {isFetching && <div className="cell-sub" style={{ padding: 'var(--s-4) var(--s-5)' }}>Searching the catalogue…</div>}
          {rows.map((item) => (
            <button
              key={item.id}
              type="button"
              className="list-row"
              style={{ width: '100%', border: 0, background: 'none', textAlign: 'left' }}
              onClick={() => onPick(item)}
            >
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="row-tight">
                  <span className="cell-primary truncate">{item.name}</span>
                  {item.isBranded && <Badge tone="accent" title={item.brandOwner}>branded</Badge>}
                </span>
                <span className="cell-sub mono">{item.itemCode} · {item.category}{item.form ? ` · ${item.form}` : ''}</span>
              </span>
              <span className="mono cell-sub nowrap">
                {item.type === 'packaging' ? `${unitMoney(item.costPerUom)}/ea` : `${money(item.pricePerKg)}/kg`}
              </span>
              <Icon name="plus" size={14} />
            </button>
          ))}
          {!isFetching && rows.length === 0 && (
            <div className="cell-sub" style={{ padding: 'var(--s-5)', textAlign: 'center' }}>
              Nothing in the catalogue matches “{query}”. Add the item under Inventory first so it carries a code and a price source.
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function SupplementFactsPanel({ formulaId, draft }: { formulaId: string | null; draft: Partial<Formula> }) {
  const { data } = useQuery<{ panel: import('../lib/types').SupplementFacts; text: string }>({
    queryKey: ['supplement-facts', formulaId],
    queryFn: () => api.get(`/commerce/formulas/${formulaId}/supplement-facts`),
    enabled: Boolean(formulaId),
  });

  if (!formulaId) {
    return (
      <Card><div className="card-body cell-sub">Save the formula first — the panel is generated from the stored master formula.</div></Card>
    );
  }
  if (!data) return <Card><Loading rows={4} /></Card>;

  const panel = data.panel;

  return (
    <Card>
      <CardHead
        title="Generated Supplement Facts"
        subtitle="Regulation order, 2016 units, recomputed % Daily Values"
        icon="label"
        actions={<CopyButton text={data.text} label="Copy panel" />}
      />
      <div className="card-body row" style={{ alignItems: 'flex-start', gap: 'var(--s-5)', flexWrap: 'wrap' }}>
        <div className="sfp">
          <div className="sfp-title">Supplement Facts</div>
          <div className="sfp-rule" />
          <div className="sfp-small">Serving Size: {panel.servingSize}</div>
          {panel.servingsPerContainer && <div className="sfp-small">Servings Per Container: {panel.servingsPerContainer}</div>}
          <div className="sfp-rule-bold" />
          <div className="sfp-row"><span /><b>% Daily Value</b></div>
          <div className="sfp-rule" />
          {panel.rows.map((row) => (
            <div key={row.name}>
              <div className="sfp-row">
                <span><b>{row.display}</b> {row.amount} {row.unit}{row.iuEquivalent ? ` (${number(row.iuEquivalent)} IU)` : ''}</span>
                <b>{row.pctDv === null ? '†' : `${row.pctDv}%`}</b>
              </div>
              <div className="sfp-rule" />
            </div>
          ))}
          {panel.footnotes.map((footnote) => <div key={footnote} className="sfp-foot">{footnote}</div>)}
          {panel.otherIngredients.length > 0 && (
            <div className="sfp-foot" style={{ marginTop: 6 }}>
              <b>Other Ingredients:</b> {panel.otherIngredients.join(', ')}.
            </div>
          )}
        </div>

        <div className="grow col" style={{ minWidth: 260 }}>
          <Flag
            tone="info"
            title="This is the panel the formula supports"
            detail="Nutrient order, units and % Daily Values are computed from the master formula against the 2016 label rule. Compare it against the artwork on a label review — this generator does not know what was printed."
            authority="21 CFR 101.36"
          />
          <KeyValue
            items={[
              { label: 'Rows', value: panel.rows.length },
              { label: 'With a Daily Value', value: panel.rows.filter((r) => r.pctDv !== null).length },
              { label: 'Footnoted', value: panel.rows.filter((r) => r.pctDv === null).length },
              { label: 'Claims on file', value: (draft.claims ?? []).length || '—' },
            ]}
          />
          {(draft.claims ?? []).length > 0 && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Label claims</div>
              <div className="col-tight">
                {(draft.claims ?? []).map((claim) => <div key={claim} className="cell-sub">• {claim}</div>)}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
