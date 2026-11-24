import test from 'node:test';
import assert from 'node:assert/strict';
import { getFakeFirestore } from './helpers/fake-firestore.mjs';
import { verifyToken } from '../api/_session.js';

process.env.FIREBASE_SERVICE_ACCOUNT = '{}';
process.env.SERVER_SESSION_SECRET = 'test-session-secret-with-more-than-thirty-two-chars';
process.env.ADMIN_USERNAME = 'portal-admin';
process.env.ADMIN_PASSWORD = 'safe-test-passphrase';
process.env.STAFF_PASSWORD = 'election-view-passphrase';
const adminAuth = (await import('../api/admin-auth.js')).default;
const staffLogin = (await import('../api/staff-login.js')).default;
function response() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = code => (res.statusCode = code, res);
  res.json = body => (res.body = body, res);
  res.setHeader = (key, value) => { res.headers[key] = value; };
  return res;
}

test('Admin and Election View logins issue correctly scoped signed sessions', async () => {
  getFakeFirestore().reset();
  const adminRes = response();
  await adminAuth({ method: 'POST', query: { action: 'login' }, body: { username: 'portal-admin', password: 'safe-test-passphrase' }, headers: { 'x-real-ip': '192.0.2.44' } }, adminRes);
  assert.equal(adminRes.statusCode, 200);
  assert.equal(verifyToken(adminRes.body.token, process.env.SERVER_SESSION_SECRET).role, 'admin');

  const staffRes = response();
  await staffLogin({ method: 'POST', query: {}, body: { password: 'election-view-passphrase' }, headers: { 'x-real-ip': '192.0.2.45' } }, staffRes);
  assert.equal(staffRes.statusCode, 200);
  assert.equal(verifyToken(staffRes.body.token, process.env.SERVER_SESSION_SECRET).role, 'staff');
  assert.equal(staffRes.body.token.startsWith('staff_'), false);
});
test('session verification fails closed when the signing secret is missing or too short', async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = (await import('../api/_session.js')).signToken({ role: 'admin', iat: now, exp: now + 3600 }, '');
  assert.equal(verifyToken(token, ''), null);
  assert.equal(verifyToken(token, 'too-short'), null);
});
test('Admin and Election View reject incorrect environment-configured passwords', async () => {
  getFakeFirestore().reset();
  const adminRes = response();
  await adminAuth({ method: 'POST', query: { action: 'login' }, body: { username: 'portal-admin', password: 'wrong' }, headers: { 'x-real-ip': '192.0.2.46' } }, adminRes);
  assert.equal(adminRes.statusCode, 401);
  const staffRes = response();
  await staffLogin({ method: 'POST', query: {}, body: { password: 'wrong' }, headers: { 'x-real-ip': '192.0.2.47' } }, staffRes);
  assert.equal(staffRes.statusCode, 401);
});
