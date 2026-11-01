// Simple test to check CNW setup
const fs = require('fs');
const path = require('path');

console.log('=== CNW Backend Checker ===\n');

const backendDir = path.join(__dirname, 'backend');

// Check node_modules
const nodeModulesPath = path.join(backendDir, 'node_modules');
if (!fs.existsSync(nodeModulesPath)) {
  console.log('❌ node_modules NOT FOUND');
  console.log('   Run: cd backend && npm install');
  process.exit(1);
}

console.log('✓ node_modules exists');

// Check package.json
const pkgPath = path.join(backendDir, 'package.json');
if (!fs.existsSync(pkgPath)) {
  console.log('❌ package.json NOT FOUND');
  process.exit(1);
}
console.log('✓ package.json exists');

// Check .env
const envPath = path.join(backendDir, '.env');
if (!fs.existsSync(envPath)) {
  console.log('❌ .env NOT FOUND');
  console.log('   Run: copy .env.example .env');
  process.exit(1);
}
console.log('✓ .env exists');

// Check server.js
const serverPath = path.join(backendDir, 'server.js');
if (!fs.existsSync(serverPath)) {
  console.log('❌ server.js NOT FOUND');
  process.exit(1);
}
console.log('✓ server.js exists');

// Try to parse server.js for syntax errors
try {
  new Function(fs.readFileSync(serverPath, 'utf8'));
  console.log('✓ server.js syntax OK');
} catch (e) {
  console.log('❌ server.js syntax error:', e.message);
  process.exit(1);
}

// Try to parse env.js for syntax errors
const envJsPath = path.join(backendDir, 'src', 'config', 'env.js');
try {
  new Function(fs.readFileSync(envJsPath, 'utf8'));
  console.log('✓ env.js syntax OK');
} catch (e) {
  console.log('❌ env.js syntax error:', e.message);
  process.exit(1);
}

console.log('\n=== All checks passed ===');
console.log('Run: cd backend && npm start');
