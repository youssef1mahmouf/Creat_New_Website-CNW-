// Synchronous test to check if the server can start
const fs = require('fs');
const path = require('path');

console.log('=== Testing CNW Backend Startup ===\n');

// Test 1: Check package.json exists
const packageJsonPath = path.join(__dirname, 'backend', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
console.log('✓ package.json found');
console.log('  Name:', packageJson.name);
console.log('  Main:', packageJson.main);

// Test 2: Check .env exists
const envPath = path.join(__dirname, 'backend', '.env');
if (fs.existsSync(envPath)) {
  console.log('✓ .env file exists');
  const envContent = fs.readFileSync(envPath, 'utf8');
  const hasDBType = envContent.includes('DB_TYPE=');
  const hasJWT = envContent.includes('JWT_SECRET=');
  const hasPort = envContent.includes('PORT=');
  console.log('  DB_TYPE configured:', hasDBType ? '✓' : '✗');
  console.log('  JWT_SECRET configured:', hasJWT ? '✓' : '✗');
  console.log('  PORT configured:', hasPort ? '✓' : '✗');
} else {
  console.log('✗ .env file MISSING');
}

// Test 3: Check node_modules
const nodeModulesPath = path.join(__dirname, 'backend', 'node_modules');
if (fs.existsSync(nodeModulesPath)) {
  const dirs = fs.readdirSync(nodeModulesPath);
  console.log('✓ node_modules exists (' + dirs.length + ' packages)');
} else {
  console.log('✗ node_modules MISSING - run: cd backend && npm install');
}

// Test 4: Check server.js syntax
const serverPath = path.join(__dirname, 'backend', 'server.js');
const serverCode = fs.readFileSync(serverPath, 'utf8');
try {
  new Function(serverCode);
  console.log('✓ server.js syntax is valid');
} catch (e) {
  console.log('✗ server.js syntax error:', e.message);
}

// Test 5: Check env.js syntax
const envJsPath = path.join(__dirname, 'backend', 'src', 'config', 'env.js');
const envCode = fs.readFileSync(envJsPath, 'utf8');
try {
  new Function(envCode);
  console.log('✓ env.js syntax is valid');
} catch (e) {
  console.log('✗ env.js syntax error:', e.message);
}

console.log('\n=== Ready to start ===');
console.log('Run: cd backend && npm start');
