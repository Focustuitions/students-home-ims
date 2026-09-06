const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { resolveYearId } = require('../db/academicYear');

function computeStats(marksRows, maxMarks) {
  const present = marksRows.filter(m => !m.is_absent && m.marks !== null);
  const absentCount = marksRows.filter(m => m.is_absent).length;
  const scores = present.map(m => m.marks);
  const average = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const highest = scores.length ? Math.max(...scores) : null;
  const lowest = scores.length ? Math.min(...scores) : null;
  const passMark = maxMarks * 0.35; // standard Kerala-syllabus pass threshold (35%)
  const passCount = present.filter(m => m.marks >= passMark).length;
  const passRate = present.length ? (passCount / present.length) * 100 : 0;

  const bands = [
    { label: 'Excellent (90–100%)', min: 0.9, count: 0 },
    { label: 'Good (75–89%)', min: 0.75, count: 0 },
    { label: 'Average (50–74%)', min: 0.5, count: 0 },
    { label: 'Below Average (35–49%)', min: 0.35, count: 0 },
    { label: 'Needs Improvement (<35%)', min: 0, count: 0 },
  ];
  present.forEach(m => {
    const pct = m.marks / maxMarks;
    const band = bands.find(b => pct >= b.min);
    if (band) band.count++;
  });

  return {
    totalStudents: marksRows.length,
    presentCount: present.length,
    absentCount,
    average: Math.round(average * 100) / 100,
    highest,
    lowest,
    passCount,
    passRate: Math.round(passRate * 10) / 10,
    bands,
  };
}

// List weekly tests for the active academic year, with quick stats
router.get('/', (req, res) => {
  const yearId = resolveYearId(req.query.academic_year_id);
  const tests = db.prepare('SELECT * FROM weekly_tests WHERE academic_year_id = ? ORDER BY test_date DESC, id DESC').all(yearId);
  const withStats = tests.map(t => {
    const marksRows = db.prepare('SELECT * FROM weekly_test_marks WHERE weekly_test_id = ?').all(t.id);
    const stats = computeStats(marksRows, t.max_marks);
    return { ...t, ...stats };
  });
  res.json(withStats);
});

// Top performing students per class (10, 9, 8), ranked by their average
// percentage across every weekly test they've taken in the active year.
router.get('/top-performers', (req, res) => {
  const yearId = resolveYearId(req.query.academic_year_id);
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 25);

  const rows = db.prepare(`
    SELECT s.admission_no, s.name, s.class, s.division,
           COUNT(m.id) as tests_taken,
           SUM(CASE WHEN m.is_absent = 0 THEN 1 ELSE 0 END) as tests_present,
           AVG(CASE WHEN m.is_absent = 0 THEN m.marks * 100.0 / t.max_marks END) as avg_pct
    FROM students s
    JOIN weekly_test_marks m ON m.admission_no = s.admission_no
    JOIN weekly_tests t ON t.id = m.weekly_test_id
    WHERE s.academic_year_id = ? AND t.academic_year_id = ?
    GROUP BY s.admission_no
    HAVING tests_present > 0
    ORDER BY avg_pct DESC
  `).all(yearId, yearId);

  const byClass = {};
  rows.forEach(r => {
    const key = r.class || 'Unclassed';
    byClass[key] = byClass[key] || [];
    if (byClass[key].length < limit) {
      byClass[key].push({
        admission_no: r.admission_no,
        name: r.name,
        class: r.class,
        division: r.division,
        tests_taken: r.tests_taken,
        tests_present: r.tests_present,
        average: Math.round(r.avg_pct * 10) / 10,
      });
    }
  });
  // assign rank within each class
  Object.values(byClass).forEach(list => list.forEach((s, i) => { s.rank = i + 1; }));

  const classesPresent = Object.keys(byClass).sort((a, b) => b.localeCompare(a));
  res.json({ limit, classes: classesPresent, byClass });
});

