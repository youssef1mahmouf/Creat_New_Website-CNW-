/**
 * JSON file store — development / fallback database.
 * Files live in backend/database/json/<table>.json
 * In-memory cache + debounced atomic writes.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class JsonStore {
  constructor(dir) {
    this.dir = dir;
    this.cache = new Map(); // table -> array of docs
    this.writeTimers = new Map();
    fs.mkdirSync(this.dir, { recursive: true });
  }

  _file(table) {
    return path.join(this.dir, `${table}.json`);
  }

  _load(table) {
    if (!this.cache.has(table)) {
      try {
        const raw = fs.readFileSync(this._file(table), 'utf8');
        this.cache.set(table, JSON.parse(raw));
      } catch {
        this.cache.set(table, []);
      }
    }
    return this.cache.get(table);
  }

  _persist(table) {
    // Debounce writes to avoid disk thrash; atomic via tmp file + rename.
    clearTimeout(this.writeTimers.get(table));
    this.writeTimers.set(
      table,
      setTimeout(() => {
        try {
          const tmp = `${this._file(table)}.tmp`;
          fs.writeFileSync(tmp, JSON.stringify(this.cache.get(table) || [], null, 2));
          fs.renameSync(tmp, this._file(table));
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(JSON.stringify({ level: 'error', msg: 'json_store_write_failed', table }));
        }
      }, 25)
    );
  }

  async flush() {
    for (const table of this.cache.keys()) {
      clearTimeout(this.writeTimers.get(table));
      try {
        const tmp = `${this._file(table)}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(this.cache.get(table) || [], null, 2));
        fs.renameSync(tmp, this._file(table));
      } catch { /* best effort */ }
    }
  }

  _matches(doc, query) {
    return Object.entries(query || {}).every(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('$in' in v) return v.$in.includes(doc[k]);
        if ('$ne' in v) return doc[k] !== v.$ne;
        if ('$gte' in v) return new Date(doc[k]) >= new Date(v.$gte);
        if ('$lte' in v) return new Date(doc[k]) <= new Date(v.$lte);
      }
      return doc[k] === v;
    });
  }

  async create(table, data) {
    const docs = this._load(table);
    const doc = {
      id: crypto.randomUUID(),
      ...structuredClone(data),
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    docs.push(doc);
    this._persist(table);
    return structuredClone(doc);
  }

  async findById(table, id) {
    const doc = this._load(table).find((d) => d.id === id);
    return doc ? structuredClone(doc) : null;
  }

  async findOne(table, query) {
    const doc = this._load(table).find((d) => this._matches(d, query));
    return doc ? structuredClone(doc) : null;
  }

  async find(table, query = {}, { page = 1, limit = 50, sort = '-createdAt' } = {}) {
    let docs = this._load(table).filter((d) => this._matches(d, query));
    const field = sort.replace('-', '');
    const dir = sort.startsWith('-') ? -1 : 1;
    docs.sort((a, b) => {
      const av = a[field]; const bv = b[field];
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * dir;
    });
    const total = docs.length;
    const skip = (Math.max(1, page) - 1) * limit;
    docs = docs.slice(skip, skip + limit);
    return { docs: structuredClone(docs), total, page, limit };
  }

  async update(table, id, patch) {
    const docs = this._load(table);
    const doc = docs.find((d) => d.id === id);
    if (!doc) return null;
    Object.assign(doc, structuredClone(patch), { updatedAt: new Date().toISOString() });
    this._persist(table);
    return structuredClone(doc);
  }

  async updateOne(table, query, patch) {
    const docs = this._load(table);
    const doc = docs.find((d) => this._matches(d, query));
    if (!doc) return null;
    Object.assign(doc, structuredClone(patch), { updatedAt: new Date().toISOString() });
    this._persist(table);
    return structuredClone(doc);
  }

  async delete(table, id) {
    const docs = this._load(table);
    const idx = docs.findIndex((d) => d.id === id);
    if (idx === -1) return false;
    docs.splice(idx, 1);
    this._persist(table);
    return true;
  }

  async count(table, query = {}) {
    return this._load(table).filter((d) => this._matches(d, query)).length;
  }
}

module.exports = JsonStore;
