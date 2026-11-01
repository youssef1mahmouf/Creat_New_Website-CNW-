const {
  timestamps, users, sessions, categories, products, carts, orders,
  chat_messages, chat_attachments, code_products, subscriptions, coupons,
  coupon_redemptions, entitlements, download_logs, refunds, payment_events, settings,
} = require('./definitions');

const payments = {
  fields: {
    orderId: { type: 'ref', required: true },
    userId: { type: 'ref', required: true },
    provider: { type: 'string', default: 'manual' }, // manual | instapay | wallet | (future PSPs)
    providerRef: { type: 'string', default: '' },
    amount: { type: 'number', required: true },
    currency: { type: 'string', default: 'USD' },
    status: { type: 'string', default: 'pending' }, // pending|processing|succeeded|failed|cancelled|refunded|partially_refunded
    // ---- Local-payment review flow (InstaPay / e-wallet) ----
    // The FINANCIAL state machine above is untouched. reviewStatus tracks the
    // admin verification of a customer-submitted payment reference:
    // none -> submitted -> approved | rejected (rejected may be resubmitted).
    reviewStatus: { type: 'string', default: 'none' },
    customerReference: { type: 'string', default: '' }, // customer-submitted transfer reference
    payerName: { type: 'string', default: '' },
    submittedAt: { type: 'date', default: null },
    reviewedBy: { type: 'ref', default: null },
    reviewedAt: { type: 'date', default: null },
    rejectionReason: { type: 'string', default: '' },
    // Optional proof attachment (receipt screenshot / PDF), stored on disk via
    // storage.service; only admins may download it.
    proofName: { type: 'string', default: '' },
    proofMime: { type: 'string', default: '' },
    proofSize: { type: 'number', default: 0 },
    proofStorageKey: { type: 'string', default: '' },
    refundedAmount: { type: 'number', default: 0 },
    idempotencyKey: { type: 'string', default: '' },
    // Billing details may contain PII -> AES-256-GCM encrypted at rest.
    billingDetails: { type: 'object', default: {}, encrypted: true },
    ...timestamps,
  },
  indexes: [
    { fields: { orderId: 1 } }, { fields: { status: 1 } }, { fields: { providerRef: 1 } },
    { fields: { idempotencyKey: 1 } }, { fields: { reviewStatus: 1, status: 1 } },
  ],
  publicFields: ['id', 'orderId', 'amount', 'currency', 'status', 'provider', 'createdAt'],
};

const plugins = {
  fields: {
    pluginId: { type: 'string', required: true },
    name: { type: 'string', required: true },
    version: { type: 'string', default: '1.0.0' },
    description: { type: 'string', default: '' },
    author: { type: 'string', default: '' },
    permissions: { type: 'array', default: [] },
    status: { type: 'string', default: 'inactive' }, // active | inactive | blocked
    configuration: { type: 'object', default: {} },
    dependencies: { type: 'array', default: [] },
    ...timestamps,
  },
  indexes: [{ fields: { pluginId: 1 }, options: { unique: true } }],
  publicFields: ['id', 'pluginId', 'name', 'version', 'description', 'author', 'permissions', 'status'],
};

const projects = {
  fields: {
    ownerId: { type: 'ref', required: true },
    name: { type: 'string', required: true },
    type: { type: 'string', default: 'website' }, // website|app|system
    plan: { type: 'object', default: {} }, // structured AI/architect plan
    status: { type: 'string', default: 'draft' },
    ...timestamps,
  },
  indexes: [{ fields: { ownerId: 1 } }],
  publicFields: null,
};

const pages = {
  fields: {
    title: { type: 'string', required: true },
    slug: { type: 'string', required: true },
    content: { type: 'object', default: {} },
    projectId: { type: 'ref', default: null },
    status: { type: 'string', default: 'draft' },
    ...timestamps,
  },
  indexes: [{ fields: { slug: 1 }, options: { unique: true } }],
  publicFields: null,
};

const designs = {
  fields: {
    name: { type: 'string', required: true },
    designType: { type: 'string', required: true }, // formal|3d|3d-animation|interactive
    concept: { type: 'string', default: '' },
    capabilities: { type: 'array', default: [] },
    price: { type: 'number', default: 0 },
    availability: { type: 'string', default: 'available' },
    status: { type: 'string', default: 'active' },
    data: { type: 'object', default: {} }, // editor canvas data (Figma-like)
    ...timestamps,
  },
  indexes: [{ fields: { designType: 1 } }],
  publicFields: null,
};

const conversations = {
  fields: {
    userId: { type: 'ref', required: true },
    agent: { type: 'string', default: 'user' }, // user | admin
    title: { type: 'string', default: 'New conversation' },
    messages: { type: 'array', default: [] },
    ...timestamps,
  },
  indexes: [{ fields: { userId: 1 } }, { fields: { agent: 1 } }],
  publicFields: null,
};

const audit_logs = {
  fields: {
    actorId: { type: 'ref', default: null },
    actorEmail: { type: 'string', default: '' },
    action: { type: 'string', required: true },
    category: { type: 'string', default: 'general' }, // auth|admin|plugin|security|config
    target: { type: 'string', default: '' },
    ip: { type: 'string', default: '' },
    userAgent: { type: 'string', default: '' },
    success: { type: 'boolean', default: true },
    metadata: { type: 'object', default: {} },
    createdAt: { type: 'date', default: timestamps.createdAt.default, immutable: true },
  },
  indexes: [{ fields: { actorId: 1 } }, { fields: { action: 1 } }, { fields: { createdAt: -1 } }],
  publicFields: null,
};

const permissions = {
  fields: {
    subjectType: { type: 'string', required: true }, // user | role | plugin
    subjectId: { type: 'string', required: true },
    permission: { type: 'string', required: true },
    granted: { type: 'boolean', default: true },
    grantedBy: { type: 'ref', default: null },
    ...timestamps,
  },
  indexes: [{ fields: { subjectId: 1, permission: 1 }, options: { unique: true } }],
  publicFields: null,
};

module.exports = {
  users, sessions, categories, products, carts, orders, payments,
  plugins, projects, pages, designs, conversations, audit_logs, permissions,
  chat_messages, chat_attachments, code_products, subscriptions, coupons,
  coupon_redemptions, entitlements, download_logs, refunds, payment_events, settings,
};
