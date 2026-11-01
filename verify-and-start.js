// Comprehensive CNW startup checker and fixer
const fs = require('fs');
const path = require('path');

console.log('=== CNW Web Startup Checker ===\n');

const projectRoot = __dirname;
const backendDir = path.join(projectRoot, 'backend');
const frontendDir = path.join(projectRoot, 'frontend');

let hasErrors = false;

// Helper to check file
function checkFile(dir, filename, description) {
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) {
    console.log(`❌ ${description} NOT FOUND: ${filename}`);
    hasErrors = true;
    return null;
  }
  console.log(`✓ ${description}: ${filename}`);
  return filePath;
}

// Helper to check syntax
function checkSyntax(filePath, description) {
  try {
    const code = fs.readFileSync(filePath, 'utf8');
    new Function(code);
    console.log(`  ✓ ${description} syntax OK`);
    return true;
  } catch (e) {
    console.log(`  ❌ ${description} syntax ERROR: ${e.message}`);
    hasErrors = true;
    return false;
  }
}

// Check backend
console.log('--- Backend ---');
checkFile(backendDir, 'package.json', 'Backend package.json');
checkFile(backendDir, '.env', 'Backend .env');
const serverPath = checkFile(backendDir, 'server.js', 'Backend server.js');
const envJsPath = checkFile(backendDir, 'src/config/env.js', 'Backend env.js');

if (serverPath) checkSyntax(serverPath, 'server.js');
if (envJsPath) checkSyntax(envJsPath, 'env.js');

// Check node_modules
const backendNodeModules = path.join(backendDir, 'node_modules');
if (!fs.existsSync(backendNodeModules)) {
  console.log('❌ Backend node_modules MISSING - will need npm install');
  hasErrors = true;
} else {
  console.log('✓ Backend node_modules exists');
}

console.log('\n--- Frontend ---');
checkFile(frontendDir, 'package.json', 'Frontend package.json');
checkFile(frontendDir, 'vite.config.js', 'Frontend vite.config.js');
checkFile(frontendDir, 'index.html', 'Frontend index.html');
const mainJsPath = checkFile(frontendDir, 'src/main.js', 'Frontend main.js');

if (mainJsPath) checkSyntax(mainJsPath, 'main.js');

const frontendNodeModules = path.join(frontendDir, 'node_modules');
if (!fs.existsSync(frontendNodeModules)) {
  console.log('❌ Frontend node_modules MISSING - will need npm install');
  hasErrors = true;
} else {
  console.log('✓ Frontend node_modules exists');
}

// Check .env configuration
console.log('\n--- .env Configuration ---');
const envPath = path.join(backendDir, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  
  // Check critical settings
  const checks = [
    { pattern: /DB_TYPE\s*=\s*json/, name: 'DB_TYPE=json (local dev)' },
    { pattern: /PORT\s*=\s*\d+/, name: 'PORT configured' },
    { pattern: /NODE_ENV\s*=\s*development/, name: 'NODE_ENV=development' },
    { pattern: /JWT_SECRET\s*=.+/, name: 'JWT_SECRET set' },
    { pattern: /SESSION_SECRET\s*=.+/, name: 'SESSION_SECRET set' },
  ];
  
  checks.forEach(check => {
    if (check.pattern.test(envContent)) {
      console.log(`✓ ${check.name}`);
    } else {
      console.log(`❌ ${check.name} - MISSING or WRONG`);
      hasErrors = true;
    }
  });
  
  // Check for duplicate keys
  const lines = envContent.split('\n');
  const keys = {};
  lines.forEach(line => {
    const match = line.match(/^([^#=]+)=/);
    if (match) {
      const key = match[1].trim();
      if (keys[key]) {
        console.log(`⚠ Duplicate key in .env: ${key}`);
      }
      keys[key] = true;
    }
  });
}

console.log('\n=== Summary ===');
if (hasErrors) {
  console.log('⚠ Some issues found. Run the following to fix:');
  console.log('');
  console.log('  # Install dependencies');
  console.log('  cd backend && npm install');
  console.log('  cd ../frontend && npm install');
  console.log('');
  console.log('  # Start backend');
  console.log('  cd ../backend && npm start');
  console.log('');
  console.log('  # Start frontend (in new terminal)');
  console.log('  cd ../frontend && npm run dev');
} else {
  console.log('✓ All checks passed! Ready to start.');
  console.log('');
  console.log('Run: npm run dev  (from project root)');
}

process.exit(hasErrors ? 1 : 0);
