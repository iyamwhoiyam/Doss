/**
 * Routings — the sequence of operations a batch runs through, each on a work
 * center (a production line) with a setup time, a run rate and a crew. A work
 * order copies its routing into batch steps at planning time, so the standard
 * labor is frozen the same way the standard material cost is, and the floor
 * clocks actual time against each step.
 */

const MINUTES_PER_HOUR = 60;
const round = (n, dp = 2) => Number((Number(n) || 0).toFixed(dp));

/** Planned minutes for one operation at a batch size. */
export function plannedMinutes(op, qty) {
  const setup = Number(op.setupMin) || 0;
  const rate = Number(op.runRatePerHour) || 0;
  const run = rate > 0 ? ((Number(qty) || 0) / rate) * MINUTES_PER_HOUR : Number(op.runMin) || 0;
  return round(setup + run, 1);
}

/** Labor cost for a span of minutes on an operation: crew × rate × hours. */
export function laborCost(op, minutes) {
  const crew = Number(op.crew) || 1;
  const rate = Number(op.laborRate) || 0;
  return round(((Number(minutes) || 0) / MINUTES_PER_HOUR) * rate * crew, 2);
}

/** Turn a routing into the batch steps a new work order starts with. */
export function routingSteps(routing, qty) {
  return [...(routing.operations ?? [])]
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    .map((op, i) => {
      const planned = plannedMinutes(op, qty);
      return {
        seq: op.seq ?? i + 1,
        name: op.name,
        workCenter: op.workCenter ?? '',
        setupMin: Number(op.setupMin) || 0,
        runRatePerHour: Number(op.runRatePerHour) || 0,
        crew: Number(op.crew) || 1,
        laborRate: Number(op.laborRate) || 0,
        plannedMin: planned,
        standardLaborCost: laborCost(op, planned),
        requiresSignature: Boolean(op.requiresSignature),
        done: false, doneBy: '', doneAt: null, notes: '',
        timeEntries: [], actualMin: 0, actualLaborCost: 0,
      };
    });
}

/** Sum a work order's steps into the labor figures the costing shows. */
export function laborRollup(steps = []) {
  const sum = (key) => round(steps.reduce((s, st) => s + (Number(st[key]) || 0), 0), 2);
  return {
    standardLaborMin: sum('plannedMin'),
    standardLaborCost: sum('standardLaborCost'),
    actualLaborMin: sum('actualMin'),
    actualLaborCost: sum('actualLaborCost'),
  };
}

/** Recompute one step's actuals from its time entries. */
export function settleStep(step) {
  const minutes = round((step.timeEntries ?? []).reduce((s, e) => s + (Number(e.minutes) || 0), 0), 1);
  return { ...step, actualMin: minutes, actualLaborCost: laborCost(step, minutes) };
}

/** Working days a batch needs, from its steps' planned minutes and the shift length. */
export function plannedDurationDays(steps = [], hoursPerShift = 8) {
  const minutes = steps.reduce((s, st) => s + (Number(st.plannedMin) || 0), 0);
  if (!minutes) return 1;
  return Math.max(1, Math.ceil(minutes / ((Number(hoursPerShift) || 8) * MINUTES_PER_HOUR)));
}

/** Add working days (Mon–Fri) to a date, returning the last day of the run. */
export function addWorkingDays(startIso, days) {
  const d = new Date(startIso);
  let remaining = Math.max(1, days) - 1;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return d.toISOString();
}

/** The routing a formula runs on: its own, else the default for its format. */
export function pickRouting(db, formula) {
  if (formula?.routingId) {
    const own = db.get('routings', formula.routingId);
    if (own) return own;
  }
  return db.findOne('routings', { format: formula?.format, isDefault: true })
    ?? db.findOne('routings', { format: formula?.format })
    ?? null;
}

const op = (name, workCenter, setupMin, runRatePerHour, crew, laborRate = 28, extra = {}) => ({
  name, workCenter, setupMin, runRatePerHour, crew, laborRate,
  requiresSignature: /sampl|uniformity|verif|check|integrity|hardness/i.test(name),
  ...extra,
});

/**
 * Enova's standard routings, one per dosage format. Seeded on a fresh install and
 * available to add from the Routings page after a reset. Rates are per hour of
 * finished units; blending and dispensing steps are sized to a batch rather
 * than a unit, so they carry a setup time and no run rate.
 */
