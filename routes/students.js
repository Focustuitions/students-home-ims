const express = require('express');
const router = express.Router();
const db = require('../db/database');

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
  const { q, cls, division, medium, school, status } = req.query;
  let sql = 'SELECT * FROM students WHERE 1=1';
  const params = [];
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

// Create student
router.post('/', (req, res) => {
  const b = req.body;
  if (!b.admission_no || !b.name || !b.class || !b.division || !b.medium || !b.school) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const net_fees = computeNet(b.total_fees, b.discount);
  try {
    const stmt = db.prepare(`INSERT INTO students
      (admission_no, joining_date, name, class, division, medium, school, school_other,
       father_name, father_phone, mother_name, mother_phone, place, total_fees, discount, net_fees, status)
      VALUES (@admission_no, @joining_date, @name, @class, @division, @medium, @school, @school_other,
       @father_name, @father_phone, @mother_name, @mother_phone, @place, @total_fees, @discount, @net_fees, @status)`);
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
      status: 'Active'
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
  const students = db.prepare('SELECT * FROM students').all();
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
  const students = db.prepare('SELECT * FROM students').all();
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
