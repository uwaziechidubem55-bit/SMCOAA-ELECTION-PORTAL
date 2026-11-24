import test from 'node:test';
import assert from 'node:assert/strict';
import { signToken } from '../api/_session.js';
import { getFakeFirestore } from './helpers/fake-firestore.mjs';

process.env.FIREBASE_SERVICE_ACCOUNT = '{}';
process.env.SERVER_SESSION_SECRET = 'test-session-secret-with-more-than-thirty-two-chars';
process.env.STAFF_PASSWORD = 'strong-test-password';
const login = (await import('../api/staff-login.js')).default;
const data = (await import('../api/staff-data.js')).default;
function response() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = code => (res.statusCode = code, res);
  res.json = body => (res.body = body, res);
  res.setHeader = (key, value) => { res.headers[key] = value; };
  return res;
}

test('Election View refuses forged prefix-style tokens', async () => {
  const res = response();
  await data({ method: 'POST', headers: { authorization: 'Bearer staff_forged_token' }, body: { action: 'listMembers' } }, res);
  assert.equal(res.statusCode, 401);
});
test('Election View accepts a valid signed, unexpired staff session', async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = signToken({ role: 'staff', iat: now, exp: now + 3600 }, process.env.SERVER_SESSION_SECRET);
  const res = response();
  await data({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { action: 'listMembers' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
});
test('Election View gets turnout flags only, never the private member roster', async () => {
  const db = getFakeFirestore();
  db.reset();
  db.seed('members/1990-1', { name: 'Ada Obi', sex: 'Female', set: 1990, sn: 1, hasVoted: true });
  const now = Math.floor(Date.now() / 1000);
  const token = signToken({ role: 'staff', iat: now, exp: now + 3600 }, process.env.SERVER_SESSION_SECRET);
  const res = response();
  await data({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { action: 'listMembers' } }, res);
  assert.deepEqual(res.body.items, [{ hasVoted: true }]);
  assert.equal(JSON.stringify(res.body).includes('Ada Obi'), false);
  assert.equal(JSON.stringify(res.body).includes('1990-1'), false);
});
test('Election View rejects a valid token for another role', async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = signToken({ role: 'admin', iat: now, exp: now + 3600 }, process.env.SERVER_SESSION_SECRET);
  const res = response();
  await data({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { action: 'listMembers' } }, res);
  assert.equal(res.statusCode, 401);
});
