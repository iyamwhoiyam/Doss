/**
 * Bulk data import from spreadsheets.
 *
 * The team keeps its real data — the staff roster, customers, vendors, the
 * ingredient price list, storage locations — in spreadsheets. This turns a
 * "Save As CSV" of one of those into records: download a template for the data
 * type, fill it, upload it, see exactly what will be created or updated, then
 * commit. Rows are matched to existing records by a natural key (email, code,
 * item code), so re-importing a corrected sheet updates in place rather than
 * duplicating.
 */

import { Router } from 'express';
import multer from 'multer';

import {
  ROLE_KEYS, ITEM_TYPES, CUSTOMER_STATUS, VENDOR_STATUS, UOMS, enumValues,
} from '../../shared/domain.js';
import { hashPassword, actorContext, requirePermission, HttpError } from '../lib/auth.js';
import { route } from '../lib/http.js';
import { logActivity } from '../lib/events.js';
import { parseCsv, toCsv } from '../lib/csv.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

// ── small typed cell readers ────────────────────────────────────────────────
const clean = (v) => (v == null ? '' : String(v).trim());
const numOr = (v, fallback = 0) => {
  if (clean(v) === '') return fallback;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};
const boolOf = (v) => /^(y|yes|true|1|x)$/i.test(clean(v));
const listOf = (v) => clean(v).split(/[;,]/).map((s) => s.trim()).filter(Boolean);
const enumOf = (v, allowed, fallback) => {
  const s = clean(v).toLowerCase().replace(/\s+/g, '_');
  if (s === '') return fallback;
  return allowed.includes(s) ? s : undefined;
};
const initialsOf = (name) => name.replace(/^Dr\.\s+/, '').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

const ITEM_TYPE_KEYS = enumValues(ITEM_TYPES);
const CUSTOMER_STATUS_KEYS = enumValues(CUSTOMER_STATUS);
const VENDOR_STATUS_KEYS = enumValues(VENDOR_STATUS);

/**
 * One spec per importable data type. `columns` drive the template and the UI;
 * `build` turns a parsed CSV row into a record patch plus a list of problems.
 * `onCreate` adds fields that only make sense for a brand-new record.
 */
