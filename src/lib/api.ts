/**
 * Typed fetch wrapper and React Query helpers.
 *
 * Every call goes through `request`, so error handling, credentials and the
 * "your session expired" path are decided in exactly one place.
 */

import { useMutation, useQuery, useQueryClient, type QueryClient, type UseQueryOptions } from '@tanstack/react-query';

const NETWORK_MESSAGE = 'Could not reach the Enova Ops server. Check the connection (VPN, proxy or Wi-Fi) and try again; if it keeps happening, the server may be down.';

export class ApiError extends Error {
  status: number;
  details?: { field: string; message: string }[];
  constructor(message: string, status: number, details?: { field: string; message: string }[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

export async function request<T = unknown>(
  path: string,
  options: Omit<RequestInit, 'body'> & { body?: unknown } = {},
): Promise<T> {
  const { body, headers, ...rest } = options;
  const isForm = body instanceof FormData;

  const url = path.startsWith('/api') ? path : `/api${path}`;
  const init: RequestInit = {
    credentials: 'same-origin',
    ...rest,
    headers: {
      ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...(headers ?? {}),
    },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  };

  // A fetch that throws never reached the server: the network dropped, the
  // request was blocked, or the server is mid-restart. Reads are retried once
  // after a short pause; everything is reported in plain words rather than the
  // browser's "Failed to fetch".
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (first) {
    const method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'GET') throw new ApiError(NETWORK_MESSAGE, 0);
    await new Promise((resolve) => setTimeout(resolve, 800));
    try { response = await fetch(url, init); } catch { throw new ApiError(NETWORK_MESSAGE, 0); }
    void first;
  }

  if (response.status === 204) return undefined as T;
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    throw new ApiError('The server is restarting or unreachable behind the proxy. Wait a few seconds and try again.', response.status);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('json') ? await response.json() : await response.text();

  if (!response.ok) {
    if (response.status === 401 && !path.includes('/auth/')) onUnauthorized?.();
    const message = typeof payload === 'string' ? payload : payload?.error ?? response.statusText;
    throw new ApiError(message, response.status, typeof payload === 'object' ? payload?.details : undefined);
  }
  return payload as T;
}

export const api = {
  get: <T = unknown>(path: string) => request<T>(path),
  post: <T = unknown>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T = unknown>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T = unknown>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  del: <T = unknown>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T = unknown>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
};

/** Build a query string from a sparse object, dropping empty values. */
export function qs(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  const out = search.toString();
  return out ? `?${out}` : '';
}

export interface ListResult<T> { rows: T[]; total: number; limit?: number | null; offset?: number }

export interface ListParams {
  where?: Record<string, unknown>;
  sort?: string | string[];
  limit?: number;
  offset?: number;
  q?: string;
  select?: string[];
  includeDeleted?: boolean;
}

/** Read a collection through the generic CRUD API. */
export function useList<T = Record<string, unknown>>(
  collection: string,
  params: ListParams = {},
  options: Partial<UseQueryOptions<ListResult<T>>> = {},
) {
  return useQuery<ListResult<T>>({
    queryKey: ['collection', collection, params],
    queryFn: () => api.get<ListResult<T>>(`/data/${collection}${qs({
      ...params,
      where: params.where && Object.keys(params.where).length ? params.where : undefined,
      sort: Array.isArray(params.sort) ? params.sort.join(',') : params.sort,
      select: params.select?.join(','),
    })}`),
    ...options,
  });
}

/**
 * A record we already have in some cached list — the board, a table, a lookup.
 * Lets a detail page paint immediately from what was just on screen while the
 * fresh copy loads behind it.
 */
export function cachedRecord<T>(queryClient: QueryClient, collection: string, id: string | undefined): T | undefined {
  if (!id) return undefined;
  const direct = queryClient.getQueryData<T>(['record', collection, id]);
  if (direct) return direct;
  for (const query of queryClient.getQueryCache().findAll({ queryKey: ['collection', collection] })) {
    const rows = (query.state.data as { rows?: { id?: string }[] } | undefined)?.rows;
    const hit = rows?.find((row) => row.id === id);
    if (hit) return hit as T;
  }
  return undefined;
}

export function useRecord<T = Record<string, unknown>>(
  collection: string,
  id: string | undefined,
  options: Partial<UseQueryOptions<T>> = {},
) {
  const queryClient = useQueryClient();
  return useQuery<T>({
    queryKey: ['record', collection, id],
    queryFn: () => api.get<T>(`/data/${collection}/${id}`),
    enabled: Boolean(id),
    placeholderData: (() => cachedRecord<T>(queryClient, collection, id)) as UseQueryOptions<T>['placeholderData'],
    ...options,
  });
}

/** Create / patch / archive one record, invalidating the collection afterwards. */
export function useSave<T extends { id?: string }>(collection: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (record: Partial<T> & { id?: string }) => {
      const { id, ...body } = record;
      return id
        ? api.patch<T>(`/data/${collection}/${id}`, body)
        : api.post<T>(`/data/${collection}`, body);
    },
    onSuccess: (saved: T) => {
      queryClient.invalidateQueries({ queryKey: ['collection', collection] });
      if (saved?.id) queryClient.invalidateQueries({ queryKey: ['record', collection, saved.id] });
    },
  });
}

export function useArchive(collection: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/data/${collection}/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['collection', collection] }),
  });
}

/** A POST action that refreshes whatever the caller names. */
export function useAction<TBody = unknown, TResult = unknown>(
  path: string | ((body: TBody) => string),
  invalidate: (string | unknown[])[] = [],
) {
  const queryClient = useQueryClient();
  return useMutation<TResult, ApiError, TBody>({
    mutationFn: (body: TBody) => api.post<TResult>(typeof path === 'function' ? path(body) : path, body),
    onSuccess: () => {
      for (const key of invalidate) {
        queryClient.invalidateQueries({ queryKey: Array.isArray(key) ? key : [key] });
      }
    },
  });
}
