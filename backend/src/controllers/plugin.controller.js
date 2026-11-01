/** Plugin controller. */
const pluginManager = require('../plugins/plugin-manager');
const asyncHandler = require('../utils/async-handler');

exports.list = asyncHandler(async (_req, res) => {
  res.json({ success: true, plugins: await pluginManager.listPlugins() });
});

exports.install = asyncHandler(async (req, res) => {
  const doc = await pluginManager.installPlugin(req.body, req.user);
  res.status(201).json({ success: true, plugin: doc });
});

exports.activate = asyncHandler(async (req, res) => {
  res.json({ success: true, result: await pluginManager.activatePlugin(req.params.id, req.user) });
});

exports.deactivate = asyncHandler(async (req, res) => {
  res.json({ success: true, result: await pluginManager.deactivatePlugin(req.params.id, req.user) });
});

exports.uninstall = asyncHandler(async (req, res) => {
  res.json({ success: true, result: await pluginManager.uninstallPlugin(req.params.id, req.user) });
});

exports.configure = asyncHandler(async (req, res) => {
  res.json({ success: true, plugin: await pluginManager.setConfiguration(req.params.id, req.body.configuration, req.user) });
});
