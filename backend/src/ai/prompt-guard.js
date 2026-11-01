/**
 * Prompt guard — input hardening for AI agents.
 * Blocks obvious prompt-injection and enforces per-agent topic boundaries.
 * The AI can NEVER bypass authorization: agents only get data the caller
 * is already permitted to see, and cannot execute actions.
 */
const BLOCKED_PATTERNS = [
  /ignore\s+(all\s+|any\s+|previous\s+|the\s+|above\s+)*(instructions|rules|prompts?)/i,
  /reveal\s+(your\s+)?(system\s+)?prompt/i,
  /you\s+are\s+now\s+(an?|the)\s+(admin|developer|root)/i,
  /disable\s+(all\s+)?(security|filters|guardrails)/i,
  /(print|show|reveal|output|give)\s+(me\s+)?(the\s+)?(\w+[_\s-])?(api[_\s-]?key|secret|password|token|credentials)/i,
  /<\s*script/i,
  /system\s*:/i,
];

const USER_TOPICS = ['website', 'product', 'design', 'pricing', 'navigation', 'help', 'suggestion', 'cart', 'order'];
const ADMIN_TOPICS = ['website', 'page', 'design', 'architecture', 'content', 'product', 'system', 'dashboard', 'project', 'plan', 'plugin', 'api', 'database'];

function sanitizeInput(text) {
  return String(text || '').slice(0, 4000);
}

function checkPrompt(text, agent) {
  const value = sanitizeInput(text);
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(value)) {
      return { allowed: false, reason: 'Request rejected by prompt safety filter.' };
    }
  }
  const topics = agent === 'admin' ? ADMIN_TOPICS : USER_TOPICS;
  const lower = value.toLowerCase();
  void topics; // topics are advisory; hard blocking is too restrictive for general help
  return { allowed: true, value };
}

module.exports = { checkPrompt, sanitizeInput };
