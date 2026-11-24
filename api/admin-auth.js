import { withApiSafety } from './_http.js';
// SMCOAA Admin auth — login + session verification in ONE function.
import { signToken, verifyToken } from './_session.js';
import { getAdminDb } from './_admin.js';
import { writeAudit } from './_audit.js';
import { clientIp, consumeRateLimit, waitText } from './_ratelimit.js';

const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

async function login(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password required' });
  }

  const expectedUser = process.env.ADMIN_USERNAME;
  const expectedPass = process.env.ADMIN_PASSWORD;
  if (!expectedUser || !expectedPass) {
    return res.status(500).json({ success: false, message: 'Admin credentials not configured on server.' });
  }
  try {
    const gate = await consumeRateLimit(getAdminDb(), { scope: 'admin-login', who: clientIp(req), rules: [{ limit: 8, windowSec: 15 * 60 }] });
    if (!gate.ok) return res.status(429).json({ success: false, message: `Too many login attempts. Please wait ${waitText(gate.retryAfterSec)} and try again.` });
  } catch (rateError) {
    console.warn('Admin login limiter unavailable:', rateError.message);
  }
  if (!safeEqual(String(username), expectedUser) || !safeEqual(String(password), expectedPass)) {
    await writeAudit({ getDb: getAdminDb, actor: String(username).slice(0, 60), action: 'LOGIN_FAILED', details: { kind: 'admin' } });
    return res.status(401).json({ success: false, message: 'Invalid username or password' });
  }
  if (typeof process.env.SERVER_SESSION_SECRET !== 'string' || process.env.SERVER_SESSION_SECRET.length < 32) {
    return res.status(500).json({ success: false, message: 'SERVER_SESSION_SECRET must be configured with at least 32 characters.' });
  }

  const now = Math.floor(Date.now() / 1000);
  const token = signToken({ role: 'admin', iat: now, exp: now + 3600 }, process.env.SERVER_SESSION_SECRET);
  await writeAudit({ getDb: getAdminDb, actor: expectedUser, action: 'ADMIN_LOGIN', details: {} });
  return res.status(200).json({ success: true, token, expiresIn: 3600 });
}

async function verify(req, res) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (typeof process.env.SERVER_SESSION_SECRET !== 'string' || process.env.SERVER_SESSION_SECRET.length < 32) {
    return res.status(500).json({ success: false, message: 'SERVER_SESSION_SECRET must be configured with at least 32 characters.' });
  }

  const session = verifyToken(token, process.env.SERVER_SESSION_SECRET);
  if (!session || session.role !== 'admin') {
    return res.status(401).json({ success: false, message: 'Invalid or expired session' });
  }
  return res.status(200).json({ success: true, role: session.role });
}

async function handler(req, res) {
  // Tokens and session-verification results are private; never cache these responses.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }
  const { action } = req.query; // set by vercel.json rewrites
  switch (action) {
    case 'login': return login(req, res);
    case 'verify': return verify(req, res);
    default:
      return res.status(400).json({ success: false, message: 'Unknown action: ' + action });
  }
}

export default withApiSafety(handler, 'api/admin-auth');
