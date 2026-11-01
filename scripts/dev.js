/**
 * Root dev orchestrator — starts backend (:5000) and frontend (:5173) together.
 * Usage: npm run dev   (from the repository root)
 */
const { spawn } = require('child_process');
const path = require('path');

const procs = [
  { name: 'backend', cwd: path.join(__dirname, '..', 'backend'), color: '\x1b[36m' },
  { name: 'frontend', cwd: path.join(__dirname, '..', 'frontend'), color: '\x1b[35m', cmd: 'npx', args: ['vite'] },
];

const children = [];

for (const p of procs) {
  const isWin = process.platform === 'win32';
  const child = spawn(p.cmd || 'npm', p.args || ['run', 'dev'], {
    cwd: p.cwd,
    shell: isWin,
    env: { ...process.env, FORCE_COLOR: '1' },
  });
  children.push(child);
  const tag = `${p.color}[${p.name}]\x1b[0m`;
  child.stdout.on('data', (d) => process.stdout.write(d.toString().split('\n').map((l) => l && `${tag} ${l}`).join('\n')));
  child.stderr.on('data', (d) => process.stderr.write(d.toString().split('\n').map((l) => l && `${tag} ${l}`).join('\n')));
  child.on('exit', (code) => {
    // eslint-disable-next-line no-console
    console.log(`${tag} exited with code ${code}`);
    shutdown(code);
  });
}

function shutdown(code = 0) {
  for (const c of children) {
    try { c.kill(); } catch { /* already gone */ }
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
