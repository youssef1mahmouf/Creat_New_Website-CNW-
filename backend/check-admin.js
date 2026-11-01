// Check admin controller
try {
  const admin = require('./src/controllers/admin.controller');
  console.log('Admin controller loaded successfully');
  console.log('Functions:', Object.keys(admin).join(', '));
  
  const usedInRoutes = ['overview', 'listUsers', 'getUser', 'createUser', 'updateUser', 'deleteUser', 'auditLogs', 'createBackup', 'listBackups', 'restoreBackup'];
  for (const func of usedInRoutes) {
    if (typeof admin[func] !== 'function') {
      console.error(`❌ Missing: ${func}`);
      process.exit(1);
    }
  }
  console.log('✅ All required functions present');
  process.exit(0);
} catch (err) {
  console.error('Error:', err.message);
  console.error(err.stack);
  process.exit(1);
}
