// Quick syntax check
const fs = require('fs');
const code = fs.readFileSync('backend/src/config/env.js', 'utf8');
try {
  new Function(code);
  console.log('✓ Syntax is valid');
} catch (e) {
  console.log('✗ Syntax error:', e.message);
  process.exit(1);
}