export const STANDARD_ROUTINGS = [
  {
    code: 'RT-GUMMY', name: 'Gummy — deposit, cure, coat, bottle', format: 'gummy', isDefault: true, hoursPerShift: 8,
    operations: [
      op('Sanitation verification', 'Gummy Line 1', 45, 0, 2),
      op('Slurry preparation', 'Gummy Line 1', 60, 0, 2, 30),
      op('Active dispersion', 'Gummy Line 1', 30, 0, 1, 30),
      op('Depositing', 'Gummy Line 1', 30, 9000, 3),
      op('Curing (24h)', 'Gummy Line 1', 0, 0, 0, 0, { runMin: 1440 }),
      op('De-moulding', 'Gummy Line 1', 15, 12000, 2),
      op('Wax coating', 'Gummy Line 1', 20, 15000, 1),
      op('Bulk sampling', 'Gummy Line 1', 15, 0, 1, 32),
      op('Bottling', 'Gummy Line 1', 45, 2400, 3),
      op('Labelling', 'Gummy Line 1', 30, 3000, 2),
      op('Case packing', 'Gummy Line 1', 10, 4000, 1),
    ],
  },
  {
    code: 'RT-CAPSULE', name: 'Capsule — blend, encapsulate, polish, bottle', format: 'capsule', isDefault: true, hoursPerShift: 8,
    operations: [
      op('Sanitation verification', 'Encapsulation 1', 45, 0, 2),
      op('Dispensing / weighing', 'Blending', 60, 0, 2),
      op('Blending (V-blender 20 min)', 'Blending', 40, 0, 1),
      op('Blend uniformity sample', 'Blending', 15, 0, 1, 32),
      op('Encapsulation', 'Encapsulation 1', 60, 60000, 2),
      op('Weight check (every 30 min)', 'Encapsulation 1', 0, 0, 1, 28, { runMin: 30 }),
      op('Polishing / sorting', 'Encapsulation 1', 15, 90000, 1),
      op('Bulk sampling', 'Encapsulation 1', 15, 0, 1, 32),
      op('Bottling', 'Encapsulation 1', 45, 2400, 3),
      op('Induction sealing', 'Encapsulation 1', 15, 3000, 1),
      op('Labelling', 'Encapsulation 1', 30, 3000, 2),
      op('Case packing', 'Encapsulation 1', 10, 4000, 1),
    ],
  },
  {
    code: 'RT-TABLET', name: 'Tablet — blend, compress, coat, bottle', format: 'tablet', isDefault: true, hoursPerShift: 8,
    operations: [
      op('Sanitation verification', 'Tablet Press', 45, 0, 2),
      op('Dispensing / weighing', 'Blending', 60, 0, 2),
      op('Blending', 'Blending', 40, 0, 1),
      op('Compression', 'Tablet Press', 90, 45000, 2),
      op('Hardness / friability check', 'Tablet Press', 0, 0, 1, 28, { runMin: 30 }),
      op('Coating', 'Tablet Press', 60, 30000, 2),
      op('Bulk sampling', 'Tablet Press', 15, 0, 1, 32),
      op('Bottling', 'Tablet Press', 45, 2400, 3),
      op('Labelling', 'Tablet Press', 30, 3000, 2),
      op('Case packing', 'Tablet Press', 10, 4000, 1),
    ],
  },
  {
    code: 'RT-STICK', name: 'Stick pack — blend, fill, seal', format: 'stick_pack', isDefault: true, hoursPerShift: 8,
    operations: [
      op('Sanitation verification', 'Sachet / Stick Pack', 45, 0, 2),
      op('Dispensing / weighing', 'Blending', 60, 0, 2),
      op('Blending', 'Blending', 40, 0, 1),
      op('Blend uniformity sample', 'Blending', 15, 0, 1, 32),
      op('Stick pack filling', 'Sachet / Stick Pack', 60, 4800, 2),
      op('Seal integrity check', 'Sachet / Stick Pack', 0, 0, 1, 28, { runMin: 20 }),
      op('Case packing', 'Sachet / Stick Pack', 10, 6000, 1),
    ],
  },
  {
    code: 'RT-SACHET', name: 'Sachet — blend, fill, seal', format: 'sachet', isDefault: true, hoursPerShift: 8,
    operations: [
      op('Sanitation verification', 'Sachet / Stick Pack', 45, 0, 2),
      op('Dispensing / weighing', 'Blending', 60, 0, 2),
      op('Blending', 'Blending', 40, 0, 1),
      op('Blend uniformity sample', 'Blending', 15, 0, 1, 32),
      op('Sachet filling', 'Sachet / Stick Pack', 60, 3600, 2),
      op('Seal integrity check', 'Sachet / Stick Pack', 0, 0, 1, 28, { runMin: 20 }),
      op('Case packing', 'Sachet / Stick Pack', 10, 6000, 1),
    ],
  },
  {
    code: 'RT-POWDER', name: 'Powder — blend, bulk pack', format: 'powder', isDefault: true, hoursPerShift: 8,
    operations: [
      op('Sanitation verification', 'Blending', 45, 0, 2),
      op('Dispensing / weighing', 'Blending', 60, 0, 2),
      op('Blending', 'Blending', 40, 0, 1),
      op('Blend uniformity sample', 'Blending', 15, 0, 1, 32),
      op('Bulk packaging', 'Blending', 30, 1200, 2),
      op('Case packing', 'Blending', 10, 4000, 1),
    ],
  },
  {
    code: 'RT-SOFTGEL', name: 'Softgel — encapsulate, dry, bottle', format: 'softgel', isDefault: true, hoursPerShift: 8,
    operations: [
      op('Sanitation verification', 'Encapsulation 2', 45, 0, 2),
      op('Fill preparation', 'Encapsulation 2', 60, 0, 2, 30),
      op('Encapsulation', 'Encapsulation 2', 90, 40000, 2),
      op('Drying (tumble)', 'Encapsulation 2', 0, 0, 0, 0, { runMin: 720 }),
      op('Inspection / sorting', 'Encapsulation 2', 15, 60000, 2),
      op('Bulk sampling', 'Encapsulation 2', 15, 0, 1, 32),
      op('Bottling', 'Encapsulation 2', 45, 2400, 3),
      op('Labelling', 'Encapsulation 2', 30, 3000, 2),
      op('Case packing', 'Encapsulation 2', 10, 4000, 1),
    ],
  },
  {
    code: 'RT-TINCTURE', name: 'Tincture — compound, fill, cap', format: 'tincture', isDefault: true, hoursPerShift: 8,
    operations: [
      op('Sanitation verification', 'Tincture', 45, 0, 2),
      op('Compounding', 'Tincture', 60, 0, 2, 30),
      op('Filtration', 'Tincture', 20, 0, 1),
      op('Bulk sampling', 'Tincture', 15, 0, 1, 32),
      op('Filling', 'Tincture', 30, 1800, 2),
      op('Capping / dropper insertion', 'Tincture', 15, 1800, 2),
      op('Labelling', 'Tincture', 30, 2400, 2),
      op('Case packing', 'Tincture', 10, 4000, 1),
    ],
  },
].map((r) => ({
  ...r,
  // Bottling, sealing, labelling and case packing only happen for packaged product;
  // a bulk quote (gummies and capsules only) leaves them out.
  operations: r.operations.map((o, i) => ({ seq: i + 1, packaging: /bottling|induction|labelling|case packing/i.test(o.name), ...o })),
}));

