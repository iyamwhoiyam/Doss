/**
 * Small HTTP helpers shared by every route module.
 */

import { HttpError } from './auth.js';

/** Wrap an async handler so a rejected promise reaches the error middleware. */
export const route = (handler) => (req, res, next) => {
  try {
    const result = handler(req, res, next);
    if (result && typeof result.then === 'function') result.catch(next);
  } catch (err) {
    next(err);
  }
};

export function parseJson(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

/** Turn `?where=…&sort=…&limit=…&q=…` into engine query options. */
export function queryOptions(req, searchFields = []) {
  const { where: rawWhere, sort, limit, offset, includeDeleted, select, q } = req.query;
  const where = parseJson(rawWhere, {}) ?? {};
  if (q && searchFields.length) where.$search = { value: String(q), fields: searchFields };
  return {
    where: Object.keys(where).length ? where : undefined,
    sort: parseJson(sort, sort ?? undefined),
    limit: limit ? Math.min(Number(limit) || 50, 2000) : undefined,
    offset: offset ? Number(offset) || 0 : 0,
    includeDeleted: includeDeleted === 'true' || includeDeleted === '1',
    select: select ? String(select).split(',') : undefined,
  };
}

export function requireFields(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length) throw new HttpError(422, `Missing required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
}

export function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Express error middleware — turns engine and HTTP errors into JSON. */
export function errorHandler(err, _req, res, _next) {
  const status = err.status ?? 500;
  if (status >= 500) console.error('[api]', err);
  res.status(status).json({
    error: err.message || 'Something went wrong',
    name: err.name,
    details: err.details ?? undefined,
  });
}

export { HttpError };