const SPECS = {
  users: {
    label: 'Staff',
    collection: 'users',
    key: 'email',
    keyHeader: 'Email',
    blurb: 'Your people. New accounts get the temporary password "enova2026" and are asked to set their own at first sign-in.',
    columns: [
      { header: 'Name', field: 'name', required: true },
      { header: 'Email', field: 'email', required: true },
      { header: 'Role', field: 'role', required: true, note: `one of: ${ROLE_KEYS.join(', ')}` },
      { header: 'Title', field: 'title' },
      { header: 'Department', field: 'department' },
      { header: 'Phone', field: 'phone' },
    ],
    example: { Name: 'Jordan Bradfield', Email: 'jbradfield@enovascience.com', Role: 'admin', Title: 'Operations Lead', Department: 'Operations', Phone: '555-0100' },
    build(row) {
      const errors = [];
      const name = clean(row.Name);
      const email = clean(row.Email).toLowerCase();
      const role = enumOf(row.Role, ROLE_KEYS, undefined);
      if (!name) errors.push('Name is required');
      if (!email) errors.push('Email is required');
      else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push(`"${email}" is not a valid email`);
      if (!clean(row.Role)) errors.push('Role is required');
      else if (!role) errors.push(`Role "${clean(row.Role)}" is not one of ${ROLE_KEYS.join(', ')}`);
      return {
        errors,
        key: email,
        record: {
          name, email, role,
          title: clean(row.Title),
          department: clean(row.Department),
          phone: clean(row.Phone),
          initials: initialsOf(name) || '—',
        },
      };
    },
    onCreate: (rec) => ({
      ...rec,
      active: true,
      mustChangePassword: true,
      accentColor: '#2FBF9B',
      preferences: { theme: 'dark', density: 'comfortable' },
      ...hashPassword('enova2026'),
    }),
  },

  customers: {
    label: 'Customers',
    collection: 'customers',
    key: 'code',
    keyHeader: 'Code',
    blurb: 'Your accounts. Contacts and addresses can be added per-customer in the app after import.',
    columns: [
      { header: 'Code', field: 'code', required: true, note: 'your short account code, e.g. ACME' },
      { header: 'Name', field: 'name', required: true },
      { header: 'Status', field: 'status', note: `one of: ${CUSTOMER_STATUS_KEYS.join(', ')} (default active)` },
      { header: 'Tier', field: 'tier' },
      { header: 'Industry', field: 'industry' },
      { header: 'Website', field: 'website' },
      { header: 'Payment Terms', field: 'paymentTerms' },
      { header: 'Notes', field: 'notes' },
    ],
    example: { Code: 'ACME', Name: 'Acme Wellness', Status: 'active', Tier: 'standard', Industry: 'Sports nutrition', Website: 'acme.com', 'Payment Terms': 'Net 30', Notes: '' },
    build(row) {
      const errors = [];
      const code = clean(row.Code).toUpperCase();
      const name = clean(row.Name);
      const status = enumOf(row.Status, CUSTOMER_STATUS_KEYS, 'active');
      if (!code) errors.push('Code is required');
      if (!name) errors.push('Name is required');
      if (status === undefined) errors.push(`Status "${clean(row.Status)}" is not one of ${CUSTOMER_STATUS_KEYS.join(', ')}`);
      return {
        errors, key: code,
        record: {
          code, name, status,
          tier: clean(row.Tier), industry: clean(row.Industry), website: clean(row.Website),
          paymentTerms: clean(row['Payment Terms']), notes: clean(row.Notes),
        },
      };
    },
    onCreate: (rec) => ({ ...rec, contacts: [], tags: [] }),
  },

  vendors: {
    label: 'Vendors',
    collection: 'vendors',
    key: 'code',
    keyHeader: 'Code',
    blurb: 'Your suppliers. Qualification and scorecards build up from purchase orders after import.',
    columns: [
      { header: 'Code', field: 'code', required: true },
      { header: 'Name', field: 'name', required: true },
      { header: 'Status', field: 'status', note: `one of: ${VENDOR_STATUS_KEYS.join(', ')} (default pending)` },
      { header: 'Category', field: 'category' },
      { header: 'Lead Time Days', field: 'leadTimeDays' },
      { header: 'Payment Terms', field: 'paymentTerms' },
      { header: 'Minimum Order', field: 'minimumOrder' },
      { header: 'Website', field: 'website' },
      { header: 'Notes', field: 'notes' },
    ],
    example: { Code: 'NUTRA', Name: 'NutraSource Ingredients', Status: 'approved', Category: 'Actives', 'Lead Time Days': '21', 'Payment Terms': 'Net 45', 'Minimum Order': '500', Website: 'nutrasource.com', Notes: '' },
    build(row) {
      const errors = [];
      const code = clean(row.Code).toUpperCase();
      const name = clean(row.Name);
      const status = enumOf(row.Status, VENDOR_STATUS_KEYS, 'pending');
      const leadTimeDays = numOr(row['Lead Time Days'], 0);
      const minimumOrder = numOr(row['Minimum Order'], 0);
      if (!code) errors.push('Code is required');
      if (!name) errors.push('Name is required');
      if (status === undefined) errors.push(`Status "${clean(row.Status)}" is not one of ${VENDOR_STATUS_KEYS.join(', ')}`);
      if (Number.isNaN(leadTimeDays)) errors.push('Lead Time Days must be a number');
      if (Number.isNaN(minimumOrder)) errors.push('Minimum Order must be a number');
      return {
        errors, key: code,
        record: {
          code, name, status,
          category: clean(row.Category), leadTimeDays, minimumOrder,
          paymentTerms: clean(row['Payment Terms']), website: clean(row.Website), notes: clean(row.Notes),
        },
      };
    },
    onCreate: (rec) => ({ ...rec, contacts: [], qualification: { status: rec.status }, rating: 0, tags: [] }),
  },

  items: {
    label: 'Ingredients & materials',
    collection: 'items',
    key: 'itemCode',
    keyHeader: 'Item Code',
    blurb: 'Your price list — actives, excipients and packaging. Use type raw_material for anything that goes into a formula and packaging for containers, caps and cartons.',
    columns: [
      { header: 'Item Code', field: 'itemCode', required: true },
      { header: 'Name', field: 'name', required: true },
      { header: 'Type', field: 'type', note: `one of: ${ITEM_TYPE_KEYS.join(', ')} (default raw_material)` },
      { header: 'Category', field: 'category' },
      { header: 'UOM', field: 'uom', note: `one of: ${enumValues(UOMS).join(', ')} (default kg)` },
      { header: 'Cost per UOM', field: 'costPerUom' },
      { header: 'Price per kg', field: 'pricePerKg' },
      { header: 'Reorder Point', field: 'reorderPoint' },
      { header: 'Lead Time Days', field: 'leadTimeDays' },
      { header: 'Requires COA', field: 'requiresCoa', note: 'yes/no' },
      { header: 'Allergens', field: 'allergens', note: 'comma-separated' },
      { header: 'Is Branded', field: 'isBranded', note: 'yes/no' },
      { header: 'Brand Owner', field: 'brandOwner' },
      { header: 'Label Name', field: 'labelName' },
      { header: 'Notes', field: 'notes' },
    ],
    example: { 'Item Code': 'ALT-RP-1001', Name: 'Ascorbic Acid (Vitamin C)', Type: 'raw_material', Category: 'Vitamin', UOM: 'kg', 'Cost per UOM': '12.50', 'Price per kg': '12.50', 'Reorder Point': '50', 'Lead Time Days': '21', 'Requires COA': 'yes', Allergens: '', 'Is Branded': 'no', 'Brand Owner': '', 'Label Name': 'Vitamin C (as ascorbic acid)', Notes: '' },
    build(row) {
      const errors = [];
      const itemCode = clean(row['Item Code']).toUpperCase();
      const name = clean(row.Name);
      const type = enumOf(row.Type, ITEM_TYPE_KEYS, 'raw_material');
      const uom = enumOf(row.UOM, enumValues(UOMS), 'kg');
      const costPerUom = numOr(row['Cost per UOM'], 0);
      const pricePerKg = numOr(row['Price per kg'], 0);
      const reorderPoint = numOr(row['Reorder Point'], 0);
      const leadTimeDays = numOr(row['Lead Time Days'], 0);
      if (!itemCode) errors.push('Item Code is required');
      if (!name) errors.push('Name is required');
      if (type === undefined) errors.push(`Type "${clean(row.Type)}" is not one of ${ITEM_TYPE_KEYS.join(', ')}`);
      if (uom === undefined) errors.push(`UOM "${clean(row.UOM)}" is not one of ${enumValues(UOMS).join(', ')}`);
      for (const [label, val] of [['Cost per UOM', costPerUom], ['Price per kg', pricePerKg], ['Reorder Point', reorderPoint], ['Lead Time Days', leadTimeDays]]) {
        if (Number.isNaN(val)) errors.push(`${label} must be a number`);
      }
      return {
        errors, key: itemCode,
        record: {
          itemCode, name, type, uom,
          category: clean(row.Category),
          costPerUom, pricePerKg,
          priceSource: pricePerKg || costPerUom ? 'price list' : '',
          reorderPoint, leadTimeDays,
          requiresCoa: boolOf(row['Requires COA']),
          allergens: listOf(row.Allergens),
          isBranded: boolOf(row['Is Branded']),
          brandOwner: clean(row['Brand Owner']),
          labelName: clean(row['Label Name']) || name,
          notes: clean(row.Notes),
        },
      };
    },
    onCreate: (rec) => ({ ...rec, active: true, tags: [] }),
  },

  locations: {
    label: 'Storage locations',
    collection: 'locations',
    key: 'code',
    keyHeader: 'Code',
    blurb: 'Warehouse, racks, bins, cold storage, quarantine — wherever inventory lives.',
    columns: [
      { header: 'Code', field: 'code', required: true },
      { header: 'Name', field: 'name', required: true },
      { header: 'Type', field: 'type', note: 'warehouse, rack, bin, cold, quarantine, production, shipping (default warehouse)' },
      { header: 'Temperature Controlled', field: 'temperatureControlled', note: 'yes/no' },
      { header: 'Capacity', field: 'capacity' },
      { header: 'Notes', field: 'notes' },
    ],
    example: { Code: 'WH-A1', Name: 'Warehouse A — Rack 1', Type: 'rack', 'Temperature Controlled': 'no', Capacity: '', Notes: '' },
    build(row) {
      const errors = [];
      const LOC_TYPES = ['warehouse', 'rack', 'bin', 'cold', 'quarantine', 'production', 'shipping'];
      const code = clean(row.Code).toUpperCase();
      const name = clean(row.Name);
      const type = enumOf(row.Type, LOC_TYPES, 'warehouse');
      if (!code) errors.push('Code is required');
      if (!name) errors.push('Name is required');
      if (type === undefined) errors.push(`Type "${clean(row.Type)}" is not one of ${LOC_TYPES.join(', ')}`);
      return {
        errors, key: code,
        record: {
          code, name, type,
          temperatureControlled: boolOf(row['Temperature Controlled']),
          capacity: clean(row.Capacity),
          notes: clean(row.Notes),
        },
      };
    },
    onCreate: (rec) => ({ ...rec, active: true }),
  },
};

