/** Resource routes: products, categories, designs, pages, projects, plugins, admin. */
const express = require('express');

const makeCrud = require('../controllers/crud.controller');
const admin = require('../controllers/admin.controller');
const pluginController = require('../controllers/plugin.controller');
const orders = require('../controllers/order.controller');
const { authenticate, optionalAuth, requirePermission } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const { body } = require('express-validator');
const asyncHandler = require('../utils/async-handler');
const db = require('../services/db.service');

const router = express.Router();

// ---------- Products / Categories ----------
const products = makeCrud('products', {
  writePermission: 'write:products', publicList: true,
  allowedFields: ['name', 'slug', 'description', 'price', 'currency', 'categoryId', 'designType', 'features', 'availability', 'access', 'images', 'status'],
});
router.get('/products', optionalAuth, products.list);
router.get('/products/:id', optionalAuth, products.get);
router.post('/products', authenticate, requirePermission('write:products'), products.create);
router.put('/products/:id', authenticate, requirePermission('write:products'), products.update);
router.delete('/products/:id', authenticate, requirePermission('delete:products'), products.remove);

const categories = makeCrud('categories', { writePermission: 'write:products' });
router.get('/categories', categories.list);
router.post('/categories', authenticate, requirePermission('write:products'), categories.create);
router.put('/categories/:id', authenticate, requirePermission('write:products'), categories.update);
router.delete('/categories/:id', authenticate, requirePermission('delete:products'), categories.remove);

// ---------- Designs / Pages / Projects ----------
const designs = makeCrud('designs', {
  writePermission: 'write:designs', publicList: true,
  allowedFields: ['name', 'designType', 'concept', 'capabilities', 'price', 'availability', 'status'],
});
router.get('/designs', optionalAuth, designs.list);
router.get('/designs/:id', optionalAuth, designs.get);
router.post('/designs', authenticate, requirePermission('write:designs'), designs.create);
router.put('/designs/:id', authenticate, requirePermission('write:designs'), designs.update);
router.delete('/designs/:id', authenticate, requirePermission('write:designs'), designs.remove);

// Design editor canvas persistence (validated size + shape)
router.put('/designs/:id/canvas', authenticate, requirePermission('write:designs'),
  validate([body('canvas').isObject()]),
  asyncHandler(async (req, res) => {
    const canvas = req.body.canvas || {};
    const raw = JSON.stringify(canvas);
    if (raw.length > 500000) {
      const ApiError = require('../utils/api-error');
      throw ApiError.badRequest('Canvas too large — max 500KB');
    }
    const layers = Array.isArray(canvas.layers) ? canvas.layers.slice(0, 500) : [];
    const clean = { ...canvas, layers };
    const doc = await db.update('designs', req.params.id, { data: clean });
    if (!doc) {
      const ApiError = require('../utils/api-error');
      throw ApiError.notFound('Design not found');
    }
    res.json({ success: true, doc });
  }));

const pages = makeCrud('pages', {
  writePermission: 'write:pages', publicList: true,
  allowedFields: ['title', 'slug', 'content', 'projectId', 'status'],
});
router.get('/pages', optionalAuth, pages.list);
router.get('/pages/:id', optionalAuth, pages.get);
router.post('/pages', authenticate, requirePermission('write:pages'), pages.create);
router.put('/pages/:id', authenticate, requirePermission('write:pages'), pages.update);
router.delete('/pages/:id', authenticate, requirePermission('write:pages'), pages.remove);

const projects = makeCrud('projects', {
  writePermission: 'write:projects',
  ownerScoped: true,
  allowedFields: ['name', 'type', 'plan', 'status', 'ownerId'],
});
router.get('/projects', authenticate, projects.list);
router.get('/projects/:id', authenticate, projects.get);
router.post('/projects', authenticate, requirePermission('write:projects'), projects.create);
router.put('/projects/:id', authenticate, requirePermission('write:projects'), projects.update);
router.delete('/projects/:id', authenticate, requirePermission('write:projects'), projects.remove);

// ---------- Admin (single canonical mount — no duplicates in routes/index.js) ----------
router.get('/admin/overview', authenticate, requirePermission('read:audit'), admin.overview);
router.get('/admin/users', authenticate, requirePermission('read:users'), admin.listUsers);
router.put('/admin/users/:id', authenticate, requirePermission('write:users'), admin.updateUser);
router.delete('/admin/users/:id', authenticate, requirePermission('delete:users'), admin.deleteUser);
router.get('/admin/audit-logs', authenticate, requirePermission('read:audit'), admin.auditLogs);
router.post('/admin/backups', authenticate, requirePermission('manage:security'), admin.createBackup);
router.get('/admin/backups', authenticate, requirePermission('manage:security'), admin.listBackups);
router.post('/admin/backups/restore', authenticate, requirePermission('manage:security'),
  validate([body('name').isString().matches(/^backup-\d+\.enc\.json$/)]), admin.restoreBackup);
router.get('/admin/payments', authenticate, requirePermission('read:payments'), orders.allPayments);

// ---------- Payment review (InstaPay / e-wallet customer-submitted payments) ----------
router.get('/admin/payments/pending-review', authenticate, requirePermission('approve:payments'), orders.pendingReviewList);
router.post('/admin/payments/:id/approve', authenticate, requirePermission('approve:payments'), orders.approvePayment);
router.post('/admin/payments/:id/reject', authenticate, requirePermission('approve:payments'), orders.rejectPayment);
router.get('/admin/payments/:id/proof', authenticate, requirePermission('manage:files'), orders.downloadPaymentProof);

// ---------- Plugins ----------
router.get('/plugins', optionalAuth, pluginController.list);
router.post('/plugins', authenticate, requirePermission('manage:plugins'), pluginController.install);
router.post('/plugins/:id/activate', authenticate, requirePermission('manage:plugins'), pluginController.activate);
router.post('/plugins/:id/deactivate', authenticate, requirePermission('manage:plugins'), pluginController.deactivate);
router.delete('/plugins/:id', authenticate, requirePermission('manage:plugins'), pluginController.uninstall);
router.put('/plugins/:id/configuration', authenticate, requirePermission('manage:plugins'), pluginController.configure);

module.exports = router;
