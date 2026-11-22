const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { resolveYearId } = require('../db/academicYear');

function computeExamStats(marksRows) {
  // group by student to get each student's total % across subjects taken
  const byStudent = {};
  marksRows.forEach(m => {
    const entry = byStudent[m.admission_no] || (byStudent[m.admission_no] = { marks: 0, max: 0, anyPresent: false, anyAbsent: false });
    if (m.is_absent) {
      entry.anyAbsent = true;
    } else if (m.marks !== null) {
      entry.marks += m.marks;
      entry.max += m.max_marks;
      entry.anyPresent = true;
    }
  });
  const totals = Object.entries(byStudent).map(([admission_no, v]) => ({
    admission_no,
    pct: v.max > 0 ? Math.round((v.marks / v.max) * 1000) / 10 : null,
  })).filter(t => t.pct !== null);

  const average = totals.length ? Math.round((totals.reduce((s, t) => s + t.pct, 0) / totals.length) * 10) / 10 : null;
  const highest = totals.length ? Math.max(...totals.map(t => t.pct)) : null;
  const lowest = totals.length ? Math.min(...totals.map(t => t.pct)) : null;
  const studentCount = Object.keys(byStudent).length;

  return { studentCount, average, highest, lowest };
}

// List term exams for the active academic year, with quick stats
router.get('/', (req, res) => {
  const yearId = resolveYearId(req.query.academic_year_id);
  const exams = db.prepare('SELECT * FROM term_exams WHERE academic_year_id = ? ORDER BY exam_date DESC, id DESC').all(yearId);
  const withStats = exams.map(e => {
    const marks = db.prepare('SELECT * FROM term_exam_marks WHERE term_exam_id = ?').all(e.id);
    const subjectCount = new Set(marks.map(m => m.subject)).size;
    return { ...e, ...computeExamStats(marks), subjectCount };
  });
  res.json(withStats);
});

// Full detail: subject list with max marks, and every student's subject-wise marks + total
router.get('/:id', (req, res) => {
  const exam = db.prepare('SELECT * FROM term_exams WHERE id = ?').get(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Term exam not found' });
  const marks = db.prepare(`
    SELECT m.*, s.name as student_name, s.class as student_class, s.division as student_division
    FROM term_exam_marks m JOIN students s ON s.admission_no = m.admission_no
    WHERE m.term_exam_id = ?
  `).all(req.params.id);

  const subjects = [...new Map(marks.map(m => [m.subject, m.max_marks])).entries()].map(([subject, max_marks]) => ({ subject, max_marks }));

  const byStudent = {};
  marks.forEach(m => {
    const s = byStudent[m.admission_no] || (byStudent[m.admission_no] = {
      admission_no: m.admission_no, name: m.student_name, class: m.student_class, division: m.student_division,
      subjectMarks: {}, total: 0, maxTotal: 0, anyPresent: false,
    });
    s.subjectMarks[m.subject] = { marks: m.marks, max_marks: m.max_marks, is_absent: !!m.is_absent };
    if (!m.is_absent && m.marks !== null) { s.total += m.marks; s.maxTotal += m.max_marks; s.anyPresent = true; }
  });
  const students = Object.values(byStudent).map(s => ({
    ...s,
    pct: s.anyPresent && s.maxTotal > 0 ? Math.round((s.total / s.maxTotal) * 1000) / 10 : null,
  })).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));

  res.json({ ...exam, subjects, students, ...computeExamStats(marks) });
});

// Delete a term exam and all its marks
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM term_exams WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Term exam not found' });
  db.prepare('DELETE FROM term_exam_marks WHERE term_exam_id = ?').run(req.params.id);
  res.json({ message: 'Term exam deleted' });
});

// Export the full marklist + summary as a formatted .xlsx workbook
router.get('/:id/export', (req, res) => {
  const XLSX = require('xlsx');
  const exam = db.prepare('SELECT * FROM term_exams WHERE id = ?').get(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Term exam not found' });
  const marks = db.prepare(`
    SELECT m.*, s.name as student_name, s.class as student_class, s.division as student_division
    FROM term_exam_marks m JOIN students s ON s.admission_no = m.admission_no
    WHERE m.term_exam_id = ?
  `).all(req.params.id);

  const subjects = [...new Map(marks.map(m => [m.subject, m.max_marks])).entries()].map(([subject, max_marks]) => ({ subject, max_marks }));
  const byStudent = {};
  marks.forEach(m => {
    const s = byStudent[m.admission_no] || (byStudent[m.admission_no] = {
      admission_no: m.admission_no, name: m.student_name, class: m.student_class, division: m.student_division,
      subjectMarks: {}, total: 0, maxTotal: 0, anyPresent: false,
    });
    s.subjectMarks[m.subject] = m.is_absent ? 'AB' : m.marks;
    if (!m.is_absent && m.marks !== null) { s.total += m.marks; s.maxTotal += m.max_marks; s.anyPresent = true; }
  });
  const students = Object.values(byStudent).map(s => ({
    ...s, pct: s.anyPresent && s.maxTotal > 0 ? Math.round((s.total / s.maxTotal) * 1000) / 10 : '',
  })).sort((a, b) => (b.pct || -1) - (a.pct || -1));

  const header = ['Adm No', 'Name', 'Class', 'Division', ...subjects.map(s => `${s.subject} (/${s.max_marks})`), 'Total', 'Out Of', 'Percentage'];
  const data = students.map(s => [
    s.admission_no, s.name, s.class, s.division,
    ...subjects.map(sub => s.subjectMarks[sub.subject] ?? ''),
    s.total, s.maxTotal, s.pct,
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  ws['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 7 }, { wch: 9 }, ...subjects.map(() => ({ wch: 14 })), { wch: 8 }, { wch: 8 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Marklist');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const filename = `${exam.exam_name}-class-${exam.class}-${exam.exam_date}.xlsx`.replace(/[^a-z0-9.\- ]/gi, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
});

module.exports = router;
