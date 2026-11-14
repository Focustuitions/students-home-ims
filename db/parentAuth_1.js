const crypto = require('crypto');
const db = require('./database');

const PARENT_SESSION_COOKIE = 'ims_parent_session';
const PARENT_SESSION_DAYS = 7;
const SESSION_MS = PARENT_SESSION_DAYS * 24 * 60 * 60 * 1000;

function normalizeAdmissionNo(value) {
  return String(value || '').trim().toUpperCase();
}

// Accept common Indian phone-number formats (spaces, hyphens, +91, or a leading 0).
function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0091') && digits.length === 14) digits = digits.slice(4);
  else if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  return digits;
}

function createParentSession(admissionNo) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_MS).toISOString();
  db.prepare('INSERT INTO parent_sessions (token, admission_no, expires_at) VALUES (?, ?, ?)')
    .run(token, admissionNo, expires);
  return { token, expires };
}

function getSessionParent(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT s.admission_no, a.must_change_password,
           st.name, st.class, st.division
    FROM parent_sessions s
    JOIN parent_accounts a ON a.admission_no = s.admission_no
    JOIN students st ON st.admission_no = s.admission_no
    WHERE s.token = ? AND julianday(s.expires_at) > julianday('now')
  `).get(token);
  return row || null;
}

function destroyParentSession(token) {
  if (token) db.prepare('DELETE FROM parent_sessions WHERE token = ?').run(token);
}

function cleanExpiredParentSessions() {
  db.prepare("DELETE FROM parent_sessions WHERE julianday(expires_at) <= julianday('now')").run();
  db.prepare('DELETE FROM parent_login_attempts WHERE window_started_ms < ?').run(Date.now() - 24 * 60 * 60 * 1000);
}

function requireParentAuth(req, res, next) {
  const token = req.cookies && req.cookies[PARENT_SESSION_COOKIE];
  const parent = getSessionParent(token);
  if (!parent) return res.status(401).json({ error: 'Parent login required' });
  req.parent = parent;
  next();
}

module.exports = {
  PARENT_SESSION_COOKIE,
  PARENT_SESSION_DAYS,
  normalizeAdmissionNo,
  normalizePhone,
  createParentSession,
  getSessionParent,
  destroyParentSession,
  cleanExpiredParentSessions,
  requireParentAuth,
};
