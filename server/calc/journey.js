/**
 * The product journey — where a product is on Enova's path from a customer's
 * request to a shipped order, and what the next hand-off is.
 *
 *   request → project → formula → quote → approval → order → batch → QA → shipment
 *
 * Every step reports the record behind it, a status, and (where one applies)
 * the action that moves it forward. The project page draws this as a stepper;
 * the dashboard rolls the same logic up across all products.
 *
 * Statuses: done · current (in progress) · todo (nothing yet) · blocked
 * (needs attention before it can move) · skipped (not needed for this product).
 */

const latest = (rows, key = 'createdAt') => [...rows].sort((a, b) => String(b[key] ?? '').localeCompare(String(a[key] ?? '')))[0] ?? null;

export function productJourney(db, project) {
  const formula = (project.formulaId && db.get('formulas', project.formulaId))
    || db.find('formulas', { projectId: project.id })[0]
    || null;
  const rfq = db.find('rfqs', { projectId: project.id })[0] ?? null;
  const quotes = db.find('quotes', { projectId: project.id })
    .concat(formula ? db.find('quotes', { formulaId: formula.id }).filter((q) => q.projectId !== project.id) : []);
  const quote = latest(quotes.filter((q) => q.status !== 'declined' && q.status !== 'expired')) ?? latest(quotes);
  const quoteIds = new Set(quotes.map((q) => q.id));
  const orders = db.find('salesOrders').filter((so) => so.projectId === project.id || quoteIds.has(so.quoteId));
  const order = latest(orders);
  const orderIds = new Set(orders.map((so) => so.id));
  const workOrders = db.find('workOrders').filter((wo) => (wo.projectId === project.id || (formula && wo.formulaId === formula.id)) && wo.stage !== 'cancelled');
  const wo = latest(workOrders);
  const shipments = db.find('shipments').filter((sh) => orderIds.has(sh.salesOrderId));
  const shipment = latest(shipments);
  const lock = project.lockState ?? 'open';

  const step = (key, label, status, extra = {}) => ({ key, label, status, ...extra });
  const rec = (type, id, label, link) => ({ type, id, label, link });
  const act = (label, kind, to = null) => ({ label, kind, to });

  const steps = [];

  // 1. Request
  steps.push(rfq
    ? step('request', 'Request', 'done', { record: rec('rfq', rfq.id, rfq.rfqNumber, '/rfqs'), detail: `${rfq.status} · ${rfq.customerName || ''}`.trim() })
    : step('request', 'Request', 'skipped', { detail: 'Started internally' }));

  // 2. Project
  steps.push(step('project', 'Project', project.stage === 'launched' ? 'done' : ['on_hold', 'cancelled'].includes(project.stage) ? 'blocked' : 'current', {
    record: rec('project', project.id, project.code, `/development/${project.id}`),
    detail: project.stage.replace(/_/g, ' '),
  }));

  // 3. Formula
  if (!formula) {
    steps.push(step('formula', 'Formula', 'todo', {
      detail: 'No formula yet',
      action: act('Create the formula', 'link', `/formulations/new?projectId=${project.id}${project.customerId ? `&customerId=${project.customerId}` : ''}&name=${encodeURIComponent(project.name)}`),
    }));
  } else {
    const approved = formula.status === 'approved';
    steps.push(step('formula', 'Formula', approved ? 'done' : formula.status === 'retired' ? 'blocked' : 'current', {
      record: rec('formula', formula.id, formula.code, `/formulations/${formula.id}`),
      detail: `${formula.status.replace(/_/g, ' ')} · rev ${formula.revision ?? 1}`,
      action: approved ? null : act('Finish and approve the formula', 'link', `/formulations/${formula.id}`),
    }));
  }

  // 4. Quote
  if (!quote) {
    steps.push(step('quote', 'Quote', 'todo', {
      detail: formula ? 'Not priced yet' : 'Needs a formula first',
      action: formula ? act('Build the quote', 'link', `/quotes/new?formulaId=${formula.id}&projectId=${project.id}`) : null,
    }));
  } else {
    const map = { draft: ['current', 'Send the quote to the customer'], revised: ['current', 'Send the revised quote'], sent: ['current', 'Awaiting the customer\'s decision'], accepted: ['done', null], declined: ['blocked', 'Revise the quote'], expired: ['blocked', 'Refresh the expired quote'] };
    const [status, label] = map[quote.status] ?? ['current', null];
    steps.push(step('quote', 'Quote', status, {
      record: rec('quote', quote.id, quote.quoteNumber, `/quotes/${quote.id}`),
      detail: quote.status,
      action: label ? act(label, 'link', `/quotes/${quote.id}`) : null,
    }));
  }

  // 5. Customer approval of the full product package
  steps.push(step('approval', 'Customer approval', lock === 'locked' ? 'done' : lock === 'pending_approval' ? 'current' : 'todo', {
    detail: lock === 'locked' ? `Locked · rev ${project.productRevision ?? 1}` : lock === 'pending_approval' ? 'Awaiting signature' : 'Not requested',
    action: lock === 'locked' ? null : lock === 'pending_approval' ? act('Awaiting the customer\'s signature', 'approval') : act('Request customer approval', 'approval'),
  }));

  // 6. Order
  if (!order) {
    steps.push(step('order', 'Order', 'todo', {
      detail: quote?.status === 'accepted' ? 'Quote accepted, no order yet' : 'Needs an accepted quote',
      action: quote?.status === 'accepted' ? act('Create the order from the quote', 'link', `/quotes/${quote.id}`) : null,
    }));
  } else {
    const done = ['shipped', 'invoiced', 'closed'].includes(order.status);
    steps.push(step('order', 'Order', done ? 'done' : order.status === 'cancelled' ? 'blocked' : 'current', {
      record: rec('order', order.id, order.orderNumber, `/orders/${order.id}`),
      detail: order.status.replace(/_/g, ' '),
      action: order.status === 'draft' ? act('Confirm the order', 'link', `/orders/${order.id}`) : null,
    }));
  }

  // 7. Batch
  if (!wo) {
    steps.push(step('batch', 'Batch', 'todo', {
      detail: formula ? 'No batch planned' : 'Needs a formula',
      action: formula ? act('Start a batch', 'batch') : null,
    }));
  } else {
    const done = wo.stage === 'complete';
    steps.push(step('batch', 'Batch', done ? 'done' : wo.stage === 'qc_hold' ? 'blocked' : 'current', {
      record: rec('workOrder', wo.id, wo.woNumber, `/production/${wo.id}`),
      detail: `${wo.stage.replace(/_/g, ' ')}${workOrders.length > 1 ? ` · ${workOrders.length} batches` : ''}`,
      action: done ? null : act(wo.stage === 'qc_hold' ? 'Resolve the QC hold' : 'Open the batch record', 'link', `/production/${wo.id}`),
    }));
  }

  // 8. QA release
  const released = workOrders.some((w) => w.stage === 'complete');
  const inReview = workOrders.find((w) => w.stage === 'qa_review');
  const held = workOrders.find((w) => w.stage === 'qc_hold');
  steps.push(step('qa', 'QA release', released ? 'done' : held ? 'blocked' : inReview ? 'current' : 'todo', {
    record: (inReview || held) ? rec('workOrder', (inReview || held).id, (inReview || held).woNumber, `/production/${(inReview || held).id}`) : null,
    detail: released ? `${workOrders.filter((w) => w.stage === 'complete').length} released` : held ? 'On QC hold' : inReview ? 'In QA review' : 'Waiting on a batch',
    action: held ? act('Resolve the QC hold', 'link', `/production/${held.id}`) : inReview ? act('Release the batch', 'link', `/production/${inReview.id}`) : null,
  }));

  // 9. Shipment
  if (!shipment) {
    steps.push(step('shipment', 'Shipment', 'todo', {
      detail: order ? (released ? 'Ready to ship' : 'Waiting on QA release') : 'Needs an order',
      action: order && released ? act('Ship the order', 'link', `/orders/${order.id}`) : null,
    }));
  } else {
    steps.push(step('shipment', 'Shipment', shipment.status === 'delivered' ? 'done' : shipment.status === 'exception' ? 'blocked' : 'current', {
      record: rec('shipment', shipment.id, shipment.shipmentNumber, `/orders/${shipment.salesOrderId}`),
      detail: `${shipment.status.replace(/_/g, ' ')}${shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ''}`,
    }));
  }

  // The headline: the first thing that is not finished and has something to do.
  const next = steps.find((s) => s.status === 'blocked' && s.action)
    ?? steps.find((s) => s.status === 'current' && s.action)
    ?? steps.find((s) => s.status === 'todo' && s.action)
    ?? null;
  const done = steps.filter((s) => s.status === 'done').length;
  const counted = steps.filter((s) => s.status !== 'skipped').length;

  return {
    steps,
    next: next ? { key: next.key, label: next.label, ...next.action } : null,
    progress: counted ? Math.round((done / counted) * 100) : 0,
  };
}

