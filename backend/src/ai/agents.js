/**
 * AI agents â€” User Agent & Admin Agent (action-capable).
 *
 * The agents are not just chat bots: they can perform *safe, permission-gated
 * actions* for the signed-in user (list products, add to cart, checkout, view
 * my orders) and for admins (overview, plan generation). Every action runs the
 * exact same service code as the UI â€” the AI never gets raw credentials and
 * can never bypass authorization (permissions are enforced at the route layer).
 */
const { chatCompletion } = require('./ai.service');
const { checkPrompt } = require('./prompt-guard');
const db = require('../services/db.service');
const ApiError = require('../utils/api-error');
const audit = require('../services/audit.service');

const USER_SYSTEM_PROMPT = `You are the CNW User Assistant for "CNW — Create New Website".
Help users with: exploring the website, SEARCHING the site (products, designs, pages, code store items),
product information, design suggestions (formal, 3D, 3D animation, interactive), page suggestions,
navigation, pricing questions, orders and general assistance. Be concise and friendly.
Never invent prices for custom work. When the user wants an action or a search, reply with a
JSON tool call in this exact shape and nothing else:
{"tool":"search_site","params":{"query":"3D designs"}}
Supported tools: search_site (params.query = what to find), list_products,
add_to_cart (params.query = product/design name), get_cart, checkout, my_orders, my_subscriptions.
You cannot access other users' data.`;

