/** Integration tests: registration, login, sessions, reset. */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { db, startApp, api, registerAndLogin } = require('./helpers');

let ctx;

before(async () => { ctx = await startApp(); });
after(async () => { ctx.server.close(); await db.flush(); });

describe('registration & login', () => {
  test('health endpoint works', async () => {
    const res = await api(ctx.baseUrl, 'GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  test('register creates a user (role user, no hash leaked)', async () => {
    const email = `reg${Date.now()}@test.local`;
    const res = await api(ctx.baseUrl, 'POST', '/auth/register', {
      body: { name: 'Reg User', email, password: 'GoodPassword1' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.json.user.role, 'user');
    assert.ok(!JSON.stringify(res.json).includes('passwordHash'));
  });

  test('weak password is rejected', async () => {
    const res = await api(ctx.baseUrl, 'POST', '/auth/register', {
      body: { name: 'Weak', email: `weak${Date.now()}@test.local`, password: 'short' },
    });
    assert.equal(res.status, 400);
  });

  test('duplicate email is rejected', async () => {
    const creds = { name: 'Dup', email: `dup${Date.now()}@test.local`, password: 'GoodPassword1' };
    await api(ctx.baseUrl, 'POST', '/auth/register', { body: creds });
    const res = await api(ctx.baseUrl, 'POST', '/auth/register', { body: creds });
    assert.equal(res.status, 409);
  });

  test('login succeeds with correct credentials', async () => {
    const { token } = await registerAndLogin(ctx.baseUrl);
    assert.ok(token);
  });

  test('login fails with wrong password', async () => {
    const email = `wrongpw${Date.now()}@test.local`;
    await api(ctx.baseUrl, 'POST', '/auth/register', {
      body: { name: 'X', email, password: 'GoodPassword1' },
    });
    const res = await api(ctx.baseUrl, 'POST', '/auth/login', {
      body: { email, password: 'WrongPassword9' },
    });
    assert.equal(res.status, 401);
  });

  test('login fails for unknown user', async () => {
    const res = await api(ctx.baseUrl, 'POST', '/auth/login', {
      body: { email: 'ghost@nowhere.local', password: 'WhateverPass1' },
    });
    assert.equal(res.status, 401);
  });

  test('/auth/me requires token and returns user', async () => {
    const { token, email } = await registerAndLogin(ctx.baseUrl);
    const noAuth = await api(ctx.baseUrl, 'GET', '/auth/me');
    assert.equal(noAuth.status, 401);
    const res = await api(ctx.baseUrl, 'GET', '/auth/me', { token });
    assert.equal(res.status, 200);
    assert.equal(res.json.user.email, email);
    assert.ok(!JSON.stringify(res.json).includes('passwordHash'));
  });

  test('logout revokes the session', async () => {
    const { token } = await registerAndLogin(ctx.baseUrl);
    const out = await api(ctx.baseUrl, 'POST', '/auth/logout', { token });
    assert.equal(out.status, 200);
    const me = await api(ctx.baseUrl, 'GET', '/auth/me', { token });
    assert.equal(me.status, 401);
  });
});

describe('password reset flow', () => {
  test('forgot -> reset -> login with new password; token single-use', async () => {
    const email = `reset${Date.now()}@test.local`;
    await api(ctx.baseUrl, 'POST', '/auth/register', {
      body: { name: 'ResetUser', email, password: 'OldPassword1' },
    });
    const forgot = await api(ctx.baseUrl, 'POST', '/auth/forgot-password', { body: { email } });
    assert.equal(forgot.status, 200);
    const token = forgot.json.devToken;
    assert.ok(token, 'dev token available in test mode');

    const reset = await api(ctx.baseUrl, 'POST', '/auth/reset-password', {
      body: { token, password: 'NewPassword99' },
    });
    assert.equal(reset.status, 200);

    const reuse = await api(ctx.baseUrl, 'POST', '/auth/reset-password', {
      body: { token, password: 'AgainPassword99' },
    });
    assert.equal(reuse.status, 400, 'reset token must be single-use');

    const login = await api(ctx.baseUrl, 'POST', '/auth/login', {
      body: { email, password: 'NewPassword99' },
    });
    assert.equal(login.status, 200);
  });

  test('expired reset token is rejected', async () => {
    const email = `expired${Date.now()}@test.local`;
    await api(ctx.baseUrl, 'POST', '/auth/register', {
      body: { name: 'Exp', email, password: 'OldPassword1' },
    });
    const forgot = await api(ctx.baseUrl, 'POST', '/auth/forgot-password', { body: { email } });
    const user = await db.findOne('users', { email });
    await db.update('users', user.id, { resetTokenExpiresAt: new Date(Date.now() - 1000).toISOString() });
    const reset = await api(ctx.baseUrl, 'POST', '/auth/reset-password', {
      body: { token: forgot.json.devToken, password: 'NewPassword99' },
    });
    assert.equal(reset.status, 400);
  });
});

