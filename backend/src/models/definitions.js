/**
 * Modular model definitions.
 * Each definition is storage-agnostic: the same shape drives the JSON store
 * AND the Mongoose schema, so the app can switch databases without rewrites.
 *
 * Field types: string | number | boolean | object | array | date | ref
 * Set `encrypted: true` to store the field with AES-256-GCM (never plaintext).
 */
const now = () => new Date().toISOString();

const timestamps = {
  createdAt: { type: 'date', default: now, immutable: true },
  updatedAt: { type: 'date', default: now },
};

const users = {
  fields: {
    name: { type: 'string', default: '' },
    email: { type: 'string', required: true },
    accountType: { type: 'string', default: 'user' }, // role alias
    role: { type: 'string', default: 'user' },
    passwordHash: { type: 'string', required: true },
    status: { type: 'string', default: 'active' }, // active | suspended | pending
    permissions: { type: 'array', default: [] }, // extra grants beyond role
    locale: { type: 'string', default: 'en' }, // preferred UI language (i18n)
    phone: { type: 'string', default: '' }, // for order SMS updates (optional)
    // ---- Extended profile (Tohama-style registration: business & contact info) ----
    whatsapp: { type: 'string', default: '' }, // WhatsApp number for chat/updates
    business: { type: 'string', default: '' }, // business / brand name
    businessType: { type: 'string', default: '' }, // store | restaurant | clinic | portfolio | other
    sitePurpose: { type: 'string', default: '' }, // what the user wants to build
    budget: { type: 'string', default: '' }, // budget range for the project
    bio: { type: 'string', default: '' }, // free-text about the user
    emailVerified: { type: 'boolean', default: false },
    emailVerifyHash: { type: 'string', default: '' },
    emailVerifyExpiresAt: { type: 'date', default: null },
    resetTokenHash: { type: 'string', default: '' },
    resetTokenExpiresAt: { type: 'date', default: null },
    lastLoginAt: { type: 'date', default: null },
    ...timestamps,
  },
  indexes: [{ fields: { email: 1 }, options: { unique: true } }, { fields: { role: 1 } }],
  publicFields: ['id', 'name', 'email', 'role', 'accountType', 'status', 'locale', 'phone',
    'whatsapp', 'business', 'businessType', 'sitePurpose', 'budget', 'bio', 'createdAt', 'lastLoginAt'],
};

const sessions = {
  fields: {
    userId: { type: 'ref', required: true },
    refreshHash: { type: 'string', required: true },
    userAgent: { type: 'string', default: '' },
    ip: { type: 'string', default: '' },
    revoked: { type: 'boolean', default: false },
    expiresAt: { type: 'date', required: true },
    ...timestamps,
  },
  indexes: [{ fields: { userId: 1 } }, { fields: { refreshHash: 1 }, options: { unique: true } }],
  publicFields: ['id', 'userId', 'userAgent', 'ip', 'revoked', 'expiresAt', 'createdAt'],
};

const categories = {
  fields: {
    name: { type: 'string', required: true },
    slug: { type: 'string', required: true },
    description: { type: 'string', default: '' },
    ...timestamps,
  },
  indexes: [{ fields: { slug: 1 }, options: { unique: true } }],
  publicFields: ['id', 'name', 'slug', 'description', 'createdAt'],
};

const products = {
  fields: {
    name: { type: 'string', required: true },
    slug: { type: 'string', default: '' },
    description: { type: 'string', default: '' },
    price: { type: 'number', required: true, min: 0 },
    currency: { type: 'string', default: 'USD' },
    categoryId: { type: 'ref', default: null },
    designType: { type: 'string', default: 'formal' }, // formal|3d|3d-animation|interactive
    features: { type: 'array', default: [] },
    availability: { type: 'string', default: 'available' }, // available | limited | unavailable
    status: { type: 'string', default: 'published' }, // draft | published
    access: { type: 'string', default: 'public' }, // public | members | admin
    images: { type: 'array', default: [] },
    ...timestamps,
  },
  indexes: [{ fields: { slug: 1 } }, { fields: { designType: 1 } }, { fields: { price: 1 } }],
  publicFields: null, // full doc is public
};

