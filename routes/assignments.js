const express = require('express');
const router = express.Router();
const db = require('../db/database');
const XLSX = require('xlsx');
const { resolveYearId } = require('../db/academicYear');

const SUBJECTS = ['English', 'Hindi', 'History', 'Geography', 'Physics', 'Chemistry', 'Biology', 'Mathematics'];
const TYPES = ['Imposition', 'Other Assignment'];
const STATUSES = ['Pending', 'Submitted'];

function validDate(value) {
  const s = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function cleanToken(value) { return String(value || '').trim().toUpperCase(); }
function minPrefix(cls) { return String(cls) === '10' ? 3 : (['8', '9'].includes(String(cls)) ? 4 : 3); }
function teacherExists(subject, teacherName) {
  return db.prepare(`SELECT id, teacher_name FROM assignment_teachers WHERE subject = ? AND LOWER(teacher_name) = LOWER(?)`).get(subject, teacherName);
}
function readAssignments(filters) {
  let sql = `SELECT sa.*, s.status AS current_student_status
    FROM student_assignments sa LEFT JOIN students s
      ON s.admission_no = sa.admission_no AND s.academic_year_id = sa.academic_year_id
    WHERE sa.academic_year_id = ?`;
  const params = [filters.yearId];
  if (filters.date) { sql += ' AND sa.given_date = ?'; params.push(filters.date); }
  if (filters.subject) { sql += ' AND sa.subject = ?'; params.push(filters.subject); }
  if (filters.teacher) { sql += ' AND sa.teacher_name = ?'; params.push(filters.teacher); }
  if (filters.type) { sql += ' AND sa.assignment_type = ?'; params.push(filters.type); }
  if (filters.status) { sql += ' AND COALESCE(sa.submission_status, \'Pending\') = ?'; params.push(filters.status); }
  if (filters.class) { sql += ' AND sa.student_class = ?'; params.push(filters.class); }
  if (filters.division) { sql += ' AND sa.student_division = ?'; params.push(filters.division); }
  if (filters.admissionNo) {
    sql += ' AND (sa.admission_no LIKE ? OR sa.student_name LIKE ?)';
    params.push(`%${filters.admissionNo}%`, `%${filters.admissionNo}%`);
  }
  sql += ' ORDER BY sa.given_date DESC, sa.id DESC';
  return db.prepare(sql).all(...params);
}
function getFilters(query) {
  return {
    yearId: resolveYearId(query.academic_year_id),
    date: String(query.date || '').trim(), subject: String(query.subject || '').trim(),
    teacher: String(query.teacher || '').trim(), type: String(query.assignment_type || '').trim(),
    status: String(query.submission_status || '').trim(), class: String(query.class || '').trim(),
    division: String(query.division || '').trim(), admissionNo: String(query.admission_no || '').trim(),
  };
}
function validateBatch(body) {
  const teacherName = String(body.teacher_name || '').trim();
  const subject = String(body.subject || '').trim();
  const cls = String(body.class || '').trim();
  const division = String(body.division || '').trim();
  const givenDate = String(body.given_date || '').trim();
  const dueDate = String(body.due_date || '').trim();
  const type = String(body.assignment_type || 'Imposition').trim();
  const details = String(body.details || '').trim();
  if (!teacherName) return { error: 'Select a teacher.' };
  if (!SUBJECTS.includes(subject)) return { error: 'Select a valid subject.' };
  const teacher = teacherExists(subject, teacherName);
  if (!teacher) return { error: 'The selected teacher is not assigned to this subject.' };
  if (!cls || !division) return { error: 'Select a class and division.' };
  if (!validDate(givenDate)) return { error: 'Enter a valid given date.' };
  if (!validDate(dueDate)) return { error: 'Enter a valid due date.' };
  if (dueDate < givenDate) return { error: 'Due date cannot be earlier than the given date.' };
  if (!TYPES.includes(type)) return { error: 'Select a valid work type.' };
  if (details.length > 250) return { error: 'Work details must be 250 characters or fewer.' };
  return { teacherName: teacher.teacher_name, subject, cls, division, givenDate, dueDate, type, details };
}
function resolveToken(token, meta, yearId) {
  const numeric = /^\d+$/.test(token);
  if (numeric && token.length < minPrefix(meta.cls)) {
    return { status: 'invalid', message: `For Class ${meta.cls}, enter at least ${minPrefix(meta.cls)} leading digits.` };
  }
  let matches;
  if (numeric) {
    matches = db.prepare(`SELECT admission_no, name, class, division FROM students
      WHERE academic_year_id = ? AND class = ? AND COALESCE(status, 'Active') <> 'Withdrawn'
        AND UPPER(SUBSTR(admission_no, 1, ?)) = ?
      ORDER BY admission_no COLLATE NOCASE LIMIT 100`).all(yearId, meta.cls, token.length, token);
  } else {
    matches = db.prepare(`SELECT admission_no, name, class, division FROM students
      WHERE academic_year_id = ? AND class = ? AND COALESCE(status, 'Active') <> 'Withdrawn'
        AND UPPER(admission_no) = ?
      ORDER BY admission_no COLLATE NOCASE LIMIT 100`).all(yearId, meta.cls, token);
  }
  const inDivision = matches.filter(st => String(st.division).toUpperCase() === meta.division.toUpperCase());
  if (inDivision.length === 1) return { status: 'matched', student: inDivision[0] };
  if (inDivision.length > 1) return { status: 'ambiguous', message: 'Multiple students match. Enter the full Admission Number.' };
  if (matches.length) return { status: 'wrong_division', message: `Student match found in another division (${[...new Set(matches.map(st => st.division))].join(', ')}).` };
  return { status: 'not_found', message: 'No active student found in this class and division.' };
}
function isDuplicate({ yearId, admissionNo, meta }) {
  return !!db.prepare(`SELECT id FROM student_assignments
    WHERE academic_year_id = ? AND admission_no = ? AND assignment_type = ?
      AND subject = ? AND LOWER(teacher_name) = LOWER(?) AND given_date = ?
      AND LOWER(details) = LOWER(?) LIMIT 1`)
    .get(yearId, admissionNo, meta.type, meta.subject, meta.teacherName, meta.givenDate, meta.details);
}

// Subject-specific teacher roster, seeded with the supplied defaults.
router.get('/teachers', (req, res) => {
  const rows = db.prepare('SELECT id, subject, teacher_name FROM assignment_teachers ORDER BY subject, teacher_name').all();
  const bySubject = Object.fromEntries(SUBJECTS.map(subject => [subject, []]));
  for (const row of rows) (bySubject[row.subject] ||= []).push(row);
  res.json({ subjects: SUBJECTS, teachers: bySubject });
});

// Available active class/division combinations for the selected academic year.
router.get('/classes', (req, res) => {
  const yearId = resolveYearId(req.query.academic_year_id);
  const rows = db.prepare(`SELECT DISTINCT class FROM students WHERE academic_year_id = ? AND COALESCE(status, 'Active') <> 'Withdrawn' ORDER BY CAST(class AS INTEGER), class`).all(yearId);
  res.json(rows.map(r => String(r.class)));
});
router.get('/divisions', (req, res) => {
  const cls = String(req.query.class || '').trim();
  if (!cls) return res.status(400).json({ error: 'Select a class.' });
  const yearId = resolveYearId(req.query.academic_year_id);
  const rows = db.prepare(`SELECT DISTINCT division FROM students WHERE academic_year_id = ? AND class = ? AND COALESCE(status, 'Active') <> 'Withdrawn' ORDER BY division COLLATE NOCASE`).all(yearId, cls);
  res.json(rows.map(r => String(r.division)));
});

// Add a teacher to the selected subject's assignment roster.
router.post('/teachers', (req, res) => {
  const subject = String(req.body.subject || '').trim();
  const teacherName = String(req.body.teacher_name || '').trim().replace(/\s+/g, ' ');
  if (!SUBJECTS.includes(subject)) return res.status(400).json({ error: 'Select a valid subject.' });
  if (!teacherName || teacherName.length > 60) return res.status(400).json({ error: 'Enter a teacher name or initials (maximum 60 characters).' });
  const existing = teacherExists(subject, teacherName);
  if (existing) return res.status(409).json({ error: `${teacherName} is already available for ${subject}.`, teacher: existing });
  const result = db.prepare('INSERT INTO assignment_teachers (subject, teacher_name) VALUES (?, ?)').run(subject, teacherName);
  res.status(201).json({ id: result.lastInsertRowid, subject, teacher_name: teacherName });
});

router.get('/students', (req, res) => {
  const prefix = String(req.query.prefix || '').trim();
  const yearId = resolveYearId(req.query.academic_year_id);
  if (prefix.length < 3) return res.status(400).json({ error: 'Enter at least three characters of the Admission Number.' });
  const students = db.prepare(`SELECT admission_no, name, class, division FROM students
    WHERE academic_year_id = ? AND COALESCE(status, 'Active') <> 'Withdrawn'
      AND UPPER(SUBSTR(admission_no, 1, ?)) = UPPER(?)
    ORDER BY admission_no COLLATE NOCASE LIMIT 30`).all(yearId, prefix.length, prefix);
  res.json(students);
});

// Preview a complete class/division batch without saving anything.
router.post('/batch/preview', (req, res) => {
  const body = req.body || {};
  const meta = validateBatch(body);
  if (meta.error) return res.status(400).json({ error: meta.error });
  const tokens = (Array.isArray(body.admission_numbers) ? body.admission_numbers : String(body.admission_numbers || '').split(/[\s,;]+/))
    .map(cleanToken).filter(Boolean);
  if (!tokens.length) return res.status(400).json({ error: 'Enter at least one Admission Number.' });
  if (tokens.length > 500) return res.status(400).json({ error: 'A batch can contain at most 500 Admission Numbers.' });
  const yearId = resolveYearId(body.academic_year_id);
  const seenTokens = new Set(); const seenStudents = new Set();
  const rows = tokens.map(token => {
    if (seenTokens.has(token)) return { input: token, status: 'duplicate_input', message: 'This number is repeated in the list.' };
    seenTokens.add(token);
    const found = resolveToken(token, meta, yearId);
    if (found.status !== 'matched') return { input: token, status: found.status, message: found.message };
    const st = found.student;
    if (seenStudents.has(st.admission_no)) return { input: token, admission_no: st.admission_no, name: st.name, status: 'duplicate_input', message: 'This student is already included.' };
    seenStudents.add(st.admission_no);
    const duplicate = isDuplicate({ yearId, admissionNo: st.admission_no, meta });
    return { input: token, admission_no: st.admission_no, name: st.name, class: st.class, division: st.division,
      status: duplicate ? 'already_recorded' : 'matched', message: duplicate ? 'This assignment is already recorded.' : 'Ready to save.' };
  });
  const summary = rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  res.json({ rows, summary, ready_count: rows.filter(r => r.status === 'matched').length, academic_year_id: yearId });
});

// Confirm the previewed batch. Revalidates every item and writes in one transaction.
router.post('/batch', (req, res) => {
  const body = req.body || {};
  const meta = validateBatch(body);
  if (meta.error) return res.status(400).json({ error: meta.error });
  const admissionNos = Array.isArray(body.admission_nos) ? body.admission_nos.map(cleanToken).filter(Boolean) : [];
  if (!admissionNos.length) return res.status(400).json({ error: 'No eligible students were selected.' });
  if (admissionNos.length > 500 || new Set(admissionNos).size !== admissionNos.length) return res.status(400).json({ error: 'Invalid or duplicate Admission Numbers. Preview the list again.' });
  const yearId = resolveYearId(body.academic_year_id);
  const getStudent = db.prepare(`SELECT admission_no, name, class, division FROM students
    WHERE UPPER(admission_no) = ? AND academic_year_id = ? AND COALESCE(status, 'Active') <> 'Withdrawn'`);
  const insert = db.prepare(`INSERT INTO student_assignments
    (admission_no, student_name, student_class, student_division, assignment_type, subject, teacher_name, given_date, due_date, submission_status, details, academic_year_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?)`);
  try {
    const result = db.transaction(() => {
      const saved = [];
      for (const admissionNo of admissionNos) {
        const student = getStudent.get(admissionNo, yearId);
        if (!student || String(student.class) !== meta.cls || String(student.division).toUpperCase() !== meta.division.toUpperCase()) throw new Error(`Student ${admissionNo} is no longer active in the selected class and division. Preview again.`);
        if (isDuplicate({ yearId, admissionNo: student.admission_no, meta })) throw new Error(`An assignment for ${student.admission_no} was already recorded. Preview again.`);
        const id = insert.run(student.admission_no, student.name, student.class, student.division, meta.type, meta.subject, meta.teacherName, meta.givenDate, meta.dueDate, meta.details, yearId).lastInsertRowid;
        saved.push({ id, admission_no: student.admission_no, student_name: student.name });
      }
      return saved;
    })();
    res.status(201).json({ message: 'Assignments created.', saved_count: result.length, saved: result });
  } catch (err) { res.status(409).json({ error: err.message || 'Could not save batch.' }); }
});

router.get('/', (req, res) => res.json(readAssignments(getFilters(req.query))));

// Pending assignments are shown only for active students; submitted items remain in the register.
router.get('/pending', (req, res) => {
  const filters = getFilters(req.query);
  const rows = readAssignments({ ...filters, status: 'Pending' }).filter(r => String(r.current_student_status || 'Active') !== 'Withdrawn');
  res.json(rows);
});

// Export only unsubmitted assignments for the selected academic year / optional filters.
// Overdue items remain pending and are labelled Overdue in the spreadsheet.
router.get('/pending/export', (req, res) => {
  const filters = getFilters(req.query);
  const rows = readAssignments({ ...filters, status: 'Pending' })
    .filter(r => String(r.current_student_status || 'Active') !== 'Withdrawn');
  if (!rows.length) return res.status(404).json({ error: 'There are no pending assignments to export.' });
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const data = [
    ["Students' Home — Assignment Pending Report"], ['Academic Year ID', filters.yearId], [],
    ['Status', 'Date Given', 'Due Date', 'Admission No.', 'Student Name', 'Class', 'Division', 'Type', 'Subject', 'Teacher', 'Work Details'],
    ...rows.map(r => [r.due_date && r.due_date < today ? 'Overdue' : 'Pending', r.given_date, r.due_date || '', r.admission_no, r.student_name, r.student_class, r.student_division, r.assignment_type, r.subject, r.teacher_name, r.details || '']),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:14},{wch:14},{wch:14},{wch:16},{wch:26},{wch:9},{wch:10},{wch:20},{wch:16},{wch:18},{wch:34}];
  ws['!autofilter'] = { ref: `A4:K${4 + rows.length}` };
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Pending Assignments');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Students_Home_Assignment_Pending_Report.xlsx"');
  res.send(buffer);
});

