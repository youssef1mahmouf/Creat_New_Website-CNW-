/**
 * Database service — the single storage entry point for the whole app.
 * Switching between JSON (dev/fallback) and MongoDB (production) requires
 * only the DB_TYPE / MONGODB_URI env vars. No business code changes.
 *
 * Architecture: Routes -> Controllers -> Services -> db.service -> Store
 * (The database is never reachable from the frontend directly.)
 */
const config = require('../config/env');
const definitions = require('../models/index');
const JsonStore = require('./stores/json-store');
const MongoStore = require('./stores/mongo-store');
const { encrypt, decrypt } = require('../security/encryption');
const logger = require('../utils/logger');
const path = require('path');

let store = null;
let connected = false;
let loadTimeMs = null;
let fallbackReason = '';

/** Resolved JSON store directory (same default used by connect/getStore). */
function jsonDir() {
  return config.db.jsonDir || path.join(__dirname, '..', '..', 'database', 'json');
}

/** Development JSON fallback must be explicit, never silent in production. */
function envAllowsJsonFallback() {
  if (config.isProduction) return false;
  const raw = process.env.DB_FALLBACK_JSON;
  if (raw === undefined || raw === '') return true; // dev convenience default
  return String(raw).toLowerCase() === 'true';
}

async function connect() {
  if (connected) return store;
  const startedAt = process.hrtime.bigint();
  if (config.db.type === 'mongodb' && config.db.mongoUri) {
    const mongo = new MongoStore();
    try {
      await mongo.connect(config.db.mongoUri, config.db.mongoDbName);
      store = mongo;
      fallbackReason = '';
      logger.info('database_connected', { type: 'mongodb', dbName: config.db.mongoDbName });
    } catch (err) {
      // Fail CLOSED in production: an unreachable production database must
      // never silently become a local JSON store (split-brain risk).
      // In development/test an explicit JSON fallback may still be used.
      fallbackReason = logger.redactValue(err.message || String(err));
      const allowFallback = !config.isProduction && envAllowsJsonFallback();
      logger.warn('mongodb_connect_failed', {
        reason: fallbackReason,
        fallback: allowFallback ? 'json (development only)' : 'none — failing fast',
      });
      if (!allowFallback) {
        connected = false;
        store = null;
        const failure = new Error('MongoDB connection failed and JSON fallback is disabled in this environment.');
        failure.code = 'DB_UNAVAILABLE';
        throw failure;
      }
      store = null;
      connected = false;
    }
  }
  if (!store) {
    store = new JsonStore(jsonDir());
    logger.info('database_connected', { type: 'json', fallback: config.db.type === 'mongodb' });
  }
  connected = true;
  loadTimeMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  return store;
}

function getStore() {
  if (!store) {
    // Synchronous lazy fallback (JSON) for early bootstrapping
    store = new JsonStore(jsonDir());
    connected = true;
  }
  return store;
}

function getDefinition(table) {
  return definitions[table];
}

function publicView(table, doc) {
  if (!doc) return null;
  const def = definitions[table];
  if (!def || !def.publicFields) return doc;
  const out = {};
  for (const f of def.publicFields) out[f] = doc[f];
  return out;
}

/** Encrypt fields marked `encrypted: true` before persistence. */
function encryptFields(table, data) {
  const def = definitions[table];
  if (!def) return data;
  const out = { ...data };
  for (const [field, fieldDef] of Object.entries(def.fields)) {
    if (fieldDef.encrypted && out[field] !== undefined && out[field] !== null) {
      if (typeof out[field] !== 'object' || !out[field].ciphertext) {
        out[field] = encrypt(JSON.stringify(out[field]));
      }
    }
  }
  return out;
}

/** Decrypt marked fields after read. */
function decryptFields(table, doc) {
  const def = definitions[table];
  if (!def || !doc) return doc;
  const out = { ...doc };
  for (const [field, fieldDef] of Object.entries(def.fields)) {
    if (fieldDef.encrypted && out[field] && typeof out[field] === 'object' && out[field].ciphertext) {
      try {
        out[field] = JSON.parse(decrypt(out[field]));
      } catch {
        out[field] = null; // integrity error — never crash reads
      }
    }
  }
  return out;
}

const db = {
  connect,
  async create(table, data) {
    const s = getStore();
    return decryptFields(table, await s.create(table, encryptFields(table, data)));
  },
  async findById(table, id) {
    return decryptFields(table, await getStore().findById(table, id));
  },
  async findOne(table, query) {
    return decryptFields(table, await getStore().findOne(table, query));
  },
  async find(table, query = {}, opts = {}) {
    const res = await getStore().find(table, query, opts);
    return { ...res, docs: res.docs.map((d) => decryptFields(table, d)) };
  },
  async update(table, id, patch) {
    return decryptFields(table, await getStore().update(table, id, encryptFields(table, patch)));
  },
  async updateOne(table, query, patch) {
    return decryptFields(table, await getStore().updateOne(table, query, encryptFields(table, patch)));
  },
  async delete(table, id) {
    const s = getStore();
    const ok = s.delete(table, id);
    if (table === 'sessions') {
      // Revoke matching sessions when a user is deleted (admin deleteUser).
      // The json-store delete already removed the user row; sessions are
      // cleaned lazily by the auth middleware (revoked/expired check).
    }
    return ok;
  },
  async count(table, query = {}) {
    return getStore().count(table, query);
  },
  async flush() {
    if (store && store.flush) await store.flush();
  },
  get type() {
    return config.db.type === 'mongodb' && config.db.mongoUri ? 'mongodb' : 'json';
  },
  /**
   * Live database diagnostics for the startup report.
   * Never exposes connection strings or credentials.
   */
  get info() {
    const usingMongo = db.type === 'mongodb' && connected && !fallbackReason;
    return {
      type: db.type,
      connected,
      fallback: Boolean(fallbackReason),
      fallbackReason,
      location: usingMongo
        ? `MongoDB database "${config.db.mongoDbName}" (credentials hidden)`
        : jsonDir(),
      loadTimeMs,
      tables: Object.keys(definitions).length,
    };
  },
  definitions,
  publicView,
};

module.exports = db;
