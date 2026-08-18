const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('../db/database');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function cellToString(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    // avoid scientific notation / trailing .0 on things like phone numbers
    return Number.isInteger(v) ? String(v) : String(v);
  }
  return String(v).trim();
}

function normHeader(h) {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Build a lookup from normalized header -> original column index, for a header row array
function headerIndex(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    const key = normHeader(h);
    if (key) map[key] = i;
  });
  return map;
}

function findCol(map, ...candidates) {
  for (const c of candidates) {
    const key = normHeader(c);
    if (key in map) return map[key];
  }
  return -1;
}

function sheetToRows(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
}

const SCHOOL_CANON = ['AKM', 'IUHSS', 'PKMM', 'NSS', 'FEM', 'MALABAR', 'NAJATH', 'GRHSS', 'PMSA'];
const SCHOOL_ALIASES = {
  'FEMHSS': 'FEM', 'FEM HSS': 'FEM', 'FEM HS': 'FEM',
  'MALABAR HSS': 'MALABAR', 'MALABAR HS': 'MALABAR',
};

function normalizeSchool(raw) {
  const val = cellToString(raw).trim();
  if (!val) return { school: '', school_other: null };
  const upper = val.toUpperCase();
  if (SCHOOL_ALIASES[upper]) return { school: SCHOOL_ALIASES[upper], school_other: null };
  if (SCHOOL_CANON.includes(upper)) return { school: upper, school_other: null };
  if (upper === 'OTHERS') return { school: 'Others', school_other: null };
  // unmatched value: keep it, but file it as "Others - specify"
  return { school: 'Others', school_other: val };
}

function normalizeClass(raw) {
  const val = cellToString(raw).trim();
  const m = val.match(/(\d+)/);
  return m ? m[1] : val;
}

function inferMedium(admissionNo, mediumCell) {
  const explicit = cellToString(mediumCell).trim().toLowerCase();
  if (explicit === 'malayalam' || explicit === 'm') return 'Malayalam';
  if (explicit === 'english' || explicit === 'e') return 'English';
  const adm = cellToString(admissionNo).toUpperCase();
  if (adm.includes('MKL')) return 'Malayalam';
  if (adm.includes('EKL')) return 'English';
  return 'English';
}

