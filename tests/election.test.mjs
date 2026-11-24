// ============================================================================
// Election clock + "who entered" — tests for the REAL api/*.js code against an
// in-memory database (tests/helpers/fake-firestore.mjs). Nothing here touches
// the real Firestore.
//
// Run:  node --import ./tests/helpers/register.mjs --test tests/election.test.mjs
// ============================================================================
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getFakeFirestore } from './helpers/fake-firestore.mjs';

process.env.FIREBASE_SERVICE_ACCOUNT = '{}';
process.env.SERVER_SESSION_SECRET = 'test-session-secret-with-more-than-thirty-two-chars';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'correct-horse-battery';

const el = await import('../api/_election.js');
const { signToken } = await import('../api/_session.js');
const studentHandler = (await import('../api/student.js')).default;
const voteHandler = (await import('../api/vote.js')).default;
const adminHandler = (await import('../api/admin.js')).default;
const maintenanceHandler = (await import('../api/maintenance.js')).default;

const db = getFakeFirestore();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function makeRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.end = () => res;
  return res;
}
async function call(handler, { query = {}, body = {}, headers = {}, method = 'POST' } = {}) {
  const res = makeRes();
  await handler({ method, query, body, headers: { 'x-real-ip': '10.0.0.1', ...headers } }, res);
  return res;
}
const token = (role) => {
  const now = Math.floor(Date.now() / 1000);
  return signToken({ role, iat: now, exp: now + 3600 }, process.env.SERVER_SESSION_SECRET);
};
const student = (action, body = {}) => call(studentHandler, { query: { action }, body });
const admin = (action, body = {}) => call(adminHandler, { body: { action, ...body }, headers: { authorization: 'Bearer ' + token('admin') } });
const superAdmin = (action, body = {}) => call(adminHandler, {
  body: { action, ...body },
  headers: { authorization: 'Bearer ' + token('admin'), 'x-super-token': token('super') },
});
const vote = (body) => call(voteHandler, { body });