const carts = {
  fields: {
    userId: { type: 'ref', required: true },
    items: { type: 'array', default: [] },
    ...timestamps,
  },
  indexes: [{ fields: { userId: 1 }, options: { unique: true } }],
  publicFields: null,
};

const orders = {
  fields: {
    userId: { type: 'ref', required: true },
    items: { type: 'array', default: [] },
    subtotal: { type: 'number', default: 0 },
    discount: { type: 'number', default: 0 },
    couponCode: { type: 'string', default: '' },
    tax: { type: 'number', default: 0 },
    total: { type: 'number', default: 0 },
    currency: { type: 'string', default: 'USD' },
    status: { type: 'string', default: 'pending' }, // pending|processing|paid|failed|cancelled|refunded|partially_refunded
    paymentId: { type: 'ref', default: null },
    idempotencyKey: { type: 'string', default: '' },
    ...timestamps,
  },
  indexes: [{ fields: { userId: 1 } }, { fields: { status: 1 } }, { fields: { idempotencyKey: 1 } }],
  publicFields: null,
};

const contact_messages = {
  fields: {
    name: { type: 'string', default: '' },
    email: { type: 'string', default: '' },
    phone: { type: 'string', default: '' },
    type: { type: 'string', default: 'general' },
    message: { type: 'string', default: '' },
    status: { type: 'string', default: 'new' }, // new | read | replied
    userId: { type: 'ref', default: null },
    ip: { type: 'string', default: '' },
    ...timestamps,
  },
  indexes: [{ fields: { status: 1 } }, { fields: { createdAt: -1 } }],
  publicFields: null,
};

const error_reports = {
  fields: {
    source: { type: 'string', default: 'server' }, // server | client
    level: { type: 'string', default: 'error' },
    code: { type: 'string', default: '' },
    message: { type: 'string', default: '' },
    stack: { type: 'string', default: '' },
    path: { type: 'string', default: '' },
    method: { type: 'string', default: '' },
    status: { type: 'number', default: 500 },
    userId: { type: 'ref', default: null },
    ip: { type: 'string', default: '' },
    userAgent: { type: 'string', default: '' },
    resolved: { type: 'boolean', default: false },
    aiSuggestion: { type: 'string', default: '' },
    metadata: { type: 'object', default: {} },
    ...timestamps,
  },
  indexes: [{ fields: { resolved: 1 } }, { fields: { source: 1 } }, { fields: { createdAt: -1 } }],
  publicFields: null,
};

const mail_outbox = {
  fields: {
    to: { type: 'string', default: '' },
    subject: { type: 'string', default: '' },
    text: { type: 'string', default: '' },
    html: { type: 'string', default: '' },
    status: { type: 'string', default: 'queued' }, // queued | sent | failed
    provider: { type: 'string', default: '' },
    attempts: { type: 'number', default: 0 },
    error: { type: 'string', default: '' },
    ...timestamps,
  },
  indexes: [{ fields: { status: 1 } }],
  publicFields: null,
};

const sms_outbox = {
  fields: {
    to: { type: 'string', default: '' },
    message: { type: 'string', default: '' },
    provider: { type: 'string', default: 'log' },
    status: { type: 'string', default: 'queued' }, // queued | sent | failed
    error: { type: 'string', default: '' },
    ...timestamps,
  },
  indexes: [{ fields: { status: 1 } }],
  publicFields: null,
};