function specOrFail(type) {
  const spec = SPECS[type];
  if (!spec) throw new HttpError(404, `"${type}" is not an importable data type`);
  return spec;
}

export function importsRouter(db) {
  const router = Router();
  router.use(requirePermission('settings.manage'));

  /** The importable types and their columns — drives the UI. */
  router.get('/', route((_req, res) => {
    res.json({
      types: Object.entries(SPECS).map(([type, spec]) => ({
        type, label: spec.label, collection: spec.collection, keyHeader: spec.keyHeader,
        blurb: spec.blurb, columns: spec.columns,
      })),
    });
  }));

  /** A ready-to-fill CSV: the headers plus one example row. */
  router.get('/:type/template', route((req, res) => {
    const spec = specOrFail(req.params.type);
    const headers = spec.columns.map((c) => c.header);
    const csv = toCsv(headers, [spec.example]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="enova-${req.params.type}-template.csv"`);
    res.send(csv);
  }));

  /**
   * Upload a CSV. Without ?commit=true this is a dry run — every row is
   * validated and matched, and the response says what *would* happen, changing
   * nothing. With ?commit=true the valid rows are written in one transaction.
   */
  router.post('/:type', upload.single('file'), route((req, res) => {
    const spec = specOrFail(req.params.type);
    if (!req.file) throw new HttpError(400, 'Attach a CSV file in the "file" field');

    const { headers, rows } = parseCsv(req.file.buffer.toString('utf8'));
    if (rows.length === 0) throw new HttpError(422, 'That file has no data rows');

    const missing = spec.columns.filter((c) => c.required && !headers.includes(c.header)).map((c) => c.header);
    if (missing.length) throw new HttpError(422, `The file is missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);

    const commit = req.query.commit === 'true';
    const ctx = actorContext(req);

    // First pass: validate and classify every row without writing.
    const seen = new Set();
    const plans = rows.map((row, i) => {
      const line = i + 2; // header is line 1
      const { errors, key, record } = spec.build(row);
      if (!key) return { line, action: 'error', message: errors.join('; ') || 'Missing key', key };
      if (seen.has(key)) return { line, action: 'error', key, message: `Duplicate ${spec.keyHeader} "${key}" earlier in the file` };
      seen.add(key);
      if (errors.length) return { line, action: 'error', key, message: errors.join('; ') };
      const existing = db.findOne(spec.collection, { [spec.key]: key });
      return { line, action: existing ? 'update' : 'create', key, record, existingId: existing?.id };
    });

    const summary = {
      type: req.params.type, collection: spec.collection, committed: commit,
      total: plans.length,
      create: plans.filter((p) => p.action === 'create').length,
      update: plans.filter((p) => p.action === 'update').length,
      errors: plans.filter((p) => p.action === 'error').length,
      rows: plans.map(({ record, existingId, ...rest }) => rest),
    };

    if (!commit) return res.json(summary);

    // Second pass: apply the valid rows atomically.
    const valid = plans.filter((p) => p.action === 'create' || p.action === 'update');
    db.transaction((tx) => {
      for (const plan of valid) {
        if (plan.action === 'update') tx.update(spec.collection, plan.existingId, plan.record, ctx);
        else tx.insert(spec.collection, spec.onCreate ? spec.onCreate(plan.record) : plan.record, ctx);
      }
    }, ctx);

    logActivity(db, req, {
      type: 'import',
      title: `Imported ${valid.length} ${spec.label.toLowerCase()}`,
      detail: `${summary.create} created, ${summary.update} updated${summary.errors ? `, ${summary.errors} skipped` : ''}`,
      tone: 'accent',
    });
    res.json(summary);
  }));

  return router;
}
