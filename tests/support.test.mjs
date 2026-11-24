import test from 'node:test';
import assert from 'node:assert/strict';
import { getFakeFirestore } from './helpers/fake-firestore.mjs';

process.env.FIREBASE_SERVICE_ACCOUNT = '{}';
process.env.SERVER_SESSION_SECRET = 'test-session-secret-with-more-than-thirty-two-chars';
const handler = (await import('../api/support.js')).default;
function response() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = code => (res.statusCode = code, res);
  res.json = body => (res.body = body, res);
  res.setHeader = (key, value) => { res.headers[key] = value; };
  return res;
}

test('public support contact exposes only the optional email and phone fields', async () => {
  const db = getFakeFirestore();
  db.reset();
  await db.doc('settings/main').set({ supportContactEmail: 'association@yahoo.com', supportContactPhone: '+234 801 234 5678', activeMode: 'election', privateFlag: true });
  const res = response();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.contact, { email: 'association@yahoo.com', phone: '+234 801 234 5678' });
  assert.equal(JSON.stringify(res.body).includes('privateFlag'), false);
});

test('support validates lengths and email before creating a message', async () => {
  getFakeFirestore().reset();
  const res = response();
  await handler({ method: 'POST', headers: { 'x-real-ip': '10.0.0.8' }, body: { name: 'A', email: 'not-an-email', message: 'Help' } }, res);
  assert.equal(res.statusCode, 400);
});
test('support stores valid messages server-side and audits them', async () => {
  const db = getFakeFirestore();
  db.reset();
  const res = response();
  await handler({ method: 'POST', headers: { 'x-real-ip': '10.0.0.9' }, body: { name: 'A Member', email: 'member@example.org', message: 'Please help.' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
  assert.equal(res.headers.Pragma, 'no-cache');
  assert.equal(db.list('supportMessages').length, 1);
  assert.equal(db.list('auditLogs').some(row => row.action === 'SUPPORT_MESSAGE'), true);
});