function teacherInitials(name) {
  if (!name) return '';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Students import
// ---------------------------------------------------------------------------
// Accepts either the institution's existing export format (Admission No, Name,
// Class, Division, School, Phone, Place, Mother Name, Mother Number, Father Name,
// Father Number, Remark) or the app's own template (with Father/Mother Phone,
// Medium, Joining Date, Total Fees, Discount). Both can be mixed.

router.post('/students', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  let wb;
  try {
    wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
  } catch (err) {
    return res.status(400).json({ error: 'Could not read this file as an Excel workbook' });
  }

  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = sheetToRows(ws);
  if (!rows.length) return res.status(400).json({ error: 'The sheet appears to be empty' });

  const map = headerIndex(rows[0]);
  const col = {
    admission_no: findCol(map, 'Admission No', 'Adm No', 'Admission Number'),
    name: findCol(map, 'Name', 'Student Name'),
    class: findCol(map, 'Class'),
    division: findCol(map, 'Division'),
    medium: findCol(map, 'Medium', 'Medium of Instruction'),
    school: findCol(map, 'School'),
    school_other: findCol(map, 'School Other', 'Specify School'),
    father_name: findCol(map, 'Father Name', "Father's Name"),
    father_phone: findCol(map, 'Father Phone', 'Father Number', "Father's Phone"),
    mother_name: findCol(map, 'Mother Name', "Mother's Name"),
    mother_phone: findCol(map, 'Mother Phone', 'Mother Number', "Mother's Phone"),
    place: findCol(map, 'Place'),
    joining_date: findCol(map, 'Joining Date'),
    total_fees: findCol(map, 'Total Fees', 'Fees'),
    discount: findCol(map, 'Discount'),
    remark: findCol(map, 'Remark', 'Remarks', 'Notes'),
  };

  if (col.admission_no === -1 || col.name === -1) {
    return res.status(400).json({ error: 'Could not find "Admission No" and "Name" columns in the sheet header row' });
  }

  const getExisting = db.prepare('SELECT admission_no FROM students WHERE admission_no = ?');
  const insertStmt = db.prepare(`INSERT INTO students
    (admission_no, joining_date, name, class, division, medium, school, school_other,
     father_name, father_phone, mother_name, mother_phone, place, total_fees, discount, net_fees, status, remark)
    VALUES (@admission_no, @joining_date, @name, @class, @division, @medium, @school, @school_other,
     @father_name, @father_phone, @mother_name, @mother_phone, @place, @total_fees, @discount, @net_fees, 'Active', @remark)`);
  const updateStmt = db.prepare(`UPDATE students SET
    name=@name, class=@class, division=@division, medium=@medium, school=@school, school_other=@school_other,
    father_name=@father_name, father_phone=@father_phone, mother_name=@mother_name, mother_phone=@mother_phone,
    place=@place, remark=@remark
    WHERE admission_no=@admission_no`);

  let inserted = 0, updated = 0;
  const skipped = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every(c => c === null || c === undefined || c === '')) continue;
    const admission_no = cellToString(row[col.admission_no]).trim();
    const name = col.name >= 0 ? cellToString(row[col.name]).trim() : '';
    if (!admission_no || !name) {
      skipped.push({ row: r + 1, reason: 'Missing Admission No or Name' });
      continue;
    }
    const schoolRaw = col.school >= 0 ? row[col.school] : '';
    const { school, school_other: derivedOther } = normalizeSchool(schoolRaw);
    const school_other = col.school_other >= 0 && row[col.school_other]
      ? cellToString(row[col.school_other]).trim()
      : derivedOther;

    const total_fees = col.total_fees >= 0 ? (Number(row[col.total_fees]) || 0) : 0;
    const discount = col.discount >= 0 ? (Number(row[col.discount]) || 0) : 0;

    const record = {
      admission_no,
      joining_date: col.joining_date >= 0 && row[col.joining_date] ? cellToString(row[col.joining_date]) : todayStr(),
      name,
      class: col.class >= 0 ? normalizeClass(row[col.class]) : '',
      division: col.division >= 0 ? cellToString(row[col.division]).trim().toUpperCase() : '',
      medium: inferMedium(admission_no, col.medium >= 0 ? row[col.medium] : null),
      school,
      school_other: school === 'Others' ? (school_other || '') : null,
      father_name: col.father_name >= 0 ? cellToString(row[col.father_name]).trim() : '',
      father_phone: col.father_phone >= 0 ? cellToString(row[col.father_phone]).trim() : '',
      mother_name: col.mother_name >= 0 ? cellToString(row[col.mother_name]).trim() : '',
      mother_phone: col.mother_phone >= 0 ? cellToString(row[col.mother_phone]).trim() : '',
      place: col.place >= 0 ? cellToString(row[col.place]).trim() : '',
      total_fees,
      discount,
      net_fees: Math.max(total_fees - discount, 0),
      remark: col.remark >= 0 ? cellToString(row[col.remark]).trim() || null : null,
    };

    try {
      if (getExisting.get(admission_no)) {
        updateStmt.run(record);
        updated++;
      } else {
        insertStmt.run(record);
        inserted++;
      }
    } catch (err) {
      skipped.push({ row: r + 1, admission_no, reason: err.message });
    }
  }

  res.json({ total: rows.length - 1, inserted, updated, skipped });
});

// ---------------------------------------------------------------------------
// Teachers import
// ---------------------------------------------------------------------------