// What the admin would type (Nigerian time) for a moment `ms`.
const wat = (ms) => {
  const iso = new Date(ms + el.PORTAL_UTC_OFFSET_MIN * 60 * 1000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
};
// Election Settings as the admin saves them, relative to now (in hours).
const window = (startInHours, endInHours) => {
  const now = Date.now();
  const s = wat(now + startInHours * HOUR);
  const e = wat(now + endInHours * HOUR);
  return { year: '2026/2027', startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time, isActive: false };
};

const ADA = { name: 'Ada Obi', sex: 'Female', set: 1990, sn: 1, hasVoted: false };
const BEN = { name: 'Ben Eze', sex: 'Male', set: 1991, sn: 1, hasVoted: false };

function seedPeople() {
  db.seed('members/1990-1', ADA);
  db.seed('members/1991-1', BEN);
  db.seed('candidates/c1', { name: 'Chidi', position: 'President', votes: 0 });
  db.seed('candidates/c2', { name: 'Ngozi', position: 'President', votes: 0 });
}
const adaVote = () => vote({ set: ADA.set, sn: ADA.sn, candidateIds: ['c1'] });

// The exact calls the Admin Dashboard makes.
async function activateElection() {
  await admin('saveMainSettings', { data: { activeMode: 'election' } });
  const s = db.read('settings/election') || {};
  await admin('saveMainSettings', { data: { isActive: true, startDate: s.startDate || '', startTime: s.startTime || '', endDate: s.endDate || '', endTime: s.endTime || '', year: s.year || '' } });
}
async function stopElection() {
  await admin('saveMainSettings', { data: { activeMode: 'none' } });
  await admin('saveMainSettings', { data: { isActive: false } });
}
const phase = async () => {
  el.forgetElectionSettingsCache();
  return (await student('electionStatus')).body.phase;
};

beforeEach(() => {
  db.reset();
  el.forgetElectionSettingsCache();
});

// ---------------------------------------------------------------------------
// 1. Reading the dates the admin typed
// ---------------------------------------------------------------------------
test('dates typed by the admin are read as Nigerian time (UTC+1)', () => {
  assert.equal(el.parsePortalDateTime('2026-11-20', '10:30'), Date.UTC(2026, 10, 20, 9, 30));
  assert.equal(el.parsePortalDateTime('2026-11-20', '00:15'), Date.UTC(2026, 10, 19, 23, 15));
  assert.equal(el.parsePortalDateTime('2026-11-20', '10:30:45'), Date.UTC(2026, 10, 20, 9, 30, 45));
});

test('a missing time falls back like the student page always did; a missing date means "not set"', () => {
  assert.equal(el.parsePortalDateTime('2026-11-20', '', '00:00'), Date.UTC(2026, 10, 19, 23, 0));
  assert.equal(el.parsePortalDateTime('2026-11-20', undefined, '23:59'), Date.UTC(2026, 10, 20, 22, 59));
  assert.equal(el.parsePortalDateTime('', '10:30'), null);
  assert.equal(el.parsePortalDateTime('not-a-date', '10:30'), null);
});

// ---------------------------------------------------------------------------
// 2. The phases
// ---------------------------------------------------------------------------
const START = Date.UTC(2026, 10, 20, 9, 30);   // 20 Nov 2026 10:30 Nigerian time
const END = Date.UTC(2026, 10, 20, 15, 0);     // 20 Nov 2026 16:00 Nigerian time
const DATES = { startDate: '2026-11-20', startTime: '10:30', endDate: '2026-11-20', endTime: '16:00' };
const ON = { activeMode: 'election', isActive: true };
const OFF = { activeMode: 'none', isActive: false };
const at = (main, election, now) => el.computeElectionStatus({ main, election }, now);

test('nothing set and not switched on -> the plain coming-soon screen', () => {
  const s = at({}, {}, START);
  assert.equal(s.phase, 'idle');
  assert.equal(s.startAt, null);
});

test('dates set but election not switched on yet -> countdown to the start time', () => {
  const s = at(OFF, DATES, START - 30 * 60 * 1000);
  assert.equal(s.phase, 'upcoming');
  assert.equal(s.startAt, START);
});

test('switched on before the start time -> still a countdown, not the ballot', () => {
  assert.equal(at(ON, DATES, START - 1).phase, 'upcoming');
});

test('the exact start second opens the election; one millisecond earlier does not', () => {
  assert.equal(at(ON, DATES, START - 1).phase, 'upcoming');
  assert.equal(at(ON, DATES, START).phase, 'live');
});

test('live until the end time, closed from the exact end second', () => {
  assert.equal(at(ON, DATES, END - 1).phase, 'live');
  const s = at(ON, DATES, END);
  assert.equal(s.phase, 'ended');
  assert.equal(s.endedAt, END);
  assert.equal(s.endedUntil, END + DAY);
});

test('switched on with no dates -> live straight away (as before)', () => {
  assert.equal(at(ON, {}, START).phase, 'live');
  assert.equal(at({ isActive: true }, {}, START).phase, 'live');
  assert.equal(at({ isActive: 'true' }, {}, START).phase, 'live');
  assert.equal(at({ activeMode: 'both' }, {}, START).phase, 'live');
});

test('the start time arrives but the election was never switched on -> plain coming soon, no ballot', () => {
  assert.equal(at(OFF, DATES, START + 1).phase, 'idle');
  assert.equal(at({ activeMode: 'formPurchase', isActive: false }, DATES, START + 1).phase, 'idle');
});

test('"ELECTION HAS ENDED" shows for exactly 24 hours, then back to coming soon', () => {
  assert.equal(at(ON, DATES, END + DAY - 1).phase, 'ended');
  assert.equal(at(ON, DATES, END + DAY).phase, 'idle');
  assert.equal(at(ON, DATES, END + 5 * DAY).phase, 'idle');
});

test('stopped by the admin -> ended for 24 hours from the stop, then coming soon', () => {
  const stoppedAt = START + HOUR;
  const main = { ...OFF, electionEndedAt: new Date(stoppedAt).toISOString() };
  assert.equal(at(main, DATES, stoppedAt + 1).phase, 'ended');
  assert.equal(at(main, DATES, stoppedAt + DAY - 1).phase, 'ended');
  assert.equal(at(main, DATES, stoppedAt + DAY).phase, 'idle');
});

test('new dates set during the 24-hour notice do not hide "has ended"; the countdown follows after it', () => {
  const stoppedAt = END;
  const main = { ...OFF, electionEndedAt: new Date(stoppedAt).toISOString() };
  const next = { startDate: '2026-11-27', startTime: '10:30', endDate: '2026-11-27', endTime: '16:00' };
  assert.equal(at(main, next, stoppedAt + HOUR).phase, 'ended');
  assert.equal(at(main, next, stoppedAt + DAY + HOUR).phase, 'upcoming');
});

test('a date changed on the Election Settings screen wins over the old copy made at activation', () => {
  const main = { ...ON, startDate: '2026-11-20', startTime: '10:30', endDate: '2026-11-20', endTime: '16:00' };
  const election = { startDate: '2026-11-21', startTime: '09:00', endDate: '2026-11-21', endTime: '12:00' };
  const s = at(main, election, START + HOUR);
  assert.equal(s.phase, 'upcoming');
  assert.equal(s.startAt, Date.UTC(2026, 10, 21, 8, 0));
  assert.equal(s.startDate, '2026-11-21');
});

test('if the Election Settings record is gone, the copy made at activation is used', () => {
  const main = { ...ON, ...DATES };
  assert.equal(at(main, {}, START + HOUR).phase, 'live');
  assert.equal(at(main, undefined, START - HOUR).phase, 'upcoming');
});

test('the phone clock is not an input: the same server moment always gives the same answer', () => {
  const a = at(ON, DATES, START - 60000);
  const b = at(ON, DATES, START - 60000);
  assert.deepEqual(a, b);
  assert.equal(a.phase, 'upcoming');
});

// ---------------------------------------------------------------------------
// 3. Stamping the moment the election was switched off
// ---------------------------------------------------------------------------
test('manual stop (the two saves the dashboard makes) stamps the stop moment once it is really off', () => {
  const now = START + HOUR;
  const first = el.electionEndStampFor({ ...ON }, DATES, { activeMode: 'none' }, now);
  assert.deepEqual(first, {}, 'still on after the first save (isActive is still true)');
  const second = el.electionEndStampFor({ activeMode: 'none', isActive: true }, DATES, { isActive: false }, now);
  assert.equal(second.electionEndedAt, new Date(now).toISOString());
});

test('auto-stop long after the end time stamps the END time, not the moment the admin opened the dashboard', () => {
  const now = END + 3 * HOUR;
  const stamp = el.electionEndStampFor({ ...ON }, DATES, { activeMode: 'none', isActive: false }, now);
  assert.equal(stamp.electionEndedAt, new Date(END).toISOString());
});

test('switching off before the election ever started is not an "ending"', () => {
  assert.deepEqual(el.electionEndStampFor({ ...ON }, DATES, { activeMode: 'none', isActive: false }, START - HOUR), {});
});

test('switching the election on forgets the previous ending', () => {
  const prev = { ...OFF, electionEndedAt: new Date(END).toISOString() };
  assert.deepEqual(el.electionEndStampFor(prev, DATES, { activeMode: 'election' }, END + HOUR), { electionEndedAt: null });
});

test('saves that do not touch the election switch add nothing', () => {
  assert.deepEqual(el.electionEndStampFor({ activeMode: 'both', isActive: true }, DATES, { activeMode: 'election' }, START + HOUR), {});
  assert.deepEqual(el.electionEndStampFor({ ...OFF }, DATES, { activeMode: 'formPurchase' }, START + HOUR), {});
  assert.deepEqual(el.electionEndStampFor({ ...ON }, DATES, { year: '2027/2028' }, START + HOUR), {});
});

// ---------------------------------------------------------------------------
// 4. The public status the student page reads
// ---------------------------------------------------------------------------
test('status: tells the phone the portal time, the phase and the start time', async () => {
  db.seed('settings/election', window(2, 5));
  const before = Date.now();
  const res = await student('electionStatus');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.phase, 'upcoming');
  assert.ok(res.body.serverNow >= before && res.body.serverNow <= Date.now());
  assert.ok(res.body.startAt > res.body.serverNow);
  assert.ok(Math.abs(res.body.startAt - (before + 2 * HOUR)) <= 60 * 1000, 'start is the minute the admin typed');
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('status: no secrets — only the phase and the dates', async () => {
  db.seed('settings/main', { activeMode: 'election', isActive: true, somethingPrivate: 'x' });
  db.seed('settings/election', window(-1, 1));
  const res = await student('electionStatus');
  assert.deepEqual(Object.keys(res.body).sort(), ['active', 'endAt', 'endDate', 'endTime', 'endedAt', 'endedUntil', 'phase', 'serverNow', 'startAt', 'startDate', 'startTime', 'started', 'success'].sort());
});

// ---------------------------------------------------------------------------
// 5. Votes follow the portal clock
// ---------------------------------------------------------------------------
test('vote BEFORE the start time is refused and nothing is recorded', async () => {
  seedPeople();
  db.seed('settings/election', window(2, 5));
  await activateElection();
  const res = await adaVote();
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'ELECTION_NOT_LIVE');
  assert.equal(res.body.phase, 'upcoming');
  assert.match(res.body.message, /not started/i);
  assert.equal(db.read('candidates/c1').votes, 0);
  assert.equal(db.read('members/1990-1').hasVoted, false);
});

test('vote while the election is live is accepted exactly as before', async () => {
  seedPeople();
  db.seed('settings/election', window(-1, 2));
  await activateElection();
  const res = await adaVote();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(db.read('candidates/c1').votes, 1);
  assert.equal(db.read('candidates/c2').votes, 0);
  assert.equal(db.read('members/1990-1').hasVoted, true);

  const again = await adaVote();
  assert.equal(again.statusCode, 409, 'one person, one vote — unchanged');
  assert.equal(db.read('candidates/c1').votes, 1);
});

test('vote AFTER the end time is refused', async () => {
  seedPeople();
  db.seed('settings/election', window(-5, -1));
  await activateElection();
  const res = await adaVote();
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.phase, 'ended');
  assert.match(res.body.message, /ended/i);
  assert.equal(db.read('candidates/c1').votes, 0);
});

