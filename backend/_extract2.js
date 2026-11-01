// Extract the admin can reject test block (part 2)
const fs = require('fs');
const c = fs.readFileSync('d:/cnw/Creat_New_Website(CNW)/backend/tests/payment-review.test.js', 'utf8');
const searchStr = "test('admin can reject a wallet payment'";
const start = c.indexOf(searchStr);
if (start < 0) { console.log('NOT FOUND'); process.exit(1); }
// Find the closing of this test: look for the next "  });\n" after start
const closeIdx = c.indexOf("\n  });\n", start);
console.log('start:', start, 'closeIdx:', closeIdx);
console.log('---BLOCK---');
console.log(c.substring(start, closeIdx + 6));
console.log('---END---');