/** Insert any standard routing whose code is missing; returns what was added. */
export function ensureStandardRoutings(db, ctx) {
  const added = [];
  for (const routing of STANDARD_ROUTINGS) {
    if (db.findOne('routings', { code: routing.code })) continue;
    added.push(db.insert('routings', { ...routing, notes: '', tags: [] }, ctx));
  }
  return added;
}

/**
 * Real labour for a quote tier: the formula's routing run at that quantity,
 * minutes × crew × rate per operation. Bulk product skips the packaging
 * operations. Returns null when the format has no routing yet.
 */
export function routingLabour(db, formula, qty, { bulk = false } = {}) {
  const routing = pickRouting(db, formula);
  if (!routing) return null;
  const ops = (routing.operations ?? []).filter((op) => !(bulk && (op.packaging || /bottling|induction|labelling|case packing/i.test(op.name))));
  const units = Math.max(1, Number(qty) || 1);
  const lines = ops.map((op) => {
    const minutes = plannedMinutes(op, units);
    const cost = laborCost(op, minutes);
    return {
      label: op.name, workCenter: op.workCenter ?? '', minutes, crew: Number(op.crew) || 0, rate: Number(op.laborRate) || 0,
      costPerBatch: cost, perUnit: Number((cost / units).toFixed(6)),
    };
  });
  const totalPerBatch = Number(lines.reduce((s, l) => s + l.costPerBatch, 0).toFixed(2));
  return {
    source: 'routing', routingId: routing.id, routingCode: routing.code, qty: units,
    lines, totalPerBatch, perUnit: Number((totalPerBatch / units).toFixed(6)),
    minutes: Number(lines.reduce((s, l) => s + l.minutes, 0).toFixed(1)),
  };
}

/** What labour has really cost on finished batches of this formula (per unit). */
export function actualLabour(db, formula) {
  const done = db.find('workOrders', { formulaId: formula.id })
    .filter((wo) => wo.stage === 'complete' && (wo.actualLaborCost || 0) > 0 && (wo.actualQty || 0) > 0)
    .sort((a, b) => String(b.actualEnd ?? '').localeCompare(String(a.actualEnd ?? '')))
    .slice(0, 10);
  if (!done.length) return null;
  const units = done.reduce((s, wo) => s + wo.actualQty, 0);
  const cost = done.reduce((s, wo) => s + wo.actualLaborCost, 0);
  return {
    source: 'actual', batches: done.length, units, cost: Number(cost.toFixed(2)),
    perUnit: Number((cost / units).toFixed(6)),
    minutesPerUnit: Number((done.reduce((s, wo) => s + (wo.actualLaborMin || 0), 0) / units).toFixed(4)),
    lastBatch: done[0].woNumber,
  };
}
