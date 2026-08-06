import { useActivity } from '../lib/queries';
import { Empty, ErrorNotice, Loading, Pill } from '../components/bits';

function tone(action: string | null): 'ok' | 'warn' | 'bad' | 'dim' | 'cyan' {
  const a = action ?? '';
  if (a.includes('blocked') || a.includes('dismissed')) return 'bad';
  if (a.includes('done') || a.includes('resolved')) return 'ok';
  if (a.includes('stage')) return 'cyan';
  return 'dim';
}

export default function Activity() {
  const activity = useActivity(100);

  if (activity.isLoading) return <Loading what="activity" />;
  if (activity.error) return <ErrorNotice error={activity.error} />;

  return (
    <>
      <div className="page__head">
        <h1>Activity Log</h1>
        <span className="dim">every change made through AMP, newest first</span>
      </div>

      {(activity.data?.length ?? 0) === 0 ? (
        <Empty>No activity yet. Changes made through AMP will appear here.</Empty>
      ) : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {activity.data!.map((a) => (
                <tr key={a.id}>
                  <td className="mono dim" style={{ whiteSpace: 'nowrap' }}>
                    {a.ts ? new Date(a.ts).toLocaleString() : '—'}
                  </td>
                  <td className="strong">{a.actor || a.actor_email || '—'}</td>
                  <td><Pill tone={tone(a.action)}>{a.action?.replace(/_/g, ' ') ?? '—'}</Pill></td>
                  <td className="mono">{a.entity}/{a.entity_ref}</td>
                  <td className="mid">{a.detail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
