import { withApiSafety } from './_http.js';
import { getAdminDb } from './_admin.js';

// Public, read-only status for the landing-page maintenance override.
async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ enabled: false, message: 'Method not allowed' });
  }
  try {
    const snap = await getAdminDb().doc('settings/maintenance').get();
    const data = snap.exists ? snap.data() : {};
    return res.status(200).json({ enabled: Boolean(data.enabled) });
  } catch (error) {
    console.error('Maintenance status unavailable:', error.message);
    return res.status(503).json({ enabled: false });
  }
}

export default withApiSafety(handler, 'api/maintenance');
