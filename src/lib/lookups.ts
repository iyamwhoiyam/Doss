/**
 * Shared reference-data hooks.
 *
 * People, customers, vendors, items and locations are read on nearly every
 * page. Each is fetched once and cached for the session, so a table of 400 rows
 * resolves its foreign keys without 400 requests.
 */

import { useMemo } from 'react';

import { useList } from './api';
import type { Customer, Item, Location, User, Vendor, Formula, Project } from './types';

const LONG_CACHE = { staleTime: 5 * 60_000 };

export function useUsers() {
  const { data } = useList<User>('users', { sort: 'name', limit: 500 }, LONG_CACHE);
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  return {
    rows,
    byId,
    name: (id: string | undefined | null) => (id ? byId.get(id)?.name ?? '—' : '—'),
    get: (id: string | undefined | null) => (id ? byId.get(id) ?? null : null),
    options: rows.filter((u) => u.active).map((u) => ({ value: u.id, label: u.name, sub: u.title })),
    byRole: (role: string) => rows.filter((u) => u.role === role && u.active),
  };
}

export function useCustomers() {
  const { data } = useList<Customer>('customers', { sort: 'name', limit: 500 }, LONG_CACHE);
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  return {
    rows,
    byId,
    name: (id: string | undefined | null) => (id ? byId.get(id)?.name ?? '—' : '—'),
    get: (id: string | undefined | null) => (id ? byId.get(id) ?? null : null),
    options: rows.map((c) => ({ value: c.id, label: c.name, sub: c.code })),
  };
}

export function useVendors() {
  const { data } = useList<Vendor>('vendors', { sort: 'name', limit: 500 }, LONG_CACHE);
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  return {
    rows,
    byId,
    name: (id: string | undefined | null) => (id ? byId.get(id)?.name ?? '—' : '—'),
    get: (id: string | undefined | null) => (id ? byId.get(id) ?? null : null),
    options: rows.map((v) => ({ value: v.id, label: v.name, sub: v.code })),
  };
}

export function useItems() {
  const { data, isLoading } = useList<Item>('items', { sort: 'name', limit: 2000 }, LONG_CACHE);
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  return {
    rows,
    byId,
    isLoading,
    name: (id: string | undefined | null) => (id ? byId.get(id)?.name ?? '—' : '—'),
    get: (id: string | undefined | null) => (id ? byId.get(id) ?? null : null),
    options: rows.filter((i) => i.active).map((i) => ({ value: i.id, label: i.name, sub: i.itemCode })),
  };
}

export function useLocations() {
  const { data } = useList<Location>('locations', { sort: 'code', limit: 300 }, LONG_CACHE);
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  return {
    rows,
    byId,
    name: (id: string | undefined | null) => (id ? byId.get(id)?.name ?? '—' : '—'),
    code: (id: string | undefined | null) => (id ? byId.get(id)?.code ?? '—' : '—'),
    options: rows.filter((l) => l.active).map((l) => ({ value: l.id, label: `${l.code} · ${l.name}`, sub: l.type })),
  };
}

export function useFormulas() {
  const { data } = useList<Formula>('formulas', { sort: 'code', limit: 500 }, LONG_CACHE);
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  return {
    rows,
    byId,
    name: (id: string | undefined | null) => (id ? byId.get(id)?.name ?? '—' : '—'),
    get: (id: string | undefined | null) => (id ? byId.get(id) ?? null : null),
    options: rows.map((f) => ({ value: f.id, label: `${f.code} · ${f.name}`, sub: f.status })),
  };
}

export function useProjects() {
  const { data } = useList<Project>('projects', { sort: 'code', limit: 500 }, LONG_CACHE);
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  return {
    rows,
    byId,
    name: (id: string | undefined | null) => (id ? byId.get(id)?.name ?? '—' : '—'),
    options: rows.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })),
  };
}
