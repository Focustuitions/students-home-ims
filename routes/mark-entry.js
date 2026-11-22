const express = require('express');
const router = express.Router();
const db = require('../db/database');
const XLSX = require('xlsx');
const { resolveYearId } = require('../db/academicYear');

function readMeta(source) {
  return {
    test_date: String(source.test_date || '').trim(),
    class: String(source.class || '').trim(),
    subject: String(source.subject || '').trim(),
    topic: String(source.topic || '').trim(),
    max_marks: Number(source.max_marks || 20),
    academic_year_id: resolveYearId(source.academic_year_id),
  };
}

function validateMeta(meta) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.test_date) || Number.isNaN(Date.parse(meta.test_date))) return 'A valid test date is required.';
  if (!meta.class) return 'Select a class.';
  if (!meta.subject) return 'Enter a subject.';
  if (!meta.topic) return 'Enter a topic.';
  if (!Number.isFinite(meta.max_marks) || meta.max_marks <= 0 || meta.max_marks > 1000) return 'Maximum marks must be greater than 0 and no more than 1000.';
  return null;
}

function findTest(meta) {
  return db.prepare(`
    SELECT * FROM weekly_tests
    WHERE academic_year_id = ? AND test_date = ? AND class = ?
      AND LOWER(TRIM(COALESCE(subject, ''))) = LOWER(TRIM(?))
      AND LOWER(TRIM(COALESCE(topic, ''))) = LOWER(TRIM(?))
    ORDER BY id DESC LIMIT 1
  `).get(meta.academic_year_id, meta.test_date, meta.class, meta.subject, meta.topic);
}

function readMarkList(testId) {
  return db.prepare(`
    SELECT m.id, m.admission_no, m.marks, m.is_absent,
           s.name, s.class, s.division, t.max_marks
    FROM weekly_test_marks m
    JOIN students s ON s.admission_no = m.admission_no
    JOIN weekly_tests t ON t.id = m.weekly_test_id
    WHERE m.weekly_test_id = ?
    ORDER BY s.division COLLATE NOCASE, s.name COLLATE NOCASE
  `).all(testId);
}

// Start/resume creates the Weekly Test row immediately, before the first mark
// is entered. This guarantees the test can be picked from Weekly Tests even if
// the portal is closed before the first student's mark is saved.
router.post('/tests/start', (req, res) => {
  const meta = readMeta(req.body);
  const error = validateMeta(meta);
  if (error) return res.status(400).json({ error });

  try {
    const test = db.transaction(() => {
      let existing = findTest(meta);
      if (existing) {
        db.prepare("UPDATE weekly_tests SET entry_status = 'in_progress' WHERE id = ?").run(existing.id);
        return db.prepare('SELECT * FROM weekly_tests WHERE id = ?').get(existing.id);
      }
      const examName = `${meta.subject} - ${meta.topic}`;
      const inserted = db.prepare(`
        INSERT INTO weekly_tests (exam_name, class, subject, topic, test_date, max_marks, academic_year_id, entry_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress')
      `).run(examName, meta.class, meta.subject, meta.topic, meta.test_date, meta.max_marks, meta.academic_year_id);
      return db.prepare('SELECT * FROM weekly_tests WHERE id = ?').get(inserted.lastInsertRowid);
    })();
    res.status(200).json(test);
  } catch (err) {
    console.error('Could not start mark-entry session:', err);
    res.status(500).json({ error: 'Could not start this mark-entry session.' });
  }
});

// Load a Weekly Test by its register row ID so the Mark Entry screen can
// restore all test details even after the browser/portal has been closed.
router.get('/tests/:id', (req, res) => {
  const yearId = resolveYearId(req.query.academic_year_id);
  const test = db.prepare('SELECT * FROM weekly_tests WHERE id = ? AND academic_year_id = ?').get(req.params.id, yearId);
  if (!test) return res.status(404).json({ error: 'Weekly Test not found in the selected academic year.' });
  const count = db.prepare('SELECT COUNT(*) AS count FROM weekly_test_marks WHERE weekly_test_id = ?').get(test.id).count;
  res.json({ ...test, mark_count: count });
});

