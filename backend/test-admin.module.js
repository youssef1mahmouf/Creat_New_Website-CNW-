// Test script to verify admin controller loads correctly
const path = require('path');

try {
  const admin = require('./src/controllers/admin.controller');
  console.log('✓ Admin controller loaded successfully');
  console.log('  - createUser:', typeof admin.createUser);
  console.log('  - listUsers:', typeof admin.listUsers);
  console.log('  - updateUser:', typeof admin.updateUser);
  console.log('  - deleteUser:', typeof admin.deleteUser);
  console.log('');
  if (typeof admin.createUser === 'function') {
    console.log('✓ createUser is a function - ready to use!');
    process.exit(0);
  } else {
    console.log('✗ createUser is NOT a function');
    process.exit(1);
  }
} catch (error) {
  console.error('✗ Error loading admin controller:', error.message);
  console.error(error.stack);
  process.exit(1);
}
