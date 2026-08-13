import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  addLaborLine,
  addServiceToProject,
  deleteLaborLine,
  getProject,
  listActivity,
  listCannedJobs,
  logActivity,
  removeService,
  setServiceStatus,
  updateLaborLine,
  updateProject,
} from '../lib/api';
import type { CannedJobFull, ProjectDetailData, ServiceDetail } from '../lib/api';
import { PROJECT_STATUSES, STATUS_LABELS } from '../lib/types';
import type { Activity, ProjectStatus, ServiceLabor, ServiceStatus } from '../lib/types';
import { Empty, fmtDate, fmtMoney, fmtNum, fmtWhen, Pill } from '../components/bits';

function LaborRow({
  l,
  onChanged,
}: {
  l: ServiceLabor;
  onChanged: () => void;
}) {
  const [hours, setHours] = useState(String(l.hours));
  const [people, setPeople] = useState(String(l.people));
  const [rate, setRate] = useState(String(l.labor_rate));

  async function commit() {
    const h = Number(hours);
    const p = Number(people);
    const r = Number(rate);
    if (
      Number.isFinite(h) && Number.isFinite(p) && Number.isFinite(r) &&
      (h !== l.hours || p !== l.people || r !== l.labor_rate)
    ) {
      await updateLaborLine(l.id, { hours: h, people: p, labor_rate: r });
      onChanged();
    }
  }

  return (
    <tr>
      <td>{l.stage}</td>
      <td className="num">
        <input className="cell" value={hours} onChange={(e) => setHours(e.target.value)} onBlur={commit} />
      </td>
      <td className="num">
        <input className="cell" value={people} onChange={(e) => setPeople(e.target.value)} onBlur={commit} />
      </td>
      <td className="num">
        <input className="cell" value={rate} onChange={(e) => setRate(e.target.value)} onBlur={commit} />
      </td>
      <td className="num">{fmtMoney(l.hours * l.people * l.labor_rate)}</td>
      <td>
        <span className={`tag ${l.source}`}>{l.source === 'canned' ? 'included' : 'added'}</span>
      </td>
      <td>
        <button
          className="btn sm danger"
          title="Remove labor line"
          onClick={async () => {
            await deleteLaborLine(l.id);
            onChanged();
          }}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

function ServiceCard({
  svc,
  onChanged,
}: {
  svc: ServiceDetail;
  onChanged: () => void;
}) {
  const [addingLabor, setAddingLabor] = useState(false);
  const [stage, setStage] = useState('');
  const [hours, setHours] = useState('');
  const [rate, setRate] = useState('');

  const laborTotal = svc.labor.reduce((s, l) => s + l.hours * l.people * l.labor_rate, 0);

  return (
    <div className="svc">
      <div className="svc-head">
        <b>{svc.name}</b>
        <span className="tag generator">canned job</span>
        <div className="spacer" style={{ flex: 1 }} />
        <select
          className="input"
          style={{ width: 140 }}
          value={svc.status}
          onChange={async (e) => {
            await setServiceStatus(svc.id, e.target.value as ServiceStatus);
            onChanged();
          }}
        >
          <option value="pending">Pending</option>
          <option value="in_progress">In progress</option>
          <option value="done">Done</option>
        </select>
        <button
          className="btn sm danger"
          onClick={async () => {
            if (window.confirm(`Remove “${svc.name}” and all of its lines from this project?`)) {
              await removeService(svc.id);
              onChanged();
            }
          }}
        >
          Remove
        </button>
      </div>

      <div className="svc-sec">
        <h4>Labor</h4>
        {svc.labor.length === 0 && !addingLabor && (
          <div className="sub" style={{ marginBottom: 6 }}>
            No labor lines. This canned job carried no default time — add what applies.
          </div>
        )}
        {svc.labor.length > 0 && (
          <table className="tbl">
            <thead>
              <tr>
                <th>Stage</th>
                <th className="num">Hours</th>
                <th className="num">People</th>
                <th className="num">Rate</th>
                <th className="num">Cost</th>
                <th>Source</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {svc.labor.map((l) => (
                <LaborRow key={l.id} l={l} onChanged={onChanged} />
              ))}
            </tbody>
          </table>
        )}
        {addingLabor ? (
          <div className="minirow">
            <div className="field">
              <label>Stage</label>
              <input className="input" value={stage} onChange={(e) => setStage(e.target.value)} />
            </div>
            <div className="field">
              <label>Hours</label>
              <input className="input" style={{ width: 90 }} value={hours} onChange={(e) => setHours(e.target.value)} />
            </div>
            <div className="field">
              <label>Rate $/hr</label>
              <input className="input" style={{ width: 90 }} value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
            <button
              className="btn sm"
              disabled={!stage.trim() || !Number.isFinite(Number(hours))}
              onClick={async () => {
                await addLaborLine({
                  service_id: svc.id,
                  stage: stage.trim(),
                  hours: Number(hours) || 0,
                  people: 1,
                  labor_rate: Number(rate) || 0,
                });
                setStage('');
                setHours('');
                setRate('');
                setAddingLabor(false);
                onChanged();
              }}
            >
              Add
            </button>
            <button className="btn secondary sm" onClick={() => setAddingLabor(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 8 }}>
            <button className="btn secondary sm" onClick={() => setAddingLabor(true)}>
              + Add labor time
            </button>
            <span className="sub" style={{ marginLeft: 12 }}>
              Labor subtotal: <b>{fmtMoney(laborTotal)}</b>
            </span>
          </div>
        )}
      </div>

      <div className="svc-sec">
        <h4>Ingredients — generated from the approved formulation</h4>
        <div className="notice lock">
          🔒 These lines come straight from the canned job’s locked formulation. They can’t be added
          to or edited here — that’s what keeps the build correct.
        </div>
        {svc.ingredients.length === 0 ? (
          <div className="sub">The formulation carried no ingredient lines.</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Ingredient</th>
                <th>SKU</th>
                <th className="num">Per serving</th>
                <th>Category</th>
              </tr>
            </thead>
            <tbody>
              {svc.ingredients.map((i) => (
                <tr key={i.id}>
                  <td>{i.line_no}</td>
                  <td>{i.name}</td>
                  <td>{i.ingredient_sku ?? '—'}</td>
                  <td className="num">
                    {i.amount_per_serving != null ? `${fmtNum(i.amount_per_serving)} ${i.unit}` : '—'}
                  </td>
                  <td>{i.category ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [p, setP] = useState<ProjectDetailData | null>(null);
  const [jobs, setJobs] = useState<CannedJobFull[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [addJobId, setAddJobId] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id) return;
    const [proj, acts] = await Promise.all([getProject(id), listActivity('project', id)]);
    setP(proj);
    setNotes(proj.notes ?? '');
    setActivity(acts);
  }, [id]);

  useEffect(() => {
    reload().catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load'));
    listCannedJobs().then(setJobs).catch(() => setJobs([]));
  }, [reload]);

  const eligibleJobs = useMemo(
    () =>
      jobs.filter(
        (j) => j.status === 'active' && (!j.customer_id || j.customer_id === p?.customer_id),
      ),
    [jobs, p?.customer_id],
  );

  if (err) return <div className="notice err">{err}</div>;
  if (!p) return <div className="boot">Loading…</div>;

  const laborHours = p.services.flatMap((s) => s.labor).reduce((s, l) => s + l.hours * l.people, 0);
  const laborCost = p.services
    .flatMap((s) => s.labor)
    .reduce((s, l) => s + l.hours * l.people * l.labor_rate, 0);
  const ingredientCount = p.services.reduce((s, x) => s + x.ingredients.length, 0);

  return (
    <>
      <div className="ro-head">
        <span className="ro-no">RO #{p.ro_number}</span>
        <span className="ro-title">{p.title}</span>
        <div style={{ flex: 1 }} />
        <label className="sub">Status</label>
        <select
          className="input"
          style={{ width: 160 }}
          value={p.status}
          onChange={async (e) => {
            const status = e.target.value as ProjectStatus;
            await updateProject(p.id, { status });
            await logActivity('project', p.id, 'status_changed', { to: status });
            reload();
          }}
        >
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <Pill value={p.status} label={STATUS_LABELS[p.status]} />
      </div>

      <div className="ro-grid">
        <div>
          <div className="card">
            <h3>Add a canned job</h3>
            <div className="sub" style={{ marginBottom: 8 }}>
              Services come from approved canned jobs only — the generator copies the locked
              formulation and any included labor time onto this project.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <select
                className="input"
                value={addJobId}
                onChange={(e) => setAddJobId(e.target.value)}
              >
                <option value="">— choose a canned job —</option>
                {eligibleJobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                    {j.customer ? ` (${j.customer.name})` : ' (house)'} · {j.ingredients.length}{' '}
                    ingredients
                  </option>
                ))}
              </select>
              <button
                className="btn"
                disabled={!addJobId}
                onClick={async () => {
                  await addServiceToProject(p.id, addJobId);
                  setAddJobId('');
                  reload();
                }}
              >
                Add to project
              </button>
            </div>
            {eligibleJobs.length === 0 && (
              <div className="notice warn" style={{ marginTop: 10 }}>
                No active canned jobs available for this customer yet. Create one under{' '}
                <Link to="/canned-jobs">Canned Jobs</Link> once the sample is approved and paid.
              </div>
            )}
          </div>

          {p.services.length === 0 ? (
            <div className="card">
              <Empty title="No services on this project yet" hint="Add a canned job above to build the order." />
            </div>
          ) : (
            p.services.map((s) => <ServiceCard key={s.id} svc={s} onChanged={reload} />)
          )}
        </div>

        <div>
          <div className="card">
            <h3>Customer</h3>
            <dl className="kv">
              <dt>Name</dt>
              <dd>{p.customer.name}</dd>
              <dt>Contact</dt>
              <dd>{p.customer.contact_name ?? '—'}</dd>
              <dt>Email</dt>
              <dd>{p.customer.email ?? '—'}</dd>
              <dt>Phone</dt>
              <dd>{p.customer.phone ?? '—'}</dd>
            </dl>
          </div>

          <div className="card">
            <h3>SKU</h3>
            {p.sku ? (
              <dl className="kv">
                <dt>Code</dt>
                <dd>{p.sku.sku_code}</dd>
                <dt>Product</dt>
                <dd>{p.sku.product_name}</dd>
                <dt>Form</dt>
                <dd>{p.sku.dosage_form ?? '—'}</dd>
                <dt>Serving</dt>
                <dd>
                  {p.sku.serving_size ?? '—'}
                  {p.sku.servings_per_unit ? ` · ${fmtNum(p.sku.servings_per_unit)}/unit` : ''}
                </dd>
              </dl>
            ) : (
              <div className="sub">No SKU attached.</div>
            )}
          </div>

          <div className="card">
            <h3>Order</h3>
            <dl className="kv">
              <dt>Batch units</dt>
              <dd>{fmtNum(p.batch_units)}</dd>
              <dt>Customer PO</dt>
              <dd>{p.customer_po ?? '—'}</dd>
              <dt>Promised</dt>
              <dd>{fmtDate(p.promised_date)}</dd>
              <dt>Opened</dt>
              <dd>{fmtDate(p.created_at)}</dd>
            </dl>
          </div>

          <div className="card">
            <h3>Totals</h3>
            <div className="tot">
              <span>Labor hours</span>
              <b>{laborHours.toLocaleString(undefined, { maximumFractionDigits: 1 })}</b>
            </div>
            <div className="tot">
              <span>Ingredient lines</span>
              <b>{ingredientCount}</b>
            </div>
            <div className="tot grand">
              <span>Labor cost</span>
              <b>{fmtMoney(laborCost)}</b>
            </div>
          </div>

          <div className="card">
            <h3>Notes</h3>
            <textarea
              className="input"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={async () => {
                if (notes !== (p.notes ?? '')) {
                  await updateProject(p.id, { notes });
                  reload();
                }
              }}
            />
          </div>

          <div className="card">
            <h3>Activity</h3>
            {activity.length === 0 ? (
              <div className="sub">Nothing yet.</div>
            ) : (
              activity.map((a) => (
                <div className="act" key={a.id}>
                  <div>
                    <b>{a.action.replace(/_/g, ' ')}</b>
                    {a.detail && 'canned_job' in a.detail ? ` — ${String(a.detail.canned_job)}` : ''}
                    {a.detail && 'to' in a.detail ? ` → ${String(a.detail.to)}` : ''}
                  </div>
                  <div className="when">
                    {fmtWhen(a.created_at)}
                    {a.actor ? ` · ${a.actor}` : ''}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