const ADMIN_SYSTEM_PROMPT = `You are the CNW Admin Assistant for "CNW — Create New Website".
Help admins with: website creation planning, page creation, design generation concepts,
architecture planning (backend/frontend/APIs/databases), content generation, product
management assistance, system analysis, dashboard assistance and project planning.
You also have LIVE access to website data: payments, orders, users, subscriptions, messages.
ALWAYS respond with structured, actionable answers (headings + bullet lists).
You are an advisor: you NEVER execute code and cannot bypass authorization.
When asked to generate a website plan, output STRICT JSON:
{"name":string,"pages":[{"slug":string,"title":string,"sections":[string]}],"design":string,"features":[string],"notes":string}
When the admin asks about live data or wants a report, reply with a JSON tool call in this exact shape:
{"tool":"get_overview","params":{}}
Supported tools: get_overview, get_users_info, get_orders_info, get_payments_info,
get_subscriptions_info, get_messages_info, build_report (params.dataset = users|orders|payments|contact-messages|subscriptions|errors, params.format = xls|csv|pdf).`;
/** The canonical, permission-gated action executor. */
async function executeUserAction({ action, params = {}, user, agent = 'user' }) {
  const isAdminRole = user && ['admin', 'super_admin'].includes(user.role);
  switch (action) {
    case 'list_products': {
      const { docs } = await db.find('products', { status: 'published' }, { limit: 50 });
      return { ok: true, message: `We have ${docs.length} published package(s).`, data: docs };
    }
    case 'add_to_cart': {
      const query = String(params.query || '').trim();
      if (!query) throw ApiError.badRequest('Which package would you like to add?');
      const { docs } = await db.find('products', { status: 'published' }, { limit: 50 });
      const product = pickProduct(docs, query);
      if (!product) throw ApiError.notFound('No matching package found. Try "3D Design", "Formal", "3D Animation" or "Interactive".');
      await addToCart(user.id, product, Math.max(1, Math.min(9, parseInt(params.quantity, 10) || 1)));
      return { ok: true, message: `"${product.name}" (${product.currency} ${product.price}) added to your cart.`, data: product };
    }
    case 'get_cart': {
      const cart = await getOrCreateCart(user.id);
      const total = cart.items.reduce((s, it) => s + Number(it.unitPrice) * Number(it.quantity), 0);
      return { ok: true, message: `Your cart has ${cart.items.length} item(s), total ${total.toFixed(2)} ${cart.items[0]?.currency || 'USD'}.`, data: cart };
    }
    case 'checkout': {
      const { executeCheckout } = require('../controllers/order.controller');
      const { order, payment } = await executeCheckout(user.id, {
        provider: String(params.provider || 'manual'),
        billingName: String(params.billingName || user.name || ''),
      });
      return {
        ok: true,
        message: `Order ${order.id.slice(0, 8).toUpperCase()} placed (${order.status}). Confirm the payment from the Payment page or Dashboard -> Orders.`,
        data: { order, payment: { id: payment.id, amount: payment.amount, currency: payment.currency } },
      };
    }
    case 'my_orders': {
      const { docs, total } = await db.find('orders', { userId: user.id }, { limit: 20, sort: '-createdAt' });
      return { ok: true, message: `You have ${total} order(s).`, data: docs };
    }
    case 'admin_overview': {
      if (!isAdminRole) throw ApiError.forbidden('This action requires an admin role');
      const [users, products, orders, payments] = await Promise.all([
        db.count('users'), db.count('products'), db.count('orders'), db.count('payments'),
      ]);
      return { ok: true, message: 'Live system overview fetched.', data: { users, products, orders, payments } };
    }
    case 'search_site': {
      // User AI: search the whole site — products, designs, pages, code store.
      const q = String(params.query || '').toLowerCase().trim();
      if (!q) throw ApiError.badRequest('What would you like to find?');
      const [products, designs, pagesRes, codeItems] = await Promise.all([
        db.find('products', { status: 'published' }, { limit: 50 }),
        db.find('designs', { status: 'active' }, { limit: 50 }),
        db.find('pages', { status: 'published' }, { limit: 50 }),
        db.find('code_products', { status: 'published' }, { limit: 50 }),
      ]);
      const hit = (s) => String(s || '').toLowerCase().includes(q);
      const results = {
        products: products.docs.filter((p) => hit(p.name) || hit(p.description) || hit(p.designType)).slice(0, 5)
          .map((p) => ({ name: p.name, price: p.price, currency: p.currency, url: `/user/design-detail.html?design=${p.designType}` })),
        designs: designs.docs.filter((d) => hit(d.name) || hit(d.concept)).slice(0, 5).map((d) => ({ name: d.name, type: d.designType })),
        pages: pagesRes.docs.filter((p) => hit(p.title) || hit(p.slug)).slice(0, 5).map((p) => ({ title: p.title, slug: p.slug })),
        codeStore: codeItems.docs.filter((c) => hit(c.title) || hit(c.description) || (c.tags || []).some(hit)).slice(0, 5)
          .map((c) => ({ title: c.title, language: c.language, price: c.price, url: `/user/store.html?item=${c.id}` })),
      };
      const total = results.products.length + results.designs.length + results.pages.length + results.codeStore.length;
      return {
        ok: true,
        message: total
          ? `Found ${total} result(s) for "${params.query}" across products, designs, pages and the code store.`
          : `No results for "${params.query}". Try "3D design", "pricing", "glow card" or ask me anything else.`,
        data: results,
      };
    }
    case 'my_subscriptions': {
      const { docs } = await db.find('subscriptions', { userId: user.id }, { limit: 20, sort: '-createdAt' });
      return { ok: true, message: docs.length
        ? `You have ${docs.length} subscription(s): ${docs.map((s) => `${s.planName} (${s.status}, renews ${s.renewsAt ? String(s.renewsAt).slice(0, 10) : '—'})`).join('; ')}.`
        : 'You have no subscriptions yet — see the Subscriptions page for weekly/monthly update plans.',
        data: docs };
    }
    case 'admin_overview':
    case 'get_overview': {
      if (!isAdminRole) throw ApiError.forbidden('This action requires an admin role');
      const [usersC, productsC, ordersC, paymentsC, subsC, msgsC] = await Promise.all([
        db.count('users'), db.count('products'), db.count('orders'), db.count('payments'),
        db.count('subscriptions'), db.count('contact_messages'),
      ]);
      const { docs: paidPays } = await db.find('payments', { status: 'succeeded' }, { limit: 1000 });
      const revenue = paidPays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      return {
        ok: true,
        message: `Live overview: ${usersC} users, ${productsC} products, ${ordersC} orders, ${paymentsC} payments (revenue ${revenue.toFixed(2)} USD), ${subsC} subscriptions, ${msgsC} contact messages.`,
        data: { users: usersC, products: productsC, orders: ordersC, payments: paymentsC, revenue: Math.round(revenue * 100) / 100, subscriptions: subsC, contactMessages: msgsC },
      };
    }
    case 'get_users_info':
    case 'get_orders_info':
    case 'get_payments_info':
    case 'get_subscriptions_info':
    case 'get_messages_info': {
      if (!isAdminRole) throw ApiError.forbidden('This action requires an admin role');
      const tableMap = {
        get_users_info: ['users', 'user'],
        get_orders_info: ['orders', 'order'],
        get_payments_info: ['payments', 'payment'],
        get_subscriptions_info: ['subscriptions', 'subscription'],
        get_messages_info: ['contact_messages', 'contact message'],
      };
      const [table, label] = tableMap[action];
      const { docs, total } = await db.find(table, {}, { limit: 10, sort: '-createdAt' });
      return { ok: true, message: `Latest ${total} ${label}(s) (showing up to 10). Full exports are available in Reports.`, data: docs };
    }
    case 'build_report': {
      if (!isAdminRole) throw ApiError.forbidden('This action requires an admin role');
      const dataset = ['users', 'orders', 'payments', 'contact-messages', 'subscriptions', 'errors'].includes(params.dataset)
        ? params.dataset : 'users';
      const format = ['xls', 'csv', 'pdf'].includes(params.format) ? params.format : 'xls';
      const url = `/api/admin/reports/${dataset}?format=${format}`;
      return {
        ok: true,
        message: `Your ${dataset} report is ready (${format.toUpperCase()}). Download it here: ${url} — it will download as an Excel-compatible file.`,
        data: { dataset, format, url },
      };
    }
    default:
      throw ApiError.badRequest(`Unknown action: ${action}`);
  }
}

