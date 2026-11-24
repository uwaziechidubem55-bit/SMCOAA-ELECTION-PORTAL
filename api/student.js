import { withApiSafety } from './_http.js';
// SMCOAA voter API — Firestore-backed voter login, presence and election status.
import { getAdminDb } from './_admin.js';
import { writeAudit } from './_audit.js';
import { clientIp, consumeRateLimit, waitText } from './_ratelimit.js';
import { getElectionStatus } from './_election.js';

import { parseLogin, memberDocId } from '../src/utils/memberHelpers.js';

const VOTER_LOGIN_PER_SET_LIMITS = [{ limit: 5, windowSec: 15 * 60 }];
const VOTER_LOGIN_PER_IP_LIMITS = [{ limit: 50, windowSec: 15 * 60 }];

async function login(req, res) {
  const { username, password } = req.body || {};
  const credentials = parseLogin(username, password);
  const db = getAdminDb();
  const ip = clientIp(req);
  const setScope = credentials?.set ?? String(username || '').slice(0, 32);
  const [ipGate, setGate] = await Promise.all([
    consumeRateLimit(db, { scope: 'voter-login-ip', who: ip, rules: VOTER_LOGIN_PER_IP_LIMITS }),
    consumeRateLimit(db, { scope: 'voter-login-set', who: `${ip}|${setScope}`, rules: VOTER_LOGIN_PER_SET_LIMITS }),
  ]);
  const gate = !ipGate.ok ? ipGate : setGate;
  if (!gate.ok) {
    return res.status(429).json({
      success: false,
      message: `Too many attempts. Please wait ${waitText(gate.retryAfterSec)} and try again.`,
    });
  }
  if (!credentials) {
    await writeAudit({ db, actor: 'voter-login', action: 'VOTER_LOGIN_FAILED', details: { reason: 'invalid_format' } });
    return res.status(400).json({ success: false, message: 'Enter a set username and S/N password.' });
  }

  const id = memberDocId(credentials);
  const snap = await db.doc(`members/${id}`).get();
  if (!snap.exists) {
    await writeAudit({ db, actor: id, action: 'VOTER_LOGIN_FAILED', details: { reason: 'no_matching_member' } });
    return res.status(404).json({ success: false, message: 'Set or S/N does not match the membership roll.' });
  }
  const member = snap.data();
  // The doc id and fields must agree; Firestore is the authority for voter access.
  if (Number(member.set) !== credentials.set || Number(member.sn) !== credentials.sn || !member.name) {
    await writeAudit({ db, actor: id, action: 'VOTER_LOGIN_FAILED', details: { reason: 'member_record_mismatch' } });
    return res.status(404).json({ success: false, message: 'Set or S/N does not match the membership roll.' });
  }
  await writeAudit({ db, actor: id, action: 'VOTER_LOGIN', details: { set: credentials.set, sn: credentials.sn } });
  return res.status(200).json({
    success: true,
    member: {
      name: member.name,
      sex: member.sex || '',
      set: credentials.set,
      sn: credentials.sn,
      hasVoted: Boolean(member.hasVoted),
    },
  });
}


// ---- Super Admin live monitoring: who is on which page (no login needed) ----
// Called by PresenceContext on every page change + every 45s per visitor.
// Online = seen in the last 2 minutes (counted in admin.js superStats).
async function presence(req, res) {
  const { anonId, page, role, memberId } = req.body || {};
  const safeId = String(anonId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  if (!safeId || !page) {
    return res.status(400).json({ success: false, message: 'anonId and page are required' });
  }
  // Bound unauthenticated heartbeat writes while allowing normal 45-second clients.
  const ip = clientIp(req);
  const [ipGate, clientGate] = await Promise.all([
    consumeRateLimit(getAdminDb(), { scope: 'presence-ip', who: ip, rules: [{ limit: 120, windowSec: 60 }] }),
    consumeRateLimit(getAdminDb(), { scope: 'presence-client', who: `${ip}|${safeId}`, rules: [{ limit: 5, windowSec: 60 }] }),
  ]);
  const gate = !ipGate.ok ? ipGate : clientGate;
  if (!gate.ok) return res.status(429).json({ success: false, message: 'Presence updates are temporarily limited.' });
  const now = new Date().toISOString();
  const ref = getAdminDb().doc(`presence/${safeId}`);
  const existing = await ref.get();
  const safeRole = String(role || 'visitor').slice(0, 20);
  // A logged-in student also says who they are, so the Super Admin's online
  // list can show the person instead of a random code. Cleared on logout.
  const safeMemberId = safeRole === 'voter'
    ? String(memberId || '').replace(/[^0-9-]/g, '').slice(0, 20)
    : '';
  await ref.set({
    page: String(page).slice(0, 60),
    role: safeRole,
    memberId: safeMemberId,
    lastSeen: now,
    firstSeen: existing.exists && existing.data().firstSeen ? existing.data().firstSeen : now,
  }, { merge: true });
  return res.status(200).json({ success: true });
}

// ---- Election clock (public): is the election coming, live or ended? ----
// Decided with THIS server's clock, never the phone's. The student page only
// displays the answer (countdown / ballot / "has ended"). See api/_election.js.
async function electionStatus(req, res) {
  try {
    const status = await getElectionStatus(getAdminDb(), { maxAgeMs: 8000 });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, ...status });
  } catch (e) {
    console.error('electionStatus failed:', e.message);
    return res.status(503).json({ success: false, message: 'Could not read the election status right now.' });
  }
}


async function handler(req, res) {
  // This endpoint serves identity-sensitive login responses and live election state.
  // Never allow an intermediary or browser cache to retain those responses.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }
  const { action } = req.query; // set by vercel.json rewrites
  switch (action) {
    case 'login': return login(req, res);
    case 'presence': return presence(req, res);
    case 'electionStatus': return electionStatus(req, res);
    default:
      return res.status(400).json({ success: false, message: 'Unknown action: ' + action });
  }
}

export default withApiSafety(handler, 'api/student');
