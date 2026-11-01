/** Shared test bootstrap: isolated env + JSON db in temp dir. */
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.JWT_SECRET = 'test-jwt-secret-value-for-ci-only-1234567890';
process.env.SESSION_SECRET = 'test-session-secret-value-for-ci-only-1234567';
process.env.PASSWORD_PEPPER = 'test-pepper-for-ci-only';
process.env.ENCRYPTION_KEY_CURRENT = 'test-encryption-key-current-material-0001';
process.env.ENCRYPTION_KEY_PREVIOUS = 'test-encryption-key-previous-material-000';
process.env.OPENAI_API_KEY = ''; // force offline AI replies
process.env.GOOGLE_API_KEY = ''; // never hit real AI providers from tests
process.env.DB_TYPE = 'json';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cnw-test-'));
process.env.JSON_DB_DIR = tmp;

const db = require('../src/services/db.service');
const { createApp } = require('../src/app');

/** Seed a couple of published products so cart/checkout tests have data. */
async function seedTestData() {
  const count = await db.count('products');
  if (count > 0) return;
  await db.create('products', {
    name: 'Test 3D Package', slug: 'test-3d', description: 'test', price: 599,
    designType: '3d', status: 'published', availability: 'available', currency: 'USD',
  });
  await db.create('products', {
    name: 'Test Formal Package', slug: 'test-formal', description: 'test', price: 299,
    designType: 'formal', status: 'published', availability: 'available', currency: 'USD',
  });
}

async function startApp() {
  await seedTestData();
  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}/api` };
}

async function api(baseUrl, method, urlPath, { token, body } = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}

async function registerAndLogin(baseUrl, { email, password, name } = {}) {
  const creds = {
    email: email || `user${Date.now()}${Math.floor(Math.random() * 10000)}@test.local`,
    password: password || 'Str0ngPass!word',
    name: name || 'Test User',
  };
  await api(baseUrl, 'POST', '/auth/register', { body: creds });
  const login = await api(baseUrl, 'POST', '/auth/login', { body: creds });
  return { ...creds, token: login.json.accessToken, userId: login.json.user.id };
}

module.exports = { db, createApp, startApp, api, registerAndLogin };