// Most improved students per class: recent weekly-test scores compared
// against their own earlier scores this academic year (not compared to
// other students), so this highlights genuine upward trends.
router.get('/most-improved', (req, res) => {
  const yearId = resolveYearId(req.query.academic_year_id);
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 25);
  const minTests = 3; // need at least this many tests for a meaningful trend

  const rows = db.prepare(`
    SELECT s.admission_no, s.name, s.class, s.division, m.marks, t.max_marks, t.test_date
    FROM students s
    JOIN weekly_test_marks m ON m.admission_no = s.admission_no
    JOIN weekly_tests t ON t.id = m.weekly_test_id
    WHERE s.academic_year_id = ? AND t.academic_year_id = ? AND m.is_absent = 0
    ORDER BY s.admission_no, t.test_date ASC
  `).all(yearId, yearId);

  const byStudent = {};
  rows.forEach(r => {
    const entry = byStudent[r.admission_no] || (byStudent[r.admission_no] = {
      admission_no: r.admission_no, name: r.name, class: r.class, division: r.division, scores: [],
    });
    entry.scores.push(Math.round((r.marks / r.max_marks) * 1000) / 10);
  });

  const improved = [];
  Object.values(byStudent).forEach(s => {
    if (s.scores.length < minTests) return;
    const half = Math.floor(s.scores.length / 2);
    const earlier = s.scores.slice(0, half);
    const recent = s.scores.slice(s.scores.length - half);
    const earlierAvg = earlier.reduce((a, b) => a + b, 0) / earlier.length;
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const improvement = Math.round((recentAvg - earlierAvg) * 10) / 10;
    if (improvement > 3) { // only genuinely improving students, matching the "Improving" trend threshold used elsewhere
      improved.push({
        admission_no: s.admission_no,
        name: s.name,
        class: s.class,
        division: s.division,
        tests_taken: s.scores.length,
        first_score: s.scores[0],
        latest_score: s.scores[s.scores.length - 1],
        earlier_avg: Math.round(earlierAvg * 10) / 10,
        recent_avg: Math.round(recentAvg * 10) / 10,
        improvement,
      });
    }
  });
  improved.sort((a, b) => b.improvement - a.improvement);

  const byClass = {};
  improved.forEach(s => {
    const key = s.class || 'Unclassed';
    byClass[key] = byClass[key] || [];
    if (byClass[key].length < limit) {
      byClass[key].push({ ...s, rank: byClass[key].length + 1 });
    }
  });

  const classesPresent = Object.keys(byClass).sort((a, b) => b.localeCompare(a));
  res.json({ limit, minTests, classes: classesPresent, byClass });
});

// Full detail: test info + every student's mark, joined with class/division
router.get('/:id', (req, res) => {
  const test = db.prepare('SELECT * FROM weekly_tests WHERE id = ?').get(req.params.id);
  if (!test) return res.status(404).json({ error: 'Weekly test not found' });
  const marks = db.prepare(`
    SELECT m.*, s.name as student_name, s.class as student_class, s.division as student_division
    FROM weekly_test_marks m JOIN students s ON s.admission_no = m.admission_no
    WHERE m.weekly_test_id = ?
    ORDER BY (m.is_absent = 1), m.marks DESC
  `).all(req.params.id);
  const stats = computeStats(marks, test.max_marks);
  res.json({ ...test, marks, ...stats });
});

// Delete a weekly test and all its marks
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM weekly_tests WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Weekly test not found' });
  db.prepare('DELETE FROM weekly_test_marks WHERE weekly_test_id = ?').run(req.params.id);
  res.json({ message: 'Weekly test deleted' });
});

// Export the full report as a formatted .xlsx workbook
router.get('/:id/export', (req, res) => {
  const XLSX = require('xlsx');
  const test = db.prepare('SELECT * FROM weekly_tests WHERE id = ?').get(req.params.id);
  if (!test) return res.status(404).json({ error: 'Weekly test not found' });
  const marks = db.prepare(`
    SELECT m.*, s.name as student_name, s.class as student_class, s.division as student_division
    FROM weekly_test_marks m JOIN students s ON s.admission_no = m.admission_no
    WHERE m.weekly_test_id = ?
    ORDER BY (m.is_absent = 1), m.marks DESC
  `).all(req.params.id);
  const stats = computeStats(marks, test.max_marks);

  const summarySheet = XLSX.utils.aoa_to_sheet([
    ['Weekly Test Report'],
    ['Exam', test.exam_name],
    ['Date', test.test_date],
    ['Max Marks', test.max_marks],
    [],
    ['Total Students', stats.totalStudents],
    ['Present', stats.presentCount],
    ['Absent', stats.absentCount],
    ['Average', stats.average],
    ['Highest', stats.highest],
    ['Lowest', stats.lowest],
    ['Pass Rate (%)', stats.passRate],
    [],
    ['Grade Band', 'Students'],
    ...stats.bands.map(b => [b.label, b.count]),
  ]);
  summarySheet['!cols'] = [{ wch: 26 }, { wch: 20 }];

  const detailHeader = ['Rank', 'Admission No', 'Name', 'Class', 'Division', 'Marks', 'Out Of', 'Percentage', 'Status'];
  let rank = 0;
  const detailRows = marks.map(m => {
    if (!m.is_absent) rank++;
    const pct = m.is_absent ? '' : Math.round((m.marks / test.max_marks) * 1000) / 10;
    return [
      m.is_absent ? '' : rank,
      m.admission_no, m.student_name, m.student_class, m.student_division,
      m.is_absent ? 'AB' : m.marks, test.max_marks, pct,
      m.is_absent ? 'Absent' : (m.marks >= test.max_marks * 0.35 ? 'Pass' : 'Below Pass Mark'),
    ];
  });
  const detailSheet = XLSX.utils.aoa_to_sheet([detailHeader, ...detailRows]);
  detailSheet['!cols'] = [{ wch: 6 }, { wch: 12 }, { wch: 24 }, { wch: 7 }, { wch: 9 }, { wch: 8 }, { wch: 8 }, { wch: 11 }, { wch: 16 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
  XLSX.utils.book_append_sheet(wb, detailSheet, 'Marks');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const filename = `weekly-test-${test.test_date}-${test.exam_name}.xlsx`.replace(/[^a-z0-9.\- ]/gi, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
});

module.exports = router;
