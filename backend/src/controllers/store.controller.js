/**
 * Code store controller — sellable CSS/HTML/JS snippets with live previews.
 * Like the freelance reference store: cards with price + add-to-cart, and a
 * detail view that shows the actual code AND renders the live result.
 */
const db = require('../services/db.service');
const asyncHandler = require('../utils/async-handler');
const ApiError = require('../utils/api-error');

/** Seed the store with starter snippets on first open (dev/demo convenience). */
const SEED = [
  {
    title: 'Glow Card Hover', language: 'css',
    description: 'Neon glowing hover effect for product cards — pure CSS, no JS.',
    price: 15, tags: ['css', 'hover', 'neon'],
    code: '.glow-card{border-radius:16px;transition:transform .25s,box-shadow .25s}\n.glow-card:hover{transform:translateY(-6px) scale(1.02);box-shadow:0 0 24px rgba(0,206,201,.6),0 12px 40px rgba(0,0,0,.4)}',
    previewHtml: '<!DOCTYPE html><html><head><style>body{font-family:sans-serif;background:#0b0f1a;display:grid;place-items:center;min-height:100vh}.glow-card{width:220px;padding:24px;border-radius:16px;background:#10162a;color:#e8ecf5;border:1px solid rgba(255,255,255,.1);transition:transform .25s,box-shadow .25s}.glow-card:hover{transform:translateY(-6px) scale(1.02);box-shadow:0 0 24px rgba(0,206,201,.6),0 12px 40px rgba(0,0,0,.4)}</style></head><body><div class="glow-card"><h3>Glow Card</h3><p>Hover me</p></div></body></html>',
  },
  {
    title: 'Animated Pricing Badge', language: 'html',
    description: 'Self-contained "SALE" badge with pulse animation — copy & paste ready.',
    price: 10, tags: ['html', 'badge', 'sale'],
    code: '<div class="sale-badge">SALE -35%</div>\n<style>\n.sale-badge{display:inline-block;background:#e17055;color:#fff;font-weight:700;padding:6px 14px;border-radius:999px;animation:pulse 1.2s infinite}\n@keyframes pulse{50%{transform:scale(1.08)}}\n</style>',
    previewHtml: '<!DOCTYPE html><html><head><style>body{font-family:sans-serif;background:#fff;display:grid;place-items:center;min-height:100vh}.sale-badge{display:inline-block;background:#e17055;color:#fff;font-weight:700;padding:6px 14px;border-radius:999px;animation:pulse 1.2s infinite}@keyframes pulse{50%{transform:scale(1.08)}}</style></head><body><div class="sale-badge">SALE -35%</div></body></html>',
  },
  {
    title: 'Live Character Counter', language: 'js',
    description: 'WhatsApp-style character counter for any textarea — 10 lines of vanilla JS.',
    price: 12, tags: ['js', 'form', 'counter'],
    code: "function attachCounter(textarea, max = 4000) {\n  const counter = document.createElement('span');\n  counter.style.cssText = 'display:block;text-align:right;font-size:.75rem;color:#888';\n  textarea.after(counter);\n  const update = () => counter.textContent = textarea.value.length + ' / ' + max;\n  textarea.addEventListener('input', update);\n  update();\n}",
    previewHtml: '<!DOCTYPE html><html><head><style>body{font-family:sans-serif;background:#fff;display:grid;place-items:center;min-height:100vh}textarea{width:260px;height:90px}span{display:block;text-align:right;font-size:.75rem;color:#888;width:260px}</style></head><body><div><textarea id="t" maxlength="120"></textarea><span id="c"></span></div><script>const t=document.getElementById("t"),c=document.getElementById("c");const update=()=>c.textContent=t.value.length+" / 120";t.addEventListener("input",update);update();</script></body></html>',
  },
];

async function seedIfEmpty() {
  const { total } = await db.find('code_products', {}, { limit: 1 });
  if (total > 0) return;
  for (const item of SEED) await db.create('code_products', { ...item, currency: 'USD', status: 'published' });
}

