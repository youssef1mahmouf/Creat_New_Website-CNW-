// Check all JS files for duplicate const declarations
const fs = require('fs');
const path = require('path');

console.log('=== Checking for duplicate const declarations ===\n');

const backendDir = path.join(__dirname, 'backend', 'src');
const issues = [];

function checkFileForDuplicates(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const declared = new Map();
  
  lines.forEach((line, index) => {
    const match = line.match(/^\s*const\s+(\w+)\s*=\s*require\s*\(/);
    if (match) {
      const name = match[1];
      if (declared.has(name)) {
        issues.push({
          file: filePath,
          line: index + 1,
          variable: name,
          message: `Duplicate 'const ${name}' at line ${index + 1} (first declared at line ${declared.get(name)})`
        });
      } else {
        declared.set(name, index + 1);
      }
    }
  });
}

// Check all JS files in backend/src
function scanDirectory(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      scanDirectory(filePath);
    } else if (file.endsWith('.js')) {
      try {
        checkFileForDuplicates(filePath);
      } catch (e) {
        console.log(`Error reading ${filePath}: ${e.message}`);
      }
    }
  }
}

scanDirectory(backendDir);

if (issues.length === 0) {
  console.log('✓ No duplicate const declarations found!');
} else {
  console.log(`❌ Found ${issues.length} duplicate declaration issue(s):\n`);
  issues.forEach(issue => {
    const relativePath = path.relative(__dirname, issue.file);
    console.log(`  ${relativePath}:${issue.line}`);
    console.log(`    ${issue.message}`);
    console.log('');
  });
}

process.exit(issues.length > 0 ? 1 : 0);
