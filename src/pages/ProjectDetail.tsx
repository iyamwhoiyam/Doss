import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useProject, useSetProjectStage, useUpdateProjectNotes } from '../lib/queries';
import { useActor } from '../lib/session';
import { ConfidencePill, ErrorNotice, Loading, Pill, dateStr, money, num } from '../components/bits';

/* Stages an operator can move a project to. Drawn from the values actually
   present in erp_projects plus the pipeline catalog's canonical ladder. */
const STAGE_CHOICES = [
  'Pending Information',
  'Formulation/Sample Development',
  'Formulation Review',
  'Lab/Sampling',
  'Sample Sent to Customer',
  'Submitted for Tiered Pricing',
  'BID Process',
  'Bid Revision',
  'BID Sent',
  'MFSO',
  'PO Submitted',
  'In Production',
  'Completed',
  'On Hold',
  'Cancelled',
];

export default function ProjectDetail() {
  const { pn } = useParams<{ pn: string }>();
  const bundle = useProject(pn);
  const actor = useActor();
  const setStage = useSetProjectStage(actor);
  const saveNotes = useUpdateProjectNotes(actor);

  const [stagePick, setStagePick] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState<string | null>(null);

  if (bundle.isLoading) return <Loading what={`project ${pn}`} />;
  if (bundle.error) return <ErrorNotice error={bundle.error} />;
  const data = bundle.data;
  if (!data?.project)
    return (
      <div className="notice notice--info">
        No project <b className="mono">{pn}</b>. <Link to="/projects" className="accent">Back to projects</Link>.
      </div>
    );

  const p = data.project;
  const { ingredients, tiers, costs, confidence, history } = data;

  return (
    <>
      <div className="page__head">
        <h1>
          <span className="mono accent">{p.pn}</span> {p.product || '(unnamed product)'}
        </h1>
        <Pill tone="dim">{p.stage ?? 'no stage'}</Pill>
        {confidence && <ConfidencePill level={confidence.confidence} />}
        <div className="page__spacer" />
        <select
          value={stagePick ?? p.stage ?? ''}
          onChange={(e) => setStagePick(e.target.value)}
          aria-label="Change stage"
          style={{
            padding: '7px 10px', borderRadius: 7, background: 'var(--surface)',
            color: 'var(--ink)', border: '1px solid var(--border)', fontSize: '0.85rem',
          }}
        >
          {!STAGE_CHOICES.includes(p.stage ?? '') && p.stage && <option value={p.stage}>{p.stage}</option>}
          {STAGE_CHOICES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button
          className="btn btn--primary btn--sm"
          disabled={setStage.isPending || !stagePick || stagePick === p.stage}
          onClick={() => stagePick && setStage.mutate({ project: p, stage: stagePick })}
        >
          {setStage.isPending ? 'Moving…' : 'Move stage'}
        </button>
      </div>
      <p className="page__sub">
        {p.customer_name || 'no customer'} · {p.dosage_form || 'no form'}
        {p.is_bulk ? ' (bulk)' : ''} · PM {p.pm || '—'} · rep {p.rep || '—'} · received {dateStr(p.date_received)}
      </p>

      <div className="detail">
        <div className="stack">
          <div className="card">
            <div className="card__head">
              Formula
              <span className="dim">{ingredients.length} lines</span>
            </div>
            {ingredients.length === 0 ? (
              <div className="empty">No ingredient lines captured yet.</div>
            ) : (
              <div className="tablewrap" style={{ border: 0 }}>
                <table className="table" style={{ minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Ingredient</th>
                      <th>SKU</th>
                      <th className="right">Input mg</th>
                      <th className="right">Potency</th>
                      <th>Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ingredients.map((i) => (
                      <tr key={i.id}>
                        <td className="mono dim">{i.line_no}</td>
                        <td className="strong">{i.name || '—'}</td>
                        <td className="mono">{i.sku || '—'}</td>
                        <td className="right mono">{i.input_mg != null ? i.input_mg.toLocaleString() : '—'}</td>
                        <td className="right mono">{i.potency_pct != null ? `${i.potency_pct}%` : '—'}</td>
                        <td>
                          {i.matched ? <Pill tone="ok">matched</Pill> : <Pill tone="warn">unmatched</Pill>}
                          {i.ai_suggested && <> <Pill tone="cyan">AI</Pill></>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card__head">Pricing tiers</div>
            {tiers.length === 0 ? (
              <div className="empty">No tiers on file.</div>
            ) : (
              <div className="tablewrap" style={{ border: 0 }}>
                <table className="table" style={{ minWidth: 380 }}>
                  <thead>
                    <tr>
                      <th className="right">Units</th>
                      <th className="right">Unit price</th>
                      <th className="right">Margin</th>
                      <th className="right">Extended</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tiers.map((t) => (
                      <tr key={t.id}>
                        <td className="right mono">{num(t.units)}</td>
                        <td className="right mono">{t.price != null ? money(t.price, 4) : '—'}</td>
                        <td className="right mono">{t.margin != null ? `${(t.margin * 100).toFixed(0)}%` : '—'}</td>
                        <td className="right mono">
                          {t.units != null && t.price != null ? money(t.units * t.price) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card__head">
              Notes
              <div className="page__spacer" />
              {editNotes === null ? (
                <button className="btn btn--ghost btn--sm" onClick={() => setEditNotes(p.notes ?? '')}>
                  Edit
                </button>
              ) : (
                <>
                  <button className="btn btn--ghost btn--sm" onClick={() => setEditNotes(null)}>
                    Cancel
                  </button>
                  <button
                    className="btn btn--primary btn--sm"
                    disabled={saveNotes.isPending}
                    onClick={async () => {
                      await saveNotes.mutateAsync({ project: p, notes: editNotes });
                      setEditNotes(null);
                    }}
                  >
                    {saveNotes.isPending ? 'Saving…' : 'Save'}
                  </button>
                </>
              )}
            </div>
            <div className="card__body">
              {editNotes === null ? (
                <div className="mid" style={{ whiteSpace: 'pre-wrap' }}>{p.notes || <span className="dim">No notes.</span>}</div>
              ) : (
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  style={{
                    width: '100%', minHeight: 120, padding: 12, borderRadius: 8, resize: 'vertical',
                    background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--border)',
                    fontFamily: 'inherit', fontSize: '0.9rem',
                  }}
                  autoFocus
                />
              )}
            </div>
          </div>
        </div>

        <div className="stack">
          {costs && (
            <div className="card">
              <div className="card__head">Cost build <span className="dim">{costs.source ?? ''}</span></div>
              <div className="card__body">
                <dl className="kv">
                  <dt>COGS / unit</dt>
                  <dd className="mono">{money(costs.cogs_per_unit, 4)}</dd>
                  <dt>Materials</dt>
                  <dd className="mono">{money(costs.materials_cpu, 4)}</dd>
                  <dt>— actives</dt>
                  <dd className="mono">{money(costs.active_cpu, 4)}</dd>
                  <dt>— base</dt>
                  <dd className="mono">{money(costs.base_cpu, 4)}</dd>
                  <dt>— shell</dt>
                  <dd className="mono">{money(costs.shell_cpu, 4)}</dd>
                  <dt>— packaging</dt>
                  <dd className="mono">{money(costs.pkg_cpu, 4)}</dd>
                  <dt>Labor</dt>
                  <dd className="mono">{money(costs.labor_per_unit, 4)}</dd>
                  <dt>Overhead</dt>
                  <dd className="mono">
                    {money(costs.overhead_cpu, 4)}
                    {costs.overhead_pct != null ? ` (${(costs.overhead_pct * 100).toFixed(0)}%)` : ''}
                  </dd>
                </dl>
              </div>
            </div>
          )}

          {confidence && (
            <div className="card">
              <div className="card__head">
                Quote confidence <ConfidencePill level={confidence.confidence} />
              </div>
              <div className="card__body">
                <dl className="kv">
                  <dt>Verdict</dt>
                  <dd>{confidence.verdict ?? '—'}</dd>
                  <dt>Lines priced</dt>
                  <dd className="mono">
                    {confidence.n_priced ?? '—'}/{confidence.n_lines ?? '—'}
                    {(confidence.n_unpriced ?? 0) > 0 && <> · <span className="accent">{confidence.n_unpriced} unpriced</span></>}
                  </dd>
                  <dt>Exposure</dt>
                  <dd className="mono">{money(confidence.exposure_usd, 2)}</dd>
                  <dt>COGS</dt>
                  <dd className="mono">{money(confidence.cogs, 4)}</dd>
                  <dt>Computed</dt>
                  <dd className="mono">{dateStr(confidence.computed_at)}</dd>
                </dl>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card__head">Facts</div>
            <div className="card__body">
              <dl className="kv">
                <dt>Serving size</dt>
                <dd>{p.serving_size || '—'}</dd>
                <dt>Servings/unit</dt>
                <dd className="mono">{p.servings_per_unit ?? '—'}</dd>
                <dt>Batch units</dt>
                <dd className="mono">{num(p.batch_units)}</dd>
                <dt>MOQ</dt>
                <dd className="mono">{num(p.moq)}</dd>
                <dt>Revision</dt>
                <dd className="mono">v{p.revision ?? 1}</dd>
                <dt>Milestones</dt>
                <dd>
                  {p.has_formula && <Pill tone="ok">formula</Pill>}{' '}
                  {p.bid_priced && <Pill tone="cyan">priced</Pill>}{' '}
                  {p.mfso_signed && <Pill tone="ok">MFSO signed</Pill>}
                  {!p.has_formula && !p.bid_priced && !p.mfso_signed && <span className="dim">none yet</span>}
                </dd>
              </dl>
            </div>
          </div>

          {history.length > 0 && (
            <div className="card">
              <div className="card__head">Stage history</div>
              <div className="tasklist">
                {history.map((h) => (
                  <div className="task" key={h.id}>
                    <span className="mono dim">{dateStr(h.ts)}</span>
                    <span className="task__what">
                      <b>{h.from_stage ?? '∅'} → {h.to_stage ?? '∅'}</b>
                      <span>{h.actor ?? 'unknown'}</span>
                    </span>
                    <span />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
