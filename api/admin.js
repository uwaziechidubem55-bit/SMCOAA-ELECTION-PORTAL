import { withApiSafety } from './_http.js';
// SMCOAA Admin API — server-side data operations for AdminDashboard.
// Guarded with a high-level diagnostic log layer to force Vercel to report silent errors.
import { createHash } from 'crypto';
import { writeAudit } from './_audit.js';
import { electionEndStampFor, getElectionStatus } from './_election.js';
import { MEMBERS } from '../src/config/members.js';
import { addNewMembers, parseMemberCsv, previewMembers } from './_memberImport.js';

let getAdminDb, verifyToken, signToken;

try {
  // Capture dynamic module loading errors if Vercel is choking on file paths or extensions
  const adminModule = await import('./_admin.js');
  const sessionModule = await import('./_session.js');
  getAdminDb = adminModule.getAdminDb;
  verifyToken = sessionModule.verifyToken;
  signToken = sessionModule.signToken;
} catch (importError) {
  // If the import fails, this forces Vercel to print the exact missing file or module path
  console.error("❌ CRITICAL STARTUP ERROR: Failed to import underlying dependencies inside api/admin.js!");
  console.error("Stack trace:", importError.stack || importError.message || importError);
}

const SECRET = process.env.SERVER_SESSION_SECRET || '';

function isAdmin(req) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!verifyToken) {
      throw new Error("verifyToken helper function was never initialized successfully due to a prior import crash.");
    }
    const session = verifyToken(token, SECRET);
    return !!session && session.role === 'admin';
  } catch (authError) {
    console.error("❌ AUTHENTICATION PROCESS CRASHED:", authError.message);
    return false;
  }
}

const serializeTs = (ts) => {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
  return ts;
};

// ===================== SUPER ADMIN HELPERS (control room) =====================
// Two locks, one door: EVERY /api/admin call still needs a valid ADMIN session
// (isAdmin below). The super-admin-only actions additionally require a valid
// SUPER session token sent in the 'x-super-token' header (isSuper here).
// No new serverless functions are created — the Vercel Hobby 12-function
// limit is respected by adding actions instead of files.

function isSuper(req) {
  try {
    const token = req.headers['x-super-token'] || '';
    const session = verifyToken(token, process.env.SERVER_SESSION_SECRET || '');
    return !!session && session.role === 'super';
  } catch (e) {
    return false;
  }
}

