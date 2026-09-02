/**
 * Live sync.
 *
 * One EventSource per browser tab. Every database change the server broadcasts
 * invalidates the matching React Query caches, so a work order someone else
 * drags across the board moves on your screen too — without polling, and without
 * every page having to subscribe to anything.
 *
 * Invalidations are batched on a short timer: a transaction that touches a lot,
 * a transaction ledger and a work order arrives as three events and should cost
 * one refetch each, not three rounds of re-rendering.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useSession } from './session';
import type { PresenceUser } from './types';

interface ChangeEvent {
  collection: string;
  op: 'insert' | 'update' | 'purge';
  id: string;
  at: string;
  actorId: string | null;
  actorName: string | null;
  record: Record<string, unknown>;
}

type Status = 'connecting' | 'live' | 'offline';

interface RealtimeValue {
  status: Status;
  online: PresenceUser[];
  lastChange: ChangeEvent | null;
  setViewing: (viewing: string | null) => void;
}

const RealtimeContext = createContext<RealtimeValue>({
  status: 'connecting',
  online: [],
  lastChange: null,
  setViewing: () => {},
});

/** Cross-collection refreshes: touching the left invalidates the right. */
const RIPPLE: Record<string, string[]> = {
  lots: ['inventory', 'dashboard'],
  inventoryTxns: ['inventory', 'dashboard'],
  items: ['inventory', 'purchasing', 'dashboard'],
  workOrders: ['production', 'dashboard'],
  purchaseOrders: ['purchasing', 'inventory', 'dashboard'],
  salesOrders: ['dashboard'],
  quotes: ['dashboard'],
  formulas: ['dashboard'],
  labelReviews: ['dashboard'],
  projects: ['dashboard'],
  documents: ['dashboard'],
  tasks: ['dashboard'],
  activity: ['dashboard'],
  notifications: ['dashboard'],
};

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('connecting');
  const [online, setOnline] = useState<PresenceUser[]>([]);
  const [lastChange, setLastChange] = useState<ChangeEvent | null>(null);
  const clientId = useRef<string | null>(null);
  const pending = useRef(new Set<string>());
  const flushTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!user) {
      setStatus('offline');
      setOnline([]);
      return;
    }

    let source: EventSource | null = null;
    let retryTimer: number | null = null;
    let attempts = 0;
    let closed = false;

    const flush = () => {
      flushTimer.current = null;
      const keys = [...pending.current];
      pending.current.clear();
      for (const key of keys) {
        const [kind, name] = key.split('::');
        if (kind === 'collection') {
          queryClient.invalidateQueries({ queryKey: ['collection', name] });
          queryClient.invalidateQueries({ queryKey: ['record', name] });
        } else {
          queryClient.invalidateQueries({ queryKey: [name] });
        }
      }
    };

    const schedule = (key: string) => {
      pending.current.add(key);
      if (flushTimer.current === null) flushTimer.current = window.setTimeout(flush, 120);
    };

    const connect = () => {
      if (closed) return;
      setStatus(attempts === 0 ? 'connecting' : 'connecting');
      source = new EventSource('/api/stream', { withCredentials: true });

      source.addEventListener('hello', (event) => {
        attempts = 0;
        setStatus('live');
        try { clientId.current = JSON.parse((event as MessageEvent).data).clientId; } catch { /* ignore */ }
      });

      source.addEventListener('presence', (event) => {
        try { setOnline(JSON.parse((event as MessageEvent).data).online ?? []); } catch { /* ignore */ }
      });

      source.addEventListener('change', (event) => {
        let change: ChangeEvent;
        try { change = JSON.parse((event as MessageEvent).data); } catch { return; }
        setLastChange(change);
        schedule(`collection::${change.collection}`);
        for (const key of RIPPLE[change.collection] ?? []) schedule(`query::${key}`);
      });

      source.onerror = () => {
        source?.close();
        source = null;
        setStatus('offline');
        if (closed) return;
        attempts += 1;
        // back off, but never so far that the floor stops seeing live data
        const delay = Math.min(1000 * 2 ** Math.min(attempts, 4), 15000);
        retryTimer = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closed = true;
      source?.close();
      if (retryTimer) window.clearTimeout(retryTimer);
      if (flushTimer.current) window.clearTimeout(flushTimer.current);
      flushTimer.current = null;
    };
  }, [user, queryClient]);

  // What this tab says it is looking at. Sent once per change — never on every
  // render, and never re-sent when the presence broadcast it caused comes back.
  const wanted = useRef<string | null>(null);
  const sent = useRef<string | null | undefined>(undefined);
  const pushViewing = useCallback(() => {
    if (!clientId.current || sent.current === wanted.current) return;
    sent.current = wanted.current;
    void fetch('/api/presence/viewing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ clientId: clientId.current, viewing: wanted.current }),
    }).catch(() => { sent.current = undefined; /* presence is best-effort */ });
  }, []);
  // Page switches call this twice back to back (the old page clears, the new
  // one sets); a microtask lets the two collapse into a single request.
  const scheduled = useRef(false);
  const setViewing = useCallback((viewing: string | null) => {
    wanted.current = viewing;
    if (scheduled.current) return;
    scheduled.current = true;
    queueMicrotask(() => { scheduled.current = false; pushViewing(); });
  }, [pushViewing]);
  // The stream's hello hands us a client id; anything requested before that is sent then.
  useEffect(() => { if (status === 'live') { sent.current = undefined; pushViewing(); } }, [status, pushViewing]);

  const value = useMemo<RealtimeValue>(() => ({ status, online, lastChange, setViewing }), [status, online, lastChange, setViewing]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeValue {
  return useContext(RealtimeContext);
}

/** Announce what this person is looking at, so colleagues can see it. */
export function useViewing(label: string | null) {
  const { setViewing } = useRealtime();
  useEffect(() => {
    setViewing(label);
    return () => setViewing(null);
  }, [label, setViewing]);
}

/** Who else is on this record right now. */
export function useAlsoHere(label: string | null): PresenceUser[] {
  const { online } = useRealtime();
  const { user } = useSession();
  if (!label) return [];
  return online.filter((person) => person.viewing === label && person.id !== user?.id);
}
