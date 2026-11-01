/**
 * Migration: 001_initial_schema
 * Creates indexes for MongoDB. JSON store needs no migration (schemaless files).
 * Run manually with: node database/migrations/001_initial_schema.js
 */
async function up() {
  const config = require('../../src/config/env');
  if (config.db.type !== 'mongodb' || !config.db.mongoUri) {
    // eslint-disable-next-line no-console
    console.log('Migration skipped: JSON database mode.');
    return;
  }
  const mongoose = require('mongoose');
  require('../../src/models/index.js');
  await mongoose.connect(config.db.mongoUri, { dbName: config.db.mongoDbName });
  // Mongoose auto-creates indexes on model compilation (autoIndex default true).
  // eslint-disable-next-line no-console
  console.log('Indexes ensured for all models.');
  await mongoose.disconnect();
}

if (require.main === module) {
  up().then(() => process.exit(0)).catch((e) => {
    // eslint-disable-next-line no-console
    console.error('Migration failed:', e.message);
    process.exit(1);
  });
}

module.exports = { up };