test('vote when the election is not switched on is refused, even inside the dates', async () => {
  seedPeople();
  db.seed('settings/election', window(-1, 2));
  const res = await adaVote();
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /not open/i);
  assert.equal(db.read('candidates/c1').votes, 0);
});

test('vote is refused the moment the admin stops the election', async () => {
  seedPeople();
  db.seed('settings/election', window(-1, 2));
  await activateElection();
  await stopElection();
  const res = await adaVote();
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.phase, 'ended');
  assert.equal(db.read('candidates/c1').votes, 0);
});

test('switched on with no dates at all: voting works (as before)', async () => {
  seedPeople();
  await activateElection();
  const response = await adaVote();
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store, max-age=0');
  assert.equal(response.headers.Pragma, 'no-cache');
});

test('the live vote endpoint rejects requests without set/S/N credentials', async () => {
  seedPeople();
  await activateElection();
  const res = await vote({ candidateIds: ['c1'] });
  assert.equal(res.statusCode, 400);
  assert.equal(db.read('candidates/c1').votes, 0);
});

// ---------------------------------------------------------------------------
// 6. The whole life of an election through the real admin calls
// ---------------------------------------------------------------------------
test('set dates -> countdown; switch on -> still countdown; stop after start -> ended; switch on again -> live', async () => {
  db.seed('settings/election', window(2, 5));
  assert.equal(await phase(), 'upcoming');
  await activateElection();
  assert.equal(await phase(), 'upcoming');

  // the admin moves the start into the past on the Election Settings screen
  await admin('saveElectionSettings', { data: window(-1, 5) });
  assert.equal(await phase(), 'live', 'the new date reaches students without switching off and on');

  await stopElection();
  assert.equal(await phase(), 'ended');
  const stamp = db.read('settings/main').electionEndedAt;
  assert.ok(Math.abs(Date.parse(stamp) - Date.now()) < 5000, 'stamped with the portal clock at the stop');

  await activateElection();
  assert.equal(db.read('settings/main').electionEndedAt, null);
  assert.equal(await phase(), 'live');
});