/** True when the user paid for a code product (a paid order contains it). */
async function hasPurchased(userId, productId) {
  if (!userId) return false;
  const { docs } = await db.find('orders', { userId, status: 'paid' }, { limit: 100, sort: '-createdAt' });
  return docs.some((o) => (o.items || []).some((it) => it.productId === productId));
}

/** Strip the paid payload (code + preview) from listing cards. */
function publicCard(doc) {
  const { code, previewHtml, ...card } = doc;
  return card;
}

/**
 * Decide whether this viewer may see the actual source code of a snippet:
 * free items (price 0) are open; otherwise only the buyer or an admin.
 */
async function canViewCode(doc, req) {
  if (!doc) return false;
  if (Number(doc.price) === 0) return true;
  const role = req.user && req.user.role;
  if (['admin', 'super_admin'].includes(role)) return true;
  return hasPurchased(req.user && req.user.id, doc.id);
}

/** GET /api/code-products?lang=css — public store listing (seeds on first open). */
exports.list = asyncHandler(async (req, res) => {
  await seedIfEmpty();
  const query = { status: 'published' };
  if (req.query.lang) query.language = String(req.query.lang);
  const { docs, total } = await db.find('code_products', query, { limit: 100, sort: '-createdAt' });
  // Listing never includes the paid payload — the source code is served
  // per-product only to buyers (see exports.get).
  res.json({ success: true, docs: docs.map(publicCard), total });
});

/** GET /api/code-products/:id — metadata public; code/preview gated to buyers. */
exports.get = asyncHandler(async (req, res) => {
  const doc = await db.findById('code_products', req.params.id);
  if (!doc || doc.status !== 'published') throw ApiError.notFound('Code product not found');
  const allowed = await canViewCode(doc, req);
  if (allowed) return res.json({ success: true, doc });
  res.json({ success: true, doc: publicCard(doc), locked: true });
});

/** GET /api/admin/code-products — admin: list all (including drafts). */
exports.adminList = asyncHandler(async (req, res) => {
  const result = await db.find('code_products', {}, {
    page: parseInt(req.query.page, 10) || 1,
    limit: 50,
    sort: '-createdAt',
  });
  res.json({ success: true, ...result });
});

/** POST /api/code-products — admins publish new code products. */
exports.create = asyncHandler(async (req, res) => {
  const doc = await db.create('code_products', {
    title: String(req.body.title || '').trim().slice(0, 120),
    language: ['css', 'html', 'js', 'full'].includes(req.body.language) ? req.body.language : 'css',
    description: String(req.body.description || '').slice(0, 2000),
    code: String(req.body.code || '').slice(0, 50000),
    previewHtml: String(req.body.previewHtml || '').slice(0, 100000),
    price: Math.max(0, Number(req.body.price) || 0),
    currency: String(req.body.currency || 'USD').slice(0, 3).toUpperCase(),
    tags: Array.isArray(req.body.tags) ? req.body.tags.map((t) => String(t).slice(0, 30)).slice(0, 8) : [],
    authorId: req.user.id,
    status: 'published',
  });
  res.status(201).json({ success: true, doc });
});

/** PUT /api/code-products/:id — admins update. */
exports.update = asyncHandler(async (req, res) => {
  const patch = {};
  for (const key of ['title', 'description', 'code', 'previewHtml', 'status']) {
    if (req.body[key] !== undefined) patch[key] = String(req.body[key]).slice(0, 100000);
  }
  if (req.body.price !== undefined) patch.price = Math.max(0, Number(req.body.price) || 0);
  if (req.body.language !== undefined && ['css', 'html', 'js', 'full'].includes(req.body.language)) patch.language = req.body.language;
  const doc = await db.update('code_products', req.params.id, patch);
  if (!doc) throw ApiError.notFound('Code product not found');
  res.json({ success: true, doc });
});

/** DELETE /api/code-products/:id — admins remove. */
exports.remove = asyncHandler(async (req, res) => {
  await db.delete('code_products', req.params.id);
  res.json({ success: true });
});