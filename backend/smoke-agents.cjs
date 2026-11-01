/* Smoke test for the new action-capable agents (dev DB). */
process.env.NODE_ENV = 'development';
const agents = require('../backend/src/ai/agents');
(async () => {
  const user = { id: 'smoke-user-01', name: 'Smoke Tester', role: 'user' };
  const r1 = await agents.sendMessage({ agent: 'user', user, message: 'What designs are available?', ip: '127.0.0.1' });
  console.log('R1 reply(len):', r1.reply.length, '| actions:', JSON.stringify(r1.actions));
  const r2 = await agents.sendMessage({ agent: 'user', user, message: 'add 3D Design to my cart', ip: '127.0.0.1' });
  console.log('R2 reply:', r2.reply.slice(0, 90), '| actions:', JSON.stringify(r2.actions));
  const r3 = await agents.sendMessage({ agent: 'user', user, message: 'checkout', ip: '127.0.0.1' });
  console.log('R3 reply:', r3.reply.slice(0, 120), '| actions:', JSON.stringify(r3.actions));
  const admin = { id: 'smoke-admin-01', name: 'Admin', role: 'admin' };
  const r4 = await agents.sendMessage({ agent: 'admin', user: admin, message: 'build me a plan for a website', ip: '' });
  console.log('R4 plan JSON starts:', r4.reply.slice(0, 40));
  console.log('agentActions:', agents.listAgentActions().length);
  const fix = await agents.askErrorFix({ report: { code: 'INTERNAL', message: 'MongoDB timeout', path: '/api/x', method: 'GET', stack: 'fake' } });
  console.log('askErrorFix offline:', fix.offline, '| starts:', fix.suggestion.slice(0, 60));
})().catch((e) => { console.error('SMOKE FAIL', e); process.exit(1); });