test('the end time passes while nobody is at the dashboard -> ended; the later auto-stop keeps the true end time', async () => {
  db.seed('settings/election', window(-5, -2));
  await activateElection();
  assert.equal(await phase(), 'ended');
  // what the Admin Dashboard's auto-stop sends when it is next opened
  await admin('saveMainSettings', { data: { activeMode: 'none', isActive: false } });
  const stamp = Date.parse(db.read('settings/main').electionEndedAt);
  assert.ok(Math.abs(stamp - (Date.now() - 2 * HOUR)) <= 60 * 1000, 'the END time, not "now"');
  assert.equal(await phase(), 'ended');
});

test('more than 24 hours after the end -> the normal coming-soon screen again', async () => {
  db.seed('settings/election', window(-30, -25));
  await activateElection();
  assert.equal(await phase(), 'idle');
  await admin('saveMainSettings', { data: { activeMode: 'none', isActive: false } });
  assert.equal(await phase(), 'idle');
});

test('dashboard auto-stop: the admin asks the PORTAL whether the end time has passed', async () => {
  db.seed('settings/election', window(-2, 3));
  db.seed('settings/main', { activeMode: 'election', isActive: true });
  let r = await admin('getElectionStatus');
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.status.phase, 'live');
  assert.ok(r.body.status.serverNow < r.body.status.endAt, 'the end has not passed on the portal -> the dashboard must not stop it');
  assert.ok(Math.abs(r.body.status.serverNow - Date.now()) < 5000);

  // the admin shortens the election: the answer is fresh straight away (no waiting for a cache)
  db.seed('settings/election', window(-2, -1));
  r = await admin('getElectionStatus');
  assert.equal(r.body.status.phase, 'ended');
  assert.ok(r.body.status.serverNow >= r.body.status.endAt, 'the end has passed on the portal -> the dashboard may stop it');
  assert.ok(r.body.status.endDate && r.body.status.endTime);
});

