import { useMemo, useState } from 'react';
import { PHASE_LABEL, PHASE_ORDER, PROJECT_STAGE_PHASE, useProjects } from '../lib/queries';
import { Empty, ErrorNotice, Loading, Pill, dateStr } from '../components/bits';

export default function Projects() {
  const projects = useProjects();
  const [q, setQ] = useState('');
  const [phase, setPhase] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!projects.data) return [];
    const needle = q.trim().toLowerCase();
    return projects.data.filter((p) => {
      const ph = PROJECT_STAGE_PHASE[p.stage ?? ''] ?? 'intake';
      if (phase && ph !== phase) return false;
      if (!needle) return true;
      return [p.pn, p.customer_name, p.product, p.pm, p.rep, p.stage]
        .filter(Boolean)
        .some((s) => (s as string).toLowerCase().includes(needle));
    });
  }, [projects.data, q, phase]);

  if (projects.isLoading) return <Loading what="projects" />;
  if (projects.error) return <ErrorNotice error={projects.error} />;

  const counts: Record<string, number> = {};
  for (const p of projects.data ?? []) {
    const ph = PROJECT_STAGE_PHASE[p.stage ?? ''] ?? 'intake';
    counts[ph] = (counts[ph] ?? 0) + 1;
  }

  return (
    <>
      <div className="page__head">
        <h1>Projects &amp; Quotes</h1>
        <span className="dim">{filtered.length} of {projects.data?.length ?? 0} open projects</span>
      </div>

      <div className="filters">
        <input
          type="search"
          placeholder="Search PN, customer, product, PM…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className={`chip${phase === null ? ' active' : ''}`} onClick={() => setPhase(null)}>
          All
        </button>
        {PHASE_ORDER.filter((ph) => counts[ph]).map((ph) => (
          <button
            key={ph}
            className={`chip${phase === ph ? ' active' : ''}`}
            onClick={() => setPhase(phase === ph ? null : ph)}
          >
            {PHASE_LABEL[ph]} ({counts[ph]})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Empty>No projects match.</Empty>
      ) : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>PN</th>
                <th>Customer</th>
                <th>Product</th>
                <th>Form</th>
                <th>Stage</th>
                <th>PM</th>
                <th>Rep</th>
                <th>Received</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((p) => (
                <tr
                  key={p.pn}
                  className="rowlink"
                  onClick={() => (window.location.href = `/projects/${encodeURIComponent(p.pn)}`)}
                >
                  <td className="mono accent">{p.pn}</td>
                  <td className="strong">{p.customer_name || '—'}</td>
                  <td>{p.product || '—'}</td>
                  <td>{p.dosage_form || '—'}{p.is_bulk ? ' (bulk)' : ''}</td>
                  <td>{p.stage || '—'}</td>
                  <td>{p.pm || '—'}</td>
                  <td>{p.rep || '—'}</td>
                  <td className="mono">{dateStr(p.date_received)}</td>
                  <td>
                    {p.has_formula && <Pill tone="ok">formula</Pill>}{' '}
                    {p.bid_priced && <Pill tone="cyan">priced</Pill>}{' '}
                    {p.mfso_signed && <Pill tone="ok">MFSO</Pill>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length > 200 && (
        <p className="dim" style={{ marginTop: 10 }}>
          Showing first 200 — narrow the search to see the rest.
        </p>
      )}
    </>
  );
}
