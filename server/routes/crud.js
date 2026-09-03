/**
 * Generic REST surface over every collection.
 *
 * One consistent contract for the whole platform — list, read, create, patch,
 * archive, restore — with per-collection permissions from the schema, optimistic
 * concurrency via `If-Match`, and the actor threaded into the audit trail.
 * Domain routes elsewhere layer business rules on top; this is the substrate.
 */

import { Router } from 'express';

import { COLLECTION_PERMISSIONS, redact, searchableFields, schema } from '../db/schema.js';
import { can } from '../../shared/domain.js';
import { actorContext, HttpError } from '../lib/auth.js';
import { route, queryOptions, num } from '../lib/http.js';
import { assertUnlocked } from '../lib/lock.js';

/** Collections the generic API refuses to expose at all. */
const PRIVATE = new Set(['sessions']);

/**
 * A project and its formula reference each other. Keep both sides true on every
 * write so no page ever has to guess which direction the link was made in —
 * the kind of referential integrity an ERP is expected to hold.
 */
function syncProductLinks(db, collection, row, ctx) {
  if (collection === 'projects' && row.formulaId) {
    const formula = db.get('formulas', row.formulaId);
    if (formula && formula.projectId !== row.id) db.update('formulas', formula.id, { projectId: row.id }, ctx);
  }
  if (collection === 'formulas' && row.projectId) {
    const project = db.get('projects', row.projectId);
    if (project && !project.formulaId) db.update('projects', project.id, { formulaId: row.id }, ctx);
  }
  // An order or a batch belongs to the product's project: fill it in from the
  // quote or formula it was made from, so SO# and MO# always show on the project.
  if (collection === 'salesOrders' && !row.projectId) {
    const quote = row.quoteId ? db.get('quotes', row.quoteId) : null;
    const formula = quote?.formulaId ? db.get('formulas', quote.formulaId) : row.lines?.[0]?.formulaId ? db.get('formulas', row.lines[0].formulaId) : null;
    const projectId = quote?.projectId || formula?.projectId || '';
    if (projectId) db.update('salesOrders', row.id, { projectId }, ctx);
  }
  if (collection === 'workOrders' && !row.projectId && row.formulaId) {
    const formula = db.get('formulas', row.formulaId);
    if (formula?.projectId) db.update('workOrders', row.id, { projectId: formula.projectId }, ctx);
  }
  // A formula and the item it produces reference each other too.
  if (collection === 'formulas' && row.producesItemId) {
    const item = db.get('items', row.producesItemId);
    if (item && item.madeByFormulaId !== row.id) db.update('items', item.id, { madeByFormulaId: row.id }, ctx);
  }
  if (collection === 'items' && row.madeByFormulaId) {
    const formula = db.get('formulas', row.madeByFormulaId);
    if (formula && formula.producesItemId !== row.id) db.update('formulas', formula.id, { producesItemId: row.id }, ctx);
  }
}

function guard(req, collection, mode) {
  const rule = COLLECTION_PERMISSIONS[collection];
  if (!rule) throw new HttpError(404, `Unknown collection "${collection}"`);
  const permission = rule[mode];
  if (!permission) return;
  if (!can(req.user.role, permission)) {
    throw new HttpError(403, `Your role (${req.user.role}) cannot ${mode} ${collection}`);
  }
}

