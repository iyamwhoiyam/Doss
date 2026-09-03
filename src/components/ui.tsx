/**
 * The Enova Ops component kit.
 *
 * Every page is assembled from these, so a change here — a denser row, a new
 * focus ring, a different empty state — lands everywhere at once.
 */

import {
  useEffect, useId, useMemo, useRef, useState,
  type ChangeEvent, type CSSProperties, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { Icon } from './Icon';
import { colorFor, initialsOf } from '../lib/format';
import type { Option, Tone } from '@shared/domain';
import { findOption } from '@shared/domain';

/* ── surfaces ─────────────────────────────────────────────────────────────── */

export function Card({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <section className={`card ${className}`} style={style}>{children}</section>;
}

export function CardHead({ title, subtitle, actions, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: string }) {
  return (
    <header className="card-head">
      {icon && <span className="muted"><Icon name={icon} /></span>}
      <div className="grow">
        <h3>{title}</h3>
        {subtitle && <div className="cell-sub">{subtitle}</div>}
      </div>
      {actions && <div className="row-tight">{actions}</div>}
    </header>
  );
}

export function Section({ title, subtitle, actions, children, icon, flush = false, className = '' }: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode;
  icon?: string; flush?: boolean; className?: string;
}) {
  return (
    <Card className={className}>
      <CardHead title={title} subtitle={subtitle} actions={actions} icon={icon} />
      <div className={flush ? 'card-body-flush' : 'card-body'}>{children}</div>
    </Card>
  );
}

/* ── status ───────────────────────────────────────────────────────────────── */

export function Badge({ tone = 'neutral', children, dot = false, square = false, large = false, title }: {
  tone?: Tone | string; children: ReactNode; dot?: boolean; square?: boolean; large?: boolean; title?: string;
}) {
  return (
    <span
      className={`badge${square ? ' badge-square' : ''}${large ? ' badge-lg' : ''}`}
      data-tone={tone}
      title={title}
    >
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
}

/** A status pill that resolves its label and tone from a shared option list. */
export function StatusBadge({ list, value, dot = true, large = false }: {
  list: Option[]; value: string | null | undefined; dot?: boolean; large?: boolean;
}) {
  const option = findOption(list, value);
  return <Badge tone={option.tone ?? 'neutral'} dot={dot} large={large}>{option.label}</Badge>;
}

export function Meter({ value, max = 100, tone = 'accent', large = false }: {
  value: number; max?: number; tone?: Tone | string; large?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <div className={`meter${large ? ' meter-lg' : ''}`} data-tone={tone} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Avatar({ name, color, size = 'md', title }: {
  name: string | undefined | null; color?: string; size?: 'sm' | 'md' | 'lg'; title?: string;
}) {
  const cls = size === 'lg' ? 'avatar avatar-lg' : size === 'sm' ? 'avatar avatar-sm' : 'avatar';
  return (
    <span className={cls} style={{ '--avatar-color': color || colorFor(name) } as CSSProperties} title={title ?? name ?? undefined}>
      {initialsOf(name)}
    </span>
  );
}

export function AvatarStack({ people, max = 4, size = 'sm' }: {
  people: { id: string; name: string; accentColor?: string }[]; max?: number; size?: 'sm' | 'md';
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <div className="avatar-stack">
      {shown.map((person) => <Avatar key={person.id} name={person.name} color={person.accentColor} size={size} />)}
      {extra > 0 && (
        <span className={size === 'sm' ? 'avatar avatar-sm' : 'avatar'} style={{ '--avatar-color': 'var(--surface-3)', color: 'var(--text-muted)' } as CSSProperties}>
          +{extra}
        </span>
      )}
    </div>
  );
}

export function EmptyState({ icon = 'boxes', title, body, action }: {
  icon?: string; title: string; body?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={20} /></span>
      <div>
        <div className="strong">{title}</div>
        {body && <div className="cell-sub" style={{ marginTop: 4, maxWidth: 460 }}>{body}</div>}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row-tight muted" style={{ fontSize: 'var(--t-xs)' }}>
      <span className="spinner" />{label}
    </span>
  );
}

export function Loading({ rows = 5 }: { rows?: number }) {
  return (
    <div className="col-tight" style={{ padding: 'var(--s-4)' }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: 'var(--row-h)', opacity: 1 - i * 0.11 }} />
      ))}
    </div>
  );
}

/* ── forms ────────────────────────────────────────────────────────────────── */

