import { useState, type FormEvent } from 'react';

import { Icon } from '../components/Icon';
import { useSession } from '../lib/session';

const HIGHLIGHTS = [
  {
    icon: 'factory',
    title: 'One system, one truth',
    body: 'Production, development, quality, supply and commercial all read and write the same records — live, for everyone.',
  },
  {
    icon: 'calculator',
    title: 'Costing that ties out',
    body: 'Overage, COGS, labour, overhead and tiered pricing come from one deterministic engine, so the screen and the quote never disagree.',
  },
  {
    icon: 'shield',
    title: 'A record you can sign',
    body: 'Every write is versioned and attributed. Nothing is marked compliant without the evidence behind it.',
  },
];

export function Login() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign you in');
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <aside className="login-aside">
        <div className="row">
          <span className="brand-mark" style={{ width: 34, height: 34 }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#2FBF9B" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 19V5h13M6 12h9M6 19h13" />
            </svg>
          </span>
          <div>
            <div style={{ fontWeight: 700, letterSpacing: '-0.02em', fontSize: 'var(--t-md)' }}>Enova Ops</div>
            <div style={{ fontSize: 'var(--t-2xs)', letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.6 }}>Enova Science</div>
          </div>
        </div>

        <div className="col" style={{ gap: 'var(--s-6)', maxWidth: 460 }}>
          <h2 style={{ fontSize: 'var(--t-3xl)', lineHeight: 1.1, letterSpacing: '-0.035em', color: '#fff' }}>
            The whole plant,<br />on one screen.
          </h2>
          <div className="col" style={{ gap: 'var(--s-5)' }}>
            {HIGHLIGHTS.map((item) => (
              <div className="login-feature" key={item.title}>
                <span className="login-feature-mark"><Icon name={item.icon} size={15} /></span>
                <div>
                  <div style={{ fontWeight: 620, color: '#fff', fontSize: 'var(--t-sm)' }}>{item.title}</div>
                  <div style={{ opacity: 0.72, fontSize: 'var(--t-sm)', marginTop: 2 }}>{item.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ fontSize: 'var(--t-xs)', opacity: 0.5 }}>
          cGMP · 21 CFR Part 111 · Reno, Nevada
        </div>
      </aside>

      <div className="login-form-wrap">
        <div className="login-card">
          <h1 style={{ fontSize: 'var(--t-xl)' }}>Sign in</h1>
          <p className="muted" style={{ marginTop: 6, marginBottom: 'var(--s-6)' }}>
            Use your Enova Science email address.
          </p>

          <form className="col" onSubmit={submit}>
            <label className="field">
              <span className="field-label">Email</span>
              <input
                className="input"
                type="email"
                autoComplete="username"
                autoFocus
                required
                placeholder="name@enovascience.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            <label className="field">
              <span className="field-label">Password</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>

            {error && (
              <div className="flag" data-tone="danger">
                <span className="flag-mark"><Icon name="alert" size={15} /></span>
                <div className="flag-detail">{error}</div>
              </div>
            )}

            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? <span className="spinner" /> : <Icon name="arrow-right" size={15} />}
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="card" style={{ marginTop: 'var(--s-6)', padding: 'var(--s-4)', background: 'var(--surface-2)' }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>First time here?</div>
            <div className="cell-sub">
              Accounts are created by an administrator with a temporary password. You will be asked to
              choose your own the first time you sign in. If you have lost access, ask an administrator
              to reset it from the Admin console.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
