/** AI controller — User Agent & Admin Agent endpoints. */
const aiAgents = require('../ai/agents');
const asyncHandler = require('../utils/async-handler');

exports.userChat = asyncHandler(async (req, res) => {
  const result = await aiAgents.sendMessage({
    agent: 'user',
    user: req.user,
    conversationId: req.body.conversationId,
    message: req.body.message,
    ip: req.ip,
  });
  res.json({ success: true, conversationId: result.conversation.id, reply: result.reply });
});

exports.adminChat = asyncHandler(async (req, res) => {
  const result = await aiAgents.sendMessage({
    agent: 'admin',
    user: req.user,
    conversationId: req.body.conversationId,
    message: req.body.message,
    ip: req.ip,
  });
  res.json({ success: true, conversationId: result.conversation.id, reply: result.reply });
});

exports.conversations = asyncHandler(async (req, res) => {
  const agent = req.user.role === 'user' ? 'user' : req.query.agent;
  res.json({ success: true, conversations: await aiAgents.listConversations(req.user, agent) });
});

/** AI Website Builder — plan generation + validation (no code execution). */
exports.builderPlan = asyncHandler(async (req, res) => {
  const result = await aiAgents.sendMessage({
    agent: 'admin',
    user: req.user,
    conversationId: req.body.conversationId,
    message: req.body.description,
    ip: req.ip,
  });
  // Try to parse a structured plan from the reply.
  let plan = null;
  try {
    const start = result.reply.indexOf('{');
    const end = result.reply.lastIndexOf('}');
    if (start !== -1 && end > start) plan = JSON.parse(result.reply.slice(start, end + 1));
  } catch { /* not JSON — free-form reply */ }

  const validation = plan ? aiAgents.validatePlan(plan) : { valid: false, errors: ['AI did not return a structured plan'] };
  res.json({
    success: true,
    conversationId: result.conversation.id,
    plan,
    validation,
    status: validation.valid ? 'awaiting_approval' : 'needs_revision',
  });
});

/** Admin approves a validated plan -> creates Project + Page records. */
exports.approvePlan = asyncHandler(async (req, res) => {
  const { plan } = req.body;
  const validation = aiAgents.validatePlan(plan);
  if (!validation.valid) {
    res.status(400).json({ success: false, code: 'INVALID_PLAN', errors: validation.errors });
    return;
  }
  const project = await dbCreateProject(req.user, plan);
  res.status(201).json({ success: true, project });
});

async function dbCreateProject(user, plan) {
  const db = require('../services/db.service');
  const project = await db.create('projects', {
    ownerId: user.id,
    name: plan.name,
    type: 'website',
    plan,
    status: 'approved',
  });
  for (const page of plan.pages || []) {
    await db.create('pages', {
      title: page.title || page.slug,
      slug: `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${page.slug}`.slice(0, 80),
      content: { sections: page.sections || [] },
      projectId: project.id,
      status: 'draft',
    });
  }
  return project;
}