export function Field({ label, hint, error, children, className = '' }: {
  label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <div className={`field ${className}`}>
      {label && <span className="field-label">{label}</span>}
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function TextInput({ value, onChange, ...rest }: {
  value: string; onChange: (value: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return <input className="input" {...rest} value={value} onChange={(e) => onChange(e.target.value)} />;
}

export function NumberInput({ value, onChange, dp, ...rest }: {
  value: number | string | null | undefined; onChange: (value: number) => void; dp?: number;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <input
      className="input input-mono right"
      inputMode="decimal"
      {...rest}
      value={value ?? ''}
      onChange={(e) => {
        const next = Number(e.target.value);
        onChange(Number.isFinite(next) ? (dp === undefined ? next : Number(next.toFixed(dp))) : 0);
      }}
    />
  );
}

export function TextArea({ value, onChange, rows = 4, ...rest }: {
  value: string; onChange: (value: string) => void; rows?: number;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'rows'>) {
  return <textarea className="textarea" rows={rows} {...rest} value={value} onChange={(e) => onChange(e.target.value)} />;
}

export interface SelectOption { value: string; label: string; group?: string; disabled?: boolean }

export function Select({ value, onChange, options, placeholder, allowEmpty = false, ...rest }: {
  value: string; onChange: (value: string) => void; options: SelectOption[] | Option[];
  placeholder?: string; allowEmpty?: boolean;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
  const groups = useMemo(() => {
    const map = new Map<string, SelectOption[]>();
    for (const option of options as SelectOption[]) {
      const key = option.group ?? '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(option);
    }
    return [...map.entries()];
  }, [options]);

  return (
    <select className="select" {...rest} value={value ?? ''} onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}>
      {(allowEmpty || placeholder) && <option value="">{placeholder ?? '—'}</option>}
      {groups.map(([group, items]) => (
        group
          ? <optgroup key={group} label={group}>{items.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}</optgroup>
          : items.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)
      ))}
    </select>
  );
}

/**
 * A searchable dropdown for the long lists — 98 catalogue items, 25 people,
 * 12 customers — where a native `<select>` becomes a scroll hunt.
 */
export function Combo({ value, onChange, options, placeholder = 'Select…', allowEmpty = true, emptyLabel = '—', disabled = false, onSearch, renderOption }: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; sub?: string; tone?: string }[];
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  disabled?: boolean;
  onSearch?: (query: string) => void;
  renderOption?: (option: { value: string; label: string; sub?: string }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    if (onSearch || !query.trim()) return options;
    const needle = query.toLowerCase();
    return options.filter((o) => `${o.label} ${o.sub ?? ''}`.toLowerCase().includes(needle));
  }, [options, query, onSearch]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) { setQuery(''); setHighlight(0); window.setTimeout(() => inputRef.current?.focus(), 10); }
  }, [open]);

  const pick = (next: string) => { onChange(next); setOpen(false); };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="input row"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        style={{ justifyContent: 'space-between', textAlign: 'left', cursor: disabled ? 'not-allowed' : 'pointer' }}
      >
        <span className={selected ? 'truncate' : 'truncate faint'}>{selected?.label ?? placeholder}</span>
        <Icon name="chevron-down" size={13} className="faint" />
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          style={{
            position: 'absolute', zIndex: 60, top: 'calc(100% + 4px)', left: 0, right: 0,
            background: 'var(--surface-1)', border: '1px solid var(--line-strong)',
            borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden',
            minWidth: 220,
          }}
        >
          <input
            ref={inputRef}
            className="input"
            style={{ border: 0, borderBottom: '1px solid var(--line-soft)', borderRadius: 0, background: 'transparent' }}
            placeholder="Type to filter…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlight(0); onSearch?.(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, filtered.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
              if (e.key === 'Enter') { e.preventDefault(); const hit = filtered[highlight]; if (hit) pick(hit.value); }
              if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
            }}
          />
          <div style={{ maxHeight: 268, overflowY: 'auto', padding: 4 }}>
            {allowEmpty && (
              <button type="button" className="palette-item" onClick={() => pick('')}>
                <span className="faint">{emptyLabel}</span>
              </button>
            )}
            {filtered.length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-3)' }}>Nothing matches “{query}”.</div>}
            {filtered.map((option, index) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className="palette-item"
                data-active={index === highlight}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => pick(option.value)}
              >
                {renderOption ? renderOption(option) : (
                  <span className="grow truncate">
                    <span>{option.label}</span>
                    {option.sub && <span className="cell-sub" style={{ marginLeft: 8 }}>{option.sub}</span>}
                  </span>
                )}
                {option.value === value && <Icon name="check" size={13} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: {
  checked: boolean; onChange: (value: boolean) => void; label?: ReactNode; disabled?: boolean;
}) {
  return (
    <label className="row-tight" style={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
      <span className="switch">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span />
      </span>
      {label && <span style={{ fontSize: 'var(--t-sm)' }}>{label}</span>}
    </label>
  );
}

export function CheckBox({ checked, onChange, label, disabled }: {
  checked: boolean; onChange: (value: boolean) => void; label?: ReactNode; disabled?: boolean;
}) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', autoFocus }: {
  value: string; onChange: (value: string) => void; placeholder?: string; autoFocus?: boolean;
}) {
  return (
    <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 340, minWidth: 160 }}>
      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none', display: 'flex' }}>
        <Icon name="search" size={14} />
      </span>
      <input
        className="input"
        style={{ paddingLeft: 31, paddingRight: value ? 30 : 12 }}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon"
          style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)' }}
          onClick={() => onChange('')}
          aria-label="Clear search"
        >
          <Icon name="x" size={12} />
        </button>
      )}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (value: T) => void; options: { value: T; label: string }[];
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          data-active={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ── tabs ─────────────────────────────────────────────────────────────────── */

export function Tabs({ value, onChange, tabs }: {
  value: string; onChange: (value: string) => void;
  tabs: { value: string; label: string; count?: number | string | null; icon?: string }[];
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          className="tab"
          data-active={value === tab.value}
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
        >
          {tab.icon && <Icon name={tab.icon} size={13} />} {tab.label}
          {tab.count !== undefined && tab.count !== null && <span className="tab-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ── overlays ─────────────────────────────────────────────────────────────── */

function useEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [active, onClose]);
}

export function Drawer({ open, onClose, title, subtitle, children, footer, wide = false, badge }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode;
  children: ReactNode; footer?: ReactNode; wide?: boolean; badge?: ReactNode;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <>
      <div className="overlay" onClick={onClose} />
      <aside className={`drawer${wide ? ' drawer-wide' : ''}`} role="dialog" aria-modal="true">
        <header className="drawer-head">
          <div className="grow">
            <div className="row-tight">
              <h3 className="truncate">{title}</h3>
              {badge}
            </div>
            {subtitle && <div className="cell-sub">{subtitle}</div>}
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </aside>
    </>,
    document.body,
  );
}

export function Modal({ open, onClose, title, children, footer, large = false }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; large?: boolean;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal-wrap">
        <div className={`modal${large ? ' modal-lg' : ''}`} role="dialog" aria-modal="true">
          <header className="modal-head">
            <h3 className="grow truncate">{title}</h3>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close"><Icon name="x" size={14} /></button>
          </header>
          <div className="modal-body">{children}</div>
          {footer && <footer className="modal-foot">{footer}</footer>}
        </div>
      </div>
    </>,
    document.body,
  );
}

