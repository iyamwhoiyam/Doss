import { ReactNode, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useSession } from '../lib/session';
import { useFlags, useOrders } from '../lib/queries';

const NAV = [
  { group: 'Work', links: [
    { to: '/', label: 'My Day', icon: '☀' },
    { to: '/orders', label: 'Production Orders', icon: '⛭' },
    { to: '/projects', label: 'Projects & Quotes', icon: '⚗' },
    { to: '/data-quality', label: 'Data Quality', icon: '⚑' },
  ]},
  { group: 'Reference', links: [
    { to: '/inventory', label: 'Inventory', icon: '▤' },
    { to: '/shipments', label: 'Shipments', icon: '⇪' },
    { to: '/activity', label: 'Activity Log', icon: '≡' },
  ]},
];

export default function Shell({ children }: { children: ReactNode }) {
  const { employee, session, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const flags = useFlags('open');
  const orders = useOrders();

  const openFlags = flags.data?.length ?? 0;
  const blockedOrders = orders.data?.filter((o) => o.blocked).length ?? 0;

  const name = employee?.name ?? session?.user?.email?.split('@')[0] ?? '?';
  const role = employee?.role?.replace(/_/g, ' ') ?? 'no employee record';

  const badge = (to: string): number =>
    to === '/data-quality' ? openFlags : to === '/orders' ? blockedOrders : 0;

  return (
    <div className="shell">
      <aside className={`side${open ? ' open' : ''}`}>
        <div className="side__brand">
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="rgba(53,224,138,0.12)" />
            <path d="M9 22V10h14M9 16h11M9 22h14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <div>
            <b>ENOVA AMP</b>
            <small>OPERATIONS HUB</small>
          </div>
        </div>

        {NAV.map((g) => (
          <div key={g.group}>
            <div className="side__group">{g.group}</div>
            {g.links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/'}
                className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}
                onClick={() => setOpen(false)}
              >
                <span className="navlink__icon" aria-hidden="true">{l.icon}</span>
                {l.label}
                {badge(l.to) > 0 && <span className="navlink__badge">{badge(l.to)}</span>}
              </NavLink>
            ))}
          </div>
        ))}

        <div className="side__foot">
          <div className="side__user">
            <div className="side__avatar">{name.slice(0, 1).toUpperCase()}</div>
            <div className="side__who">
              <b>{name}</b>
              <span>{role}</span>
            </div>
          </div>
          <button className="btn btn--ghost btn--sm side__signout" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </aside>

      <button
        className="side__toggle"
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen(!open)}
      >
        {open ? '✕' : '☰'}
      </button>

      <main className="main" key={location.pathname}>
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
