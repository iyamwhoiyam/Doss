import { ReactNode } from 'react';

export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'dim' | 'cyan'; children: ReactNode }) {
  return <span className={`pill pill--${tone}`}>{children}</span>;
}

export function StatusPill({ status }: { status: string | null | undefined }) {
  const s = (status ?? '').toLowerCase();
  if (s === 'done' || s === 'completed' || s === 'released' || s === 'approved') return <Pill tone="ok">{status}</Pill>;
  if (s === 'blocked' || s === 'cancelled' || s === 'error') return <Pill tone="bad">{status}</Pill>;
  if (s === 'in_progress' || s === 'active' || s === 'open') return <Pill tone="warn">{status?.replace('_', ' ')}</Pill>;
  return <Pill tone="dim">{status ?? '—'}</Pill>;
}

export function ConfidencePill({ level }: { level: string | null | undefined }) {
  if (level === 'GREEN') return <Pill tone="ok">GREEN</Pill>;
  if (level === 'AMBER') return <Pill tone="warn">AMBER</Pill>;
  if (level === 'RED') return <Pill tone="bad">RED</Pill>;
  return <Pill tone="dim">{level ?? '—'}</Pill>;
}

export function money(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function num(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-US');
}

export function dateStr(d: string | null | undefined): string {
  if (!d) return '—';
  // Dates from the DB are date-only or ISO strings; keep it short.
  return d.slice(0, 10);
}

export function Loading({ what }: { what: string }) {
  return <div className="skeleton">Loading {what}…</div>;
}

export function ErrorNotice({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return <div className="notice notice--err">Something went wrong: {msg}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
