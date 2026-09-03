/**
 * The customer approval page.
 *
 * Reached from a single-use link, with no login. The customer reviews the
 * product they are being asked to approve — the specification, the label and
 * the price — and either e-signs their approval (which locks it as the
 * production-of-record) or asks for changes. It talks only to the public,
 * token-scoped API, which never exposes cost or margin.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { money, number } from '../lib/format';

interface ApprovalPackage {
  project: { id: string; name: string; code: string; revision: number };
  customer: string;
  requestedAt: string | null;
  product: {
    name: string; format: string; servingSize: string; servingsPerUnit: number;
    ingredients: { name: string; amount: number | null; unit: string }[];
    packaging: string[]; allergens: string[]; claims: string[];
  } | null;
  label: { productName: string; brand: string; revision: string; status: string } | null;
  price: { currency: string; leadTimeWeeks: number | null; paymentTerms: string; tiers: { quantity: number; unitPrice: number }[] };
}

type Phase = 'loading' | 'gone' | 'ready' | 'approved' | 'changes';

export function ApprovalPage() {
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>('loading');
  const [pkg, setPkg] = useState<ApprovalPackage | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const [mode, setMode] = useState<'approve' | 'changes' | null>(null);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [agree, setAgree] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/public/approval/${token}`);
        if (!alive) return;
        if (res.ok) { setPkg(await res.json()); setPhase('ready'); }
        else { setErrorMsg((await res.json().catch(() => ({}))).error ?? ''); setPhase('gone'); }
      } catch { if (alive) setPhase('gone'); }
    })();
    return () => { alive = false; };
  }, [token]);

  const submit = async () => {
    setFormError('');
    if (!name.trim()) { setFormError('Please enter your name.'); return; }
    if (mode === 'approve' && !agree) { setFormError('Please tick the box to confirm your approval.'); return; }
    if (mode === 'changes' && !comment.trim()) { setFormError('Please describe the changes you need.'); return; }
    setBusy(true);
    try {
      const path = mode === 'approve' ? 'approve' : 'request-changes';
      const body = mode === 'approve'
        ? { signedName: name, signedTitle: title, agree: true }
        : { signedName: name, comment };
      const res = await fetch(`/api/public/approval/${token}/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) { setFormError((await res.json().catch(() => ({}))).error ?? 'Something went wrong. Please try again.'); setBusy(false); return; }
      setPhase(mode === 'approve' ? 'approved' : 'changes');
    } catch { setFormError('Could not reach the server. Please try again.'); setBusy(false); }
  };

  return (
    <div className="approve-shell">
      <header className="approve-top">
        <span className="approve-brand">Enova&nbsp;Science</span>
        <span className="approve-top-sub">Product approval</span>
      </header>

      <main className="approve-main">
        {phase === 'loading' && <div className="approve-card"><div className="approve-pad"><span className="spinner" /> Loading…</div></div>}

        {phase === 'gone' && (
          <div className="approve-card">
            <div className="approve-pad approve-center">
              <div className="approve-emoji">🔗</div>
              <h2>This link is no longer active</h2>
              <p className="approve-muted">{errorMsg || 'The approval may have already been completed, or the link has expired. Please contact your Enova representative for a current link.'}</p>
            </div>
          </div>
        )}

        {phase === 'approved' && (
          <div className="approve-card">
            <div className="approve-pad approve-center">
              <div className="approve-emoji">✅</div>
              <h2>Thank you — approval recorded</h2>
              <p className="approve-muted">{pkg?.product?.name ?? 'Your product'} is now approved for production. The Enova team has been notified and will be in touch with next steps.</p>
            </div>
          </div>
        )}

        {phase === 'changes' && (
          <div className="approve-card">
            <div className="approve-pad approve-center">
              <div className="approve-emoji">✏️</div>
              <h2>Thanks — your changes are on their way</h2>
              <p className="approve-muted">We’ve sent your notes to the Enova team. They’ll make the updates and send you a fresh version to review.</p>
            </div>
          </div>
        )}

        {phase === 'ready' && pkg && (
          <>
            <div className="approve-intro">
              <h1>{pkg.product?.name ?? pkg.project.name}</h1>
              <p className="approve-muted">
                {pkg.customer ? `Prepared for ${pkg.customer}. ` : ''}
                Please review the details below and approve, or let us know what to change.
                {pkg.project.revision > 1 ? ` (Revision ${pkg.project.revision})` : ''}
              </p>
            </div>

            {pkg.product && (
              <div className="approve-card">
                <div className="approve-card-head">Specification</div>
                <div className="approve-pad">
                  <div className="approve-facts">
                    {pkg.product.format && <div><dt>Format</dt><dd>{titleCase(pkg.product.format)}</dd></div>}
                    {pkg.product.servingSize && <div><dt>Serving size</dt><dd>{pkg.product.servingSize}</dd></div>}
                    {pkg.product.servingsPerUnit ? <div><dt>Servings / unit</dt><dd>{pkg.product.servingsPerUnit}</dd></div> : null}
                    {pkg.product.packaging.length > 0 && <div><dt>Packaging</dt><dd>{pkg.product.packaging.join(', ')}</dd></div>}
                  </div>

                  {pkg.product.ingredients.length > 0 && (
                    <table className="approve-table">
                      <thead><tr><th>Ingredient</th><th className="right">Amount / serving</th></tr></thead>
                      <tbody>
                        {pkg.product.ingredients.map((ing, i) => (
                          <tr key={i}><td>{ing.name}</td><td className="right">{ing.amount != null ? `${number(ing.amount, ing.amount < 10 ? 2 : 0)} ${ing.unit}` : '—'}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {pkg.product.allergens.length > 0 && <p className="approve-note"><strong>Allergens:</strong> {pkg.product.allergens.join(', ')}</p>}
                  {pkg.product.claims.length > 0 && <p className="approve-note"><strong>Claims:</strong> {pkg.product.claims.join(' · ')}</p>}
                </div>
              </div>
            )}

            {pkg.price.tiers.length > 0 && (
              <div className="approve-card">
                <div className="approve-card-head">Price</div>
                <div className="approve-pad">
                  <table className="approve-table">
                    <thead><tr><th>Order quantity</th><th className="right">Price / unit</th></tr></thead>
                    <tbody>
                      {pkg.price.tiers.map((t, i) => (
                        <tr key={i}><td>{number(t.quantity)} units</td><td className="right approve-price">{money(t.unitPrice, 4)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="approve-muted approve-small">
                    {pkg.price.leadTimeWeeks ? `Lead time approximately ${pkg.price.leadTimeWeeks} weeks. ` : ''}
                    {pkg.price.paymentTerms ? `Terms: ${pkg.price.paymentTerms}.` : ''}
                  </p>
                </div>
              </div>
            )}

            <div className="approve-card">
              <div className="approve-pad">
                {mode === null && (
                  <div className="approve-actions">
                    <button type="button" className="approve-btn approve-btn-primary" onClick={() => setMode('approve')}>Approve this product</button>
                    <button type="button" className="approve-btn" onClick={() => setMode('changes')}>Request changes</button>
                  </div>
                )}

                {mode === 'approve' && (
                  <div className="approve-form">
                    <h3>Approve for production</h3>
                    <p className="approve-muted approve-small">By approving, you confirm this is the product to manufacture. It becomes the approved specification of record.</p>
                    <div className="approve-fields">
                      <label>Your full name<input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
                      <label>Title (optional)<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
                    </div>
                    <label className="approve-check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I approve this product specification, label and price for production.</label>
                    {formError && <div className="approve-error">{formError}</div>}
                    <div className="approve-actions">
                      <button type="button" className="approve-btn approve-btn-primary" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Confirm approval'}</button>
                      <button type="button" className="approve-btn approve-btn-ghost" disabled={busy} onClick={() => { setMode(null); setFormError(''); }}>Back</button>
                    </div>
                  </div>
                )}

                {mode === 'changes' && (
                  <div className="approve-form">
                    <h3>Request changes</h3>
                    <p className="approve-muted approve-small">Tell us what to adjust and we’ll send an updated version to review.</p>
                    <div className="approve-fields">
                      <label>Your full name<input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
                    </div>
                    <label className="approve-block">What would you like changed?<textarea rows={4} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
                    {formError && <div className="approve-error">{formError}</div>}
                    <div className="approve-actions">
                      <button type="button" className="approve-btn approve-btn-primary" disabled={busy} onClick={submit}>{busy ? 'Sending…' : 'Send to Enova'}</button>
                      <button type="button" className="approve-btn approve-btn-ghost" disabled={busy} onClick={() => { setMode(null); setFormError(''); }}>Back</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      <footer className="approve-foot">Enova Science · This is a secure, private approval link. Please don’t share it.</footer>
    </div>
  );
}

function titleCase(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