async function getOrCreateCart(userId) {
  let cart = await db.findOne('carts', { userId });
  if (!cart) cart = await db.create('carts', { userId, items: [] });
  return cart;
}

async function addToCart(userId, product, qty = 1) {
  const cart = await getOrCreateCart(userId);
  const existing = cart.items.find((it) => it.productId === product.id);
  if (existing) existing.quantity = Math.min(99, existing.quantity + qty);
  else {
    cart.items.push({
      productId: product.id,
      name: product.name,
      unitPrice: Number(product.price),
      currency: product.currency || 'USD',
      quantity: qty,
    });
  }
  await db.update('carts', cart.id, { items: cart.items });
  return cart;
}

function pickProduct(docs, query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return null;
  const byExact = docs.find((p) => [p.slug, p.name].some((v) => String(v || '').toLowerCase() === q));
  if (byExact) return byExact;
  const byDesign = docs.find((p) => String(p.designType || '').toLowerCase() === q);
  if (byDesign) return byDesign;
  const bySlug = docs.find((p) => String(p.slug || '').toLowerCase().includes(q));
  if (bySlug) return bySlug;
  return docs.find((p) => String(p.name || '').toLowerCase().includes(q));
}

function defaultPlanJson() {
  return JSON.stringify({
    name: 'Suggested Website Plan',
    pages: [
      { slug: 'home', title: 'Home', sections: ['hero', 'features', 'cta'] },
      { slug: 'about', title: 'About', sections: ['story', 'team'] },
      { slug: 'contact', title: 'Contact', sections: ['form', 'map'] },
    ],
    design: 'modern with 3D hero section',
    features: ['responsive layout', 'contact form', 'SEO basics'],
    notes: 'Offline plan (no OPENAI_API_KEY configured). Review and approve in the AI Builder.',
  }, null, 2);
}

