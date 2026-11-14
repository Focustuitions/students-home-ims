const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../db/database');
const { requireAuth } = require('../db/auth');
const {
  PARENT_SESSION_COOKIE,
  PARENT_SESSION_DAYS,
  normalizeAdmissionNo,
  normalizePhone,
  createParentSession,
  getSessionParent,
  destroyParentSession,
  requireParentAuth,
} = require('../db/parentAuth');

const SESSION_MS = PARENT_SESSION_DAYS * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_PAIR_ATTEMPTS = 5;
const MAX_IP_ATTEMPTS = 20;
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: SESSION_MS,
};

function rateKey(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function loginKeys(req, admissionNo) {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  return {
    ip: rateKey(`ip:${ip}`),
    pair: rateKey(`pair:${ip}:${admissionNo}`),
  };
}

function isLocked(keyHash, maxAttempts) {
  const row = db.prepare('SELECT window_started_ms, attempt_count FROM parent_login_attempts WHERE key_hash = ?').get(keyHash);
  if (!row || Date.now() - row.window_started_ms >= LOGIN_WINDOW_MS) return false;
  return row.attempt_count >= maxAttempts;
}

function recordFailure(keyHash) {
  const now = Date.now();
  const row = db.prepare('SELECT window_started_ms, attempt_count FROM parent_login_attempts WHERE key_hash = ?').get(keyHash);
  if (!row || now - row.window_started_ms >= LOGIN_WINDOW_MS) {
    db.prepare(`INSERT INTO parent_login_attempts (key_hash, window_started_ms, attempt_count)
      VALUES (?, ?, 1)
      ON CONFLICT(key_hash) DO UPDATE SET window_started_ms=excluded.window_started_ms, attempt_count=1`)
      .run(keyHash, now);
  } else {
    db.prepare('UPDATE parent_login_attempts SET attempt_count = attempt_count + 1 WHERE key_hash = ?').run(keyHash);
  }
}

function clearFailures(keys) {
  db.prepare('DELETE FROM parent_login_attempts WHERE key_hash IN (?, ?)').run(keys.ip, keys.pair);
}

function invalidLogin(res) {
  // Keep the response identical whether the admission number, mother phone, or password is wrong.
  return res.status(401).json({ error: 'Admission number or password is incorrect. Use the registered mother’s mobile number for the initial login.' });
}

router.get('/status', (req, res) => {
  const parent = getSessionParent(req.cookies && req.cookies[PARENT_SESSION_COOKIE]);
  res.set('Cache-Control', 'no-store');
  res.json({
    loggedIn: !!parent,
    mustChangePassword: parent ? !!parent.must_change_password : false,
  });
});

router.post('/login', (req, res) => {
  const admissionInput = String(req.body && req.body.admissionNo || '').trim();
  const admissionNo = normalizeAdmissionNo(admissionInput);
  const password = String(req.body && req.body.password || '');

  if (!admissionNo || !password || admissionInput.length > 80 || password.length > 256) {
    return res.status(400).json({ error: 'Enter your admission number and password.' });
  }

  const keys = loginKeys(req, admissionNo);
  if (isLocked(keys.pair, MAX_PAIR_ATTEMPTS) || isLocked(keys.ip, MAX_IP_ATTEMPTS)) {
    return res.status(429).json({ error: 'Too many failed login attempts. Please try again in 15 minutes.' });
  }

  const student = db.prepare(`
    SELECT admission_no, mother_phone
    FROM students
    WHERE UPPER(TRIM(admission_no)) = ?
    LIMIT 1
  `).get(admissionNo);

  let account = student && db.prepare('SELECT * FROM parent_accounts WHERE admission_no = ?').get(student.admission_no);
  let valid = false;

  if (student && account) {
    // Accounts awaiting their mandatory first password change use a normalized phone number.
    // After the password is changed, the chosen password is verified exactly as entered.
    valid = account.must_change_password
      ? bcrypt.compareSync(normalizePhone(password), account.password_hash)
      : bcrypt.compareSync(password, account.password_hash);
  } else if (student) {
    const suppliedPhone = normalizePhone(password);
    const registeredPhone = normalizePhone(student.mother_phone);
    if (suppliedPhone && registeredPhone && suppliedPhone === registeredPhone) {
      const hash = bcrypt.hashSync(suppliedPhone, 10);
      db.prepare(`INSERT OR IGNORE INTO parent_accounts (admission_no, password_hash, must_change_password)
        VALUES (?, ?, 1)`).run(student.admission_no, hash);
      account = db.prepare('SELECT * FROM parent_accounts WHERE admission_no = ?').get(student.admission_no);
      valid = !!account && !!account.must_change_password && bcrypt.compareSync(suppliedPhone, account.password_hash);
    }
  }

  if (!valid || !student || !account) {
    recordFailure(keys.ip);
    recordFailure(keys.pair);
    // Periodically remove stale counters without retaining a history of login attempts.
    db.prepare('DELETE FROM parent_login_attempts WHERE window_started_ms < ?').run(Date.now() - 24 * 60 * 60 * 1000);
    return invalidLogin(res);
  }

  clearFailures(keys);
  const { token } = createParentSession(student.admission_no);
  res.cookie(PARENT_SESSION_COOKIE, token, cookieOptions);
  res.json({
    message: 'Parent login successful',
    mustChangePassword: !!account.must_change_password,
  });
});

router.post('/logout', (req, res) => {
  destroyParentSession(req.cookies && req.cookies[PARENT_SESSION_COOKIE]);
  res.clearCookie(PARENT_SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
  res.json({ message: 'Logged out' });
});

router.get('/me', requireParentAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    student: {
      admission_no: req.parent.admission_no,
      name: req.parent.name,
      class: req.parent.class,
      division: req.parent.division,
    },
    mustChangePassword: !!req.parent.must_change_password,
  });
});