/** WhatsApp-style user-to-user chat messages (CNW in-site chat). */
const chat_messages = {
  fields: {
    from: { type: 'ref', required: true }, // sender userId
    to: { type: 'ref', required: true }, // recipient userId
    text: { type: 'string', default: '' },
    read: { type: 'boolean', default: false },
    // ---- Rich attachments (Tohama-style: image / video / pdf / audio / doc) ----
    // Stored as metadata on the message; the binary itself lives in
    // `chat_attachments` (small files ≤2MB kept as data-URL for the JSON store).
    attachmentId: { type: 'ref', default: null },
    attachmentKind: { type: 'string', default: '' }, // image|video|pdf|audio|doc|''
    attachmentName: { type: 'string', default: '' },
    attachmentMime: { type: 'string', default: '' },
    attachmentSize: { type: 'number', default: 0 },
    archived: { type: 'boolean', default: false }, // trash/archive flag (Tohama trash-manager)
    ...timestamps,
  },
  indexes: [{ fields: { from: 1, to: 1 } }, { fields: { createdAt: -1 } }],
  publicFields: ['id', 'from', 'to', 'text', 'read', 'attachmentId', 'attachmentKind',
    'attachmentName', 'attachmentMime', 'attachmentSize', 'createdAt'],
};

/** Chat attachment binaries (file sharing: img / pdf / video / audio). */
const chat_attachments = {
  fields: {
    messageId: { type: 'ref', default: null },
    ownerId: { type: 'ref', required: true }, // uploader userId
    name: { type: 'string', default: 'file' },
    mime: { type: 'string', default: 'application/octet-stream' },
    size: { type: 'number', default: 0 },
    kind: { type: 'string', default: 'doc' }, // image|video|pdf|audio|doc
    storageKey: { type: 'string', default: '' }, // opaque key in storage.service (no filesystem path)
    dataUrl: { type: 'string', default: '' }, // legacy inline payload (new uploads store bytes on disk)
    ...timestamps,
  },
  indexes: [{ fields: { ownerId: 1 } }, { fields: { messageId: 1 } }],
  publicFields: null, // never list binaries; served per-id after auth check
};

/** Code store — sellable snippets/components (CSS/HTML/JS) with live previews. */
const code_products = {
  fields: {
    title: { type: 'string', required: true },
    language: { type: 'string', default: 'css' }, // css | html | js | full
    description: { type: 'string', default: '' },
    code: { type: 'string', default: '' }, // the actual snippet shown to buyers
    previewHtml: { type: 'string', default: '' }, // full HTML rendered in the live preview
    price: { type: 'number', default: 0 },
    currency: { type: 'string', default: 'USD' },
    tags: { type: 'array', default: [] },
    authorId: { type: 'ref', default: null },
    status: { type: 'string', default: 'published' }, // draft | published
    ...timestamps,
  },
  indexes: [{ fields: { language: 1 } }, { fields: { status: 1 } }],
  publicFields: null,
};

/** Discount coupons (Tohama coupons.html) — server-side codes with % off. */
const coupons = {
  fields: {
    code: { type: 'string', required: true },
    percent: { type: 'number', required: true, min: 1, max: 90 },
    amountOff: { type: 'number', default: 0 },
    maxUses: { type: 'number', default: null },
    usedCount: { type: 'number', default: 0 },
    perUserLimit: { type: 'number', default: 1 },
    minOrder: { type: 'number', default: 0 },
    maxDiscount: { type: 'number', default: null },
    expiresAt: { type: 'date', default: null },
    status: { type: 'string', default: 'active' }, // active | disabled
    createdBy: { type: 'ref', default: null },
    ...timestamps,
  },
  indexes: [{ fields: { code: 1 }, options: { unique: true } }],
  publicFields: ['id', 'code', 'percent', 'status'],
};

const coupon_redemptions = {
  fields: {
    couponId: { type: 'ref', required: true },
    code: { type: 'string', default: '' },
    userId: { type: 'ref', required: true },
    orderId: { type: 'ref', default: null },
    amount: { type: 'number', default: 0 },
    ...timestamps,
  },
  indexes: [{ fields: { couponId: 1, userId: 1 } }, { fields: { orderId: 1 } }],
  publicFields: null,
};

