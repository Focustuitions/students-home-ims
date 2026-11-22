const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { resolveYearId } = require('../db/academicYear');

const SUBJECTS = ['English', 'Hindi', 'History', 'Geography', 'Physics', 'Chemistry', 'Biology', 'Mathematics'];
const cleanString = value => String(value || '').trim().replace(/\s+/g, ' ');
const cleanCode = value => String(value || '').trim().toUpperCase().replace(/\s+/g, '');
function parseArray(value) { try { const v = JSON.parse(value || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
// Generate the teacher's four-digit numeric login password.
function generateTeacherPassword() { return String(crypto.randomInt(1000, 10000)); }
function normalizeLists(body) {
  const subjects = [...new Set((Array.isArray(body.subjects) ? body.subjects : []).map(cleanString).filter(Boolean))];
  const classes = [...new Set((Array.isArray(body.classes) ? body.classes : []).map(v => String(v).trim()).filter(Boolean))];
  return { subjects, classes };
}
function validateLists(subjects, classes, yearId) {
  if (!subjects.length) return 'Select at least one subject.';
  if (subjects.some(s => !SUBJECTS.includes(s))) return 'One or more selected subjects are invalid.';
  if (!classes.length) return 'Select at least one class.';
  const available = db.prepare('SELECT DISTINCT class FROM students WHERE academic_year_id = ? AND COALESCE(status, \'Active\') <> \'Withdrawn\'').all(yearId).map(r => String(r.class));
  if (classes.some(c => !available.includes(c))) return 'One or more selected classes are not available in the active academic year.';
  return null;
}
function addTeacherToAssignmentRoster(name, subjects) {
  const insert = db.prepare('INSERT OR IGNORE INTO assignment_teachers (subject, teacher_name) VALUES (?, ?)');
  for (const subject of subjects) insert.run(subject, name);
}
function safeAccount(row) {
  return {
    id: row.id, name: row.name, teacher_code: row.teacher_code,
    subjects: parseArray(row.subjects_json), classes: parseArray(row.classes_json),
    is_active: !!row.is_active, must_change_password: !!row.must_change_password,
    created_at: row.created_at,
  };
}

router.get('/options', (req, res) => {
  const yearId = resolveYearId(req.query.academic_year_id);
  const classes = db.prepare(`SELECT DISTINCT class FROM students WHERE academic_year_id = ? AND COALESCE(status, 'Active') <> 'Withdrawn' ORDER BY CAST(class AS INTEGER), class`).all(yearId).map(r => String(r.class));
  res.json({ subjects: SUBJECTS, classes });
});

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM teacher_portal_accounts ORDER BY is_active DESC, name COLLATE NOCASE').all();
  res.json(rows.map(safeAccount));
});

router.post('/', (req, res) => {
  const body = req.body || {};
  const name = cleanString(body.name);
  const teacherCode = cleanCode(body.teacher_code);
  const { subjects, classes } = normalizeLists(body);
  const yearId = resolveYearId(body.academic_year_id);
  if (!name) return res.status(400).json({ error: 'Enter the teacher name.' });
  if (name.length > 100) return res.status(400).json({ error: 'Teacher name is too long.' });
  if (!/^[A-Z0-9_-]{2,20}$/.test(teacherCode)) return res.status(400).json({ error: 'Teacher Code must be 2–20 letters, numbers, hyphens or underscores.' });
  const listError = validateLists(subjects, classes, yearId);
  if (listError) return res.status(400).json({ error: listError });
  const teacherPassword = generateTeacherPassword();
  const passwordHash = bcrypt.hashSync(teacherPassword, 12);
  try {
    const result = db.transaction(() => {
      const created = db.prepare(`INSERT INTO teacher_portal_accounts
        (name, teacher_code, subjects_json, classes_json, password_hash, must_change_password, is_active)
        VALUES (?, ?, ?, ?, ?, 0, 1)`)
        .run(name, teacherCode, JSON.stringify(subjects), JSON.stringify(classes), passwordHash);
      addTeacherToAssignmentRoster(name, subjects);
      return created;
    })();
    res.status(201).json({ message: 'Teacher portal account created with a four-digit password.', id: result.lastInsertRowid, teacher_password: teacherPassword });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'This Teacher Code is already in use.' });
    console.error('Teacher account creation failed:', err);
    res.status(500).json({ error: 'Could not create the teacher portal account.' });
  }
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM teacher_portal_accounts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Teacher portal account not found.' });
  const body = req.body || {};
  const name = body.name !== undefined ? cleanString(body.name) : existing.name;
  const teacherCode = body.teacher_code !== undefined ? cleanCode(body.teacher_code) : existing.teacher_code;
  const subjects = body.subjects !== undefined ? normalizeLists(body).subjects : parseArray(existing.subjects_json);
  const classes = body.classes !== undefined ? normalizeLists(body).classes : parseArray(existing.classes_json);
  const yearId = resolveYearId(body.academic_year_id);
  if (!name) return res.status(400).json({ error: 'Enter the teacher name.' });
  if (!/^[A-Z0-9_-]{2,20}$/.test(teacherCode)) return res.status(400).json({ error: 'Teacher Code must be 2–20 letters, numbers, hyphens or underscores.' });
  const listError = validateLists(subjects, classes, yearId);
  if (listError) return res.status(400).json({ error: listError });
  try {
    db.transaction(() => {
      db.prepare(`UPDATE teacher_portal_accounts SET name=?, teacher_code=?, subjects_json=?, classes_json=?,
        is_active=?, updated_at=datetime('now') WHERE id=?`)
        .run(name, teacherCode, JSON.stringify(subjects), JSON.stringify(classes), body.is_active === undefined ? existing.is_active : (body.is_active ? 1 : 0), req.params.id);
      addTeacherToAssignmentRoster(name, subjects);
    })();
    // Revoke active sessions whenever permissions or account details change.
    db.prepare('DELETE FROM teacher_portal_sessions WHERE teacher_id = ?').run(req.params.id);
    res.json({ message: 'Teacher portal account updated.' });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'This Teacher Code is already in use.' });
    res.status(500).json({ error: 'Could not update the teacher portal account.' });
  }
});

router.post('/:id/reset-password', (req, res) => {
  const existing = db.prepare('SELECT id FROM teacher_portal_accounts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Teacher portal account not found.' });
  const teacherPassword = generateTeacherPassword();
  const passwordHash = bcrypt.hashSync(teacherPassword, 12);
  db.prepare(`UPDATE teacher_portal_accounts SET password_hash=?, must_change_password=0, updated_at=datetime('now') WHERE id=?`).run(passwordHash, req.params.id);
  db.prepare('DELETE FROM teacher_portal_sessions WHERE teacher_id = ?').run(req.params.id);
  res.json({ message: 'A new four-digit teacher password has been generated.', teacher_password: teacherPassword });
});

router.post('/:id/status', (req, res) => {
  const active = req.body && req.body.is_active ? 1 : 0;
  const result = db.prepare(`UPDATE teacher_portal_accounts SET is_active=?, updated_at=datetime('now') WHERE id=?`).run(active, req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Teacher portal account not found.' });
  if (!active) db.prepare('DELETE FROM teacher_portal_sessions WHERE teacher_id = ?').run(req.params.id);
  res.json({ message: active ? 'Teacher account activated.' : 'Teacher account deactivated.' });
});

module.exports = router;
