const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { resolveYearId } = require('../db/academicYear');
const { requireTeacherAuth } = require('../db/teacherAuth');

router.use(requireTeacherAuth);

function addOneDay(value) { const d = new Date(`${value}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
function validDate(value) {
  const s = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function isClassAllowed(teacher, cls) { return teacher.classes.map(String).includes(String(cls)); }
function isSubjectAllowed(teacher, subject) { return teacher.subjects.includes(subject); }
function minPrefix(cls) { return cls === '10' ? 3 : ((cls === '9' || cls === '8') ? 4 : 3); }
function cleanToken(value) { return String(value || '').trim().toUpperCase(); }

function validateWorkDetails(body, teacher) {
  const cls = String(body.class || '').trim();
  const subject = String(body.subject || '').trim();
  const division = String(body.division || '').trim();
  const givenDate = String(body.given_date || '').trim();
  const details = String(body.details || '').trim();
  if (!isClassAllowed(teacher, cls)) return { error: 'You are not assigned to this class.', status: 403 };
  if (!isSubjectAllowed(teacher, subject)) return { error: 'You are not assigned to this subject.', status: 403 };
  if (!division) return { error: 'Select a division.', status: 400 };
  if (!validDate(givenDate)) return { error: 'Enter a valid given date.', status: 400 };
  if (details.length > 250) return { error: 'Details must be 250 characters or fewer.', status: 400 };
  return { cls, subject, division, givenDate, details };
}

function findStudentsForToken(token, cls, division, yearId) {
  const minDigits = minPrefix(cls);
  const numericPrefix = /^\d+$/.test(token);
  if (numericPrefix && token.length < minDigits) {
    return { status: 'invalid', message: `Enter at least ${minDigits} leading digits for Class ${cls}.` };
  }
  let matches;
  if (numericPrefix) {
    matches = db.prepare(`SELECT admission_no, name, class, division FROM students
      WHERE academic_year_id = ? AND class = ? AND COALESCE(status, 'Active') <> 'Withdrawn'
        AND UPPER(SUBSTR(admission_no, 1, ?)) = ?
      ORDER BY admission_no COLLATE NOCASE LIMIT 100`).all(yearId, cls, token.length, token);
  } else {
    matches = db.prepare(`SELECT admission_no, name, class, division FROM students
      WHERE academic_year_id = ? AND class = ? AND COALESCE(status, 'Active') <> 'Withdrawn'
        AND UPPER(admission_no) = ?
      ORDER BY admission_no COLLATE NOCASE LIMIT 100`).all(yearId, cls, token);
  }
  const inDivision = matches.filter(s => String(s.division).toUpperCase() === division.toUpperCase());
  if (inDivision.length === 1) return { status: 'matched', student: inDivision[0] };
  if (inDivision.length > 1) return { status: 'ambiguous', message: 'More than one student matches. Enter the full Admission Number.', candidates: inDivision };
  if (matches.length) return { status: 'wrong_division', message: `Match found in another division (${[...new Set(matches.map(s => s.division))].join(', ')}).` };
  return { status: 'not_found', message: 'No active student found in this class and division.' };
}

function isDuplicateImposition({ yearId, admissionNo, subject, teacher, givenDate, details }) {
  return !!db.prepare(`SELECT id FROM student_assignments
    WHERE academic_year_id = ? AND admission_no = ? AND assignment_type = 'Imposition'
      AND subject = ? AND teacher_account_id = ? AND given_date = ? AND LOWER(details) = LOWER(?) LIMIT 1`)
    .get(yearId, admissionNo, subject, teacher.id, givenDate, details);
}

router.get('/me', (req, res) => {
  res.json({ name: req.teacher.name, teacher_code: req.teacher.teacher_code, subjects: req.teacher.subjects, classes: req.teacher.classes });
});

router.get('/divisions', (req, res) => {
  const cls = String(req.query.class || '').trim();
  const yearId = resolveYearId(req.query.academic_year_id);
  if (!isClassAllowed(req.teacher, cls)) return res.status(403).json({ error: 'You are not assigned to this class.' });
  const rows = db.prepare(`SELECT DISTINCT division FROM students
    WHERE academic_year_id = ? AND class = ? AND COALESCE(status, 'Active') <> 'Withdrawn'
    ORDER BY division COLLATE NOCASE`).all(yearId, cls);
  res.json(rows.map(r => r.division));
});

// Keep the original single-student lookup endpoint available for compatibility.
router.get('/students', (req, res) => {
  const cls = String(req.query.class || '').trim();
  const prefix = String(req.query.prefix || '').trim().toUpperCase();
  const yearId = resolveYearId(req.query.academic_year_id);
  if (!isClassAllowed(req.teacher, cls)) return res.status(403).json({ error: 'You are not assigned to this class.' });
  const minDigits = minPrefix(cls);
  if (prefix.length < minDigits || !new RegExp(`^\\d{${minDigits}}`).test(prefix)) {
    return res.status(400).json({ error: `For Class ${cls}, enter the first ${minDigits} digits of the Admission Number.` });
  }
  const students = db.prepare(`
    SELECT admission_no, name, class, division
    FROM students
    WHERE academic_year_id = ? AND class = ?
      AND COALESCE(status, 'Active') <> 'Withdrawn'
      AND UPPER(SUBSTR(admission_no, 1, ?)) = ?
    ORDER BY admission_no COLLATE NOCASE LIMIT 25
  `).all(yearId, cls, prefix.length, prefix);
  res.json(students);
});

// Preview a pasted list. This endpoint never writes records.
router.post('/impositions/preview', (req, res) => {
  const body = req.body || {};
  const meta = validateWorkDetails(body, req.teacher);
  if (meta.error) return res.status(meta.status).json({ error: meta.error });
  const rawTokens = Array.isArray(body.admission_numbers)
    ? body.admission_numbers
    : String(body.admission_numbers || '').split(/[\s,;]+/);
  const tokens = rawTokens.map(cleanToken).filter(Boolean);
  if (!tokens.length) return res.status(400).json({ error: 'Enter at least one Admission Number.' });
  if (tokens.length > 500) return res.status(400).json({ error: 'A single batch can contain a maximum of 500 Admission Numbers.' });

  const yearId = resolveYearId(body.academic_year_id);
  const seen = new Set();
  const seenStudents = new Set();
  const rows = tokens.map(token => {
    if (seen.has(token)) return { input: token, status: 'duplicate_input', message: 'This Admission Number was repeated in the list.' };
    seen.add(token);
    const found = findStudentsForToken(token, meta.cls, meta.division, yearId);
    if (found.status !== 'matched') return { input: token, ...found };
    const st = found.student;
    if (seenStudents.has(st.admission_no)) return { input: token, admission_no: st.admission_no, name: st.name, division: st.division, status: 'duplicate_input', message: 'This student is already included in the list.' };
    seenStudents.add(st.admission_no);
    const duplicate = isDuplicateImposition({ yearId, admissionNo: st.admission_no, subject: meta.subject, teacher: req.teacher, givenDate: meta.givenDate, details: meta.details });
    return {
      input: token,
      status: duplicate ? 'already_recorded' : 'matched',
      message: duplicate ? 'This imposition is already recorded.' : 'Ready to save.',
      admission_no: st.admission_no,
      name: st.name,
      class: st.class,
      division: st.division,
    };
  });
  const summary = rows.reduce((acc, row) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, {});
  res.json({ rows, summary, ready_count: rows.filter(r => r.status === 'matched').length, academic_year_id: yearId });
});

// Confirm and save all validated students as one transaction.
router.post('/impositions/batch', (req, res) => {
  const body = req.body || {};
  const meta = validateWorkDetails(body, req.teacher);
  if (meta.error) return res.status(meta.status).json({ error: meta.error });
  const admissionNos = Array.isArray(body.admission_nos) ? body.admission_nos.map(cleanToken).filter(Boolean) : [];
  if (!admissionNos.length) return res.status(400).json({ error: 'There are no matched students to save.' });
  if (admissionNos.length > 500) return res.status(400).json({ error: 'A batch can contain a maximum of 500 students.' });
  if (new Set(admissionNos).size !== admissionNos.length) return res.status(400).json({ error: 'Duplicate Admission Numbers were submitted. Preview the list again.' });

  const yearId = resolveYearId(body.academic_year_id);
  const getStudent = db.prepare(`SELECT admission_no, name, class, division FROM students
    WHERE UPPER(admission_no) = ? AND academic_year_id = ? AND COALESCE(status, 'Active') <> 'Withdrawn'`);
  const insert = db.prepare(`INSERT INTO student_assignments
    (admission_no, student_name, student_class, student_division, assignment_type, subject, teacher_name, teacher_account_id, given_date, due_date, submission_status, details, academic_year_id)
    VALUES (?, ?, ?, ?, 'Imposition', ?, ?, ?, ?, ?, 'Pending', ?, ?)`);
  const tx = db.transaction(() => {
    const saved = [];
    const skipped = [];
    for (const admissionNo of admissionNos) {
      const student = getStudent.get(admissionNo, yearId);
      if (!student || String(student.class) !== meta.cls || String(student.division).toUpperCase() !== meta.division.toUpperCase()) {
        throw new Error(`Student ${admissionNo} is no longer active in the selected class and division. Preview the list again.`);
      }
      const duplicate = isDuplicateImposition({ yearId, admissionNo: student.admission_no, subject: meta.subject, teacher: req.teacher, givenDate: meta.givenDate, details: meta.details });
      if (duplicate) { skipped.push(admissionNo); continue; }
      const result = insert.run(student.admission_no, student.name, student.class, student.division, meta.subject, req.teacher.name, req.teacher.id, meta.givenDate, addOneDay(meta.givenDate), meta.details, yearId);
      saved.push({ id: result.lastInsertRowid, admission_no: student.admission_no, student_name: student.name });
    }
    return { saved, skipped };
  });

  try {
    const result = tx();
    res.status(201).json({ message: 'Batch impositions saved.', saved_count: result.saved.length, skipped_count: result.skipped.length, saved: result.saved, skipped: result.skipped });
  } catch (error) {
    res.status(409).json({ error: error.message || 'Could not save this batch.' });
  }
});

// Original single-student endpoint retained for any older client version.
router.post('/impositions', (req, res) => {
  const body = req.body || {};
  const admissionNo = String(body.admission_no || '').trim().toUpperCase();
  const cls = String(body.class || '').trim();
  const subject = String(body.subject || '').trim();
  const givenDate = String(body.given_date || '').trim();
  const details = String(body.details || '').trim();
  const yearId = resolveYearId(body.academic_year_id);
  if (!isClassAllowed(req.teacher, cls)) return res.status(403).json({ error: 'You are not assigned to this class.' });
  if (!isSubjectAllowed(req.teacher, subject)) return res.status(403).json({ error: 'You are not assigned to this subject.' });
  if (!admissionNo) return res.status(400).json({ error: 'Select a student.' });
  if (!validDate(givenDate)) return res.status(400).json({ error: 'Enter a valid given date.' });
  if (details.length > 250) return res.status(400).json({ error: 'Details must be 250 characters or fewer.' });
  const student = db.prepare(`SELECT admission_no, name, class, division FROM students
    WHERE admission_no = ? AND academic_year_id = ? AND COALESCE(status, 'Active') <> 'Withdrawn'`).get(admissionNo, yearId);
  if (!student) return res.status(404).json({ error: 'Student not found in the active register.' });
  if (String(student.class) !== cls) return res.status(400).json({ error: `This student belongs to Class ${student.class}.` });
  const duplicate = isDuplicateImposition({ yearId, admissionNo, subject, teacher: req.teacher, givenDate, details });
  if (duplicate) return res.status(409).json({ error: 'This imposition is already recorded for this student, subject and date.' });
  const result = db.prepare(`INSERT INTO student_assignments
    (admission_no, student_name, student_class, student_division, assignment_type, subject, teacher_name, teacher_account_id, given_date, due_date, submission_status, details, academic_year_id)
    VALUES (?, ?, ?, ?, 'Imposition', ?, ?, ?, ?, ?, 'Pending', ?, ?)`).run(student.admission_no, student.name, student.class, student.division, subject, req.teacher.name, req.teacher.id, givenDate, addOneDay(givenDate), details, yearId);
  const record = db.prepare('SELECT * FROM student_assignments WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ message: 'Imposition recorded.', record });
});

router.get('/impositions', (req, res) => {
  const yearId = resolveYearId(req.query.academic_year_id);
  const rows = db.prepare(`SELECT * FROM student_assignments
    WHERE academic_year_id = ? AND assignment_type = 'Imposition' AND teacher_account_id = ?
    ORDER BY given_date DESC, id DESC LIMIT 200`)
    .all(yearId, req.teacher.id);
  res.json(rows);
});

module.exports = router;
