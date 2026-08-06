import { supabase } from './supabase';

/** Write a row to erp_activity_log. Every mutation in the app goes through
    this. Best-effort: an audit failure is logged to console but does not
    roll back the primary write (the DB itself is the durable record — this
    log is the human-readable trail). */
export async function logActivity(entry: {
  actor: string;
  actor_email: string;
  entity: string;
  entity_ref: string;
  action: string;
  detail: string;
}): Promise<void> {
  const { error } = await supabase.from('erp_activity_log').insert({
    ts: new Date().toISOString(),
    ...entry,
  });
  if (error) {
    // eslint-disable-next-line no-console
    console.error('audit log write failed', error, entry);
  }
}

/** Compact before→after diff for audit detail strings. */
export function diffDetail(before: Record<string, unknown>, after: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const k of Object.keys(after)) {
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      parts.push(`${k}: ${fmt(a)} → ${fmt(b)}`);
    }
  }
  return parts.join('; ') || '(no visible change)';
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '∅';
  if (typeof v === 'string') return v.length > 40 ? v.slice(0, 37) + '…' : v;
  return String(v);
}
