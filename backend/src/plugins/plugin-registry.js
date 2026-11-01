/** Plugin Registry — in-memory registry of loaded plugin manifests & state. */
class PluginRegistry {
  constructor() {
    this.plugins = new Map(); // pluginId -> { manifest, status, instance }
  }

  register(manifest) {
    this.plugins.set(manifest.id, {
      manifest,
      status: 'inactive',
      instance: null,
      registeredAt: new Date().toISOString(),
    });
  }

  get(id) { return this.plugins.get(id) || null; }
  has(id) { return this.plugins.has(id); }
  setStatus(id, status) {
    const entry = this.plugins.get(id);
    if (entry) entry.status = status;
  }
  list() {
    return [...this.plugins.values()].map((p) => ({
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      author: p.manifest.author,
      permissions: p.manifest.permissions,
      dependencies: p.manifest.dependencies || [],
      status: p.status,
    }));
  }
}

module.exports = new PluginRegistry();
