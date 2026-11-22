const crypto = require('crypto');
const db = require('./database');

const SESSION_COOKIE = 'ims_session';
const SESSION_DAYS = 30;

function hasAnyAdmin() {
  return !!db.prepare('SELECT id FROM admin_users LIMIT 1').get();
}

function createSession(adminId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, admin_id, expires_at) VALUES (?, ?, ?)').run(token, adminId, expires);
  return { token, expires };
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function getSessionAdmin(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT a.id, a.username FROM sessions s
    JOIN admin_users a ON a.id = s.admin_id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).get(token);
  return row || null;
}

function cleanExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}

// Express middleware: blocks unauthenticated API access with a 401
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[SESSION_COOKIE];
  const admin = getSessionAdmin(token);
  if (!admin) return res.status(401).json({ error: 'Not logged in' });
  req.admin = admin;
  next();
}

module.exports = { SESSION_COOKIE, SESSION_DAYS, hasAnyAdmin, createSession, destroySession, getSessionAdmin, cleanExpiredSessions, requireAuth };
