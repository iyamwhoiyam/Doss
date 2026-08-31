import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Card, Loading, SearchInput, Select } from '../components/ui';
import { Avatar } from '../components/ui';
import { api, qs } from '../lib/api';
import { useViewing } from '../lib/realtime';
import { dateTime, relative } from '../lib/format';

interface ActivityRow {
  id: string; type: string; title: string; detail: string; tone: string;
  refType: string; refId: string; link: string; actorId: string; actorName: string; createdAt: string;
}

const dayLabel = (iso: string) => {
  const d = new Date(iso); const today = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  const yest = new Date(today); yest.setDate(today.getDate() - 1);
  if (same(d, yest)) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
};

export function Activity() {
  const navigate = useNavigate();
  useViewing('the activity timeline');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery<{ rows: ActivityRow[] }>({
    queryKey: ['activity', 'timeline', type],
    queryFn: () => api.get(`/activity${qs({ type, limit: 250 })}`),
  });

  const rows = data?.rows ?? [];
  const types = useMemo(() => [...new Set(rows.map((r) => r.type))].sort(), [rows]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => `${r.title} ${r.detail} ${r.actorName}`.toLowerCase().includes(needle));
  }, [rows, search]);

  const groups = useMemo(() => {
    const map = new Map<string, ActivityRow[]>();
    for (const r of filtered) {
      const key = dayLabel(r.createdAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <div className="page">
      <PageHeader
        title="Activity"
        subtitle="Everything happening across Enova Ops, newest first"
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Filter…" />
            <Select
              value={type}
              onChange={setType}
              allowEmpty
              placeholder="All types"
              options={types.map((t) => ({ value: t, label: t.replace(/_/g, ' ') }))}
              style={{ width: 170 }}
            />
          </>
        }
      />

      {isLoading && <Loading rows={8} />}

      {!isLoading && groups.length === 0 && (
        <Card><div className="card-body cell-sub">No activity to show.</div></Card>
      )}

      {!isLoading && groups.map(([day, items]) => (
        <div key={day} style={{ marginBottom: 'var(--s-4)' }}>
          <div className="cell-sub" style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 'var(--t-xs)', margin: '0 0 var(--s-2) var(--s-2)' }}>{day}</div>
          <Card>
            <div className="card-body-flush">
              {items.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="list-row activity-row"
                  onClick={() => row.link && navigate(row.link)}
                  style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: row.link ? 'pointer' : 'default' }}
                >
                  <span className="badge-dot" data-tone={row.tone || 'neutral'} style={{ background: 'var(--tone-fg)', marginTop: 6 }} />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="cell-primary">{row.title}</span>
                    {row.detail && <span className="cell-sub truncate" style={{ display: 'block' }}>{row.detail}</span>}
                  </span>
                  <Avatar name={row.actorName} size="sm" />
                  <span className="cell-sub nowrap" title={dateTime(row.createdAt)}>{relative(row.createdAt)}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      ))}
    </div>
  );
}
