/**
 * Generic CRUD controller factory — keeps resources modular and consistent.
 * Every resource gets list/read/create/update/delete with permission checks,
 * pagination, and audit logging. New resources can be added without rewriting.
 */
const db = require('../services/db.service');
const audit = require('../services/audit.service');
const ApiError = require('../utils/api-error');
const asyncHandler = require('../utils/async-handler');

/** Fields that must never be used as client-supplied query filters. */
const SENSITIVE_FIELDS = new Set([
  'passwordHash', 'resetTokenHash', 'resetTokenExpiresAt', 'refreshHash', 'dataUrl',
]);

/**
 * Build a safe filter from req.query: only keys that exist in the model
 * definition are accepted, sensitive fields are always dropped, and
 * non-scalar values (operator objects like ?field[$ne]=… from bracket syntax)
 * are ignored. Prevents clients from querying fields they must never filter on.
 */
function safeFilter(table, query) {
  const def = db.definitions[table];
  const allowed = def && def.fields ? Object.keys(def.fields) : [];
  const filter = {};
  for (const [key, value] of Object.entries(query || {})) {
    if (!allowed.includes(key) || SENSITIVE_FIELDS.has(key)) continue;
    if (value === null || typeof value !== 'string') continue; // drop operator objects/arrays
    if (value === '') continue;
    filter[key] = value;
  }
  return filter;
}

/** Fields that must never be client-writable (mass-assignment guard). */
const PROTECTED_FIELDS = new Set(['id', '_id', 'createdAt', 'updatedAt', 'passwordHash', 'resetTokenHash', 'resetTokenExpiresAt', 'refreshHash', 'emailVerifyHash', 'role', 'permissions', 'accountType']);

function pickWritable(table, body, allowedFields) {
  const out = {};
  const src = body && typeof body === 'object' ? body : {};
  const def = db.definitions[table];
  const modelFields = def && def.fields ? Object.keys(def.fields) : null;
  for (const [k, v] of Object.entries(src)) {
    if (PROTECTED_FIELDS.has(k)) continue;
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (Array.isArray(allowedFields) && !allowedFields.includes(k)) continue;
    if (!Array.isArray(allowedFields) && modelFields && !modelFields.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

function makeCrudController(table, { writePermission, adminRead = false, allowedFields = null, publicList = false, ownerScoped = false } = {}) {
  const controller = {
    list: asyncHandler(async (req, res) => {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const filter = safeFilter(table, req.query);
      const isAdmin = req.user && ['admin', 'super_admin'].includes(req.user.role);
      if (ownerScoped && !isAdmin) filter.ownerId = req.user.id;
      // Non-admins only see published/active documents.
      if (adminRead && (!req.user || !isAdmin)) {
        if (filter.status === undefined) filter.status = 'published';
      }
      if (publicList && !req.user) filter.status = filter.status || 'published';
      const result = await db.find(table, filter, { page, limit });
      res.json({ success: true, ...result, docs: result.docs.map((d) => db.publicView(table, d)) });
    }),

    get: asyncHandler(async (req, res) => {
      const doc = await db.findById(table, req.params.id);
      if (!doc) throw ApiError.notFound();
      const isAdmin = req.user && ['admin', 'super_admin'].includes(req.user.role);
      if (ownerScoped && !isAdmin && doc.ownerId !== req.user.id) throw ApiError.notFound();
      // Drafts are never visible to the public via direct ID.
      if ((doc.status === 'draft' || doc.status === 'archived') && (!req.user || !isAdmin)) {
        throw ApiError.notFound();
      }
      res.json({ success: true, doc: db.publicView(table, doc) });
    }),

    create: asyncHandler(async (req, res) => {
      const body = pickWritable(table, req.body, allowedFields);
      if (ownerScoped && !['admin', 'super_admin'].includes(req.user.role)) body.ownerId = req.user.id;
      const doc = await db.create(table, body);
      await audit.log({
        actorId: req.user.id, actorEmail: req.user.email, action: 'admin_action',
        category: 'admin', target: `${table}:${doc.id}`, metadata: { op: 'create' },
      });
      res.status(201).json({ success: true, doc });
    }),

    update: asyncHandler(async (req, res) => {
      const existing = await db.findById(table, req.params.id);
      const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
      if (!existing || (ownerScoped && !isAdmin && existing.ownerId !== req.user.id)) throw ApiError.notFound();
      const body = pickWritable(table, req.body, allowedFields);
      if (ownerScoped && !isAdmin) delete body.ownerId;
      const doc = await db.update(table, req.params.id, body);
      if (!doc) throw ApiError.notFound();
      await audit.log({
        actorId: req.user.id, actorEmail: req.user.email, action: 'admin_action',
        category: 'admin', target: `${table}:${doc.id}`, metadata: { op: 'update' },
      });
      res.json({ success: true, doc });
    }),

    remove: asyncHandler(async (req, res) => {
      if (ownerScoped && !['admin', 'super_admin'].includes(req.user.role)) {
        const existing = await db.findById(table, req.params.id);
        if (!existing || existing.ownerId !== req.user.id) throw ApiError.notFound();
      }
      const ok = await db.delete(table, req.params.id);
      if (!ok) throw ApiError.notFound();
      await audit.log({
        actorId: req.user.id, actorEmail: req.user.email, action: 'admin_action',
        category: 'admin', target: `${table}:${req.params.id}`, metadata: { op: 'delete' },
      });
      res.json({ success: true });
    }),
  };
  return controller;
}

module.exports = makeCrudController;
