import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createProject,
  createSku,
  listCustomers,
  listCustomerSkus,
  listProjects,
} from '../lib/api';
import type { CustomerListRow, ProjectListRow } from '../lib/api';
import { PROJECT_STATUSES, STATUS_LABELS } from '../lib/types';
import type { ProjectStatus, Sku } from '../lib/types';
import { Empty, Field, Modal, Pill, fmtDate, fmtNum } from '../components/bits';

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [customers, setCustomers] = useState<CustomerListRow[]>([]);
  const [custSearch, setCustSearch] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [skus, setSkus] = useState<Sku[]>([]);
  const [skuId, setSkuId] = useState('');
  const [newSku, setNewSku] = useState(false);
  const [skuCode, setSkuCode] = useState('');
  const [skuProduct, setSkuProduct] = useState('');
  const [skuForm, setSkuForm] = useState('');
  const [title, setTitle] = useState('');
  const [units, setUnits] = useState('');
  const [po, setPo] = useState('');
  const [promised, setPromised] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(
      () => listCustomers(custSearch).then(setCustomers).catch(() => setCustomers([])),
      250,
    );
    return () => clearTimeout(t);
  }, [custSearch]);

  useEffect(() => {
    setSkuId('');
    setNewSku(false);
    if (!customerId) {
      setSkus([]);
      return;
    }
    listCustomerSkus(customerId).then(setSkus).catch(() => setSkus([]));
  }, [customerId]);

  const selectedSku = skus.find((s) => s.id === skuId);

  useEffect(() => {
    // Sensible default title, still editable.
    if (selectedSku && !title) setTitle(`${selectedSku.product_name} production run`);
  }, [selectedSku, title]);

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      let finalSkuId: string | null = skuId || null;
      if (newSku && skuCode.trim()) {
        const s = await createSku({
          customer_id: customerId,
          sku_code: skuCode.trim(),
          product_name: skuProduct.trim() || skuCode.trim(),
          dosage_form: skuForm.trim() || null,
        });
        finalSkuId = s.id;
      }
      const p = await createProject({
        customer_id: customerId,
        sku_id: finalSkuId,
        title: title.trim() || 'Untitled project',
        batch_units: units ? Number(units) : null,
        customer_po: po.trim() || null,
        promised_date: promised || null,
      });
      nav(`/projects/${p.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create project');
      setBusy(false);
    }
  }

  return (
    <Modal title="New project" onClose={onClose}>
      {err && <div className="notice err">{err}</div>}
      <Field label="Customer">
        <input
          className="input"
          placeholder="Search customers…"
          value={custSearch}
          onChange={(e) => setCustSearch(e.target.value)}
        />
      </Field>
      <Field label="Select customer">
        <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">— choose —</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      {customerId && (
        <Field label={`SKU (${skus.length} on file for this customer)`}>
          <select
            className="input"
            value={newSku ? '__new' : skuId}
            onChange={(e) => {
              if (e.target.value === '__new') {
                setNewSku(true);
                setSkuId('');
              } else {
                setNewSku(false);
                setSkuId(e.target.value);
              }
            }}
          >
            <option value="">— no SKU yet —</option>
            {skus.map((s) => (
              <option key={s.id} value={s.id}>
                {s.sku_code} · {s.product_name}
              </option>
            ))}
            <option value="__new">+ Register a new SKU…</option>
          </select>
        </Field>
      )}
      {newSku && (
        <div className="frow">
          <Field label="SKU code">
            <input className="input" value={skuCode} onChange={(e) => setSkuCode(e.target.value)} />
          </Field>
          <Field label="Product name">
            <input className="input" value={skuProduct} onChange={(e) => setSkuProduct(e.target.value)} />
          </Field>
          <Field label="Dosage form">
            <input className="input" value={skuForm} onChange={(e) => setSkuForm(e.target.value)} />
          </Field>
        </div>
      )}
      <Field label="Project title">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div className="frow">
        <Field label="Batch units">
          <input
            className="input"
            type="number"
            min="0"
            value={units}
            onChange={(e) => setUnits(e.target.value)}
          />
        </Field>
        <Field label="Customer PO">
          <input className="input" value={po} onChange={(e) => setPo(e.target.value)} />
        </Field>
        <Field label="Promised date">
          <input
            className="input"
            type="date"
            value={promised}
            onChange={(e) => setPromised(e.target.value)}
          />
        </Field>
      </div>
      <div className="modal-foot">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" disabled={busy || !customerId || !title.trim()} onClick={create}>
          {busy ? 'Creating…' : 'Create project'}
        </button>
      </div>
    </Modal>
  );
}

export default function Projects() {
  const nav = useNavigate();
  const [rows, setRows] = useState<ProjectListRow[] | null>(null);
  const [tab, setTab] = useState<'all' | ProjectStatus>('all');
  const [creating, setCreating] = useState(false);

  const reload = useCallback(() => {
    listProjects().then(setRows).catch(() => setRows([]));
  }, []);

  useEffect(reload, [reload]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return m;
  }, [rows]);

  const visible = (rows ?? []).filter((r) => tab === 'all' || r.status === tab);

  return (
    <>
      <div className="page-head">
        <h1>Projects</h1>
        <span className="sub">{rows ? `${rows.length} total` : ''}</span>
        <div className="spacer" />
        <button className="btn" onClick={() => setCreating(true)}>
          + New project
        </button>
      </div>

      <div className="tabs">
        <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
          All<span className="count">{rows?.length ?? 0}</span>
        </button>
        {PROJECT_STATUSES.map((s) => (
          <button key={s} className={tab === s ? 'on' : ''} onClick={() => setTab(s)}>
            {STATUS_LABELS[s]}
            <span className="count">{counts.get(s) ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0 }}>
        {rows === null ? (
          <div className="empty">Loading…</div>
        ) : visible.length === 0 ? (
          <Empty
            title={tab === 'all' ? 'No projects yet' : `Nothing in ${STATUS_LABELS[tab as ProjectStatus]}`}
            hint="Create a project to open a production order for a customer SKU."
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>RO #</th>
                <th>Title</th>
                <th>Customer</th>
                <th>SKU</th>
                <th>Status</th>
                <th className="num">Units</th>
                <th>Promised</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id} className="rowlink" onClick={() => nav(`/projects/${p.id}`)}>
                  <td>
                    <b>#{p.ro_number}</b>
                  </td>
                  <td>{p.title}</td>
                  <td>{p.customer?.name ?? '—'}</td>
                  <td>{p.sku ? `${p.sku.sku_code} · ${p.sku.product_name}` : '—'}</td>
                  <td>
                    <Pill value={p.status} label={STATUS_LABELS[p.status]} />
                  </td>
                  <td className="num">{fmtNum(p.batch_units)}</td>
                  <td>{fmtDate(p.promised_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating && <NewProjectModal onClose={() => setCreating(false)} />}
    </>
  );
}
