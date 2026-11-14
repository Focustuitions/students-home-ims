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
  // The normal student list (and dashboard) contains current students only.
  // Withdrawn students are accessible through the dedicated /withdrawn route.
  if (status) { sql += ' AND status = ?'; params.push(status); }
  else { sql += " AND COALESCE(status, 'Active') <> 'Withdrawn'"; }
  sql += ' ORDER BY id DESC';
  const students = db.prepare(sql).all(...params);
  const withFees = students.map(s => {
    const paid = paidTotal(s.admission_no);
    return { ...s, paid, balance: Math.max(s.net_fees - paid, 0) };
  });
  res.json(withFees);
});

// Withdrawn students are shown in a separate register and never included in
// the active student list or fee-pending summaries. Their fee ledger is retained.
router.get('/withdrawn', (req, res) => {
  const { q, academic_year_id } = req.query;
  const yearId = resolveYearId(academic_year_id);
  let sql = "SELECT * FROM students WHERE status = 'Withdrawn'";
  const params = [];
  if (yearId) { sql += ' AND academic_year_id = ?'; params.push(yearId); }
  if (q) {
    sql += ' AND (admission_no LIKE ? OR name LIKE ? OR father_name LIKE ? OR mother_name LIKE ? OR place LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  sql += ' ORDER BY COALESCE(withdrawn_at, joining_date) DESC, name COLLATE NOCASE';
  const students = db.prepare(sql).all(...params).map(student => {
    const paid = paidTotal(student.admission_no);
    return { ...student, paid, balance: Math.max(Number(student.net_fees || 0) - paid, 0) };
  });
  res.json(students);
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
function weeklyTestReportHandler(req, res) {
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

  // class rank based on each classmate's own overall weekly-test average this year
  let weeklyRank = null, weeklyOutOf = null;
  if (overallAverage !== null) {
    const classmateAverages = db.prepare(`
      SELECT m.admission_no, AVG(m.marks * 100.0 / t.max_marks) as avg_pct
      FROM weekly_test_marks m
      JOIN students s ON s.admission_no = m.admission_no
      JOIN weekly_tests t ON t.id = m.weekly_test_id
      WHERE m.is_absent = 0 AND s.class = ? AND s.division = ? AND t.academic_year_id = ?
      GROUP BY m.admission_no
      ORDER BY avg_pct DESC
    `).all(student.class, student.division, yearId);
    const idx = classmateAverages.findIndex(r => r.admission_no === req.params.admission_no);
    weeklyRank = idx >= 0 ? idx + 1 : null;
    weeklyOutOf = classmateAverages.length;
  }

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

  // Term Examinations: subject-wise marks per exam sat this academic year,
  // plus each exam's overall percentage and how it compares to the class.
  const termExamRows = db.prepare(`
    SELECT m.subject, m.marks, m.max_marks, m.is_absent, e.id as exam_id, e.exam_name, e.exam_date
    FROM term_exam_marks m JOIN term_exams e ON e.id = m.term_exam_id
    WHERE m.admission_no = ? AND e.academic_year_id = ?
    ORDER BY e.exam_date ASC
  `).all(req.params.admission_no, yearId);

  const examGroups = {};
  termExamRows.forEach(r => {
    const g = examGroups[r.exam_id] || (examGroups[r.exam_id] = {
      exam_id: r.exam_id, exam_name: r.exam_name, exam_date: r.exam_date, subjects: [], total: 0, maxTotal: 0, anyPresent: false,
    });
    g.subjects.push({ subject: r.subject, marks: r.marks, max_marks: r.max_marks, is_absent: !!r.is_absent });
    if (!r.is_absent && r.marks !== null) { g.total += r.marks; g.maxTotal += r.max_marks; g.anyPresent = true; }
  });
  const classAvgForExam = db.prepare(`
    SELECT m.admission_no, SUM(m.marks) as total, SUM(m.max_marks) as maxTotal
    FROM term_exam_marks m JOIN students s ON s.admission_no = m.admission_no
    WHERE m.term_exam_id = ? AND m.is_absent = 0 AND s.class = ? AND s.division = ?
    GROUP BY m.admission_no
  `);
  const termExams = Object.values(examGroups).map(g => {
    const pct = g.anyPresent && g.maxTotal > 0 ? Math.round((g.total / g.maxTotal) * 1000) / 10 : null;
    const classPcts = classAvgForExam.all(g.exam_id, student.class, student.division)
      .map(r => ({ admission_no: r.admission_no, pct: r.maxTotal > 0 ? (r.total / r.maxTotal) * 100 : null }))
      .filter(r => r.pct !== null)
      .sort((a, b) => b.pct - a.pct);
    const classAverage = classPcts.length
      ? Math.round((classPcts.reduce((s, r) => s + r.pct, 0) / classPcts.length) * 10) / 10
      : null;
    const rankIndex = classPcts.findIndex(r => r.admission_no === req.params.admission_no);
    const rank = rankIndex >= 0 ? rankIndex + 1 : null;
    return { exam_id: g.exam_id, exam_name: g.exam_name, exam_date: g.exam_date, subjects: g.subjects, total: g.total, maxTotal: g.maxTotal, pct, classAverage, rank, outOf: classPcts.length };
  });

  // Cross-analysis: compare weekly test performance against term exam
  // performance, both overall and subject-by-subject, to see whether the
  // two formats agree or diverge for this student.
  const termSubjectPct = {};
  termExams.forEach(ex => {
    ex.subjects.forEach(s => {
      if (!s.is_absent && s.marks !== null) {
        const pct = (s.marks / s.max_marks) * 100;
        (termSubjectPct[s.subject] = termSubjectPct[s.subject] || []).push(pct);
      }
    });
  });
  const termOverallValues = termExams.filter(ex => ex.pct !== null).map(ex => ex.pct);
  const termOverallAverage = termOverallValues.length
    ? Math.round((termOverallValues.reduce((a, b) => a + b, 0) / termOverallValues.length) * 10) / 10
    : null;

  const subjectNames = new Set([...subjects.map(s => s.subject), ...Object.keys(termSubjectPct)]);
  const subjectComparison = [...subjectNames].map(name => {
    const weekly = subjects.find(s => s.subject === name);
    const termVals = termSubjectPct[name];
    const weeklyAverage = weekly ? weekly.average : null;
    const termAverage = termVals && termVals.length ? Math.round((termVals.reduce((a, b) => a + b, 0) / termVals.length) * 10) / 10 : null;
    const gap = (weeklyAverage !== null && termAverage !== null) ? Math.round((weeklyAverage - termAverage) * 10) / 10 : null;
    return { subject: name, weeklyAverage, termAverage, gap };
  }).sort((a, b) => (b.weeklyAverage ?? b.termAverage ?? 0) - (a.weeklyAverage ?? a.termAverage ?? 0));

  let overallGap = null;
  let consistency = 'Not enough data';
  if (overallAverage !== null && termOverallAverage !== null) {
    overallGap = Math.round((overallAverage - termOverallAverage) * 10) / 10;
    if (Math.abs(overallGap) <= 7) consistency = 'Consistent';
    else if (overallGap > 7) consistency = 'Stronger in Weekly Tests';
    else consistency = 'Stronger in Term Exams';
  }

  const crossAnalysis = {
    weeklyOverall: overallAverage,
    termOverall: termOverallAverage,
    overallGap,
    consistency,
    subjectComparison,
  };

  // Work tracking: regular assignments and late-arrival additional work are
  // included in the same student performance report for Admin and Parent views.
  const assignments = db.prepare(`
    SELECT assignment_type, subject, teacher_name, given_date, due_date,
      submission_status, submitted_date, details
    FROM student_assignments
    WHERE admission_no = ? AND academic_year_id = ?
    ORDER BY given_date DESC, id DESC
  `).all(req.params.admission_no, yearId);

  const lateArrivalWorks = db.prepare(`
    SELECT late_date, due_date, submission_status, submitted_date, details
    FROM late_arrival_works
    WHERE admission_no = ? AND academic_year_id = ?
    ORDER BY late_date DESC, id DESC
  `).all(req.params.admission_no, yearId);

  // Risk flags: a quick, scannable summary of anything that might need
  // attention, pulled from data already computed above.
  const riskFlags = [];
  subjects.forEach(s => { if (s.average < 35) riskFlags.push(`Weekly tests: ${s.subject} averaging ${s.average}% (below pass mark)`); });
  termExams.forEach(ex => {
    ex.subjects.forEach(s => {
      if (!s.is_absent && s.marks !== null && (s.marks / s.max_marks) * 100 < 35) {
        riskFlags.push(`${ex.exam_name}: ${s.subject} scored ${Math.round((s.marks / s.max_marks) * 1000) / 10}% (below pass mark)`);
      }
    });
  });
  if (absentCount > 1) riskFlags.push(`Missed ${absentCount} weekly tests this year`);
  if (hotSeat.alertCount > 0) riskFlags.push(`${hotSeat.alertCount} Hot Seat session(s) flagged missing notebook/textbook`);
  const pendingAssignmentCount = assignments.filter(a => (a.submission_status || 'Pending') === 'Pending').length;
  const pendingLateWorkCount = lateArrivalWorks.filter(a => (a.submission_status || 'Pending') === 'Pending').length;
  if (pendingAssignmentCount > 0) riskFlags.push(`${pendingAssignmentCount} assignment(s) awaiting submission`);
  if (pendingLateWorkCount > 0) riskFlags.push(`${pendingLateWorkCount} late-arrival additional work item(s) awaiting submission`);

  res.json({
    student: { admission_no: student.admission_no, name: student.name, class: student.class, division: student.division },
    testsTaken: withPct.length,
    presentCount: present.length,
    absentCount,
    overallAverage,
    weeklyRank,
    weeklyOutOf,
    strongest,
    weakest,
    trend,
    trendDelta,
    subjects,
    timeline,
    hotSeat,
    termExams,
    assignments,
    lateArrivalWorks,
    crossAnalysis,
    riskFlags,
  });
}

router.get('/:admission_no/weekly-test-report', weeklyTestReportHandler);

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

// Move a student into the withdrawn register without deleting any history.
router.post('/:admission_no/withdraw', (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE admission_no = ?').get(req.params.admission_no);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  if (student.status === 'Withdrawn') return res.status(409).json({ error: 'Student is already in the withdrawn register' });
  const effectiveDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.effective_date || ''))
    ? req.body.effective_date
    : new Date().toISOString().slice(0, 10);
  const reason = String(req.body.reason || '').trim().slice(0, 500);
  const move = db.transaction(() => {
    db.prepare(`UPDATE students SET status = 'Withdrawn', withdrawn_at = ?, withdrawal_reason = ? WHERE admission_no = ?`)
      .run(effectiveDate, reason || null, req.params.admission_no);
    db.prepare(`INSERT INTO student_status_history (admission_no, previous_status, new_status, effective_date, reason)
      VALUES (?, ?, 'Withdrawn', ?, ?)`)
      .run(req.params.admission_no, student.status || 'Active', effectiveDate, reason || null);
  });
  move();
  res.json({ message: 'Student moved to the withdrawn register. Student details, payments and academic records have been preserved.' });
});

// Restore a student to the active register if they rejoin.
router.post('/:admission_no/reactivate', (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE admission_no = ?').get(req.params.admission_no);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  if (student.status !== 'Withdrawn') return res.status(409).json({ error: 'Student is not in the withdrawn register' });
  const effectiveDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.effective_date || ''))
    ? req.body.effective_date
    : new Date().toISOString().slice(0, 10);
  const reason = String(req.body.reason || 'Rejoined').trim().slice(0, 500);
  const restore = db.transaction(() => {
    db.prepare(`UPDATE students SET status = 'Active', withdrawn_at = NULL, withdrawal_reason = NULL WHERE admission_no = ?`)
      .run(req.params.admission_no);
    db.prepare(`INSERT INTO student_status_history (admission_no, previous_status, new_status, effective_date, reason)
      VALUES (?, 'Withdrawn', 'Active', ?, ?)`)
      .run(req.params.admission_no, effectiveDate, reason || null);
  });
  restore();
  res.json({ message: 'Student restored to the active register.' });
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
  const sql = yearId ? "SELECT * FROM students WHERE academic_year_id = ? AND COALESCE(status, 'Active') <> 'Withdrawn'" : "SELECT * FROM students WHERE COALESCE(status, 'Active') <> 'Withdrawn'";
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
  const sql = yearId ? "SELECT * FROM students WHERE academic_year_id = ? AND COALESCE(status, 'Active') <> 'Withdrawn'" : "SELECT * FROM students WHERE COALESCE(status, 'Active') <> 'Withdrawn'";
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

// Full student details export — every field on every student record, plus
// their full payment history, weekly test summary, and Hot Seat summary,
// each as its own sheet — everything the software holds about students.
router.get('/reports/details/export', (req, res) => {
  const XLSX = require('xlsx');
  const yearId = resolveYearId(req.query.academic_year_id);
  const sql = yearId ? 'SELECT * FROM students WHERE academic_year_id = ?' : 'SELECT * FROM students';
  const students = (yearId ? db.prepare(sql).all(yearId) : db.prepare(sql).all())
    .sort((a, b) => b.class.localeCompare(a.class) || a.division.localeCompare(b.division) || a.name.localeCompare(b.name));

  const wb = XLSX.utils.book_new();

  // ---- Sheet 1: Students (full profile + fee status) ----
  const studentHeader = [
    'Adm No', 'Name', 'Class', 'Division', 'Medium', 'School', 'Joining Date',
    'Father Name', 'Father Phone', 'Mother Name', 'Mother Phone', 'Place',
    'Total Fee', 'Discount', 'Net Fee', 'Paid', 'Balance', 'Status', 'Remark',
  ];
  const studentData = students.map(s => {
    const paid = paidTotal(s.admission_no);
    const balance = Math.max(s.net_fees - paid, 0);
    return [
      s.admission_no, s.name, s.class, s.division, s.medium,
      s.school === 'Others' ? (s.school_other || 'Others') : s.school,
      s.joining_date,
      s.father_name || '', s.father_phone || '', s.mother_name || '', s.mother_phone || '',
      s.place || '', s.total_fees, s.discount, s.net_fees, paid, balance, s.status, s.remark || '',
    ];
  });
  const studentsSheet = XLSX.utils.aoa_to_sheet([studentHeader, ...studentData]);
  studentsSheet['!cols'] = [
    { wch: 12 }, { wch: 24 }, { wch: 7 }, { wch: 9 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
    { wch: 20 }, { wch: 14 }, { wch: 20 }, { wch: 14 }, { wch: 16 },
    { wch: 10 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(wb, studentsSheet, 'Students');

  // ---- Sheet 2: Payment History ----
  const admissionNos = students.map(s => s.admission_no);
  const payments = admissionNos.length
    ? db.prepare(`SELECT * FROM payments WHERE admission_no IN (${admissionNos.map(() => '?').join(',')}) ORDER BY payment_date DESC`).all(...admissionNos)
    : [];
  const studentByAdm = Object.fromEntries(students.map(s => [s.admission_no, s]));
  const paymentHeader = ['Adm No', 'Name', 'Receipt No', 'Amount', 'Payment Date'];
  const paymentData = payments.map(p => {
    const s = studentByAdm[p.admission_no];
    return [p.admission_no, s ? s.name : '', p.receipt_no, p.amount, p.payment_date];
  });
  const paymentsSheet = XLSX.utils.aoa_to_sheet([paymentHeader, ...paymentData]);
  paymentsSheet['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 16 }, { wch: 10 }, { wch: 13 }];
  XLSX.utils.book_append_sheet(wb, paymentsSheet, 'Payment History');

  // ---- Sheet 3: Weekly Test Summary ----
  const weeklyTestHeader = ['Adm No', 'Name', 'Class', 'Division', 'Tests Taken', 'Present', 'Absent', 'Average %'];
  const weeklyTestData = students.map(s => {
    const rows = db.prepare(`
      SELECT m.marks, m.is_absent, t.max_marks FROM weekly_test_marks m
      JOIN weekly_tests t ON t.id = m.weekly_test_id
      WHERE m.admission_no = ? AND t.academic_year_id = ?
    `).all(s.admission_no, yearId);
    const present = rows.filter(r => !r.is_absent);
    const avg = present.length
      ? Math.round((present.reduce((sum, r) => sum + (r.marks / r.max_marks) * 100, 0) / present.length) * 10) / 10
      : '';
    return [s.admission_no, s.name, s.class, s.division, rows.length, present.length, rows.length - present.length, avg];
  });
  const weeklyTestSheet = XLSX.utils.aoa_to_sheet([weeklyTestHeader, ...weeklyTestData]);
  weeklyTestSheet['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 7 }, { wch: 9 }, { wch: 11 }, { wch: 9 }, { wch: 9 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, weeklyTestSheet, 'Weekly Test Summary');

  // ---- Sheet 4: Hot Seat Summary ----
  const hotSeatHeader = ['Adm No', 'Name', 'Class', 'Division', 'Sessions', 'Predominant Rating', 'Missing Materials Alerts'];
  const hotSeatData = students.map(s => {
    const rows = db.prepare('SELECT * FROM hot_seats WHERE admission_no = ? AND academic_year_id = ?').all(s.admission_no, yearId);
    const ratingCounts = {};
    let alertCount = 0;
    rows.forEach(h => {
      if (h.performance) ratingCounts[h.performance] = (ratingCounts[h.performance] || 0) + 1;
      if (h.no_notebook) alertCount++;
      if (h.no_textbook) alertCount++;
    });
    const predominant = Object.entries(ratingCounts).sort((a, b) => b[1] - a[1])[0];
    return [s.admission_no, s.name, s.class, s.division, rows.length, predominant ? predominant[0] : '', alertCount];
  });
  const hotSeatSheet = XLSX.utils.aoa_to_sheet([hotSeatHeader, ...hotSeatData]);
  hotSeatSheet['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 7 }, { wch: 9 }, { wch: 10 }, { wch: 18 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, hotSeatSheet, 'Hot Seat Summary');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `students-full-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
});

router.weeklyTestReportHandler = weeklyTestReportHandler;
module.exports = router;
