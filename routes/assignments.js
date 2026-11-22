const express = require('express');
const router = express.Router();
const db = require('../db/database');
const XLSX = require('xlsx');
const { randomUUID } = require('crypto');
const { resolveYearId } = require('../db/academicYear');
const { MAX_RECORDS, validDate: validBulkDate, validateWindow, parseAndResolveAdmissionNumbers, countStatuses } = require('./bulk-submission-utils');

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
  // Accept both the explicit scope value and the checkbox flag. This keeps
  // class-wide assignment creation reliable if a client submits the checkbox
  // state without the newer target_scope field (for example, after a stale
  // browser script or an older cached form).
  const rawTargetScope = String(body.target_scope || '').trim();
  const rawEntireClassFlag = body.entire_class ?? body.assign_entire_class;
  const entireClassFlag = rawEntireClassFlag === true ||
    ['true', '1', 'yes', 'on'].includes(String(rawEntireClassFlag || '').trim().toLowerCase());
  const entireClass = rawTargetScope === 'entire_class' || entireClassFlag;
  const targetScope = entireClass ? 'entire_class' : (rawTargetScope || 'division');
  const givenDate = String(body.given_date || '').trim();
  const dueDate = String(body.due_date || '').trim();
  const type = String(body.assignment_type || 'Imposition').trim();
  const details = String(body.details || '').trim();
  if (!['division', 'entire_class'].includes(targetScope)) return { error: 'Select a valid assignment target.' };
  if (!teacherName) return { error: 'Select a teacher.' };
  if (!SUBJECTS.includes(subject)) return { error: 'Select a valid subject.' };
  const teacher = teacherExists(subject, teacherName);
  if (!teacher) return { error: 'The selected teacher is not assigned to this subject.' };
  if (!cls) return { error: 'Select a class.' };
  if (!entireClass && !division) return { error: 'Select a division, or enable Assign to the entire class (all divisions).' };
  if (!validDate(givenDate)) return { error: 'Enter a valid given date.' };
  if (!validDate(dueDate)) return { error: 'Enter a valid due date.' };
  if (dueDate < givenDate) return { error: 'Due date cannot be earlier than the given date.' };
  if (!TYPES.includes(type)) return { error: 'Select a valid work type.' };
  if (details.length > 250) return { error: 'Work details must be 250 characters or fewer.' };
  return { teacherName: teacher.teacher_name, subject, cls, division, targetScope, entireClass, givenDate, dueDate, type, details };
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

