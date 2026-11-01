/** Roles & permissions — extensible by design. */

const ROLES = {
  USER: 'user',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
};

const ROLE_HIERARCHY = {
  user: 0,
  admin: 1,
  super_admin: 2,
};

const PERMISSIONS = {
  // users
  'read:self': ['user', 'admin', 'super_admin'],
  'read:users': ['admin', 'super_admin'],
  'write:users': ['admin', 'super_admin'],
  'delete:users': ['super_admin'],
  // products / categories
  'read:products': ['user', 'admin', 'super_admin'],
  'write:products': ['admin', 'super_admin'],
  'delete:products': ['admin', 'super_admin'],
  // orders / payments
  'read:own-orders': ['user', 'admin', 'super_admin'],
  'read:orders': ['admin', 'super_admin'],
  'write:orders': ['user', 'admin', 'super_admin'],
  'read:payments': ['admin', 'super_admin'],
  'refund:payments': ['admin', 'super_admin'],
  'approve:payments': ['admin', 'super_admin'],
  // content
  'read:pages': ['user', 'admin', 'super_admin'],
  'write:pages': ['admin', 'super_admin'],
  'write:designs': ['admin', 'super_admin'],
  'read:designs': ['user', 'admin', 'super_admin'],
  'write:projects': ['user', 'admin', 'super_admin'],
  // coupons
  'manage:coupons': ['admin', 'super_admin'],
  // files / downloads
  'read:files': ['admin', 'super_admin'],
  'manage:files': ['admin', 'super_admin'],
  // plugins
  'read:plugins': ['admin', 'super_admin'],
  'manage:plugins': ['super_admin'],
  // ai
  'use:user-ai': ['user', 'admin', 'super_admin'],
  'use:admin-ai': ['admin', 'super_admin'],
  // security / audit
  'read:audit': ['admin', 'super_admin'],
  'manage:security': ['super_admin'],
  // settings / system
  'read:settings': ['admin', 'super_admin'],
  'write:settings': ['super_admin'],
  // permissions
  'manage:permissions': ['super_admin'],
};

function hasPermission(role, permission) {
  const allowed = PERMISSIONS[permission];
  if (!allowed) return false;
  return allowed.includes(role);
}

function hasRoleAtLeast(role, minimumRole) {
  return (ROLE_HIERARCHY[role] ?? -1) >= (ROLE_HIERARCHY[minimumRole] ?? 99);
}

module.exports = { ROLES, ROLE_HIERARCHY, PERMISSIONS, hasPermission, hasRoleAtLeast };
