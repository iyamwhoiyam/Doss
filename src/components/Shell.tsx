import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useSession } from '../lib/session';

const LINKS = [
  { to: '/projects', label: 'Projects', ic: '🗂' },
  { to: '/customers', label: 'Customers', ic: '👥' },
  { to: '/canned-jobs', label: 'Canned Jobs', ic: '🧪' },
];

export default function Shell({ children }: { children: ReactNode }) {
  const { session, signOut } = useSession();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          Shopare
          <small>Enova production workspace</small>
        </div>
        <nav className="nav">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="nav-ic">{l.ic}</span>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <span>{session?.user?.email}</span>
          <button onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