// Explicitly mark a test as in-progress when an administrator chooses Resume.
router.post('/tests/:id/resume', (req, res) => {
  const yearId = resolveYearId(req.body.academic_year_id);
  const result = db.prepare(`
    UPDATE weekly_tests SET entry_status = 'in_progress'
    WHERE id = ? AND academic_year_id = ?
  `).run(req.params.id, yearId);
  if (!result.changes) return res.status(404).json({ error: 'Weekly Test not found in the selected academic year.' });
  res.json({ message: 'Mark entry resumed.' });
});

// Show how many students in the active class roster still have no result.
// This allows the UI to warn the administrator before finishing the session.
router.get('/tests/:id/finish-preview', (req, res) => {
  const yearId = resolveYearId(req.query.academic_year_id);
  const test = db.prepare(`
    SELECT * FROM weekly_tests WHERE id = ? AND academic_year_id = ?
  `).get(req.params.id, yearId);
  if (!test) return res.status(404).json({ error: 'Weekly Test not found in the selected academic year.' });

  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total_students,
      SUM(CASE WHEN m.id IS NOT NULL AND COALESCE(m.is_absent, 0) = 0 AND m.marks IS NOT NULL THEN 1 ELSE 0 END) AS present_count,
      SUM(CASE WHEN m.id IS NOT NULL AND m.is_absent = 1 THEN 1 ELSE 0 END) AS absent_count,
      SUM(CASE WHEN m.id IS NULL OR (COALESCE(m.is_absent, 0) = 0 AND m.marks IS NULL) THEN 1 ELSE 0 END) AS unentered_count
    FROM students s
    LEFT JOIN weekly_test_marks m
      ON m.weekly_test_id = ? AND m.admission_no = s.admission_no
    WHERE s.academic_year_id = ? AND s.class = ?
      AND COALESCE(s.status, 'Active') <> 'Withdrawn'
  `).get(test.id, test.academic_year_id, test.class);

  res.json({
    test_id: test.id,
    total_students: Number(summary.total_students || 0),
    present_count: Number(summary.present_count || 0),
    absent_count: Number(summary.absent_count || 0),
    unentered_count: Number(summary.unentered_count || 0),
  });
});

// Finish is the final attendance decision for this Weekly Test. Every active,
// non-withdrawn student in the test's class/year without a saved mark is stored
// as Absent (NULL marks + is_absent=1). Existing marks and explicit absences
// are preserved. The operation is atomic so a partial class cannot be finalized.
router.post('/tests/:id/finish', (req, res) => {
  const yearId = resolveYearId(req.body.academic_year_id);
  try {
    const result = db.transaction(() => {
      const test = db.prepare(`
        SELECT * FROM weekly_tests WHERE id = ? AND academic_year_id = ?
      `).get(req.params.id, yearId);
      if (!test) return null;

      // Repair any blank placeholder rows as absent, but only for students who
      // are still part of this test's active class roster.
      const updateBlank = db.prepare(`
        UPDATE weekly_test_marks
        SET is_absent = 1, marks = NULL
        WHERE weekly_test_id = ? AND is_absent = 0 AND marks IS NULL
          AND admission_no IN (
            SELECT admission_no FROM students
            WHERE academic_year_id = ? AND class = ?
              AND COALESCE(status, 'Active') <> 'Withdrawn'
          )
      `).run(test.id, test.academic_year_id, test.class);

      // Add an explicit absent result for every active student not yet present
      // in the mark table. INSERT OR IGNORE protects the unique test/student key.
      const insertMissing = db.prepare(`
        INSERT OR IGNORE INTO weekly_test_marks (weekly_test_id, admission_no, marks, is_absent)
        SELECT ?, s.admission_no, NULL, 1
        FROM students s
        WHERE s.academic_year_id = ? AND s.class = ?
          AND COALESCE(s.status, 'Active') <> 'Withdrawn'
      `).run(test.id, test.academic_year_id, test.class);

      db.prepare(`
        UPDATE weekly_tests SET entry_status = 'completed'
        WHERE id = ? AND academic_year_id = ?
      `).run(test.id, yearId);

      const summary = db.prepare(`
        SELECT
          COUNT(*) AS total_students,
          SUM(CASE WHEN m.is_absent = 0 AND m.marks IS NOT NULL THEN 1 ELSE 0 END) AS present_count,
          SUM(CASE WHEN m.is_absent = 1 THEN 1 ELSE 0 END) AS absent_count
        FROM students s
        LEFT JOIN weekly_test_marks m
          ON m.weekly_test_id = ? AND m.admission_no = s.admission_no
        WHERE s.academic_year_id = ? AND s.class = ?
          AND COALESCE(s.status, 'Active') <> 'Withdrawn'
      `).get(test.id, test.academic_year_id, test.class);

      return {
        test,
        newly_marked_absent: Number(updateBlank.changes || 0) + Number(insertMissing.changes || 0),
        total_students: Number(summary.total_students || 0),
        present_count: Number(summary.present_count || 0),
        absent_count: Number(summary.absent_count || 0),
      };
    })();

    if (!result) return res.status(404).json({ error: 'Weekly Test not found in the selected academic year.' });
    res.json({
      message: 'Mark entry finished. Students without a mark have been marked Absent.',
      ...result,
      marks: readMarkList(result.test.id),
    });
  } catch (err) {
    console.error('Could not finish mark-entry session:', err);
    res.status(500).json({ error: 'Could not finish this mark-entry session or mark missing students Absent.' });
  }
});

// Find a student by admission-number prefix within the selected class/year.
// Class 10 users can enter only the first three digits to find their student.
router.get('/students', (req, res) => {
  const cls = String(req.query.class || '').trim();
  const prefix = String(req.query.prefix || '').trim();
  const yearId = resolveYearId(req.query.academic_year_id);
  if (!cls) return res.status(400).json({ error: 'Select a class first.' });
  if (cls === '10' && (prefix.length < 3 || !/^\d{3}/.test(prefix))) {
    return res.status(400).json({ error: 'For Class 10, enter at least the first three digits of the Admission Number.' });
  }
  if (prefix.length < 3) return res.status(400).json({ error: 'Enter at least three characters of the Admission Number.' });

  const students = db.prepare(`
    SELECT admission_no, name, class, division
    FROM students
    WHERE academic_year_id = ? AND class = ?
      AND COALESCE(status, 'Active') <> 'Withdrawn'
      AND UPPER(SUBSTR(admission_no, 1, ?)) = UPPER(?)
    ORDER BY admission_no COLLATE NOCASE
    LIMIT 25
  `).all(yearId, cls, prefix.length, prefix);
  res.json(students);
});

// Load previously entered marks for this date/class/subject/topic without
// creating an empty test record.
router.get('/marks', (req, res) => {
  const meta = readMeta(req.query);
  const error = validateMeta(meta);
  if (error) return res.status(400).json({ error });
  const test = findTest(meta);
  if (!test) return res.json({ test_id: null, marks: [] });
  res.json({ test_id: test.id, max_marks: test.max_marks, marks: readMarkList(test.id) });
});

// Save an individual mark directly into the existing Weekly Tests data model.
// No separate Mark Entry table is used: the test is a weekly_tests row and each
// student's score is a weekly_test_marks row, so it immediately appears in the
// Weekly Tests register, academic reports and Parent Portal.
router.post('/marks', (req, res) => {
  const meta = readMeta(req.body);
  const error = validateMeta(meta);
  if (error) return res.status(400).json({ error });

  const admissionNo = String(req.body.admission_no || '').trim();
  if (!admissionNo) return res.status(400).json({ error: 'Enter an Admission Number.' });
  const mark = Number(req.body.marks);
  const matchingTest = findTest(meta);
  const effectiveMaxMarks = matchingTest ? Number(matchingTest.max_marks) : meta.max_marks;
  if (!Number.isFinite(mark) || mark < 0 || mark > effectiveMaxMarks) {
    return res.status(400).json({ error: `Mark must be between 0 and ${effectiveMaxMarks}.` });
  }

  const student = db.prepare(`
    SELECT admission_no, name, class, division
    FROM students
    WHERE admission_no = ? AND academic_year_id = ?
      AND COALESCE(status, 'Active') <> 'Withdrawn'
  `).get(admissionNo, meta.academic_year_id);
  if (!student) return res.status(404).json({ error: 'Student not found in the selected academic year, or the student is withdrawn.' });
  if (String(student.class) !== meta.class) return res.status(400).json({ error: `This student belongs to Class ${student.class}, not Class ${meta.class}.` });

  const save = db.transaction(() => {
    let test = findTest(meta);
    if (!test) {
      const examName = `${meta.subject} - ${meta.topic}`;
      const inserted = db.prepare(`
        INSERT INTO weekly_tests (exam_name, class, subject, topic, test_date, max_marks, academic_year_id, entry_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress')
      `).run(examName, meta.class, meta.subject, meta.topic, meta.test_date, meta.max_marks, meta.academic_year_id);
      test = db.prepare('SELECT * FROM weekly_tests WHERE id = ?').get(inserted.lastInsertRowid);
    } else {
      db.prepare("UPDATE weekly_tests SET entry_status = 'in_progress' WHERE id = ?").run(test.id);
      test.entry_status = 'in_progress';
    }

    const existing = db.prepare('SELECT id, marks, is_absent FROM weekly_test_marks WHERE weekly_test_id = ? AND admission_no = ?').get(test.id, admissionNo);
    if (existing && req.body.replace !== true) {
      const err = new Error(`A mark has already been entered for ${student.name} (${admissionNo}): ${existing.is_absent ? 'Absent' : existing.marks}. Confirm to update it.`);
      err.code = 'MARK_EXISTS';
      throw err;
    }

    db.prepare(`
      INSERT INTO weekly_test_marks (weekly_test_id, admission_no, marks, is_absent)
      VALUES (?, ?, ?, 0)
      ON CONFLICT(weekly_test_id, admission_no)
      DO UPDATE SET marks = excluded.marks, is_absent = 0
    `).run(test.id, admissionNo, mark);
    return { test_id: test.id, existing: !!existing };
  });

  try {
    const result = save();
    res.status(result.existing ? 200 : 201).json({
      message: result.existing ? 'Mark updated.' : 'Mark saved.',
      ...result,
      student,
      marks: readMarkList(result.test_id),
    });
  } catch (err) {
    if (err.code === 'MARK_EXISTS') return res.status(409).json({ error: err.message, code: err.code });
    console.error('Mark entry save failed:', err);
    res.status(500).json({ error: 'Could not save the mark.' });
  }
});

// Export the saved marklist as an Excel workbook.
router.get('/export', (req, res) => {
  const meta = readMeta(req.query);
  const error = validateMeta(meta);
  if (error) return res.status(400).json({ error });
  const test = findTest(meta);
  if (!test) return res.status(404).json({ error: 'No mark entries found for this date, class, subject and topic.' });
  const marks = readMarkList(test.id);
  if (!marks.length) return res.status(404).json({ error: 'No marks have been entered yet.' });

  const header = ['Admission No', 'Student Name', 'Class', 'Division', 'Date', 'Subject', 'Topic', 'Marks', 'Maximum Marks', 'Status'];
  const rows = marks.map(m => [
    m.admission_no, m.name, m.class, m.division, meta.test_date,
    meta.subject, meta.topic, m.is_absent ? 'AB' : m.marks, test.max_marks,
    m.is_absent ? 'Absent' : 'Present',
  ]);
  const ws = XLSX.utils.aoa_to_sheet([
    ["Students' Home — Marklist"],
    ['Date', meta.test_date], ['Class', meta.class], ['Subject', meta.subject], ['Topic', meta.topic],
    ['Maximum Marks', test.max_marks],
    ['Students Recorded', marks.length],
    ['Present', marks.filter(m => !m.is_absent && m.marks !== null).length],
    ['Absent', marks.filter(m => !!m.is_absent).length],
    [], header, ...rows,
  ]);
  ws['!cols'] = [{ wch: 16 }, { wch: 26 }, { wch: 9 }, { wch: 10 }, { wch: 13 }, { wch: 18 }, { wch: 24 }, { wch: 10 }, { wch: 14 }, { wch: 12 }];
  ws['!autofilter'] = { ref: `A9:J${9 + rows.length}` };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Marklist');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const safe = value => String(value).replace(/[^a-z0-9.-]+/gi, '_').replace(/^_+|_+$/g, '');
  const filename = `Marklist_Class-${safe(meta.class)}_${safe(meta.subject)}_${safe(meta.topic)}_${meta.test_date}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});

module.exports = router;
