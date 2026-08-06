import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Employee } from './types';

/* Session = Supabase auth session + the matching employees row.
   The employees row is what drives role-aware UI (My Day, gate ownership). */

interface AppSession {
  session: Session | null;
  employee: Employee | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AppSession>({
  session: null,
  employee: null,
  loading: true,
  signOut: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadEmployee() {
      const email = session?.user?.email;
      if (!email) {
        setEmployee(null);
        return;
      }
      const { data } = await supabase
        .from('employees')
        .select('*')
        .eq('email', email)
        .maybeSingle();
      if (!cancelled) {
        // A signed-in user with no employees row still gets in (e.g. an
        // admin account created before their row existed) — they just see
        // no personally-assigned work on My Day.
        setEmployee((data as Employee | null) ?? null);
      }
    }
    loadEmployee();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.email]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <Ctx.Provider value={{ session, employee, loading, signOut }}>{children}</Ctx.Provider>
  );
}

export function useSession(): AppSession {
  return useContext(Ctx);
}

/** Display name + email for audit rows. Falls back to the auth email when
    there is no employees row. */
export function useActor(): { actor: string; actor_email: string } {
  const { session, employee } = useSession();
  const email = session?.user?.email ?? 'unknown';
  return { actor: employee?.name ?? email.split('@')[0], actor_email: email };
}