router.post('/change-password', requireParentAuth, (req, res) => {
  const currentPassword = String(req.body && req.body.currentPassword || '');
  const newPassword = String(req.body && req.body.newPassword || '');
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Enter your current and new passwords.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Choose a new password with at least 8 characters.' });
  }
  if (Buffer.byteLength(newPassword, 'utf8') > 72) {
    return res.status(400).json({ error: 'The new password must be 72 bytes or fewer.' });
  }

  const account = db.prepare('SELECT * FROM parent_accounts WHERE admission_no = ?').get(req.parent.admission_no);
  if (!account) return res.status(401).json({ error: 'Parent account not found. Please sign in again.' });

  const suppliedCurrent = account.must_change_password ? normalizePhone(currentPassword) : currentPassword;
  if (!bcrypt.compareSync(suppliedCurrent, account.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  if (normalizeAdmissionNo(newPassword) === normalizeAdmissionNo(req.parent.admission_no)) {
    return res.status(400).json({ error: 'Your new password must be different from the admission number.' });
  }
  const student = db.prepare('SELECT mother_phone FROM students WHERE admission_no = ?').get(req.parent.admission_no);
  const normalNewPassword = normalizePhone(newPassword);
  if (normalNewPassword && normalNewPassword === normalizePhone(student && student.mother_phone)) {
    return res.status(400).json({ error: 'Choose a password different from the registered mother’s mobile number.' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  const update = db.transaction(() => {
    db.prepare(`UPDATE parent_accounts SET password_hash = ?, must_change_password = 0, updated_at = datetime('now')
      WHERE admission_no = ?`).run(hash, req.parent.admission_no);
    // Invalidate other devices, then issue a fresh session for this browser.
    db.prepare('DELETE FROM parent_sessions WHERE admission_no = ?').run(req.parent.admission_no);
  });
  update();
  const { token } = createParentSession(req.parent.admission_no);
  res.cookie(PARENT_SESSION_COOKIE, token, cookieOptions);
  res.json({ message: 'Password updated successfully.' });
});

// Administrator-only recovery flow: reset a parent account to the current registered mother's phone.
// The parent must set a new private password on the next login.
router.post('/:admissionNo/reset-login', requireAuth, (req, res) => {
  const admissionNo = String(req.params.admissionNo || '').trim();
  const student = db.prepare('SELECT admission_no, mother_phone FROM students WHERE UPPER(TRIM(admission_no)) = UPPER(?)').get(admissionNo);
  if (!student) return res.status(404).json({ error: 'Student not found.' });
  const initialPassword = normalizePhone(student.mother_phone);
  if (!initialPassword) {
    return res.status(400).json({ error: 'This student has no registered mother’s mobile number. Update the student record first.' });
  }
  const passwordHash = bcrypt.hashSync(initialPassword, 10);
  const reset = db.transaction(() => {
    db.prepare(`INSERT INTO parent_accounts (admission_no, password_hash, must_change_password, updated_at)
      VALUES (?, ?, 1, datetime('now'))
      ON CONFLICT(admission_no) DO UPDATE SET password_hash=excluded.password_hash,
        must_change_password=1, updated_at=datetime('now')`).run(student.admission_no, passwordHash);
    db.prepare('DELETE FROM parent_sessions WHERE admission_no = ?').run(student.admission_no);
  });
  reset();
  res.json({ message: 'Parent login reset. The registered mother’s mobile number is the initial password; the parent must change it after signing in.' });
});

router.get('/dashboard', requireParentAuth, (req, res) => {
  if (req.parent.must_change_password) {
    return res.status(403).json({ error: 'Change your initial password before viewing student records.', mustChangePassword: true });
  }
  const admissionNo = req.parent.admission_no;
  const student = db.prepare(`
    SELECT admission_no, name, class, division, medium, school, joining_date, total_fees, discount, net_fees, status
    FROM students WHERE admission_no = ?
  `).get(admissionNo);
  if (!student) return res.status(404).json({ error: 'Student record not found.' });

  const payments = db.prepare(`
    SELECT receipt_no, amount, payment_date
    FROM payments WHERE admission_no = ?
    ORDER BY payment_date DESC, id DESC
  `).all(admissionNo);
  const weeklyTests = db.prepare(`
    SELECT t.exam_name, t.subject, t.topic, t.test_date, t.max_marks, m.marks, m.is_absent
    FROM weekly_test_marks m JOIN weekly_tests t ON t.id = m.weekly_test_id
    WHERE m.admission_no = ?
    ORDER BY t.test_date DESC, t.id DESC
  `).all(admissionNo);
  const termExams = db.prepare(`
    SELECT e.exam_name, e.exam_date, m.subject, m.marks, m.max_marks, m.is_absent
    FROM term_exam_marks m JOIN term_exams e ON e.id = m.term_exam_id
    WHERE m.admission_no = ?
    ORDER BY e.exam_date DESC, e.id DESC, m.subject COLLATE NOCASE ASC
  `).all(admissionNo);
  const observations = db.prepare(`
    SELECT date, subject, performance,
           notes_completed, notebook_neat, questions_answered, good_attention_span, no_notebook, no_textbook
    FROM hot_seats WHERE admission_no = ?
    ORDER BY date DESC, id DESC
  `).all(admissionNo);

  const paid = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  res.set('Cache-Control', 'no-store');
  res.json({
    student,
    fees: {
      total_fees: Number(student.total_fees || 0),
      discount: Number(student.discount || 0),
      net_fees: Number(student.net_fees || 0),
      paid: Math.round(paid * 100) / 100,
      balance: Math.round((Number(student.net_fees || 0) - paid) * 100) / 100,
    },
    payments,
    weeklyTests,
    termExams,
    observations,
  });
});


// Parent-only version of the administrator's full Student Performance Sheet.
// The admission number is taken exclusively from the authenticated parent session.
const studentRoutes = require('./students');
router.get('/performance-report', requireParentAuth, (req, res) => {
  if (req.parent.must_change_password) {
    return res.status(403).json({ error: 'Change your initial password before viewing student records.', mustChangePassword: true });
  }
  const reportReq = {
    params: { admission_no: req.parent.admission_no },
    query: {},
  };
  const reportRes = {
    json(data) {
      res.set('Cache-Control', 'no-store');
      return res.json(data);
    },
  };
  return studentRoutes.weeklyTestReportHandler(reportReq, reportRes);
});

module.exports = router;
