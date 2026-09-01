import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import {
  Badge, Card, CardHead, CopyButton, Field, Flag, KeyValue, Loading, Modal,
  NumberInput, Section, StackBar, StatusBadge, Tabs, TextInput,
} from '../components/ui';
import { api, useRecord } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useViewing } from '../lib/realtime';
import { useCustomers, useFormulas, useUsers } from '../lib/lookups';
import { compact, date, mg, money, number, percent, unitMoney } from '../lib/format';
import { QUOTE_DEFAULTS, QUOTE_STATUS, overheadRateForQty } from '@shared/domain';
import type { Formula, Quote, QuoteResult, QuoteTierInput } from '../lib/types';

const COST_COLORS = {
  raw: 'var(--tone-info-fg)',
  packaging: 'var(--tone-accent-fg)',
  services: 'var(--tone-progress-fg)',
  labour: 'var(--tone-warning-fg)',
  overhead: 'var(--tone-danger-fg)',
  coa: 'var(--tone-success-fg)',
};

const LABOUR_FIELDS: { key: keyof NonNullable<QuoteTierInput['labor']>; label: string }[] = [
  { key: 'blendingPer1000', label: 'Blending / mixing' },
  { key: 'encapsulationPer1000', label: 'Encapsulation' },
  { key: 'depositPer1000', label: 'Gummy deposit' },
  { key: 'compressionPer1000', label: 'Tablet compression' },
  { key: 'fillPer1000', label: 'Fill' },
  { key: 'packagingPer1000', label: 'Packaging / bottling' },
];

