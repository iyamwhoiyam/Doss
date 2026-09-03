/**
 * Every page's code, loaded on demand — and warmed ahead of demand.
 *
 * Pages are split into their own chunks so the first paint stays small, but a
 * chunk fetched at click time is a visible pause. So the shell preloads every
 * chunk in the background once the app is idle, and links warm their target the
 * moment the pointer reaches them. By the time anyone clicks, the code is there.
 */

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

type Loader = () => Promise<Record<string, unknown>>;

const LOADERS: Record<string, Loader> = {
  '/': () => import('../pages/Dashboard'),
  '/my-work': () => import('../pages/MyWork'),
  '/reports': () => import('../pages/Reports'),
  '/activity': () => import('../pages/Activity'),
  '/production': () => import('../pages/Production'),
  '/production/:id': () => import('../pages/WorkOrderDetail'),
  '/schedule': () => import('../pages/Schedule'),
  '/planning': () => import('../pages/Planning'),
  '/routings': () => import('../pages/Routings'),
  '/inventory': () => import('../pages/Inventory'),
  '/inventory/:id': () => import('../pages/ItemDetail'),
  '/inventory/counts/:id': () => import('../pages/CountSheet'),
  '/purchasing': () => import('../pages/Purchasing'),
  '/purchasing/vendors/:id': () => import('../pages/VendorDetail'),
  '/purchasing/:id': () => import('../pages/PurchaseOrderDetail'),
  '/development': () => import('../pages/Development'),
  '/development/:id': () => import('../pages/ProjectDetail'),
  '/formulations': () => import('../pages/Formulations'),
  '/formulations/:id': () => import('../pages/FormulaBuilder'),
  '/quotes': () => import('../pages/Quotes'),
  '/quotes/:id': () => import('../pages/QuoteBuilder'),
  '/labels': () => import('../pages/Labels'),
  '/labels/:id': () => import('../pages/LabelReviewPage'),
  '/samples': () => import('../pages/Samples'),
  '/rfqs': () => import('../pages/Rfqs'),
  '/customers': () => import('../pages/Customers'),
  '/customers/:id': () => import('../pages/CustomerDetail'),
  '/documents': () => import('../pages/Documents'),
  '/orders': () => import('../pages/Orders'),
  '/orders/:id': () => import('../pages/OrderDetail'),
  '/admin': () => import('../pages/Admin'),
};

const loaded = new Set<string>();
const inflight = new Map<string, Promise<unknown>>();

function load(pattern: string) {
  if (loaded.has(pattern)) return Promise.resolve();
  const existing = inflight.get(pattern);
  if (existing) return existing;
  const p = LOADERS[pattern]().then(() => { loaded.add(pattern); }).catch(() => { inflight.delete(pattern); });
  inflight.set(pattern, p);
  return p;
}

/** A page component for a route pattern; the same loader the preloader uses, so nothing downloads twice. */
export function page<T extends ComponentType<object>>(pattern: string, pick: (m: Record<string, unknown>) => T): LazyExoticComponent<T> {
  return lazy(() => LOADERS[pattern]().then((m) => { loaded.add(pattern); return { default: pick(m) }; }));
}

/** Warm the chunk for a concrete path such as /development/abc or /inventory. */
export function preloadRoute(path: string) {
  const clean = path.split('?')[0].split('#')[0];
  const parts = clean.split('/').filter(Boolean);
  // Try the most specific pattern first: literal segments win over :id.
  const candidates = Object.keys(LOADERS).filter((pattern) => {
    const pp = pattern.split('/').filter(Boolean);
    if (pp.length !== parts.length) return false;
    return pp.every((seg, i) => seg.startsWith(':') || seg === parts[i]);
  }).sort((a, b) => (b.match(/:/g)?.length ?? 0) - (a.match(/:/g)?.length ?? 0) ? -1 : 1);
  const literalFirst = candidates.sort((a, b) => (a.includes(':') ? 1 : 0) - (b.includes(':') ? 1 : 0));
  const pattern = literalFirst[0];
  return pattern ? load(pattern) : Promise.resolve();
}

/** Warm every page in the background, a few at a time, when the browser is idle. */
export function preloadAllRoutes() {
  const queue = Object.keys(LOADERS).filter((p) => !loaded.has(p));
  const idle = (fn: () => void) => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 1500 }); else setTimeout(fn, 200);
  };
  const next = () => {
    const batch = queue.splice(0, 3);
    if (!batch.length) return;
    Promise.all(batch.map(load)).finally(() => idle(next));
  };
  idle(next);
}