// The super admin code is never stored as plain text — only this hash
// (code + server secret, SHA-256), the same way passwords should live.
function hashCode(code) {
  return createHash('sha256').update(String(code) + ':' + (process.env.SERVER_SESSION_SECRET || '')).digest('hex');
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  // Log incoming requests immediately to see if the engine registers traffic
  console.log(`📡 [api/admin] Received execution request: ${req.method} | Action: ${req.body?.action || 'None'}`);

  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    if (!isAdmin(req)) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { action, ...payload } = req.body || {};

    if (!getAdminDb) {
      throw new Error("getAdminDb initialization completely failed. Your Firebase instance could not boot up.");
    }
    const db = getAdminDb();

    switch (action) {
      case 'listCandidates': {
        const snap = await db.collection('candidates').get();
        return res.json({ success: true, items: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      }
      case 'saveCandidate': {
        const { id, data } = payload;
        if (id) await db.doc(`candidates/${id}`).set(data, { merge: true });
        else await db.collection('candidates').add(data);
        return res.json({ success: true });
      }
      case 'deleteCandidate': {
        if (!payload.id) return res.status(400).json({ success: false, message: 'id required' });
        await db.doc(`candidates/${payload.id}`).delete();
        return res.json({ success: true });
      }
      case 'getElectionSettings': {
        const snap = await db.doc('settings/election').get();
        return res.json({ success: true, data: snap.exists ? snap.data() : null });
      }
      case 'saveElectionSettings': {
        await db.doc('settings/election').set(payload.data, { merge: true });
        return res.json({ success: true });
      }
      case 'getMainSettings': {
        const snap = await db.doc('settings/main').get();
        return res.json({ success: true, data: snap.exists ? snap.data() : null });
      }
      // The election as the PORTAL sees it right now (fresh read, portal clock).
      // The dashboard's auto-stop asks this, so a wrong clock or time zone on
      // the admin's own device can never end the election early.
      case 'getElectionStatus': {
        return res.json({ success: true, status: await getElectionStatus(db) });
      }
      case 'saveMainSettings': {
        const patch = { ...(payload.data || {}) };
        // If this save switches the election OFF, stamp the moment it ended
        // (portal clock) so students see "ELECTION HAS ENDED" for 24 hours.
        // If it switches the election ON, forget the previous ending.
        try {
          const [mainSnap, electionSnap] = await Promise.all([
            db.doc('settings/main').get(),
            db.doc('settings/election').get(),
          ]);
          Object.assign(patch, electionEndStampFor(
            mainSnap.exists ? mainSnap.data() : {},
            electionSnap.exists ? electionSnap.data() : {},
            patch,
          ));
        } catch (stampError) {
          console.error('election end stamp skipped (the save still goes through):', stampError.message);
        }
        await db.doc('settings/main').set(patch, { merge: true });
        return res.json({ success: true });
      }
      
      
      case 'listSupport': {
        const snap = await db.collection('supportMessages').orderBy('timestamp', 'desc').limit(200).get();
        const items = snap.docs.map(d => {
          const data = d.data();
          return { id: d.id, ...data, timestamp: serializeTs(data.timestamp) };
        });
        return res.json({ success: true, items });
      }
      case 'markSupportRead': {
        if (!payload.id) return res.status(400).json({ success: false, message: 'id required' });
        await db.doc(`supportMessages/${payload.id}`).update({ status: 'read' });
        return res.json({ success: true });
      }
      case 'deleteSupport': {
        if (!payload.id) return res.status(400).json({ success: false, message: 'id required' });
        await db.doc(`supportMessages/${payload.id}`).delete();
        return res.json({ success: true });
      }
      
      
      case 'getActivationStatus': {
        const snap = await db.doc('settings/main').get();
        const settings = snap.exists ? snap.data() : {};
        return res.json({ success: true, active: Boolean(settings.isActive), mode: settings.activeMode || 'none' });
      }
      case 'listMembers': {
        const snap = await db.collection('members').get();
        // Admin Dashboard currently needs turnout counts only; avoid exporting the private roll.
        return res.json({ success: true, items: snap.docs.map(d => ({ hasVoted: Boolean(d.data().hasVoted) })) });
      }
      case 'previewMemberImport': {
        try {
          const rows = parseMemberCsv(payload.csvText);
          const preview = await previewMembers(db, rows);
          return res.json({ success: true, preview });
        } catch (error) {
          return res.status(400).json({ success: false, message: error.message || 'Member file is invalid.' });
        }
      }
      case 'importMemberCsv': {
        try {
          const rows = parseMemberCsv(payload.csvText);
          const result = await addNewMembers(db, rows);
          try { await writeAudit({ db, actor: 'admin', action: 'MEMBER_ROSTER_IMPORTED', details: { source: 'csv', ...result } }); }
          catch (auditError) { console.warn('Member import audit write failed:', auditError.message); }
          return res.json({ success: true, ...result, note: 'Existing member documents and vote states were not changed.' });
        } catch (error) {
          return res.status(400).json({ success: false, message: error.message || 'Member import failed validation.' });
        }
      }
      case 'seedFixedRoster': {
        try {
          const result = await addNewMembers(db, MEMBERS);
          try { await writeAudit({ db, actor: 'admin', action: 'FIXED_ROSTER_SEEDED', details: result }); }
          catch (auditError) { console.warn('Fixed roster audit write failed:', auditError.message); }
          return res.json({ success: true, ...result, note: 'Only missing fixed-roster records were added; existing records and vote states were not changed.' });
        } catch (error) {
          return res.status(400).json({ success: false, message: error.message || 'Fixed roster could not be loaded.' });
        }
      }
      case 'findMemberSnByName': {
        const query = typeof payload.name === 'string' ? payload.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase() : '';
        if (query.length < 3 || query.length > 100) {
          return res.status(400).json({ success: false, message: 'Enter at least 3 characters of the member name.' });
        }
        const snap = await db.collection('members').get();
        const items = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }))
          .filter(member => typeof member.name === 'string' && member.name.toLocaleLowerCase().includes(query))
          .sort((a, b) => Number(a.set) - Number(b.set) || Number(a.sn) - Number(b.sn))
          .slice(0, 20)
          .map(member => ({ name: member.name, set: member.set, sn: member.sn, sex: member.sex || '' }));
        await writeAudit({ db, actor: 'admin', action: 'MEMBER_SN_LOOKUP', details: { matches: items.length } });
        return res.json({ success: true, items });
      }
      case 'getResults': {
        const snap = await db.doc('electionData/results').get();
        return res.json({ success: true, data: snap.exists ? snap.data() : null });
      }
      case 'saveResults': {
        await db.doc('electionData/results').set(payload.data, { merge: true });
        return res.json({ success: true });
      }
      

      // ================================================================
      // SUPER ADMIN (control room) — price book, code safe, live stats.
      // ================================================================
      
      
      case 'setSuperAdminCode': {
        const newCode = String(payload.newCode || '').trim();
        if (newCode.length < 6) {
          return res.status(400).json({ success: false, message: 'Code must be at least 6 characters' });
        }
        await db.doc('superAdmin/settings').set({
          codeHash: hashCode(newCode),
          failedAttempts: 0,
          lockUntil: null,
          updatedAt: new Date().toISOString(),
          updatedBy: 'admin',
        }, { merge: true });
        await writeAudit({ db, actor: 'admin', action: 'SUPER_CODE_CHANGED', details: {} });
        return res.json({ success: true, message: 'Super admin login code saved. The old code (if any) no longer works.' });
      }
      case 'superLogin': {
        const { code } = payload;
        if (!code) return res.status(400).json({ success: false, message: 'Super admin code is required' });
        if (!process.env.SERVER_SESSION_SECRET || !signToken) {
          return res.status(500).json({ success: false, message: 'Server session secret not configured.' });
        }
        const snap = await db.doc('superAdmin/settings').get();
        const data = snap.exists ? snap.data() : null;
        if (!data || !data.codeHash) {
          return res.status(404).json({ success: false, message: 'No super admin code set yet. Set it from the Admin Dashboard first.' });
        }
        if (data.lockUntil && Date.now() < Number(data.lockUntil)) {
          const mins = Math.ceil((Number(data.lockUntil) - Date.now()) / 60000);
          return res.status(423).json({ success: false, message: `Too many wrong attempts. Locked for ${mins} more minute(s).` });
        }
        if (hashCode(code) !== data.codeHash) {
          const attempts = (Number(data.failedAttempts) || 0) + 1;
          const lock = attempts >= 5 ? Date.now() + 30 * 60 * 1000 : null;
          await db.doc('superAdmin/settings').set({ failedAttempts: attempts, ...(lock ? { lockUntil: lock } : {}) }, { merge: true });
          await writeAudit({ db, actor: 'admin', action: 'SUPER_LOGIN_FAILED', details: { attempt: attempts } });
          const left = 5 - attempts;
          return res.status(401).json({ success: false, message: left > 0 ? `Wrong code. ${left} attempt(s) left before lockout.` : 'Wrong code. Locked for 30 minutes.' });
        }
        await db.doc('superAdmin/settings').set({ failedAttempts: 0, lockUntil: null }, { merge: true });
        const now = Math.floor(Date.now() / 1000);
        const superToken = signToken({ role: 'super', iat: now, exp: now + 7200 }, process.env.SERVER_SESSION_SECRET);
        await writeAudit({ db, actor: 'admin', action: 'SUPER_LOGIN', details: {} });
        return res.json({ success: true, superToken, expiresIn: 7200 });
      }
      case 'superVerify': {
        if (!isSuper(req)) return res.status(403).json({ success: false, message: 'Super admin session required' });
        return res.json({ success: true, role: 'super' });
      }
      case 'getMaintenanceWarning': {
        if (!isSuper(req)) return res.status(403).json({ success: false, message: 'Super admin session required' });
        const snap = await db.doc('settings/maintenance').get();
        const data = snap.exists ? snap.data() : {};
        return res.json({ success: true, enabled: Boolean(data.enabled), updatedAt: data.updatedAt || null });
      }
      case 'setMaintenanceWarning': {
        if (!isSuper(req)) return res.status(403).json({ success: false, message: 'Super admin session required' });
        const enabled = Boolean(payload.enabled);
        await db.doc('settings/maintenance').set({ enabled, updatedAt: new Date().toISOString(), updatedBy: 'super-admin' }, { merge: true });
        await writeAudit({ db, actor: 'super-admin', action: 'LANDING_MAINTENANCE_TOGGLED', details: { enabled } });
        return res.json({ success: true, enabled });
      }
      case 'superStats': {
        if (!isSuper(req)) return res.status(403).json({ success: false, message: 'Super admin session required' });
        const now = Date.now();
        const twoMinAgo = new Date(now - 2 * 60 * 1000).toISOString();
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
        const dayStartIso = dayStart.toISOString();

        const [presenceSnap, membersSnap, candidatesSnap, auditSnap, mainSnap, supportSnap] = await Promise.all([
          db.collection('presence').get(),
          db.collection('members').get(),
          db.collection('candidates').get(),
          db.collection('auditLogs').orderBy('at', 'desc').limit(100).get(),
          db.doc('settings/main').get(),
          db.collection('supportMessages').limit(100).get(),
        ]);

        // ---- presence: online = seen in the last 2 minutes ----
        const byPage = {};
        const online = [];
        const staleRefs = [];

        // Resolve active voter presence to the fixed Firestore member roll.
        const membersById = new Map();
        membersSnap.docs.forEach(d => membersById.set(d.id, d.data() || {}));

        presenceSnap.docs.forEach(d => {
          const p = d.data();
          if (p.lastSeen && p.lastSeen >= twoMinAgo) {
            byPage[p.page || 'unknown'] = (byPage[p.page || 'unknown'] || 0) + 1;
            const member = p.role === 'voter' && p.memberId ? membersById.get(p.memberId) : null;
            const person = member ? { name: member.name || '', set: member.set || '', sn: member.sn || '', hasVoted: !!member.hasVoted } : null;
            online.push({
              id: d.id, page: p.page || 'unknown', role: p.role || 'visitor', lastSeen: p.lastSeen,
              ...(person || (p.role === 'voter' && p.memberId ? { memberId: String(p.memberId) } : {})),
            });
          } else if (!p.lastSeen || now - Date.parse(p.lastSeen || 0) > 60 * 60 * 1000) {
            staleRefs.push(d.ref);
          }
        });
        // Silent housekeeping: forget visitors gone for over an hour.
        staleRefs.slice(0, 50).forEach(r => { r.delete().catch(() => {}); });

        // ---- people ----
        let totalMembers = 0, voted = 0;
        membersSnap.docs.forEach(d => { totalMembers += 1; if (d.data().hasVoted) voted += 1; });

        // ---- election ----
        const byPosition = {};
        candidatesSnap.docs.forEach(d => {
          const c = d.data();
          const pos = c.position || 'Unassigned';
          if (!byPosition[pos]) byPosition[pos] = [];
          byPosition[pos].push({ id: d.id, name: c.name || '—', votes: Number(c.votes) || 0 });
        });
        Object.values(byPosition).forEach(arr => arr.sort((a, b) => b.votes - a.votes));

        // ---- support messages (super admin oversight) ----
        const supportMessages = supportSnap.docs.map(d => {
          const data = d.data();
          return { id: d.id, ...data, timestamp: serializeTs(data.timestamp) };
        }).sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
        const unreadSupport = supportMessages.filter(m => m.status === 'unread').length;

        // ---- diary ----
        const VOTER_ACTIONS = ['VOTER_LOGIN', 'VOTER_LOGIN_FAILED', 'VOTE_CAST'];
        const audit = auditSnap.docs.map(d => {
          const row = { id: d.id, ...d.data() };
          const member = VOTER_ACTIONS.includes(row.action) ? membersById.get(String(row.actor || '')) : null;
          const person = member ? { name: member.name || '', sex: member.sex || '', set: member.set || '', sn: member.sn || '', hasVoted: !!member.hasVoted } : null;
          return person ? { ...row, person } : row;
        });
        const todayAudit = audit.filter(a => (a.at || '') >= dayStartIso);
        const loginsToday = todayAudit.filter(a => a.action === 'VOTER_LOGIN').length;
        const failedLogins = todayAudit.filter(a => a.action === 'VOTER_LOGIN_FAILED' || a.action === 'SUPER_LOGIN_FAILED').length;
        const votesToday = todayAudit.filter(a => a.action === 'VOTE_CAST').length;

        return res.json({
          success: true,
          stats: {
            serverTime: new Date().toISOString(),
            online: { count: online.length, byPage, list: online },
            people: { totalMembers, voted, loginsToday, failedLogins },
            election: { byPosition, votesToday, activeMode: mainSnap.exists ? (mainSnap.data().activeMode || 'none') : 'none' },
            support: { unread: unreadSupport, recent: supportMessages.slice(0, 10) },
            audit,
          },
        });
      }
      case 'superAuditVerification': {
        if (!isSuper(req)) return res.status(403).json({ success: false, message: 'Super admin session required' });
        const [membersSnap, candidatesSnap, voteAuditSnap, recentAuditSnap] = await Promise.all([
          db.collection('members').get(),
          db.collection('candidates').get(),
          db.collection('auditLogs').where('action', '==', 'VOTE_CAST').get(),
          db.collection('auditLogs').orderBy('at', 'desc').limit(100).get(),
        ]);
        const votedMembers = membersSnap.docs.filter(d => Boolean((d.data() || {}).hasVoted)).length;
        const voteActors = new Set(voteAuditSnap.docs.map(d => String((d.data() || {}).actor || '')).filter(Boolean));
        const positions = {};
        candidatesSnap.docs.forEach(d => {
          const candidate = d.data() || {};
          const position = String(candidate.position || 'Unassigned');
          if (!positions[position]) positions[position] = { position, candidateCount: 0, voteTotal: 0, candidates: [] };
          const votes = Math.max(0, Number(candidate.votes) || 0);
          positions[position].candidateCount += 1;
          positions[position].voteTotal += votes;
          positions[position].candidates.push({ name: String(candidate.name || '—'), votes });
        });
        Object.values(positions).forEach(row => row.candidates.sort((a, b) => b.votes - a.votes));
        const discrepancies = [];
        if (votedMembers !== voteActors.size) discrepancies.push({
          type: 'VOTER_AUDIT_COUNT_MISMATCH',
          message: 'Members marked as voted do not match distinct voter ballot audit events.',
          memberFlagCount: votedMembers,
          ballotAuditCount: voteActors.size,
        });
        const latestEvents = recentAuditSnap.docs.map(d => {
          const row = d.data() || {};
          return { at: row.at || '', action: String(row.action || 'UNKNOWN') };
        });
        return res.json({ success: true, report: {
          generatedAt: new Date().toISOString(),
          summary: {
            totalMembers: membersSnap.size,
            votedMembers,
            voteAuditActors: voteActors.size,
            candidateVotes: Object.values(positions).reduce((sum, row) => sum + row.voteTotal, 0),
            positions: Object.keys(positions).length,
          },
          positions: Object.values(positions),
          discrepancies,
          recentEvents: latestEvents,
        } });
      }
      case 'superAuditFeed': {
        if (!isSuper(req)) return res.status(403).json({ success: false, message: 'Super admin session required' });
        const limit = Math.min(Number(payload.limit) || 200, 500);
        const snap = await db.collection('auditLogs').orderBy('at', 'desc').limit(limit).get();
        return res.json({ success: true, items: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      }

      // Voters who signed in, with their code-roll details and vote state.
      case 'superLogins': {
        if (!isSuper(req)) return res.status(403).json({ success: false, message: 'Super admin session required' });
        const limit = Math.min(Math.max(Number(payload.limit) || 400, 50), 1000);
        let query = db.collection('auditLogs').where('action', '==', 'VOTER_LOGIN');
        if (payload.before) query = query.where('at', '<', String(payload.before));
        const snap = await query.orderBy('at', 'desc').limit(limit).get();
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const ids = [...new Set(rows.map(r => String(r.actor || '')).filter(id => /^\d{4}-\d+$/.test(id)))];
        const found = await Promise.all(ids.map(id => db.doc(`members/${id}`).get()));
        const members = new Map();
        found.forEach((record, i) => { if (record.exists) members.set(ids[i], record.data() || {}); });
        const items = rows.map(row => {
          const member = members.get(String(row.actor || ''));
          return {
            id: row.id, at: row.at || '', type: 'login',
            name: member?.name || '', sex: member?.sex || '',
            set: member?.set || row.details?.set || '', sn: member?.sn || row.details?.sn || '',
            hasVoted: Boolean(member?.hasVoted), votedAt: member?.votedAt || '', known: Boolean(member),
          };
        });
        return res.json({ success: true, items, scanned: rows.length, nextBefore: rows.length === limit ? (rows.at(-1)?.at || null) : null });
      }

      case 'superCleanupPresence': {
        if (!isSuper(req)) return res.status(403).json({ success: false, message: 'Super admin session required' });
        const snap = await db.collection('presence').get();
        const now = Date.now();
        let removed = 0;
        const stale = snap.docs.filter(d => {
          const p = d.data();
          return !p.lastSeen || now - Date.parse(p.lastSeen) > 10 * 60 * 1000;
        });
        await Promise.all(stale.map(d => d.ref.delete().then(() => { removed += 1; }).catch(() => {})));
        return res.json({ success: true, removed });
      }

      default:
        return res.status(400).json({ success: false, message: 'Unknown action: ' + action });
    }
  } catch (runtimeError) {
    // This logs any raw operational failures directly back to Vercel's console output
    console.error("❌ RUNTIME FAILURE INSIDE EXECUTION HANDLER:", runtimeError.stack || runtimeError.message);
    return res.status(500).json({ success: false, message: 'The request could not be completed. Please try again.' });
  }
}

export default withApiSafety(handler, 'api/admin');
