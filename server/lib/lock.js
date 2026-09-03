/**
 * Product change control.
 *
 * A Project is the production-of-record for its formula, label, packaging and
 * price. While the project is `open` everything is editable; once it is `locked`
 * (customer-approved) the project and all of those child records are frozen, and
 * a change requires opening a new revision. This is the single place that
 * decides "is this record's product locked", so every write path can ask the
 * same question the same way.
 */

import { HttpError } from './auth.js';

/** Child records whose editability is governed by their parent project. */
export const PRODUCT_CHILDREN = new Set(['formulas', 'labelReviews', 'quotes']);

/** Every collection whose writes are subject to the product lock. */
export const LOCKABLE = new Set(['projects', ...PRODUCT_CHILDREN]);

/** The project that governs a record's editability, or null if none applies. */
export function governingProject(db, collection, record) {
  if (!record) return null;
  if (collection === 'projects') return record;
  if (PRODUCT_CHILDREN.has(collection) && record.projectId) {
    return db.get('projects', record.projectId, { includeDeleted: true });
  }
  return null;
}

/**
 * Throw 409 if the record belongs to a locked product. `idOrRecord` may be an id
 * (looked up) or the record itself. A no-op for collections that aren't part of
 * a product, or products that are still open.
 */
export function assertUnlocked(db, collection, idOrRecord) {
  if (!LOCKABLE.has(collection)) return;
  const record = idOrRecord && typeof idOrRecord === 'object'
    ? idOrRecord
    : db.get(collection, idOrRecord, { includeDeleted: true });
  const project = governingProject(db, collection, record);
  if (project && project.lockState === 'locked') {
    throw new HttpError(409, `"${project.name}" is locked as the customer-approved production-of-record (revision ${project.productRevision ?? 1}). Open a revision to make changes.`);
  }
}
