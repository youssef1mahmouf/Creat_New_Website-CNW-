/**
 * Plugin Manager — lifecycle orchestration.
 * install -> validate -> register -> activate (sandboxed) -> deactivate/uninstall.
 * Supports any number of plugins (4, 8, 20+) with explicit permission grants,
 * dependency checks and version tracking.
 */
const db = require('../services/db.service');
const audit = require('../services/audit.service');
const registry = require('./plugin-registry');
const { validateManifest } = require('./plugin-validator');
const { createSandbox } = require('./plugin-sandbox');
const ApiError = require('../utils/api-error');
const { nanoid } = require('nanoid');

const activeRoutes = [];

async function installPlugin(manifest, actor) {
  const { valid, errors } = validateManifest(manifest);
  if (!valid) throw ApiError.badRequest('Invalid plugin manifest', errors);

  const existing = await db.findOne('plugins', { pluginId: manifest.id });
  if (existing) throw ApiError.conflict('Plugin already installed');

  const doc = await db.create('plugins', {
    pluginId: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description || '',
    author: manifest.author || '',
    permissions: manifest.permissions || [],
    status: 'inactive',
    configuration: {},
    dependencies: manifest.dependencies || [],
  });
  registry.register(manifest);
  await audit.log({
    actorId: actor.id, action: 'plugin_install', category: 'plugin',
    target: manifest.id, metadata: { version: manifest.version },
  });
  return doc;
}

async function activatePlugin(pluginId, actor) {
  const doc = await db.findOne('plugins', { pluginId });
  if (!doc) throw ApiError.notFound('Plugin not installed');

  // Dependency check
  for (const dep of doc.dependencies || []) {
    const depDoc = await db.findOne('plugins', { pluginId: dep, status: 'active' });
    if (!depDoc) throw ApiError.badRequest(`Dependency not active: ${dep}`);
  }

  const sandbox = createSandbox(doc);
  registry.setStatus(pluginId, 'active');
  await db.update('plugins', doc.id, { status: 'active' });
  await audit.log({ actorId: actor.id, action: 'plugin_activate', category: 'plugin', target: pluginId });
  return { pluginId, sandbox };
}

async function deactivatePlugin(pluginId, actor) {
  const doc = await db.findOne('plugins', { pluginId });
  if (!doc) throw ApiError.notFound('Plugin not installed');
  registry.setStatus(pluginId, 'inactive');
  await db.update('plugins', doc.id, { status: 'inactive' });
  // Deactivate dependents too (fail-safe ordering)
  const { docs } = await db.find('plugins', { status: 'active' });
  for (const other of docs) {
    if ((other.dependencies || []).includes(pluginId)) {
      await deactivatePlugin(other.pluginId, actor);
    }
  }
  await audit.log({ actorId: actor.id, action: 'plugin_deactivate', category: 'plugin', target: pluginId });
  return true;
}

async function uninstallPlugin(pluginId, actor) {
  await deactivatePlugin(pluginId, actor).catch(() => {});
  const doc = await db.findOne('plugins', { pluginId });
  if (!doc) throw ApiError.notFound('Plugin not installed');
  await db.delete('plugins', doc.id);
  return true;
}

async function listPlugins() {
  const { docs } = await db.find('plugins', {}, { limit: 200 });
  return docs.map((p) => db.publicView('plugins', p));
}

async function setConfiguration(pluginId, configuration, actor) {
  const doc = await db.findOne('plugins', { pluginId });
  if (!doc) throw ApiError.notFound('Plugin not installed');
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) {
    throw ApiError.badRequest('configuration must be an object');
  }
  const updated = await db.update('plugins', doc.id, { configuration });
  await audit.log({
    actorId: actor.id, action: 'config_change', category: 'plugin',
    target: pluginId, metadata: { keys: Object.keys(configuration) },
  });
  return updated;
}

function registerPluginRoute(route) {
  activeRoutes.push(route);
}

function getActiveRoutes() {
  return activeRoutes;
}

/** Seed two example plugins so the system is demonstrable out of the box. */
async function seedExamplePlugins() {
  const count = await db.count('plugins');
  if (count > 0) return;
  await installPlugin({
    id: 'example-analytics',
    name: 'Example Analytics',
    version: '1.0.0',
    description: 'Read-only analytics helper plugin (example).',
    author: 'CNW',
    permissions: ['read:products', 'read:pages'],
    dependencies: [],
  }, { id: 'system' });
  await installPlugin({
    id: 'example-welcome',
    name: 'Welcome Banner',
    version: '1.2.0',
    description: 'Adds a configurable welcome banner (example).',
    author: 'CNW',
    permissions: ['storage:plugin'],
    dependencies: [],
  }, { id: 'system' });
}

module.exports = {
  installPlugin, activatePlugin, deactivatePlugin, uninstallPlugin,
  listPlugins, setConfiguration, registerPluginRoute, getActiveRoutes,
  seedExamplePlugins, newId: () => nanoid(12),
};