router.post('/teachers', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  let wb;
  try {
    wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
  } catch (err) {
    return res.status(400).json({ error: 'Could not read this file as an Excel workbook' });
  }

  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = sheetToRows(ws);
  if (!rows.length) return res.status(400).json({ error: 'The sheet appears to be empty' });

  const map = headerIndex(rows[0]);
  const col = {
    name: findCol(map, 'Name', 'Teacher Name'),
    classes_handled: findCol(map, 'Classes Handled', 'Classes'),
    subject: findCol(map, 'Subject'),
    hour_rate: findCol(map, 'Hour Rate', 'Hour Rate (Rs)', 'Rate'),
    phone: findCol(map, 'Phone', 'Phone Number'),
  };

  if (col.name === -1) {
    return res.status(400).json({ error: 'Could not find a "Name" column in the sheet header row' });
  }

  const getExisting = db.prepare('SELECT id FROM teachers WHERE LOWER(name) = LOWER(?)');
  const insertStmt = db.prepare(`INSERT INTO teachers (name, classes_handled, subject, hour_rate, phone)
    VALUES (@name, @classes_handled, @subject, @hour_rate, @phone)`);
  const updateStmt = db.prepare(`UPDATE teachers SET classes_handled=@classes_handled, subject=@subject,
    hour_rate=@hour_rate, phone=@phone WHERE id=@id`);

  let inserted = 0, updated = 0;
  const skipped = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every(c => c === null || c === undefined || c === '')) continue;
    const name = cellToString(row[col.name]).trim();
    if (!name) { skipped.push({ row: r + 1, reason: 'Missing Name' }); continue; }

    const record = {
      name,
      classes_handled: col.classes_handled >= 0 ? cellToString(row[col.classes_handled]).trim() : '',
      subject: col.subject >= 0 ? cellToString(row[col.subject]).trim() : '',
      hour_rate: col.hour_rate >= 0 ? (Number(row[col.hour_rate]) || 0) : 0,
      phone: col.phone >= 0 ? cellToString(row[col.phone]).trim() : '',
    };

    try {
      const existing = getExisting.get(name);
      if (existing) {
        updateStmt.run({ ...record, id: existing.id });
        updated++;
      } else {
        insertStmt.run(record);
        inserted++;
      }
    } catch (err) {
      skipped.push({ row: r + 1, name, reason: err.message });
    }
  }

  res.json({ total: rows.length - 1, inserted, updated, skipped });
});

// ---------------------------------------------------------------------------
// Timetable import
// ---------------------------------------------------------------------------
// Expects repeating blocks anywhere in any sheet:
//   Row N   : Date | Day | TIME | <class col> | <class col> | ...
//   Row N+1 : <date value> | <day text> | <"7:30 AM TO 8:30 AM"> | <"Subject XX"> | ...
// Class columns look like "10A", "10 B", "9 A". Cell values look like
// "Maths SF" (subject + trailing teacher initials). Blocks repeat down (and
// across sheets) for every period/time-slot.

function parseHeaderClassDivision(text) {
  const val = cellToString(text).trim();
  const m = val.match(/^(\d+)\s*([A-Za-z])$/);
  if (!m) return null;
  return { class: m[1], division: m[2].toUpperCase() };
}

