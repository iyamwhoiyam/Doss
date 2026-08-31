/**
 * Printable documents.
 *
 * One route, /print/:kind/:id, renders a clean paper layout for a quote bid
 * sheet, a product spec sheet, a batch record or a label proof. A print
 * stylesheet strips everything but the document, so the browser's "Save as PDF"
 * produces a tidy file — no server-side PDF engine, works on every device.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { api } from '../lib/api';
import { date, dateTime, money, number, mg } from '../lib/format';

type Kind = 'quote' | 'spec' | 'batch' | 'label';

export function PrintDoc() {
  const { kind, id } = useParams<{ kind: Kind; id: string }>();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const bundle = await loadBundle(kind as Kind, id!);
        if (alive) setData(bundle);
      } catch (e) { if (alive) setErr((e as Error).message || 'Could not load the document'); }
    })();
    return () => { alive = false; };
  }, [kind, id]);

  const title = { quote: 'Quotation', spec: 'Product Specification', batch: 'Batch Record', label: 'Label Proof' }[kind as Kind] ?? 'Document';

  return (
    <div className="print-shell">
      <div className="print-bar">
        <span>{title}</span>
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>Download / Print PDF</button>
      </div>

      {err && <div className="print-page"><p>{err}</p></div>}
      {!err && !data && <div className="print-page"><p>Loading…</p></div>}
      {!err && data && (
        <div className="print-page">
          <header className="print-head">
            <div>
              <div className="print-brand">Enova Science</div>
              <div className="print-muted">GMP nutraceutical contract manufacturing</div>
            </div>
            <div className="print-doc-meta">
              <div className="print-doc-title">{title}</div>
              <div className="print-muted">{date(new Date().toISOString())}</div>
            </div>
          </header>
          {kind === 'quote' && <QuoteDoc d={data} />}
          {kind === 'spec' && <SpecDoc d={data} />}
          {kind === 'batch' && <BatchDoc d={data} />}
          {kind === 'label' && <LabelDoc d={data} />}
          <footer className="print-foot">Enova Science · Generated {dateTime(new Date().toISOString())} · Confidential</footer>
        </div>
      )}
    </div>
  );
}

async function loadBundle(kind: Kind, id: string): Promise<Record<string, unknown>> {
  if (kind === 'quote') {
    const quote = await api.get<Record<string, any>>(`/data/quotes/${id}`);
    const [customer, formula] = await Promise.all([
      quote.customerId ? api.get(`/data/customers/${quote.customerId}`).catch(() => null) : null,
      quote.formulaId ? api.get(`/data/formulas/${quote.formulaId}`).catch(() => null) : null,
    ]);
    return { quote, customer, formula };
  }
  if (kind === 'spec') return { formula: await api.get(`/data/formulas/${id}`) };
  if (kind === 'batch') {
    const wo = await api.get<Record<string, any>>(`/data/workOrders/${id}`);
    const customer = wo.customerId ? await api.get(`/data/customers/${wo.customerId}`).catch(() => null) : null;
    return { wo, customer };
  }
  if (kind === 'label') return { label: await api.get(`/data/labelReviews/${id}`) };
  throw new Error(`Unknown document type "${kind}"`);
}

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="print-kv"><dt>{label}</dt><dd>{value ?? '—'}</dd></div>
);

function QuoteDoc({ d }: { d: any }) {
  const q = d.quote; const c = d.customer; const f = d.formula;
  const tiers = q.result?.tiers ?? [];
  return (
    <>
      <div className="print-grid">
        <Row label="Quote #" value={<span className="mono">{q.quoteNumber}</span>} />
        <Row label="Customer" value={c?.name} />
        <Row label="Product" value={q.title || f?.name} />
        <Row label="Valid until" value={date(q.validUntil)} />
        <Row label="Lead time" value={q.leadTimeWeeks ? `${q.leadTimeWeeks} weeks` : '—'} />
        <Row label="Payment terms" value={q.paymentTerms} />
      </div>
      <h3 className="print-h3">Pricing</h3>
      <table className="print-table">
        <thead><tr><th>Order quantity</th><th className="right">Price / unit</th><th className="right">Extended</th></tr></thead>
        <tbody>
          {tiers.map((t: any, i: number) => (
            <tr key={i}>
              <td>{number(Number(t.qty))} units</td>
              <td className="right">{money(Number(t.salePricePerUnit), 4)}</td>
              <td className="right">{money(Number(t.salePricePerUnit) * Number(t.qty), 2)}</td>
            </tr>
          ))}
          {tiers.length === 0 && <tr><td colSpan={3} className="print-muted">Not yet priced.</td></tr>}
        </tbody>
      </table>
      {q.notes && <><h3 className="print-h3">Notes</h3><p>{q.notes}</p></>}
      <p className="print-muted print-small">Pricing is exclusive of freight and applicable taxes. A one-time certificate-of-analysis fee applies per the terms above.</p>
    </>
  );
}

function SpecDoc({ d }: { d: any }) {
  const f = d.formula;
  const actives = [...(f.actives ?? []), ...(f.excipients ?? [])].filter((i: any) => !i.isBaseFill);
  return (
    <>
      <div className="print-grid">
        <Row label="Formula" value={<span className="mono">{f.code}</span>} />
        <Row label="Name" value={f.name} />
        <Row label="Format" value={f.format} />
        <Row label="Serving size" value={f.servingSize} />
        <Row label="Servings / unit" value={f.servingsPerUnit} />
        <Row label="Revision" value={`${f.revision ?? 1} · ${f.status}`} />
      </div>
      <h3 className="print-h3">Composition (per serving)</h3>
      <table className="print-table">
        <thead><tr><th>Ingredient</th><th className="right">Amount</th></tr></thead>
        <tbody>
          {actives.map((i: any, idx: number) => (
            <tr key={idx}><td>{i.labelName || i.name}</td><td className="right">{i.targetMg != null ? mg(i.targetMg) : (i.inputMg != null ? mg(i.inputMg) : '—')}</td></tr>
          ))}
        </tbody>
      </table>
      {(f.allergens ?? []).length > 0 && <p><strong>Allergens:</strong> {f.allergens.join(', ')}</p>}
      {(f.claims ?? []).length > 0 && <p><strong>Claims:</strong> {f.claims.join(' · ')}</p>}
      {(f.packaging ?? []).length > 0 && <p><strong>Packaging:</strong> {f.packaging.map((p: any) => p.name || p.labelName).filter(Boolean).join(', ')}</p>}
    </>
  );
}

function BatchDoc({ d }: { d: any }) {
  const wo = d.wo; const c = d.customer;
  return (
    <>
      <div className="print-grid">
        <Row label="Work order" value={<span className="mono">{wo.woNumber}</span>} />
        <Row label="Batch" value={<span className="mono">{wo.batchNumber}</span>} />
        <Row label="Product" value={wo.productName} />
        <Row label="Customer" value={c?.name} />
        <Row label="Line" value={wo.line} />
        <Row label="Planned qty" value={`${number(wo.plannedQty)} ${wo.uom}`} />
        <Row label="Actual qty" value={wo.actualQty ? number(wo.actualQty) : '—'} />
        <Row label="Yield" value={wo.yieldPct ? `${wo.yieldPct}%` : '—'} />
      </div>
      <h3 className="print-h3">Materials</h3>
      <table className="print-table">
        <thead><tr><th>Material</th><th className="right">Planned</th><th className="right">Issued</th><th>Lot</th></tr></thead>
        <tbody>
          {(wo.materials ?? []).map((m: any, i: number) => (
            <tr key={i}><td>{m.name}</td><td className="right">{number(m.plannedQty, 3)} {m.uom}</td><td className="right">{number(m.issuedQty, 3)}</td><td className="mono">{m.lotNumber || '—'}</td></tr>
          ))}
        </tbody>
      </table>
      <h3 className="print-h3">Batch steps</h3>
      <table className="print-table">
        <thead><tr><th>Step</th><th>Done</th><th>By</th><th>When</th></tr></thead>
        <tbody>
          {(wo.steps ?? []).map((s: any, i: number) => (
            <tr key={i}><td>{s.name}</td><td>{s.done ? '✓' : '☐'}</td><td>{s.doneBy || ''}</td><td>{s.doneAt ? date(s.doneAt) : ''}</td></tr>
          ))}
        </tbody>
      </table>
      {(wo.qcChecks ?? []).length > 0 && (
        <>
          <h3 className="print-h3">In-process QC</h3>
          <table className="print-table">
            <thead><tr><th>Check</th><th>Spec</th><th>Result</th><th>Status</th></tr></thead>
            <tbody>
              {wo.qcChecks.map((q: any, i: number) => (
                <tr key={i}><td>{q.name}</td><td>{q.spec}</td><td>{q.result || '—'}</td><td>{q.status}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div className="print-signoff">
        <div>Released by: ______________________</div>
        <div>Date: ____________</div>
      </div>
    </>
  );
}

function LabelDoc({ d }: { d: any }) {
  const l = d.label;
  const sf = l.supplementFacts;
  const rows = sf?.rows ?? sf?.nutrients ?? [];
  return (
    <>
      <div className="print-grid">
        <Row label="Review #" value={<span className="mono">{l.reviewNumber}</span>} />
        <Row label="Product" value={l.productName} />
        <Row label="Brand" value={l.brand} />
        <Row label="Label revision" value={l.labelRevision} />
        <Row label="Status" value={l.status} />
      </div>
      {rows.length > 0 && (
        <>
          <h3 className="print-h3">Supplement Facts</h3>
          <table className="print-table print-sf">
            <thead><tr><th>Nutrient</th><th className="right">Amount / serving</th><th className="right">% DV</th></tr></thead>
            <tbody>
              {rows.map((r: any, i: number) => (
                <tr key={i}><td>{r.name || r.nutrient}</td><td className="right">{r.amount ?? r.declared ?? '—'}</td><td className="right">{r.dv ?? r.percentDv ?? ''}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="print-muted print-small">This proof reflects the copy on file. Confirm all on-artwork placement against the printed dieline before release.</p>
    </>
  );
}