/** Counts for the dashboard's flow strip — how much work sits at each hand-off. */
export function flowCounts(db) {
  const rfqs = db.all('rfqs');
  const projects = db.all('projects');
  const quotes = db.all('quotes');
  const orders = db.all('salesOrders');
  const wos = db.all('workOrders');
  const shipments = db.all('shipments');
  return [
    { key: 'requests', label: 'Requests', count: rfqs.filter((r) => !['won', 'lost'].includes(r.status)).length, hint: 'open quote requests', link: '/rfqs', tone: 'info' },
    { key: 'projects', label: 'Projects', count: projects.filter((p) => !['launched', 'cancelled'].includes(p.stage)).length, hint: 'in development', link: '/development', tone: 'accent' },
    { key: 'quotes', label: 'Quotes', count: quotes.filter((q) => ['draft', 'sent', 'revised'].includes(q.status)).length, hint: 'awaiting a decision', link: '/quotes', tone: 'info' },
    { key: 'approvals', label: 'Approvals', count: projects.filter((p) => p.lockState === 'pending_approval').length, hint: 'waiting on a customer', link: '/development?lock=pending_approval', tone: 'warning' },
    { key: 'orders', label: 'Orders', count: orders.filter((so) => !['shipped', 'invoiced', 'closed', 'cancelled'].includes(so.status)).length, hint: 'open', link: '/orders', tone: 'accent' },
    { key: 'batches', label: 'Batches', count: wos.filter((wo) => !['complete', 'cancelled', 'qa_review', 'qc_hold'].includes(wo.stage)).length, hint: 'planned or running', link: '/production', tone: 'progress' },
    { key: 'qa', label: 'QA', count: wos.filter((wo) => ['qa_review', 'qc_hold'].includes(wo.stage)).length, hint: 'in review or held', link: '/production', tone: wos.some((wo) => wo.stage === 'qc_hold') ? 'danger' : 'warning' },
    { key: 'shipments', label: 'Shipments', count: shipments.filter((sh) => !['delivered'].includes(sh.status)).length, hint: 'packing or in transit', link: '/orders', tone: 'success' },
  ];
}