function parseTimeToken(tok) {
  const m = String(tok).trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]\.?$/);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const min = m[2];
  const mer = m[3].toUpperCase();
  if (mer === 'P' && hour !== 12) hour += 12;
  if (mer === 'A' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${min}`;
}

function parseTimeRange(raw) {
  if (raw instanceof Date) return null; // unexpected shape
  const val = cellToString(raw).trim();
  const parts = val.split(/\s+to\s+/i);
  if (parts.length !== 2) return null;
  const start = parseTimeToken(parts[0]);
  const end = parseTimeToken(parts[1]);
  if (!start || !end) return null;
  return { start, end };
}

function calcHours(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}

function parseDateCell(raw) {
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  const val = cellToString(raw).trim();
  let m = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = val.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function splitSubjectTeacher(cellText) {
  const val = cellToString(cellText).trim();
  if (!val) return null;
  const tokens = val.split(/\s+/);
  const last = tokens[tokens.length - 1];
  if (tokens.length > 1 && /^[A-Z]{2,4}$/.test(last)) {
    return { subject: tokens.slice(0, -1).join(' '), initials: last };
  }
  return { subject: val, initials: null };
}

router.post('/timetable', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  let wb;
  try {
    wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
  } catch (err) {
    return res.status(400).json({ error: 'Could not read this file as an Excel workbook' });
  }

  // build teacher initials lookup: initials -> [teacher rows]
  const teachers = db.prepare('SELECT * FROM teachers').all();
  const byInitials = {};
  teachers.forEach(t => {
    const ini = teacherInitials(t.name);
    (byInitials[ini] = byInitials[ini] || []).push(t);
  });

  const findEntry = db.prepare(`SELECT * FROM timetable WHERE date=? AND start_time=? AND end_time=? AND class=? AND division=?`);
  const insertEntry = db.prepare(`INSERT INTO timetable (date, start_time, end_time, hours, class, division, subject, teacher_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const updateEntry = db.prepare(`UPDATE timetable SET hours=?, subject=?, teacher_id=? WHERE id=?`);

  let inserted = 0, updated = 0, totalCells = 0;
  const skipped = [];

  wb.SheetNames.forEach(sheetName => {
    const ws = wb.Sheets[sheetName];
    const rows = sheetToRows(ws);

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] || [];
      const a = normHeader(row[0]), b = normHeader(row[1]), c = normHeader(row[2]);
      if (a !== 'date' || b !== 'day' || c !== 'time') continue;

      // gather class columns starting at index 3 until a blank header
      const classCols = [];
      for (let ci = 3; ci < row.length; ci++) {
        if (row[ci] === null || row[ci] === undefined || row[ci] === '') break;
        const cd = parseHeaderClassDivision(row[ci]);
        if (cd) classCols.push({ col: ci, ...cd });
      }
      if (!classCols.length) continue;

      const dataRow = rows[r + 1] || [];
      const date = parseDateCell(dataRow[0]);
      const timeRange = parseTimeRange(dataRow[2]);
      if (!date || !timeRange) {
        skipped.push({ sheet: sheetName, row: r + 2, reason: 'Could not parse date or time range' });
        continue;
      }
      const hours = calcHours(timeRange.start, timeRange.end);

      classCols.forEach(cc => {
        const raw = dataRow[cc.col];
        if (raw === null || raw === undefined || raw === '') return; // empty cell, nothing scheduled
        totalCells++;
        const parsed = splitSubjectTeacher(raw);
        if (!parsed || !parsed.initials) {
          skipped.push({ sheet: sheetName, row: r + 2, class: `${cc.class} ${cc.division}`, value: cellToString(raw), reason: 'No teacher initials found in cell' });
          return;
        }
        const matches = byInitials[parsed.initials] || [];
        if (matches.length !== 1) {
          skipped.push({ sheet: sheetName, row: r + 2, class: `${cc.class} ${cc.division}`, value: cellToString(raw), reason: matches.length === 0 ? `No teacher found with initials "${parsed.initials}"` : `Multiple teachers share initials "${parsed.initials}" — add the teacher manually` });
          return;
        }
        const teacher = matches[0];
        const existing = findEntry.get(date, timeRange.start, timeRange.end, cc.class, cc.division);
        if (existing) {
          updateEntry.run(hours, parsed.subject, teacher.id, existing.id);
          updated++;
        } else {
          insertEntry.run(date, timeRange.start, timeRange.end, hours, cc.class, cc.division, parsed.subject, teacher.id);
          inserted++;
        }
      });

      r += 1; // skip the data row we just consumed
    }
  });

  res.json({ total: totalCells, inserted, updated, skipped });
});