const entitlements = {
  fields: {
    userId: { type: 'ref', required: true },
    productKind: { type: 'string', default: 'code' }, // code | product | design
    productId: { type: 'ref', required: true },
    orderId: { type: 'ref', default: null },
    paymentId: { type: 'ref', default: null },
    status: { type: 'string', default: 'active' }, // active | revoked | refunded
    downloadCount: { type: 'number', default: 0 },
    lastDownloadAt: { type: 'date', default: null },
    ...timestamps,
  },
  indexes: [{ fields: { userId: 1, productKind: 1, productId: 1 } }, { fields: { orderId: 1 } }],
  publicFields: null,
};

const download_logs = {
  fields: {
    userId: { type: 'ref', required: true },
    productKind: { type: 'string', default: 'code' },
    productId: { type: 'ref', required: true },
    entitlementId: { type: 'ref', default: null },
    ip: { type: 'string', default: '' },
    userAgent: { type: 'string', default: '' },
    ...timestamps,
  },
  indexes: [{ fields: { userId: 1 } }, { fields: { productId: 1 } }],
  publicFields: null,
};

const refunds = {
  fields: {
    paymentId: { type: 'ref', required: true },
    orderId: { type: 'ref', required: true },
    userId: { type: 'ref', required: true },
    amount: { type: 'number', required: true, min: 0 },
    reason: { type: 'string', default: '' },
    status: { type: 'string', default: 'pending' }, // pending|succeeded|failed
    providerRef: { type: 'string', default: '' },
    idempotencyKey: { type: 'string', default: '' },
    ...timestamps,
  },
  indexes: [{ fields: { paymentId: 1 } }, { fields: { idempotencyKey: 1 } }],
  publicFields: null,
};

const payment_events = {
  fields: {
    paymentId: { type: 'ref', default: null },
    orderId: { type: 'ref', default: null },
    provider: { type: 'string', default: '' },
    providerRef: { type: 'string', default: '' },
    kind: { type: 'string', default: 'initiated' }, // initiated|capture|webhook|refund|cancel
    status: { type: 'string', default: '' },
    idempotencyKey: { type: 'string', default: '' },
    ...timestamps,
  },
  indexes: [{ fields: { providerRef: 1 } }, { fields: { idempotencyKey: 1 } }],
  publicFields: null,
};

const settings = {
  fields: {
    key: { type: 'string', required: true },
    value: { type: 'object', default: {} },
    updatedBy: { type: 'ref', default: null },
    ...timestamps,
  },
  indexes: [{ fields: { key: 1 }, options: { unique: true } }],
  publicFields: null,
};

const subscriptions = {
  fields: {
    userId: { type: 'ref', required: true },
    planId: { type: 'string', required: true }, // starter-weekly | pro-monthly | business-monthly
    planName: { type: 'string', default: '' },
    cadence: { type: 'string', default: 'monthly' }, // weekly | monthly
    price: { type: 'number', default: 0 },
    currency: { type: 'string', default: 'USD' },
    status: { type: 'string', default: 'active' }, // active | cancelled | expired
    startedAt: { type: 'date', default: null },
    renewsAt: { type: 'date', default: null }, // next weekly/monthly renewal
    orderId: { type: 'ref', default: null },
    paymentId: { type: 'ref', default: null },
    ...timestamps,
  },
  indexes: [{ fields: { userId: 1 } }, { fields: { status: 1 } }],
  publicFields: null,
};

module.exports = {
  timestamps, users, sessions, categories, products, carts, orders,
  contact_messages, error_reports, mail_outbox, sms_outbox,
  chat_messages, chat_attachments, code_products, subscriptions, coupons,
  coupon_redemptions, entitlements, download_logs, refunds, payment_events, settings,
};
