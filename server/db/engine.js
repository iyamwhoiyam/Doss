/**
 * Enova Ops — file-system database engine.
 *
 * A single-process, durable, human-inspectable document store that lives
 * entirely on the file system. There is no external database server: every
 * record Enova writes lands in a plain JSON file under `data/db/` that a person
 * can open, read, diff and back up with ordinary tools.
 *
 * Durability model (the same shape a real database uses):
 *
 *   1. Every mutation is appended synchronously to a write-ahead log
 *      (`data/db/wal/<collection>.log`, newline-delimited JSON) before the
 *      in-memory state is considered committed. A crash mid-write loses at most
 *      the record currently being appended, never the whole collection.
 *   2. The authoritative snapshot (`data/db/<collection>.json`) is rewritten
 *      atomically — temp file, fsync, rename — on a debounce and at checkpoint
 *      boundaries, then the WAL is truncated.
 *   3. On boot the snapshot is loaded and the WAL replayed on top of it, so the
 *      recovered state always equals the last acknowledged write.
 *
 * Everything is held in memory for query speed (Enova's working set is small —
 * tens of thousands of records), with secondary indexes on declared fields.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

// ── ids ────────────────────────────────────────────────────────────────────
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32, no I/L/O/U
let lastTime = 0;
let lastRand = [];

/** Lexicographically-sortable, collision-resistant 26-char id (ULID shape). */
export function newId() {
  const now = Date.now();
  if (now === lastTime) {
    // bump the random component so ids minted in the same ms still sort by time
    for (let i = lastRand.length - 1; i >= 0; i--) {
      if (lastRand[i] < 31) { lastRand[i]++; break; }
      lastRand[i] = 0;
    }
  } else {
    lastTime = now;
    lastRand = Array.from(crypto.randomBytes(16), (b) => b % 32);
  }
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) { time = B32[t % 32] + time; t = Math.floor(t / 32); }
  return time + lastRand.map((n) => B32[n]).join('');
}

// ── helpers ────────────────────────────────────────────────────────────────
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function deepClone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** Write `contents` to `file` atomically: temp file -> fsync -> rename. */
function atomicWrite(file, contents) {
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

/** Read a dotted path (`customer.billing.city`) out of a record. */
export function getPath(obj, dotted) {
  if (!dotted.includes('.')) return obj?.[dotted];
  let cur = obj;
  for (const key of dotted.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[key];
  }
  return cur;
}

// ── query matching ─────────────────────────────────────────────────────────
const OPERATORS = {
  $eq: (a, b) => a === b,
  $ne: (a, b) => a !== b,
  $gt: (a, b) => a > b,
  $gte: (a, b) => a >= b,
  $lt: (a, b) => a < b,
  $lte: (a, b) => a <= b,
  $in: (a, b) => Array.isArray(b) && b.includes(a),
  $nin: (a, b) => Array.isArray(b) && !b.includes(a),
  $exists: (a, b) => (a !== undefined && a !== null) === Boolean(b),
  $like: (a, b) => String(a ?? '').toLowerCase().includes(String(b).toLowerCase()),
  $contains: (a, b) => Array.isArray(a) && a.includes(b),
  $containsAny: (a, b) => Array.isArray(a) && Array.isArray(b) && b.some((x) => a.includes(x)),
};

function matchesCondition(value, condition) {
  if (isPlainObject(condition)) {
    const keys = Object.keys(condition);
    if (keys.length && keys.every((k) => k in OPERATORS)) {
      return keys.every((k) => OPERATORS[k](value, condition[k]));
    }
  }
  if (Array.isArray(value) && !Array.isArray(condition)) return value.includes(condition);
  if (Array.isArray(condition)) return condition.includes(value);
  return value === condition;
}

export function matchesWhere(record, where) {
  if (!where) return true;
  for (const [field, condition] of Object.entries(where)) {
    if (field === '$or') {
      if (!condition.some((sub) => matchesWhere(record, sub))) return false;
      continue;
    }
    if (field === '$and') {
      if (!condition.every((sub) => matchesWhere(record, sub))) return false;
      continue;
    }
    if (field === '$search') {
      const needle = String(condition.value ?? '').trim().toLowerCase();
      if (!needle) continue;
      const fields = condition.fields ?? Object.keys(record);
      const hit = fields.some((f) => String(getPath(record, f) ?? '').toLowerCase().includes(needle));
      if (!hit) return false;
      continue;
    }
    if (!matchesCondition(getPath(record, field), condition)) return false;
  }
  return true;
}

function compareValues(a, b) {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export function sortRecords(records, sort) {
  if (!sort) return records;
  const specs = (Array.isArray(sort) ? sort : [sort]).map((s) =>
    typeof s === 'string'
      ? { field: s.replace(/^-/, ''), dir: s.startsWith('-') ? -1 : 1 }
      : { field: s.field, dir: s.dir === 'desc' || s.dir === -1 ? -1 : 1 },
  );
  return records.sort((x, y) => {
    for (const { field, dir } of specs) {
      const c = compareValues(getPath(x, field), getPath(y, field));
      if (c !== 0) return c * dir;
    }
    return 0;
  });
}

// ── errors ─────────────────────────────────────────────────────────────────
export class ValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'ValidationError';
    this.status = 422;
    this.details = details;
  }
}
export class ConflictError extends Error {
  constructor(message) { super(message); this.name = 'ConflictError'; this.status = 409; }
}
export class NotFoundError extends Error {
  constructor(message) { super(message); this.name = 'NotFoundError'; this.status = 404; }
}

