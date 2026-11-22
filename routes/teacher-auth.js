const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db/database');
const {
  TEACHER_SESSION_COOKIE,
  TEACHER_SESSION_HOURS,
  createTeacherSession,
  getSessionTeacher,
  destroyTeacherSession,
  requireTeacherAuth,
} = require('../db/teacherAuth');

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: TEACHER_SESSION_HOURS * 60 * 60 * 1000,
};

function normalizeCode(value) { return String(value || '').trim().toUpperCase().replace(/\s+/g, ''); }
function attemptKey(req, code) {
  const source = `${req.ip || req.socket.remoteAddress || 'unknown'}|${code}`;
  return crypto.createHash('sha256').update(source).digest('hex');
}

router.get('/status', (req, res) => {
  const token = req.cookies && req.cookies[TEACHER_SESSION_COOKIE];
  const teacher = getSessionTeacher(token);
  res.json({ loggedIn: !!teacher, teacher: teacher ? { name: teacher.name, teacher_code: teacher.teacher_code, must_change_password: teacher.must_change_password } : null });
});

router.post('/login', (req, res) => {
  const code = normalizeCode(req.body && req.body.teacher_code);
  const password = String((req.body && req.body.password) || '');
  if (!code || !password) return res.status(400).json({ error: 'Enter Teacher Code and password.' });
  const key = attemptKey(req, code);
  const now = Date.now();
  const attempt = db.prepare('SELECT * FROM teacher_login_attempts WHERE key_hash = ?').get(key);
  if (attempt && now - attempt.window_started_ms < 15 * 60 * 1000 && attempt.attempt_count >= 8) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again after 15 minutes.' });
  }

  const account = db.prepare('SELECT * FROM teacher_portal_accounts WHERE teacher_code = ? COLLATE NOCASE AND is_active = 1').get(code);
  if (!account || !bcrypt.compareSync(password, account.password_hash)) {
    if (!attempt || now - attempt.window_started_ms >= 15 * 60 * 1000) {
      db.prepare(`INSERT INTO teacher_login_attempts (key_hash, window_started_ms, attempt_count) VALUES (?, ?, 1)
        ON CONFLICT(key_hash) DO UPDATE SET window_started_ms=excluded.window_started_ms, attempt_count=1`).run(key, now);
    } else {
      db.prepare('UPDATE teacher_login_attempts SET attempt_count = attempt_count + 1 WHERE key_hash = ?').run(key);
    }
    return res.status(401).json({ error: 'Incorrect Teacher Code or password.' });
  }
  db.prepare('DELETE FROM teacher_login_attempts WHERE key_hash = ?').run(key);
  const { token } = createTeacherSession(account.id);
  res.cookie(TEACHER_SESSION_COOKIE, token, cookieOptions);
  res.json({ message: 'Teacher signed in.', must_change_password: !!account.must_change_password });
});

router.post('/logout', (req, res) => {
  destroyTeacherSession(req.cookies && req.cookies[TEACHER_SESSION_COOKIE]);
  res.clearCookie(TEACHER_SESSION_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
  res.json({ message: 'Signed out.' });
});

router.post('/change-password', requireTeacherAuth, (req, res) => {
  const newPassword = String((req.body && req.body.new_password) || '');
  if (!/^\d{4}$/.test(newPassword)) return res.status(400).json({ error: 'Teacher password must be exactly 4 digits.' });
  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare("UPDATE teacher_portal_accounts SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?").run(hash, req.teacher.id);
  // Rotate the session after a successful password change.
  destroyTeacherSession(req.cookies && req.cookies[TEACHER_SESSION_COOKIE]);
  const { token } = createTeacherSession(req.teacher.id);
  res.cookie(TEACHER_SESSION_COOKIE, token, cookieOptions);
  res.json({ message: 'Password updated.' });
});

module.exports = router;
