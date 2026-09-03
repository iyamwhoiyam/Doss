/**
 * Signed-in identity, capabilities and display preferences.
 *
 * Permissions come from the server rather than being re-derived here, so the UI
 * can only ever hide what the API would refuse — the two can't drift apart.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api, setUnauthorizedHandler } from './api';
import type { User } from './types';

interface MeResponse {
  user: User;
  permissions: Record<string, boolean>;
  roles?: Record<string, { label: string; rank: number; blurb: string }>;
}

type Theme = 'dark' | 'light';
type Density = 'comfortable' | 'compact';

interface SessionValue {
  user: User | null;
  permissions: Record<string, boolean>;
  roles: Record<string, { label: string; rank: number; blurb: string }>;
  loading: boolean;
  can: (permission: string) => boolean;
  signIn: (email: string, password: string) => Promise<User>;
  signOut: () => Promise<void>;
  refresh: () => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  density: Density;
  setDensity: (density: Density) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

const readPreference = <T extends string>(key: string, fallback: T): T =>
  (localStorage.getItem(key) as T | null) ?? fallback;

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [theme, setThemeState] = useState<Theme>(() => readPreference<Theme>('enova.theme', 'dark'));
  const [density, setDensityState] = useState<Density>(() => readPreference<Density>('enova.density', 'comfortable'));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('enova.sidebar') === 'collapsed');

  const { data, isLoading, refetch } = useQuery<MeResponse | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<MeResponse>('/auth/me');
      } catch {
        return null; // not signed in — the login screen renders
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  // A 401 anywhere means the session is gone; drop straight to the login screen.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      queryClient.setQueryData(['me'], null);
      queryClient.clear();
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('enova.theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.density = density;
    localStorage.setItem('enova.density', density);
  }, [density]);

  useEffect(() => {
    localStorage.setItem('enova.sidebar', sidebarCollapsed ? 'collapsed' : 'expanded');
  }, [sidebarCollapsed]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await api.post<MeResponse>('/auth/login', { email, password });
    queryClient.setQueryData(['me'], result);
    await queryClient.invalidateQueries();
    if (result.user.preferences?.theme) setThemeState(result.user.preferences.theme);
    if (result.user.preferences?.density) setDensityState(result.user.preferences.density);
    return result.user;
  }, [queryClient]);

  const signOut = useCallback(async () => {
    await api.post('/auth/logout');
    queryClient.setQueryData(['me'], null);
    queryClient.clear();
  }, [queryClient]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    api.patch('/auth/me', { preferences: { theme: next, density } }).catch(() => { /* preference is local-first */ });
  }, [density]);

  const setDensity = useCallback((next: Density) => {
    setDensityState(next);
    api.patch('/auth/me', { preferences: { theme, density: next } }).catch(() => { /* preference is local-first */ });
  }, [theme]);

  const value = useMemo<SessionValue>(() => ({
    user: data?.user ?? null,
    permissions: data?.permissions ?? {},
    roles: data?.roles ?? {},
    loading: isLoading,
    can: (permission: string) => Boolean(data?.permissions?.[permission]),
    signIn,
    signOut,
    refresh: () => { void refetch(); },
    theme,
    setTheme,
    density,
    setDensity,
    sidebarCollapsed,
    toggleSidebar: () => setSidebarCollapsed((v) => !v),
  }), [data, isLoading, signIn, signOut, refetch, theme, setTheme, density, setDensity, sidebarCollapsed]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside a SessionProvider');
  return context;
}

/** Convenience for the common "hide what this role cannot do" check. */
export function useCan(permission: string): boolean {
  return useSession().can(permission);
}
