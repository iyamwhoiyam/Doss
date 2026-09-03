/** Display formatting. Everything the UI prints goes through here. */

const NBSP = ' ';

export function money(value: number | string | null | undefined, dp = 2): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Unit costs need more places than a total does — $0.2348 matters per unit. */
export function unitMoney(value: number | string | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n !== 0 && Math.abs(n) < 0.01) return `$${n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`;
  return `$${n.toFixed(4)}`;
}

export function number(value: number | string | null | undefined, dp = 0): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function compact(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  return number(n);
}

export function percent(value: number | string | null | undefined, dp = 0): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(dp)}%`;
}

/** A fraction (0.45) rendered as a percentage. */
export function rate(value: number | null | undefined, dp = 0): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(dp)}%`;
}

export function qty(value: number | null | undefined, uom?: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const dp = Number.isInteger(n) ? 0 : n < 10 ? 3 : 2;
  return `${number(n, dp)}${uom ? `${NBSP}${uom}` : ''}`;
}

export function mg(value: number | string | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return `0${NBSP}mg`;
  if (n < 0.01) return `${n.toPrecision(3)}${NBSP}mg`;
  if (n < 1) return `${n.toFixed(3)}${NBSP}mg`;
  return `${number(n, n < 100 ? 2 : 1)}${NBSP}mg`;
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const DATE_SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const TIME_FMT = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

export function date(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : DATE_FMT.format(parsed);
}

export function dateShort(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.getFullYear() === new Date().getFullYear() ? DATE_SHORT.format(parsed) : DATE_FMT.format(parsed);
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return `${DATE_SHORT.format(parsed)}, ${TIME_FMT.format(parsed)}`;
}

/** "3 days ago", "in 2 weeks" — the relative form people read faster. */
export function relative(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return '—';
  const seconds = Math.round((parsed - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 2592000) return rtf.format(Math.round(seconds / 86400), 'day');
  if (abs < 31536000) return rtf.format(Math.round(seconds / 2592000), 'month');
  return rtf.format(Math.round(seconds / 31536000), 'year');
}

export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return Math.round((parsed - Date.now()) / 86400000);
}

/** An ISO timestamp as the `yyyy-mm-dd` an `<input type="date">` expects. */
export function toDateInput(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

export function fromDateInput(value: string): string | null {
  return value ? new Date(`${value}T12:00:00Z`).toISOString() : null;
}

export function fileSize(bytes: number | null | undefined): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function initialsOf(name: string | undefined | null): string {
  if (!name) return '—';
  return name
    .replace(/^Dr\.\s+/, '')
    .split(/\s+/)
    .map((word) => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return '—';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${number(count)} ${count === 1 ? singular : plural}`;
}

/** Deterministic colour from a string, for avatars and customer chips. */
export function colorFor(seed: string | undefined | null): string {
  const palette = ['#2FBF9B', '#4C8DF6', '#C8972A', '#B15CD1', '#E4734A', '#3FB2E0', '#7BC043', '#E45B7C'];
  if (!seed) return palette[0];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}
