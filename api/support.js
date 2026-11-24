import { withApiSafety } from './_http.js';
// SMCOAA Support — public contact form write, server-side (bypasses rules via firebase-admin).
import { getAdminDb } from './_admin.js';
import { writeAudit } from './_audit.js';
import { FieldValue } from 'firebase-admin/firestore';
import { clientIp, consumeRateLimit, waitText } from './_ratelimit.js';

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  if (req.method === 'GET') {
    try {
      const snap = await getAdminDb().doc('settings/main').get();
      const data = snap.exists ? snap.data() : {};
      const email = typeof data.supportContactEmail === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.supportContactEmail.trim())
        ? data.supportContactEmail.trim().slice(0, 254) : '';
      const phone = typeof data.supportContactPhone === 'string' ? data.supportContactPhone.trim().slice(0, 32) : '';
      return res.status(200).json({ success: true, contact: { email, phone } });
    } catch (error) {
      console.error('Support contact lookup failed:', error.message);
      return res.status(200).json({ success: true, contact: { email: '', phone: '' } });
    }
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { name, email, message } = req.body || {}; 
  const db = getAdminDb();
  const gate = await consumeRateLimit(db, { scope: 'support-submit', who: clientIp(req), rules: [{ limit: 4, windowSec: 15 * 60 }] });
  if (!gate.ok) return res.status(429).json({ success: false, message: `Too many support requests. Please wait ${waitText(gate.retryAfterSec)} and try again.` });
  if (!name || !message || typeof name !== 'string' || typeof message !== 'string'
      || name.trim().length === 0 || name.length > 120 || message.trim().length === 0 || message.length > 5000
      || (email !== undefined && (typeof email !== 'string' || email.length > 254))
      || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) {
    return res.status(400).json({ success: false, message: 'Name and message are required' });
  }

  const ref = await db.collection('supportMessages').add({
    name: name.trim(),
    email: (email && email.trim()) ? email.trim() : 'Not provided',
    message: message.trim(),
    timestamp: FieldValue.serverTimestamp(),   // same type your admin dashboard already renders
    status: 'unread',
  });

  await writeAudit({ db, actor: name.trim(), action: 'SUPPORT_MESSAGE', details: { email: (email && email.trim()) ? email.trim() : 'Not provided' } });

  return res.status(200).json({ success: true, id: ref.id });
}

export default withApiSafety(handler, 'api/support');
