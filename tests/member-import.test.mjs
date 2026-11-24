import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getFakeFirestore } from './helpers/fake-firestore.mjs';

process.env.FIREBASE_SERVICE_ACCOUNT = '{}';
process.env.SERVER_SESSION_SECRET = 'test-session-secret-with-more-than-thirty-two-chars';
const { signToken } = await import('../api/_session.js');
const admin = (await import('../api/admin.js')).default;
const db = getFakeFirestore();

function makeRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = code => (res.statusCode = code, res);
  res.json = body => (res.body = body, res);
  res.setHeader = (key, value) => { res.headers[key] = value; };
  res.end = () => res;
  return res;
}
const token = () => {
  const now = Math.floor(Date.now() / 1000);
  return signToken({ role: 'admin', iat: now, exp: now + 3600 }, process.env.SERVER_SESSION_SECRET);
};
async function call(action, payload = {}, authorized = true) {
  const res = makeRes();
  await admin({
    method: 'POST',
    headers: authorized ? { authorization: `Bearer ${token()}` } : {},
    body: { action, ...payload },
  }, res);
  return res;
}

beforeEach(() => db.reset());

test('fixed roster seeding is admin-only and creates the 349 records server-side', async () => {
  const denied = await call('seedFixedRoster', {}, false);
  assert.equal(denied.statusCode, 401);
  assert.equal(db.list('members').length, 0);

  const result = await call('seedFixedRoster');
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.created, 349);
  assert.equal(db.list('members').length, 349);
  assert.equal(db.read('members/1990-1').hasVoted, false);
});

test('re-running the fixed roster seed skips existing IDs and preserves vote status and member data', async () => {
  db.seed('members/1990-1', { name: 'Existing corrected name', sex: 'Female', set: 1990, sn: 1, hasVoted: true, privateFlag: 'preserve' });
  const result = await call('seedFixedRoster');
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.created, 348);
  assert.equal(result.body.alreadyPresent, 1);
  assert.deepEqual(db.read('members/1990-1'), { name: 'Existing corrected name', sex: 'Female', set: 1990, sn: 1, hasVoted: true, privateFlag: 'preserve' });
});

test('invalid CSV import is rejected before creating any records', async () => {
  const result = await call('importMemberCsv', { csvText: 'Set,S/N,Name,Sex\n2027,0,Bad Member,Male\n' });
  assert.equal(result.statusCode, 400);
  assert.equal(db.list('members').length, 0);
});

test('future CSV imports add only new IDs, skip existing IDs, and never alter vote state', async () => {
  db.seed('members/1990-1', { name: 'Existing Voter', sex: 'Female', set: 1990, sn: 1, hasVoted: true });
  const csvText = 'Set,S/N,Name,Sex\n1990,1,Changed Name,Male\n2027,4,New Member,Female\n';
  const preview = await call('previewMemberImport', { csvText });
  assert.equal(preview.statusCode, 200);
  assert.deepEqual(preview.body.preview, { total: 2, toCreate: 1, alreadyPresent: 1 });

  const result = await call('importMemberCsv', { csvText });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.created, 1);
  assert.equal(result.body.alreadyPresent, 1);
  assert.equal(db.read('members/1990-1').name, 'Existing Voter');
  assert.equal(db.read('members/1990-1').hasVoted, true);
  assert.deepEqual(db.read('members/2027-4'), { set: 2027, sn: 4, name: 'New Member', sex: 'Female', hasVoted: false, createdAt: db.read('members/2027-4').createdAt });
});

test('CSV parser supports quoted commas and rejects duplicate voter identifiers', async () => {
  const result = await call('previewMemberImport', { csvText: 'Set,S/N,Name,Sex\n2027,4,"Member, Example",Male\n2027,4,Second Name,Female\n' });
  assert.equal(result.statusCode, 400);
  assert.equal(db.list('members').length, 0);
});
