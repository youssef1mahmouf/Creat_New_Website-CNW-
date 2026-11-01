/** Admin controller — overview stats, user management, audit logs, backups. */
const db = require('../services/db.service');
const audit = require('../services/audit.service');
const backupService = require('../services/backup.service');
const authService = require('../services/auth.service');
const ApiError = require('../utils/api-error');
const asyncHandler = require('../utils/async-handler');
const { ROLES, PERMISSIONS } = require('../config/constants');
const config = require('../config/env');

exports.overview = asyncHandler(async (req, res) => {
  const [users, products, orders, payments, plugins, pages, designs, projects] = await Promise.all([
    db.count('users'), db.count('products'), db.count('orders'), db.count('payments'),
    db.count('plugins'), db.count('pages'), db.count('designs'), db.count('projects'),
  ]);
  // ---- Tohama-style dashboard figures (like admin1/admin2/payments-management) ----
  // Users: total + admins + active; admins/users currently signed in (live sessions).
  // Orders: total + per-status counts; Payments: total collected (succeeded) +
  // per-provider/per-status breakdown. All from real data, zero mocks.
  const [adminCount, activeUsers, paidOrders, pendingOrders, adminUsers] = await Promise.all([
    db.count('users', { role: { $in: [ROLES.ADMIN, ROLES.SUPER_ADMIN] } }),
    db.count('users', { status: 'active' }),
    db.count('orders', { status: 'paid' }),
    db.count('orders', { status: 'pending' }),
    db.find('users', { role: { $in: [ROLES.ADMIN, ROLES.SUPER_ADMIN] } }, { limit: 500 }),
  ]);
  const adminIds = new Set(adminUsers.docs.map((u) => u.id));
  const { docs: liveSessions } = await db.find('sessions', { revoked: false }, { limit: 1000 });
  const now = Date.now();
  const liveByUser = new Map(); // userId -> latest session
  for (const s of liveSessions) {
    if (!s.userId || !s.expiresAt || new Date(s.expiresAt).getTime() < now) continue;
    const prev = liveByUser.get(s.userId);
    if (!prev || new Date(s.createdAt) > new Date(prev.createdAt)) liveByUser.set(s.userId, s);
  }
  const signedInUsers = liveByUser.size;
  const signedInAdmins = [...liveByUser.keys()].filter((id) => adminIds.has(id)).length;

  const { docs: allOrders } = await db.find('orders', {}, { limit: 1000, sort: '-createdAt' });
  const { docs: allPayments } = await db.find('payments', {}, { limit: 1000, sort: '-createdAt' });
  const ordersByStatus = allOrders.reduce((m, o) => {
    const k = o.status || 'unknown';
    m[k] = (m[k] || 0) + 1;
    return m;
  }, {});
  const money = (list) => Math.round(list.reduce((s, p) => s + (Number(p.amount) || 0), 0) * 100) / 100;
  const succeeded = allPayments.filter((p) => p.status === 'succeeded');
  const totalPayments = money(succeeded);
  const paymentsByStatus = allPayments.reduce((m, p) => {
    const k = p.status || 'unknown';
    m[k] = m[k] || { count: 0, total: 0 };
    m[k].count += 1;
    m[k].total = Math.round((m[k].total + (Number(p.amount) || 0)) * 100) / 100;
    return m;
  }, {});
  const paymentsByProvider = allPayments.reduce((m, p) => {
    const k = p.provider || 'manual';
    m[k] = m[k] || { count: 0, total: 0 };
    m[k].count += 1;
    m[k].total = Math.round((m[k].total + (Number(p.amount) || 0)) * 100) / 100;
    return m;
  }, {});
  const currencyTotals = succeeded.reduce((m, p) => {
    const k = p.currency || 'USD';
    m[k] = Math.round(((m[k] || 0) + (Number(p.amount) || 0)) * 100) / 100;
    return m;
  }, {});

  const { docs: recentOrders } = await db.find('orders', {}, { limit: 5, sort: '-createdAt' });
  res.json({
    success: true,
    stats: {
      users, admins: adminCount, activeUsers, signedInUsers, signedInAdmins,
      products, orders, paidOrders, pendingOrders, payments: allPayments.length,
      totalPayments, plugins, pages, designs, projects,
    },
    ordersByStatus,
    paymentsByStatus,
    paymentsByProvider,
    currencyTotals,
    dbType: db.type,
    recentOrders: recentOrders.map((o) => ({ id: o.id, total: o.total, status: o.status, createdAt: o.createdAt })),
  });
});

exports.listUsers = asyncHandler(async (req, res) => {
  const result = await db.find('users', {}, {
    page: parseInt(req.query.page, 10) || 1,
    limit: 50,
  });
  res.json({ success: true, ...result, docs: result.docs.map((u) => authService.toPublicUser(u)) });
});

