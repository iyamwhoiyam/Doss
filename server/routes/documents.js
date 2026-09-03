/**
 * Customer and vendor document management.
 *
 * Files land on disk under `data/files/<yyyy>/<mm>/` with an opaque name; the
 * `documents` collection holds the metadata and the full version history. A new
 * upload against an existing document becomes a new version rather than
 * overwriting the old one, because a superseded specification still has to be
 * retrievable years later.
 */

import fs from 'node:fs';
import path from 'node:path';

import { Router } from 'express';
import multer from 'multer';

import { newId } from '../db/engine.js';
import { actorContext, requirePermission, HttpError } from '../lib/auth.js';
import { route, requireFields, num, queryOptions } from '../lib/http.js';
import { logActivity, notifyRole } from '../lib/events.js';

const MAX_FILE_BYTES = 60 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/tiff',
  'text/plain', 'text/csv', 'text/markdown',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip', 'application/postscript', 'application/octet-stream',
]);

const EXTENSION = {
  'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
  'image/svg+xml': '.svg', 'image/tiff': '.tif', 'text/plain': '.txt', 'text/csv': '.csv',
  'text/markdown': '.md', 'application/zip': '.zip', 'application/postscript': '.ai',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

const DAY = 86400000;

export function documentsRouter(db) {
  const router = Router();

  const storage = multer.diskStorage({
    destination(_req, _file, cb) {
      const now = new Date();
      const dir = path.join(db.filesDir, String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req, file, cb) {
      const ext = EXTENSION[file.mimetype] ?? path.extname(file.originalname).slice(0, 10) ?? '';
      cb(null, `${newId()}${ext}`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_BYTES, files: 10 },
    fileFilter(_req, file, cb) {
      if (!ALLOWED_MIME.has(file.mimetype)) {
        return cb(new HttpError(415, `${file.mimetype} files are not accepted. Upload a PDF, image, Office document, text file or archive.`));
      }
      cb(null, true);
    },
  });

  const relativePath = (absolute) => path.relative(db.filesDir, absolute).split(path.sep).join('/');

  /** Documents with their owner resolved, for the vault list. */
  router.get('/', route((req, res) => {
    const options = queryOptions(req, ['name', 'description', 'tags']);
    const where = { ...(options.where ?? {}) };
    if (req.query.expiringDays) {
      const cutoff = new Date(Date.now() + num(req.query.expiringDays, 45) * DAY).toISOString();
      where.expiresAt = { $lte: cutoff, $exists: true };
    }
    const { rows, total } = db.query('documents', { ...options, where: Object.keys(where).length ? where : undefined, sort: options.sort ?? '-updatedAt' });

    const ownerName = (doc) => {
      switch (doc.ownerType) {
        case 'customer': return db.get('customers', doc.ownerId)?.name ?? '—';
        case 'vendor': return db.get('vendors', doc.ownerId)?.name ?? '—';
        case 'item': return db.get('items', doc.ownerId)?.name ?? '—';
        case 'lot': return `Lot ${db.get('lots', doc.ownerId)?.lotNumber ?? '—'}`;
        case 'formula': return db.get('formulas', doc.ownerId)?.code ?? '—';
        case 'project': return db.get('projects', doc.ownerId)?.name ?? '—';
        case 'workOrder': return db.get('workOrders', doc.ownerId)?.woNumber ?? '—';
        case 'labelReview': return db.get('labelReviews', doc.ownerId)?.reviewNumber ?? '—';
        default: return '—';
      }
    };
    res.json({
      rows: rows.map((doc) => ({
        ...doc,
        ownerName: ownerName(doc),
        latest: doc.versions?.at(-1) ?? null,
        daysUntilExpiry: doc.expiresAt ? Math.round((Date.parse(doc.expiresAt) - Date.now()) / DAY) : null,
      })),
      total,
    });
  }));

  /** Upload a file: creates a document, or adds a version to an existing one. */
  router.post('/upload', requirePermission('documents.write'), upload.array('files', 10), route((req, res) => {
    if (!req.files?.length) throw new HttpError(422, 'No file was received');
    const ctx = actorContext(req);
    const body = req.body ?? {};

    const created = db.transaction((tx) => req.files.map((file) => {
      const version = {
        version: 1,
        filename: file.originalname,
        fileId: relativePath(file.path),
        size: file.size,
        mime: file.mimetype,
        uploadedBy: req.user.id,
        uploadedAt: new Date().toISOString(),
        notes: body.versionNotes ?? '',
      };

      if (body.documentId) {
        const doc = tx.getOrFail('documents', body.documentId);
        version.version = (doc.currentVersion ?? doc.versions.length) + 1;
        return tx.update('documents', doc.id, {
          versions: [...(doc.versions ?? []), version],
          currentVersion: version.version,
          status: 'in_review',
          approvedBy: '',
          approvedAt: null,
        }, ctx);
      }

      return tx.insert('documents', {
        name: body.name || file.originalname.replace(/\.[^.]+$/, ''),
        category: body.category || 'other',
        status: 'draft',
        ownerType: body.ownerType || 'general',
        ownerId: body.ownerId || '',
        customerId: body.customerId || (body.ownerType === 'customer' ? body.ownerId : '') || '',
        vendorId: body.vendorId || (body.ownerType === 'vendor' ? body.ownerId : '') || '',
        currentVersion: 1,
        versions: [version],
        effectiveDate: body.effectiveDate || new Date().toISOString(),
        expiresAt: body.expiresAt || null,
        description: body.description ?? '',
        confidential: body.confidential === 'true' || body.confidential === true,
        tags: body.tags ? String(body.tags).split(',').map((t) => t.trim()).filter(Boolean) : [],
      }, ctx);
    }), ctx);

    logActivity(db, req, {
      type: 'document',
      title: created.length === 1 ? `${created[0].name} uploaded` : `${created.length} documents uploaded`,
      detail: created[0].category,
      tone: 'info',
      refType: 'document',
      refId: created[0].id,
      link: `/documents?doc=${created[0].id}`,
    });
    res.status(201).json({ documents: created });
  }));

  /** Stream a stored version back. Paths are resolved inside the files root only. */
  router.get('/:id/versions/:version/file', route((req, res) => {
    const doc = db.getOrFail('documents', req.params.id);
    const version = (doc.versions ?? []).find((v) => String(v.version) === String(req.params.version));
    if (!version) throw new HttpError(404, 'That version does not exist');
    if (!version.fileId) throw new HttpError(404, 'This version is a metadata placeholder — no file was uploaded for it');

    const absolute = path.resolve(db.filesDir, version.fileId);
    if (!absolute.startsWith(path.resolve(db.filesDir) + path.sep)) throw new HttpError(400, 'Invalid file path');
    if (!fs.existsSync(absolute)) throw new HttpError(404, 'The stored file is missing from disk');

    res.setHeader('Content-Type', version.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${encodeURIComponent(version.filename)}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    fs.createReadStream(absolute).pipe(res);
  }));

  router.post('/:id/approve', requirePermission('documents.approve'), route((req, res) => {
    const doc = db.getOrFail('documents', req.params.id);
    if (!doc.versions?.length) throw new HttpError(409, 'This document has no version to approve');
    const updated = db.update('documents', doc.id, {
      status: 'approved',
      approvedBy: req.user.id,
      approvedAt: new Date().toISOString(),
      effectiveDate: req.body?.effectiveDate ?? doc.effectiveDate ?? new Date().toISOString(),
      expiresAt: req.body?.expiresAt ?? doc.expiresAt,
    }, actorContext(req));
    logActivity(db, req, {
      type: 'document', title: `${doc.name} approved`, detail: doc.category,
      tone: 'success', refType: 'document', refId: doc.id, link: `/documents?doc=${doc.id}`,
    });
    res.json(updated);
  }));

  router.post('/:id/supersede', requirePermission('documents.write'), route((req, res) => {
    const doc = db.getOrFail('documents', req.params.id);
    res.json(db.update('documents', doc.id, { status: 'superseded' }, actorContext(req)));
  }));

  /** Documents that have expired or are about to — the compliance watchlist. */
  router.get('/expiring', route((req, res) => {
    const days = num(req.query.days, 45);
    const cutoff = Date.now() + days * DAY;
    const rows = db.all('documents')
      .filter((d) => d.expiresAt && Date.parse(d.expiresAt) <= cutoff && d.status !== 'superseded')
      .map((d) => ({ ...d, daysUntilExpiry: Math.round((Date.parse(d.expiresAt) - Date.now()) / DAY) }))
      .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
    res.json({ rows, total: rows.length, expired: rows.filter((r) => r.daysUntilExpiry < 0).length });
  }));

  /** Everything filed against one record — the customer/vendor document tab. */
  router.get('/for/:ownerType/:ownerId', route((req, res) => {
    const rows = db.find('documents', { ownerType: req.params.ownerType, ownerId: req.params.ownerId }, { sort: '-updatedAt' });
    res.json({
      rows,
      total: rows.length,
      byCategory: rows.reduce((acc, d) => ({ ...acc, [d.category]: (acc[d.category] ?? 0) + 1 }), {}),
    });
  }));

  /** Sweep for documents that have just expired and tell quality about them. */
  router.post('/sweep-expiry', requirePermission('documents.approve'), route((req, res) => {
    const ctx = actorContext(req);
    const expired = db.all('documents').filter((d) => d.expiresAt && Date.parse(d.expiresAt) < Date.now() && d.status === 'approved');
    for (const doc of expired) db.update('documents', doc.id, { status: 'expired' }, ctx);
    if (expired.length) {
      notifyRole(db, 'quality', {
        title: `${expired.length} document${expired.length > 1 ? 's have' : ' has'} expired`,
        body: expired.slice(0, 3).map((d) => d.name).join(', '),
        link: '/documents?expiring=0',
        severity: 'warning',
      });
    }
    res.json({ expired: expired.length, documents: expired.map((d) => ({ id: d.id, name: d.name })) });
  }));

  return router;
}