export function QuoteBuilder() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { error, success, confirm } = useUi();
  const { can } = useSession();
  const customers = useCustomers();
  const formulas = useFormulas();
  const users = useUsers();

  const { data: quote, isLoading } = useRecord<Quote>('quotes', isNew ? undefined : id);
  const formulaId = isNew ? params.get('formulaId') ?? '' : quote?.formulaId ?? '';
  const { data: formula } = useRecord<Formula>('formulas', formulaId || undefined);

  useViewing(quote ? quote.quoteNumber : isNew ? 'a new quote' : null);

  const [tiers, setTiers] = useState<QuoteTierInput[]>([]);
  const [coaFee, setCoaFee] = useState(QUOTE_DEFAULTS.coaFee);
  const [tab, setTab] = useState('tiers');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showInternal, setShowInternal] = useState(true);
  const [labourFor, setLabourFor] = useState<number | null>(null);

  useEffect(() => {
    if (quote) { setTiers(quote.tiers); setCoaFee(quote.coaFee); setDirty(false); }
  }, [quote]);

  // Seed a sensible ladder for a brand-new quote from the formula's format.
  useEffect(() => {
    if (!isNew || !formula || tiers.length) return;
    const quantities = [10000, 25000, 50000, 100000];
    const margins = [0.45, 0.42, 0.38, 0.35];
    setTiers(quantities.map((qty, index) => ({
      qty,
      labor: suggestLabourFor(formula.format, qty),
      overheadRate: overheadRateForQty(qty),
      margin: margins[index],
    })));
  }, [isNew, formula, tiers.length]);

  const { data: computed, isFetching } = useQuery<QuoteResult>({
    queryKey: ['quote-compute', formulaId, tiers, coaFee],
    queryFn: () => api.post<QuoteResult>('/commerce/quotes/compute', {
      formulaId,
      tiers,
      coaFee,
      customerId: quote?.customerId || formula?.customerId,
    }),
    enabled: Boolean(formulaId) && tiers.length > 0,
  });

  const result = computed ?? quote?.result;
  const writable = can('quotes.write');

  const patchTier = (index: number, patch: Partial<QuoteTierInput>) => {
    setTiers((current) => current.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)));
    setDirty(true);
  };

  const addTier = () => {
    const last = tiers.at(-1);
    const qty = last ? last.qty * 2 : 10000;
    setTiers((current) => [...current, {
      qty,
      labor: suggestLabourFor(formula?.format ?? 'capsule', qty),
      overheadRate: overheadRateForQty(qty),
      margin: last?.margin ?? 0.4,
    }]);
    setDirty(true);
  };

  const removeTier = (index: number) => {
    setTiers((current) => current.filter((_, i) => i !== index));
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      if (isNew) {
        const created = await api.post<Quote>('/commerce/quotes', { formulaId, tiers, coaFee });
        queryClient.invalidateQueries({ queryKey: ['collection', 'quotes'] });
        success(`${created.quoteNumber} created`);
        navigate(`/quotes/${created.id}`, { replace: true });
      } else {
        await api.post(`/commerce/quotes/${id}/recompute`, { tiers, coaFee });
        queryClient.invalidateQueries({ queryKey: ['record', 'quotes', id] });
        queryClient.invalidateQueries({ queryKey: ['collection', 'quotes'] });
        setDirty(false);
        success('Quote saved and re-priced');
      }
    } catch (err) { error(err); } finally { setBusy(false); }
  };

  const send = async () => {
    const blocking = (result?.compliance ?? []).filter((flag) => flag.status === 'BLOCK');
    let overrideReason: string | undefined;
    if (blocking.length) {
      const reason = await confirm({
        title: 'This quote carries blocking findings',
        body: blocking.map((flag) => `${flag.check}: ${flag.detail}`).join('\n\n'),
        requireReason: 'Why is this being sent anyway?',
        confirmLabel: 'Send with override',
        tone: 'danger',
      });
      if (!reason) return;
      overrideReason = reason;
    }
    try {
      await api.post(`/commerce/quotes/${id}/send`, { overrideReason });
      queryClient.invalidateQueries({ queryKey: ['record', 'quotes', id] });
      success('Quote marked as sent');
    } catch (err) { error(err); }
  };

  const decide = async (decision: 'accepted' | 'declined') => {
    try {
      await api.post(`/commerce/quotes/${id}/decide`, { decision });
      queryClient.invalidateQueries({ queryKey: ['record', 'quotes', id] });
      success(`Quote ${decision}`);
    } catch (err) { error(err); }
  };

  const summaryText = useMemo(() => {
    if (!result || !formula) return '';
    const lines = [
      'ENOVA FORMULATION SUMMARY',
      '─────────────────────────',
      `Product:        ${formula.name}`,
      `Format:         ${result.product.format}`,
      `Serving Size:   ${result.product.servingSize}`,
      `Servings/Unit:  ${result.product.servingsPerUnit}`,
      `Total Fill Wt:  ${result.product.totalFormatWeightMg} mg per serving`,
      '',
      'ACTIVE INGREDIENTS (input mg/serving):',
      ...result.ingredients.actives.map((line) => `  • ${line.name} — ${line.targetMg} mg → ${line.inputMg} mg w/ overage`),
      '',
      'COMPLIANCE FLAGS:',
      ...result.compliance.map((flag) => `  ${flag.status === 'BLOCK' ? '🔴' : flag.status === 'WARN' ? '🟡' : '🟢'} ${flag.check}: ${flag.detail}`),
      '',
      'TIERED PRICING:',
      ...result.tiers.map((tier) =>
        `  Qty ${tier.qty.toLocaleString()}: $${tier.cogsPerUnit} COGS → ${tier.salePricePerUnit ? `$${tier.salePricePerUnit} at ${(tier.margin! * 100).toFixed(0)}% margin` : 'margin not set'}`),
      '',
      `COA Fee: $${result.costSummary.coaFee} flat`,
      `Lead Time: ${result.meta.leadTimeWeeks} weeks from deposit + approved artwork`,
      `Payment: ${result.meta.paymentTerms}`,
    ];
    return lines.join('\n');
  }, [result, formula]);

  if (!isNew && isLoading) return <div className="page"><Loading rows={8} /></div>;
  if (!formulaId) {
    return (
      <div className="page">
        <PageHeader back={{ to: '/quotes', label: 'Quotes' }} title="New quote" />
        <Card><div className="card-body cell-sub">Pick a formula from the Quotes list to start a cost build.</div></Card>
      </div>
    );
  }

  const headline = result?.tiers.find((tier) => tier.salePricePerUnit !== null) ?? result?.tiers[0];
  const costSegments = headline ? [
    { label: 'Raw materials', value: Number(headline.rawMaterialsPerUnit), color: COST_COLORS.raw },
    { label: 'Packaging', value: Number(headline.packagingPerUnit), color: COST_COLORS.packaging },
    { label: 'Services', value: Number(headline.servicesPerUnit), color: COST_COLORS.services },
    { label: 'Labour', value: Number(headline.laborPerUnit), color: COST_COLORS.labour },
    { label: 'Overhead', value: Number(headline.overheadPerUnit), color: COST_COLORS.overhead },
    { label: 'COA', value: Number(headline.coaPerUnit), color: COST_COLORS.coa },
  ] : [];

  return (
    <div className="page page-wide">
      <PageHeader
        back={{ to: '/quotes', label: 'Quotes' }}
        title={quote?.title ?? formula?.name ?? 'New quote'}
        badge={
          <>
            {quote && <StatusBadge list={QUOTE_STATUS} value={quote.status} large />}
            {dirty && <Badge tone="warning" dot>unsaved</Badge>}
            {isFetching && <span className="spinner" />}
            {result && result.complianceWorst !== 'PASS' && (
              <Badge tone={result.complianceWorst === 'BLOCK' ? 'danger' : 'warning'}>{result.complianceWorst}</Badge>
            )}
          </>
        }
        subtitle={
          <>
            {quote ? <span className="mono">{quote.quoteNumber}</span> : 'Not saved yet'} ·
            {' '}{customers.name(quote?.customerId || formula?.customerId)} ·
            {' '}<Link to={`/formulations/${formulaId}`}>{formulas.get(formulaId)?.code ?? 'formula'}</Link>
            {quote?.validUntil && ` · valid until ${date(quote.validUntil)}`}
          </>
        }
        actions={
          writable && (
            <>
              {quote?.projectId && (
                <button type="button" className="btn" onClick={() => navigate(`/development/${quote.projectId}`)}><Icon name="flask" size={13} /> Open project</button>
              )}
              {!isNew && <button type="button" className="btn" onClick={() => window.open(`/print/quote/${id}`, '_blank')}><Icon name="printer" size={13} /> PDF</button>}
              {quote?.status === 'sent' && (
                <>
                  <button type="button" className="btn" onClick={() => decide('declined')}>Declined</button>
                  <button type="button" className="btn" onClick={() => decide('accepted')}><Icon name="check" size={13} /> Accepted</button>
                </>
              )}
              {quote && ['draft', 'revised'].includes(quote.status) && can('quotes.send') && (
                <button type="button" className="btn" onClick={send}><Icon name="send" size={13} /> Mark as sent</button>
              )}
              {quote?.status === 'accepted' && (
                <ConvertToOrder quote={quote} onDone={() => queryClient.invalidateQueries({ queryKey: ['record', 'quotes', id] })} />
              )}
              <button type="button" className="btn btn-primary" disabled={busy || (!dirty && !isNew)} onClick={save}>
                {busy ? <span className="spinner" /> : <Icon name="save" size={14} />} {isNew ? 'Create quote' : 'Save & re-price'}
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
              { value: 'tiers', label: 'Tiered pricing', count: tiers.length, icon: 'calculator' },
              { value: 'build', label: 'Cost build', icon: 'layers' },
              { value: 'compliance', label: 'Compliance', count: result?.compliance.length ?? null, icon: 'shield' },
              { value: 'sheet', label: 'Client sheet', icon: 'file' },
            ]}
          />

          <div style={{ marginTop: 'var(--s-4)' }} className="col">
            {tab === 'tiers' && (
              <Card>
                <CardHead
                  title="Quantity tiers"
                  subtitle="Margin is set per tier. Everything else is computed by the engine."
                  icon="calculator"
                  actions={writable && <button type="button" className="btn btn-sm" onClick={addTier}><Icon name="plus" size={12} /> Add tier</button>}
                />
                <div className="table-wrap">
                  <table className="data tier-table">
                    <thead>
                      <tr>
                        <th>Quantity</th>
                        <th className="num-cell">Labour/unit</th>
                        <th className="num-cell">Overhead</th>
                        <th className="num-cell">COA/unit</th>
                        <th className="num-cell">COGS/unit</th>
                        <th className="num-cell">Margin</th>
                        <th className="num-cell">Sale price</th>
                        <th className="num-cell">Extended</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {tiers.map((tier, index) => {
                        const computedTier = result?.tiers.find((t) => t.qty === tier.qty);
                        return (
                          <tr key={index}>
                            <td>
                              <NumberInput
                                className="input input-sm input-mono right"
                                value={tier.qty}
                                disabled={!writable}
                                onChange={(value) => patchTier(index, { qty: value, overheadRate: overheadRateForQty(value) })}
                              />
                            </td>
                            <td className="num-cell">
                              <button type="button" className="link-btn mono" onClick={() => setLabourFor(index)} disabled={!writable}>
                                {computedTier ? unitMoney(computedTier.laborPerUnit) : '—'}
                              </button>
                            </td>
                            <td className="num-cell">
                              <div className="row-tight" style={{ justifyContent: 'flex-end' }}>
                                <span className="cell-sub">{percent((tier.overheadRate ?? 0) * 100, 0)}</span>
                                <span className="mono">{computedTier ? unitMoney(computedTier.overheadPerUnit) : '—'}</span>
                              </div>
                            </td>
                            <td className="num-cell">{computedTier ? unitMoney(computedTier.coaPerUnit) : '—'}</td>
                            <td className="num-cell strong">{computedTier ? unitMoney(computedTier.cogsPerUnit) : '—'}</td>
                            <td className="num-cell editable">
                              <NumberInput
                                className="input input-sm input-mono right"
                                value={tier.margin === null ? '' : Number((tier.margin * 100).toFixed(1))}
                                disabled={!writable}
                                step="0.5"
                                onChange={(value) => patchTier(index, { margin: Number.isFinite(value) ? value / 100 : null })}
                              />
                            </td>
                            <td className="num-cell strong">
                              {computedTier?.salePricePerUnit ? unitMoney(computedTier.salePricePerUnit) : <span className="faint">set a margin</span>}
                            </td>
                            <td className="num-cell">{computedTier?.extendedTotal ? money(computedTier.extendedTotal, 0) : '—'}</td>
                            <td className="tight">
                              {writable && tiers.length > 1 && (
                                <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => removeTier(index)} aria-label="Remove tier">
                                  <Icon name="trash" size={13} />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="card-foot row-wrap">
                  <span className="cell-sub">
                    Sale price = COGS ÷ (1 − margin). Overhead steps down with volume; labour and the COA fee amortise across the tier.
                  </span>
                  <span className="spacer" />
                  <Field label="COA fee">
                    <NumberInput
                      className="input input-sm input-mono right"
                      style={{ width: 96 }}
                      value={coaFee}
                      disabled={!writable}
                      onChange={(value) => { setCoaFee(value); setDirty(true); }}
                    />
                  </Field>
                </div>
              </Card>
            )}

            {tab === 'build' && result && (
              <div className="col">
                <Card>
                  <CardHead title="Master formula" subtitle={`${result.ingredients.actives.length} actives · ${result.ingredients.excipients.length} excipients`} icon="beaker" />
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Item code</th><th>Ingredient</th>
                          <th className="num-cell">Label claim</th><th className="num-cell">Input (+OA)</th>
                          <th className="num-cell">$/kg</th><th className="num-cell">$/unit</th>
                          <th>Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...result.ingredients.actives, ...result.ingredients.excipients].map((line, index) => (
                          <tr key={`${line.code}-${index}`}>
                            <td className="mono cell-sub">{line.code}</td>
                            <td>
                              <div className="cell-primary truncate">{line.name}</div>
                              {line.isBaseFill && <div className="cell-sub">base fill — remainder of the fill weight</div>}
                            </td>
                            <td className="num-cell">{line.labelClaim ? `${line.labelClaim} ${line.labelUnit}` : mg(line.targetMg)}</td>
                            <td className="num-cell">{mg(line.inputMg)}</td>
                            <td className="num-cell">{money(line.pricePerKg)}</td>
                            <td className="num-cell">{unitMoney(line.costPerUnit)}</td>
                            <td className="cell-sub truncate">{line.priceSource}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                {result.packaging.length > 0 && (
                  <Card>
                    <CardHead title="Packaging" icon="boxes" />
                    <div className="table-wrap">
                      <table className="data">
                        <thead><tr><th>Item code</th><th>Component</th><th className="num-cell">$/unit</th><th>Source</th></tr></thead>
                        <tbody>
                          {result.packaging.map((line, index) => (
                            <tr key={index}>
                              <td className="mono cell-sub">{line.code}</td>
                              <td>{line.name}</td>
                              <td className="num-cell">{unitMoney(line.costPerUnit)}</td>
                              <td className="cell-sub">{line.priceSource}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                )}

                {result.services.length > 0 && (
                  <Card>
                    <CardHead title="Manufacturing services" icon="factory" />
                    <div className="table-wrap">
                      <table className="data">
                        <thead><tr><th>Service</th><th>Basis</th><th className="num-cell">$/unit</th></tr></thead>
                        <tbody>
                          {result.services.map((line, index) => (
                            <tr key={index}><td>{line.name}</td><td className="cell-sub">{line.basis || '—'}</td><td className="num-cell">{unitMoney(line.costPerUnit)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                )}
              </div>
            )}

            {tab === 'compliance' && (
              <Card>
                <CardHead
                  title="Compliance findings"
                  subtitle="A blocking finding stops the quote leaving the building without a written override"
                  icon="shield"
                  actions={result && <Badge tone={result.complianceWorst === 'BLOCK' ? 'danger' : result.complianceWorst === 'WARN' ? 'warning' : 'success'} large>{result.complianceWorst}</Badge>}
                />
                <div className="card-body col-tight">
                  {(result?.compliance ?? []).map((flag, index) => (
                    <Flag
                      key={index}
                      tone={flag.status === 'BLOCK' ? 'danger' : flag.status === 'WARN' ? 'warning' : 'success'}
                      title={flag.check}
                      detail={flag.detail}
                      authority={flag.authority}
                    />
                  ))}
                  {(result?.compliance ?? []).length === 0 && <div className="cell-sub">No findings.</div>}
                </div>
              </Card>
            )}

            {tab === 'sheet' && result && formula && (
              <ClientSheet
                result={result}
                formula={formula}
                customerName={customers.name(quote?.customerId || formula.customerId)}
                quoteNumber={quote?.quoteNumber ?? 'DRAFT'}
                showInternal={showInternal}
                onToggleInternal={() => setShowInternal((v) => !v)}
                summaryText={summaryText}
              />
            )}
          </div>
        </div>

        <div className="col">
          <Card>
            <CardHead title="Headline" subtitle={headline ? `At ${compact(headline.qty)} units` : ''} icon="target" />
            <div className="card-body col">
              {headline ? (
                <>
                  <div>
                    <div className="kpi-value">{headline.salePricePerUnit ? unitMoney(headline.salePricePerUnit) : unitMoney(headline.cogsPerUnit)}</div>
                    <div className="cell-sub">
                      {headline.salePricePerUnit
                        ? `Sale price per unit at ${percent((headline.margin ?? 0) * 100, 0)} margin`
                        : 'COGS per unit — no margin set yet'}
                    </div>
                  </div>
                  <StackBar segments={costSegments} />
                  <KeyValue
                    items={[
                      { label: 'COGS per unit', value: unitMoney(headline.cogsPerUnit) },
                      { label: 'Batch COGS', value: money(headline.batchCogs) },
                      ...(headline.extendedTotal ? [{ label: 'Extended total', value: money(headline.extendedTotal) }] : []),
                      ...(headline.marginDollars ? [{ label: 'Gross margin', value: money(headline.marginDollars) }] : []),
                    ]}
                  />
                </>
              ) : <div className="cell-sub">Add a tier to price this quote.</div>}
            </div>
          </Card>

          <Section title="Terms" icon="clipboard">
            <KeyValue
              items={[
                { label: 'Lead time', value: `${quote?.leadTimeWeeks ?? QUOTE_DEFAULTS.leadTimeWeeks} weeks from deposit + approved artwork` },
                { label: 'Payment', value: quote?.paymentTerms ?? QUOTE_DEFAULTS.paymentTerms },
                { label: 'COA fee', value: `${money(coaFee)} flat per SKU` },
                { label: 'Overage', value: `${result?.product.overagePct ?? 5}% on every ingredient` },
                { label: 'Valid', value: quote?.validUntil ? date(quote.validUntil) : `${QUOTE_DEFAULTS.validDays} days from issue` },
                ...(quote ? [{ label: 'Owner', value: users.name(quote.ownerId) }] : []),
              ]}
            />
          </Section>

          {result && (
            <Section title="Product" icon="beaker">
              <KeyValue
                items={[
                  { label: 'Format', value: result.product.format },
                  { label: 'Serving size', value: result.product.servingSize },
                  { label: 'Servings per unit', value: number(result.product.servingsPerUnit) },
                  { label: 'Fill weight', value: `${result.product.totalFormatWeightMg} mg` },
                  { label: 'Weighed in', value: `${result.product.totalInputMg} mg` },
                  ...(result.product.capsuleShellSize ? [{ label: 'Shell', value: `Size ${result.product.capsuleShellSize}` }] : []),
                  { label: 'Bulk', value: result.product.isBulk ? 'Yes — no packaging' : 'No' },
                ]}
              />
            </Section>
          )}
        </div>
      </div>

      {labourFor !== null && (
        <LabourModal
          tier={tiers[labourFor]}
          onClose={() => setLabourFor(null)}
          onSave={(labor) => { patchTier(labourFor, { labor }); setLabourFor(null); }}
        />
      )}
    </div>
  );
}

function suggestLabourFor(format: string, qty: number): QuoteTierInput['labor'] {
  const bands: Record<string, Partial<Record<keyof NonNullable<QuoteTierInput['labor']>, [number, number]>>> = {
    gummy: { depositPer1000: [35, 60], packagingPer1000: [8, 15] },
    capsule: { encapsulationPer1000: [12, 20], packagingPer1000: [8, 15] },
    tablet: { compressionPer1000: [10, 18], packagingPer1000: [8, 15] },
    sachet: { fillPer1000: [18, 30], packagingPer1000: [6, 12] },
    stick_pack: { fillPer1000: [18, 30], packagingPer1000: [6, 12] },
    tincture: { fillPer1000: [25, 45], packagingPer1000: [8, 15] },
    powder: { blendingPer1000: [6, 12], packagingPer1000: [6, 12] },
    softgel: { encapsulationPer1000: [14, 24], packagingPer1000: [8, 15] },
  };
  const band = bands[format] ?? bands.powder;
  const t = Math.min(1, Math.max(0, (Math.log10(Math.max(1000, qty)) - 4) / 1));
  const labor: QuoteTierInput['labor'] = { qcPctOfProduction: QUOTE_DEFAULTS.qcPctOfProduction };
  for (const [key, range] of Object.entries(band)) {
    const [low, high] = range as [number, number];
    (labor as Record<string, number>)[key] = Number((high - (high - low) * t).toFixed(2));
  }
  return labor;
}

function LabourModal({ tier, onClose, onSave }: {
  tier: QuoteTierInput; onClose: () => void; onSave: (labor: QuoteTierInput['labor']) => void;
}) {
  const [labor, setLabor] = useState({ ...tier.labor });
  const production = LABOUR_FIELDS.reduce((sum, field) => sum + Number(labor[field.key] ?? 0), 0);
  const qc = production * Number(labor.qcPctOfProduction ?? QUOTE_DEFAULTS.qcPctOfProduction);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Labour at ${number(tier.qty)} units`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(labor)}>Apply</button>
        </>
      }
    >
      <div className="col">
        <Flag
          tone="warning"
          title="These are benchmark rates"
          detail="Load the MASTER BID tier page under Admin to replace them with Enova's confirmed rates. Until then every quote carries this caveat."
        />
        {LABOUR_FIELDS.map((field) => (
          <Field key={field.key} label={`${field.label} ($ per 1,000 units)`}>
            <NumberInput
              value={labor[field.key] ?? 0}
              step="0.5"
              onChange={(value) => setLabor((current) => ({ ...current, [field.key]: value }))}
            />
          </Field>
        ))}
        <Field label="QC / inspection (% of production labour)">
          <NumberInput
            value={Number(((labor.qcPctOfProduction ?? 0.12) * 100).toFixed(1))}
            step="1"
            onChange={(value) => setLabor((current) => ({ ...current, qcPctOfProduction: value / 100 }))}
          />
        </Field>
        <KeyValue
          items={[
            { label: 'Production labour', value: `${unitMoney(production / 1000)} per unit` },
            { label: 'QC / inspection', value: `${unitMoney(qc / 1000)} per unit` },
            { label: 'Total labour', value: `${unitMoney((production + qc) / 1000)} per unit` },
          ]}
        />
      </div>
    </Modal>
  );
}

function ConvertToOrder({ quote, onDone }: { quote: Quote; onDone: () => void }) {
  const { error, success } = useUi();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const priced = (quote.result?.tiers ?? []).filter((tier) => tier.salePricePerUnit !== null);
  const [qtyValue, setQtyValue] = useState(priced.at(-1)?.qty ?? 0);
  const [customerPo, setCustomerPo] = useState('');

  const convert = async () => {
    try {
      const order = await api.post<{ id: string; orderNumber: string }>(`/commerce/quotes/${quote.id}/to-order`, { qty: qtyValue, customerPo });
      success(`${order.orderNumber} created`);
      setOpen(false);
      onDone();
      navigate(`/orders/${order.id}`);
    } catch (err) { error(err); }
  };

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}><Icon name="cart" size={13} /> Convert to order</button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Convert to a sales order"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={!qtyValue} onClick={convert}>Create order</button>
          </>
        }
      >
        <div className="col">
          <Field label="Tier" hint="The order takes the sale price from the tier you pick.">
            <select className="select" value={qtyValue} onChange={(event) => setQtyValue(Number(event.target.value))}>
              {priced.map((tier) => (
                <option key={tier.qty} value={tier.qty}>
                  {number(tier.qty)} units at {unitMoney(tier.salePricePerUnit)} — {money(tier.extendedTotal ?? 0, 0)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Customer purchase order"><TextInput value={customerPo} onChange={setCustomerPo} placeholder="Their PO reference" /></Field>
        </div>
      </Modal>
    </>
  );
}

function ClientSheet({ result, formula, customerName, quoteNumber, showInternal, onToggleInternal, summaryText }: {
  result: QuoteResult; formula: Formula; customerName: string; quoteNumber: string;
  showInternal: boolean; onToggleInternal: () => void; summaryText: string;
}) {
  return (
    <Card>
      <CardHead
        title="Bid & Supplement Facts"
        subtitle="What the customer sees. Internal costs are hidden unless you switch them on."
        icon="file"
        actions={
          <>
            <button type="button" className="btn btn-sm" onClick={onToggleInternal}>
              <Icon name="eye" size={12} /> {showInternal ? 'Hide COGS' : 'Show COGS'}
            </button>
            <CopyButton text={summaryText} label="Copy summary" />
            <button type="button" className="btn btn-sm" onClick={() => window.print()}><Icon name="printer" size={12} /> Print</button>
          </>
        }
      />
      <div className="card-body col">
        <div className="spread" style={{ borderBottom: '2px solid var(--brand-gold)', paddingBottom: 'var(--s-3)' }}>
          <div>
            <div style={{ fontSize: 'var(--t-lg)', fontWeight: 700, color: 'var(--text-strong)' }}>Enova Science</div>
            <div className="cell-sub">Contract manufacturing quotation</div>
          </div>
          <div className="right">
            <div className="mono">{quoteNumber}</div>
            <div className="cell-sub">{date(new Date().toISOString())}</div>
          </div>
        </div>

        <KeyValue
          items={[
            { label: 'Customer', value: customerName },
            { label: 'Product', value: formula.name },
            { label: 'Format', value: result.product.format },
            { label: 'Serving size', value: result.product.servingSize },
            { label: 'Servings per container', value: number(result.product.servingsPerUnit) },
          ]}
        />

        <div>
          <div className="eyebrow" style={{ marginBottom: 'var(--s-2)' }}>Active ingredients per serving</div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Ingredient</th><th className="num-cell">Label claim</th><th className="num-cell">Input (with overage)</th></tr></thead>
              <tbody>
                {result.ingredients.actives.map((line, index) => (
                  <tr key={index}>
                    <td>{line.name}</td>
                    <td className="num-cell">{line.labelClaim ? `${line.labelClaim} ${line.labelUnit}` : mg(line.targetMg)}</td>
                    <td className="num-cell">{mg(line.inputMg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 'var(--s-2)' }}>Tiered pricing</div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="num-cell">Quantity</th>
                  {showInternal && <th className="num-cell">COGS/unit</th>}
                  {showInternal && <th className="num-cell">Margin</th>}
                  <th className="num-cell">Price per unit</th>
                  <th className="num-cell">Extended total</th>
                </tr>
              </thead>
              <tbody>
                {result.tiers.map((tier) => (
                  <tr key={tier.qty}>
                    <td className="num-cell">{number(tier.qty)}</td>
                    {showInternal && <td className="num-cell">{unitMoney(tier.cogsPerUnit)}</td>}
                    {showInternal && <td className="num-cell">{tier.margin === null ? '—' : percent(tier.margin * 100, 0)}</td>}
                    <td className="num-cell strong">{tier.salePricePerUnit ? unitMoney(tier.salePricePerUnit) : '—'}</td>
                    <td className="num-cell">{tier.extendedTotal ? money(tier.extendedTotal, 0) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="cell-sub col-tight">
          <div>COA fee: {money(result.costSummary.coaFee)} flat per SKU.</div>
          <div>Estimated lead time: {result.meta.leadTimeWeeks} weeks from deposit and approved artwork.</div>
          <div>Payment terms: {result.meta.paymentTerms}.</div>
          <div>This quotation is valid for {QUOTE_DEFAULTS.validDays} days from the date of issue.</div>
        </div>

        {result.compliance.filter((flag) => flag.status !== 'PASS').length > 0 && (
          <div>
            <div className="eyebrow" style={{ marginBottom: 'var(--s-2)' }}>Compliance notes</div>
            <div className="col-tight">
              {result.compliance.filter((flag) => flag.status !== 'PASS').map((flag, index) => (
                <div key={index} className="row-tight" data-tone={flag.status === 'BLOCK' ? 'danger' : 'warning'}>
                  <span className="tone-text"><Icon name="alert" size={13} /></span>
                  <span className="cell-sub grow">{flag.check}: {flag.detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
