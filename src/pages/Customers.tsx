import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  createCustomer,
  createSku,
  duplicateCandidates,
  isUniqueViolation,
  listCustomers,
  listCustomerSkus,
  mergeCustomers,
  similarCustomers,
  updateCustomer,
} from '../lib/api';
import type { CustomerInput, CustomerListRow } from '../lib/api';
import type { Customer, DupCandidate, SimilarCustomer, Sku } from '../lib/types';
import { Drawer, Empty, Field, Modal, fmtNum } from '../components/bits';

const count = (arr: { count: number }[] | undefined) => arr?.[0]?.count ?? 0;

/* Debounced "did you mean" lookup against shopare_similar_customers. */
function useSimilar(name: string, skipId?: string) {
  const [hits, setHits] = useState<SimilarCustomer[]>([]);
  useEffect(() => {
    if (name.trim().length < 3) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const rows = await similarCustomers(name);
        setHits(rows.filter((r) => r.id !== skipId));
      } catch {
        setHits([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [name, skipId]);
  return hits;
}

function CustomerForm({
  initial,
  onSaved,
  onClose,
}: {
  initial: Customer | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [f, setF] = useState<CustomerInput>({
    name: initial?.name ?? '',
    contact_name: initial?.contact_name ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    address: initial?.address ?? '',
    notes: initial?.notes ?? '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const similar = useSimilar(f.name, initial?.id);
  const exact = similar.some((s) => s.sim >= 0.999);

  const set = (k: keyof CustomerInput) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      if (initial) await updateCustomer(initial.id, f);
      else await createCustomer(f);
      onSaved();
    } catch (e) {
      setErr(
        isUniqueViolation(e)
          ? 'A customer with this exact name already exists — duplicates are blocked. Merge or edit the existing record instead.'
          : e instanceof Error
            ? e.message
            : 'Save failed',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {err && <div className="notice err">{err}</div>}
      <Field label="Customer name">
        <input className="input" value={f.name} onChange={set('name')} autoFocus />
      </Field>
      {similar.length > 0 && (
        <div className={exact ? 'notice err' : 'notice warn'}>
          {exact ? 'This customer already exists:' : 'Possible duplicates / typos found:'}
          <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
            {similar.map((s) => (
              <li key={s.id}>
                {s.name} <span className="dup-sim">{Math.round(s.sim * 100)}% match</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="frow">
        <Field label="Contact">
          <input className="input" value={f.contact_name ?? ''} onChange={set('contact_name')} />
        </Field>
        <Field label="Phone">
          <input className="input" value={f.phone ?? ''} onChange={set('phone')} />
        </Field>
      </div>
      <Field label="Email">
        <input className="input" value={f.email ?? ''} onChange={set('email')} />
      </Field>
      <Field label="Address">
        <input className="input" value={f.address ?? ''} onChange={set('address')} />
      </Field>
      <Field label="Notes">
        <textarea className="input" value={f.notes ?? ''} onChange={set('notes')} />
      </Field>
      <div className="modal-foot">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" disabled={busy || !f.name.trim() || exact} onClick={save}>
          {initial ? 'Save changes' : 'Add customer'}
        </button>
      </div>
    </>
  );
}

type ImportRow = {
  name: string;
  contact?: string;
  email?: string;
  phone?: string;
  verdict: 'ok' | 'exact' | 'similar';
  similarTo?: string;
  include: boolean;
};

function ImportModal({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [raw, setRaw] = useState('');
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function analyze() {
    setBusy(true);
    const lines = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const out: ImportRow[] = [];
    for (const line of lines) {
      const [name, contact, email, phone] = line.split(',').map((p) => p.trim());
      if (!name) continue;
      const norm = name.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(norm)) continue; // duplicate inside the paste itself
      seen.add(norm);
      let verdict: ImportRow['verdict'] = 'ok';
      let similarTo: string | undefined;
      try {
        const sims = await similarCustomers(name);
        const exact = sims.find((s) => s.sim >= 0.999);
        const near = sims[0];
        if (exact) {
          verdict = 'exact';
          similarTo = exact.name;
        } else if (near && near.sim >= 0.6) {
          verdict = 'similar';
          similarTo = `${near.name} (${Math.round(near.sim * 100)}%)`;
        }
      } catch {
        /* offline check failed; treat as ok — DB still blocks exact dupes */
      }
      out.push({ name, contact, email, phone, verdict, similarTo, include: verdict !== 'exact' });
    }
    setRows(out);
    setBusy(false);
  }

  async function runImport() {
    if (!rows) return;
    setBusy(true);
    let ok = 0;
    let skipped = 0;
    for (const r of rows) {
      if (!r.include || r.verdict === 'exact') {
        skipped++;
        continue;
      }
      try {
        await createCustomer({
          name: r.name,
          contact_name: r.contact || null,
          email: r.email || null,
          phone: r.phone || null,
        });
        ok++;
      } catch {
        skipped++; // unique-violation race or bad row: never import a dupe
      }
    }
    setBusy(false);
    setResult(`Imported ${ok} customer${ok === 1 ? '' : 's'}, skipped ${skipped}.`);
    onDone();
  }

  return (
    <Modal title="Load customers" wide onClose={onClose}>
      {!rows ? (
        <>
          <div className="notice info">
            One customer per line: <b>Name, Contact, Email, Phone</b> (only Name is required).
            Every line is checked against existing customers — exact duplicates are blocked,
            near-matches are flagged so typos never get in.
          </div>
          <textarea
            className="input"
            rows={10}
            placeholder={'Acme Wellness, Jane Smith, jane@acme.com, 555-0100\nVitality Labs'}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
          <div className="modal-foot">
            <button className="btn secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn" disabled={busy || !raw.trim()} onClick={analyze}>
              {busy ? 'Checking…' : 'Check for duplicates'}
            </button>
          </div>
        </>
      ) : (
        <>
          {result && <div className="notice info">{result}</div>}
          <table className="tbl">
            <thead>
              <tr>
                <th></th>
                <th>Name</th>
                <th>Contact</th>
                <th>Email</th>
                <th>Check</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input
                      type="checkbox"
                      checked={r.include}
                      disabled={r.verdict === 'exact' || !!result}
                      onChange={(e) =>
                        setRows(rows.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))
                      }
                    />
                  </td>
                  <td>{r.name}</td>
                  <td>{r.contact || '—'}</td>
                  <td>{r.email || '—'}</td>
                  <td>
                    {r.verdict === 'ok' && <span className="pill ready">clean</span>}
                    {r.verdict === 'exact' && (
                      <span className="pill qa">duplicate of {r.similarTo} — skipped</span>
                    )}
                    {r.verdict === 'similar' && (
                      <span className="pill in_production">similar to {r.similarTo}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="modal-foot">
            <button className="btn secondary" onClick={onClose}>
              {result ? 'Close' : 'Cancel'}
            </button>
            {!result && (
              <button className="btn" disabled={busy} onClick={runImport}>
                {busy ? 'Importing…' : `Import ${rows.filter((r) => r.include).length} customers`}
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

function MergeModal({
  a,
  b,
  onDone,
  onClose,
}: {
  a: Customer;
  b: Customer;
  onDone: () => void;
  onClose: () => void;
}) {
  const [survivor, setSurvivor] = useState(a.id);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dup = survivor === a.id ? b : a;
  const surv = survivor === a.id ? a : b;

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      await mergeCustomers(surv.id, dup.id);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Merge failed');
      setBusy(false);
    }
  }

  return (
    <Modal title="Merge customers" onClose={onClose}>
      {err && <div className="notice err">{err}</div>}
      <div className="notice info">
        All SKUs, projects and canned jobs move to the customer you keep. Contact details missing on
        the kept record are filled in from the merged one. The merged record is archived (nothing is
        deleted).
      </div>
      {[a, b].map((c) => (
        <label
          key={c.id}
          style={{ display: 'flex', gap: 10, padding: '10px 6px', alignItems: 'start', cursor: 'pointer' }}
        >
          <input type="radio" checked={survivor === c.id} onChange={() => setSurvivor(c.id)} />
          <span>
            <b>{c.name}</b>
            <span className="sub" style={{ display: 'block' }}>
              {[c.contact_name, c.email, c.phone].filter(Boolean).join(' · ') || 'no contact info'}
            </span>
          </span>
        </label>
      ))}
      <div className="modal-foot">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" disabled={busy} onClick={run}>
          {busy ? 'Merging…' : `Keep “${surv.name}”, merge “${dup.name}” into it`}
        </button>
      </div>
    </Modal>
  );
}

function SkuPanel({ customer }: { customer: Customer }) {
  const [skus, setSkus] = useState<Sku[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  const [product, setProduct] = useState('');
  const [form, setForm] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setSkus(await listCustomerSkus(customer.id));
  }, [customer.id]);

  useEffect(() => {
    reload().catch(() => setSkus([]));
  }, [reload]);

  async function addSku() {
    setErr(null);
    try {
      await createSku({
        customer_id: customer.id,
        sku_code: code.trim(),
        product_name: product.trim() || code.trim(),
        dosage_form: form.trim() || null,
      });
      setCode('');
      setProduct('');
      setForm('');
      setAdding(false);
      await reload();
    } catch (e) {
      setErr(
        isUniqueViolation(e)
          ? 'This customer already has a SKU with that code.'
          : e instanceof Error
            ? e.message
            : 'Failed',
      );
    }
  }

  if (!skus) return <div className="sub">Loading SKUs…</div>;
  return (
    <>
      <h4>
        SKUs on file ({skus.length}) — every product registered to {customer.name}
      </h4>
      {skus.length === 0 ? (
        <div className="sub">No SKUs yet. Add the first one below.</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Product</th>
              <th>Form</th>
              <th>Serving</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {skus.map((s) => (
              <tr key={s.id}>
                <td>
                  <b>{s.sku_code}</b>
                </td>
                <td>{s.product_name}</td>
                <td>{s.dosage_form ?? '—'}</td>
                <td>
                  {s.serving_size ?? '—'}
                  {s.servings_per_unit ? ` · ${fmtNum(s.servings_per_unit)}/unit` : ''}
                </td>
                <td>
                  <span className={`pill ${s.status === 'active' ? 'ready' : 'closed'}`}>{s.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {err && <div className="notice err" style={{ marginTop: 8 }}>{err}</div>}
      {adding ? (
        <div className="minirow">
          <div className="field">
            <label>SKU code</label>
            <input className="input" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="field">
            <label>Product name</label>
            <input className="input" value={product} onChange={(e) => setProduct(e.target.value)} />
          </div>
          <div className="field">
            <label>Dosage form</label>
            <input className="input" value={form} onChange={(e) => setForm(e.target.value)} />
          </div>
          <button className="btn sm" disabled={!code.trim()} onClick={addSku}>
            Save SKU
          </button>
          <button className="btn secondary sm" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <button className="btn secondary sm" onClick={() => setAdding(true)}>
            + Add SKU
          </button>
        </div>
      )}
    </>
  );
}

export default function Customers() {
  const [rows, setRows] = useState<CustomerListRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dups, setDups] = useState<DupCandidate[] | null>(null);
  const [showDups, setShowDups] = useState(false);
  const [mergePair, setMergePair] = useState<[Customer, Customer] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const searchRef = useRef(search);
  searchRef.current = search;

  const reload = useCallback(async () => {
    const [list, cand] = await Promise.all([listCustomers(searchRef.current), duplicateCandidates()]);
    setRows(list);
    setDups(cand);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => reload().catch(() => setRows([])), 250);
    return () => clearTimeout(t);
  }, [search, reload]);

  const byId = useMemo(() => new Map((rows ?? []).map((r) => [r.id, r])), [rows]);

  function toggleSelect(id: string) {
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 2 ? [cur[1], id] : [...cur, id],
    );
  }

  function startMerge(idA: string, idB: string) {
    const a = byId.get(idA);
    const b = byId.get(idB);
    if (a && b) setMergePair([a, b]);
  }

  const done = () => {
    setCreating(false);
    setEditing(null);
    setMergePair(null);
    setSelected([]);
    reload();
  };

  return (
    <>
      <div className="page-head">
        <h1>Customers</h1>
        <span className="sub">{rows ? `${rows.length} on file` : ''}</span>
        <div className="spacer" />
        <input
          className="input search"
          placeholder="Search customers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {dups && dups.length > 0 && (
          <button className="btn secondary" onClick={() => setShowDups(!showDups)}>
            ⚠ Review duplicates ({dups.length})
          </button>
        )}
        {selected.length === 2 && (
          <button className="btn secondary" onClick={() => startMerge(selected[0], selected[1])}>
            Merge selected
          </button>
        )}
        <button className="btn secondary" onClick={() => setImporting(true)}>
          Load customers
        </button>
        <button className="btn" onClick={() => setCreating(true)}>
          + New customer
        </button>
      </div>

      {showDups && dups && dups.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3>Possible duplicates</h3>
          <table className="tbl">
            <thead>
              <tr>
                <th>Customer A</th>
                <th>Customer B</th>
                <th>Similarity</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {dups.map((d) => (
                <tr key={`${d.id_a}-${d.id_b}`}>
                  <td>{d.name_a}</td>
                  <td>{d.name_b}</td>
                  <td>
                    <span className="dup-sim">{Math.round(d.sim * 100)}%</span>
                  </td>
                  <td>
                    <button className="btn sm secondary" onClick={() => startMerge(d.id_a, d.id_b)}>
                      Merge…
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        {rows === null ? (
          <div className="empty">Loading…</div>
        ) : rows.length === 0 ? (
          <Empty
            title="No customers yet"
            hint="Use “Load customers” to bring in your list (with duplicate checking), or add one manually."
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 30 }}></th>
                <th>Name</th>
                <th>Contact</th>
                <th>Email</th>
                <th>Phone</th>
                <th>SKUs</th>
                <th>Projects</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <CustomerRow
                  key={c.id}
                  c={c}
                  expanded={expanded === c.id}
                  selected={selected.includes(c.id)}
                  onToggleExpand={() => setExpanded(expanded === c.id ? null : c.id)}
                  onToggleSelect={() => toggleSelect(c.id)}
                  onEdit={() => setEditing(c)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating && (
        <Modal title="New customer" onClose={() => setCreating(false)}>
          <CustomerForm initial={null} onSaved={done} onClose={() => setCreating(false)} />
        </Modal>
      )}
      {editing && (
        <Drawer title={`Edit — ${editing.name}`} onClose={() => setEditing(null)}>
          <CustomerForm initial={editing} onSaved={done} onClose={() => setEditing(null)} />
        </Drawer>
      )}
      {importing && (
        <ImportModal
          onDone={() => reload()}
          onClose={() => setImporting(false)}
        />
      )}
      {mergePair && (
        <MergeModal a={mergePair[0]} b={mergePair[1]} onDone={done} onClose={() => setMergePair(null)} />
      )}
    </>
  );
}

function CustomerRow({
  c,
  expanded,
  selected,
  onToggleExpand,
  onToggleSelect,
  onEdit,
}: {
  c: CustomerListRow;
  expanded: boolean;
  selected: boolean;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
  onEdit: () => void;
}) {
  return (
    <>
      <tr>
        <td>
          <input type="checkbox" checked={selected} onChange={onToggleSelect} title="Select for merge" />
        </td>
        <td>
          <b>{c.name}</b>
        </td>
        <td>{c.contact_name ?? '—'}</td>
        <td>{c.email ?? '—'}</td>
        <td>{c.phone ?? '—'}</td>
        <td>
          <button className="chip" onClick={onToggleExpand}>
            {count(c.skus)} SKU{count(c.skus) === 1 ? '' : 's'}
            <span className="caret">{expanded ? '▲' : '▼'}</span>
          </button>
        </td>
        <td>
          <Link to={`/projects`}>{count(c.projects)}</Link>
        </td>
        <td>
          <button className="btn sm secondary" onClick={onEdit}>
            Edit
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="exp">
          <td colSpan={8}>
            <SkuPanel customer={c} />
          </td>
        </tr>
      )}
    </>
  );
}