// Mark a student's assignment as submitted, or reverse the status when necessary.
router.patch('/:id/submission', (req, res) => {
  const status = String(req.body.status || '').trim();
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Submission status must be Pending or Submitted.' });
  const row = db.prepare('SELECT id FROM student_assignments WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Assignment not found.' });
  if (status === 'Submitted') {
    const submittedDate = validDate(req.body.submitted_date) ? req.body.submitted_date : new Date().toISOString().slice(0, 10);
    db.prepare(`UPDATE student_assignments SET submission_status = 'Submitted', submitted_date = ?, submitted_by = 'Admin' WHERE id = ?`).run(submittedDate, req.params.id);
  } else {
    db.prepare(`UPDATE student_assignments SET submission_status = 'Pending', submitted_date = NULL, submitted_by = NULL WHERE id = ?`).run(req.params.id);
  }
  res.json({ message: status === 'Submitted' ? 'Assignment marked as submitted.' : 'Assignment returned to pending.', assignment: db.prepare('SELECT * FROM student_assignments WHERE id = ?').get(req.params.id) });
});

router.get('/export', (req, res) => {
  const filters = getFilters(req.query);
  const rows = readAssignments(filters);
  if (!rows.length) return res.status(404).json({ error: 'No assignment records match the selected filters.' });
  const data = [
    ["Students' Home — Impositions & Assignments"], ['Academic Year ID', filters.yearId], [],
    ['Date Given', 'Due Date', 'Submission Status', 'Submitted Date', 'Type', 'Admission No.', 'Student Name', 'Class', 'Division', 'Subject', 'Teacher', 'Details'],
    ...rows.map(r => [r.given_date, r.due_date || '', r.submission_status || 'Pending', r.submitted_date || '', r.assignment_type, r.admission_no, r.student_name, r.student_class, r.student_division, r.subject, r.teacher_name, r.details]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:14},{wch:14},{wch:18},{wch:16},{wch:20},{wch:16},{wch:26},{wch:9},{wch:10},{wch:16},{wch:18},{wch:32}];
  ws['!autofilter'] = { ref: `A4:L${4 + rows.length}` };
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Assignments');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Students_Home_Assignments.xlsx"');
  res.send(buffer);
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM student_assignments WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Assignment record not found.' });
  res.json({ message: 'Assignment record deleted.' });
});

module.exports = router;