/** Offline intent router - turns natural language into real tool executions. */
async function runIntent(agent, message, user) {
  const lower = String(message).toLowerCase();

  if (agent === 'admin') {
    if (/(build|creat|generat|plan|make|design).*(website|site|page|app)|website plan/.test(lower)) {
      return { reply: defaultPlanJson(), actions: [{ kind: 'plan', label: 'Structured website plan generated' }] };
    }
    const { data } = await executeUserAction({ action: 'admin_overview', user, agent });
    const line = `Hi ${user.name || 'admin'}, this CNW instance currently has ${data.users} user(s), ${data.products} product(s), ${data.orders} order(s) and ${data.payments} payment(s). Describe a website/page to plan and I will draft a structured plan (set OPENAI_API_KEY for full AI responses).`;
    return { reply: line, actions: [{ kind: 'overview', label: 'Fetched live overview' }] };
  }

  // --- User agent: intent -> real actions ---

  if (/(checkout|place (my )?order|confirm.*order|complete.*purchase|buy now|make (my )?order)/.test(lower)) {
    const outcome = await executeUserAction({ action: 'checkout', params: { provider: 'manual', billingName: user.name }, user });
    return { reply: outcome.message, actions: [{ kind: 'checkout', label: 'Order created (see Dashboard -> Orders)' }] };
  }

  if (/(my orders|my purchases|order history|did i buy|track.*order|my order)/.test(lower)) {
    const outcome = await executeUserAction({ action: 'my_orders', user });
    const list = (!outcome.data || !outcome.data.length)
      ? 'You have no orders yet.'
      : outcome.data.map((o) => `* Order ${String(o.id).slice(0, 8)} - ${Number(o.total).toFixed(2)} ${o.currency} - ${o.status} (${o.createdAt})`).join('\n');
    return { reply: list, actions: [{ kind: 'orders', label: 'Fetched your orders' }] };
  }

  // NOTE: add-to-cart must be checked BEFORE the plain "my cart" view branch,
  // otherwise phrases like "add 3D Design to my cart" are read as "my cart".
  const addMatch = /(?:add|put|buy|order|get|purchase)\s+(?:the\s+)?([A-Za-z0-9 \-]{2,60}?)\s*(?:package)?\s*(?:to\s+)?(?:my\s+)?cart/.exec(lower);
  if (addMatch) {
    const query = (addMatch[1] || '').trim();
    try {
      const outcome = await executeUserAction({ action: 'add_to_cart', params: { query }, user });
      return { reply: outcome.message + ' Say "checkout" when ready.', actions: [{ kind: 'add_to_cart', label: `Added "${(outcome.data?.name || query)}" to cart` }] };
    } catch (err) {
      return { reply: err.message, actions: [] };
    }
  }

  if (/(my cart|what.*in.*cart|show.*cart)/.test(lower)) {
    const cart = await getOrCreateCart(user.id);
    const listItems = cart.items.map((it) => `* ${it.quantity} x ${it.name} - ${Number(it.unitPrice * it.quantity).toFixed(2)} ${it.currency}`).join('\n');
    const total = cart.items.reduce((s, it) => s + Number(it.unitPrice) * Number(it.quantity), 0);
    return {
      reply: `Your cart:\n${listItems || '(empty)'}\nTotal: ${total.toFixed(2)} ${cart.items[0]?.currency || 'USD'}`,
      actions: [{ kind: 'cart', label: 'Fetched your cart' }],
    };
  }

  if (/(price|pricing|packages|product|design types?|what do you (offer|have)|list)/.test(lower)) {
    const outcome = await executeUserAction({ action: 'list_products', user });
    const list = (outcome.data || []).map((p) => `* ${p.name} - ${p.currency} ${Number(p.price).toFixed(2)} (${p.designType}, ${p.availability})`).join('\n');
    return { reply: `Here are our packages:\n${list || 'No published packages yet.'}`, actions: [{ kind: 'list_products', label: `Listed ${(outcome.data || []).length} products` }] };
  }

  return { reply: offlineReply('user', message, user), actions: [] };
}

/**
 * Main entry: send a message to an agent.
 * Returns { conversation, reply, actions } where actions is an array of
 * { kind, label } describing any real actions the agent performed.
 */
