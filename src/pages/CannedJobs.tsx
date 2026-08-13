import { useCallback, useEffect, useState } from 'react';
import {
  listCannedJobs,
  listCustomers,
  saveCannedJob,
  setCannedJobStatus,
} from '../lib/api';
import type {
  CannedJobFull,
  CannedJobInput,
  CustomerListRow,
  IngredientLineInput,
  LaborLineInput,
} from '../lib/api';
import { Empty, Field, Modal, Pill, fmtNum } from '../components/bits';

interface IngRow {
  name: string;
  ingredient_sku: string;
  amount: string;
  unit: string;
  category: string;
}
interface LabRow {
  stage: string;
  hours: string;
  people: string;
  labor_rate: string;
}

const blankIng = (): IngRow => ({ name: '', ingredient_sku: '', amount: '', unit: 'mg', category: '' });
const blankLab = (): LabRow => ({ stage: '', hours: '', people: '1', labor_rate: '' });

function JobEditor({
  job,
  onSaved,
  onClose,
}: {
  job: CannedJobFull | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const locked = !!job && job.status !== 'draft';
  const [customers, setCustomers] = useState<CustomerListRow[]>([]);
  const [name, setName] = useState(job?.name ?? '');
  const [customerId, setCustomerId] = useState(job?.customer_id ?? '');
  const [form, setForm] = useState(job?.dosage_form ?? '');
  const [desc, setDesc] = useState(job?.description ?? '');
  const [ings, setIngs] = useState<IngRow[]>(
    job?.ingredients.length
      ? job.ingredients.map((i) => ({
          name: i.name,
          ingredient_sku: i.ingredient_sku ?? '',
          amount: String(i.amount_per_serving),
          unit: i.unit,
          category: i.category ?? '',
        }))
      : [blankIng()],
  );
  const [labs, setLabs] = useState<LabRow[]>(
    job?.labor.length
      ? job.labor.map((l) => ({
          stage: l.stage,
          hours: String(l.hours),
          people: String(l.people),
          labor_rate: String(l.labor_rate),
        }))
      : [blankLab()],
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listCustomers('').then(setCustomers).catch(() => setCustomers([]));
  }, []);

  const validIngs = ings.filter((r) => r.name.trim() && Number(r.amount) > 0);
  const badIngs = ings.filter((r) => (r.name.trim() || r.amount) && !(r.name.trim() && Number(r.amount) > 0));

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const jobInput: CannedJobInput = {
        name: name.trim(),
        customer_id: customerId || null,
        dosage_form: form.trim() || null,
        description: desc.trim() || null,
      };
      const ingLines: IngredientLineInput[] = validIngs.map((r, i) => ({
        line_no: i + 1,
        name: r.name.trim(),
        ingredient_sku: r.ingredient_sku.trim() || null,
        amount_per_serving: Number(r.amount),
        unit: r.unit.trim() || 'mg',
        category: r.category.trim() || null,
      }));
      const labLines: LaborLineInput[] = labs
        .filter((r) => r.stage.trim())
        .map((r, i) => ({
          seq: i + 1,
          stage: r.stage.trim(),
          hours: Number(r.hours) || 0,
          people: Number(r.people) || 1,
          labor_rate: Number(r.labor_rate) || 0,
          note: null,
        }));
      await saveCannedJob(jobInput, ingLines, labLines, job?.id);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
      setBusy(false);
    }
  }

  return (
    <Modal title={job ? `Canned job — ${job.name}` : 'New canned job'} wide onClose={onClose}>
      {err && <div className="notice err">{err}</div>}
      {locked && (
        <div className="notice lock">
          🔒 This canned job is {job?.status}. Its formulation is locked and can’t be changed — that
          guarantees every project it lands on is built exactly as approved.
        </div>
      )}
      {!job && (
        <div className="notice info">
          A canned job is a production formulation Enova has approved for repeat manufacturing —
          created when a first-time customer signs off on a sample and pays for the bulk run, or for
          an in-house formulation. Once activated, its ingredient list is locked.
        </div>
      )}
      <div className="frow">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={locked} />
        </Field>
        <Field label="Customer (blank = house formulation)">
          <select
            className="input"
            value={customerId ?? ''}
            onChange={(e) => setCustomerId(e.target.value)}
            disabled={locked}
          >
            <option value="">— house formulation —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Dosage form">
          <input className="input" value={form ?? ''} onChange={(e) => setForm(e.target.value)} disabled={locked} />
        </Field>
      </div>
      <Field label="Description">
        <input className="input" value={desc ?? ''} onChange={(e) => setDesc(e.target.value)} disabled={locked} />
      </Field>

      <h3 style={{ margin: '16px 0 6px' }}>Formulation (per serving)</h3>
      {badIngs.length > 0 && (
        <div className="notice warn">
          {badIngs.length} incomplete ingredient line{badIngs.length === 1 ? '' : 's'} — every line
          needs a name and an amount greater than zero, or it won’t be saved.
        </div>
      )}
      <table className="tbl">
        <thead>
          <tr>
            <th>#</th>
            <th>Ingredient</th>
            <th>SKU</th>
            <th>Amount</th>
            <th>Unit</th>
            <th>Category</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {ings.map((r, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                <input
                  className="input"
                  value={r.name}
                  disabled={locked}
                  onChange={(e) => setIngs(ings.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                />
              </td>
              <td>
                <input
                  className="input"
                  style={{ width: 110 }}
                  value={r.ingredient_sku}
                  disabled={locked}
                  onChange={(e) =>
                    setIngs(ings.map((x, j) => (j === i ? { ...x, ingredient_sku: e.target.value } : x)))
                  }
                />
              </td>
              <td>
                <input
                  className="input"
                  style={{ width: 90 }}
                  value={r.amount}
                  disabled={locked}
                  onChange={(e) => setIngs(ings.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                />
              </td>
              <td>
                <input
                  className="input"
                  style={{ width: 70 }}
                  value={r.unit}
                  disabled={locked}
                  onChange={(e) => setIngs(ings.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))}
                />
              </td>
              <td>
                <input
                  className="input"
                  style={{ width: 120 }}
                  value={r.category}
                  disabled={locked}
                  onChange={(e) => setIngs(ings.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))}
                />
              </td>
              <td>
                {!locked && (
                  <button className="btn sm danger" onClick={() => setIngs(ings.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!locked && (
        <button className="btn secondary sm" style={{ marginTop: 8 }} onClick={() => setIngs([...ings, blankIng()])}>
          + Ingredient line
        </button>
      )}

      <h3 style={{ margin: '16px 0 6px' }}>Included labor time (defaults copied to each project)</h3>
      <table className="tbl">
        <thead>
          <tr>
            <th>Stage</th>
            <th>Hours</th>
            <th>People</th>
            <th>Rate $/hr</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {labs.map((r, i) => (
            <tr key={i}>
              <td>
                <input
                  className="input"
                  value={r.stage}
                  disabled={locked}
                  onChange={(e) => setLabs(labs.map((x, j) => (j === i ? { ...x, stage: e.target.value } : x)))}
                />
              </td>
              <td>
                <input
                  className="input"
                  style={{ width: 80 }}
                  value={r.hours}
                  disabled={locked}
                  onChange={(e) => setLabs(labs.map((x, j) => (j === i ? { ...x, hours: e.target.value } : x)))}
                />
              </td>
              <td>
                <input
                  className="input"
                  style={{ width: 80 }}
                  value={r.people}
                  disabled={locked}
                  onChange={(e) => setLabs(labs.map((x, j) => (j === i ? { ...x, people: e.target.value } : x)))}
                />
              </td>
              <td>
                <input
                  className="input"
                  style={{ width: 90 }}
                  value={r.labor_rate}
                  disabled={locked}
                  onChange={(e) =>
                    setLabs(labs.map((x, j) => (j === i ? { ...x, labor_rate: e.target.value } : x)))
                  }
                />
              </td>
              <td>
                {!locked && (
                  <button className="btn sm danger" onClick={() => setLabs(labs.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!locked && (
        <button className="btn secondary sm" style={{ marginTop: 8 }} onClick={() => setLabs([...labs, blankLab()])}>
          + Labor line
        </button>
      )}

      <div className="modal-foot">
        <button className="btn secondary" onClick={onClose}>
          {locked ? 'Close' : 'Cancel'}
        </button>
        {!locked && (
          <button className="btn" disabled={busy || !name.trim() || validIngs.length === 0} onClick={save}>
            {busy ? 'Saving…' : 'Save draft'}
          </button>
        )}
      </div>
    </Modal>
  );
}

export default function CannedJobs() {
  const [jobs, setJobs] = useState<CannedJobFull[] | null>(null);
  const [editing, setEditing] = useState<CannedJobFull | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(() => {
    listCannedJobs().then(setJobs).catch((e) => {
      setJobs([]);
      setErr(e instanceof Error ? e.message : 'Failed to load');
    });
  }, []);

  useEffect(reload, [reload]);

  async function activate(j: CannedJobFull) {
    setErr(null);
    try {
      await setCannedJobStatus(j.id, 'active');
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Activation failed');
    }
  }

  const done = () => {
    setCreating(false);
    setEditing(null);
    reload();
  };

  return (
    <>
      <div className="page-head">
        <h1>Canned Jobs</h1>
        <span className="sub">Approved production formulations — the generator’s source of truth</span>
        <div className="spacer" />
        <button className="btn" onClick={() => setCreating(true)}>
          + New canned job
        </button>
      </div>

      {err && <div className="notice err">{err}</div>}

      <div className="card" style={{ padding: 0 }}>
        {jobs === null ? (
          <div className="empty">Loading…</div>
        ) : jobs.length === 0 ? (
          <Empty
            title="No canned jobs yet"
            hint="When a customer approves a sample and pays for a bulk run — or you standardize an in-house formulation — create it here. Activating locks the formulation."
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Customer</th>
                <th>Form</th>
                <th>Status</th>
                <th className="num">Ingredients</th>
                <th className="num">Labor stages</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="rowlink" onClick={() => setEditing(j)}>
                  <td>
                    <b>{j.name}</b>
                  </td>
                  <td>{j.customer?.name ?? <span className="sub">House</span>}</td>
                  <td>{j.dosage_form ?? '—'}</td>
                  <td>
                    <Pill value={j.status} />
                  </td>
                  <td className="num">{fmtNum(j.ingredients.length)}</td>
                  <td className="num">{fmtNum(j.labor.length)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {j.status === 'draft' && (
                      <button
                        className="btn sm"
                        disabled={j.ingredients.length === 0}
                        title={
                          j.ingredients.length === 0
                            ? 'Add ingredients before activating'
                            : 'Lock the formulation and make it available on projects'
                        }
                        onClick={() => activate(j)}
                      >
                        Activate
                      </button>
                    )}
                    {j.status === 'active' && (
                      <button className="btn sm secondary" onClick={() => setCannedJobStatus(j.id, 'retired').then(reload)}>
                        Retire
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(creating || editing) && (
        <JobEditor job={editing} onSaved={done} onClose={() => (creating ? setCreating(false) : setEditing(null))} />
      )}
    </>
  );
}
