import { withApiSafety } from './_http.js';
// SMCOAA Staff Data API — Election View data API; voter details are withheld from staff responses
import { getAdminDb } from './_admin.js';
import { verifyToken } from './_session.js';

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  // Validate the same signed, expiring session format used by the Admin API.
  const sessionSecret = process.env.SERVER_SESSION_SECRET;
  const session = sessionSecret ? verifyToken(token, sessionSecret) : null;
  if (!session || session.role !== 'staff') {
    return res.status(401).json({ success: false, message: 'Unauthorized. Valid Election View session required.' });
  }

  const { action } = req.body || {};

  if (!action) {
    return res.status(400).json({ success: false, message: 'Action is required' });
  }

  const db = getAdminDb();

  switch (action) {
    case 'listCandidates': {
      const snap = await db.collection('candidates').get();
      return res.json({ success: true, items: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
    }
    case 'listMembers': {
      const snap = await db.collection('members').get();
      // Election View needs turnout only. Never disclose voter S/N or profile data.
      return res.json({ success: true, items: snap.docs.map(d => ({ hasVoted: Boolean(d.data().hasVoted) })) });
    }
    case 'getSettings': {
      const [mainSnap, electionSnap] = await Promise.all([
        db.doc('settings/main').get(),
        db.doc('settings/election').get().catch(() => null),
      ]);
      let merged = {};
      if (electionSnap && electionSnap.exists) merged = { ...electionSnap.data() };
      if (mainSnap && mainSnap.exists) merged = { ...merged, ...mainSnap.data() };
      return res.json({ success: true, settings: merged });
    }
    default:
      return res.status(400).json({ success: false, message: 'Unknown action: ' + action });
  }
}

export default withApiSafety(handler, 'api/staff-data');