test('dashboard auto-stop: the portal status is for a logged-in admin only', async () => {
  const r = await call(adminHandler, { body: { action: 'getElectionStatus' } });
  assert.equal(r.statusCode, 401);
});

test('Admin API failures do not expose internal Firestore error details', async () => {
  const originalDoc = db.doc.bind(db);
  db.doc = () => { throw new Error('private-project/path secret detail'); };
  try {
    const response = await admin('getActivationStatus');
    assert.equal(response.statusCode, 500);
    assert.equal(response.body.message, 'The request could not be completed. Please try again.');
    assert.equal(JSON.stringify(response.body).includes('private-project'), false);
  } finally {
    db.doc = originalDoc;
  }
});

test('saving other main settings still works and is not disturbed', async () => {
  await admin('saveMainSettings', { data: { activeMode: 'formPurchase' } });
  assert.deepEqual(db.read('settings/main'), { activeMode: 'formPurchase' });
});

// ---------------------------------------------------------------------------
// 7. Fixed-roll voter access and presence — no registration, names or PINs.
test('voter login resolves the fixed member by set and S/N and records an audit entry', async () => {
  seedPeople();
  const response = await student('login', { username: 'set of 1990', password: '1' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store, max-age=0');
  assert.equal(response.headers.Pragma, 'no-cache');
  assert.deepEqual(response.body.member, { name: 'Ada Obi', sex: 'Female', set: 1990, sn: 1, hasVoted: false });
  const audit = db.list('auditLogs').find(row => row.action === 'VOTER_LOGIN');
  assert.equal(audit.actor, '1990-1');
  assert.deepEqual(audit.details, { set: 1990, sn: 1 });
});

test('voter login has a global per-IP ceiling even when an attacker rotates set names', async () => {
  db.reset();
  let last;
  for (let i = 0; i < 51; i += 1) {
    last = await student('login', { username: `unknown-set-${i}`, password: 'x' });
  }
  assert.equal(last.statusCode, 429);
});

test('voter login rejects non-members and registration actions are not available', async () => {
  seedPeople();
  const missing = await student('login', { username: 'set of 1990', password: '2' });
  assert.equal(missing.statusCode, 404);
  const registration = await student('register', { name: 'Not allowed', username: 'set of 2020', password: '1' });
  assert.equal(registration.statusCode, 400);
});

test('online presence resolves a voter from the fixed member roll and never trusts a visitor identity', async () => {
  seedPeople();
  await student('presence', { anonId: 'pabc123', page: '/student', role: 'voter', memberId: '1990-1' });
  const listed = await superAdmin('superStats');
  const voter = listed.body.stats.online.list.find(row => row.id === 'pabc123');
  assert.equal(voter.name, 'Ada Obi');
  assert.equal(voter.set, 1990);
  await student('presence', { anonId: 'pvisitor9', page: '/', role: 'visitor', memberId: '1990-1' });
  const visitor = db.read('presence/pvisitor9');
  assert.equal(visitor.memberId, '');
});

test('public presence heartbeat is capped per IP and anonymous client ID', async () => {
  db.reset();
  let response;
  for (let i = 0; i < 6; i += 1) {
    response = await student('presence', { anonId: 'presence-limiter-test', page: '/' });
  }
  assert.equal(response.statusCode, 429);
});

test('Admin member listing returns turnout only, not the protected membership roll', async () => {
  seedPeople();
  const response = await admin('listMembers');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.items, [{ hasVoted: false }, { hasVoted: false }]);
  assert.equal(JSON.stringify(response.body).includes('Ada Obi'), false);
  assert.equal(JSON.stringify(response.body).includes('1990-1'), false);
});

test('Admin can find a member S/N by name without opening the fixed roll publicly', async () => {
  seedPeople();
  const denied = await call(adminHandler, { body: { action: 'findMemberSnByName', name: 'Ada' } });
  assert.equal(denied.statusCode, 401);
  const short = await admin('findMemberSnByName', { name: 'Ad' });
  assert.equal(short.statusCode, 400);
  const found = await admin('findMemberSnByName', { name: '  ADA   OBI ' });
  assert.equal(found.statusCode, 200);
  assert.deepEqual(found.body.items, [{ name: 'Ada Obi', set: 1990, sn: 1, sex: 'Female' }]);
  assert.equal(db.list('auditLogs').some(row => row.action === 'MEMBER_SN_LOOKUP'), true);
});

test('audit verification is Super Admin-only and returns aggregate, identity-safe results', async () => {
  seedPeople();
  db.seed('members/1990-1', { ...ADA, hasVoted: true });
  db.seed('candidates/c1', { name: 'Chidi', position: 'President', votes: 1 });
  db.seed('auditLogs/vote-audit', { actor: '1990-1', action: 'VOTE_CAST', at: new Date().toISOString(), details: { name: 'Ada Obi', sn: 1 } });
  const denied = await admin('superAuditVerification');
  assert.equal(denied.statusCode, 403);
  const response = await superAdmin('superAuditVerification');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.report.summary.votedMembers, 1);
  assert.equal(response.body.report.summary.voteAuditActors, 1);
  assert.equal(response.body.report.positions[0].voteTotal, 1);
  assert.equal(response.body.report.discrepancies.length, 0);
  assert.equal(JSON.stringify(response.body).includes('Ada Obi'), false);
  assert.equal(JSON.stringify(response.body).includes('1990-1'), false);
});

test('Landing maintenance override is Super Admin-controlled and public status stays read-only', async () => {
  const forbidden = await admin('setMaintenanceWarning', { enabled: true });
  assert.equal(forbidden.statusCode, 403);
  const enabled = await superAdmin('setMaintenanceWarning', { enabled: true });
  assert.equal(enabled.body.enabled, true);
  const publicResponse = makeRes();
  await maintenanceHandler({ method: 'GET', headers: {} }, publicResponse);
  assert.equal(publicResponse.headers['Cache-Control'], 'no-store, max-age=0');
  assert.deepEqual(publicResponse.body, { enabled: true });
  const disabled = await superAdmin('setMaintenanceWarning', { enabled: false });
  assert.equal(disabled.body.enabled, false);
  const status = await superAdmin('getMaintenanceWarning');
  assert.equal(status.body.enabled, false);
});

test('Super Admin login history contains voter roll fields, not matric or registration data', async () => {
  seedPeople();
  await student('login', { username: 'set of 1990', password: '1' });
  const response = await superAdmin('superLogins');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.items[0].name, 'Ada Obi');
  assert.equal(response.body.items[0].set, 1990);
  assert.equal(response.body.items[0].sn, 1);
  assert.equal(response.body.items[0].matric, undefined);
});
