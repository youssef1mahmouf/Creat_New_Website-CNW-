const { spawnSync } = require('child_process');

// Test basic node
const test1 = spawnSync('node', ['-e', 'console.log("node works")'], { encoding: 'utf8', timeout: 5000 });
console.log('Test 1 (node -e):', test1.status, test1.stdout, test1.stderr);

// Test npm
const test2 = spawnSync('npm', ['--version'], { encoding: 'utf8', timeout: 5000 });
console.log('Test 2 (npm --version):', test2.status, test2.stdout, test2.stderr);

// Test running server directly
const test3 = spawnSync('node', ['server.js'], { 
  cwd: 'backend',
  encoding: 'utf8', 
  timeout: 8000,
  env: { ...process.env, NODE_ENV: 'development' }
});
console.log('Test 3 (node server.js):', test3.status);
console.log('stdout:', test3.stdout);
console.log('stderr:', test3.stderr);
