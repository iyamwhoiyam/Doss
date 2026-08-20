/**
 * Cross-module reads: the dashboard, global search, the activity feed, "my work"
 * and the generic drag-and-drop board reorder used by projects and tasks.
 */

import { Router } from 'express';

import {
  PROJECT_STAGES, WORK_ORDER_STAGES, TASK_STATUS, enumValues,
} from '../../shared/domain.js';
import { actorContext, HttpError } from '../lib/auth.js';
import { route, num } from '../lib/http.js';
import { itemPosition } from './inventory.js';
import { orderBetween } from './production.js';

const DAY = 86400000;
const daysUntil = (iso) => (iso ? Math.round((Date.parse(iso) - Date.now()) / DAY) : null);

/** Boards that persist card order and column, keyed by the route the UI uses. */
const BOARDS = {
  projects: { collection: 'projects', column: 'stage', stages: enumValues(PROJECT_STAGES).concat(['on_hold', 'cancelled']), permission: 'projects.write' },
  tasks: { collection: 'tasks', column: 'status', stages: enumValues(TASK_STATUS), permission: 'tasks.write' },
  workOrders: { collection: 'workOrders', column: 'stage', stages: enumValues(WORK_ORDER_STAGES).concat(['cancelled']), permission: 'production.write' },
};