async function sendMessage({ agent, user, conversationId, message, ip }) {
  const guard = checkPrompt(message, agent);
  if (!guard.allowed) throw ApiError.badRequest(guard.reason);

  const systemPrompt = agent === 'admin' ? ADMIN_SYSTEM_PROMPT : USER_SYSTEM_PROMPT;

  let conversation;
  if (conversationId) {
    conversation = await db.findById('conversations', conversationId);
    if (!conversation || conversation.userId !== user.id) throw ApiError.notFound('Conversation not found');
  } else {
    conversation = await db.create('conversations', {
      userId: user.id,
      agent,
      title: String(message).slice(0, 60),
      messages: [],
    });
  }

  const history = conversation.messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
  const result = await chatCompletion({
    systemPrompt,
    messages: [...history, { role: 'user', content: guard.value }],
  });

  let reply;
  let actions = [];

  if (result.offline) {
    const outcome = await runIntent(agent, guard.value, user).catch((err) => ({ reply: err.message, actions: [] }));
    reply = outcome.reply;
    actions = outcome.actions || [];
  } else {
    reply = result.content || '';
    // If the model emitted a JSON tool call, execute it (same code as the UI).
    const toolOutcome = await tryToolCall(reply, user, agent);
    if (toolOutcome) {
      actions = toolOutcome.actions;
      if (toolOutcome.confirm) reply = `${reply}\n\n[OK ${toolOutcome.confirm}]`;
    }
  }

  if (!reply || !reply.trim()) reply = offlineReply(agent, guard.value, user);

  const messages = [
    ...conversation.messages,
    { role: 'user', content: guard.value, at: new Date().toISOString() },
    { role: 'assistant', content: reply, at: new Date().toISOString() },
  ].slice(-100);

  const updated = await db.update('conversations', conversation.id, { messages });

  audit.log({
    actorId: user.id, action: 'ai_request', category: 'general',
    target: `${agent}-agent`, ip,
    metadata: { offline: result.offline, actionCount: actions.length },
  });

  return { conversation: updated, reply, actions };
}

/** Extract + execute a JSON tool call emitted by an online model reply. */
async function tryToolCall(reply, user, agent) {
  const m = /\{\s*"tool"\s*:\s*"([a-z_]+)"[\s\S]*?\}/.exec(reply || '');
  if (!m) return null;
  let params = {};
  const paramMatch = /"params"\s*:\s*(\{[\s\S]*?\})/.exec(reply);
  if (paramMatch) { try { params = JSON.parse(paramMatch[1]); } catch { params = {}; } }
  try {
    const outcome = await executeUserAction({ action: m[1], params, user, agent });
    return { actions: [{ kind: m[1], label: outcome.message }], confirm: outcome.message };
  } catch (err) {
    return { actions: [{ kind: m[1], label: `Action failed: ${err.message}` }], confirm: `Action failed: ${err.message}` };
  }
}


/** AI-assisted error fixing - used by Admin -> Security -> Error log. */
async function askErrorFix({ report, user }) {
  const promptText = `Review this error from the CNW website and give a concise, actionable fix (what failed, probable cause, suggested code change):\nPath: ${report.path || '-'} (${report.method || 'GET'})\nCode: ${report.code || '-'}\nMessage: ${report.message || '-'}\nStack (truncated): ${(report.stack || '-').slice(0, 1200)}`;

  if (report.aiSuggestion) return { suggestion: report.aiSuggestion, offline: false };

  const guard = checkPrompt(promptText, 'admin');
  if (!guard.allowed) return { suggestion: 'Request rejected by the prompt safety filter.', offline: true };

  const result = await chatCompletion({
    systemPrompt: ADMIN_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: guard.value }],
    maxTokens: 1200,
  });
  if (result.offline || !result.content) {
    return { suggestion: heuristicFix(report), offline: true };
  }
  return { suggestion: result.content, offline: false };
}

