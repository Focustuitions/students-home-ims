const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { resolveYearId } = require('../db/academicYear');

function computeNet(total, discount) {
  const t = Number(total) || 0;
  const d = Number(discount) || 0;
  return Math.max(t - d, 0);
}

function paidTotal(admission_no) {
  const row = db.prepare('SELECT COALESCE(SUM(amount),0) as paid FROM payments WHERE admission_no = ?').get(admission_no);
  return row.paid;
}

// List / search students
router.get('/', (req, res) => {
  const { q, cls, division, medium, school, status, academic_year_id } = req.query;
  let sql = 'SELECT * FROM students WHERE 1=1';
  const params = [];
  const yearId = resolveYearId(academic_year_id);
  if (yearId) { sql += ' AND academic_year_id = ?'; params.push(yearId); }
  if (q) {
    sql += ' AND (admission_no LIKE ? OR name LIKE ? OR father_name LIKE ? OR mother_name LIKE ? OR place LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  if (cls) { sql += ' AND class = ?'; params.push(cls); }
  if (division) { sql += ' AND division = ?'; params.push(division); }
  if (medium) { sql += ' AND medium = ?'; params.push(medium); }
  if (school) { sql += ' AND school = ?'; params.push(school); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY id DESC';
  const students = db.prepare(sql).all(...params);
  const withFees = students.map(s => {
    const paid = paidTotal(s.admission_no);
    return { ...s, paid, balance: Math.max(s.net_fees - paid, 0) };
  });
  res.json(withFees);
});

// Get single student (with payment history)
router.get('/:admission_no', (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE admission_no = ?').get(req.params.admission_no);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const payments = db.prepare('SELECT * FROM payments WHERE admission_no = ? ORDER BY payment_date DESC, id DESC').all(req.params.admission_no);
  const paid = paidTotal(student.admission_no);
  res.json({ ...student, payments, paid, balance: Math.max(student.net_fees - paid, 0) });
});

// A student's weekly test history (marks over time, most recent first)
router.get('/:admission_no/weekly-tests', (req, res) => {
  const rows = db.prepare(`
    SELECT m.marks, m.is_absent, t.id as test_id, t.exam_name, t.subject, t.test_date, t.max_marks
    FROM weekly_test_marks m JOIN weekly_tests t ON t.id = m.weekly_test_id
    WHERE m.admission_no = ?
    ORDER BY t.test_date DESC
  `).all(req.params.admission_no);
  res.json(rows);
});

// A student's Hot Seat history (most recent first)
router.get('/:admission_no/hot-seats', (req, res) => {
  const yearId = resolveYearId(req.query.academic_year_id);
  const rows = db.prepare(`
    SELECT * FROM hot_seats WHERE admission_no = ? AND academic_year_id = ? ORDER BY date DESC, id DESC
  `).all(req.params.admission_no, yearId);
  res.json(rows);
});

// A student's overall academic performance report: subject strengths/weaknesses,
// trend over time, and how they compare to their classmates on each test.
router.get('/:admission_no/weekly-test-report', (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE admission_no = ?').get(req.params.admission_no);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const yearId = resolveYearId(req.query.academic_year_id);
  const rows = db.prepare(`
    SELECT m.marks, m.is_absent, t.id as test_id, t.exam_name, t.subject, t.topic, t.test_date, t.max_marks
    FROM weekly_test_marks m JOIN weekly_tests t ON t.id = m.weekly_test_id
    WHERE m.admission_no = ? AND t.academic_year_id = ?
    ORDER BY t.test_date ASC
  `).all(req.params.admission_no, yearId);

  const withPct = rows.map(r => ({
    ...r,
    subjectLabel: r.subject || r.exam_name,
    pct: r.is_absent ? null : Math.round((r.marks / r.max_marks) * 1000) / 10,
  }));
  const present = withPct.filter(r => !r.is_absent);
  const absentCount = withPct.length - present.length;

  const overallAverage = present.length
    ? Math.round((present.reduce((s, r) => s + r.pct, 0) / present.length) * 10) / 10
    : null;

  // subject-wise breakdown
  const bySubject = {};
  present.forEach(r => {
    const key = r.subjectLabel;
    bySubject[key] = bySubject[key] || { subject: key, count: 0, totalPct: 0, best: -Infinity, worst: Infinity };
    const s = bySubject[key];
    s.count++;
    s.totalPct += r.pct;
    s.best = Math.max(s.best, r.pct);
    s.worst = Math.min(s.worst, r.pct);
  });
  const subjects = Object.values(bySubject).map(s => ({
    subject: s.subject,
    count: s.count,
    average: Math.round((s.totalPct / s.count) * 10) / 10,
    best: s.best,
    worst: s.worst,
  })).sort((a, b) => b.average - a.average);

  const strongest = subjects.length ? subjects[0] : null;
  const weakest = subjects.length ? subjects[subjects.length - 1] : null;

  // trend: compare the average of the most recent tests against the earlier ones
  let trend = 'Not enough data';
  let trendDelta = null;
  if (present.length >= 4) {
    const half = Math.floor(present.length / 2);
    const earlier = present.slice(0, half);
    const recent = present.slice(present.length - half);
    const earlierAvg = earlier.reduce((s, r) => s + r.pct, 0) / earlier.length;
    const recentAvg = recent.reduce((s, r) => s + r.pct, 0) / recent.length;
    trendDelta = Math.round((recentAvg - earlierAvg) * 10) / 10;
    trend = trendDelta > 3 ? 'Improving' : trendDelta < -3 ? 'Declining' : 'Steady';
  } else if (present.length >= 2) {
    trendDelta = Math.round((present[present.length - 1].pct - present[0].pct) * 10) / 10;
    trend = trendDelta > 3 ? 'Improving' : trendDelta < -3 ? 'Declining' : 'Steady';
  }

  // class average per test, for comparison
  const classAvgStmt = db.prepare(`
    SELECT AVG(m.marks * 100.0 / t.max_marks) as avg_pct
    FROM weekly_test_marks m
    JOIN students s ON s.admission_no = m.admission_no
    JOIN weekly_tests t ON t.id = m.weekly_test_id
    WHERE m.weekly_test_id = ? AND m.is_absent = 0 AND s.class = ? AND s.division = ?
  `);
  const timeline = withPct.map(r => {
    const classAvgRow = classAvgStmt.get(r.test_id, student.class, student.division);
    return {
      test_id: r.test_id,
      exam_name: r.exam_name,
      subject: r.subjectLabel,
      topic: r.topic,
      test_date: r.test_date,
      is_absent: r.is_absent,
      marks: r.marks,
      max_marks: r.max_marks,
      pct: r.pct,
      class_average_pct: classAvgRow.avg_pct !== null ? Math.round(classAvgRow.avg_pct * 10) / 10 : null,
    };
  });

  // Hot Seat: classroom engagement observations (notebook/homework/attention,
  // performance ratings, remarks) for the same academic year.
  const hotSeatRows = db.prepare(`
    SELECT * FROM hot_seats WHERE admission_no = ? AND academic_year_id = ? ORDER BY date DESC, id DESC
  `).all(req.params.admission_no, yearId);

  const performanceRank = { 'Excellent': 4, 'Very Good': 3, 'Good': 2, 'Average': 1, 'Poor': 0 };
  const ratingCounts = {};
  hotSeatRows.forEach(h => {
    if (h.performance) ratingCounts[h.performance] = (ratingCounts[h.performance] || 0) + 1;
  });
  const sessionCount = hotSeatRows.length;
  const checklistTotals = { notes_completed: 0, notebook_neat: 0, questions_answered: 0, good_attention_span: 0, no_notebook: 0, no_textbook: 0 };
  hotSeatRows.forEach(h => {
    Object.keys(checklistTotals).forEach(k => { if (h[k]) checklistTotals[k]++; });
  });
  const checklistRates = sessionCount ? Object.fromEntries(
    Object.entries(checklistTotals).map(([k, v]) => [k, Math.round((v / sessionCount) * 1000) / 10])
  ) : null;
  const predominantRating = Object.entries(ratingCounts).sort((a, b) => b[1] - a[1])[0];
  const recentRemarks = hotSeatRows.filter(h => h.remarks && h.remarks.trim()).slice(0, 5)
    .map(h => ({ date: h.date, subject: h.subject, remarks: h.remarks }));
  const recentParentFeedback = hotSeatRows.filter(h => h.parent_feedback && h.parent_feedback.trim()).slice(0, 5)
    .map(h => ({ date: h.date, subject: h.subject, parent_feedback: h.parent_feedback }));

  const hotSeat = {
    sessionCount,
    ratingCounts,
    predominantRating: predominantRating ? predominantRating[0] : null,
    checklistTotals,
    checklistRates,
    alertCount: checklistTotals.no_notebook + checklistTotals.no_textbook,
    recentRemarks,
    recentParentFeedback,
    records: hotSeatRows,
  };

  res.json({
    student: { admission_no: student.admission_no, name: student.name, class: student.class, division: student.division },
    testsTaken: withPct.length,
    presentCount: present.length,
    absentCount,
    overallAverage,
    strongest,
    weakest,
    trend,
    trendDelta,
    subjects,
    timeline,
    hotSeat,
  });
});

// Create student
router.post('/', (req, res) => {
  const b = req.body;
  if (!b.admission_no || !b.name || !b.class || !b.division || !b.medium || !b.school) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const net_fees = computeNet(b.total_fees, b.discount);
  const academic_year_id = resolveYearId(b.academic_year_id);
  try {
    const stmt = db.prepare(`INSERT INTO students
      (admission_no, joining_date, name, class, division, medium, school, school_other,
       father_name, father_phone, mother_name, mother_phone, place, total_fees, discount, net_fees, status, academic_year_id)
      VALUES (@admission_no, @joining_date, @name, @class, @division, @medium, @school, @school_other,
       @father_name, @father_phone, @mother_name, @mother_phone, @place, @total_fees, @discount, @net_fees, @status, @academic_year_id)`);
    stmt.run({
      admission_no: b.admission_no,
      joining_date: b.joining_date || new Date().toISOString().slice(0, 10),
      name: b.name,
      class: b.class,
      division: b.division,
      medium: b.medium,
      school: b.school,
      school_other: b.school === 'Others' ? (b.school_other || '') : null,
      father_name: b.father_name || '',
      father_phone: b.father_phone || '',
      mother_name: b.mother_name || '',
      mother_phone: b.mother_phone || '',
      place: b.place || '',
      total_fees: Number(b.total_fees) || 0,
      discount: Number(b.discount) || 0,
      net_fees,
      status: 'Active',
      academic_year_id
    });
    res.status(201).json({ message: 'Student added', admission_no: b.admission_no });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Admission number already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Update student
router.put('/:admission_no', (req, res) => {
  const existing = db.prepare('SELECT * FROM students WHERE admission_no = ?').get(req.params.admission_no);
  if (!existing) return res.status(404).json({ error: 'Student not found' });
  const b = req.body;
  const total_fees = b.total_fees !== undefined ? Number(b.total_fees) : existing.total_fees;
  const discount = b.discount !== undefined ? Number(b.discount) : existing.discount;
  const net_fees = computeNet(total_fees, discount);
  const stmt = db.prepare(`UPDATE students SET
    joining_date=@joining_date, name=@name, class=@class, division=@division, medium=@medium,
    school=@school, school_other=@school_other, father_name=@father_name, father_phone=@father_phone,
    mother_name=@mother_name, mother_phone=@mother_phone, place=@place, total_fees=@total_fees,
    discount=@discount, net_fees=@net_fees, status=@status
    WHERE admission_no=@admission_no`);
  stmt.run({
    admission_no: req.params.admission_no,
    joining_date: b.joining_date || existing.joining_date,
    name: b.name ?? existing.name,
    class: b.class ?? existing.class,
    division: b.division ?? existing.division,
    medium: b.medium ?? existing.medium,
    school: b.school ?? existing.school,
    school_other: (b.school || existing.school) === 'Others' ? (b.school_other ?? existing.school_other ?? '') : null,
    father_name: b.father_name ?? existing.father_name,
    father_phone: b.father_phone ?? existing.father_phone,
    mother_name: b.mother_name ?? existing.mother_name,
    mother_phone: b.mother_phone ?? existing.mother_phone,
    place: b.place ?? existing.place,
    total_fees,
    discount,
    net_fees,
    status: b.status ?? existing.status
  });
  res.json({ message: 'Student updated' });
});

// Delete student
router.delete('/:admission_no', (req, res) => {
  const result = db.prepare('DELETE FROM students WHERE admission_no = ?').run(req.params.admission_no);
  if (result.changes === 0) return res.status(404).json({ error: 'Student not found' });
  res.json({ message: 'Student deleted' });
});

// Fee-pending export data (JSON; used by the in-page table/CSV fallback)
router.get('/reports/fee-pending', (req, res) => {
  const yearId = resolveYearId(req.query.academic_year_id);
  const sql = yearId ? 'SELECT * FROM students WHERE academic_year_id = ?' : 'SELECT * FROM students';
  const students = yearId ? db.prepare(sql).all(yearId) : db.prepare(sql).all();
  const pending = students.map(s => {
    const paid = paidTotal(s.admission_no);
    const balance = Math.max(s.net_fees - paid, 0);
    return { ...s, paid, balance };
  }).filter(s => s.balance > 0);
  res.json(pending);
});

// Fee-pending export as a formatted .xlsx workbook (matches the institution's own sheet layout)
router.get('/reports/fee-pending/export', (req, res) => {
  const XLSX = require('xlsx');
  const yearId = resolveYearId(req.query.academic_year_id);
  const sql = yearId ? 'SELECT * FROM students WHERE academic_year_id = ?' : 'SELECT * FROM students';
  const students = yearId ? db.prepare(sql).all(yearId) : db.prepare(sql).all();
  const pending = students.map(s => {
    const paid = paidTotal(s.admission_no);
    const balance = Math.max(s.net_fees - paid, 0);
    return { s, paid, balance };
  }).filter(x => x.balance > 0)
    .sort((a, b) => b.s.class.localeCompare(a.s.class) || a.s.division.localeCompare(b.s.division) || a.s.name.localeCompare(b.s.name));

  const header = ['Adm No', 'Name', 'Class', 'Division', 'School', 'Father Phone', 'Mother Phone', 'Total Fee', 'Discount', 'Paid', 'Balance'];
  const data = pending.map(({ s, paid, balance }) => [
    s.admission_no, s.name, s.class, s.division,
    s.school === 'Others' ? (s.school_other || 'Others') : s.school,
    s.father_phone || '', s.mother_phone || '',
    s.total_fees, s.discount, paid, balance
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  ws['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 11 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Fee Pending');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const filename = `fee-pending-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
});

module.exports = router;