export function insightsRouter(db) {
  const router = Router();
  const setting = (key, fallback) => db.findOne('settings', { key })?.value ?? fallback;

  // ── dashboard ────────────────────────────────────────────────────────────
  router.get('/dashboard', route((req, res) => {
    const me = req.user;
    const workOrders = db.all('workOrders');
    const openWo = workOrders.filter((wo) => !['complete', 'cancelled'].includes(wo.stage));
    const completed30 = workOrders.filter((wo) => wo.stage === 'complete' && wo.actualEnd && Date.parse(wo.actualEnd) > Date.now() - 30 * DAY);
    const yields = completed30.map((wo) => wo.yieldPct).filter((y) => y > 0);

    const expiryWarningDays = num(setting('inventory.expiryWarningDays', 90), 90);
    const items = db.find('items', { active: true });
    const positions = items.map((item) => itemPosition(db, item, { expiryWarningDays }));
    const inventoryAlerts = positions.flatMap((p) => p.alerts.map((a) => ({ ...a, itemId: p.id, itemName: p.name, itemCode: p.itemCode })));

    const quotes = db.all('quotes');
    const openQuotes = quotes.filter((q) => ['draft', 'sent', 'revised'].includes(q.status));
    const quoteValue = (quote) => {
      const tier = (quote.result?.tiers ?? []).filter((t) => t.extendedTotal !== null).at(-1);
      return tier ? Number(tier.extendedTotal) : 0;
    };

    const salesOrders = db.all('salesOrders');
    const openOrders = salesOrders.filter((so) => !['closed', 'cancelled', 'invoiced'].includes(so.status));

    const documents = db.all('documents');
    const docWarningDays = num(setting('documents.expiryWarningDays', 45), 45);
    const expiringDocs = documents.filter((d) => {
      const days = daysUntil(d.expiresAt);
      return days !== null && days <= docWarningDays;
    });

    const labelReviews = db.all('labelReviews');
    const projects = db.all('projects');

    res.json({
      generatedAt: new Date().toISOString(),
      kpis: [
        {
          key: 'wo_open', label: 'Open work orders', value: openWo.length,
          detail: `${openWo.filter((wo) => wo.stage === 'in_process').length} running now`,
          tone: 'progress', link: '/production',
        },
        {
          key: 'wo_hold', label: 'On QC hold', value: workOrders.filter((wo) => wo.stage === 'qc_hold').length,
          detail: workOrders.filter((wo) => wo.stage === 'qc_hold').length ? 'Waiting on quality' : 'Nothing held',
          tone: workOrders.filter((wo) => wo.stage === 'qc_hold').length ? 'warning' : 'success', link: '/production',
        },
        {
          key: 'yield', label: 'Average yield (30d)', value: yields.length ? `${(yields.reduce((a, b) => a + b, 0) / yields.length).toFixed(1)}%` : '—',
          detail: `${completed30.length} batches released`, tone: 'success', link: '/production',
        },
        {
          key: 'inventory_alerts', label: 'Inventory alerts', value: inventoryAlerts.length,
          detail: `${inventoryAlerts.filter((a) => a.severity === 'danger').length} urgent`,
          tone: inventoryAlerts.some((a) => a.severity === 'danger') ? 'danger' : inventoryAlerts.length ? 'warning' : 'success',
          link: '/inventory',
        },
        {
          key: 'inventory_value', label: 'Inventory value', value: `$${Math.round(positions.reduce((s, p) => s + p.value, 0)).toLocaleString()}`,
          detail: `${positions.length} active items`, tone: 'neutral', link: '/inventory',
        },
        {
          key: 'quotes_open', label: 'Quotes in play', value: openQuotes.length,
          detail: `$${Math.round(openQuotes.reduce((s, q) => s + quoteValue(q), 0)).toLocaleString()} at the top tier`,
          tone: 'info', link: '/quotes',
        },
        {
          key: 'orders_open', label: 'Open orders', value: openOrders.length,
          detail: `$${Math.round(openOrders.reduce((s, so) => s + (so.total || 0), 0)).toLocaleString()} booked`,
          tone: 'accent', link: '/orders',
        },
        {
          key: 'labels_pending', label: 'Labels awaiting sign-off', value: labelReviews.filter((l) => ['in_review', 'corrections_requested'].includes(l.status)).length,
          detail: `${labelReviews.reduce((s, l) => s + (l.metrics?.requiredCorrections ?? 0), 0)} open corrections`,
          tone: 'warning', link: '/labels',
        },
      ],

      production: WORK_ORDER_STAGES.map((stage) => ({
        ...stage,
        count: workOrders.filter((wo) => wo.stage === stage.value).length,
        units: workOrders.filter((wo) => wo.stage === stage.value).reduce((s, wo) => s + (wo.plannedQty || 0), 0),
      })),

      pipeline: PROJECT_STAGES.map((stage) => ({
        ...stage,
        count: projects.filter((p) => p.stage === stage.value).length,
      })),

      alerts: [
        ...inventoryAlerts.filter((a) => a.severity === 'danger').slice(0, 6).map((a) => ({
          severity: 'danger', module: 'Inventory', title: a.itemName, detail: a.message, link: '/inventory',
        })),
        ...workOrders.filter((wo) => wo.stage === 'qc_hold').slice(0, 4).map((wo) => ({
          severity: 'warning', module: 'Production', title: wo.woNumber, detail: wo.holdReason || 'On QC hold', link: `/production/${wo.id}`,
        })),
        ...expiringDocs.slice(0, 5).map((d) => ({
          severity: daysUntil(d.expiresAt) < 0 ? 'danger' : 'warning',
          module: 'Documents',
          title: d.name,
          detail: daysUntil(d.expiresAt) < 0 ? `Expired ${Math.abs(daysUntil(d.expiresAt))} days ago` : `Expires in ${daysUntil(d.expiresAt)} days`,
          link: '/documents',
        })),
        ...db.find('vendors', { status: 'approved' })
          .filter((v) => v.qualification?.expiresAt && daysUntil(v.qualification.expiresAt) < 45)
          .slice(0, 4)
          .map((v) => ({
            severity: daysUntil(v.qualification.expiresAt) < 0 ? 'danger' : 'warning',
            module: 'Vendors',
            title: v.name,
            detail: daysUntil(v.qualification.expiresAt) < 0 ? 'Qualification has lapsed' : `Qualification expires in ${daysUntil(v.qualification.expiresAt)} days`,
            link: `/purchasing/vendors/${v.id}`,
          })),
        ...projects.filter((p) => p.health === 'off_track').slice(0, 3).map((p) => ({
          severity: 'warning', module: 'Development', title: p.name, detail: 'Project is off track', link: `/development/${p.id}`,
        })),
      ].slice(0, 18),

      myWork: {
        tasks: db.find('tasks', { assigneeId: me.id, status: { $ne: 'done' } }, { sort: 'dueDate' }),
        workOrders: openWo.filter((wo) => wo.supervisorId === me.id || (wo.operatorIds ?? []).includes(me.id)),
        projects: projects.filter((p) => p.ownerId === me.id || (p.teamIds ?? []).includes(me.id)),
        quotes: quotes.filter((q) => q.ownerId === me.id && ['draft', 'sent', 'revised'].includes(q.status)),
        labelReviews: labelReviews.filter((l) => l.reviewerId === me.id && ['in_review', 'corrections_requested'].includes(l.status)),
        notifications: db.find('notifications', { userId: me.id, read: false }, { sort: '-createdAt', limit: 20 }),
      },

      activity: db.all('activity', { sort: '-createdAt', limit: 25 }),

      schedule: openWo
        .filter((wo) => wo.plannedStart)
        .sort((a, b) => Date.parse(a.plannedStart) - Date.parse(b.plannedStart))
        .slice(0, 12)
        .map((wo) => ({
          id: wo.id, woNumber: wo.woNumber, productName: wo.productName, stage: wo.stage,
          line: wo.line, plannedStart: wo.plannedStart, plannedEnd: wo.plannedEnd,
          plannedQty: wo.plannedQty, priority: wo.priority,
          customerName: db.get('customers', wo.customerId)?.name ?? '',
        })),

      throughput: Array.from({ length: 12 }, (_, i) => {
        const start = Date.now() - (11 - i) * 7 * DAY;
        const end = start + 7 * DAY;
        const batches = workOrders.filter((wo) => wo.actualEnd && Date.parse(wo.actualEnd) >= start && Date.parse(wo.actualEnd) < end);
        return {
          weekOf: new Date(start).toISOString().slice(0, 10),
          batches: batches.length,
          units: batches.reduce((s, wo) => s + (wo.actualQty || 0), 0),
        };
      }),
    });
  }));

  // ── global search ────────────────────────────────────────────────────────
  const SEARCH_TARGETS = [
    { collection: 'workOrders', label: 'Work order', fields: ['woNumber', 'batchNumber', 'productName'], title: (r) => `${r.woNumber} · ${r.productName}`, link: (r) => `/production/${r.id}` },
    { collection: 'formulas', label: 'Formula', fields: ['code', 'name', 'notes'], title: (r) => `${r.code} · ${r.name}`, link: (r) => `/formulations/${r.id}` },
    { collection: 'quotes', label: 'Quote', fields: ['quoteNumber', 'title'], title: (r) => `${r.quoteNumber} · ${r.title}`, link: (r) => `/quotes/${r.id}` },
    { collection: 'projects', label: 'Project', fields: ['code', 'name', 'brief'], title: (r) => `${r.code} · ${r.name}`, link: (r) => `/development/${r.id}` },
    { collection: 'customers', label: 'Customer', fields: ['code', 'name', 'industry'], title: (r) => r.name, link: (r) => `/customers/${r.id}` },
    { collection: 'vendors', label: 'Vendor', fields: ['code', 'name'], title: (r) => r.name, link: (r) => `/purchasing/vendors/${r.id}` },
    { collection: 'items', label: 'Item', fields: ['itemCode', 'name', 'category', 'form'], title: (r) => `${r.itemCode} · ${r.name}`, link: (r) => `/inventory/${r.id}` },
    { collection: 'lots', label: 'Lot', fields: ['lotNumber', 'vendorLot'], title: (r) => `Lot ${r.lotNumber}`, link: (r) => `/inventory/${r.itemId}?lot=${r.id}` },
    { collection: 'documents', label: 'Document', fields: ['name', 'description'], title: (r) => r.name, link: (r) => `/documents?doc=${r.id}` },
    { collection: 'labelReviews', label: 'Label review', fields: ['reviewNumber', 'productName', 'brand'], title: (r) => `${r.reviewNumber} · ${r.productName}`, link: (r) => `/labels/${r.id}` },
    { collection: 'salesOrders', label: 'Order', fields: ['orderNumber', 'customerPo'], title: (r) => r.orderNumber, link: (r) => `/orders/${r.id}` },
    { collection: 'purchaseOrders', label: 'Purchase order', fields: ['poNumber'], title: (r) => r.poNumber, link: (r) => `/purchasing/${r.id}` },
    { collection: 'users', label: 'Person', fields: ['name', 'email', 'title'], title: (r) => `${r.name} · ${r.title}`, link: () => '/admin' },
  ];

  router.get('/search', route((req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return res.json({ q, groups: [], total: 0 });
    const perGroup = num(req.query.limit, 6);

    const groups = SEARCH_TARGETS.map((target) => {
      const rows = db.find(target.collection, { $search: { value: q, fields: target.fields } }, { limit: perGroup });
      return {
        collection: target.collection,
        label: target.label,
        results: rows.map((row) => ({
          id: row.id,
          title: target.title(row),
          subtitle: row.status ?? row.stage ?? row.category ?? '',
          link: target.link(row),
          collection: target.collection,
          typeLabel: target.label,
        })),
      };
    }).filter((g) => g.results.length);

    res.json({ q, groups, total: groups.reduce((s, g) => s + g.results.length, 0) });
  }));

  // ── activity & notifications ─────────────────────────────────────────────
  router.get('/activity', route((req, res) => {
    const where = {};
    if (req.query.type) where.type = String(req.query.type);
    if (req.query.actorId) where.actorId = String(req.query.actorId);
    const rows = db.find('activity', Object.keys(where).length ? where : undefined, { sort: '-createdAt', limit: num(req.query.limit, 60) });
    res.json({ rows, total: rows.length });
  }));

  router.post('/notifications/read', route((req, res) => {
    const ids = req.body?.ids ?? db.find('notifications', { userId: req.user.id, read: false }).map((n) => n.id);
    const ctx = actorContext(req);
    let updated = 0;
    for (const id of ids) {
      const notification = db.get('notifications', id);
      if (!notification || notification.userId !== req.user.id || notification.read) continue;
      db.update('notifications', id, { read: true, readAt: new Date().toISOString() }, ctx);
      updated++;
    }
    res.json({ updated });
  }));

  // ── generic board reorder (projects, tasks) ──────────────────────────────
  router.post('/boards/:board/move', route((req, res) => {
    const board = BOARDS[req.params.board];
    if (!board) throw new HttpError(404, `Unknown board "${req.params.board}"`);
    const { id, column, beforeOrder, afterOrder } = req.body ?? {};
    if (!id) throw new HttpError(422, 'A board move needs the card id');
    if (column && !board.stages.includes(column)) throw new HttpError(422, `"${column}" is not a column on this board`);

    const record = db.getOrFail(board.collection, id);
    const patch = { boardOrder: orderBetween(beforeOrder ?? null, afterOrder ?? null) };
    if (column && column !== record[board.column]) {
      patch[board.column] = column;
      patch.stageEnteredAt = new Date().toISOString();
      if (board.collection === 'tasks') {
        patch.completedAt = column === 'done' ? new Date().toISOString() : null;
      }
      if (board.collection === 'projects') {
        patch.progress = { intake: 5, feasibility: 18, formulation: 35, sampling: 50, pilot: 68, validation: 80, scale_up: 92, launched: 100 }[column] ?? record.progress;
        // A gate guards the exit from its own stage: the checks are done while the
        // project sits in that stage, so they block moving forward, not moving in.
        const from = PROJECT_STAGES.findIndex((s) => s.value === record[board.column]);
        const to = PROJECT_STAGES.findIndex((s) => s.value === column);
        const leaving = PROJECT_STAGES[from];
        if (from >= 0 && to > from && leaving?.gate && !req.body.overrideReason) {
          const failed = (record.gateChecks ?? []).filter((g) => g.gate === leaving.value && !g.passed);
          if (failed.length) {
            throw new HttpError(409, `${failed.length} ${leaving.label} gate check${failed.length > 1 ? 's are' : ' is'} still open: ${failed.map((g) => g.label).join(', ')}. Record the gate decision, or move with a written override reason.`);
          }
        }
      }
    }
    res.json(db.update(board.collection, record.id, patch, actorContext(req)));
  }));

  return router;
}
