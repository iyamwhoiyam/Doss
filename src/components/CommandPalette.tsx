/**
 * ⌘K palette: one box that searches every module and doubles as a jump list.
 *
 * The server does the searching (it can see all twenty-odd collections at
 * once), so this stays a thin, fast surface over `/api/search`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { Icon } from './Icon';
import { api, qs } from '../lib/api';
import { NAV } from '@shared/domain';
import { useSession } from '../lib/session';

interface SearchHit {
  id: string; title: string; subtitle: string; link: string;
  collection: string; typeLabel: string;
}

interface SearchResponse { q: string; total: number; groups: { collection: string; label: string; results: SearchHit[] }[] }

const ICON_FOR: Record<string, string> = {
  workOrders: 'factory', formulas: 'beaker', quotes: 'calculator', projects: 'flask',
  customers: 'building', vendors: 'truck', items: 'boxes', lots: 'tag',
  documents: 'folder', labelReviews: 'label', salesOrders: 'cart',
  purchaseOrders: 'clipboard', users: 'user',
};

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const navigate = useNavigate();
  const { can } = useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    if (!open) { setQuery(''); setDebounced(''); setHighlight(0); return; }
    window.setTimeout(() => inputRef.current?.focus(), 20);
  }, [open]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 160);
    return () => window.clearTimeout(timer);
  }, [query]);

  const { data, isFetching } = useQuery<SearchResponse>({
    queryKey: ['search', debounced],
    queryFn: () => api.get<SearchResponse>(`/search${qs({ q: debounced })}`),
    enabled: open && debounced.length >= 2,
    staleTime: 20_000,
  });

  // With no query the palette is a jump list of everything this role can open.
  const navHits = useMemo<SearchHit[]>(() => {
    const needle = query.trim().toLowerCase();
    return NAV.flatMap((group) => group.items)
      .filter((item) => !item.perm || can(item.perm))
      .filter((item) => !needle || item.label.toLowerCase().includes(needle))
      .map((item) => ({
        id: item.to, title: item.label, subtitle: 'Go to', link: item.to,
        collection: 'nav', typeLabel: 'Navigate',
      }));
  }, [query, can]);

  const groups = useMemo(() => {
    const searchGroups = (data?.groups ?? []).map((group) => ({ label: group.label, results: group.results }));
    return navHits.length ? [{ label: 'Navigate', results: navHits }, ...searchGroups] : searchGroups;
  }, [data, navHits]);

  const flat = useMemo(() => groups.flatMap((group) => group.results), [groups]);

  useEffect(() => { setHighlight(0); }, [debounced, groups.length]);

  if (!open) return null;

  const go = (hit: SearchHit) => { onClose(); navigate(hit.link); };

  return (
    <div className="palette-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Search Enova Ops">
      <div className="palette" onClick={(event) => event.stopPropagation()}>
        <div className="row" style={{ padding: '0 var(--s-4)', borderBottom: '1px solid var(--line-soft)' }}>
          <Icon name="search" className="faint" />
          <input
            ref={inputRef}
            className="palette-input"
            style={{ borderBottom: 0, paddingLeft: 0 }}
            placeholder="Search work orders, formulas, lots, customers, documents…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight((h) => Math.min(h + 1, flat.length - 1)); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
              if (event.key === 'Enter') { event.preventDefault(); const hit = flat[highlight]; if (hit) go(hit); }
              if (event.key === 'Escape') { event.preventDefault(); onClose(); }
            }}
          />
          {isFetching && <span className="spinner" />}
        </div>

        <div className="palette-results">
          {debounced.length >= 2 && !isFetching && flat.length === 0 && (
            <div className="empty" style={{ padding: 'var(--s-7)' }}>
              <span className="empty-icon"><Icon name="search" size={18} /></span>
              <div>
                <div className="strong">Nothing matches “{debounced}”</div>
                <div className="cell-sub">Try a work order number, a lot number, an item code or a customer name.</div>
              </div>
            </div>
          )}

          {groups.map((group) => (
            <div key={group.label}>
              <div className="palette-group-label eyebrow">{group.label}</div>
              {group.results.map((hit) => {
                const index = flat.indexOf(hit);
                return (
                  <button
                    key={`${hit.collection}-${hit.id}`}
                    type="button"
                    className="palette-item"
                    data-active={index === highlight}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => go(hit)}
                  >
                    <Icon name={ICON_FOR[hit.collection] ?? 'arrow-right'} size={14} />
                    <span className="grow truncate">{hit.title}</span>
                    {hit.subtitle && <span className="cell-sub nowrap">{hit.subtitle}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="palette-foot">
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> navigate</span>
          <span><span className="kbd">↵</span> open</span>
          <span><span className="kbd">esc</span> close</span>
          <span className="spacer" />
          {data ? <span>{data.total} result{data.total === 1 ? '' : 's'}</span> : null}
        </div>
      </div>
    </div>
  );
}