/** Deterministic fix guidance used when no OPENAI_API_KEY is configured. */
function heuristicFix(report) {
  const msg = `${report.code || ''} ${report.message || ''}`.toLowerCase();
  if (msg.includes('cors')) return 'The CORS policy rejected a request. Add the frontend origin to CORS_ORIGINS in backend/.env or serve the built frontend from the same origin.';
  if (msg.includes('rate_limit')) return 'Rate limit hit. Raise the limiter max in src/middleware/rate-limit.middleware.js or wait for the window to reset.';
  if (msg.includes('mongodb') || msg.includes('mongo') || msg.includes('mongoose')) return 'MongoDB connection failed. Check MONGODB_URI / network. The app now falls back to the JSON store automatically, so also verify DB_TYPE and credentials.';
  if (msg.includes('not found') || msg.includes('404')) return 'A route or resource was not found. Verify the URL and that the resource exists (Admin -> Pages/Designs/Products).';
  if (msg.includes('validation') || msg.includes('validator')) return 'A request failed validation. Check required fields/lengths against the route validators in backend/src/routes/.';
  return 'Check the full stack trace in Admin -> Security -> Error log. Common fixes: verify environment variables (JWT_SECRET, encryption keys), confirm MongoDB reachability, ensure the frontend origin is in CORS_ORIGINS.';
}

/** Deterministic assistant used when no OPENAI_API_KEY is configured. */
function offlineReply(agent, message, user) {
  const lower = message.toLowerCase();
  if (agent === 'admin') {
    return 'Describe the website/page/architecture you want and I will draft a structured plan (set OPENAI_API_KEY for full AI responses).';
  }
  if (lower.includes('price') || lower.includes('cost')) {
    return 'Our design packages: Formal from $299, 3D Design from $599, 3D Animation from $899, Interactive from $749. See the Pricing page for full details.';
  }
  if (lower.includes('design')) {
    return 'We offer four design types: Formal, 3D, 3D Animation and Interactive. Visit the Designs page to explore each one with live examples.';
  }
  return `Hi ${user.name || 'there'}! I am the CNW agent (offline mode). I can help with exploring the site, design types, pricing, and I can add packages to your cart or place your order - just tell me, e.g. "add 3D Design to my cart" or "checkout".`;
}

async function listConversations(user, agent) {
  const query = { userId: user.id };
  if (agent) query.agent = agent;
  const { docs } = await db.find('conversations', query, { limit: 50, sort: '-updatedAt' });
  return docs.map((c) => ({ id: c.id, title: c.title, agent: c.agent, updatedAt: c.updatedAt }));
}

/**
 * Validate a structured AI plan (AI Builder workflow step).
 * Returns { valid, errors, plan }.
 */
function validatePlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object') return { valid: false, errors: ['Plan must be an object'] };
  if (typeof plan.name !== 'string' || !plan.name.trim()) errors.push('Plan name is required');
  if (!Array.isArray(plan.pages) || plan.pages.length === 0) errors.push('At least one page is required');
  else {
    plan.pages.forEach((p, i) => {
      if (!p || typeof p.slug !== 'string' || !/^[a-z0-9-]+$/.test(p.slug)) {
        errors.push(`Page ${i + 1}: slug must be lowercase alphanumeric/dashes`);
      }
    });
  }
  return { valid: errors.length === 0, errors, plan };
}

/** Available agent actions (for the frontend quick-action UI). */
function listAgentActions() {
  return [
    { action: 'list_products', label: 'List packages', for: 'user' },
    { action: 'add_to_cart', label: 'Add to cart', for: 'user' },
    { action: 'get_cart', label: 'My cart', for: 'user' },
    { action: 'checkout', label: 'Place order', for: 'user' },
    { action: 'my_orders', label: 'My orders', for: 'user' },
    { action: 'admin_overview', label: 'System overview', for: 'admin' },
  ];
}

module.exports = {
  sendMessage, listConversations, validatePlan,
  executeUserAction, listAgentActions, askErrorFix, pickProduct, addToCart,
};