// ---------------------------------------------------------------------------
// Fee balances import
// ---------------------------------------------------------------------------
// Sets each student's Total Fees / Discount, then reconciles their recorded
// payments up to the sheet's "Paid" figure by adding one opening-balance
// payment for the shortfall (receipt "OB-<admission_no>"). Safe to re-run:
// if the recorded total already matches, nothing more is added.

router.post('/fees', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  let wb;
  try {
    wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
  } catch (err) {
    return res.status(400).json({ error: 'Could not read this file as an Excel workbook' });
  }

  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = sheetToRows(ws);
  if (!rows.length) return res.status(400).json({ error: 'The sheet appears to be empty' });

  const map = headerIndex(rows[0]);
  const col = {
    admission_no: findCol(map, 'Adm No', 'Admission No', 'Admission Number'),
    total_fee: findCol(map, 'Total Fee', 'Total Fees', 'Fees'),
    discount: findCol(map, 'Discount'),
    paid: findCol(map, 'Paid', 'Amount Paid'),
  };

  if (col.admission_no === -1 || col.total_fee === -1 || col.paid === -1) {
    return res.status(400).json({ error: 'Could not find "Adm No", "Total Fee" and "Paid" columns in the sheet header row' });
  }

  const getStudent = db.prepare('SELECT * FROM students WHERE admission_no = ?');
  const updateFees = db.prepare('UPDATE students SET total_fees=?, discount=?, net_fees=? WHERE admission_no=?');
  const getPaidSum = db.prepare('SELECT COALESCE(SUM(amount),0) as paid FROM payments WHERE admission_no = ?');
  const insertOpeningPayment = db.prepare(`INSERT INTO payments (admission_no, receipt_no, amount, payment_date)
    VALUES (?, ?, ?, ?)`);
  const findOpeningPayment = db.prepare(`SELECT * FROM payments WHERE admission_no = ? AND receipt_no = ?`);
  const updateOpeningPayment = db.prepare('UPDATE payments SET amount=? WHERE id=?');

  let feesUpdated = 0, paymentsAdjusted = 0;
  const skipped = [];
  const today = todayStr();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every(c => c === null || c === undefined || c === '')) continue;
    const admission_no = cellToString(row[col.admission_no]).trim();
    if (!admission_no) { skipped.push({ row: r + 1, reason: 'Missing Adm No' }); continue; }

    const student = getStudent.get(admission_no);
    if (!student) {
      skipped.push({ row: r + 1, admission_no, reason: 'No matching student — import students first' });
      continue;
    }

    const total_fee = Number(row[col.total_fee]) || 0;
    const discount = col.discount >= 0 ? (Number(row[col.discount]) || 0) : 0;
    const targetPaid = Number(row[col.paid]) || 0;
    const net_fees = Math.max(total_fee - discount, 0);

    updateFees.run(total_fee, discount, net_fees, admission_no);
    feesUpdated++;

    // reconcile: bring recorded payments up to targetPaid using one "opening
    // balance" entry per student, adjustable on re-import.
    const receiptTag = `OB-${admission_no}`;
    const existingOpening = findOpeningPayment.get(admission_no, receiptTag);
    const otherPaid = getPaidSum.get(admission_no).paid - (existingOpening ? existingOpening.amount : 0);
    const neededOpening = Math.round((targetPaid - otherPaid) * 100) / 100;

    if (neededOpening < 0) {
      skipped.push({ row: r + 1, admission_no, reason: `Recorded payments (₹${otherPaid}) already exceed the sheet's Paid figure (₹${targetPaid}) — left as-is` });
    } else if (existingOpening) {
      if (existingOpening.amount !== neededOpening) {
        updateOpeningPayment.run(neededOpening, existingOpening.id);
        paymentsAdjusted++;
      }
    } else if (neededOpening > 0) {
      insertOpeningPayment.run(admission_no, receiptTag, neededOpening, today);
      paymentsAdjusted++;
    }
  }

  res.json({ total: rows.length - 1, feesUpdated, paymentsAdjusted, skipped });
});

module.exports = router;
