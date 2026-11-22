const express = require('express');
const router = express.Router();
const db = require('../db/database');
const XLSX = require('xlsx');
const { resolveYearId } = require('../db/academicYear');
const { MAX_RECORDS, validDate: validBulkDate, validateWindow, parseAndResolveAdmissionNumbers, countStatuses } = require('./bulk-submission-utils');

const STATUSES = ['Pending', 'Submitted'];

function validDate(value) {
  const s = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function addOneDay(value) {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function cleanToken(value) { return String(value || '').trim().toUpperCase(); }
function validateMeta(body) {
  const lateDate = String(body.late_date || body.date || '').trim();
  if (!validDate(lateDate)) return { error: 'Enter a valid late-arrival date.' };
  return { lateDate, dueDate: addOneDay(lateDate) };
}
function resolveStudent(token, meta, yearId) {
  const numeric = /^\d+$/.test(token);
  if (numeric && token.length < 3) {
    return { status: 'invalid', message: 'Enter at least 3 digits. For Classes 8 and 9, enter at least 4 digits.' };
  }
  let matches;
  if (numeric) {
    matches = db.prepare(`SELECT admission_no, name, class, division FROM students
      WHERE academic_year_id = ? AND COALESCE(status, 'Active') <> 'Withdrawn'
        AND UPPER(SUBSTR(admission_no, 1, ?)) = ?
      ORDER BY admission_no COLLATE NOCASE LIMIT 100`).all(yearId, token.length, token);
  } else {
    matches = db.prepare(`SELECT admission_no, name, class, division FROM students
      WHERE academic_year_id = ? AND COALESCE(status, 'Active') <> 'Withdrawn'
        AND UPPER(admission_no) = ?
      ORDER BY admission_no COLLATE NOCASE LIMIT 100`).all(yearId, token);
  }
  if (matches.length > 1) return { status: 'ambiguous', message: `Multiple active students match this number (${[...new Set(matches.map(s => `Class ${s.class} - ${s.division}`))].join(', ')}). Enter the full Admission Number.` };
  if (!matches.length) return { status: 'not_found', message: 'No active student found in the selected academic year.' };
  const student = matches[0];
  const cls = String(student.class);
  const minimum = ['8', '9'].includes(cls) ? 4 : 3;
  if (numeric && token.length < minimum) {
    return { status: 'invalid', message: `For Class ${cls}, enter at least ${minimum} leading digits.` };
  }
  return { status: 'matched', student };
}
function alreadyRecorded(yearId, admissionNo, lateDate) {
  return !!db.prepare(`SELECT id FROM late_arrival_works
    WHERE academic_year_id = ? AND admission_no = ? AND late_date = ? LIMIT 1`)
    .get(yearId, admissionNo, lateDate);
}
function filtersFrom(query) {
  return {
    yearId: resolveYearId(query.academic_year_id),
    date: String(query.date || '').trim(),
    status: String(query.submission_status || '').trim(),
    cls: String(query.class || '').trim(),
    division: String(query.division || '').trim(),
    admissionNo: String(query.admission_no || '').trim(),
  };
}
function listRows(filters, pendingOnly = false) {
  let sql = `SELECT lw.*, s.status AS current_student_status
    FROM late_arrival_works lw LEFT JOIN students s
      ON s.admission_no = lw.admission_no AND s.academic_year_id = lw.academic_year_id
    WHERE lw.academic_year_id = ?`;
  const params = [filters.yearId];
  if (filters.date) { sql += ' AND lw.late_date = ?'; params.push(filters.date); }
  if (filters.status) { sql += ' AND lw.submission_status = ?'; params.push(filters.status); }
  if (filters.cls) { sql += ' AND lw.student_class = ?'; params.push(filters.cls); }
  if (filters.division) { sql += ' AND lw.student_division = ?'; params.push(filters.division); }
  if (filters.admissionNo) {
    sql += ' AND (lw.admission_no LIKE ? OR lw.student_name LIKE ?)';
    params.push(`%${filters.admissionNo}%`, `%${filters.admissionNo}%`);
  }
  if (pendingOnly) sql += " AND lw.submission_status = 'Pending' AND COALESCE(s.status, 'Active') <> 'Withdrawn'";
  sql += ' ORDER BY lw.late_date DESC, lw.id DESC';
  return db.prepare(sql).all(...params);
}

router.get('/classes', (req, res) => {
  const yearId = resolveYearId(req.query.academic_year_id);
  const rows = db.prepare(`SELECT DISTINCT class FROM students
    WHERE academic_year_id = ? AND COALESCE(status, 'Active') <> 'Withdrawn'
    ORDER BY CAST(class AS INTEGER), class`).all(yearId);
  res.json(rows.map(r => String(r.class)));
});

router.get('/divisions', (req, res) => {
  const cls = String(req.query.class || '').trim();
  if (!cls) return res.status(400).json({ error: 'Select a class.' });
  const yearId = resolveYearId(req.query.academic_year_id);
  const rows = db.prepare(`SELECT DISTINCT division FROM students
    WHERE academic_year_id = ? AND class = ? AND COALESCE(status, 'Active') <> 'Withdrawn'
    ORDER BY division COLLATE NOCASE`).all(yearId, cls);
  res.json(rows.map(r => String(r.division)));
});

router.post('/batch/preview', (req, res) => {
  const meta = validateMeta(req.body || {});
  if (meta.error) return res.status(400).json({ error: meta.error });
  const tokens = (Array.isArray(req.body.admission_numbers) ? req.body.admission_numbers : String(req.body.admission_numbers || '').split(/[\s,;]+/))
    .map(cleanToken).filter(Boolean);
  if (!tokens.length) return res.status(400).json({ error: 'Enter at least one Admission Number.' });
  if (tokens.length > 500) return res.status(400).json({ error: 'A batch can contain at most 500 Admission Numbers.' });
  const yearId = resolveYearId(req.body.academic_year_id);
  const seenTokens = new Set();
  const seenStudents = new Set();
  const rows = tokens.map(token => {
    if (seenTokens.has(token)) return { input: token, status: 'duplicate_input', message: 'This number is repeated in the list.' };
    seenTokens.add(token);
    const found = resolveStudent(token, meta, yearId);
    if (found.status !== 'matched') return { input: token, ...found };
    const st = found.student;
    if (seenStudents.has(st.admission_no)) return { input: token, admission_no: st.admission_no, name: st.name, class: st.class, division: st.division, status: 'duplicate_input', message: 'This student is already included in the list.' };
    seenStudents.add(st.admission_no);
    const duplicate = alreadyRecorded(yearId, st.admission_no, meta.lateDate);
    return { input: token, admission_no: st.admission_no, name: st.name, class: st.class, division: st.division,
      status: duplicate ? 'already_recorded' : 'matched', message: duplicate ? 'Late-arrival work is already recorded for this student on this date.' : 'Ready to save.' };
  });
  const summary = rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  res.json({ rows, summary, ready_count: rows.filter(r => r.status === 'matched').length, late_date: meta.lateDate, due_date: meta.dueDate, academic_year_id: yearId });
});

router.post('/batch', (req, res) => {
  const meta = validateMeta(req.body || {});
  if (meta.error) return res.status(400).json({ error: meta.error });
  const admissionNos = Array.isArray(req.body.admission_nos) ? req.body.admission_nos.map(cleanToken).filter(Boolean) : [];
  if (!admissionNos.length) return res.status(400).json({ error: 'No eligible students were selected.' });
  if (admissionNos.length > 500 || new Set(admissionNos).size !== admissionNos.length) return res.status(400).json({ error: 'Invalid or duplicate Admission Numbers. Preview the list again.' });
  const yearId = resolveYearId(req.body.academic_year_id);
  const getStudent = db.prepare(`SELECT admission_no, name, class, division FROM students
    WHERE UPPER(admission_no) = ? AND academic_year_id = ? AND COALESCE(status, 'Active') <> 'Withdrawn'`);
  const insert = db.prepare(`INSERT INTO late_arrival_works
    (admission_no, student_name, student_class, student_division, late_date, due_date, details, submission_status, academic_year_id)
    VALUES (?, ?, ?, ?, ?, ?, 'Additional work assigned for late arrival', 'Pending', ?)`);
  try {
    const saved = db.transaction(() => {
      const out = [];
      for (const admissionNo of admissionNos) {
        const student = getStudent.get(admissionNo, yearId);
        if (!student) {
          throw new Error(`Student ${admissionNo} is no longer active in this academic year. Preview again.`);
        }
        if (alreadyRecorded(yearId, student.admission_no, meta.lateDate)) throw new Error(`Late-arrival work for ${student.admission_no} is already recorded on this date. Preview again.`);
        const id = insert.run(student.admission_no, student.name, student.class, student.division, meta.lateDate, meta.dueDate, yearId).lastInsertRowid;
        out.push({ id, admission_no: student.admission_no, student_name: student.name });
      }
      return out;
    })();
    res.status(201).json({ message: 'Late-arrival work saved.', saved_count: saved.length, saved });
  } catch (error) { res.status(409).json({ error: error.message || 'Could not save late-arrival work.' }); }
});


// Bulk-mark all pending late-arrival work due within the selected window for the listed students.
router.post('/bulk-submission/preview', (req, res) => {
  const body = req.body || {};
  const window = validateWindow(body);
  if (window.error) return res.status(400).json({ error: window.error });
  const resolved = parseAndResolveAdmissionNumbers(db, body.admission_numbers, window.yearId);
  if (resolved.error) return res.status(400).json({ error: resolved.error });

  let records = [];
  if (resolved.admissionNos.length) {
    const placeholders = resolved.admissionNos.map(() => '?').join(',');
    records = db.prepare(`SELECT lw.id, lw.admission_no, lw.student_name, lw.student_class, lw.student_division,
        lw.late_date, lw.due_date, lw.details
      FROM late_arrival_works lw LEFT JOIN students s
        ON s.admission_no = lw.admission_no AND s.academic_year_id = lw.academic_year_id
      WHERE lw.academic_year_id = ? AND COALESCE(lw.submission_status, 'Pending') = 'Pending'
        AND lw.due_date BETWEEN ? AND ? AND lw.admission_no IN (${placeholders})
        AND COALESCE(s.status, 'Active') <> 'Withdrawn'
      ORDER BY lw.due_date, lw.student_class, lw.student_division, lw.student_name, lw.id`)
      .all(window.yearId, window.fromDate, window.toDate, ...resolved.admissionNos);
  }
  if (records.length > MAX_RECORDS) return res.status(400).json({ error: `The selection contains more than ${MAX_RECORDS} pending records. Narrow the submission window.` });

  const countByAdmission = new Map();
  for (const row of records) countByAdmission.set(row.admission_no, (countByAdmission.get(row.admission_no) || 0) + 1);
  const students = resolved.rows.map(row => {
    if (row.status !== 'resolved') return row;
    const count = countByAdmission.get(row.admission_no) || 0;
    return { ...row, status: count ? 'ready' : 'no_pending_in_window', record_count: count,
      message: count ? `${count} pending late-arrival work record(s) will be marked submitted.` : 'No pending late-arrival work is due within this window.' };
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
  if (!recordIds.length) return res.status(400).json({ error: 'No previewed late-arrival records were selected.' });
  if (recordIds.length > MAX_RECORDS || recordIds.length !== body.record_ids.length) return res.status(400).json({ error: 'The preview contains invalid or too many records. Preview the batch again.' });
  if (!validBulkDate(body.submitted_date)) return res.status(400).json({ error: 'Enter a valid submission date.' });
  if (!resolved.admissionNos.length) return res.status(400).json({ error: 'No valid students were matched. Preview the batch again.' });

  const placeholders = recordIds.map(() => '?').join(',');
  const admissionPlaceholders = resolved.admissionNos.map(() => '?').join(',');
  try {
    const updated = db.transaction(() => {
      const rows = db.prepare(`SELECT lw.id FROM late_arrival_works lw LEFT JOIN students s
        ON s.admission_no = lw.admission_no AND s.academic_year_id = lw.academic_year_id
        WHERE lw.id IN (${placeholders}) AND lw.academic_year_id = ?
          AND COALESCE(lw.submission_status, 'Pending') = 'Pending'
          AND lw.due_date BETWEEN ? AND ? AND lw.admission_no IN (${admissionPlaceholders})
          AND COALESCE(s.status, 'Active') <> 'Withdrawn'`)
        .all(...recordIds, window.yearId, window.fromDate, window.toDate, ...resolved.admissionNos);
      if (rows.length !== recordIds.length) throw new Error('Some previewed late-arrival records have changed or are no longer eligible. Preview the batch again.');
      const update = db.prepare(`UPDATE late_arrival_works
        SET submission_status = 'Submitted', submitted_date = ?, submitted_by = 'Admin'
        WHERE id = ? AND COALESCE(submission_status, 'Pending') = 'Pending'`);
      let count = 0;
      for (const row of rows) count += update.run(body.submitted_date, row.id).changes;
      if (count !== recordIds.length) throw new Error('Some late-arrival records could not be updated. Preview the batch again.');
      return count;
    })();
    res.json({ message: 'Bulk late-arrival submissions recorded.', submitted_count: updated, submitted_date: body.submitted_date });
  } catch (error) { res.status(409).json({ error: error.message || 'Could not submit the late-arrival batch.' }); }
});

router.get('/', (req, res) => res.json(listRows(filtersFrom(req.query))));
router.get('/pending', (req, res) => res.json(listRows(filtersFrom(req.query), true)));

// Export only pending / overdue late-arrival work; full record export remains at /export.
router.get('/pending/export', (req, res) => {
  const filters = filtersFrom(req.query);
  const rows = listRows({ ...filters, status: 'Pending' }, true);
  if (!rows.length) return res.status(404).json({ error: 'There are no pending late-arrival records to export.' });
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const data = [
    ["Students' Home — Late Arrival Pending Report"], ['Academic Year ID', filters.yearId], [],
    ['Status', 'Late Arrival Date', 'Due Date', 'Admission No.', 'Student Name', 'Class', 'Division', 'Work Details'],
    ...rows.map(r => [r.due_date && r.due_date < today ? 'Overdue' : 'Pending', r.late_date, r.due_date || '', r.admission_no, r.student_name, r.student_class, r.student_division, r.details || 'Additional work for late arrival']),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:14},{wch:18},{wch:14},{wch:16},{wch:26},{wch:9},{wch:10},{wch:38}];
  ws['!autofilter'] = { ref: `A4:H${4 + rows.length}` };
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Pending Late Arrival');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Students_Home_Late_Arrival_Pending_Report.xlsx"');
  res.send(buffer);
});

router.patch('/:id/submission', (req, res) => {
  const status = String(req.body.status || '').trim();
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Submission status must be Pending or Submitted.' });
  const row = db.prepare('SELECT id FROM late_arrival_works WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Late-arrival work not found.' });
  if (status === 'Submitted') {
    const submittedDate = validDate(req.body.submitted_date) ? req.body.submitted_date : new Date().toISOString().slice(0, 10);
    db.prepare(`UPDATE late_arrival_works SET submission_status = 'Submitted', submitted_date = ?, submitted_by = 'Admin' WHERE id = ?`).run(submittedDate, req.params.id);
  } else {
    db.prepare(`UPDATE late_arrival_works SET submission_status = 'Pending', submitted_date = NULL, submitted_by = NULL WHERE id = ?`).run(req.params.id);
  }
  res.json({ message: status === 'Submitted' ? 'Submission recorded.' : 'Work returned to pending.', record: db.prepare('SELECT * FROM late_arrival_works WHERE id = ?').get(req.params.id) });
});

router.get('/export', (req, res) => {
  const filters = filtersFrom(req.query);
  const rows = listRows(filters);
  if (!rows.length) return res.status(404).json({ error: 'No late-arrival records match the selected filters.' });
  const data = [
    ["Students' Home — Late Arrival Additional Work"], ['Academic Year ID', filters.yearId], [],
    ['Late Date', 'Due Date', 'Submission Status', 'Submitted Date', 'Admission No.', 'Student Name', 'Class', 'Division', 'Details'],
    ...rows.map(r => [r.late_date, r.due_date, r.submission_status, r.submitted_date || '', r.admission_no, r.student_name, r.student_class, r.student_division, r.details]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:14},{wch:14},{wch:18},{wch:16},{wch:16},{wch:26},{wch:9},{wch:10},{wch:36}];
  ws['!autofilter'] = { ref: `A4:I${4 + rows.length}` };
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Late Arrival Work');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Students_Home_Late_Arrival_Work.xlsx"');
  res.send(buffer);
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM late_arrival_works WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Late-arrival work not found.' });
  res.json({ message: 'Late-arrival work deleted.' });
});

module.exports = router;
