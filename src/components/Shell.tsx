/**
 * The application frame: navigation, global search, presence, notifications and
 * the person menu. Every signed-in page renders inside it.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { Icon } from './Icon';
import { CommandPalette } from './CommandPalette';
import { Avatar } from './ui';
import { NAV } from '@shared/domain';
import { useSession } from '../lib/session';
import { useRealtime } from '../lib/realtime';
import { useList, api } from '../lib/api';
import { relative } from '../lib/format';
import type { Notification } from '../lib/types';

function ThemeToggle() {
  const { theme, setTheme } = useSession();
  return (
    <button
      type="button"
      className="btn btn-ghost btn-icon"
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}

function PresenceStrip() {
  const { online, status } = useRealtime();
  const { user } = useSession();
  const others = online.filter((person) => person.id !== user?.id);

  return (
    <div className="row-tight" title={status === 'live' ? `${online.length} online` : 'Reconnecting to live updates…'}>
      {status === 'live' ? <span className="live-dot" /> : <span className="spinner" style={{ width: 11, height: 11 }} />}
      <div className="avatar-stack">
        {others.slice(0, 5).map((person) => (
          <Avatar
            key={person.id}
            name={person.name}
            color={person.accentColor}
            size="sm"
            title={person.viewing ? `${person.name} — ${person.viewing}` : person.name}
          />
        ))}
      </div>
      {others.length > 5 && <span className="cell-sub">+{others.length - 5}</span>}
    </div>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { user } = useSession();
  const queryClient = useQueryClient();
  const { data } = useList<Notification>('notifications', {
    where: { userId: user?.id ?? '' },
    sort: '-createdAt',
    limit: 25,
  }, { enabled: Boolean(user) });

  const rows = data?.rows ?? [];
  const unread = rows.filter((row) => !row.read);

  const markAll = async () => {
    await api.post('/notifications/read', { ids: unread.map((n) => n.id) });
    queryClient.invalidateQueries({ queryKey: ['collection', 'notifications'] });
  };

  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className="btn btn-ghost btn-icon" onClick={() => setOpen((v) => !v)} title="Notifications">
        <Icon name="bell" />
        {unread.length > 0 && (
          <span style={{
            position: 'absolute', top: 4, right: 4, minWidth: 15, height: 15, padding: '0 4px',
            borderRadius: 999, background: 'var(--tone-danger-fg)', color: '#fff',
            fontSize: 9, fontWeight: 800, display: 'grid', placeItems: 'center',
          }}>
            {unread.length > 9 ? '9+' : unread.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 50, width: 340,
            background: 'var(--surface-1)', border: '1px solid var(--line-strong)',
            borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden',
          }}>
            <div className="row" style={{ padding: 'var(--s-3) var(--s-4)', borderBottom: '1px solid var(--line-soft)' }}>
              <strong className="grow" style={{ fontSize: 'var(--t-sm)' }}>Notifications</strong>
              {unread.length > 0 && <button type="button" className="link-btn" style={{ fontSize: 'var(--t-xs)' }} onClick={markAll}>Mark all read</button>}
            </div>
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              {rows.length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-5)', textAlign: 'center' }}>Nothing new.</div>}
              {rows.map((row) => (
                <a
                  key={row.id}
                  className="list-row"
                  href={row.link || '#'}
                  onClick={() => setOpen(false)}
                  style={{ opacity: row.read ? 0.62 : 1, alignItems: 'flex-start' }}
                >
                  <span data-tone={row.severity} className="tone-text" style={{ marginTop: 2 }}>
                    <Icon name={row.severity === 'warning' ? 'alert' : row.severity === 'success' ? 'check-circle' : 'info'} size={14} />
                  </span>
                  <span className="grow">
                    <span className="strong" style={{ fontSize: 'var(--t-sm)', display: 'block' }}>{row.title}</span>
                    {row.body && <span className="cell-sub" style={{ display: 'block' }}>{row.body}</span>}
                    <span className="cell-sub">{relative(row.createdAt)}</span>
                  </span>
                </a>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function UserMenu() {
  const [open, setOpen] = useState(false);
  const { user, signOut, roles, density, setDensity } = useSession();
  if (!user) return null;

  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className="btn btn-ghost" style={{ paddingLeft: 4, paddingRight: 8 }} onClick={() => setOpen((v) => !v)}>
        <Avatar name={user.name} color={user.accentColor} />
        <Icon name="chevron-down" size={12} className="faint" />
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 50, width: 268,
            background: 'var(--surface-1)', border: '1px solid var(--line-strong)',
            borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden',
          }}>
            <div className="row" style={{ padding: 'var(--s-4)', borderBottom: '1px solid var(--line-soft)' }}>
              <Avatar name={user.name} color={user.accentColor} size="lg" />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="strong truncate">{user.name}</div>
                <div className="cell-sub truncate">{user.title || roles[user.role]?.label}</div>
              </div>
            </div>
            <div style={{ padding: 'var(--s-3) var(--s-4)', borderBottom: '1px solid var(--line-soft)' }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Row density</div>
              <div className="segmented" style={{ width: '100%' }}>
                {(['comfortable', 'compact'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    style={{ flex: 1 }}
                    data-active={density === option}
                    onClick={() => setDensity(option)}
                  >
                    {option === 'comfortable' ? 'Comfortable' : 'Compact'}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className="list-row" style={{ width: '100%', border: 0, background: 'none' }} onClick={() => { setOpen(false); void signOut(); }}>
              <Icon name="logout" size={14} /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function Shell({ children }: { children?: ReactNode }) {
  const { user, can, sidebarCollapsed, toggleSidebar } = useSession();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
      // "/" opens search too, as long as the operator isn't typing into a field
      if (event.key === '/' && !/input|textarea|select/i.test((event.target as HTMLElement)?.tagName ?? '')) {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const groups = NAV
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.perm || can(item.perm)) }))
    .filter((group) => group.items.length);

  return (
    <div className="app" data-collapsed={sidebarCollapsed ? 'true' : 'false'}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#2FBF9B" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 19V5h13M6 12h9M6 19h13" />
            </svg>
          </span>
          <div className="brand-text grow" style={{ minWidth: 0 }}>
            <div className="brand-name truncate">Enova Ops</div>
            <div className="brand-sub">Enova Science</div>
          </div>
        </div>

        <nav className="nav">
          {groups.map((group) => (
            <div className="nav-group" key={group.group}>
              <div className="nav-group-label">{group.group}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                  title={item.label}
                >
                  <Icon name={item.icon} size={16} />
                  <span className="truncate">{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <button type="button" className="nav-link" style={{ width: '100%' }} onClick={toggleSidebar}>
            <Icon name="panel-left" size={16} />
            <span className="sidebar-foot-text">Collapse</span>
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button type="button" className="search-trigger" onClick={() => setPaletteOpen(true)}>
            <Icon name="search" size={14} />
            <span className="grow truncate" style={{ textAlign: 'left' }}>Search everything…</span>
            <span className="kbd">⌘K</span>
          </button>
          <span className="spacer" />
          <PresenceStrip />
          <ThemeToggle />
          <NotificationBell />
          <UserMenu />
        </header>

        <main className="content" key={location.pathname.split('/')[1]}>
          {children ?? <Outlet />}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {user?.mustChangePassword && <PasswordPrompt />}
    </div>
  );
}

/** A first-sign-in nudge that cannot be dismissed until the password changes. */
function PasswordPrompt() {
  const { refresh } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/password', { currentPassword: current, newPassword: next });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="overlay" />
      <div className="modal-wrap">
        <form className="modal" onSubmit={submit}>
          <header className="modal-head">
            <span className="tone-text" data-tone="warning"><Icon name="lock" /></span>
            <h3>Choose your own password</h3>
          </header>
          <div className="modal-body col">
            <p className="muted">
              Your account is still on the temporary password an administrator issued.
              Pick your own before you carry on — it takes ten characters or more.
            </p>
            <label className="field">
              <span className="field-label">Current password</span>
              <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </label>
            <label className="field">
              <span className="field-label">New password</span>
              <input className="input" type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required />
            </label>
            {error && <div className="field-error">{error}</div>}
          </div>
          <footer className="modal-foot">
            <button type="submit" className="btn btn-primary" disabled={busy || next.length < 10}>
              {busy ? <span className="spinner" /> : <Icon name="check" size={14} />} Set password
            </button>
          </footer>
        </form>
      </div>
    </>
  );
}

/* ── page scaffolding ─────────────────────────────────────────────────────── */

export function PageHeader({ title, subtitle, badge, actions, back }: {
  title: ReactNode; subtitle?: ReactNode; badge?: ReactNode; actions?: ReactNode;
  back?: { to: string; label: string };
}) {
  return (
    <header className="page-head">
      <div className="titles">
        {back && (
          <NavLink to={back.to} className="row-tight cell-sub" style={{ marginBottom: 6, display: 'inline-flex' }}>
            <Icon name="chevron-left" size={12} /> {back.label}
          </NavLink>
        )}
        <div className="page-title">
          <h1>{title}</h1>
          {badge}
        </div>
        {subtitle && <div className="page-sub">{subtitle}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
