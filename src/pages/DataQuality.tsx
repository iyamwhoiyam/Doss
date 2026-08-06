import { useMemo, useState } from 'react';
import { useFlags, useResolveFlag } from '../lib/queries';
import { useActor } from '../lib/session';
import { Empty, ErrorNotice, Loading, Pill } from '../components/bits';

export default function DataQuality() {
  const flags = useFlags('open');
  const actor = useActor();
  const resolve = useResolveFlag(actor);
  const [sev, setSev] = useState<string | null>(null);
  const [table, setTable] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!flags.data) return [];
    return flags.data.filter(
      (f) => (!sev || f.severity === sev) && (!table || f.source_table === table),
    );
  }, [flags.data, sev, table]);

  if (flags.isLoading) return <Loading what="data quality flags" />;
  if (flags.error) return <ErrorNotice error={flags.error} />;

  const bySev: Record<string, number> = {};
  const byTable: Record<string, number> = {};
  for (const f of flags.data ?? []) {
    bySev[f.severity ?? '?'] = (bySev[f.severity ?? '?'] ?? 0) + 1;
    byTable[f.source_table ?? '?'] = (byTable[f.source_table ?? '?'] ?? 0) + 1;
  }

  return (
    <>
      <div className="page__head">
        <h1>Data Quality</h1>
        <span className="dim">{flags.data?.length ?? 0} open flags — each one is a record that disagrees with reality</span>
      </div>

      <div className="filters">
        {Object.entries(bySev).map(([s, n]) => (
          <button key={s} className={`chip${sev === s ? ' active' : ''}`} onClick={() => setSev(sev === s ? null : s)}>
            {s} ({n})
          </button>
        ))}
        <span style={{ width: 12 }} />
        {Object.entries(byTable).map(([t, n]) => (
          <button key={t} className={`chip${table === t ? ' active' : ''}`} onClick={() => setTable(table === t ? null : t)}>
            {t.replace('erp_', '')} ({n})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Empty>No open flags match. The data is (locally) clean.</Empty>
      ) : (
        <div className="flaglist">
          {filtered.slice(0, 60).map((f) => (
            <div className="flag" key={f.id}>
              <div className="flag__head">
                <Pill tone={f.severity === 'error' ? 'bad' : f.severity === 'warn' ? 'warn' : 'cyan'}>
                  {f.severity}
                </Pill>
                <span className="flag__ref">{f.source_table} · {f.source_ref}</span>
                <span className="flag__field">{f.field}</span>
              </div>
              <p className="flag__reason">{f.reason}</p>
              <div className="flag__vals">
                <span>
                  observed <b className="accent">{f.observed_value ?? '∅'}</b>
                </span>
                {f.suggested_value && (
                  <span>
                    suggested <b>{f.suggested_value}</b>
                  </span>
                )}
              </div>
              <div className="flag__actions">
                <button
                  className="btn btn--primary btn--sm"
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate({ flag: f, resolution: 'resolved' })}
                >
                  Mark resolved
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate({ flag: f, resolution: 'dismissed' })}
                >
                  Dismiss (not an issue)
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {filtered.length > 60 && (
        <p className="dim" style={{ marginTop: 10 }}>
          Showing first 60 of {filtered.length} — work the queue down or filter tighter.
        </p>
      )}
    </>
  );
}
