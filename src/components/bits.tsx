import type { ReactNode } from 'react';

export function Modal({
  title,
  wide,
  onClose,
  children,
}: {
  title: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={wide ? 'modal wide' : 'modal'}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="drawer-wrap">
      <div className="scrim" onMouseDown={onClose} />
      <div className="drawer">
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Pill({ value, label }: { value: string; label?: string }) {
  return <span className={`pill ${value}`}>{label ?? value.replace(/_/g, ' ')}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {hint}
    </div>
  );
}

export function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

export function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString();
}

export function fmtWhen(d: string): string {
  return new Date(d).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
