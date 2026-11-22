const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('../db/database');
const { resolveYearId } = require('../db/academicYear');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function text(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function norm(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parts = XLSX.SSF.parse_date_code(value);
    if (parts && parts.y && parts.m && parts.d) {
      return `${parts.y}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
    }
  }
  const raw = text(value);
  if (!raw) return '';
  let match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (match) {
    const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return '';
  }
  match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return '';
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function parseDepartment(value) {
  const raw = String(value || '').replace(/^Department\s*:/i, '').trim();
  const match = raw.match(/^(?:Class\s*)?([A-Za-z0-9]+)\s+([A-Za-z0-9]+)(?:\s|$)/i);
  if (!match) return null;
  return { class: match[1].trim(), division: match[2].trim().toUpperCase(), label: raw };
}

function normalizeClass(value) {
  return String(value || '').trim().replace(/^class\s*/i, '').replace(/\.0$/, '').toUpperCase();
}

function parseWorkbook(buffer, academicYearId) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellNF: false });
  } catch (error) {
    throw new Error('Could not read this file as an Excel workbook. Please upload the original absent-report .xlsx file.');
  }
  if (!workbook.SheetNames.length) throw new Error('The uploaded workbook has no worksheets.');

  const absentRows = [];
  const errors = [];
  const warnings = [];
  const skippedRows = [];
  let reportRange = '';
  const seen = new Set();

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: false });
    let department = null;
    let columns = null;

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index] || [];
      const first = text(row[0]);
      const joined = row.map(text).join(' ').trim();
      if (!reportRange && /\bFrom\b.+\bTo\b/i.test(joined)) reportRange = joined;

      if (/^Department\s*:/i.test(first)) {
        department = parseDepartment(first);
        if (!department) errors.push(`${sheetName}, row ${index + 1}: Could not read class and division from "${first}".`);
        columns = null;
        continue;
      }

      const headerMap = {};
      row.forEach((value, colIndex) => {
        const key = norm(value);
        if (key) headerMap[key] = colIndex;
      });
      if (headerMap.employeeid !== undefined && headerMap.date !== undefined &&
          (headerMap.status !== undefined || headerMap.absence !== undefined)) {
        columns = {
          admission: headerMap.employeeid,
          name: headerMap.firstname !== undefined ? headerMap.firstname : headerMap.name,
          date: headerMap.date,
          absence: headerMap.absence,
          status: headerMap.status,
        };
        continue;
      }

      if (!columns || !first || /^total$/i.test(first)) continue;
      const admissionNo = text(row[columns.admission]).toUpperCase();
      if (!admissionNo) continue;

      const status = columns.status === undefined ? '' : text(row[columns.status]).toLowerCase();
      const absenceValue = columns.absence === undefined ? null : row[columns.absence];
      const hasAbsenceFlag = absenceValue !== null && absenceValue !== undefined && absenceValue !== '' && Number(absenceValue) > 0;
      const isAbsent = status === 'absent' || status === 'a' || hasAbsenceFlag;
      if (!isAbsent) {
        skippedRows.push({ sheet: sheetName, row: index + 1, admission_no: admissionNo, reason: 'Row is not marked Absent; ignored.' });
        continue;
      }

      if (!department) {
        errors.push(`${sheetName}, row ${index + 1}: ${admissionNo} is not inside a recognised Department block.`);
        continue;
      }
      const attendanceDate = isoDate(row[columns.date]);
      if (!attendanceDate) {
        errors.push(`${sheetName}, row ${index + 1}: ${admissionNo} has a missing or invalid attendance date.`);
        continue;
      }

      const duplicateKey = `${attendanceDate}|${admissionNo}`;
      if (seen.has(duplicateKey)) {
        errors.push(`${sheetName}, row ${index + 1}: Duplicate absent entry for ${admissionNo} on ${attendanceDate}.`);
        continue;
      }
      seen.add(duplicateKey);
      absentRows.push({
        sheet: sheetName,
        row: index + 1,
        admission_no: admissionNo,
        reported_name: columns.name === undefined ? '' : text(row[columns.name]),
        date: attendanceDate,
        class: department.class,
        division: department.division,
        department: department.label,
      });
    }
  }

  if (!absentRows.length) errors.push('No absent student rows were found. The workbook must contain Employee ID, Date and Status or Absence columns.');

  const roster = db.prepare(`
    SELECT admission_no, name, class, division, joining_date, status, academic_year_id
    FROM students
    WHERE academic_year_id = ? AND lower(trim(status)) = 'active'
    ORDER BY class, division, name
  `).all(academicYearId);
  if (!roster.length) errors.push('There are no active students in the selected academic year. Select the correct academic year or check the student register.');

  const activeMap = new Map(roster.map(student => [String(student.admission_no).trim().toUpperCase(), student]));
  const allStudentsMap = new Map(db.prepare('SELECT admission_no, name, class, division, status, academic_year_id FROM students').all()
    .map(student => [String(student.admission_no).trim().toUpperCase(), student]));
  const absenteesByDate = new Map();
  const matchedAbsentees = [];

  for (const item of absentRows) {
    const student = activeMap.get(item.admission_no);
    if (!student) {
      const existing = allStudentsMap.get(item.admission_no);
      if (!existing) {
        errors.push(`${item.admission_no} (${item.reported_name || 'name not provided'}) is not found in the student register.`);
      } else if (Number(existing.academic_year_id) !== Number(academicYearId)) {
        errors.push(`${item.admission_no} belongs to a different academic year (${existing.academic_year_id || 'not assigned'}).`);
      } else {
        errors.push(`${item.admission_no} is not an active student (${existing.status || 'unknown status'}).`);
      }
      continue;
    }

    if (normalizeClass(item.class) !== normalizeClass(student.class) || item.division.toUpperCase() !== String(student.division || '').trim().toUpperCase()) {
      errors.push(`${item.admission_no} is listed under Department ${item.class}-${item.division}, but the website register shows ${student.class}-${student.division}.`);
      continue;
    }

    if (item.reported_name && norm(item.reported_name) !== norm(student.name)) {
      warnings.push(`${item.admission_no}: Report name "${item.reported_name}" differs from website name "${student.name}". Admission Number was used for matching.`);
    }

    if (!absenteesByDate.has(item.date)) absenteesByDate.set(item.date, new Set());
    absenteesByDate.get(item.date).add(item.admission_no);
    matchedAbsentees.push({ ...item, student_name: student.name, class: student.class, division: student.division });
  }

  const dates = [...absenteesByDate.keys()].sort();
  const summaries = dates.map(date => {
    const absentCount = absenteesByDate.get(date).size;
    return {
      date,
      total_students: roster.length,
      absent: absentCount,
      present: Math.max(0, roster.length - absentCount),
      class_divisions: [...new Set(matchedAbsentees.filter(row => row.date === date).map(row => `${row.class}-${row.division}`))].sort(),
    };
  });

  const existingQuery = db.prepare('SELECT COUNT(*) AS count FROM attendance_records WHERE attendance_date = ? AND academic_year_id = ?');
  const existingRecords = dates.reduce((sum, date) => sum + existingQuery.get(date, academicYearId).count, 0);
  const invalidCount = errors.length;

  return {
    academic_year_id: academicYearId,
    report_range: reportRange,
    sheet_names: workbook.SheetNames,
    summary: summaries,
    roster_count: roster.length,
    absent_count: matchedAbsentees.length,
    present_count: summaries.reduce((sum, item) => sum + item.present, 0),
    record_count: summaries.reduce((sum, item) => sum + item.total_students, 0),
    existing_records: existingRecords,
    matched_absentees: matchedAbsentees,
    errors,
    warnings,
    skipped_rows: skippedRows,
    can_apply: invalidCount === 0 && dates.length > 0,
    _roster: roster,
    _absentees_by_date: absenteesByDate,
  };
}

function publicPlan(plan) {
  const { _roster, _absentees_by_date, ...data } = plan;
  return data;
}

function getYear(req, res) {
  const academicYearId = resolveYearId(req.query.academic_year_id ?? req.body?.academic_year_id);
  if (!academicYearId) {
    res.status(400).json({ error: 'No academic year is selected. Please select an academic year and try again.' });
    return null;
  }
  return academicYearId;
}

function ensureExcelFile(req, res, next) {
  if (!req.file) return res.status(400).json({ error: 'Please choose an absent-report Excel file.' });
  const name = String(req.file.originalname || '').toLowerCase();
  if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
    return res.status(400).json({ error: 'Please upload an Excel .xlsx or .xls file.' });
  }
  next();
}

router.post('/preview', upload.single('file'), ensureExcelFile, (req, res) => {
  const academicYearId = getYear(req, res);
  if (!academicYearId) return;
  try {
    const plan = parseWorkbook(req.file.buffer, academicYearId);
    res.json(publicPlan(plan));
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not preview this absent report.' });
  }
});

router.post('/apply', upload.single('file'), ensureExcelFile, (req, res) => {
  const academicYearId = getYear(req, res);
  if (!academicYearId) return;
  try {
    // Re-parse against the live student register immediately before saving.
    const plan = parseWorkbook(req.file.buffer, academicYearId);
    if (!plan.can_apply) {
      return res.status(422).json({
        error: 'Attendance was not saved. Resolve the unmatched or incorrect entries shown in the preview, then upload the report again.',
        preview: publicPlan(plan),
      });
    }

    const upsert = db.prepare(`
      INSERT INTO attendance_records (attendance_date, admission_no, academic_year_id, status, source)
      VALUES (?, ?, ?, ?, 'Absent Report Upload')
      ON CONFLICT(attendance_date, admission_no, academic_year_id)
      DO UPDATE SET status = excluded.status,
                    source = excluded.source,
                    updated_at = datetime('now')
    `);
    const apply = db.transaction(() => {
      let insertedOrUpdated = 0;
      let absentSaved = 0;
      let presentSaved = 0;
      for (const summary of plan.summary) {
        const absentSet = plan._absentees_by_date.get(summary.date) || new Set();
        for (const student of plan._roster) {
          const status = absentSet.has(String(student.admission_no).trim().toUpperCase()) ? 'Absent' : 'Present';
          upsert.run(summary.date, student.admission_no, academicYearId, status);
          insertedOrUpdated++;
          if (status === 'Absent') absentSaved++;
          else presentSaved++;
        }
      }
      return { inserted_or_updated: insertedOrUpdated, absent_saved: absentSaved, present_saved: presentSaved };
    });

    const saved = apply();
    res.json({
      ok: true,
      dates: plan.summary.map(item => item.date),
      ...saved,
      summary: plan.summary,
      existing_records_overwritten: plan.existing_records,
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not save attendance.' });
  }
});

router.get('/summary', (req, res) => {
  const academicYearId = getYear(req, res);
  if (!academicYearId) return;
  const rows = db.prepare(`
    SELECT ar.attendance_date AS date, s.class, s.division,
           COUNT(*) AS total_students,
           SUM(CASE WHEN ar.status = 'Present' THEN 1 ELSE 0 END) AS present,
           SUM(CASE WHEN ar.status = 'Absent' THEN 1 ELSE 0 END) AS absent,
           MAX(ar.updated_at) AS updated_at
    FROM attendance_records ar
    JOIN students s ON s.admission_no = ar.admission_no
    WHERE ar.academic_year_id = ?
    GROUP BY ar.attendance_date, s.class, s.division
    ORDER BY ar.attendance_date DESC, s.class, s.division
    LIMIT 600
  `).all(academicYearId);
  res.json({ rows });
});

router.get('/records', (req, res) => {
  const academicYearId = getYear(req, res);
  if (!academicYearId) return;
  const filters = ['ar.academic_year_id = ?'];
  const params = [academicYearId];
  if (req.query.date) { filters.push('ar.attendance_date = ?'); params.push(String(req.query.date)); }
  if (req.query.class) { filters.push('s.class = ?'); params.push(String(req.query.class)); }
  if (req.query.division) { filters.push('s.division = ?'); params.push(String(req.query.division)); }
  if (req.query.status) { filters.push('ar.status = ?'); params.push(String(req.query.status)); }
  if (req.query.search) {
    filters.push('(s.admission_no LIKE ? OR s.name LIKE ?)');
    params.push(`%${String(req.query.search)}%`, `%${String(req.query.search)}%`);
  }
  const rows = db.prepare(`
    SELECT ar.attendance_date AS date, ar.status, ar.source, ar.updated_at,
           s.admission_no, s.name AS student_name, s.class, s.division
    FROM attendance_records ar
    JOIN students s ON s.admission_no = ar.admission_no
    WHERE ${filters.join(' AND ')}
    ORDER BY s.name COLLATE NOCASE
    LIMIT 3000
  `).all(...params);
  res.json({ rows });
});

router.get('/export', (req, res) => {
  const academicYearId = getYear(req, res);
  if (!academicYearId) return;
  const filters = ['ar.academic_year_id = ?'];
  const params = [academicYearId];
  if (req.query.date) { filters.push('ar.attendance_date = ?'); params.push(String(req.query.date)); }
  if (req.query.class) { filters.push('s.class = ?'); params.push(String(req.query.class)); }
  if (req.query.division) { filters.push('s.division = ?'); params.push(String(req.query.division)); }
  const rows = db.prepare(`
    SELECT ar.attendance_date AS Date, s.class AS Class, s.division AS Division,
           s.admission_no AS Admission_Number, s.name AS Student_Name, ar.status AS Attendance_Status,
           ar.source AS Source, ar.updated_at AS Last_Updated
    FROM attendance_records ar JOIN students s ON s.admission_no = ar.admission_no
    WHERE ${filters.join(' AND ')}
    ORDER BY ar.attendance_date DESC, s.class, s.division, s.name COLLATE NOCASE
  `).all(...params);
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Attendance');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const suffix = req.query.date || 'register';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="students-home-attendance-${suffix}.xlsx"`);
  res.send(buffer);
});

module.exports = router;
