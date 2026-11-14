const crypto = require('crypto');
const db = require('./database');

const TEACHER_SESSION_COOKIE = 'ims_teacher_session';
const TEACHER_SESSION_HOURS = 12;

function createTeacherSession(teacherId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + TEACHER_SESSION_HOURS * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO teacher_portal_sessions (token, teacher_id, expires_at) VALUES (?, ?, ?)').run(token, teacherId, expires);
  return { token, expires };
}

function parseJsonArray(value) {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

function getSessionTeacher(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT a.id, a.name, a.teacher_code, a.subjects_json, a.classes_json,
           a.must_change_password, a.is_active
    FROM teacher_portal_sessions s
    JOIN teacher_portal_accounts a ON a.id = s.teacher_id
    WHERE s.token = ? AND julianday(s.expires_at) > julianday('now')
  `).get(token);
  if (!row || !row.is_active) return null;
  return {
    id: row.id,
    name: row.name,
    teacher_code: row.teacher_code,
    subjects: parseJsonArray(row.subjects_json),
    classes: parseJsonArray(row.classes_json),
    must_change_password: !!row.must_change_password,
  };
}

function destroyTeacherSession(token) {
  if (token) db.prepare('DELETE FROM teacher_portal_sessions WHERE token = ?').run(token);
}

function cleanExpiredTeacherSessions() {
  db.prepare("DELETE FROM teacher_portal_sessions WHERE julianday(expires_at) <= julianday('now')").run();
  db.prepare('DELETE FROM teacher_login_attempts WHERE window_started_ms < ?').run(Date.now() - 24 * 60 * 60 * 1000);
}

function requireTeacherAuth(req, res, next) {
  const token = req.cookies && req.cookies[TEACHER_SESSION_COOKIE];
  const teacher = getSessionTeacher(token);
  if (!teacher) return res.status(401).json({ error: 'Teacher login required' });
  if (teacher.must_change_password && !req.path.startsWith('/change-password')) {
    return res.status(403).json({ error: 'Please change your temporary password before continuing.', code: 'MUST_CHANGE_PASSWORD' });
  }
  req.teacher = teacher;
  next();
}

module.exports = {
  TEACHER_SESSION_COOKIE,
  TEACHER_SESSION_HOURS,
  createTeacherSession,
  getSessionTeacher,
  destroyTeacherSession,
  cleanExpiredTeacherSessions,
  requireTeacherAuth,
};