// Preview an individual division batch or every active student across a class's divisions.
router.post('/batch/preview', (req, res) => {
  const body = req.body || {};
  const meta = validateBatch(body);
  if (meta.error) return res.status(400).json({ error: meta.error });
  const yearId = resolveYearId(body.academic_year_id);
  let rows = [];
  let rosterAdmissionNos = [];
  let rosterSnapshot = [];

  if (meta.entireClass) {
    const students = db.prepare(`SELECT admission_no, name, class, division FROM students
      WHERE academic_year_id = ? AND class = ? AND COALESCE(status, 'Active') <> 'Withdrawn'
      ORDER BY division COLLATE NOCASE, name COLLATE NOCASE, admission_no COLLATE NOCASE`).all(yearId, meta.cls);
    if (!students.length) return res.status(404).json({ error: `No active students were found in Class ${meta.cls} for the selected academic year.` });
    if (students.length > 500) return res.status(400).json({ error: `Class ${meta.cls} has ${students.length} active students. The maximum per assignment batch is 500.` });
    rosterAdmissionNos = students.map(st => cleanToken(st.admission_no));
    rosterSnapshot = students.map(st => ({ admission_no: cleanToken(st.admission_no), name: String(st.name || ''), class: String(st.class || ''), division: String(st.division || '') }));
    rows = students.map(st => {
      const duplicate = isDuplicate({ yearId, admissionNo: st.admission_no, meta });
      return {
        input: st.admission_no,
        admission_no: st.admission_no,
        name: st.name,
        class: st.class,
        division: st.division,
        status: duplicate ? 'already_recorded' : 'matched',
        message: duplicate ? 'This assignment is already recorded for this student.' : 'Ready to save.',
      };
    });
  } else {
    const tokens = (Array.isArray(body.admission_numbers) ? body.admission_numbers : String(body.admission_numbers || '').split(/[\s,;]+/))
      .map(cleanToken).filter(Boolean);
    if (!tokens.length) return res.status(400).json({ error: 'Enter at least one Admission Number.' });
    if (tokens.length > 500) return res.status(400).json({ error: 'A batch can contain at most 500 Admission Numbers.' });
    const seenTokens = new Set(); const seenStudents = new Set();
    rows = tokens.map(token => {
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
  }
  const summary = rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  res.json({
    rows, summary, ready_count: rows.filter(r => r.status === 'matched').length,
    academic_year_id: yearId, target_scope: meta.targetScope,
    ...(meta.entireClass ? { roster_admission_nos: rosterAdmissionNos, roster_snapshot: rosterSnapshot } : {}),
  });
});

// Confirm the previewed batch. Revalidates the roster and writes every record in one transaction.
router.post('/batch', (req, res) => {
  const body = req.body || {};
  const meta = validateBatch(body);
  if (meta.error) return res.status(400).json({ error: meta.error });
  const admissionNos = Array.isArray(body.admission_nos) ? body.admission_nos.map(cleanToken).filter(Boolean) : [];
  const rosterAdmissionNos = Array.isArray(body.roster_admission_nos) ? body.roster_admission_nos.map(cleanToken).filter(Boolean) : [];
  const rosterSnapshot = Array.isArray(body.roster_snapshot) ? body.roster_snapshot : [];
  if (!admissionNos.length) return res.status(400).json({ error: 'No eligible students were selected.' });
  if (admissionNos.length > 500 || new Set(admissionNos).size !== admissionNos.length) return res.status(400).json({ error: 'Invalid or duplicate Admission Numbers. Preview the list again.' });
  if (meta.entireClass) {
    const snapshotAdmissionNos = rosterSnapshot.map(st => cleanToken(st && st.admission_no)).filter(Boolean);
    if (!rosterAdmissionNos.length || rosterAdmissionNos.length > 500 || new Set(rosterAdmissionNos).size !== rosterAdmissionNos.length ||
        rosterSnapshot.length !== rosterAdmissionNos.length || new Set(snapshotAdmissionNos).size !== snapshotAdmissionNos.length ||
        snapshotAdmissionNos.some(no => !rosterAdmissionNos.includes(no))) {
      return res.status(400).json({ error: 'The class-wide preview is invalid. Preview the class again.' });
    }
    if (admissionNos.some(no => !rosterAdmissionNos.includes(no))) {
      return res.status(400).json({ error: 'The submitted list does not match the class-wide preview. Preview again.' });
    }
  }
  const yearId = resolveYearId(body.academic_year_id);
  const getStudent = db.prepare(`SELECT admission_no, name, class, division FROM students
    WHERE UPPER(admission_no) = ? AND academic_year_id = ? AND COALESCE(status, 'Active') <> 'Withdrawn'`);
  // Link admin-assigned work to the Teacher Portal account with the same name.
  // Keep the link null when no unique active account exists; the admin register
  // continues to work for staff who do not use the Teacher Portal.
  const linkedTeacherAccounts = db.prepare(`SELECT id FROM teacher_portal_accounts
    WHERE is_active = 1 AND LOWER(TRIM(name)) = LOWER(TRIM(?)) ORDER BY id LIMIT 2`).all(meta.teacherName);
  const teacherAccountId = linkedTeacherAccounts.length === 1 ? linkedTeacherAccounts[0].id : null;
  const assignmentGroupId = randomUUID();
  const insert = db.prepare(`INSERT INTO student_assignments
    (admission_no, student_name, student_class, student_division, assignment_type, subject, teacher_name, teacher_account_id, given_date, due_date, submission_status, details, academic_year_id, assignment_group_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?)`);
  try {
    const result = db.transaction(() => {
      if (meta.entireClass) {
        const currentRoster = db.prepare(`SELECT admission_no, name, class, division FROM students
          WHERE academic_year_id = ? AND class = ? AND COALESCE(status, 'Active') <> 'Withdrawn'
          ORDER BY admission_no COLLATE NOCASE`).all(yearId, meta.cls)
          .map(st => ({ admission_no: cleanToken(st.admission_no), name: String(st.name || ''), class: String(st.class || ''), division: String(st.division || '') }))
          .sort((a, b) => a.admission_no.localeCompare(b.admission_no));
        const previewRoster = rosterSnapshot.map(st => ({
          admission_no: cleanToken(st && st.admission_no), name: String(st && st.name || ''),
          class: String(st && st.class || ''), division: String(st && st.division || ''),
        })).sort((a, b) => a.admission_no.localeCompare(b.admission_no));
        if (currentRoster.length !== previewRoster.length || currentRoster.some((st, index) =>
          st.admission_no !== previewRoster[index].admission_no || st.name !== previewRoster[index].name ||
          st.class !== previewRoster[index].class || st.division !== previewRoster[index].division)) {
          throw new Error('The active student list or class divisions have changed since preview. Preview the class again before saving.');
        }
      }
      const saved = [];
      for (const admissionNo of admissionNos) {
        const student = getStudent.get(admissionNo, yearId);
        const belongsToTarget = student && String(student.class) === meta.cls &&
          (meta.entireClass || String(student.division).toUpperCase() === meta.division.toUpperCase());
        if (!belongsToTarget) {
          throw new Error(meta.entireClass
            ? `Student ${admissionNo} is no longer active in Class ${meta.cls}. Preview again.`
            : `Student ${admissionNo} is no longer active in the selected class and division. Preview again.`);
        }
        if (isDuplicate({ yearId, admissionNo: student.admission_no, meta })) throw new Error(`An assignment for ${student.admission_no} was already recorded. Preview again.`);
        const id = insert.run(student.admission_no, student.name, student.class, student.division, meta.type, meta.subject, meta.teacherName, teacherAccountId, meta.givenDate, meta.dueDate, meta.details, yearId, assignmentGroupId).lastInsertRowid;
        saved.push({ id, admission_no: student.admission_no, student_name: student.name, class: student.class, division: student.division });
      }
      return saved;
    })();
    res.status(201).json({ message: 'Assignments created.', saved_count: result.length, saved: result, target_scope: meta.targetScope, assignment_group_id: assignmentGroupId });
  } catch (err) { res.status(409).json({ error: err.message || 'Could not save batch.' }); }
});

// Finish the step-by-step Admission Number workflow for one selected assignment.
// All selected rows must belong to the same assignment batch (or the same legacy
// assignment signature), remain Pending, and belong to the current academic year.
router.post('/submission-entry/submit', (req, res) => {
  const body = req.body || {};
  const yearId = resolveYearId(body.academic_year_id);
  const recordIds = Array.isArray(body.record_ids)
    ? body.record_ids.map(Number).filter(id => Number.isSafeInteger(id) && id > 0)
    : [];
  if (!recordIds.length) return res.status(400).json({ error: 'Enter at least one Admission Number before finishing.' });
  if (recordIds.length > 500 || recordIds.length !== body.record_ids.length || new Set(recordIds).size !== recordIds.length) {
    return res.status(400).json({ error: 'The selected student list is invalid or contains duplicates.' });
  }
  const submittedDate = validDate(body.submitted_date) ? body.submitted_date : new Date().toISOString().slice(0, 10);
  const placeholders = recordIds.map(() => '?').join(',');
  try {
    const submittedCount = db.transaction(() => {
      const rows = db.prepare(`SELECT sa.* FROM student_assignments sa
        LEFT JOIN students s ON s.admission_no = sa.admission_no AND s.academic_year_id = sa.academic_year_id
        WHERE sa.id IN (${placeholders}) AND sa.academic_year_id = ?
          AND COALESCE(sa.submission_status, 'Pending') = 'Pending'
          AND COALESCE(s.status, 'Active') <> 'Withdrawn'`).all(...recordIds, yearId);
      if (rows.length !== recordIds.length) {
        throw new Error('Some selected students are no longer pending or are no longer active. Refresh the assignment list and try again.');
      }
      const first = rows[0];
      const requestedGroupId = String(body.assignment_group_id || '').trim();
      if (first.assignment_group_id && requestedGroupId !== first.assignment_group_id) {
        throw new Error('The selected assignment has changed. Select the work again before finishing.');
      }
      const sameBatch = rows.every(row => {
        if (first.assignment_group_id) return row.assignment_group_id === first.assignment_group_id;
        return !row.assignment_group_id &&
          row.assignment_type === first.assignment_type && row.subject === first.subject &&
          String(row.teacher_name || '').trim().toLowerCase() === String(first.teacher_name || '').trim().toLowerCase() &&
          row.given_date === first.given_date && row.due_date === first.due_date &&
          String(row.details || '') === String(first.details || '') &&
          String(row.student_class || '') === String(first.student_class || '');
      });
      if (!sameBatch) throw new Error('The selected Admission Numbers do not belong to the same assignment. Select the work again.');
      const update = db.prepare(`UPDATE student_assignments
        SET submission_status = 'Submitted', submitted_date = ?, submitted_by = 'Admin'
        WHERE id = ? AND academic_year_id = ? AND COALESCE(submission_status, 'Pending') = 'Pending'`);
      let count = 0;
      for (const id of recordIds) count += update.run(submittedDate, id, yearId).changes;
      if (count !== recordIds.length) throw new Error('Some records could not be submitted. Nothing was saved; please refresh and try again.');
      return count;
    })();
    res.json({ message: 'Assignment submissions completed.', submitted_count: submittedCount, submitted_date: submittedDate });
  } catch (error) {
    res.status(409).json({ error: error.message || 'Could not finish assignment submissions.' });
  }
});

// Bulk-mark all pending assignment records due within the selected window for the listed students.
router.post('/bulk-submission/preview', (req, res) => {
  const body = req.body || {};
  const window = validateWindow(body);
  if (window.error) return res.status(400).json({ error: window.error });
  const resolved = parseAndResolveAdmissionNumbers(db, body.admission_numbers, window.yearId);
  if (resolved.error) return res.status(400).json({ error: resolved.error });

  let records = [];
  if (resolved.admissionNos.length) {
    const placeholders = resolved.admissionNos.map(() => '?').join(',');
    records = db.prepare(`SELECT sa.id, sa.admission_no, sa.student_name, sa.student_class, sa.student_division,
        sa.given_date, sa.due_date, sa.assignment_type, sa.subject, sa.teacher_name, sa.details
      FROM student_assignments sa LEFT JOIN students s
        ON s.admission_no = sa.admission_no AND s.academic_year_id = sa.academic_year_id
      WHERE sa.academic_year_id = ? AND COALESCE(sa.submission_status, 'Pending') = 'Pending'
        AND sa.due_date BETWEEN ? AND ? AND sa.admission_no IN (${placeholders})
        AND COALESCE(s.status, 'Active') <> 'Withdrawn'
      ORDER BY sa.due_date, sa.student_class, sa.student_division, sa.student_name, sa.id`)
      .all(window.yearId, window.fromDate, window.toDate, ...resolved.admissionNos);
  }
  if (records.length > MAX_RECORDS) return res.status(400).json({ error: `The selection contains more than ${MAX_RECORDS} pending records. Narrow the submission window.` });

  const countByAdmission = new Map();
  for (const row of records) countByAdmission.set(row.admission_no, (countByAdmission.get(row.admission_no) || 0) + 1);
  const students = resolved.rows.map(row => {
    if (row.status !== 'resolved') return row;
    const count = countByAdmission.get(row.admission_no) || 0;
    return { ...row, status: count ? 'ready' : 'no_pending_in_window', record_count: count,
      message: count ? `${count} pending assignment(s) will be marked submitted.` : 'No pending assignments are due within this window.' };
  });
  const summary = countStatuses(students);
  const recordIds = records.map(row => row.id);
  res.json({
    window_from: window.fromDate, window_to: window.toDate, academic_year_id: window.yearId,
    students, records, record_ids: recordIds, summary, ready_count: recordIds.length,
    ready_students: students.filter(row => row.status === 'ready').length,
  });
});

router.post('/bulk-submission/submit', (req, res) => {
  const body = req.body || {};
  const window = validateWindow(body);
  if (window.error) return res.status(400).json({ error: window.error });
  const resolved = parseAndResolveAdmissionNumbers(db, body.admission_numbers, window.yearId);
  if (resolved.error) return res.status(400).json({ error: resolved.error });
  const recordIds = Array.isArray(body.record_ids) ? [...new Set(body.record_ids.map(Number).filter(id => Number.isSafeInteger(id) && id > 0))] : [];
  if (!recordIds.length) return res.status(400).json({ error: 'No previewed assignment records were selected.' });
  if (recordIds.length > MAX_RECORDS || recordIds.length !== body.record_ids.length) return res.status(400).json({ error: 'The preview contains invalid or too many records. Preview the batch again.' });
  if (!validBulkDate(body.submitted_date)) return res.status(400).json({ error: 'Enter a valid submission date.' });
  if (!resolved.admissionNos.length) return res.status(400).json({ error: 'No valid students were matched. Preview the batch again.' });

  const placeholders = recordIds.map(() => '?').join(',');
  const admissionPlaceholders = resolved.admissionNos.map(() => '?').join(',');
  try {
    const updated = db.transaction(() => {
      const rows = db.prepare(`SELECT sa.id FROM student_assignments sa LEFT JOIN students s
        ON s.admission_no = sa.admission_no AND s.academic_year_id = sa.academic_year_id
        WHERE sa.id IN (${placeholders}) AND sa.academic_year_id = ?
          AND COALESCE(sa.submission_status, 'Pending') = 'Pending'
          AND sa.due_date BETWEEN ? AND ? AND sa.admission_no IN (${admissionPlaceholders})
          AND COALESCE(s.status, 'Active') <> 'Withdrawn'`)
        .all(...recordIds, window.yearId, window.fromDate, window.toDate, ...resolved.admissionNos);
      if (rows.length !== recordIds.length) throw new Error('Some previewed assignments have changed or are no longer eligible. Preview the batch again.');
      const update = db.prepare(`UPDATE student_assignments
        SET submission_status = 'Submitted', submitted_date = ?, submitted_by = 'Admin'
        WHERE id = ? AND COALESCE(submission_status, 'Pending') = 'Pending'`);
      let count = 0;
      for (const row of rows) count += update.run(body.submitted_date, row.id).changes;
      if (count !== recordIds.length) throw new Error('Some assignments could not be updated. Preview the batch again.');
      return count;
    })();
    res.json({ message: 'Bulk assignment submissions recorded.', submitted_count: updated, submitted_date: body.submitted_date });
  } catch (error) { res.status(409).json({ error: error.message || 'Could not submit the assignment batch.' }); }
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
