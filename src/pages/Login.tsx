import { FormEvent, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setErr(error.message);
    // On success onAuthStateChange flips the app into the shell.
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit}>
        <div className="login__brand">
          <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="rgba(53,224,138,0.12)" />
            <path d="M9 22V10h14M9 16h11M9 22h14" fill="none" stroke="#35e08a" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <b>ENOVA AMP</b>
        </div>
        <p className="login__sub">Sign in with your Enova Science account.</p>

        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@enovascience.com"
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {err && <div className="login__err">{err}</div>}

        <button className="btn btn--primary btn--block" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="login__hint">
          No account yet? Ask an administrator to create one — accounts are provisioned
          centrally, there is no self-signup.
        </p>
      </form>
    </div>
  );
}