// ── validation ─────────────────────────────────────────────────────────────
const TYPE_CHECKS = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  object: (v) => isPlainObject(v),
  array: (v) => Array.isArray(v),
  date: (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v)),
  any: () => true,
};

const DEFAULT_FOR_TYPE = {
  string: '', number: 0, boolean: false, object: () => ({}), array: () => [], date: null, any: null,
};

// ── collection ─────────────────────────────────────────────────────────────
class Collection {
  constructor(db, name, definition) {
    this.db = db;
    this.name = name;
    this.def = definition;
    this.fields = definition.fields ?? {};
    this.indexes = new Map(); // field -> Map(value -> Set(id))
    this.unique = definition.unique ?? [];
    this.records = new Map(); // id -> record
    for (const field of definition.indexes ?? []) this.indexes.set(field, new Map());
    for (const field of this.unique) if (!this.indexes.has(field)) this.indexes.set(field, new Map());
  }

  #indexAdd(record) {
    for (const [field, index] of this.indexes) {
      const value = getPath(record, field);
      const keys = Array.isArray(value) ? value : [value];
      for (const key of keys) {
        const k = key === undefined ? ' undefined' : String(key);
        let set = index.get(k);
        if (!set) index.set(k, (set = new Set()));
        set.add(record.id);
      }
    }
  }

  #indexRemove(record) {
    for (const [field, index] of this.indexes) {
      const value = getPath(record, field);
      const keys = Array.isArray(value) ? value : [value];
      for (const key of keys) {
        const k = key === undefined ? ' undefined' : String(key);
        const set = index.get(k);
        if (set) { set.delete(record.id); if (!set.size) index.delete(k); }
      }
    }
  }

  /** Load a record straight into memory (boot path — no WAL, no events). */
  load(record) {
    const existing = this.records.get(record.id);
    if (existing) this.#indexRemove(existing);
    this.records.set(record.id, record);
    this.#indexAdd(record);
  }

  unload(id) {
    const existing = this.records.get(id);
    if (existing) { this.#indexRemove(existing); this.records.delete(id); }
  }

  validate(candidate, { partial = false } = {}) {
    const errors = [];
    for (const [field, spec] of Object.entries(this.fields)) {
      const value = candidate[field];
      const missing = value === undefined || value === null || value === '';
      if (spec.required && missing && !partial) {
        errors.push({ field, message: `${spec.label ?? field} is required` });
        continue;
      }
      if (missing) continue;
      const check = TYPE_CHECKS[spec.type ?? 'any'];
      if (check && !check(value)) {
        errors.push({ field, message: `${spec.label ?? field} must be a ${spec.type}` });
        continue;
      }
      if (spec.enum && !spec.enum.includes(value)) {
        errors.push({ field, message: `${spec.label ?? field} must be one of: ${spec.enum.join(', ')}` });
      }
      if (spec.min !== undefined && typeof value === 'number' && value < spec.min) {
        errors.push({ field, message: `${spec.label ?? field} must be at least ${spec.min}` });
      }
      if (spec.max !== undefined && typeof value === 'number' && value > spec.max) {
        errors.push({ field, message: `${spec.label ?? field} must be at most ${spec.max}` });
      }
      if (spec.maxLength && typeof value === 'string' && value.length > spec.maxLength) {
        errors.push({ field, message: `${spec.label ?? field} must be ${spec.maxLength} characters or fewer` });
      }
    }
    if (errors.length) throw new ValidationError(`${this.name}: ${errors[0].message}`, errors);
  }

  checkUnique(candidate, ignoreId) {
    for (const field of this.unique) {
      const value = getPath(candidate, field);
      if (value === undefined || value === null || value === '') continue;
      const index = this.indexes.get(field);
      const ids = index?.get(String(value));
      if (!ids) continue;
      for (const id of ids) {
        if (id === ignoreId) continue;
        const other = this.records.get(id);
        if (other && !other.deletedAt) {
          throw new ConflictError(`${this.name}: ${field} "${value}" already exists`);
        }
      }
    }
  }

  applyDefaults(record) {
    for (const [field, spec] of Object.entries(this.fields)) {
      if (record[field] !== undefined) continue;
      if (spec.default !== undefined) {
        record[field] = typeof spec.default === 'function' ? spec.default() : deepClone(spec.default);
      } else if (spec.required !== true && spec.type in DEFAULT_FOR_TYPE) {
        const fallback = DEFAULT_FOR_TYPE[spec.type];
        record[field] = typeof fallback === 'function' ? fallback() : fallback;
      }
    }
    return record;
  }

  /** Candidate id set for a `where` clause, using indexes where possible. */
  candidateIds(where) {
    if (!where) return null;
    let best = null;
    for (const [field, condition] of Object.entries(where)) {
      const index = this.indexes.get(field);
      if (!index) continue;
      let values = null;
      if (isPlainObject(condition) && Array.isArray(condition.$in)) values = condition.$in;
      else if (!isPlainObject(condition) && !Array.isArray(condition)) values = [condition];
      if (!values) continue;
      const ids = new Set();
      for (const value of values) for (const id of index.get(String(value)) ?? []) ids.add(id);
      if (best === null || ids.size < best.size) best = ids;
    }
    return best;
  }
}

