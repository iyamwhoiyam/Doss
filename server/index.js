/**
 * Enova Ops API server.
 *
 * One Node process serves the whole platform: the file-system database, the REST
 * API, the live-sync stream, uploaded documents, and (in production) the built
 * React app. There is no external database or message broker to operate — the
 * data directory *is* the deployment.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import cookieParser from 'cookie-parser';

import { Database } from './db/engine.js';
import { schema } from './db/schema.js';
import { seed } from './db/seed.js';
import { attachUser, requireUser, HttpError } from './lib/auth.js';
import { errorHandler, route } from './lib/http.js';
import { RealtimeHub } from './lib/realtime.js';

import { authRouter } from './routes/auth.js';
import { crudRouter } from './routes/crud.js';
import { productionRouter } from './routes/production.js';
import { inventoryRouter } from './routes/inventory.js';
import { purchasingRouter } from './routes/purchasing.js';
import { commerceRouter } from './routes/commerce.js';
import { labelsRouter } from './routes/labels.js';
import { documentsRouter } from './routes/documents.js';
import { insightsRouter } from './routes/insights.js';
import { adminRouter } from './routes/admin.js';
import { importsRouter } from './routes/imports.js';
import { projectsRouter } from './routes/projects.js';
import { publicRouter } from './routes/public.js';
import { samplesRouter } from './routes/samples.js';

import * as domain from '../shared/domain.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 4000);
const DATA_DIR = process.env.DATA_DIR ?? path.join(ROOT, 'data');

export function createServer({ dataDir = DATA_DIR, autoSeed = true } = {}) {
  const db = new Database({ dir: dataDir, schema }).open();

  if (autoSeed && db.count('users') === 0) {
    console.log('[boot] empty database — seeding Enova reference data');
    seed(db);
  }

  const hub = new RealtimeHub(db);
  const app = express();

  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser());
  app.use(attachUser(db));

  // ── public ───────────────────────────────────────────────────────────────
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'enova-ops',
      time: new Date().toISOString(),
      records: db.stats().totalRecords,
      online: hub.presence().length,
    });
  });

  app.use('/api/auth', authRouter(db));

  /** The vocabulary the client renders dropdowns and status pills from. */
  app.get('/api/meta', (_req, res) => {
    res.json({
      roles: domain.ROLES,
      customerStatus: domain.CUSTOMER_STATUS,
      customerTiers: domain.CUSTOMER_TIERS,
      vendorStatus: domain.VENDOR_STATUS,
      vendorCategories: domain.VENDOR_CATEGORIES,
      itemTypes: domain.ITEM_TYPES,
      uoms: domain.UOMS,
      lotStatus: domain.LOT_STATUS,
      locationTypes: domain.LOCATION_TYPES,
      txnTypes: domain.TXN_TYPES,
      poStatus: domain.PO_STATUS,
      soStatus: domain.SO_STATUS,
      priorities: domain.PRIORITIES,
      health: domain.HEALTH,
      projectStages: domain.PROJECT_STAGES,
      projectTypes: domain.PROJECT_TYPES,
      workOrderStages: domain.WORK_ORDER_STAGES,
      taskStatus: domain.TASK_STATUS,
      formulaFormats: domain.FORMULA_FORMATS,
      formulaStatus: domain.FORMULA_STATUS,
      quoteStatus: domain.QUOTE_STATUS,
      documentCategories: domain.DOCUMENT_CATEGORIES,
      documentStatus: domain.DOCUMENT_STATUS,
      labelReviewStatus: domain.LABEL_REVIEW_STATUS,
      checklistStates: domain.CHECKLIST_STATES,
      findingTypes: domain.FINDING_TYPES,
      findingDecisions: domain.FINDING_DECISIONS,
      capsuleShells: domain.CAPSULE_SHELLS,
      quoteDefaults: domain.QUOTE_DEFAULTS,
      overheadBands: domain.OVERHEAD_BANDS,
    });
  });

  // The customer approval page answers without a login — its single-use token is
  // the credential — so it is mounted before the auth gate.
  app.use('/api/public', publicRouter(db));

  // ── everything below needs a signed-in user ──────────────────────────────
  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth') || req.path.startsWith('/public') || req.path === '/health' || req.path === '/meta') return next();
    return requireUser(req, res, next);
  });

  // live sync
  app.get('/api/stream', route((req, res) => {
    hub.subscribe(req, res, req.user);
  }));

  app.get('/api/presence', route((_req, res) => {
    const online = hub.presence();
    res.json({ online, count: online.length });
  }));

  app.post('/api/presence/viewing', route((req, res) => {
    const { clientId, viewing } = req.body ?? {};
    if (!clientId) throw new HttpError(422, 'presence needs the clientId from the stream hello event');
    res.json({ ok: hub.setViewing(clientId, viewing) });
  }));

  // domain routes come before the generic CRUD so their paths win
  app.use('/api/production', productionRouter(db));
  app.use('/api/inventory', inventoryRouter(db));
  app.use('/api/purchasing', purchasingRouter(db));
  app.use('/api/commerce', commerceRouter(db));
  app.use('/api/labels', labelsRouter(db));
  app.use('/api/documents', documentsRouter(db));
  app.use('/api/admin', adminRouter(db, hub));
  app.use('/api/import', importsRouter(db));
  app.use('/api/projects', projectsRouter(db));
  app.use('/api/samples', samplesRouter(db));
  app.use('/api', insightsRouter(db));

  // generic collection API
  app.use('/api/data', crudRouter(db));

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'No such API endpoint')));

  // ── the built client, in production ──────────────────────────────────────
  const dist = path.join(ROOT, 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    app.get('/', (_req, res) => {
      res.status(200).type('text/plain').send(
        'Enova Ops API is running.\n\nThe client is not built yet — run `npm run dev` for the Vite dev server, or `npm run build` then `npm start` for production.\n',
      );
    });
  }

  app.use(errorHandler);

  return { app, db, hub };
}

// ── boot ───────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { app, db, hub } = createServer();
  const server = app.listen(PORT, () => {
    console.log(`[boot] Enova Ops API on http://127.0.0.1:${PORT}`);
    console.log(`[boot] file-system database at ${db.dir} (${db.stats().totalRecords} records)`);
  });

  const shutdown = (signal) => {
    console.log(`\n[boot] ${signal} — flushing the database`);
    hub.close();
    server.close(() => {
      db.close();
      process.exit(0);
    });
    // do not let a hung connection hold the data hostage
    setTimeout(() => { db.close(); process.exit(0); }, 4000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