/* ── data table ───────────────────────────────────────────────────────────── */

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T, index: number) => ReactNode;
  /** Value used for sorting; omit to make the column unsortable. */
  sortValue?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right';
  width?: string;
  numeric?: boolean;
}

export function DataTable<T extends { id?: string }>({
  columns, rows, loading, onRowClick, empty, selectedId, rowTone, footer, maxHeight,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  selectedId?: string | null;
  rowTone?: (row: T) => string | undefined;
  footer?: ReactNode;
  maxHeight?: number | string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortValue) return rows;
    return [...rows].sort((a, b) => {
      const av = column.sortValue!(a);
      const bv = column.sortValue!(b);
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sort.dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * sort.dir;
    });
  }, [rows, sort, columns]);

  if (loading) return <Loading />;
  if (!rows.length) return <>{empty ?? <EmptyState title="Nothing here yet" body="Records will appear here as they are created." />}</>;

  return (
    <>
      <div className="table-wrap" style={maxHeight ? { maxHeight } : undefined}>
        <table className="data">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`${column.numeric || column.align === 'right' ? 'num-cell' : ''}${column.sortValue ? ' sortable' : ''}`}
                  style={column.width ? { width: column.width } : undefined}
                  onClick={column.sortValue ? () => setSort((current) =>
                    current?.key === column.key ? { key: column.key, dir: current.dir === 1 ? -1 : 1 } : { key: column.key, dir: 1 },
                  ) : undefined}
                >
                  <span className="row-tight" style={{ justifyContent: column.numeric || column.align === 'right' ? 'flex-end' : 'flex-start', gap: 4 }}>
                    {column.header}
                    {sort?.key === column.key && <Icon name={sort.dir === 1 ? 'chevron-up' : 'chevron-down'} size={11} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, index) => (
              <tr
                key={row.id ?? index}
                data-clickable={onRowClick ? 'true' : undefined}
                data-selected={selectedId && row.id === selectedId ? 'true' : undefined}
                data-tone={rowTone?.(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((column) => (
                  <td key={column.key} className={column.numeric || column.align === 'right' ? 'num-cell' : undefined}>
                    {column.render(row, index)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer}
    </>
  );
}

/* ── charts ───────────────────────────────────────────────────────────────── */

export function BarChart({ data, height = 130, format }: {
  data: { label: string; value: number; tone?: string }[];
  height?: number;
  format?: (value: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const width = 100;
  const gap = 2.2;
  const barWidth = (width - gap * (data.length - 1)) / Math.max(1, data.length);

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ height }} role="img">
      {[0.25, 0.5, 0.75, 1].map((fraction) => (
        <line key={fraction} className="chart-grid" x1={0} x2={width} y1={height - fraction * (height - 22)} y2={height - fraction * (height - 22)} vectorEffect="non-scaling-stroke" />
      ))}
      {data.map((datum, index) => {
        const barHeight = Math.max(1.5, (datum.value / max) * (height - 26));
        return (
          <g key={datum.label}>
            <rect
              className="chart-bar"
              x={index * (barWidth + gap)}
              y={height - 18 - barHeight}
              width={barWidth}
              height={barHeight}
              rx={1.6}
              fill={datum.tone ? `var(--tone-${datum.tone}-fg)` : undefined}
            >
              <title>{`${datum.label}: ${format ? format(datum.value) : datum.value}`}</title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
}

export function Sparkline({ data, height = 56, showArea = true }: { data: number[]; height?: number; showArea?: boolean }) {
  if (data.length < 2) return <div style={{ height }} />;
  const width = 100;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - 6 - ((value - min) / span) * (height - 14);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ height }} role="img">
      <defs>
        <linearGradient id="chart-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {showArea && <path className="chart-area" d={`M0,${height} L${points.join(' L')} L${width},${height} Z`} />}
      <path className="chart-line" d={`M${points.join(' L')}`} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Donut({ value, total, tone = 'accent', size = 92, label, sublabel }: {
  value: number; total: number; tone?: string; size?: number; label?: ReactNode; sublabel?: ReactNode;
}) {
  const radius = size / 2 - 8;
  const circumference = 2 * Math.PI * radius;
  const pct = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }} data-tone={tone}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} role="img">
        <circle className="donut-track" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={8} />
        <circle
          className="donut-value"
          cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={8}
          strokeDasharray={`${circumference * pct} ${circumference}`}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div>
          <div className="strong" style={{ fontSize: 'var(--t-md)', lineHeight: 1.1 }}>{label ?? `${Math.round(pct * 100)}%`}</div>
          {sublabel && <div className="cell-sub">{sublabel}</div>}
        </div>
      </div>
    </div>
  );
}

/** Stacked horizontal bar used for the cost breakdown. */
export function StackBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  return (
    <div>
      <div className="cost-bar">
        {segments.filter((s) => s.value > 0).map((segment) => (
          <i
            key={segment.label}
            style={{ width: `${(segment.value / total) * 100}%`, background: segment.color }}
            title={`${segment.label}: ${((segment.value / total) * 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="cost-legend">
        {segments.filter((s) => s.value > 0).map((segment) => (
          <span key={segment.label} className="cost-legend-item">
            <span className="cost-legend-swatch" style={{ background: segment.color }} />
            {segment.label}
            <span className="faint">{((segment.value / total) * 100).toFixed(0)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── misc ─────────────────────────────────────────────────────────────────── */

export function KeyValue({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="kv">
      {items.map((item, index) => (
        <div key={index} style={{ display: 'contents' }}>
          <dt>{item.label}</dt>
          <dd>{item.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Flag({ tone, title, detail, authority }: {
  tone: string; title: ReactNode; detail: ReactNode; authority?: ReactNode;
}) {
  const icon = tone === 'danger' ? 'alert' : tone === 'success' ? 'check-circle' : 'info';
  return (
    <div className="flag" data-tone={tone}>
      <span className="flag-mark"><Icon name={icon} size={15} /></span>
      <div className="grow">
        <div className="flag-title">{title}</div>
        <div className="flag-detail">{detail}</div>
        {authority && <div className="flag-auth">{authority}</div>}
      </div>
    </div>
  );
}

export function Pager({ total, limit, offset, onChange }: {
  total: number; limit: number; offset: number; onChange: (offset: number) => void;
}) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return (
    <div className="pager">
      <span>Showing {offset + 1}–{Math.min(offset + limit, total)} of {total.toLocaleString()}</span>
      <span className="spacer" />
      <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => onChange(Math.max(0, offset - limit))}>
        <Icon name="chevron-left" size={13} /> Previous
      </button>
      <span className="mono">{page} / {pages}</span>
      <button type="button" className="btn btn-sm" disabled={page >= pages} onClick={() => onChange(offset + limit)}>
        Next <Icon name="chevron-right" size={13} />
      </button>
    </div>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        } catch { /* clipboard unavailable — nothing useful to say */ }
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={13} /> {copied ? 'Copied' : label}
    </button>
  );
}
