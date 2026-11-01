// Extract the admin can reject test block
const fs = require('fs');
const c = fs.readFileSync('d:/cnw/Creat_New_Website(CNW)/backend/tests/payment-review.test.js', 'utf8');
const start = c.indexOf("test('admin can reject a wallet payment'");
const end = c.indexOf("});\n  });\n", start + 100);
console.log('BLOCK START:', start, 'END:', end);
console.log('---BLOCK---');
console.log(c.substring(start, end || start + 600));
console.log('---END---');
