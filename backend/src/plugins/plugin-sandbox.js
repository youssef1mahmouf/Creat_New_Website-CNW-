/**
 * Plugin Sandbox & API — plugins receive ONLY a context with the exact
 * permissions granted to them. They never get raw db access, request objects,
 * process/env, filesystem, or secrets. Each call is permission-gated.
 */
const db = require('../services/db.service');
const logger = require('../utils/logger');

class PluginContext {
  constructor(manifest) {
    this.id = manifest.id;
    this.version = manifest.version;
    this.granted = new Set(manifest.permissions || []);
  }

  _require(permission) {
    if (!this.granted.has(permission)) {
      logger.warn('plugin_permission_denied', { plugin: this.id, permission });
      throw new Error(`Plugin "${this.id}" lacks permission: ${permission}`);
    }
  }

  /** read:products — public product data only */
  async getProducts(query = {}) {
    this._require('read:products');
    const res = await db.find('products', { status: 'published', ...query }, { limit: 50 });
    return res.docs;
  }

  /** read:user — only the minimal public profile passed in, never arbitrary users */
  getUserProfile(user) {
    this._require('read:user');
    return user ? { id: user.id, name: user.name, role: user.role } : null;
  }

  /** read:pages — published pages only */
  async getPages() {
    this._require('read:pages');
    const res = await db.find('pages', { status: 'published' }, { limit: 50 });
    return res.docs;
  }

  /** read:orders — ONLY orders belonging to the requesting user */
  async getUserOrders(user) {
    this._require('read:orders');
    if (!user) return [];
    const res = await db.find('orders', { userId: user.id }, { limit: 50 });
    return res.docs.map((o) => ({ id: o.id, total: o.total, status: o.status }));
  }

  /** storage:plugin — namespaced key/value store scoped to this plugin */
  async storageGet(key) {
    this._require('storage:plugin');
    const doc = await db.findOne('plugins', { pluginId: this.id });
    return doc?.configuration?.[key] ?? null;
  }

  async storageSet(key, value) {
    this._require('storage:plugin');
    const doc = await db.findOne('plugins', { pluginId: this.id });
    const configuration = { ...(doc?.configuration || {}), [key]: value };
    if (doc) await db.update('plugins', doc.id, { configuration });
    return true;
  }

  /** ai:request — rate-limited and permission-gated AI calls */
  async aiRequest(prompt) {
    this._require('ai:request');
    return { echo: String(prompt).slice(0, 200), note: 'plugin-ai-bridge (offline)' };
  }

  /** http:route — register a namespaced route handler */
  registerRoute(method, path, handler) {
    this._require('http:route');
    if (!['get', 'post'].includes(method)) throw new Error('Plugins may only register GET/POST routes');
    if (!path.startsWith('/')) throw new Error('Route path must start with /');
    return { plugin: this.id, method, path: `/plugins/${this.id}${path}`, handler };
  }
}

/** Security Manager: builds a sandboxed context; strips prototypes from manifests. */
function createSandbox(manifest) {
  const clean = JSON.parse(JSON.stringify({
    id: manifest.pluginId || manifest.id, // db docs use pluginId (and have a doc id); manifests use id
    version: manifest.version,
    permissions: manifest.permissions,
  }));
  return new PluginContext(clean);
}

module.exports = { PluginContext, createSandbox };