exports.getUser = asyncHandler(async (req, res) => {
  const user = await db.findById('users', req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  res.json({ success: true, user: authService.toPublicUser(user) });
});

exports.createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role, accountType, permissions } = req.body;

  // Validate required fields
  if (!name || String(name).trim().length < 2) {
    throw ApiError.badRequest('Name is required (minimum 2 characters)');
  }
  if (!email || !String(email).trim()) {
    throw ApiError.badRequest('Email is required');
  }

  // Normalize email
  const normalizedEmail = authService.slugEmail(email);

  // Check if user already exists
  const existing = await db.findOne('users', { email: normalizedEmail });
  if (existing) {
    throw ApiError.conflict('An account with this email already exists');
  }

  // Validate role if provided
  let userRole = role || ROLES.USER;
  let userAccountType = accountType || userRole;
  if (req.user.role !== ROLES.SUPER_ADMIN && (userRole !== ROLES.USER && userRole !== ROLES.ADMIN)) {
    throw ApiError.forbidden('Only super admins can assign admin or super admin roles');
  }
  if (![ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(userRole)) {
    throw ApiError.badRequest('Invalid role specified');
  }
  if (req.user.role !== ROLES.SUPER_ADMIN && userRole === ROLES.SUPER_ADMIN) {
    throw ApiError.forbidden('Only super admins can create super admin accounts');
  }

  if (!password) throw ApiError.badRequest('Password is required');
  const { hashPassword, validatePasswordStrength } = require('../security/password');
  const passwordErrors = validatePasswordStrength(password);
  if (passwordErrors.length) throw ApiError.badRequest('Password does not meet requirements', passwordErrors);
  const passwordHash = await hashPassword(password);

  // Create the user
  const user = await db.create('users', {
    name: String(name).trim().slice(0, 100),
    email: normalizedEmail,
    role: userRole,
    accountType: userRole,
    passwordHash,
    status: 'active',
    permissions: permissions || [],
    lastLoginAt: null,
    phone: String(req.body.phone || '').slice(0, 40),
    whatsapp: String(req.body.whatsapp || '').slice(0, 40),
    business: String(req.body.business || '').slice(0, 120),
    businessType: String(req.body.businessType || '').slice(0, 60),
    sitePurpose: String(req.body.sitePurpose || '').slice(0, 500),
    budget: String(req.body.budget || '').slice(0, 60),
    bio: String(req.body.bio || '').slice(0, 1000),
  });

  // Log the action
  await audit.log({
    actorId: req.user.id,
    actorEmail: req.user.email,
    action: 'user_created',
    category: 'admin',
    target: user.id,
    metadata: { role: userRole, email: normalizedEmail },
  });

  const responseUser = authService.toPublicUser(user);
  res.status(201).json({ success: true, user: responseUser });
});

exports.updateUser = asyncHandler(async (req, res) => {
  const user = await db.findById('users', req.params.id);
  if (!user) throw ApiError.notFound('User not found');

  const patch = {};
  if (req.body.name !== undefined) patch.name = String(req.body.name).slice(0, 100);
  if (req.body.status !== undefined) {
    if (!['active', 'suspended'].includes(req.body.status)) {
      throw ApiError.badRequest('Invalid status');
    }
    // The last active super_admin can NEVER be suspended or demoted —
    // otherwise the whole site locks its owners out (and nobody can sign
    // back in to fix it). Temporary suspensions are always reversible.
    if (req.body.status === 'suspended' && user.role === ROLES.SUPER_ADMIN && user.status === 'active') {
      const activeSupers = await db.count('users', { role: ROLES.SUPER_ADMIN, status: 'active' });
      if (activeSupers <= 1) {
        throw ApiError.forbidden('You cannot suspend the last active super admin — at least one must stay active to sign in.');
      }
    }
    patch.status = req.body.status;
    // Suspension is NEVER permanent: record when it started so it can be
    // auto-lifted, and notify the user by email immediately.
    patch.suspendedAt = req.body.status === 'suspended' ? new Date().toISOString() : null;
  }
  // Only super_admin can change roles; admins cannot escalate themselves.
  if (req.body.role !== undefined) {
    if (req.user.role !== ROLES.SUPER_ADMIN) {
      throw ApiError.forbidden('Only super admins can change roles');
    }
    if (![ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(req.body.role)) {
      throw ApiError.badRequest('Invalid role');
    }
    // Demoting the last active super_admin would lock everyone out.
    if (user.role === ROLES.SUPER_ADMIN && req.body.role !== ROLES.SUPER_ADMIN && user.status === 'active') {
      const activeSupers = await db.count('users', { role: ROLES.SUPER_ADMIN, status: 'active' });
      if (activeSupers <= 1) {
        throw ApiError.forbidden('You cannot demote the last active super admin.');
      }
    }
    patch.role = req.body.role;
    patch.accountType = req.body.role;
  }
  // Extra permissions (extensible, explicit grants only)
  if (req.body.permissions !== undefined) {
    if (req.user.role !== ROLES.SUPER_ADMIN) throw ApiError.forbidden('Only super admins can manage permissions');
    if (!Array.isArray(req.body.permissions)) throw ApiError.badRequest('permissions must be an array');
    const valid = req.body.permissions.filter((p) => Object.keys(PERMISSIONS).includes(p));
    patch.permissions = valid;
  }

  const updated = await db.update('users', req.params.id, patch);
  await audit.log({
    actorId: req.user.id, actorEmail: req.user.email, action: 'user_updated',
    category: 'admin', target: user.id, metadata: { fields: Object.keys(patch) },
  });
  // Notify the user immediately when their account is suspended or restored.
  // Best-effort: a mail failure must never break the admin request. The mail
  // always lands in the mail_outbox table (Admin → Security) for review.
  if (patch.status === 'suspended' && updated && updated.email) {
    try {
      const mail = require('../services/mail.service');
      await mail.sendMail({
        to: updated.email,
        subject: '[CNW] Your account was suspended — action required',
        text: `Hello ${updated.name || 'there'},\n\n`
          + `Your CNW account (${updated.email}) was suspended by an administrator on ${patch.suspendedAt || new Date().toISOString()}.\n`
          + `Suspensions on CNW are TEMPORARY and auto-lift after a short review window (5 minutes).\n\n`
          + `If you believe this is a mistake, reply to this email or contact support.\n\n— CNW Security`,
      });
    } catch { /* mail failure is recorded in the outbox, never thrown */ }
  } else if (patch.status === 'active' && user.status === 'suspended' && updated && updated.email) {
    try {
      const mail = require('../services/mail.service');
      await mail.sendMail({
        to: updated.email,
        subject: '[CNW] Your account was restored — you can sign in',
        text: `Hello ${updated.name || 'there'},\n\n`
          + `Good news: your CNW account (${updated.email}) is active again and you can sign in.\n\n— CNW Security`,
      });
    } catch { /* mail failure is recorded in the outbox, never thrown */ }
  }
  res.json({ success: true, user: authService.toPublicUser(updated) });
});

exports.deleteUser = asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) throw ApiError.badRequest('You cannot delete your own account');
  const ok = await db.delete('users', req.params.id);
  if (!ok) throw ApiError.notFound('User not found');
  await audit.log({
    actorId: req.user.id, actorEmail: req.user.email, action: 'user_deleted',
    category: 'admin', target: req.params.id,
  });
  res.json({ success: true });
});

