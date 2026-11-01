const fs = require('fs');
let content = fs.readFileSync('d:/cnw/Creat_New_Website(CNW)/backend/tests/payment-review.test.js', 'utf8');

// Find the last valid }); that closes the describe block
// The file should end with: ...test() {...};\n});\n
// Remove everything after the final });
const lastDescribeClose = content.lastIndexOf('});\n');
if (lastDescribeClose >= 0) {
  content = content.substring(0, lastDescribeClose + 3);
}

// Also remove any trailing whitespace/newlines beyond one
content = content.replace(/\n+$/, '\n');

fs.writeFileSync('d:/cnw/Creat_New_Website(CNW)/backend/tests/payment-review.test.js', content);
console.log('CLEANED. Size:', content.length, 'bytes');
console.log('Last 60 chars:', JSON.stringify(content.substring(content.length - 60)));
