/**
 * MongoDB store (Mongoose) — production/scalable storage.
 * Builds Mongoose schemas from the shared model definitions.
 * Credentials come exclusively from MONGODB_URI env var.
 * IDs are authoritative UUID strings stored in the `id` field; Mongo's
 * internal _id is kept as ObjectId but never used as a business identifier
 * so JSON (UUID) and Mongo representations convert safely.
 */
const definitions = require('../../models/index');

let mongoose = null;
let models = null;

function toMongooseType(def) {
  switch (def.type) {
    case 'number': return Number;
    case 'boolean': return Boolean;
    case 'date': return Date;
    case 'object': return Object;
    case 'array': return Array;
    default: return String;
  }
}

function buildSchema(tableName) {
  const def = definitions[tableName];
  const schemaFields = {
    id: { type: String, required: false, index: true },
  };
  for (const [key, fieldDef] of Object.entries(def.fields)) {
    if (key === 'id') continue;
    const entry = { type: toMongooseType(fieldDef), default: fieldDef.default };
    if (fieldDef.required) entry.required = true;
    if (fieldDef.immutable) entry.immutable = true;
    if (fieldDef.min !== undefined) entry.min = fieldDef.min;
    if (fieldDef.max !== undefined) entry.max = fieldDef.max;
    schemaFields[key] = entry;
  }
  const mongoose = getMongoose();
  const schema = new mongoose.Schema(schemaFields, {
    minimize: false,
    versionKey: false,
    toJSON: { virtuals: false },
  });
  // Virtual id
  schema.virtual('id').get(function () { return this._id.toString(); });
  schema.set('toJSON', { virtuals: true, versionKey: false });
  for (const idx of def.indexes || []) {
    schema.index(idx.fields, idx.options || {});
  }
  return schema;
}

function getMongoose() {
  if (!mongoose) mongoose = require('mongoose');
  return mongoose;
}

function ensureModels() {
  if (models) return models;
  const mongoose = getMongoose();
  models = {};
  for (const tableName of Object.keys(definitions)) {
    const modelName = tableName
      .split('_')
      .map((p) => p[0].toUpperCase() + p.slice(1))
      .join('');
    const schema = buildSchema(tableName);
    models[tableName] = mongoose.models[modelName] || mongoose.model(modelName, schema);
  }
  return models;
}

class MongoStore {
  async connect(uri, dbName) {
    const mongoose = getMongoose();
    mongoose.set('sanitizeFilter', true); // injection protection
    await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 8000 });
    ensureModels();
  }

  async disconnect() {
    if (mongoose) await mongoose.disconnect();
  }

  _strip(doc) {
    if (!doc) return null;
    const obj = typeof doc.toObject === 'function' ? doc.toObject({ virtuals: true }) : { ...doc };
    // Business ID is the `id` string (UUID). Keep Mongo _id internal only.
    if (!obj.id && obj._id) obj.id = String(obj._id);
    delete obj._id;
    delete obj.__v;
    return obj;
  }

  async create(table, data) {
    const Model = ensureModels()[table];
    const payload = { ...data };
    if (!payload.id) payload.id = require('crypto').randomUUID();
    const doc = await Model.create(payload);
    return this._strip(doc);
  }

  /** findById accepts UUID strings (primary) and legacy 24-hex ObjectIds. */
  async findById(table, id) {
    const Model = ensureModels()[table];
    const key = String(id || '');
    const byBusinessId = await Model.findOne({ id: key }).lean({ virtuals: true }).catch(() => null);
    if (byBusinessId) return this._strip(byBusinessId);
    if (/^[0-9a-fA-F]{24}$/.test(key)) {
      const doc = await Model.findById(key).lean({ virtuals: true }).catch(() => null);
      return this._strip(doc);
    }
    return null;
  }

  async findOne(table, query) {
    const Model = ensureModels()[table];
    const doc = await Model.findOne(query).lean({ virtuals: true });
    return this._strip(doc);
  }

  async find(table, query = {}, { page = 1, limit = 50, sort = '-createdAt' } = {}) {
    const Model = ensureModels()[table];
    const [docs, total] = await Promise.all([
      Model.find(query)
        .sort(sort)
        .skip((Math.max(1, page) - 1) * limit)
        .limit(Math.min(limit, 200))
        .lean({ virtuals: true }),
      Model.countDocuments(query),
    ]);
    return { docs: docs.map((d) => this._strip(d)), total, page, limit };
  }

  async update(table, id, patch) {
    const Model = ensureModels()[table];
    const key = String(id || '');
    const query = /^[0-9a-fA-F]{24}$/.test(key) ? { $or: [{ id: key }, { _id: key }] } : { id: key };
    const doc = await Model.findOneAndUpdate(
      query,
      { ...patch, updatedAt: new Date() },
      { new: true, runValidators: true }
    ).lean({ virtuals: true }).catch(() => null);
    return this._strip(doc);
  }

  async updateOne(table, query, patch) {
    const Model = ensureModels()[table];
    const doc = await Model.findOneAndUpdate(
      query,
      { ...patch, updatedAt: new Date() },
      { new: true }
    ).lean({ virtuals: true });
    return this._strip(doc);
  }

  async delete(table, id) {
    const Model = ensureModels()[table];
    const key = String(id || '');
    const query = /^[0-9a-fA-F]{24}$/.test(key) ? { $or: [{ id: key }, { _id: key }] } : { id: key };
    const res = await Model.findOneAndDelete(query).catch(() => null);
    return Boolean(res);
  }

  async count(table, query = {}) {
    const Model = ensureModels()[table];
    return Model.countDocuments(query);
  }

  async flush() { /* Mongo writes are immediate */ }
}

module.exports = MongoStore;