// ── database ───────────────────────────────────────────────────────────────
export class Database extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.dir      root data directory (holds db/, files/, audit/, backups/)
   * @param {object} options.schema   collection definitions
   */
  constructor({ dir, schema, checkpointMs = 2000, backupEveryMs = 6 * 60 * 60 * 1000, maxBackups = 24 }) {
    super();
    this.setMaxListeners(200);
    this.dir = path.resolve(dir);
    this.dbDir = path.join(this.dir, 'db');
    this.walDir = path.join(this.dbDir, 'wal');
    this.filesDir = path.join(this.dir, 'files');
    this.auditDir = path.join(this.dir, 'audit');
    this.backupDir = path.join(this.dir, 'backups');
    this.schema = schema;
    this.checkpointMs = checkpointMs;
    this.backupEveryMs = backupEveryMs;
    this.maxBackups = maxBackups;

    this.collections = new Map();
    this.dirty = new Set();
    this.walHandles = new Map();
    this.opCount = 0;
    this.sequences = {};
    this.checkpointTimer = null;
    this.backupTimer = null;
    this.opened = false;
  }

  // -- lifecycle --
  open() {
    if (this.opened) return this;
    for (const dir of [this.dbDir, this.walDir, this.filesDir, this.auditDir, this.backupDir]) ensureDir(dir);

    for (const [name, definition] of Object.entries(this.schema)) {
      this.collections.set(name, new Collection(this, name, definition));
    }

    const metaFile = path.join(this.dbDir, '_meta.json');
    if (fs.existsSync(metaFile)) {
      try { this.sequences = JSON.parse(fs.readFileSync(metaFile, 'utf8')).sequences ?? {}; }
      catch { this.sequences = {}; }
    }

    let replayed = 0;
    for (const [name, collection] of this.collections) {
      const snapshot = path.join(this.dbDir, `${name}.json`);
      if (fs.existsSync(snapshot)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(snapshot, 'utf8'));
          for (const record of parsed.records ?? []) collection.load(record);
        } catch (err) {
          console.error(`[db] snapshot for "${name}" is unreadable (${err.message}); recovering from WAL only`);
        }
      }
      replayed += this.#replayWal(name, collection);
    }

    this.opened = true;
    if (replayed > 0) {
      console.log(`[db] replayed ${replayed} write-ahead entries`);
      this.checkpoint();
    }

    this.backupTimer = setInterval(() => this.backup(), this.backupEveryMs);
    this.backupTimer.unref?.();
    return this;
  }

  #replayWal(name, collection) {
    const walFile = path.join(this.walDir, `${name}.log`);
    if (!fs.existsSync(walFile)) return 0;
    const raw = fs.readFileSync(walFile, 'utf8');
    if (!raw.trim()) return 0;
    let count = 0;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; } // torn tail line — drop it
      if (entry.op === 'put') { collection.load(entry.r); count++; }
      else if (entry.op === 'del') { collection.unload(entry.id); count++; }
    }
    if (count) this.dirty.add(name);
    return count;
  }

  #wal(collection, entry) {
    let handle = this.walHandles.get(collection);
    if (handle === undefined) {
      handle = fs.openSync(path.join(this.walDir, `${collection}.log`), 'a');
      this.walHandles.set(collection, handle);
    }
    fs.writeSync(handle, JSON.stringify(entry) + '\n');
    this.dirty.add(collection);
    this.opCount++;
    if (this.opCount % 200 === 0) this.checkpoint();
    else this.#scheduleCheckpoint();
  }

  #scheduleCheckpoint() {
    if (this.checkpointTimer) return;
    this.checkpointTimer = setTimeout(() => { this.checkpointTimer = null; this.checkpoint(); }, this.checkpointMs);
    this.checkpointTimer.unref?.();
  }

  /** Flush every dirty collection to its snapshot and truncate its WAL. */
  checkpoint() {
    if (!this.dirty.size) return;
    for (const name of [...this.dirty]) {
      const collection = this.collections.get(name);
      if (!collection) { this.dirty.delete(name); continue; }
      const payload = {
        collection: name,
        savedAt: new Date().toISOString(),
        count: collection.records.size,
        records: [...collection.records.values()],
      };
      atomicWrite(path.join(this.dbDir, `${name}.json`), JSON.stringify(payload, null, 2));
      const handle = this.walHandles.get(name);
      if (handle !== undefined) { fs.closeSync(handle); this.walHandles.delete(name); }
      fs.writeFileSync(path.join(this.walDir, `${name}.log`), '');
      this.dirty.delete(name);
    }
    atomicWrite(
      path.join(this.dbDir, '_meta.json'),
      JSON.stringify({ sequences: this.sequences, savedAt: new Date().toISOString() }, null, 2),
    );
  }

  close() {
    if (this.checkpointTimer) { clearTimeout(this.checkpointTimer); this.checkpointTimer = null; }
    if (this.backupTimer) { clearInterval(this.backupTimer); this.backupTimer = null; }
    this.dirty.add('_meta');
    this.checkpoint();
    for (const handle of this.walHandles.values()) { try { fs.closeSync(handle); } catch { /* already closed */ } }
    this.walHandles.clear();
  }

  /** Snapshot every collection into `data/backups/<timestamp>/`, pruning old sets. */
  backup() {
    this.checkpoint();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(this.backupDir, stamp);
    ensureDir(target);
    for (const name of this.collections.keys()) {
      const source = path.join(this.dbDir, `${name}.json`);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(target, `${name}.json`));
    }
    const existing = fs.readdirSync(this.backupDir).filter((d) => /^\d{4}-/.test(d)).sort();
    for (const old of existing.slice(0, Math.max(0, existing.length - this.maxBackups))) {
      fs.rmSync(path.join(this.backupDir, old), { recursive: true, force: true });
    }
    return { stamp, path: target, collections: this.collections.size };
  }

  // -- accessors --
  collection(name) {
    const collection = this.collections.get(name);
    if (!collection) throw new NotFoundError(`Unknown collection "${name}"`);
    return collection;
  }

  has(name) { return this.collections.has(name); }

  /** Next value in a named sequence, e.g. `nextSequence('WO', 'WO-{yyyy}-{n:4}')`. */
  nextSequence(key, pattern = '{key}-{n:5}') {
    const year = new Date().getFullYear();
    const scoped = pattern.includes('{yyyy}') ? `${key}:${year}` : key;
    const next = (this.sequences[scoped] ?? 0) + 1;
    this.sequences[scoped] = next;
    this.dirty.add('_meta');
    this.#scheduleCheckpoint();
    return pattern
      .replace('{key}', key)
      .replace('{yyyy}', String(year))
      .replace('{yy}', String(year).slice(2))
      .replace(/\{n(?::(\d+))?\}/, (_, width) => String(next).padStart(Number(width ?? 1), '0'));
  }

  // -- reads --
  get(name, id, { includeDeleted = false } = {}) {
    const record = this.collection(name).records.get(id);
    if (!record) return null;
    if (record.deletedAt && !includeDeleted) return null;
    return deepClone(record);
  }

  getOrFail(name, id, options) {
    const record = this.get(name, id, options);
    if (!record) throw new NotFoundError(`${name} ${id} not found`);
    return record;
  }

  /**
   * Query a collection.
   * @returns {{rows: object[], total: number}}
   */
  query(name, { where, sort, limit, offset = 0, includeDeleted = false, select } = {}) {
    const collection = this.collection(name);
    const candidates = collection.candidateIds(where);
    const source = candidates
      ? [...candidates].map((id) => collection.records.get(id)).filter(Boolean)
      : collection.records.values();

    const matched = [];
    for (const record of source) {
      if (record.deletedAt && !includeDeleted) continue;
      if (!matchesWhere(record, where)) continue;
      matched.push(record);
    }
    sortRecords(matched, sort ?? '-createdAt');
    const total = matched.length;
    const page = limit ? matched.slice(offset, offset + limit) : matched.slice(offset);
    const rows = page.map((record) => {
      const copy = deepClone(record);
      if (!select) return copy;
      const picked = { id: copy.id };
      for (const field of select) picked[field] = getPath(copy, field);
      return picked;
    });
    return { rows, total };
  }

  find(name, where, options = {}) { return this.query(name, { ...options, where }).rows; }
  findOne(name, where, options = {}) { return this.query(name, { ...options, where, limit: 1 }).rows[0] ?? null; }
  count(name, where) { return this.query(name, { where, select: [] }).total; }
  all(name, options = {}) { return this.query(name, options).rows; }

  // -- writes --
  insert(name, data, ctx = {}) {
    const collection = this.collection(name);
    const now = new Date().toISOString();
    const record = collection.applyDefaults({ ...deepClone(data) });
    record.id = data.id ?? newId();
    record.createdAt = data.createdAt ?? now;
    record.updatedAt = now;
    record.createdBy = ctx.actorId ?? data.createdBy ?? 'system';
    record.updatedBy = ctx.actorId ?? 'system';
    record.version = 1;
    record.deletedAt = null;

    collection.validate(record);
    collection.checkUnique(record, record.id);
    collection.load(record);
    this.#wal(name, { t: now, op: 'put', r: record });
    this.#emitChange({ collection: name, op: 'insert', id: record.id, record, ctx });
    this.#audit({ collection: name, op: 'insert', id: record.id, after: record, ctx });
    return deepClone(record);
  }

  update(name, id, patch, ctx = {}) {
    const collection = this.collection(name);
    const current = collection.records.get(id);
    if (!current || (current.deletedAt && !ctx.includeDeleted)) throw new NotFoundError(`${name} ${id} not found`);
    if (ctx.expectedVersion !== undefined && current.version !== ctx.expectedVersion) {
      throw new ConflictError(
        `${name} ${id} was changed by someone else (expected v${ctx.expectedVersion}, found v${current.version}). Reload and try again.`,
      );
    }
    const now = new Date().toISOString();
    const next = { ...deepClone(current), ...deepClone(patch) };
    next.id = id;
    next.createdAt = current.createdAt;
    next.createdBy = current.createdBy;
    next.updatedAt = now;
    next.updatedBy = ctx.actorId ?? 'system';
    next.version = (current.version ?? 1) + 1;
    if (patch.deletedAt === undefined) next.deletedAt = current.deletedAt ?? null;

    collection.validate(next);
    collection.checkUnique(next, id);
    collection.load(next);
    this.#wal(name, { t: now, op: 'put', r: next });
    this.#emitChange({ collection: name, op: 'update', id, record: next, ctx });
    this.#audit({ collection: name, op: 'update', id, before: current, after: next, ctx });
    return deepClone(next);
  }

  /** Soft delete: the record stays on disk with a `deletedAt` stamp. */
  remove(name, id, ctx = {}) {
    return this.update(name, id, { deletedAt: new Date().toISOString() }, { ...ctx, includeDeleted: true });
  }

  restore(name, id, ctx = {}) {
    return this.update(name, id, { deletedAt: null }, { ...ctx, includeDeleted: true });
  }

  /** Permanent removal — used by admin purge only. */
  purge(name, id, ctx = {}) {
    const collection = this.collection(name);
    const current = collection.records.get(id);
    if (!current) throw new NotFoundError(`${name} ${id} not found`);
    collection.unload(id);
    this.#wal(name, { t: new Date().toISOString(), op: 'del', id });
    this.#emitChange({ collection: name, op: 'purge', id, record: current, ctx });
    this.#audit({ collection: name, op: 'purge', id, before: current, ctx });
    return { id, purged: true };
  }

  /**
   * Run several writes as one unit. If `fn` throws, every write it made is
   * rolled back in reverse order and the error is rethrown.
   */
  transaction(fn, ctx = {}) {
    const undo = [];
    const capture = (name, id) => {
      const before = this.collection(name).records.get(id);
      undo.push({ name, id, before: before ? deepClone(before) : null });
    };
    const tx = {
      // an inserted record had no prior state, so its undo entry is always a removal
      insert: (name, data, c) => {
        const r = this.insert(name, data, { ...ctx, ...c });
        undo.push({ name, id: r.id, before: null });
        return r;
      },
      update: (name, id, patch, c) => { capture(name, id); return this.update(name, id, patch, { ...ctx, ...c }); },
      remove: (name, id, c) => { capture(name, id); return this.remove(name, id, { ...ctx, ...c }); },
      get: (name, id, o) => this.get(name, id, o),
      getOrFail: (name, id, o) => this.getOrFail(name, id, o),
      find: (name, w, o) => this.find(name, w, o),
      findOne: (name, w, o) => this.findOne(name, w, o),
      query: (name, o) => this.query(name, o),
      count: (name, w) => this.count(name, w),
      nextSequence: (k, p) => this.nextSequence(k, p),
      db: this,
    };
    try {
      return fn(tx);
    } catch (err) {
      for (const entry of undo.reverse()) {
        const collection = this.collection(entry.name);
        if (entry.before) {
          collection.load(entry.before);
          this.#wal(entry.name, { t: new Date().toISOString(), op: 'put', r: entry.before });
        } else {
          collection.unload(entry.id);
          this.#wal(entry.name, { t: new Date().toISOString(), op: 'del', id: entry.id });
        }
      }
      throw err;
    }
  }

  // -- observability --
  #emitChange(event) {
    const payload = {
      collection: event.collection,
      op: event.op,
      id: event.id,
      record: deepClone(event.record),
      actorId: event.ctx?.actorId ?? null,
      actorName: event.ctx?.actorName ?? null,
      at: new Date().toISOString(),
    };
    this.emit('change', payload);
    this.emit(`change:${event.collection}`, payload);
  }

  #audit(event) {
    const definition = this.schema[event.collection];
    if (definition?.audit === false) return;
    const line = {
      at: new Date().toISOString(),
      collection: event.collection,
      op: event.op,
      id: event.id,
      actorId: event.ctx?.actorId ?? 'system',
      actorName: event.ctx?.actorName ?? 'system',
      reason: event.ctx?.reason ?? null,
      changes: event.before && event.after ? diffRecords(event.before, event.after) : undefined,
      snapshot: event.op === 'insert' ? summarise(event.after) : undefined,
    };
    const file = path.join(this.auditDir, `${line.at.slice(0, 10)}.ndjson`);
    fs.appendFileSync(file, JSON.stringify(line) + '\n');
  }

  /** Read the audit trail back, newest first. */
  readAudit({ days = 7, limit = 500, collection, actorId, recordId } = {}) {
    const out = [];
    for (let i = 0; i < days; i++) {
      const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const file = path.join(this.auditDir, `${day}.ndjson`);
      if (!fs.existsSync(file)) continue;
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).reverse();
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (collection && entry.collection !== collection) continue;
          if (actorId && entry.actorId !== actorId) continue;
          if (recordId && entry.id !== recordId) continue;
          out.push(entry);
          if (out.length >= limit) return out;
        } catch { /* skip malformed line */ }
      }
    }
    return out;
  }

  stats() {
    const collections = {};
    let bytes = 0;
    for (const [name, collection] of this.collections) {
      const file = path.join(this.dbDir, `${name}.json`);
      const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
      bytes += size;
      let live = 0;
      for (const record of collection.records.values()) if (!record.deletedAt) live++;
      collections[name] = {
        records: collection.records.size,
        live,
        deleted: collection.records.size - live,
        bytes: size,
      };
    }
    const backups = fs.existsSync(this.backupDir)
      ? fs.readdirSync(this.backupDir).filter((d) => /^\d{4}-/.test(d)).sort()
      : [];
    return {
      dir: this.dir,
      collections,
      totalRecords: Object.values(collections).reduce((sum, c) => sum + c.records, 0),
      bytes,
      pendingWrites: this.dirty.size,
      writesSinceBoot: this.opCount,
      backups: { count: backups.length, latest: backups.at(-1) ?? null },
    };
  }
}

function summarise(record) {
  if (!record) return undefined;
  const out = {};
  for (const key of Object.keys(record).slice(0, 14)) {
    if (key === 'id') continue;
    const value = record[key];
    out[key] = typeof value === 'string' && value.length > 200 ? `${value.slice(0, 200)}…` : value;
  }
  return out;
}

/** Field-level diff used by the audit trail. */
export function diffRecords(before, after) {
  const changes = [];
  const skip = new Set(['updatedAt', 'updatedBy', 'version']);
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    if (skip.has(key)) continue;
    const a = before?.[key];
    const b = after?.[key];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    changes.push({
      field: key,
      from: typeof a === 'object' && a !== null ? '[object]' : a ?? null,
      to: typeof b === 'object' && b !== null ? '[object]' : b ?? null,
    });
  }
  return changes;
}

export { atomicWrite, ensureDir, deepClone };
