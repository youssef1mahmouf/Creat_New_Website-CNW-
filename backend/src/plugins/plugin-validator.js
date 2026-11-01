/**
 * Plugin Validator — validates manifests before anything is loaded.
 * A plugin must declare explicit permissions from the known permission set.
 */
const { PERMISSIONS } = require('../config/constants');

const PLUGIN_PERMISSIONS = new Set([
  ...Object.keys(PERMISSIONS),
  'read:user', 'read:products', 'read:pages', 'read:orders',
  'http:route', 'storage:plugin', 'ai:request',
]);

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') return { valid: false, errors: ['Manifest must be an object'] };
  if (!ID_PATTERN.test(String(manifest.id || ''))) errors.push('id must be lowercase alphanumeric/dashes (2-49 chars)');
  if (!manifest.name || typeof manifest.name !== 'string') errors.push('name is required');
  if (!SEMVER.test(String(manifest.version || ''))) errors.push('version must be semver (x.y.z)');
  if (!Array.isArray(manifest.permissions)) errors.push('permissions must be an array');
  else {
    for (const p of manifest.permissions) {
      if (!PLUGIN_PERMISSIONS.has(p)) errors.push(`Unknown permission: ${p}`);
    }
  }
  if (Array.isArray(manifest.dependencies)) {
    for (const d of manifest.dependencies) {
      if (!ID_PATTERN.test(String(d || ''))) errors.push(`Invalid dependency id: ${d}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

module.exports = { validateManifest, PLUGIN_PERMISSIONS };
