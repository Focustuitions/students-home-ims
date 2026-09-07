const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { SESSION_COOKIE, SESSION_DAYS, hasAnyAdmin, createSession, destroySession, getSessionAdmin, requireAuth } = require('../db/auth');

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
};

// Whether an admin account exists yet, and whether the current browser is logged in
router.get('/status', (req, res) => {
  const token = req.cookies && req.cookies[SESSION_COOKIE];
  const admin = getSessionAdmin(token);
  res.json({
    setupNeeded: !hasAnyAdmin(),
    loggedIn: !!admin,
    username: admin ? admin.username : null,
  });
});

// First-run only: create the one administrator account
router.post('/setup', (req, res) => {
  if (hasAnyAdmin()) return res.status(409).json({ error: 'An administrator account already exists' });
  const { username, password } = req.body;
  if (!username || !username.trim()) return res.status(400).json({ error: 'Choose a username' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run(username.trim(), hash);
  const { token } = createSession(result.lastInsertRowid);
  res.cookie(SESSION_COOKIE, token, cookieOptions);
  res.status(201).json({ message: 'Administrator account created', username: username.trim() });
});

// Log in
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

  const admin = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username.trim());
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Incorrect username or password' });
  }
  const { token } = createSession(admin.id);
  res.cookie(SESSION_COOKIE, token, cookieOptions);
  res.json({ message: 'Logged in', username: admin.username });
});

// Log out
router.post('/logout', (req, res) => {
  destroySession(req.cookies && req.cookies[SESSION_COOKIE]);
  res.clearCookie(SESSION_COOKIE);
  res.json({ message: 'Logged out' });
});

// Change password (must already be logged in)
router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const admin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.admin.id);
  if (!bcrypt.compareSync(currentPassword || '', admin.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(hash, admin.id);
  res.json({ message: 'Password updated' });
});

module.exports = router;