exports.auditLogs = asyncHandler(async (req, res) => {
  const result = await audit.list({
    page: parseInt(req.query.page, 10) || 1,
    category: req.query.category,
    action: req.query.action,
  });
  res.json({ success: true, ...result });
});

exports.createBackup = asyncHandler(async (req, res) => {
  const backup = await backupService.createBackup(req.user.id);
  res.status(201).json({ success: true, backup });
});

exports.listBackups = asyncHandler(async (_req, res) => {
  res.json({ success: true, backups: await backupService.listBackups() });
});

exports.restoreBackup = asyncHandler(async (req, res) => {
  const mode = req.body.mode === 'merge' ? 'merge' : 'empty-only';
  const result = await backupService.restoreBackup(req.body.name, req.user.id, { mode });
  res.json({ success: true, result });
});

exports.listOrders = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const filter = {};
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.userId) filter.userId = String(req.query.userId);
  const result = await db.find('orders', filter, { page, limit, sort: '-createdAt' });
  res.json({ success: true, ...result });
});

exports.listFiles = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const result = await db.find('chat_attachments', {}, { page, limit, sort: '-createdAt' });
  res.json({
    success: true, ...result,
    docs: result.docs.map((a) => ({
      id: a.id, name: a.name, mime: a.mime, size: a.size, kind: a.kind,
      ownerId: a.ownerId, messageId: a.messageId, createdAt: a.createdAt,
    })),
  });
});

exports.systemStatus = asyncHandler(async (_req, res) => {
  const brute = require('../middleware/rate-limit.middleware');
  res.json({
    success: true,
    system: {
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      memory: process.memoryUsage(),
      db: db.info,
      redis: { kind: brute.getBruteAdapter().kind, enabled: require('../config/env').redis.enabled },
      mail: { enabled: require('../config/env').mail.enabled },
      ai: {
        userChat: require('../config/env').features.aiUserChat,
        adminChat: require('../config/env').features.aiAdminChat,
        builder: require('../config/env').features.aiBuilder,
        provider: require('../ai/ai.service').activeProvider().provider,
      },
    },
  });
});

exports.getSettings = asyncHandler(async (_req, res) => {
  const { docs } = await db.find('settings', {}, { limit: 200 });
  res.json({ success: true, settings: Object.fromEntries(docs.map((d) => [d.key, d.value])) });
});

exports.updateSettings = asyncHandler(async (req, res) => {
  const input = req.body.settings || {};
  const updated = [];
  for (const [key, value] of Object.entries(input).slice(0, 50)) {
    const cleanKey = String(key).slice(0, 80);
    if (!/^[a-zA-Z0-9_.-]+$/.test(cleanKey)) continue;
    const existing = await db.findOne('settings', { key: cleanKey });
    if (existing) await db.update('settings', existing.id, { value, updatedBy: req.user.id });
    else await db.create('settings', { key: cleanKey, value, updatedBy: req.user.id });
    updated.push(cleanKey);
  }
  await audit.log({
    actorId: req.user.id, actorEmail: req.user.email, action: 'settings_updated',
    category: 'admin', metadata: { keys: updated },
  });
  res.json({ success: true, updated });
});