export function crudRouter(db) {
  const router = Router({ mergeParams: true });

  router.param('collection', (req, _res, next, collection) => {
    if (!db.has(collection) || PRIVATE.has(collection)) {
      return next(new HttpError(404, `Unknown collection "${collection}"`));
    }
    req.collection = collection;
    next();
  });

  // -- list --
  router.get('/:collection', route((req, res) => {
    guard(req, req.collection, 'read');
    const options = queryOptions(req, searchableFields(req.collection));
    const { rows, total } = db.query(req.collection, options);
    res.json({
      rows: rows.map((row) => redact(req.collection, row)),
      total,
      limit: options.limit ?? null,
      offset: options.offset ?? 0,
    });
  }));

  // -- read one --
  router.get('/:collection/:id', route((req, res) => {
    guard(req, req.collection, 'read');
    const row = db.get(req.collection, req.params.id, { includeDeleted: req.query.includeDeleted === 'true' });
    if (!row) throw new HttpError(404, `${req.collection} ${req.params.id} not found`);
    res.json(redact(req.collection, row));
  }));

  // -- create --
  router.post('/:collection', route((req, res) => {
    guard(req, req.collection, 'write');
    const body = { ...req.body };
    delete body.id; delete body.version; delete body.createdAt; delete body.updatedAt; delete body.deletedAt;
    if (req.collection === 'users') {
      delete body.passwordHash; delete body.passwordSalt;
    }
    const ctx = actorContext(req);
    const row = db.insert(req.collection, body, ctx);
    syncProductLinks(db, req.collection, row, ctx);
    res.status(201).json(redact(req.collection, row));
  }));

  // -- patch --
  router.patch('/:collection/:id', route((req, res) => {
    guard(req, req.collection, 'write');
    assertUnlocked(db, req.collection, req.params.id);
    const body = { ...req.body };
    for (const field of ['id', 'version', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy']) delete body[field];
    if (req.collection === 'users') { delete body.passwordHash; delete body.passwordSalt; }

    const ifMatch = req.get('if-match') ?? body.expectedVersion;
    delete body.expectedVersion;
    const ctx = actorContext(req);
    if (ifMatch !== undefined && ifMatch !== null && ifMatch !== '') ctx.expectedVersion = num(ifMatch, undefined);

    const row = db.update(req.collection, req.params.id, body, ctx);
    syncProductLinks(db, req.collection, row, ctx);
    res.json(redact(req.collection, row));
  }));

  // -- archive (soft delete) --
  router.delete('/:collection/:id', route((req, res) => {
    guard(req, req.collection, 'write');
    assertUnlocked(db, req.collection, req.params.id);
    const row = db.remove(req.collection, req.params.id, actorContext(req));
    res.json({ id: row.id, archived: true, archivedAt: row.deletedAt });
  }));

  router.post('/:collection/:id/restore', route((req, res) => {
    guard(req, req.collection, 'write');
    res.json(redact(req.collection, db.restore(req.collection, req.params.id, actorContext(req))));
  }));

  // -- bulk create/patch, used by importers and multi-row editors --
  router.post('/:collection/bulk', route((req, res) => {
    guard(req, req.collection, 'write');
    const { create = [], update = [] } = req.body ?? {};
    const ctx = actorContext(req);
    const result = db.transaction((tx) => ({
      created: create.map((data) => redact(req.collection, tx.insert(req.collection, data, ctx))),
      updated: update.map(({ id, ...patch }) => {
        assertUnlocked(db, req.collection, id);
        return redact(req.collection, tx.update(req.collection, id, patch, ctx));
      }),
    }), ctx);
    res.json(result);
  }));

  // -- per-record audit trail --
  router.get('/:collection/:id/history', route((req, res) => {
    guard(req, req.collection, 'read');
    res.json({ entries: db.readAudit({ collection: req.collection, recordId: req.params.id, days: 120, limit: 200 }) });
  }));

  return router;
}

/** Field metadata so the client can render editors without hard-coding schemas. */
export function schemaSummary() {
  const out = {};
  for (const [name, def] of Object.entries(schema)) {
    if (PRIVATE.has(name)) continue;
    out[name] = {
      label: def.label ?? name,
      search: def.search ?? [],
      unique: def.unique ?? [],
      permissions: COLLECTION_PERMISSIONS[name] ?? { read: null, write: null },
      fields: Object.fromEntries(
        Object.entries(def.fields ?? {})
          .filter(([field]) => !(def.redact ?? []).includes(field))
          .map(([field, spec]) => [field, {
            label: spec.label ?? field,
            type: spec.type ?? 'any',
            required: Boolean(spec.required),
            enum: spec.enum ?? null,
          }]),
      ),
    };
  }
  return out;
}
