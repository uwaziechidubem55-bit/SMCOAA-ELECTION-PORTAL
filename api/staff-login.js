import { withApiSafety } from './_http.js';
// SMCOAA Staff Login API — password check against Vercel environment variable
import { getAdminDb } from './_admin.js';
import { writeAudit } from './_audit.js';
import { signToken } from './_session.js';
import crypto from 'node:crypto';
import { clientIp, consumeRateLimit, waitText } from './_ratelimit.js';

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { password } = req.body || {};

  if (!password) {
    return res.status(400).json({ success: false, message: 'Password is required' });
  }

  // The Election View password is provided by the owner in Vercel environment variables.
  // Never provide a hard-coded fallback credential.
  const staffPassword = process.env.STAFF_PASSWORD;
  if (!staffPassword) {
    return res.status(500).json({ success: false, message: 'Election View password is not configured on the server.' });
  }

  const sessionSecret = process.env.SERVER_SESSION_SECRET;
  if (typeof sessionSecret !== 'string' || sessionSecret.length < 32) {
    return res.status(500).json({ success: false, message: 'SERVER_SESSION_SECRET must be configured with at least 32 characters.' });
  }
  try {
    const gate = await consumeRateLimit(getAdminDb(), { scope: 'staff-login', who: clientIp(req), rules: [{ limit: 8, windowSec: 15 * 60 }] });
    if (!gate.ok) return res.status(429).json({ success: false, message: `Too many login attempts. Please wait ${waitText(gate.retryAfterSec)} and try again.` });
  } catch (rateError) {
    console.warn('Election View login limiter unavailable:', rateError.message);
  }
  const supplied = Buffer.from(String(password));
  const expected = Buffer.from(staffPassword);
  const passwordMatches = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  if (!passwordMatches) {
    await writeAudit({ getDb: getAdminDb, actor: 'staff', action: 'LOGIN_FAILED', details: { kind: 'staff' } });
    return res.status(401).json({ success: false, message: 'Access Denied. Incorrect password.' });
  }

  const now = Math.floor(Date.now() / 1000);
  const token = signToken({ role: 'staff', iat: now, exp: now + 8 * 60 * 60 }, sessionSecret);

  await writeAudit({ getDb: getAdminDb, actor: 'staff', action: 'STAFF_LOGIN', details: {} });

  return res.status(200).json({
    success: true,
    token,
    message: 'Access granted. Welcome!',
  });
}

export default withApiSafety(handler, 'api/staff-login');
